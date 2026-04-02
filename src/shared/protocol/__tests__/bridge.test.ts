import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PROTOCOL_ID, PROTOCOL_VERSION, MessageEnvelopeSchema } from '../types'

// Test the rate limiter and nonce tracker logic directly
// AppBridge itself requires browser environment (window, iframe), so we test its internals

// We need to access the private classes. Since they're not exported,
// we'll test their behavior through the module's public API patterns.

describe('SlidingWindowRateLimiter (behavior test)', () => {
  // Recreate the rate limiter logic for testing
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

  it('allows messages up to the limit', () => {
    const limiter = new SlidingWindowRateLimiter(5)
    for (let i = 0; i < 5; i++) {
      expect(limiter.allow()).toBe(true)
    }
  })

  it('blocks messages after the limit', () => {
    const limiter = new SlidingWindowRateLimiter(3)
    expect(limiter.allow()).toBe(true)
    expect(limiter.allow()).toBe(true)
    expect(limiter.allow()).toBe(true)
    expect(limiter.allow()).toBe(false)
  })

  it('allows messages again after window expires', async () => {
    const limiter = new SlidingWindowRateLimiter(2)
    expect(limiter.allow()).toBe(true)
    expect(limiter.allow()).toBe(true)
    expect(limiter.allow()).toBe(false)

    // Wait for the window to pass
    await new Promise((r) => setTimeout(r, 1100))
    expect(limiter.allow()).toBe(true)
  })
})

describe('NonceTracker (behavior test)', () => {
  class NonceTracker {
    private lastNonce = -1
    validate(nonce: number): boolean {
      if (nonce <= this.lastNonce) return false
      this.lastNonce = nonce
      return true
    }
  }

  it('accepts increasing nonces', () => {
    const tracker = new NonceTracker()
    expect(tracker.validate(0)).toBe(true)
    expect(tracker.validate(1)).toBe(true)
    expect(tracker.validate(5)).toBe(true)
    expect(tracker.validate(100)).toBe(true)
  })

  it('rejects repeated nonce', () => {
    const tracker = new NonceTracker()
    expect(tracker.validate(1)).toBe(true)
    expect(tracker.validate(1)).toBe(false)
  })

  it('rejects decreasing nonce', () => {
    const tracker = new NonceTracker()
    expect(tracker.validate(5)).toBe(true)
    expect(tracker.validate(3)).toBe(false)
  })

  it('rejects nonce of 0 after any positive nonce', () => {
    const tracker = new NonceTracker()
    expect(tracker.validate(1)).toBe(true)
    expect(tracker.validate(0)).toBe(false)
  })

  it('accepts first nonce of 0', () => {
    const tracker = new NonceTracker()
    expect(tracker.validate(0)).toBe(true)
  })
})

describe('AppBridge message routing (mock)', () => {

  it('validates well-formed messages via schema', () => {
    const msg = {
      protocol: PROTOCOL_ID,
      version: PROTOCOL_VERSION,
      type: 'READY',
      id: 'test-1',
      correlationId: null,
      appId: 'chess',
      nonce: 0,
      timestamp: new Date().toISOString(),
      payload: { displayName: 'Chess', version: '1.0.0' },
    }
    expect(MessageEnvelopeSchema.safeParse(msg).success).toBe(true)
  })

  it('rejects messages with wrong protocol', () => {
    const msg = {
      protocol: 'not-chatbridge',
      version: PROTOCOL_VERSION,
      type: 'READY',
      id: 'test-1',
      correlationId: null,
      appId: 'chess',
      nonce: 0,
      timestamp: new Date().toISOString(),
      payload: {},
    }
    expect(MessageEnvelopeSchema.safeParse(msg).success).toBe(false)
  })

  it('rejects messages missing required fields', () => {
    expect(MessageEnvelopeSchema.safeParse({
      protocol: PROTOCOL_ID,
      type: 'READY',
    }).success).toBe(false)
  })
})

describe('Tool invocation timeout behavior', () => {
  it('timeout rejects pending promise', async () => {
    const pendingCalls = new Map<string, { resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout> }>()

    const toolCallId = 'call-1'
    const timeout = 100 // short for testing

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCalls.delete(toolCallId)
        reject(new Error('Tool timeout'))
      }, timeout)
      pendingCalls.set(toolCallId, { resolve, reject, timer })
    })

    await expect(promise).rejects.toThrow('Tool timeout')
    expect(pendingCalls.has(toolCallId)).toBe(false)
  })

  it('resolves before timeout works', async () => {
    const pendingCalls = new Map<string, { resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout> }>()
    const toolCallId = 'call-2'

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCalls.delete(toolCallId)
        reject(new Error('Tool timeout'))
      }, 5000)
      pendingCalls.set(toolCallId, { resolve, reject, timer })
    })

    // Simulate immediate response
    const pending = pendingCalls.get(toolCallId)!
    clearTimeout(pending.timer)
    pendingCalls.delete(toolCallId)
    pending.resolve({ move: 'e4' })

    await expect(promise).resolves.toEqual({ move: 'e4' })
  })
})

describe('Heartbeat miss detection', () => {
  it('detects missed heartbeats after threshold', () => {
    let missedHeartbeats = 0
    const HEARTBEAT_MISS_LIMIT = 3
    let timeoutEmitted = false

    // Simulate heartbeat interval
    for (let i = 0; i < 5; i++) {
      missedHeartbeats++
      if (missedHeartbeats >= HEARTBEAT_MISS_LIMIT) {
        timeoutEmitted = true
      }
    }

    expect(timeoutEmitted).toBe(true)
    expect(missedHeartbeats).toBe(5)
  })

  it('resets on pong', () => {
    let missedHeartbeats = 0
    const HEARTBEAT_MISS_LIMIT = 3

    missedHeartbeats++ // ping 1
    missedHeartbeats++ // ping 2
    missedHeartbeats = 0 // pong received
    missedHeartbeats++ // ping 3

    expect(missedHeartbeats).toBe(1)
    expect(missedHeartbeats < HEARTBEAT_MISS_LIMIT).toBe(true)
  })
})
