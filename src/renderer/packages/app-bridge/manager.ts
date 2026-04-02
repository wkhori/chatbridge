import { v4 as uuid } from 'uuid'
import { AppBridge, type BridgeEvent } from '@shared/protocol/bridge'
import {
  type AppManifest,
  type AppSession,
  AppSessionStatus,
  type ToolSchema,
} from '@shared/protocol/types'

type SessionListener = (session: AppSession) => void

/**
 * AppBridgeManager — singleton that manages all app bridge instances.
 * Connects iframe lifecycle to app sessions and tool registration.
 */
class AppBridgeManager {
  private bridges = new Map<string, AppBridge>()
  private sessionListeners = new Set<SessionListener>()
  private sessions = new Map<string, AppSession>()
  private manifests = new Map<string, AppManifest>()

  // --- Manifest Management ---

  registerManifest(manifest: AppManifest): void {
    this.manifests.set(manifest.id, manifest)
  }

  getManifest(appId: string): AppManifest | undefined {
    return this.manifests.get(appId)
  }

  getAllManifests(): Record<string, AppManifest> {
    return Object.fromEntries(this.manifests)
  }

  // --- Session Management ---

  createSession(manifest: AppManifest, conversationId: string): AppSession {
    const session: AppSession = {
      id: uuid(),
      appId: manifest.id,
      conversationId,
      status: AppSessionStatus.LOADING,
      tools: manifest.tools || [],
      state: null,
      stateSummary: null,
      stateVersion: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.sessions.set(session.id, session)
    this.notifyListeners(session)
    return session
  }

  getSession(sessionId: string): AppSession | undefined {
    return this.sessions.get(sessionId)
  }

  getAllSessions(): AppSession[] {
    return Array.from(this.sessions.values())
  }

  getSessionsForConversation(conversationId: string): AppSession[] {
    return this.getAllSessions().filter((s) => s.conversationId === conversationId)
  }

  private updateSession(sessionId: string, updates: Partial<AppSession>): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    Object.assign(session, updates, { updatedAt: Date.now() })
    this.notifyListeners(session)
  }

  // --- Bridge Management ---

  attachBridge(sessionId: string, iframe: HTMLIFrameElement): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      console.error(`[AppBridgeManager] No session found for ${sessionId}`)
      return
    }

    // Clean up existing bridge for this session
    const existing = this.bridges.get(sessionId)
    if (existing) {
      existing.detach()
    }

    const bridge = new AppBridge(session, new Set(['null']))
    bridge.attach(iframe)

    // Set up event handlers
    bridge.onAny((event) => this.handleBridgeEvent(sessionId, event))

    this.bridges.set(sessionId, bridge)

    // Wait for READY, then send INIT
    bridge.waitForReady().then(() => {
      this.updateSession(sessionId, { status: AppSessionStatus.READY })
      bridge.sendInit(session.state)
    }).catch((err) => {
      console.error(`[AppBridgeManager] READY timeout for ${session.appId}:`, err)
      this.updateSession(sessionId, { status: AppSessionStatus.ERROR })
    })
  }

  detachBridge(sessionId: string): void {
    const bridge = this.bridges.get(sessionId)
    if (bridge) {
      bridge.destroy()
      this.bridges.delete(sessionId)
    }
  }

  getBridge(sessionId: string): AppBridge | undefined {
    return this.bridges.get(sessionId)
  }

  // Find bridge by appId (for tool invocations)
  getBridgeByAppId(appId: string): { bridge: AppBridge; session: AppSession } | undefined {
    for (const [sessionId, bridge] of this.bridges) {
      const session = this.sessions.get(sessionId)
      if (session && session.appId === appId && session.status !== 'destroyed') {
        return { bridge, session }
      }
    }
    return undefined
  }

  // --- Tool Invocation (called from AI SDK tool execute) ---

  async invokeTool(appId: string, toolName: string, toolCallId: string, params: Record<string, unknown>): Promise<unknown> {
    const entry = this.getBridgeByAppId(appId)
    if (!entry) {
      throw new Error(`No active bridge for app ${appId}`)
    }
    const { bridge, session } = entry

    if (session.status !== 'ready' && session.status !== 'active') {
      throw new Error(`App ${appId} is in ${session.status} state, cannot invoke tools`)
    }

    this.updateSession(session.id, { status: AppSessionStatus.ACTIVE })
    return bridge.invokeTool(toolName, toolCallId, params)
  }

  // --- Event Handling ---

  private handleBridgeEvent(sessionId: string, event: BridgeEvent): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    switch (event.type) {
      case 'tools_registered': {
        const tools = event.data as ToolSchema[]
        this.updateSession(sessionId, { tools })
        break
      }
      case 'state_update': {
        const { data, summary, version } = event.data as {
          data: Record<string, unknown>
          summary?: string
          version?: number
        }
        this.updateSession(sessionId, {
          state: data,
          stateSummary: summary || session.stateSummary,
          stateVersion: version || session.stateVersion + 1,
        })
        break
      }
      case 'completion': {
        this.updateSession(sessionId, { status: AppSessionStatus.COMPLETED })
        break
      }
      case 'error': {
        const { message } = event.data as { code: number; message: string }
        console.error(`[AppBridgeManager] App ${session.appId} error:`, message)
        break
      }
      case 'ui_resize': {
        // Handled by the AppIframe component directly
        break
      }
      case 'vision_frame': {
        // Store for AI context (handled by consumer)
        break
      }
      case 'heartbeat_timeout': {
        console.warn(`[AppBridgeManager] Heartbeat timeout for ${session.appId}`)
        break
      }
    }
  }

  // --- Listeners ---

  onSessionChange(listener: SessionListener): () => void {
    this.sessionListeners.add(listener)
    return () => this.sessionListeners.delete(listener)
  }

  private notifyListeners(session: AppSession): void {
    for (const listener of this.sessionListeners) {
      listener(session)
    }
  }

  // --- Cleanup ---

  destroyAll(): void {
    for (const [sessionId] of this.bridges) {
      this.detachBridge(sessionId)
    }
    this.sessions.clear()
  }
}

// Singleton
export const appBridgeManager = new AppBridgeManager()
