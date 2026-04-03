/**
 * ChatBridge App SDK — client library for third-party apps running inside ChatBridge iframes.
 * Handles the postMessage protocol for communication with the platform.
 */

const PROTOCOL = 'chatbridge' as const
const VERSION = '1.0.0' as const

interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  longRunning?: boolean
}

interface MessageEnvelope {
  protocol: typeof PROTOCOL
  version: string
  type: string
  id: string
  correlationId: string | null
  appId: string
  nonce: number
  timestamp: string
  payload: Record<string, unknown>
}

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>

export class ChatBridgeSDK {
  private nonce = 0
  private appId: string
  private toolHandlers = new Map<string, ToolHandler>()
  private initialized = false
  private sessionId: string | null = null
  private restoredState: Record<string, unknown> | null = null
  private readyDisplayName: string | null = null
  private readyVersion: string | null = null

  constructor(appId: string) {
    this.appId = appId
    window.addEventListener('message', this.handleMessage)
  }

  // --- Lifecycle ---

  sendReady(displayName: string, version: string): void {
    this.readyDisplayName = displayName
    this.readyVersion = version
    this.send('READY', { displayName, version })
  }

  registerTools(tools: ToolDefinition[]): void {
    this.send('TOOL_REGISTER', { tools })
  }

  registerToolHandler(name: string, handler: ToolHandler): void {
    this.toolHandlers.set(name, handler)
  }

  // --- State ---

  sendStateUpdate(data: Record<string, unknown>, summary?: string, version?: number): void {
    this.send('STATE_UPDATE', { data, summary, version })
  }

  // --- Completion ---

  sendCompletion(reason: 'game_over' | 'task_done' | 'user_closed' | 'error', outcome?: Record<string, unknown>, summary?: string): void {
    this.send('COMPLETION', { reason, outcome, summary })
  }

  // --- UI ---

  requestResize(height: number): void {
    this.send('UI_RESIZE', { height })
  }

  // --- Vision ---

  sendVisionFrame(data: string, width: number, height: number, quality = 0.6): void {
    this.send('VISION_FRAME', { format: 'jpeg', data, width, height, quality })
  }

  // --- Error ---

  sendError(code: number, message: string, details?: unknown): void {
    this.send('ERROR', { code, message, details })
  }

  // --- Getters ---

  getSessionId(): string | null {
    return this.sessionId
  }

  getRestoredState(): Record<string, unknown> | null {
    return this.restoredState
  }

  // --- Cleanup ---

  destroy(): void {
    window.removeEventListener('message', this.handleMessage)
  }

  // --- Private ---

  private handleMessage = async (event: MessageEvent): Promise<void> => {
    const data = event.data
    if (data?.protocol !== PROTOCOL) return

    console.warn(`[ChatBridgeSDK] 📥 Received ${data.type} from platform`)

    switch (data.type) {
      case 'INIT': {
        this.sessionId = data.payload?.sessionId || null
        this.restoredState = data.payload?.restoredState || null
        this.initialized = true
        break
      }
      case 'TOOL_INVOKE': {
        const { toolName, toolCallId, params: toolParams } = data.payload as {
          toolName: string
          toolCallId: string
          params: Record<string, unknown>
        }
        const handler = this.toolHandlers.get(toolName)
        if (!handler) {
          this.send('TOOL_RESULT', { success: false, error: `Tool ${toolName} not found` }, toolCallId)
          return
        }
        try {
          const result = await handler(toolParams)
          this.send('TOOL_RESULT', { success: true, result }, toolCallId)
        } catch (err) {
          this.send('TOOL_RESULT', {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }, toolCallId)
        }
        break
      }
      case 'STATE_REQUEST': {
        // Subclasses should override to provide state
        break
      }
      case 'REQUEST_READY': {
        // Platform asked us to re-send READY (timing recovery)
        if (this.readyDisplayName && this.readyVersion) {
          this.send('READY', { displayName: this.readyDisplayName, version: this.readyVersion })
        }
        break
      }
      case 'HEARTBEAT_PING': {
        this.send('HEARTBEAT_PONG', {})
        break
      }
      case 'DESTROY': {
        this.destroy()
        break
      }
    }
  }

  private send(type: string, payload: Record<string, unknown>, correlationId: string | null = null): void {
    const msg: MessageEnvelope = {
      protocol: PROTOCOL,
      version: VERSION,
      type,
      id: crypto.randomUUID(),
      correlationId,
      appId: this.appId,
      nonce: this.nonce++,
      timestamp: new Date().toISOString(),
      payload,
    }
    console.warn(`[ChatBridgeSDK] 📤 Sending ${type} (appId: ${this.appId}, nonce: ${msg.nonce})`, window.parent === window ? '⚠️ NOT IN IFRAME' : '→ parent')
    window.parent.postMessage(msg, '*')
  }
}

export type { ToolDefinition, ToolHandler }
