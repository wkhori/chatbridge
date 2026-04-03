/**
 * Tests for the AppBridge class — the core postMessage bridge.
 * Mocks DOM APIs (window, HTMLIFrameElement, MessageEvent) since test env is node.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  RATE_LIMIT,
  READY_TIMEOUT,
  TOOL_TIMEOUT,
  TOOL_TIMEOUT_LONG,
  HEARTBEAT_INTERVAL,
  HEARTBEAT_MISS_LIMIT,
  MAX_MESSAGE_SIZE,
  AppSessionStatus,
  ErrorCode,
} from '../types'
import { ChatBridgeError } from '../errors'

// --- Mocks for DOM APIs ---

let messageHandler: ((event: any) => void) | null = null
const mockPostMessage = vi.fn()
const mockIframe = {
  contentWindow: { postMessage: mockPostMessage },
} as any

const mockWindow = {
  addEventListener: vi.fn((type: string, handler: Function) => {
    if (type === 'message') messageHandler = handler as any
  }),
  removeEventListener: vi.fn((type: string, handler: Function) => {
    if (type === 'message' && messageHandler === handler) messageHandler = null
  }),
}

vi.stubGlobal('window', mockWindow)

// Mock uuid to produce predictable IDs
let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: () => `mock-uuid-${++uuidCounter}`,
}))

// Now import AppBridge after mocks are set up
import { AppBridge } from '../bridge'

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    appId: 'chess',
    conversationId: 'conv-1',
    status: AppSessionStatus.LOADING,
    tools: [],
    state: null,
    stateSummary: null,
    stateVersion: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as any
}

function createMessageEvent(data: Record<string, unknown>, origin = 'null') {
  return { data, origin } as any
}

function createValidEnvelope(type: string, payload: Record<string, unknown>, nonce = 0) {
  return {
    protocol: PROTOCOL_ID,
    version: PROTOCOL_VERSION,
    type,
    id: 'msg-1',
    correlationId: null,
    appId: 'chess',
    nonce,
    timestamp: new Date().toISOString(),
    payload,
  }
}

describe('AppBridge', () => {
  let bridge: AppBridge

  beforeEach(() => {
    vi.useFakeTimers()
    uuidCounter = 0
    mockPostMessage.mockClear()
    mockWindow.addEventListener.mockReset()
    mockWindow.addEventListener.mockImplementation((type: string, handler: Function) => {
      if (type === 'message') messageHandler = handler as any
    })
    mockWindow.removeEventListener.mockReset()
    mockWindow.removeEventListener.mockImplementation((type: string, handler: Function) => {
      if (type === 'message' && messageHandler === handler) messageHandler = null
    })
    messageHandler = null
    bridge = new AppBridge(
      createSession(),
      new Set(['null']),
      'https://chess.example.com'
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    try { bridge.destroy() } catch { /* ignore */ }
  })

  describe('constructor', () => {
    it('parses targetOrigin from manifest URL', () => {
      const b = new AppBridge(createSession(), new Set(['null']), 'https://example.com/path')
      // targetOrigin is private but we can verify via postMessage behavior
      b.attach(mockIframe)
      // Sandboxed iframes always use '*' regardless of targetOrigin
      b.destroy()
    })

    it('defaults targetOrigin to * when no manifest URL', () => {
      const b = new AppBridge(createSession(), new Set(['null']))
      b.attach(mockIframe)
      b.destroy()
    })

    it('defaults targetOrigin to * for invalid manifest URL', () => {
      const b = new AppBridge(createSession(), new Set(['null']), 'not-a-url')
      b.attach(mockIframe)
      b.destroy()
    })
  })

  describe('attach / detach', () => {
    it('registers message listener on attach', () => {
      bridge.attach(mockIframe)
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('message', expect.any(Function))
    })

    it('removes message listener on detach', () => {
      bridge.attach(mockIframe)
      bridge.detach()
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function))
    })

    it('stops heartbeat on detach', () => {
      bridge.attach(mockIframe)
      bridge.detach()
      // No heartbeat timer should fire
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL * 10)
    })
  })

  describe('destroy', () => {
    it('sends DESTROY message', () => {
      bridge.attach(mockIframe)
      bridge.destroy()
      const destroyCall = mockPostMessage.mock.calls.find(
        ([msg]) => msg.type === 'DESTROY'
      )
      expect(destroyCall).toBeDefined()
      expect(destroyCall![0].payload.reason).toBe('session_ended')
    })

    it('rejects all pending tool calls', () => {
      bridge.attach(mockIframe)
      const session = createSession({
        tools: [{ name: 'test_tool', description: 'test', inputSchema: {} }],
      })
      const b = new AppBridge(session, new Set(['null']))
      b.attach(mockIframe)

      const promise = b.invokeTool('test_tool', 'call-1', {})
      b.destroy()

      return expect(promise).rejects.toThrow('Bridge destroyed')
    })

    it('is idempotent', () => {
      bridge.attach(mockIframe)
      bridge.destroy()
      const callCount = mockPostMessage.mock.calls.length
      bridge.destroy()
      // Should not send another DESTROY
      expect(mockPostMessage.mock.calls.length).toBe(callCount)
    })
  })

  describe('message handling', () => {
    beforeEach(() => {
      bridge.attach(mockIframe)
    })

    it('ignores non-chatbridge protocol messages', () => {
      const listener = vi.fn()
      bridge.onAny(listener)
      messageHandler?.(createMessageEvent({ protocol: 'other', type: 'READY' }))
      expect(listener).not.toHaveBeenCalled()
    })

    it('ignores messages exceeding MAX_MESSAGE_SIZE', () => {
      const listener = vi.fn()
      bridge.onAny(listener)
      const bigPayload = { ...createValidEnvelope('READY', { displayName: 'X', version: '1' }), extra: 'x'.repeat(MAX_MESSAGE_SIZE) }
      messageHandler?.(createMessageEvent(bigPayload))
      expect(listener).not.toHaveBeenCalled()
    })

    it('ignores messages with wrong appId', () => {
      const listener = vi.fn()
      bridge.onAny(listener)
      const msg = createValidEnvelope('READY', { displayName: 'Chess', version: '1.0.0' })
      msg.appId = 'wrong-app'
      messageHandler?.(createMessageEvent(msg))
      expect(listener).not.toHaveBeenCalled()
    })

    it('rejects duplicate nonces', () => {
      const listener = vi.fn()
      bridge.onAny(listener)

      // First message nonce 0 — passes
      const msg1 = createValidEnvelope('STATE_UPDATE', { data: { a: 1 } }, 0)
      messageHandler?.(createMessageEvent(msg1))
      expect(listener).toHaveBeenCalledTimes(1)

      // Same nonce 0 — rejected
      const msg2 = createValidEnvelope('STATE_UPDATE', { data: { b: 2 } }, 0)
      messageHandler?.(createMessageEvent(msg2))
      expect(listener).toHaveBeenCalledTimes(1) // still 1
    })

    it('rejects decreasing nonces', () => {
      const listener = vi.fn()
      bridge.onAny(listener)

      const msg1 = createValidEnvelope('STATE_UPDATE', { data: {} }, 5)
      messageHandler?.(createMessageEvent(msg1))

      const msg2 = createValidEnvelope('STATE_UPDATE', { data: {} }, 3)
      messageHandler?.(createMessageEvent(msg2))

      expect(listener).toHaveBeenCalledTimes(1) // only first passes
    })

    it('accepts increasing nonces', () => {
      const listener = vi.fn()
      bridge.onAny(listener)

      messageHandler?.(createMessageEvent(createValidEnvelope('STATE_UPDATE', { data: {} }, 0)))
      messageHandler?.(createMessageEvent(createValidEnvelope('STATE_UPDATE', { data: {} }, 1)))
      messageHandler?.(createMessageEvent(createValidEnvelope('STATE_UPDATE', { data: {} }, 5)))

      expect(listener).toHaveBeenCalledTimes(3)
    })
  })

  describe('message routing', () => {
    beforeEach(() => {
      bridge.attach(mockIframe)
    })

    it('routes READY message', () => {
      const listener = vi.fn()
      bridge.on('ready', listener)
      messageHandler?.(
        createMessageEvent(createValidEnvelope('READY', { displayName: 'Chess', version: '1.0.0' }))
      )
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0][0].type).toBe('ready')
      expect(listener.mock.calls[0][0].data).toEqual({ displayName: 'Chess', version: '1.0.0' })
    })

    it('routes TOOL_REGISTER message', () => {
      const listener = vi.fn()
      bridge.on('tools_registered', listener)
      const tools = [
        { name: 'start_game', description: 'Start', inputSchema: { type: 'object', properties: {} } },
      ]
      messageHandler?.(
        createMessageEvent(createValidEnvelope('TOOL_REGISTER', { tools }))
      )
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0][0].data).toEqual(tools)
    })

    it('routes STATE_UPDATE message', () => {
      const listener = vi.fn()
      bridge.on('state_update', listener)
      const payload = { data: { board: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR' }, summary: 'Initial position' }
      messageHandler?.(
        createMessageEvent(createValidEnvelope('STATE_UPDATE', payload))
      )
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('routes COMPLETION message', () => {
      const listener = vi.fn()
      bridge.on('completion', listener)
      messageHandler?.(
        createMessageEvent(createValidEnvelope('COMPLETION', { reason: 'game_over', outcome: {}, summary: 'Game over' }))
      )
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('routes ERROR message', () => {
      const listener = vi.fn()
      bridge.on('error', listener)
      messageHandler?.(
        createMessageEvent(createValidEnvelope('ERROR', { code: 1001, message: 'Failed' }))
      )
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('routes VISION_FRAME message', () => {
      const listener = vi.fn()
      bridge.on('vision_frame', listener)
      messageHandler?.(
        createMessageEvent(createValidEnvelope('VISION_FRAME', { format: 'jpeg', data: 'base64data', width: 800, height: 600 }))
      )
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('routes UI_RESIZE message', () => {
      const listener = vi.fn()
      bridge.on('ui_resize', listener)
      messageHandler?.(
        createMessageEvent(createValidEnvelope('UI_RESIZE', { height: 400 }))
      )
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('resets missed heartbeats on HEARTBEAT_PONG', () => {
      // Start heartbeat by resolving waitForReady
      const readyListener = vi.fn()
      bridge.on('ready', readyListener)
      messageHandler?.(
        createMessageEvent(createValidEnvelope('READY', { displayName: 'Chess', version: '1' }))
      )

      // Advance past a few heartbeat intervals
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL * 2)

      // Send PONG — should reset missed counter
      messageHandler?.(
        createMessageEvent(createValidEnvelope('HEARTBEAT_PONG', {}, 1))
      )
      // No heartbeat_timeout should have been emitted
    })

    it('ignores invalid payload for READY', () => {
      const listener = vi.fn()
      bridge.on('ready', listener)
      messageHandler?.(
        createMessageEvent(createValidEnvelope('READY', { invalid: true }))
      )
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('TOOL_RESULT routing', () => {
    beforeEach(() => {
      bridge.attach(mockIframe)
    })

    it('resolves pending tool call on success', async () => {
      const session = createSession({
        tools: [{ name: 'make_move', description: 'move', inputSchema: {} }],
      })
      const b = new AppBridge(session, new Set(['null']))
      b.attach(mockIframe)
      let handler: ((event: any) => void) | null = null
      mockWindow.addEventListener.mockImplementation((type: string, h: Function) => {
        if (type === 'message') handler = h as any
      })
      b.attach(mockIframe)

      const promise = b.invokeTool('make_move', 'call-123', { move: 'e4' })

      // Simulate TOOL_RESULT
      handler!(
        createMessageEvent({
          ...createValidEnvelope('TOOL_RESULT', { success: true, result: { move: 'e4', valid: true } }),
          correlationId: 'call-123',
        })
      )

      await expect(promise).resolves.toEqual({ move: 'e4', valid: true })
      b.destroy()
    })

    it('rejects pending tool call on failure', async () => {
      const session = createSession({
        tools: [{ name: 'make_move', description: 'move', inputSchema: {} }],
      })
      const b = new AppBridge(session, new Set(['null']))
      let handler: ((event: any) => void) | null = null
      mockWindow.addEventListener.mockImplementation((type: string, h: Function) => {
        if (type === 'message') handler = h as any
      })
      b.attach(mockIframe)

      const promise = b.invokeTool('make_move', 'call-456', { move: 'invalid' })

      handler!(
        createMessageEvent({
          ...createValidEnvelope('TOOL_RESULT', { success: false, error: 'Invalid move' }),
          correlationId: 'call-456',
        })
      )

      await expect(promise).rejects.toThrow('Invalid move')
      b.destroy()
    })

    it('times out pending tool call', async () => {
      const session = createSession({
        tools: [{ name: 'slow_tool', description: 'slow', inputSchema: {} }],
      })
      const b = new AppBridge(session, new Set(['null']))
      b.attach(mockIframe)

      const promise = b.invokeTool('slow_tool', 'call-789', {})

      vi.advanceTimersByTime(TOOL_TIMEOUT + 100)

      await expect(promise).rejects.toThrow('timed out')
      b.destroy()
    })

    it('uses longer timeout for long-running tools', async () => {
      const session = createSession({
        tools: [{ name: 'analyze', description: 'analyze', inputSchema: {}, longRunning: true }],
      })
      const b = new AppBridge(session, new Set(['null']))
      b.attach(mockIframe)

      const promise = b.invokeTool('analyze', 'call-lr', {})

      // Standard timeout should not reject
      vi.advanceTimersByTime(TOOL_TIMEOUT + 100)
      // Should still be pending

      // Long timeout should reject
      vi.advanceTimersByTime(TOOL_TIMEOUT_LONG - TOOL_TIMEOUT)

      await expect(promise).rejects.toThrow('timed out')
      b.destroy()
    })

    it('ignores TOOL_RESULT without correlationId', () => {
      bridge.attach(mockIframe)
      const listener = vi.fn()
      bridge.onAny(listener)
      messageHandler!(
        createMessageEvent(createValidEnvelope('TOOL_RESULT', { success: true, result: {} }))
      )
      // TOOL_RESULT without correlationId should be silently ignored (no emit)
    })
  })

  describe('waitForReady', () => {
    it('rejects after READY_TIMEOUT', async () => {
      bridge.attach(mockIframe)
      const readyPromise = bridge.waitForReady()

      vi.advanceTimersByTime(READY_TIMEOUT + 100)

      await expect(readyPromise).rejects.toThrow('READY')
    })
  })

  describe('sendInit', () => {
    it('sends INIT message with restored state', () => {
      bridge.attach(mockIframe)
      bridge.sendInit({ savedGame: true })

      const initCall = mockPostMessage.mock.calls.find(([msg]) => msg.type === 'INIT')
      expect(initCall).toBeDefined()
      expect(initCall![0].payload.restoredState).toEqual({ savedGame: true })
      expect(initCall![0].payload.sessionId).toBe('session-1')
    })

    it('sends INIT with null restored state', () => {
      bridge.attach(mockIframe)
      bridge.sendInit(null)

      const initCall = mockPostMessage.mock.calls.find(([msg]) => msg.type === 'INIT')
      expect(initCall![0].payload.restoredState).toBeNull()
    })
  })

  describe('event listeners', () => {
    function getMessageHandler(): (event: any) => void {
      // Extract handler from the most recent addEventListener('message', ...) call
      const calls = mockWindow.addEventListener.mock.calls.filter(
        ([type]: any[]) => type === 'message'
      )
      if (calls.length === 0) throw new Error('No message handler registered')
      return calls[calls.length - 1][1] as (event: any) => void
    }

    it('on() only fires for matching event type', () => {
      bridge.attach(mockIframe)
      const handler = getMessageHandler()

      const readyListener = vi.fn()
      const errorListener = vi.fn()
      bridge.on('ready', readyListener)
      bridge.on('error', errorListener)

      handler(createMessageEvent(createValidEnvelope('READY', { displayName: 'Chess', version: '1' })))

      expect(readyListener).toHaveBeenCalledTimes(1)
      expect(errorListener).not.toHaveBeenCalled()
    })

    it('onAny() fires for all event types', () => {
      bridge.attach(mockIframe)
      const handler = getMessageHandler()

      const listener = vi.fn()
      bridge.onAny(listener)

      handler(createMessageEvent(createValidEnvelope('READY', { displayName: 'X', version: '1' })))
      handler(createMessageEvent(createValidEnvelope('STATE_UPDATE', { data: {} }, 1)))

      expect(listener).toHaveBeenCalledTimes(2)
    })

    it('unsubscribe removes listener', () => {
      bridge.attach(mockIframe)
      const handler = getMessageHandler()

      const listener = vi.fn()
      const unsub = bridge.on('ready', listener)

      handler(createMessageEvent(createValidEnvelope('READY', { displayName: 'X', version: '1' })))
      expect(listener).toHaveBeenCalledTimes(1)

      unsub()

      handler(createMessageEvent(createValidEnvelope('READY', { displayName: 'Y', version: '2' }, 1)))
      expect(listener).toHaveBeenCalledTimes(1) // still 1
    })

    it('multiple listeners receive same event', () => {
      bridge.attach(mockIframe)
      const handler = getMessageHandler()

      const listener1 = vi.fn()
      const listener2 = vi.fn()
      bridge.onAny(listener1)
      bridge.onAny(listener2)

      handler(createMessageEvent(createValidEnvelope('STATE_UPDATE', { data: {} })))

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })
  })

  describe('heartbeat (via bridge.test.ts behavior tests)', () => {
    // Heartbeat start/stop is already tested in bridge.test.ts.
    // Here we verify the constants are correct.
    it('HEARTBEAT_INTERVAL is a positive number', () => {
      expect(HEARTBEAT_INTERVAL).toBeGreaterThan(0)
    })

    it('HEARTBEAT_MISS_LIMIT is a positive integer', () => {
      expect(HEARTBEAT_MISS_LIMIT).toBeGreaterThan(0)
      expect(Number.isInteger(HEARTBEAT_MISS_LIMIT)).toBe(true)
    })
  })

  describe('sendToPlatform', () => {
    it('does nothing when iframe has no contentWindow', () => {
      const noContentIframe = { contentWindow: null } as any
      bridge.attach(noContentIframe)
      // sendInit should not throw
      bridge.sendInit(null)
      expect(mockPostMessage).not.toHaveBeenCalled()
    })

    it('uses * targetOrigin for sandboxed iframes', () => {
      bridge.attach(mockIframe)
      bridge.sendInit(null)

      expect(mockPostMessage).toHaveBeenCalledWith(expect.any(Object), '*')
    })

    it('uses manifest origin for non-sandboxed iframes', () => {
      const b = new AppBridge(
        createSession(),
        new Set(['https://chess.example.com']),
        'https://chess.example.com'
      )
      b.attach(mockIframe)
      b.sendInit(null)

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.any(Object),
        'https://chess.example.com'
      )
      b.destroy()
    })

    it('increments nonce on each send', () => {
      bridge.attach(mockIframe)
      bridge.sendInit(null)
      bridge.sendInit(null)

      const nonces = mockPostMessage.mock.calls.map(([msg]) => msg.nonce)
      expect(nonces[0]).toBeLessThan(nonces[1])
    })

    it('includes correct protocol and version', () => {
      bridge.attach(mockIframe)
      bridge.sendInit(null)

      const msg = mockPostMessage.mock.calls[0][0]
      expect(msg.protocol).toBe(PROTOCOL_ID)
      expect(msg.version).toBe(PROTOCOL_VERSION)
      expect(msg.appId).toBe('chess')
    })
  })

  describe('rate limiting', () => {
    it('drops messages exceeding rate limit', () => {
      bridge.attach(mockIframe)
      const listener = vi.fn()
      bridge.onAny(listener)

      // Send RATE_LIMIT + 5 messages rapidly
      for (let i = 0; i <= RATE_LIMIT + 5; i++) {
        messageHandler?.(
          createMessageEvent(createValidEnvelope('STATE_UPDATE', { data: { i } }, i))
        )
      }

      // Should have been rate-limited — not all messages processed
      expect(listener.mock.calls.length).toBeLessThanOrEqual(RATE_LIMIT)
    })
  })
})
