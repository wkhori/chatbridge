import { z } from 'zod'

// ============================================================
// ChatBridge PostMessage Protocol v1.0.0
// ============================================================

export const PROTOCOL_ID = 'chatbridge' as const
export const PROTOCOL_VERSION = '1.0.0' as const

// --- Message Types ---

export const PlatformMessageType = {
  INIT: 'INIT',
  TOOL_INVOKE: 'TOOL_INVOKE',
  STATE_REQUEST: 'STATE_REQUEST',
  DESTROY: 'DESTROY',
  HEARTBEAT_PING: 'HEARTBEAT_PING',
} as const

export const AppMessageType = {
  READY: 'READY',
  TOOL_REGISTER: 'TOOL_REGISTER',
  TOOL_RESULT: 'TOOL_RESULT',
  STATE_UPDATE: 'STATE_UPDATE',
  COMPLETION: 'COMPLETION',
  ERROR: 'ERROR',
  VISION_FRAME: 'VISION_FRAME',
  UI_RESIZE: 'UI_RESIZE',
  HEARTBEAT_PONG: 'HEARTBEAT_PONG',
} as const

export type PlatformMessageType = (typeof PlatformMessageType)[keyof typeof PlatformMessageType]
export type AppMessageType = (typeof AppMessageType)[keyof typeof AppMessageType]
export type BridgeMessageType = PlatformMessageType | AppMessageType

// --- Message Envelope ---

export const MessageEnvelopeSchema = z.object({
  protocol: z.literal(PROTOCOL_ID),
  version: z.string(),
  type: z.string(),
  id: z.string(),
  correlationId: z.string().nullable(),
  appId: z.string(),
  nonce: z.number(),
  timestamp: z.string(),
  payload: z.record(z.string(), z.unknown()),
})

export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>

// --- Platform → App Payloads ---

export const InitPayloadSchema = z.object({
  sessionId: z.string(),
  permissions: z.array(z.string()),
  restoredState: z.record(z.string(), z.unknown()).nullable(),
  config: z.record(z.string(), z.unknown()).optional(),
})

export const ToolInvokePayloadSchema = z.object({
  toolName: z.string(),
  toolCallId: z.string(),
  params: z.record(z.string(), z.unknown()),
  authToken: z.string().optional(),
})

export const StateRequestPayloadSchema = z.object({
  format: z.enum(['full', 'summary', 'visual']),
})

export const DestroyPayloadSchema = z.object({
  reason: z.enum(['user_closed', 'session_ended', 'error', 'navigation']),
  graceMs: z.number().default(5000),
})

// --- App → Platform Payloads ---

export const ReadyPayloadSchema = z.object({
  displayName: z.string(),
  version: z.string(),
  capabilities: z.array(z.string()).optional(),
})

export const ToolSchemaSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  longRunning: z.boolean().optional(),
})

export const ToolRegisterPayloadSchema = z.object({
  tools: z.array(ToolSchemaSchema),
})

export const ToolResultPayloadSchema = z.object({
  success: z.boolean(),
  result: z.unknown(),
  error: z.string().optional(),
})

export const StateUpdatePayloadSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  summary: z.string().optional(),
  version: z.number().optional(),
})

export const CompletionPayloadSchema = z.object({
  reason: z.enum(['game_over', 'task_done', 'user_closed', 'error']),
  outcome: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().optional(),
})

export const ErrorPayloadSchema = z.object({
  code: z.number(),
  message: z.string(),
  details: z.unknown().optional(),
})

export const VisionFramePayloadSchema = z.object({
  format: z.literal('jpeg'),
  data: z.string(), // base64
  width: z.number(),
  height: z.number(),
  quality: z.number().optional(),
})

export const UIResizePayloadSchema = z.object({
  height: z.number(),
  minHeight: z.number().optional(),
  maxHeight: z.number().optional(),
})

// --- Error Codes ---

export const ErrorCode = {
  // 1xxx Protocol
  INVALID_MESSAGE: 1001,
  UNKNOWN_TYPE: 1002,
  VERSION_MISMATCH: 1003,
  RATE_LIMITED: 1004,
  MESSAGE_TOO_LARGE: 1005,
  // 2xxx Lifecycle
  NOT_READY: 2001,
  ALREADY_DESTROYED: 2002,
  INIT_FAILED: 2003,
  // 3xxx Tool
  TOOL_NOT_FOUND: 3001,
  TOOL_INVOKE_FAILED: 3002,
  TOOL_TIMEOUT: 3003,
  TOOL_INVALID_PARAMS: 3004,
  // 4xxx State
  STATE_SERIALIZATION_FAILED: 4001,
  STATE_TOO_LARGE: 4002,
  // 5xxx Vision
  VISION_INVALID_FORMAT: 5001,
  VISION_TOO_LARGE: 5002,
  // 9xxx Internal
  INTERNAL_ERROR: 9001,
  UNKNOWN_ERROR: 9999,
} as const

// --- App Manifest ---

export const AppPermissionSchema = z.enum([
  'state_push',
  'vision',
  'ui_resize',
  'completion',
  'long_running_tools',
])

export type AppPermission = z.infer<typeof AppPermissionSchema>

export const AppManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  url: z.string().url(),
  icon: z.string().optional(),
  permissions: z.array(AppPermissionSchema),
  auth: z.object({
    type: z.enum(['none', 'api_key', 'oauth2']),
    provider: z.string().optional(),
    scopes: z.array(z.string()).optional(),
  }),
  tools: z.array(ToolSchemaSchema).optional(), // pre-declared tools (optional, app can register at runtime)
  keywords: z.array(z.string()).optional(), // for routing
})

export type AppManifest = z.infer<typeof AppManifestSchema>
export type ToolSchema = z.infer<typeof ToolSchemaSchema>

// --- App Session ---

export const AppSessionStatus = {
  LOADING: 'loading',
  READY: 'ready',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ERROR: 'error',
  DESTROYED: 'destroyed',
} as const

export type AppSessionStatus = (typeof AppSessionStatus)[keyof typeof AppSessionStatus]

export interface AppSession {
  id: string
  appId: string
  conversationId: string
  status: AppSessionStatus
  tools: ToolSchema[]
  state: Record<string, unknown> | null
  stateSummary: string | null
  stateVersion: number
  createdAt: number
  updatedAt: number
}

// --- Rate Limiter ---

export const RATE_LIMIT = 30 // messages per second
export const MAX_MESSAGE_SIZE = 1_048_576 // 1MB
export const READY_TIMEOUT = 15_000 // 15s
export const TOOL_TIMEOUT = 30_000 // 30s
export const TOOL_TIMEOUT_LONG = 120_000 // 120s
export const HEARTBEAT_INTERVAL = 10_000 // 10s
export const HEARTBEAT_MISS_LIMIT = 3
export const DESTROY_GRACE_MS = 5_000 // 5s
