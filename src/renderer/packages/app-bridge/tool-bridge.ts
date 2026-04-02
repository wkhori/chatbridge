import { tool } from 'ai'
import { jsonSchema } from 'ai'
import type { ToolSet } from 'ai'
import type { ToolSchema } from '@shared/protocol/types'
import { appBridgeManager } from './manager'

/**
 * Generates AI SDK ToolSet from app-registered tools.
 * Tool names follow convention: app__{appId}__{toolName}
 */
export function getAppTools(): ToolSet {
  const tools: ToolSet = {}
  const manifests = appBridgeManager.getAllManifests()

  for (const session of appBridgeManager.getAllSessions()) {
    if (session.status === 'destroyed' || session.status === 'error') continue

    const manifest = manifests[session.appId]
    if (!manifest) continue

    for (const toolDef of session.tools) {
      const toolKey = `app__${session.appId}__${toolDef.name}`

      tools[toolKey] = tool({
        description: `[${manifest.name}] ${toolDef.description}`,
        parameters: jsonSchema(toolDef.inputSchema as any),
        execute: async (params: Record<string, unknown>, { toolCallId }) => {
          try {
            const result = await appBridgeManager.invokeTool(
              session.appId,
              toolDef.name,
              toolCallId,
              params
            )
            return result
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
  const sessions = appBridgeManager.getAllSessions()
  const activeSessions = sessions.filter(
    (s) => s.status !== 'destroyed' && s.status !== 'error'
  )

  if (activeSessions.length === 0) return ''

  let instructions = '\n\n## Third-Party Apps\n\n'
  instructions += 'The following third-party apps are available in this conversation. '
  instructions += 'You can invoke their tools when the user\'s request is clearly related to that app\'s domain. '
  instructions += 'Do NOT invoke app tools for unrelated queries.\n\n'

  for (const session of activeSessions) {
    const manifest = manifests[session.appId]
    if (!manifest) continue

    instructions += `### ${manifest.name}\n`
    instructions += `${manifest.description}\n`
    instructions += `Status: ${session.status}\n`

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

  return instructions
}
