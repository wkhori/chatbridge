import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub browser globals before importing the module under test
const mockWindow = {
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}
vi.stubGlobal('window', mockWindow)
vi.stubGlobal(
  'CustomEvent',
  class CustomEvent {
    type: string
    detail: unknown
    constructor(type: string, opts?: { detail?: unknown }) {
      this.type = type
      this.detail = opts?.detail
    }
  },
)

// Import after globals are in place
import { CHATBRIDGE_EVENTS, dispatchChatBridgeEvent, onChatBridgeEvent } from '../events'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// CHATBRIDGE_EVENTS constants
// ---------------------------------------------------------------------------
describe('CHATBRIDGE_EVENTS', () => {
  it('has correct ACTION_SUGGESTION_CLICK value', () => {
    expect(CHATBRIDGE_EVENTS.ACTION_SUGGESTION_CLICK).toBe('chatbridge:action-suggestion-click')
  })

  it('has correct LAUNCH_APP value', () => {
    expect(CHATBRIDGE_EVENTS.LAUNCH_APP).toBe('chatbridge:launch-app')
  })
})

// ---------------------------------------------------------------------------
// dispatchChatBridgeEvent
// ---------------------------------------------------------------------------
describe('dispatchChatBridgeEvent', () => {
  it('creates a CustomEvent and dispatches it on window', () => {
    dispatchChatBridgeEvent('chatbridge:launch-app', { appId: 'chess' })

    expect(mockWindow.dispatchEvent).toHaveBeenCalledTimes(1)

    const dispatched = mockWindow.dispatchEvent.mock.calls[0][0]
    expect(dispatched).toBeInstanceOf(CustomEvent)
    expect(dispatched.type).toBe('chatbridge:launch-app')
  })

  it('passes correct detail', () => {
    const detail = { appId: 'chess', extra: 42 }
    dispatchChatBridgeEvent('chatbridge:launch-app', detail)

    const dispatched = mockWindow.dispatchEvent.mock.calls[0][0]
    expect(dispatched.detail).toEqual(detail)
  })
})

// ---------------------------------------------------------------------------
// onChatBridgeEvent
// ---------------------------------------------------------------------------
describe('onChatBridgeEvent', () => {
  it('adds event listener on window', () => {
    const handler = vi.fn()
    onChatBridgeEvent('chatbridge:launch-app', handler)

    expect(mockWindow.addEventListener).toHaveBeenCalledTimes(1)
    expect(mockWindow.addEventListener).toHaveBeenCalledWith('chatbridge:launch-app', expect.any(Function))
  })

  it('handler receives detail from event', () => {
    const handler = vi.fn()
    onChatBridgeEvent('chatbridge:launch-app', handler)

    // Simulate the browser calling the registered listener
    const registeredListener = mockWindow.addEventListener.mock.calls[0][1] as (e: Event) => void
    const fakeEvent = new CustomEvent('chatbridge:launch-app', { detail: { appId: 'chess' } })
    registeredListener(fakeEvent as unknown as Event)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ appId: 'chess' })
  })

  it('returns an unsubscribe function that removes the listener', () => {
    const handler = vi.fn()
    const unsubscribe = onChatBridgeEvent('chatbridge:launch-app', handler)

    expect(typeof unsubscribe).toBe('function')

    // The same listener reference must be passed to removeEventListener
    const registeredListener = mockWindow.addEventListener.mock.calls[0][1]
    unsubscribe()

    expect(mockWindow.removeEventListener).toHaveBeenCalledTimes(1)
    expect(mockWindow.removeEventListener).toHaveBeenCalledWith('chatbridge:launch-app', registeredListener)
  })

  it('supports multiple listeners for the same event type', () => {
    const handlerA = vi.fn()
    const handlerB = vi.fn()

    onChatBridgeEvent('chatbridge:launch-app', handlerA)
    onChatBridgeEvent('chatbridge:launch-app', handlerB)

    expect(mockWindow.addEventListener).toHaveBeenCalledTimes(2)

    // Each call registers a distinct listener
    const listenerA = mockWindow.addEventListener.mock.calls[0][1] as (e: Event) => void
    const listenerB = mockWindow.addEventListener.mock.calls[1][1] as (e: Event) => void
    expect(listenerA).not.toBe(listenerB)
  })
})
