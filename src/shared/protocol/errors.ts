/**
 * Unified error type for the ChatBridge protocol.
 * Used across bridge, manager, and tool-bridge for consistent error handling.
 */
export class ChatBridgeError extends Error {
  constructor(
    public code: number,
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'ChatBridgeError'
  }
}
