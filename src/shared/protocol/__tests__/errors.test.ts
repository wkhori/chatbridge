import { describe, it, expect } from 'vitest'
import { ChatBridgeError } from '../errors'

describe('ChatBridgeError', () => {
  it('constructs with code and message', () => {
    const error = new ChatBridgeError(1001, 'Invalid message')
    expect(error.code).toBe(1001)
    expect(error.message).toBe('Invalid message')
    expect(error.name).toBe('ChatBridgeError')
  })

  it('constructs with details', () => {
    const details = { field: 'nonce', expected: 'number' }
    const error = new ChatBridgeError(1001, 'Invalid message', details)
    expect(error.details).toEqual(details)
  })

  it('is instanceof Error', () => {
    const error = new ChatBridgeError(1001, 'test')
    expect(error).toBeInstanceOf(Error)
  })

  it('is instanceof ChatBridgeError', () => {
    const error = new ChatBridgeError(1001, 'test')
    expect(error).toBeInstanceOf(ChatBridgeError)
  })

  it('has correct stack trace', () => {
    const error = new ChatBridgeError(1001, 'test')
    expect(error.stack).toBeDefined()
    expect(error.stack).toContain('ChatBridgeError')
  })

  it('defaults details to undefined', () => {
    const error = new ChatBridgeError(1001, 'test')
    expect(error.details).toBeUndefined()
  })
})
