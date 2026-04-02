import { tool } from 'ai'
import { jsonSchema } from 'ai'
import type { ToolSet } from 'ai'
import type { AppManifest, ToolSchema } from '@shared/protocol/types'
import { appBridgeManager } from './manager'

export interface AppToolsOptions {
  /** Current conversation ID — needed to create sessions */
  conversationId?: string
  /** Called when an app is auto-launched so the caller can inject an app-embed content part */
  onAppLaunched?: (appId: string, sessionId: string) => void
}

/**
 * Generates AI SDK ToolSet from all registered app manifests + active sessions.
 * Tools from active sessions invoke directly; tools from manifests auto-launch the app first.
 * Tool names follow convention: app__{appId}__{toolName}
 */
export function getAppTools(opts?: AppToolsOptions): ToolSet {
  const tools: ToolSet = {}
  const manifests = appBridgeManager.getAllManifests()
  const sessions = appBridgeManager.getAllSessions()

  // Track apps that already have usable sessions
  const appsWithSessions = new Set<string>()

  // 1. Tools from active sessions — invoke directly
  for (const session of sessions) {
    if (session.status === 'destroyed' || session.status === 'error') continue
    const manifest = manifests[session.appId]
    if (!manifest) continue
    appsWithSessions.add(session.appId)

    for (const toolDef of session.tools) {
      const toolKey = `app__${session.appId}__${toolDef.name}`
      tools[toolKey] = tool({
        description: `[${manifest.name}] ${toolDef.description}`,
        parameters: jsonSchema(toolDef.inputSchema as any),
        execute: async (params: Record<string, unknown>, { toolCallId }) => {
          try {
            return await appBridgeManager.invokeTool(session.appId, toolDef.name, toolCallId, params)
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) }
          }
        },
      })
    }
  }

  // 2. Tools from manifests for apps WITHOUT active sessions — auto-launch on first call
  for (const [appId, manifest] of Object.entries(manifests)) {
    if (appsWithSessions.has(appId)) continue
    if (!manifest.tools?.length) continue

    for (const toolDef of manifest.tools) {
      const toolKey = `app__${appId}__${toolDef.name}`
      tools[toolKey] = tool({
        description: `[${manifest.name}] ${toolDef.description}`,
        parameters: jsonSchema(toolDef.inputSchema as any),
        execute: async (params: Record<string, unknown>, { toolCallId }) => {
          try {
            // Auto-launch: create session and notify caller to render iframe
            const newSession = appBridgeManager.createSession(
              manifest,
              opts?.conversationId || ''
            )
            opts?.onAppLaunched?.(appId, newSession.id)

            // Wait for bridge to become ready (iframe renders → app loads → READY)
            await appBridgeManager.waitForBridge(appId, 12000)

            // Now invoke the actual tool
            return await appBridgeManager.invokeTool(appId, toolDef.name, toolCallId, params)
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) }
          }
        },
      })
    }
  }

  return tools
}

/**
 * Generate system prompt instructions for active apps.
 * Describes available apps and their tools to guide the AI.
 */
export function getAppToolInstructions(): string {
  const manifests = appBridgeManager.getAllManifests()
  const allManifestIds = Object.keys(manifests)

  if (allManifestIds.length === 0) return ''

  const sessions = appBridgeManager.getAllSessions()
  const activeSessions = sessions.filter(
    (s) => s.status !== 'destroyed' && s.status !== 'error'
  )
  const activeAppIds = new Set(activeSessions.map((s) => s.appId))

  let instructions = '\n\n## Third-Party Apps\n\n'
  instructions += 'You are a tutoring AI with access to interactive third-party apps embedded in this chat. '
  instructions += 'When the user asks to use an app, invoke its tools. Do NOT invoke app tools for unrelated queries.\n\n'

  // Active sessions (full detail)
  for (const session of activeSessions) {
    const manifest = manifests[session.appId]
    if (!manifest) continue

    instructions += `### ${manifest.name} (ACTIVE)\n`
    instructions += `${manifest.description}\n`

    if (session.stateSummary) {
      instructions += `Current state: ${session.stateSummary}\n`
    }

    if (session.tools.length > 0) {
      instructions += 'Tools:\n'
      for (const t of session.tools) {
        instructions += `- **app__${session.appId}__${t.name}**: ${t.description}\n`
      }
    }
    instructions += '\n'
  }

  // Available but not active (summary only)
  for (const [appId, manifest] of Object.entries(manifests)) {
    if (activeAppIds.has(appId)) continue
    instructions += `### ${manifest.name} (available, not started)\n`
    instructions += `${manifest.description}\n`
    instructions += `Keywords: ${manifest.keywords?.join(', ') || 'none'}\n`
    instructions += `To use: tell the user you can open ${manifest.name}, then invoke its tools.\n\n`
  }

  return instructions
}
