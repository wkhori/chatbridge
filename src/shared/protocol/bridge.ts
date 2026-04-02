import { v4 as uuid } from 'uuid'
import {
  type AppMessageType,
  type AppSession,
  AppSessionStatus,
  type BridgeMessageType,
  CompletionPayloadSchema,
  ErrorPayloadSchema,
  type MessageEnvelope,
  MessageEnvelopeSchema,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  RATE_LIMIT,
  READY_TIMEOUT,
  ReadyPayloadSchema,
  StateUpdatePayloadSchema,
  TOOL_TIMEOUT,
  TOOL_TIMEOUT_LONG,
  ToolRegisterPayloadSchema,
  ToolResultPayloadSchema,
  type ToolSchema,
  UIResizePayloadSchema,
  VisionFramePayloadSchema,
  MAX_MESSAGE_SIZE,
} from './types'

// --- Rate Limiter ---

class SlidingWindowRateLimiter {
  private timestamps: number[] = []

  constructor(private maxPerSecond: number) {}

  allow(): boolean {
    const now = Date.now()
    this.timestamps = this.timestamps.filter((t) => now - t < 1000)
    if (this.timestamps.length >= this.maxPerSecond) return false
    this.timestamps.push(now)
    return true
  }
}

// --- Nonce Tracker ---

class NonceTracker {
  private lastNonce = -1

  validate(nonce: number): boolean {
    if (nonce <= this.lastNonce) return false
    this.lastNonce = nonce
    return true
  }
}

// --- Pending Tool Call ---

interface PendingToolCall {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// --- App Bridge ---

export type BridgeEventType =
  | 'ready'
  | 'tools_registered'
  | 'state_update'
  | 'completion'
  | 'error'
  | 'vision_frame'
  | 'ui_resize'
  | 'heartbeat_timeout'

export interface BridgeEvent {
  type: BridgeEventType
  appId: string
  sessionId: string
  data: unknown
}

type BridgeListener = (event: BridgeEvent) => void

export class AppBridge {
  private iframe: HTMLIFrameElement | null = null
  private nonce = 0
  private rateLimiter = new SlidingWindowRateLimiter(RATE_LIMIT)
  private nonceTracker = new NonceTracker()
  private pendingToolCalls = new Map<string, PendingToolCall>()
  private listeners = new Set<BridgeListener>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private missedHeartbeats = 0
  private destroyed = false

  constructor(
    public readonly session: AppSession,
    private readonly allowedOrigins: Set<string>
  ) {}

  // --- Public API ---

  attach(iframe: HTMLIFrameElement): void {
    this.iframe = iframe
    window.addEventListener('message', this.handleMessage)
  }

  detach(): void {
    window.removeEventListener('message', this.handleMessage)
    this.stopHeartbeat()
    this.iframe = null
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.sendToPlatform('DESTROY', { reason: 'session_ended', graceMs: 5000 })
    // Reject all pending tool calls
    for (const [id, pending] of this.pendingToolCalls) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Bridge destroyed'))
      this.pendingToolCalls.delete(id)
    }
    this.detach()
  }

  async waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error(`App ${this.session.appId} failed to send READY within ${READY_TIMEOUT}ms`))
      }, READY_TIMEOUT)

      const off = this.on('ready', () => {
        clearTimeout(timer)
        off()
        resolve()
      })
    })
  }

  sendInit(restoredState: Record<string, unknown> | null): void {
    this.sendToPlatform('INIT', {
      sessionId: this.session.id,
      permissions: [], // derived from manifest
      restoredState,
      config: {},
    })
  }

  async invokeTool(toolName: string, toolCallId: string, params: Record<string, unknown>): Promise<unknown> {
    const tool = this.session.tools.find((t) => t.name === toolName)
    const timeout = tool?.longRunning ? TOOL_TIMEOUT_LONG : TOOL_TIMEOUT

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingToolCalls.delete(toolCallId)
        reject(new Error(`Tool ${toolName} timed out after ${timeout}ms`))
      }, timeout)

      this.pendingToolCalls.set(toolCallId, { resolve, reject, timer })

      this.sendToPlatform('TOOL_INVOKE', {
        toolName,
        toolCallId,
        params,
      })
    })
  }

  on(type: BridgeEventType, listener: BridgeListener): () => void {
    const wrappedListener: BridgeListener = (event) => {
      if (event.type === type) listener(event)
    }
    this.listeners.add(wrappedListener)
    return () => this.listeners.delete(wrappedListener)
  }

  onAny(listener: BridgeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // --- Private ---

  private handleMessage = (event: MessageEvent): void => {
    // Size check
    const raw = JSON.stringify(event.data)
    if (raw.length > MAX_MESSAGE_SIZE) return

    // Protocol filter
    if (event.data?.protocol !== PROTOCOL_ID) return

    // Origin validation: sandboxed iframes send origin "null" (as string)
    const origin = event.origin
    if (origin !== 'null' && !this.allowedOrigins.has(origin)) return

    // Parse envelope
    const parsed = MessageEnvelopeSchema.safeParse(event.data)
    if (!parsed.success) return

    const msg = parsed.data

    // App ID check
    if (msg.appId !== this.session.appId) return

    // Rate limit
    if (!this.rateLimiter.allow()) return

    // Nonce check
    if (!this.nonceTracker.validate(msg.nonce)) return

    this.routeMessage(msg)
  }

  private routeMessage(msg: MessageEnvelope): void {
    const type = msg.type as AppMessageType
    const { payload, correlationId } = msg

    switch (type) {
      case 'READY': {
        const parsed = ReadyPayloadSchema.safeParse(payload)
        if (!parsed.success) break
        this.emit('ready', parsed.data)
        break
      }
      case 'TOOL_REGISTER': {
        const parsed = ToolRegisterPayloadSchema.safeParse(payload)
        if (!parsed.success) break
        this.emit('tools_registered', parsed.data.tools)
        break
      }
      case 'TOOL_RESULT': {
        if (!correlationId) break
        const parsed = ToolResultPayloadSchema.safeParse(payload)
        if (!parsed.success) break
        const pending = this.pendingToolCalls.get(correlationId)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingToolCalls.delete(correlationId)
          if (parsed.data.success) {
            pending.resolve(parsed.data.result)
          } else {
            pending.reject(new Error(parsed.data.error || 'Tool invocation failed'))
          }
        }
        break
      }
      case 'STATE_UPDATE': {
        const parsed = StateUpdatePayloadSchema.safeParse(payload)
        if (!parsed.success) break
        this.emit('state_update', parsed.data)
        break
      }
      case 'COMPLETION': {
        const parsed = CompletionPayloadSchema.safeParse(payload)
        if (!parsed.success) break
        this.emit('completion', parsed.data)
        break
      }
      case 'ERROR': {
        const parsed = ErrorPayloadSchema.safeParse(payload)
        if (!parsed.success) break
        this.emit('error', parsed.data)
        break
      }
      case 'VISION_FRAME': {
        const parsed = VisionFramePayloadSchema.safeParse(payload)
        if (!parsed.success) break
        this.emit('vision_frame', parsed.data)
        break
      }
      case 'UI_RESIZE': {
        const parsed = UIResizePayloadSchema.safeParse(payload)
        if (!parsed.success) break
        this.emit('ui_resize', parsed.data)
        break
      }
      case 'HEARTBEAT_PONG': {
        this.missedHeartbeats = 0
        break
      }
    }
  }

  private sendToPlatform(type: BridgeMessageType, payload: Record<string, unknown>): void {
    if (!this.iframe?.contentWindow) return

    const msg: MessageEnvelope = {
      protocol: PROTOCOL_ID,
      version: PROTOCOL_VERSION,
      type,
      id: uuid(),
      correlationId: null,
      appId: this.session.appId,
      nonce: this.nonce++,
      timestamp: new Date().toISOString(),
      payload,
    }

    this.iframe.contentWindow.postMessage(msg, '*')
  }

  private emit(type: BridgeEventType, data: unknown): void {
    const event: BridgeEvent = {
      type,
      appId: this.session.appId,
      sessionId: this.session.id,
      data,
    }
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}
