import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { AppManifest, AppSession, ToolSchema } from '@shared/protocol/types'

// --- App Registry (persisted) ---

export const appRegistryAtom = atomWithStorage<Record<string, AppManifest>>(
  'chatbridge_app_registry',
  {}
)

// --- App Sessions (persisted for crash recovery) ---

export const appSessionsAtom = atomWithStorage<Record<string, AppSession>>(
  'chatbridge_app_sessions',
  {}
)

// --- Derived: sessions for current conversation ---

export const currentConversationIdAtom = atom<string | null>(null)

export const currentConversationSessionsAtom = atom((get) => {
  const convId = get(currentConversationIdAtom)
  if (!convId) return []
  const sessions = get(appSessionsAtom)
  return Object.values(sessions).filter((s) => s.conversationId === convId)
})

// --- Derived: active sessions (loading, ready, or active) ---

export const activeAppSessionsAtom = atom((get) => {
  const sessions = get(currentConversationSessionsAtom)
  return sessions.filter((s) => s.status === 'loading' || s.status === 'ready' || s.status === 'active')
})

// --- Derived: active app IDs ---

export const activeAppIdsAtom = atom((get) => {
  const sessions = get(activeAppSessionsAtom)
  return new Set(sessions.map((s) => s.appId))
})

// --- Tool Injection Tier ---

export type InjectionTier = 'full' | 'summary' | 'none'

export interface ToolInjectionState {
  tier: InjectionTier
  reason: string
  lastActiveAt: number
}

export const toolInjectionStateAtom = atom<Record<string, ToolInjectionState>>({})

// --- Derived: active tools for AI SDK ---

export interface ActiveTools {
  tools: Record<string, { description: string; schema: ToolSchema; appId: string }>
  toolInstructions: string[]
}

export const activeToolsAtom = atom<ActiveTools>((get) => {
  const sessions = get(activeAppSessionsAtom)
  const registry = get(appRegistryAtom)
  const injectionState = get(toolInjectionStateAtom)
  const tools: ActiveTools['tools'] = {}
  const toolInstructions: string[] = []

  for (const session of sessions) {
    const manifest = registry[session.appId]
    if (!manifest) continue

    const tier = injectionState[session.appId]?.tier ?? 'none'

    if (tier === 'full') {
      for (const tool of session.tools) {
        const key = `app__${session.appId}__${tool.name}`
        tools[key] = {
          description: `[${manifest.name}] ${tool.description}`,
          schema: tool,
          appId: session.appId,
        }
      }
    } else if (tier === 'summary') {
      toolInstructions.push(
        `App "${manifest.name}" is available but not active. User can ask to use it.`
      )
    }
  }

  return { tools, toolInstructions }
})

// --- AI Context: what the AI sees about apps ---

export interface AppContextForAI {
  appId: string
  name: string
  status: string
  stateSummary: string | null
  tier: InjectionTier
}

export const aiAppContextAtom = atom<AppContextForAI[]>((get) => {
  const sessions = get(currentConversationSessionsAtom)
  const registry = get(appRegistryAtom)
  const injectionState = get(toolInjectionStateAtom)

  return sessions
    .filter((s) => s.status !== 'destroyed')
    .map((s) => ({
      appId: s.appId,
      name: registry[s.appId]?.name ?? s.appId,
      status: s.status,
      stateSummary: s.stateSummary,
      tier: injectionState[s.appId]?.tier ?? 'none',
    }))
})
