import { describe, it, expect } from 'vitest'
import {
  MessageAppEmbedPartSchema,
  ActionSuggestionSchema,
  MessageActionSuggestionsPartSchema,
  MessageMicroAppPartSchema,
  MessageContentPartSchema,
  MessageContentPartsSchema,
} from '../session'

// ---------------------------------------------------------------------------
// MessageAppEmbedPartSchema
// ---------------------------------------------------------------------------
describe('MessageAppEmbedPartSchema', () => {
  it('accepts valid input with all fields', () => {
    const input = { type: 'app-embed', appId: 'chess', sessionId: 'sess-1', title: 'Chess Game' }
    expect(MessageAppEmbedPartSchema.parse(input)).toEqual(input)
  })

  it('accepts valid input without optional title', () => {
    const input = { type: 'app-embed', appId: 'chess', sessionId: 'sess-1' }
    expect(MessageAppEmbedPartSchema.parse(input)).toEqual(input)
  })

  it('rejects missing appId', () => {
    const input = { type: 'app-embed', sessionId: 'sess-1' }
    expect(() => MessageAppEmbedPartSchema.parse(input)).toThrow()
  })

  it('rejects missing sessionId', () => {
    const input = { type: 'app-embed', appId: 'chess' }
    expect(() => MessageAppEmbedPartSchema.parse(input)).toThrow()
  })

  it('rejects wrong type literal', () => {
    const input = { type: 'wrong-type', appId: 'chess', sessionId: 'sess-1' }
    expect(() => MessageAppEmbedPartSchema.parse(input)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// ActionSuggestionSchema
// ---------------------------------------------------------------------------
describe('ActionSuggestionSchema', () => {
  it('accepts valid input with all fields', () => {
    const input = { label: 'Play e4', icon: 'chess-pawn', toolName: 'make_move', args: { move: 'e4' } }
    expect(ActionSuggestionSchema.parse(input)).toEqual(input)
  })

  it('accepts valid input without optional icon', () => {
    const input = { label: 'Play e4', toolName: 'make_move', args: { move: 'e4' } }
    expect(ActionSuggestionSchema.parse(input)).toEqual(input)
  })

  it('rejects missing label', () => {
    const input = { toolName: 'make_move', args: { move: 'e4' } }
    expect(() => ActionSuggestionSchema.parse(input)).toThrow()
  })

  it('rejects missing toolName', () => {
    const input = { label: 'Play e4', args: { move: 'e4' } }
    expect(() => ActionSuggestionSchema.parse(input)).toThrow()
  })

  it('rejects missing args', () => {
    const input = { label: 'Play e4', toolName: 'make_move' }
    expect(() => ActionSuggestionSchema.parse(input)).toThrow()
  })

  it('accepts args with various value types', () => {
    const input = {
      label: 'Complex',
      toolName: 'do_stuff',
      args: {
        str: 'hello',
        num: 42,
        bool: true,
        nested: { a: 1 },
        arr: [1, 2, 3],
        nil: null,
      },
    }
    expect(ActionSuggestionSchema.parse(input)).toEqual(input)
  })
})

// ---------------------------------------------------------------------------
// MessageActionSuggestionsPartSchema
// ---------------------------------------------------------------------------
describe('MessageActionSuggestionsPartSchema', () => {
  it('accepts valid input with suggestions array', () => {
    const input = {
      type: 'action-suggestions',
      suggestions: [
        { label: 'Play e4', toolName: 'make_move', args: { move: 'e4' } },
        { label: 'Resign', icon: 'flag', toolName: 'resign', args: {} },
      ],
    }
    expect(MessageActionSuggestionsPartSchema.parse(input)).toEqual(input)
  })

  it('accepts valid input with empty suggestions', () => {
    const input = { type: 'action-suggestions', suggestions: [] }
    expect(MessageActionSuggestionsPartSchema.parse(input)).toEqual(input)
  })

  it('rejects missing suggestions', () => {
    const input = { type: 'action-suggestions' }
    expect(() => MessageActionSuggestionsPartSchema.parse(input)).toThrow()
  })

  it('rejects wrong type literal', () => {
    const input = { type: 'wrong', suggestions: [] }
    expect(() => MessageActionSuggestionsPartSchema.parse(input)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// MessageMicroAppPartSchema
// ---------------------------------------------------------------------------
describe('MessageMicroAppPartSchema', () => {
  it('accepts valid input with all fields', () => {
    const input = {
      type: 'micro-app',
      html: '<div>Hello</div>',
      title: 'My Widget',
      sessionId: 'sess-1',
    }
    expect(MessageMicroAppPartSchema.parse(input)).toEqual(input)
  })

  it('accepts valid input without optional title', () => {
    const input = { type: 'micro-app', html: '<div>Hello</div>', sessionId: 'sess-1' }
    expect(MessageMicroAppPartSchema.parse(input)).toEqual(input)
  })

  it('rejects missing html', () => {
    const input = { type: 'micro-app', sessionId: 'sess-1' }
    expect(() => MessageMicroAppPartSchema.parse(input)).toThrow()
  })

  it('rejects missing sessionId', () => {
    const input = { type: 'micro-app', html: '<div>Hello</div>' }
    expect(() => MessageMicroAppPartSchema.parse(input)).toThrow()
  })

  it('rejects wrong type literal', () => {
    const input = { type: 'wrong', html: '<div>Hello</div>', sessionId: 'sess-1' }
    expect(() => MessageMicroAppPartSchema.parse(input)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// MessageContentPartSchema (discriminated union)
// ---------------------------------------------------------------------------
describe('MessageContentPartSchema', () => {
  it('accepts text part', () => {
    const input = { type: 'text', text: 'Hello world' }
    expect(MessageContentPartSchema.parse(input)).toEqual(input)
  })

  it('accepts image part', () => {
    const input = { type: 'image', storageKey: 'img-abc123' }
    expect(MessageContentPartSchema.parse(input)).toEqual(input)
  })

  it('accepts info part', () => {
    const input = { type: 'info', text: 'Info message' }
    expect(MessageContentPartSchema.parse(input)).toEqual(input)
  })

  it('accepts reasoning part', () => {
    const input = { type: 'reasoning', text: 'Thinking...' }
    expect(MessageContentPartSchema.parse(input)).toEqual(input)
  })

  it('accepts tool-call part', () => {
    const input = {
      type: 'tool-call',
      state: 'call',
      toolCallId: 'tc-1',
      toolName: 'make_move',
      args: { move: 'e4' },
    }
    expect(MessageContentPartSchema.parse(input)).toEqual(input)
  })

  it('accepts app-embed part', () => {
    const input = { type: 'app-embed', appId: 'chess', sessionId: 'sess-1' }
    expect(MessageContentPartSchema.parse(input)).toEqual(input)
  })

  it('accepts action-suggestions part', () => {
    const input = {
      type: 'action-suggestions',
      suggestions: [{ label: 'Go', toolName: 'go', args: {} }],
    }
    expect(MessageContentPartSchema.parse(input)).toEqual(input)
  })

  it('accepts micro-app part', () => {
    const input = { type: 'micro-app', html: '<p>Hi</p>', sessionId: 'sess-1' }
    expect(MessageContentPartSchema.parse(input)).toEqual(input)
  })

  it('rejects unknown type', () => {
    const input = { type: 'unknown-type', data: 'something' }
    expect(() => MessageContentPartSchema.parse(input)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// MessageContentPartsSchema (array)
// ---------------------------------------------------------------------------
describe('MessageContentPartsSchema', () => {
  it('accepts array of mixed parts', () => {
    const input = [
      { type: 'text', text: 'Hello' },
      { type: 'app-embed', appId: 'chess', sessionId: 'sess-1' },
      { type: 'action-suggestions', suggestions: [{ label: 'Go', toolName: 'go', args: {} }] },
      { type: 'micro-app', html: '<p>Hi</p>', sessionId: 'sess-2' },
    ]
    expect(MessageContentPartsSchema.parse(input)).toEqual(input)
  })

  it('accepts empty array', () => {
    expect(MessageContentPartsSchema.parse([])).toEqual([])
  })
})
