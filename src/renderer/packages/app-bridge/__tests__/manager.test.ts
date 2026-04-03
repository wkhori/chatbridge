/**
 * Tests for AppBridgeManager — session lifecycle, manifest management,
 * bridge attachment, tool invocation, event handling, cleanup.
 *
 * Since AppBridgeManager depends on AppBridge (which needs DOM), we mock
 * the bridge module and test the manager's logic in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppManifest, ToolSchema } from '@shared/protocol/types'
import { AppSessionStatus, ErrorCode } from '@shared/protocol/types'
import { ChatBridgeError } from '@shared/protocol/errors'
import { AppBridge, type BridgeEvent } from '@shared/protocol/bridge'

// --- Mocks ---

vi.mock('uuid', () => ({ v4: () => `uuid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }))

const mockBridgeInstances: any[] = []

vi.mock('@shared/protocol/bridge', () => ({
  AppBridge: vi.fn(function (this: any, session: any) {
    this.attach = vi.fn()
    this.detach = vi.fn()
    this.destroy = vi.fn()
    this.onAny = vi.fn((cb: Function) => { this._onAnyCallback = cb; return () => {} })
    this.waitForReady = vi.fn(() => Promise.resolve())
    this.sendInit = vi.fn()
    this.invokeTool = vi.fn(() => Promise.resolve({ result: 'ok' }))
    this.session = session
    mockBridgeInstances.push(this)
  }),
}))

// Stub window for AppBridge construction
vi.stubGlobal('window', {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})

import { appBridgeManager } from '../manager'

// --- Helpers ---

function makeManifest(overrides: Partial<AppManifest> = {}): AppManifest {
  return {
    id: 'test-app',
    name: 'Test App',
    version: '1.0.0',
    description: 'Test',
    url: 'https://example.com',
    permissions: ['state_push'],
    auth: { type: 'none' },
    ...overrides,
  } as AppManifest
}

function makeIframe(): any {
  return { contentWindow: {} }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => queueMicrotask(r))
}

// --- Tests ---

describe('AppBridgeManager', () => {
  beforeEach(() => {
    appBridgeManager.destroyAll()
    mockBridgeInstances.length = 0
    // Clear manifests by registering nothing (manager has no "clear manifests" method)
    // We rely on destroyAll clearing sessions/bridges. Manifests accumulate but that's ok.
  })

  // ================================================================
  // 1. Manifest Management
  // ================================================================

  describe('Manifest Management', () => {
    it('stores and retrieves manifest', () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      expect(appBridgeManager.getManifest('chess')).toBe(m)
    })

    it('returns undefined for unknown ID', () => {
      expect(appBridgeManager.getManifest('nonexistent')).toBeUndefined()
    })

    it('getAllManifests returns all registered', () => {
      const m1 = makeManifest({ id: 'chess' })
      const m2 = makeManifest({ id: 'whiteboard' })
      appBridgeManager.registerManifest(m1)
      appBridgeManager.registerManifest(m2)
      const all = appBridgeManager.getAllManifests()
      expect(all['chess']).toBe(m1)
      expect(all['whiteboard']).toBe(m2)
    })

    it('overwrites manifest with same ID', () => {
      const m1 = makeManifest({ id: 'chess', name: 'Old' })
      const m2 = makeManifest({ id: 'chess', name: 'New' })
      appBridgeManager.registerManifest(m1)
      appBridgeManager.registerManifest(m2)
      expect(appBridgeManager.getManifest('chess')!.name).toBe('New')
    })
  })

  // ================================================================
  // 2. Session Management
  // ================================================================

  describe('Session Management', () => {
    it('creates session with LOADING status', () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')

      expect(session.appId).toBe('chess')
      expect(session.conversationId).toBe('conv-1')
      expect(session.status).toBe(AppSessionStatus.LOADING)
      expect(session.tools).toEqual([])
      expect(session.state).toBeNull()
      expect(session.id).toBeTruthy()
    })

    it('creates sessions with unique IDs', () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const s1 = appBridgeManager.createSession(m, 'conv-1')
      const s2 = appBridgeManager.createSession(m, 'conv-1')
      expect(s1.id).not.toBe(s2.id)
    })

    it('getSession retrieves by ID', () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')
      expect(appBridgeManager.getSession(session.id)).toBe(session)
    })

    it('getSession returns undefined for unknown ID', () => {
      expect(appBridgeManager.getSession('nonexistent')).toBeUndefined()
    })

    it('getAllSessions returns all sessions', () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      appBridgeManager.createSession(m, 'conv-1')
      appBridgeManager.createSession(m, 'conv-2')
      expect(appBridgeManager.getAllSessions()).toHaveLength(2)
    })

    it('getSessionsForConversation filters correctly', () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      appBridgeManager.createSession(m, 'conv-1')
      appBridgeManager.createSession(m, 'conv-2')
      appBridgeManager.createSession(m, 'conv-1')

      expect(appBridgeManager.getSessionsForConversation('conv-1')).toHaveLength(2)
      expect(appBridgeManager.getSessionsForConversation('conv-2')).toHaveLength(1)
      expect(appBridgeManager.getSessionsForConversation('conv-3')).toHaveLength(0)
    })

    it('notifies listeners on session creation', () => {
      const listener = vi.fn()
      appBridgeManager.onSessionChange(listener)
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      appBridgeManager.createSession(m, 'conv-1')
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0][0].appId).toBe('chess')
    })
  })

  // ================================================================
  // 3. Bridge Management
  // ================================================================

  describe('Bridge Management', () => {
    it('attachBridge creates bridge and calls attach/onAny', async () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')
      const iframe = makeIframe()

      appBridgeManager.attachBridge(session.id, iframe)

      expect(mockBridgeInstances).toHaveLength(1)
      const bridge = mockBridgeInstances[0]
      expect(bridge.attach).toHaveBeenCalledWith(iframe)
      expect(bridge.onAny).toHaveBeenCalled()
    })

    it('attachBridge updates session to READY on success', async () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')

      appBridgeManager.attachBridge(session.id, makeIframe())
      await flushMicrotasks()
      await flushMicrotasks()

      expect(session.status).toBe(AppSessionStatus.READY)
    })

    it('attachBridge calls sendInit after READY', async () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')

      appBridgeManager.attachBridge(session.id, makeIframe())
      await flushMicrotasks()
      await flushMicrotasks()

      const bridge = mockBridgeInstances[0]
      expect(bridge.sendInit).toHaveBeenCalled()
    })

    it('attachBridge sets ERROR on waitForReady failure', async () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')

      // Make waitForReady reject
      vi.mocked(AppBridge).mockImplementationOnce(
        function (this: any, s: any) {
          this.attach = vi.fn()
          this.detach = vi.fn()
          this.destroy = vi.fn()
          this.onAny = vi.fn(() => () => {})
          this.waitForReady = vi.fn(() => Promise.reject(new Error('timeout')))
          this.sendInit = vi.fn()
          this.session = s
          mockBridgeInstances.push(this)
        } as any
      )

      appBridgeManager.attachBridge(session.id, makeIframe())
      await flushMicrotasks()
      await flushMicrotasks()

      expect(session.status).toBe(AppSessionStatus.ERROR)
    })

    it('attachBridge does nothing for unknown session', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      appBridgeManager.attachBridge('nonexistent', makeIframe())
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('attachBridge cleans up existing bridge', async () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')

      appBridgeManager.attachBridge(session.id, makeIframe())
      const firstBridge = mockBridgeInstances[0]

      appBridgeManager.attachBridge(session.id, makeIframe())
      expect(firstBridge.detach).toHaveBeenCalled()
    })

    it('detachBridge destroys and removes bridge', async () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')
      appBridgeManager.attachBridge(session.id, makeIframe())

      appBridgeManager.detachBridge(session.id)
      expect(mockBridgeInstances[0].destroy).toHaveBeenCalled()
      expect(appBridgeManager.getBridge(session.id)).toBeUndefined()
    })

    it('detachBridge is no-op for unknown session', () => {
      appBridgeManager.detachBridge('nonexistent') // should not throw
    })

    it('getBridge returns bridge or undefined', () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')

      expect(appBridgeManager.getBridge(session.id)).toBeUndefined()
      appBridgeManager.attachBridge(session.id, makeIframe())
      expect(appBridgeManager.getBridge(session.id)).toBeDefined()
    })

    it('getBridgeByAppId finds active bridge', () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')
      appBridgeManager.attachBridge(session.id, makeIframe())

      const result = appBridgeManager.getBridgeByAppId('chess')
      expect(result).toBeDefined()
      expect(result!.session.appId).toBe('chess')
    })

    it('getBridgeByAppId returns undefined when no match', () => {
      expect(appBridgeManager.getBridgeByAppId('nonexistent')).toBeUndefined()
    })
  })

  // ================================================================
  // 4. Tool Invocation
  // ================================================================

  describe('Tool Invocation', () => {
    it('throws NOT_READY when no bridge', async () => {
      await expect(
        appBridgeManager.invokeTool('chess', 'move', 'call-1', {})
      ).rejects.toThrow('No active bridge')
    })

    it('throws NOT_READY when session not ready', async () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')
      appBridgeManager.attachBridge(session.id, makeIframe())
      // Session is LOADING, not READY yet (before waitForReady resolves)

      await expect(
        appBridgeManager.invokeTool('chess', 'move', 'call-1', {})
      ).rejects.toThrow('cannot invoke tools')
    })

    it('delegates to bridge.invokeTool when ready', async () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')
      appBridgeManager.attachBridge(session.id, makeIframe())
      await flushMicrotasks()
      await flushMicrotasks()

      const result = await appBridgeManager.invokeTool('chess', 'start_game', 'call-1', { color: 'white' })
      expect(result).toEqual({ result: 'ok' })
      expect(mockBridgeInstances[0].invokeTool).toHaveBeenCalledWith('start_game', 'call-1', { color: 'white' })
    })

    it('transitions session to ACTIVE on invocation', async () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')
      appBridgeManager.attachBridge(session.id, makeIframe())
      await flushMicrotasks()
      await flushMicrotasks()

      await appBridgeManager.invokeTool('chess', 'move', 'call-1', {})
      expect(session.status).toBe(AppSessionStatus.ACTIVE)
    })
  })

  // ================================================================
  // 5. Event Handling
  // ================================================================

  describe('Event Handling (handleBridgeEvent)', () => {
    async function setupWithBridge(appId = 'chess') {
      const m = makeManifest({ id: appId })
      appBridgeManager.registerManifest(m)
      const session = appBridgeManager.createSession(m, 'conv-1')
      appBridgeManager.attachBridge(session.id, makeIframe())
      await flushMicrotasks()
      await flushMicrotasks()
      const bridge = mockBridgeInstances[mockBridgeInstances.length - 1]
      return { session, bridge }
    }

    function emitBridgeEvent(bridge: any, type: string, data: unknown) {
      bridge._onAnyCallback?.({
        type,
        appId: bridge.session.appId,
        sessionId: bridge.session.id,
        data,
      })
    }

    it('tools_registered updates session tools', async () => {
      const { session, bridge } = await setupWithBridge()
      const tools: ToolSchema[] = [
        { name: 'start_game', description: 'Start', inputSchema: { type: 'object', properties: {} } },
      ]
      emitBridgeEvent(bridge, 'tools_registered', tools)
      expect(session.tools).toEqual(tools)
    })

    it('state_update updates session state and summary', async () => {
      const { session, bridge } = await setupWithBridge()
      emitBridgeEvent(bridge, 'state_update', {
        data: { board: 'initial' },
        summary: 'Game started',
        version: 1,
      })
      expect(session.state).toEqual({ board: 'initial' })
      expect(session.stateSummary).toBe('Game started')
      expect(session.stateVersion).toBe(1)
    })

    it('state_update preserves existing summary when none provided', async () => {
      const { session, bridge } = await setupWithBridge()
      emitBridgeEvent(bridge, 'state_update', {
        data: { board: 'initial' },
        summary: 'First',
      })
      emitBridgeEvent(bridge, 'state_update', {
        data: { board: 'updated' },
      })
      expect(session.stateSummary).toBe('First')
    })

    it('state_update increments version when none provided', async () => {
      const { session, bridge } = await setupWithBridge()
      emitBridgeEvent(bridge, 'state_update', { data: {} })
      expect(session.stateVersion).toBe(1)
      emitBridgeEvent(bridge, 'state_update', { data: {} })
      expect(session.stateVersion).toBe(2)
    })

    it('completion sets COMPLETED status', async () => {
      const { session, bridge } = await setupWithBridge()
      emitBridgeEvent(bridge, 'completion', { reason: 'game_over' })
      expect(session.status).toBe(AppSessionStatus.COMPLETED)
    })

    it('error logs to console.error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { bridge } = await setupWithBridge()
      emitBridgeEvent(bridge, 'error', { code: 1001, message: 'Something failed' })
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it('heartbeat_timeout logs warning', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { bridge } = await setupWithBridge()
      emitBridgeEvent(bridge, 'heartbeat_timeout', { missedCount: 3 })
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  // ================================================================
  // 6. Listeners
  // ================================================================

  describe('Session Change Listeners', () => {
    it('listener called on session creation', () => {
      const listener = vi.fn()
      appBridgeManager.onSessionChange(listener)
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      appBridgeManager.createSession(m, 'conv-1')
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('unsubscribe removes listener', () => {
      const listener = vi.fn()
      const unsub = appBridgeManager.onSessionChange(listener)
      unsub()
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      appBridgeManager.createSession(m, 'conv-1')
      expect(listener).not.toHaveBeenCalled()
    })

    it('multiple listeners all notified', () => {
      const l1 = vi.fn()
      const l2 = vi.fn()
      appBridgeManager.onSessionChange(l1)
      appBridgeManager.onSessionChange(l2)
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      appBridgeManager.createSession(m, 'conv-1')
      expect(l1).toHaveBeenCalledTimes(1)
      expect(l2).toHaveBeenCalledTimes(1)
    })
  })

  // ================================================================
  // 7. Cleanup
  // ================================================================

  describe('Cleanup', () => {
    it('destroyConversationSessions destroys all sessions for conversation', async () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      const s1 = appBridgeManager.createSession(m, 'conv-1')
      const s2 = appBridgeManager.createSession(m, 'conv-1')
      const s3 = appBridgeManager.createSession(m, 'conv-2')

      appBridgeManager.attachBridge(s1.id, makeIframe())
      appBridgeManager.attachBridge(s2.id, makeIframe())

      appBridgeManager.destroyConversationSessions('conv-1')

      expect(s1.status).toBe(AppSessionStatus.DESTROYED)
      expect(s2.status).toBe(AppSessionStatus.DESTROYED)
      expect(s3.status).not.toBe(AppSessionStatus.DESTROYED)
    })

    it('destroyAll clears all bridges and sessions', () => {
      const m = makeManifest({ id: 'chess' })
      appBridgeManager.registerManifest(m)
      appBridgeManager.createSession(m, 'conv-1')
      appBridgeManager.createSession(m, 'conv-2')

      appBridgeManager.destroyAll()

      expect(appBridgeManager.getAllSessions()).toHaveLength(0)
    })
  })
})
