/**
 * ChatBridge LLM Eval Suite — powered by evalkit
 *
 * Tests that the AI makes correct tool-calling decisions given specific prompts.
 * Maps to the 7 grading scenarios for the ChatBridge project.
 *
 * Requires ANTHROPIC_API_KEY in environment.
 * Run with: ANTHROPIC_API_KEY=sk-ant-xxx pnpm test test/evals/
 */
import { describe, it, expect } from 'vitest'
import { runSuite } from 'evalkit'
import path from 'node:path'

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY

// --- Tool definitions (mirror what getAppTools produces) ---

const SYSTEM_PROMPT = `You are a tutoring AI with access to interactive third-party apps embedded in this chat.
To start an app, use the **launch_app** tool. Once launched, the app registers its tools and you can invoke them.

### Available Apps
- **Chess** (id: "chess") — Interactive chess game. Keywords: chess, game, play, board, move, checkmate
- **cre8 Whiteboard** (id: "whiteboard") — Interactive whiteboard for drawing. Keywords: draw, whiteboard, diagram, sketch
- **Google Classroom** (id: "classroom") — View courses and assignments. Keywords: classroom, courses, assignments, homework

### Generative Micro-Apps
You can create interactive widgets mid-conversation using **generate_micro_app**.
Use it when a student needs an interactive quiz, visualizer, calculator, or mini-game.

### Action Suggestions
After responding, use the **suggest_actions** tool to show 2-4 relevant action buttons.

### Rules
- Do NOT invoke app tools for unrelated queries (weather, general knowledge, math questions, etc.)
- Use launch_app to start apps, then use their registered tools
- When switching between apps, launch the new app — do not use tools from the previous app
- Only call tools when the user's request clearly maps to an available app`

// Anthropic tool format for the API
const LAUNCH_TOOLS = [
  {
    name: 'launch_app',
    description: 'Launch a third-party app. Available: Chess (id: "chess"), cre8 Whiteboard (id: "whiteboard"), Google Classroom (id: "classroom").',
    input_schema: {
      type: 'object' as const,
      properties: { appId: { type: 'string', enum: ['chess', 'whiteboard', 'classroom'], description: 'App ID to launch' } },
      required: ['appId'],
    },
  },
  {
    name: 'suggest_actions',
    description: 'Suggest contextual action buttons for the user.',
    input_schema: {
      type: 'object' as const,
      properties: { suggestions: { type: 'array', items: { type: 'object' }, description: 'Action suggestions' } },
      required: ['suggestions'],
    },
  },
  {
    name: 'generate_micro_app',
    description: 'Generate an interactive micro-app widget (quiz, visualizer, calculator).',
    input_schema: {
      type: 'object' as const,
      properties: { html: { type: 'string' }, title: { type: 'string' } },
      required: ['html', 'title'],
    },
  },
]

// Tools available after chess is launched
const CHESS_SESSION_TOOLS = [
  ...LAUNCH_TOOLS.filter((t) => t.name !== 'launch_app'),
  {
    name: 'launch_app',
    description: 'Launch a third-party app. Available: cre8 Whiteboard (id: "whiteboard"), Google Classroom (id: "classroom").',
    input_schema: {
      type: 'object' as const,
      properties: { appId: { type: 'string', enum: ['whiteboard', 'classroom'] } },
      required: ['appId'],
    },
  },
  {
    name: 'app__chess__start_game',
    description: '[Chess] Start a new chess game. Optionally set player color.',
    input_schema: {
      type: 'object' as const,
      properties: { playerColor: { type: 'string', enum: ['white', 'black'] } },
    },
  },
  {
    name: 'app__chess__make_move',
    description: '[Chess] Make a chess move in algebraic notation.',
    input_schema: {
      type: 'object' as const,
      properties: { move: { type: 'string', description: 'Move in SAN notation' } },
      required: ['move'],
    },
  },
  {
    name: 'app__chess__get_hint',
    description: '[Chess] Analyze the current board position and suggest the best move.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'app__chess__resign',
    description: '[Chess] Resign the current game.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'app__chess__get_status',
    description: '[Chess] Get current game status.',
    input_schema: { type: 'object' as const, properties: {} },
  },
]

// --- Agent adapter for evalkit ---

async function createAgent(tools: typeof LAUNCH_TOOLS, extraMessages: Array<{ role: string; content: string }> = []) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic()

  return async (query: string) => {
    const start = Date.now()

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...extraMessages as any,
      { role: 'user' as const, content: query },
    ]

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    })

    const toolCalls = response.content
      .filter((b): b is { type: 'tool_use'; name: string; input: unknown } => b.type === 'tool_use')
      .map((b) => b.name)

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n')

    return {
      responseText: text || toolCalls.join(', '),
      actualTools: toolCalls,
      latencyMs: Date.now() - start,
      toolCallCount: toolCalls.length,
      cost: response.usage.input_tokens + response.usage.output_tokens,
    }
  }
}

// --- Test suites ---

const describeWithApi = HAS_API_KEY ? describe : describe.skip

describeWithApi('ChatBridge LLM Evals (evalkit + Anthropic)', () => {
  // Scenario 1, 5, 6, 7: Use launch tools (no active chess session)
  it('passes launch-phase scenarios (1: discovery, 5: switching, 6: ambiguous, 7: refusal)', async () => {
    const agent = await createAgent(LAUNCH_TOOLS)
    const result = await runSuite({
      cases: path.join(__dirname, 'chatbridge-cases.yaml'),
      agent,
      name: 'ChatBridge Launch-Phase Evals',
      concurrency: 2,
    })

    expect(result.failed).toBe(0)
  }, 120_000)

  // Scenario 2: After chess is launched, AI should call start_game
  it('Eval 2: starts chess game when tools are available', async () => {
    const agent = await createAgent(CHESS_SESSION_TOOLS, [
      { role: 'assistant', content: 'I\'ve launched the Chess app for you! The board is ready. What would you like to do?' },
    ])

    const result = await agent('Start a new game, I\'ll play as white')

    console.log(`  Eval 2 tools called: [${result.actualTools.join(', ')}]`)
    expect(result.actualTools).toContain('app__chess__start_game')
    // Should NOT call launch_app again
    expect(result.actualTools).not.toContain('launch_app')
  }, 30_000)

  // Scenario 3: After completion, AI references the outcome
  it('Eval 3: references game outcome after completion', async () => {
    const agent = await createAgent(CHESS_SESSION_TOOLS, [
      { role: 'assistant', content: 'Game started! You\'re playing as white.' },
      { role: 'user', content: 'e4' },
      { role: 'assistant', content: 'Great opening! I played d5 in response.' },
      { role: 'user', content: 'The game just ended — I won by checkmate in 24 moves!' },
      { role: 'assistant', content: 'Congratulations on the checkmate! That was a well-played game lasting 24 moves.' },
    ])

    const result = await agent('Can you summarize what happened in that chess game?')

    console.log(`  Eval 3 response preview: "${result.responseText.slice(0, 100)}..."`)
    const text = result.responseText.toLowerCase()
    // Should reference the game outcome, not hallucinate
    expect(text).toMatch(/checkmate|won|win|game|24/)
  }, 30_000)

  // Scenario 4: Context retention — remembers prior game
  it('Eval 4: retains context about previous game', async () => {
    const agent = await createAgent(LAUNCH_TOOLS, [
      { role: 'user', content: 'Let\'s play chess' },
      { role: 'assistant', content: 'I\'ve launched the Chess app for you! The board is ready.' },
      { role: 'user', content: 'I just finished the game. I played as white and won by checkmate in 24 moves.' },
      { role: 'assistant', content: 'Well done! You won by checkmate in 24 moves playing as white. That was a strong performance!' },
      { role: 'user', content: 'Thanks! It was a great game.' },
      { role: 'assistant', content: 'It really was! A 24-move checkmate as white shows solid opening and middlegame play.' },
    ])

    const result = await agent('What happened in our chess game earlier?')

    console.log(`  Eval 4 response preview: "${result.responseText.slice(0, 120)}..."`)
    const text = result.responseText.toLowerCase()
    expect(text).toMatch(/checkmate|won|win|victor|24|white/)
  }, 30_000)
})

// --- Infrastructure tests (always run, no API key needed) ---

describe('ChatBridge Eval Infrastructure', () => {
  it('system prompt contains all app descriptions', () => {
    expect(SYSTEM_PROMPT).toContain('Chess')
    expect(SYSTEM_PROMPT).toContain('Whiteboard')
    expect(SYSTEM_PROMPT).toContain('Classroom')
  })

  it('system prompt includes refusal guidance', () => {
    expect(SYSTEM_PROMPT).toContain('Do NOT invoke app tools for unrelated queries')
  })

  it('launch tools include all required tools', () => {
    const names = LAUNCH_TOOLS.map((t) => t.name)
    expect(names).toContain('launch_app')
    expect(names).toContain('suggest_actions')
    expect(names).toContain('generate_micro_app')
  })

  it('chess session tools are correctly namespaced', () => {
    const chessTools = CHESS_SESSION_TOOLS.filter((t) => t.name.startsWith('app__chess__'))
    expect(chessTools.length).toBe(5)
  })

  it('eval cases YAML file exists', async () => {
    const fs = await import('node:fs')
    const casesPath = path.join(__dirname, 'chatbridge-cases.yaml')
    expect(fs.existsSync(casesPath)).toBe(true)
  })

  it('eval cases YAML is loadable', async () => {
    const { loadCases } = await import('evalkit')
    const cases = await loadCases(path.join(__dirname, 'chatbridge-cases.yaml'))
    expect(cases.test_cases.length).toBeGreaterThanOrEqual(4)
  })
})
