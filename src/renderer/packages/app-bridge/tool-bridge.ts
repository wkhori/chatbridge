import { tool } from 'ai'
import { jsonSchema } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import type { AppManifest, ToolSchema } from '@shared/protocol/types'
import { AUTO_LAUNCH_TIMEOUT } from '@shared/protocol/types'
import { ChatBridgeError } from '@shared/protocol/errors'
import type { ActionSuggestion } from '@shared/types'
import { appBridgeManager } from './manager'
import { appRouter } from './routing'

export interface AppToolsOptions {
  /** Current conversation ID — needed to create sessions */
  conversationId?: string
  /** Called when an app is auto-launched so the caller can inject an app-embed content part */
  onAppLaunched?: (appId: string, sessionId: string) => void
  /** Called when AI suggests action buttons */
  onActionSuggestions?: (suggestions: ActionSuggestion[]) => void
}

/**
 * Generates AI SDK ToolSet from active sessions + a launch_app meta-tool.
 * Tools from active sessions invoke directly via app__{appId}__{toolName}.
 * Apps without sessions are launched via the launch_app tool.
 */
export function getAppTools(opts?: AppToolsOptions): ToolSet {
  const tools: ToolSet = {}
  const manifests = appBridgeManager.getAllManifests()
  const sessions = appBridgeManager.getAllSessions()

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
            const msg = err instanceof Error ? err.message : String(err)
            const code = err instanceof ChatBridgeError ? err.code : undefined
            return { error: msg, ...(code && { code }) }
          }
        },
      })
    }
  }

  // 2. launch_app meta-tool — launches any registered app that isn't already running
  const launchableApps = Object.entries(manifests).filter(([id]) => !appsWithSessions.has(id))
  if (launchableApps.length > 0) {
    tools['launch_app'] = tool({
      description:
        `Launch a third-party app. Available apps: ${launchableApps.map(([, m]) => `${m.name} (id: "${m.id}")`).join(', ')}. ` +
        `After launching, the app will register its tools and you can use them.`,
      parameters: jsonSchema({
        type: 'object',
        properties: {
          appId: {
            type: 'string',
            enum: launchableApps.map(([id]) => id),
            description: 'ID of the app to launch',
          },
        },
        required: ['appId'],
      } as any),
      execute: async (params: Record<string, unknown>) => {
        const appId = params.appId as string
        const manifest = manifests[appId]
        if (!manifest) return { error: `App "${appId}" not found` }

        try {
          const newSession = appBridgeManager.createSession(manifest, opts?.conversationId || '')
          opts?.onAppLaunched?.(appId, newSession.id)
          await appBridgeManager.waitForBridge(appId, AUTO_LAUNCH_TIMEOUT)
          const session = appBridgeManager.getAllSessions().find(
            (s) => s.appId === appId && s.status !== 'destroyed' && s.status !== 'error'
          )
          return {
            launched: true,
            appId,
            name: manifest.name,
            tools: (session?.tools || []).map((t) => `app__${appId}__${t.name}`),
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  }

  // 3. suggest_actions — AI generates contextual action buttons
  tools['suggest_actions'] = tool({
    description:
      'Suggest contextual action buttons for the user. Use after responding to show relevant next steps. Each suggestion becomes a clickable button.',
    parameters: jsonSchema({
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Button text (short, e.g. "Play Chess", "Get Hint")' },
              icon: { type: 'string', description: 'Optional emoji icon' },
              toolName: { type: 'string', description: 'Tool to invoke when clicked (e.g. "app__chess__start_game")' },
              args: { type: 'object', description: 'Arguments to pass to the tool' },
            },
            required: ['label', 'toolName', 'args'],
          },
          description: 'Array of action suggestions (2-4 recommended)',
        },
      },
      required: ['suggestions'],
    } as any),
    execute: async (params: Record<string, unknown>) => {
      const suggestions = params.suggestions as ActionSuggestion[]
      opts?.onActionSuggestions?.(suggestions)
      return { displayed: suggestions.length }
    },
  })

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
  instructions += 'To start an app, use the **launch_app** tool. Once launched, the app registers its tools and you can invoke them.\n\n'
  instructions += '### Action Suggestions\n'
  instructions += 'After responding, use the **suggest_actions** tool to show 2-4 relevant action buttons. '
  instructions += 'Suggestions should be contextual next steps the user might want. Examples:\n'
  instructions += '- After greeting: suggest opening available apps\n'
  instructions += '- During a chess game: suggest "Get Hint", "View Status", "Resign"\n'
  instructions += '- After explaining a concept: suggest "Draw on Whiteboard", "Practice with Quiz"\n'
  instructions += 'Each suggestion needs: label (short), toolName (the tool to call), args (tool arguments), and optional icon emoji.\n\n'

  // Active sessions — respect tier for injection level
  for (const session of activeSessions) {
    const manifest = manifests[session.appId]
    if (!manifest) continue

    const tier = appRouter.getTier(session.appId)

    // 'none' tier: omit entirely from context
    if (tier === 'none') continue

    // 'summary' tier: description + state only, no tools
    if (tier === 'summary') {
      instructions += `### ${manifest.name} (active, background)\n`
      instructions += `${manifest.description}\n`
      if (session.stateSummary) {
        instructions += `Current state: ${session.stateSummary}\n`
      }
      instructions += '\n'
      continue
    }

    // 'full' tier (default for active): all tools + state
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

  // Available but not launched — tell AI to use launch_app
  for (const [appId, manifest] of Object.entries(manifests)) {
    if (activeAppIds.has(appId)) continue
    const tier = appRouter.getTier(appId)
    if (tier === 'none') continue

    instructions += `### ${manifest.name} (available — use launch_app to start)\n`
    instructions += `${manifest.description}\n`
    instructions += `Keywords: ${manifest.keywords?.join(', ') || 'none'}\n`
    instructions += `To use: call launch_app with appId="${appId}", then use the tools it registers.\n\n`
  }

  return instructions
}
