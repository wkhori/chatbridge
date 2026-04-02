import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the dependencies before importing
vi.mock('../manager', () => ({
  appBridgeManager: {
    getAllManifests: vi.fn(() => ({
      chess: {
        id: 'chess',
        name: 'Chess',
        version: '1.0.0',
        description: 'Chess game',
        url: 'https://example.com/chess',
        permissions: ['state_push', 'completion'],
        auth: { type: 'none' },
        keywords: ['chess', 'game'],
      },
      whiteboard: {
        id: 'whiteboard',
        name: 'Whiteboard',
        version: '1.0.0',
        description: 'Drawing tool',
        url: 'https://example.com/wb',
        permissions: ['state_push'],
        auth: { type: 'none' },
        keywords: ['draw'],
        viewOnly: true,
      },
    })),
    getAllSessions: vi.fn(() => []),
    createSession: vi.fn(() => ({ id: 'sess-1', appId: 'chess', tools: [] })),
    waitForBridge: vi.fn(),
    getManifest: vi.fn(),
    invokeTool: vi.fn(),
  },
}))

vi.mock('../routing', () => ({
  appRouter: {
    getTier: vi.fn(() => 'full'),
    promoteByMessage: vi.fn(),
  },
}))

import { getAppTools, getAppToolInstructions } from '../tool-bridge'
import { appBridgeManager } from '../manager'

describe('getAppTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no sessions
    vi.mocked(appBridgeManager.getAllSessions).mockReturnValue([])
  })

  it('returns launch_app when apps have no sessions', () => {
    const tools = getAppTools()
    expect(tools).toHaveProperty('launch_app')
  })

  it('returns suggest_actions tool always', () => {
    const tools = getAppTools()
    expect(tools).toHaveProperty('suggest_actions')
  })

  it('returns generate_micro_app tool always', () => {
    const tools = getAppTools()
    expect(tools).toHaveProperty('generate_micro_app')
  })

  it('returns app-prefixed tools for active sessions', () => {
    vi.mocked(appBridgeManager.getAllSessions).mockReturnValue([
      {
        id: 'sess-1',
        appId: 'chess',
        conversationId: 'conv-1',
        status: 'active',
        tools: [
          { name: 'start_game', description: 'Start a game', inputSchema: { type: 'object', properties: {} } },
          { name: 'make_move', description: 'Make a move', inputSchema: { type: 'object', properties: {} } },
        ],
        state: null,
        stateSummary: null,
        stateVersion: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ] as any)

    const tools = getAppTools()
    expect(tools).toHaveProperty('app__chess__start_game')
    expect(tools).toHaveProperty('app__chess__make_move')
  })

  it('does not return launch_app for apps with active sessions', () => {
    // Both apps have sessions
    vi.mocked(appBridgeManager.getAllSessions).mockReturnValue([
      { id: 's1', appId: 'chess', status: 'active', tools: [], conversationId: '', state: null, stateSummary: null, stateVersion: 0, createdAt: 0, updatedAt: 0 },
      { id: 's2', appId: 'whiteboard', status: 'active', tools: [], conversationId: '', state: null, stateSummary: null, stateVersion: 0, createdAt: 0, updatedAt: 0 },
    ] as any)

    const tools = getAppTools()
    // launch_app should not exist when all apps have sessions
    expect(tools).not.toHaveProperty('launch_app')
  })

  it('skips destroyed/error sessions', () => {
    vi.mocked(appBridgeManager.getAllSessions).mockReturnValue([
      { id: 's1', appId: 'chess', status: 'destroyed', tools: [{ name: 'test', description: 't', inputSchema: {} }], conversationId: '', state: null, stateSummary: null, stateVersion: 0, createdAt: 0, updatedAt: 0 },
    ] as any)

    const tools = getAppTools()
    expect(tools).not.toHaveProperty('app__chess__test')
    expect(tools).toHaveProperty('launch_app') // chess not counted as having active session
  })
})

describe('generate_micro_app validation', () => {
  it('calls onMicroAppGenerated for valid HTML', async () => {
    const onMicroAppGenerated = vi.fn()
    const tools = getAppTools({ onMicroAppGenerated })
    const microAppTool = tools['generate_micro_app']

    const result = await (microAppTool as any).execute({
      html: '<h1>Hello</h1>',
      title: 'Test Widget',
    }, { toolCallId: 'test' })

    expect(result).toEqual({ generated: true, title: 'Test Widget' })
    expect(onMicroAppGenerated).toHaveBeenCalledWith({
      html: '<h1>Hello</h1>',
      title: 'Test Widget',
    })
  })

  it('rejects HTML with eval()', async () => {
    const tools = getAppTools()
    const result = await (tools['generate_micro_app'] as any).execute({
      html: '<script>eval("alert(1)")</script>',
      title: 'Bad',
    }, { toolCallId: 'test' })

    expect(result).toHaveProperty('error')
    expect(result.error).toContain('Blocked pattern')
  })

  it('rejects HTML with fetch()', async () => {
    const tools = getAppTools()
    const result = await (tools['generate_micro_app'] as any).execute({
      html: '<script>fetch("/api")</script>',
      title: 'Bad',
    }, { toolCallId: 'test' })

    expect(result).toHaveProperty('error')
  })

  it('rejects HTML with new Function()', async () => {
    const tools = getAppTools()
    const result = await (tools['generate_micro_app'] as any).execute({
      html: '<script>new Function("return 1")()</script>',
      title: 'Bad',
    }, { toolCallId: 'test' })

    expect(result).toHaveProperty('error')
  })

  it('rejects HTML exceeding size limit', async () => {
    const tools = getAppTools()
    const bigHtml = 'x'.repeat(200 * 1024 + 1)
    const result = await (tools['generate_micro_app'] as any).execute({
      html: bigHtml,
      title: 'Big',
    }, { toolCallId: 'test' })

    expect(result).toHaveProperty('error')
    expect(result.error).toContain('200KB')
  })

  it('uses default title if not provided', async () => {
    const onMicroAppGenerated = vi.fn()
    const tools = getAppTools({ onMicroAppGenerated })

    await (tools['generate_micro_app'] as any).execute({
      html: '<h1>Test</h1>',
      title: undefined,
    }, { toolCallId: 'test' })

    expect(onMicroAppGenerated).toHaveBeenCalledWith({
      html: '<h1>Test</h1>',
      title: 'Interactive Widget',
    })
  })
})

describe('getAppToolInstructions', () => {
  it('returns non-empty string when manifests exist', () => {
    const instructions = getAppToolInstructions()
    expect(instructions.length).toBeGreaterThan(0)
  })

  it('includes Third-Party Apps section', () => {
    const instructions = getAppToolInstructions()
    expect(instructions).toContain('Third-Party Apps')
  })

  it('includes micro-app instructions', () => {
    const instructions = getAppToolInstructions()
    expect(instructions).toContain('generate_micro_app')
    expect(instructions).toContain('Generative Micro-Apps')
  })

  it('includes available app names', () => {
    const instructions = getAppToolInstructions()
    expect(instructions).toContain('Chess')
    expect(instructions).toContain('Whiteboard')
  })

  it('returns empty when no manifests', () => {
    vi.mocked(appBridgeManager.getAllManifests).mockReturnValue({})
    const instructions = getAppToolInstructions()
    expect(instructions).toBe('')
  })
})
