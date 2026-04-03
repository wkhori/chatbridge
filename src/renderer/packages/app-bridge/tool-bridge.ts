import { tool } from 'ai'
import { jsonSchema } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import type { AppManifest, ToolSchema } from '@shared/protocol/types'
import { AUTO_LAUNCH_TIMEOUT, MICRO_APP_MAX_SIZE } from '@shared/protocol/types'
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
  /** Called when AI generates a micro-app widget */
  onMicroAppGenerated?: (data: { html: string; title: string }) => void
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
      // @ts-ignore - jsonSchema() with execute requires type assertion for dynamic schemas
      tools[toolKey] = tool({
        description: `[${manifest.name}] ${toolDef.description}`,
        inputSchema: jsonSchema(toolDef.inputSchema as any),
        execute: async (params: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
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

  // 2. For manifests with pre-declared tools that DON'T have sessions yet,
  //    generate tool entries that auto-launch the app on first invocation.
  for (const [appId, manifest] of Object.entries(manifests)) {
    if (appsWithSessions.has(appId) || !manifest.tools?.length) continue

    for (const toolDef of manifest.tools) {
      const toolKey = `app__${appId}__${toolDef.name}`
      if (tools[toolKey]) continue // already registered by active session
      // @ts-ignore - jsonSchema() with execute requires type assertion for dynamic schemas
      tools[toolKey] = tool({
        description: `[${manifest.name}] ${toolDef.description}`,
        inputSchema: jsonSchema(toolDef.inputSchema as any),
        execute: async (params: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
          try {
            // Auto-launch the app if no session exists
            let entry = appBridgeManager.getBridgeByAppId(appId)
            if (!entry || entry.session.status === 'destroyed' || entry.session.status === 'error') {
              const newSession = appBridgeManager.createSession(manifest, opts?.conversationId || '')
              opts?.onAppLaunched?.(appId, newSession.id)
              await appBridgeManager.waitForBridge(appId, AUTO_LAUNCH_TIMEOUT)
              entry = appBridgeManager.getBridgeByAppId(appId)
            } else if (entry.session.status === 'loading') {
              await appBridgeManager.waitForBridge(appId, AUTO_LAUNCH_TIMEOUT)
              entry = appBridgeManager.getBridgeByAppId(appId)
            }
            return await appBridgeManager.invokeTool(appId, toolDef.name, toolCallId, params)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            const code = err instanceof ChatBridgeError ? err.code : undefined
            return { error: msg, ...(code && { code }) }
          }
        },
      })
    }
  }

  // 3. launch_app meta-tool — launches any registered app that isn't already running
  const launchableApps = Object.entries(manifests).filter(([id]) => !appsWithSessions.has(id))
  if (launchableApps.length > 0) {
    // @ts-ignore - jsonSchema() with execute requires type assertion for dynamic schemas
    tools['launch_app'] = tool({
      description:
        `Launch a third-party app. Available apps: ${launchableApps.map(([, m]) => `${m.name} (id: "${m.id}")`).join(', ')}. ` +
        `After launching, the app will register its tools and you can use them.`,
      inputSchema: jsonSchema({
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
  // @ts-ignore - jsonSchema() with execute requires type assertion for dynamic schemas
  tools['suggest_actions'] = tool({
    description:
      'Suggest contextual action buttons for the user. Use after responding to show relevant next steps. Each suggestion becomes a clickable button.',
    inputSchema: jsonSchema({
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

  // 4. generate_micro_app — AI creates interactive widgets mid-conversation
  const blocklist = [/\beval\s*\(/, /\bnew\s+Function\s*\(/, /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bimportScripts\b/]
  // @ts-ignore - jsonSchema() with execute requires type assertion for dynamic schemas
  tools['generate_micro_app'] = tool({
    description:
      'Generate an interactive micro-app widget. Use for quizzes, visualizers, calculators, or mini-games. Output self-contained HTML/CSS/JS.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        html: { type: 'string', description: 'Complete self-contained HTML document with inline CSS and JS. Must work without external dependencies.' },
        title: { type: 'string', description: 'Short title for the widget' },
      },
      required: ['html', 'title'],
    } as any),
    execute: async (params: Record<string, unknown>) => {
      const { html, title } = params as { html: string; title?: string }
      if (html.length > MICRO_APP_MAX_SIZE) return { error: `HTML exceeds ${MICRO_APP_MAX_SIZE / 1024}KB limit` }
      for (const p of blocklist) {
        if (p.test(html)) return { error: `Blocked pattern: ${p.source}` }
      }
      opts?.onMicroAppGenerated?.({ html, title: title || 'Interactive Widget' })
      return { generated: true, title }
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
  instructions += '- During a chess game: suggest "Get Hint", "Resign", or "New Game (Easy/Medium/Hard)" (with start_game + difficulty param). NEVER suggest individual moves as buttons — players make moves directly on the board.\n'
  instructions += '- After a chess game ends: ALWAYS suggest new game options with different difficulties: "New Game (Easy)", "New Game (Medium)", "New Game (Hard)". Include the difficulty param in args.\n'
  instructions += '- After explaining a concept: suggest "Draw on Whiteboard", "Practice with Quiz"\n'
  instructions += 'Each suggestion needs: label (short), toolName (the tool to call), args (tool arguments), and optional icon emoji.\n'
  instructions += 'IMPORTANT: Do NOT suggest "View Status" or "Make Move" buttons. The board UI handles moves and the game state updates automatically.\n\n'

  instructions += '### Generative Micro-Apps\n'
  instructions += 'You can create interactive widgets mid-conversation using **generate_micro_app**.\n'
  instructions += 'Use it when a student needs:\n'
  instructions += '- An interactive quiz ("quiz me on state capitals")\n'
  instructions += '- A visualizer ("show me how fractions work")\n'
  instructions += '- A calculator or converter ("I need a unit converter")\n'
  instructions += '- A mini-game ("make a typing practice game")\n\n'
  instructions += 'Generate COMPLETE self-contained HTML with inline CSS and JS. No external deps.\n'
  instructions += 'Keep it under 200KB. The widget runs in a sandboxed iframe with no network access.\n'
  instructions += 'Use the ChatBridge.sendResult(data) bridge to send results back, and ChatBridge.requestResize(height) to adjust height.\n\n'

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

  // Available but not launched — show pre-declared tools (auto-launches on first call)
  for (const [appId, manifest] of Object.entries(manifests)) {
    if (activeAppIds.has(appId)) continue
    const tier = appRouter.getTier(appId)
    if (tier === 'none') continue

    instructions += `### ${manifest.name} (available)\n`
    instructions += `${manifest.description}\n`
    if (manifest.tools && manifest.tools.length > 0) {
      instructions += 'Tools (calling any tool auto-launches the app):\n'
      for (const t of manifest.tools) {
        instructions += `- **app__${appId}__${t.name}**: ${t.description}\n`
      }
    } else {
      instructions += `To use: call launch_app with appId="${appId}", then use the tools it registers.\n`
    }
    instructions += '\n'
  }

  return instructions
}
