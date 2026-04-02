import { describe, it, expect } from 'vitest'
import {
  MessageEnvelopeSchema,
  AppManifestSchema,
  ToolSchemaSchema,
  InitPayloadSchema,
  ToolInvokePayloadSchema,
  StateRequestPayloadSchema,
  DestroyPayloadSchema,
  ReadyPayloadSchema,
  ToolRegisterPayloadSchema,
  ToolResultPayloadSchema,
  StateUpdatePayloadSchema,
  CompletionPayloadSchema,
  ErrorPayloadSchema,
  VisionFramePayloadSchema,
  UIResizePayloadSchema,
  ErrorCode,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
} from '../types'

// --- Message Envelope ---

describe('MessageEnvelopeSchema', () => {
  const validEnvelope = {
    protocol: PROTOCOL_ID,
    version: PROTOCOL_VERSION,
    type: 'READY',
    id: 'msg-123',
    correlationId: null,
    appId: 'chess',
    nonce: 1,
    timestamp: new Date().toISOString(),
    payload: {},
  }

  it('validates a correct envelope', () => {
    expect(MessageEnvelopeSchema.safeParse(validEnvelope).success).toBe(true)
  })

  it('rejects missing protocol', () => {
    const { protocol, ...rest } = validEnvelope
    expect(MessageEnvelopeSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects wrong protocol', () => {
    expect(MessageEnvelopeSchema.safeParse({ ...validEnvelope, protocol: 'wrong' }).success).toBe(false)
  })

  it('rejects missing appId', () => {
    const { appId, ...rest } = validEnvelope
    expect(MessageEnvelopeSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects non-number nonce', () => {
    expect(MessageEnvelopeSchema.safeParse({ ...validEnvelope, nonce: 'abc' }).success).toBe(false)
  })

  it('accepts correlationId as string', () => {
    expect(MessageEnvelopeSchema.safeParse({ ...validEnvelope, correlationId: 'corr-1' }).success).toBe(true)
  })
})

// --- Platform → App Payloads ---

describe('InitPayloadSchema', () => {
  it('validates correct payload', () => {
    expect(InitPayloadSchema.safeParse({
      sessionId: 'sess-1',
      permissions: ['state_push'],
      restoredState: null,
    }).success).toBe(true)
  })

  it('validates with restoredState', () => {
    expect(InitPayloadSchema.safeParse({
      sessionId: 'sess-1',
      permissions: [],
      restoredState: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
    }).success).toBe(true)
  })

  it('rejects missing sessionId', () => {
    expect(InitPayloadSchema.safeParse({
      permissions: [],
      restoredState: null,
    }).success).toBe(false)
  })
})

describe('ToolInvokePayloadSchema', () => {
  it('validates correct payload', () => {
    expect(ToolInvokePayloadSchema.safeParse({
      toolName: 'make_move',
      toolCallId: 'call-1',
      params: { move: 'e4' },
    }).success).toBe(true)
  })

  it('rejects missing toolName', () => {
    expect(ToolInvokePayloadSchema.safeParse({
      toolCallId: 'call-1',
      params: {},
    }).success).toBe(false)
  })
})

describe('StateRequestPayloadSchema', () => {
  it('validates correct format', () => {
    expect(StateRequestPayloadSchema.safeParse({ format: 'full' }).success).toBe(true)
    expect(StateRequestPayloadSchema.safeParse({ format: 'summary' }).success).toBe(true)
    expect(StateRequestPayloadSchema.safeParse({ format: 'visual' }).success).toBe(true)
  })

  it('rejects invalid format', () => {
    expect(StateRequestPayloadSchema.safeParse({ format: 'invalid' }).success).toBe(false)
  })
})

describe('DestroyPayloadSchema', () => {
  it('validates correct payload', () => {
    expect(DestroyPayloadSchema.safeParse({
      reason: 'user_closed',
      graceMs: 5000,
    }).success).toBe(true)
  })

  it('applies default graceMs', () => {
    const result = DestroyPayloadSchema.safeParse({ reason: 'session_ended' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.graceMs).toBe(5000)
  })
})

// --- App → Platform Payloads ---

describe('ReadyPayloadSchema', () => {
  it('validates correct payload', () => {
    expect(ReadyPayloadSchema.safeParse({
      displayName: 'Chess',
      version: '1.0.0',
    }).success).toBe(true)
  })

  it('accepts optional capabilities', () => {
    expect(ReadyPayloadSchema.safeParse({
      displayName: 'Chess',
      version: '1.0.0',
      capabilities: ['vision'],
    }).success).toBe(true)
  })
})

describe('ToolRegisterPayloadSchema', () => {
  it('validates with tools array', () => {
    expect(ToolRegisterPayloadSchema.safeParse({
      tools: [{
        name: 'start_game',
        description: 'Start a chess game',
        inputSchema: { type: 'object', properties: {} },
      }],
    }).success).toBe(true)
  })

  it('rejects empty object', () => {
    expect(ToolRegisterPayloadSchema.safeParse({}).success).toBe(false)
  })
})

describe('ToolResultPayloadSchema', () => {
  it('validates success result', () => {
    expect(ToolResultPayloadSchema.safeParse({
      success: true,
      result: { move: 'e4' },
    }).success).toBe(true)
  })

  it('validates error result', () => {
    expect(ToolResultPayloadSchema.safeParse({
      success: false,
      result: null,
      error: 'Invalid move',
    }).success).toBe(true)
  })
})

describe('StateUpdatePayloadSchema', () => {
  it('validates correct payload', () => {
    expect(StateUpdatePayloadSchema.safeParse({
      data: { fen: 'test', turn: 'white' },
      summary: 'Game in progress',
      version: 1,
    }).success).toBe(true)
  })

  it('validates minimal payload', () => {
    expect(StateUpdatePayloadSchema.safeParse({
      data: {},
    }).success).toBe(true)
  })
})

describe('CompletionPayloadSchema', () => {
  it('validates game_over', () => {
    expect(CompletionPayloadSchema.safeParse({
      reason: 'game_over',
      outcome: { result: 'checkmate', winner: 'white' },
      summary: 'White wins by checkmate',
    }).success).toBe(true)
  })

  it('validates all reason types', () => {
    for (const reason of ['game_over', 'task_done', 'user_closed', 'error']) {
      expect(CompletionPayloadSchema.safeParse({ reason }).success).toBe(true)
    }
  })

  it('rejects invalid reason', () => {
    expect(CompletionPayloadSchema.safeParse({ reason: 'invalid' }).success).toBe(false)
  })
})

describe('ErrorPayloadSchema', () => {
  it('validates correct payload', () => {
    expect(ErrorPayloadSchema.safeParse({
      code: 1001,
      message: 'Invalid message',
    }).success).toBe(true)
  })
})

describe('VisionFramePayloadSchema', () => {
  it('validates correct payload', () => {
    expect(VisionFramePayloadSchema.safeParse({
      format: 'jpeg',
      data: 'base64data',
      width: 800,
      height: 600,
    }).success).toBe(true)
  })

  it('rejects non-jpeg format', () => {
    expect(VisionFramePayloadSchema.safeParse({
      format: 'png',
      data: 'base64data',
      width: 800,
      height: 600,
    }).success).toBe(false)
  })
})

describe('UIResizePayloadSchema', () => {
  it('validates correct payload', () => {
    expect(UIResizePayloadSchema.safeParse({ height: 400 }).success).toBe(true)
  })

  it('validates with optional fields', () => {
    expect(UIResizePayloadSchema.safeParse({
      height: 400,
      minHeight: 200,
      maxHeight: 800,
    }).success).toBe(true)
  })
})

// --- Tool Schema ---

describe('ToolSchemaSchema', () => {
  it('validates correct tool schema', () => {
    expect(ToolSchemaSchema.safeParse({
      name: 'start_game',
      description: 'Start a game',
      inputSchema: { type: 'object', properties: {} },
    }).success).toBe(true)
  })

  it('validates with longRunning flag', () => {
    expect(ToolSchemaSchema.safeParse({
      name: 'analyze',
      description: 'Analyze deeply',
      inputSchema: { type: 'object' },
      longRunning: true,
    }).success).toBe(true)
  })

  it('rejects missing name', () => {
    expect(ToolSchemaSchema.safeParse({
      description: 'desc',
      inputSchema: {},
    }).success).toBe(false)
  })
})

// --- App Manifest ---

describe('AppManifestSchema', () => {
  const validManifest = {
    id: 'chess',
    name: 'Chess',
    version: '1.0.0',
    description: 'A chess game',
    url: 'https://example.com/chess',
    permissions: ['state_push', 'completion'],
    auth: { type: 'none' as const },
  }

  it('validates correct manifest', () => {
    expect(AppManifestSchema.safeParse(validManifest).success).toBe(true)
  })

  it('validates with all optional fields', () => {
    expect(AppManifestSchema.safeParse({
      ...validManifest,
      icon: '♟️',
      tools: [{ name: 'start', description: 'Start', inputSchema: {} }],
      keywords: ['chess', 'game'],
      viewOnly: true,
    }).success).toBe(true)
  })

  it('validates oauth2 auth', () => {
    expect(AppManifestSchema.safeParse({
      ...validManifest,
      auth: { type: 'oauth2', provider: 'google', scopes: ['read'] },
    }).success).toBe(true)
  })

  it('rejects missing id', () => {
    const { id, ...rest } = validManifest
    expect(AppManifestSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects invalid url', () => {
    expect(AppManifestSchema.safeParse({ ...validManifest, url: 'not-a-url' }).success).toBe(false)
  })

  it('rejects invalid permission', () => {
    expect(AppManifestSchema.safeParse({
      ...validManifest,
      permissions: ['invalid_permission'],
    }).success).toBe(false)
  })

  it('rejects invalid auth type', () => {
    expect(AppManifestSchema.safeParse({
      ...validManifest,
      auth: { type: 'invalid' },
    }).success).toBe(false)
  })
})

// --- Error Codes ---

describe('ErrorCode', () => {
  it('has all expected error codes', () => {
    expect(ErrorCode.INVALID_MESSAGE).toBe(1001)
    expect(ErrorCode.UNKNOWN_TYPE).toBe(1002)
    expect(ErrorCode.VERSION_MISMATCH).toBe(1003)
    expect(ErrorCode.RATE_LIMITED).toBe(1004)
    expect(ErrorCode.MESSAGE_TOO_LARGE).toBe(1005)
    expect(ErrorCode.NOT_READY).toBe(2001)
    expect(ErrorCode.ALREADY_DESTROYED).toBe(2002)
    expect(ErrorCode.INIT_FAILED).toBe(2003)
    expect(ErrorCode.TOOL_NOT_FOUND).toBe(3001)
    expect(ErrorCode.TOOL_INVOKE_FAILED).toBe(3002)
    expect(ErrorCode.TOOL_TIMEOUT).toBe(3003)
    expect(ErrorCode.TOOL_INVALID_PARAMS).toBe(3004)
    expect(ErrorCode.STATE_SERIALIZATION_FAILED).toBe(4001)
    expect(ErrorCode.STATE_TOO_LARGE).toBe(4002)
    expect(ErrorCode.VISION_INVALID_FORMAT).toBe(5001)
    expect(ErrorCode.VISION_TOO_LARGE).toBe(5002)
    expect(ErrorCode.INTERNAL_ERROR).toBe(9001)
    expect(ErrorCode.UNKNOWN_ERROR).toBe(9999)
  })

  it('has unique error codes', () => {
    const codes = Object.values(ErrorCode)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
