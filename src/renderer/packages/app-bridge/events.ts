/**
 * ChatBridge global events — lightweight event bus for cross-component communication.
 * Used for action suggestion clicks, app launches, etc.
 */

export const CHATBRIDGE_EVENTS = {
  /** User clicked an action suggestion button. Payload: { text: string } */
  ACTION_SUGGESTION_CLICK: 'chatbridge:action-suggestion-click',
  /** Request to launch an app. Payload: { appId: string } */
  LAUNCH_APP: 'chatbridge:launch-app',
} as const

export function dispatchChatBridgeEvent(type: string, detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent(type, { detail }))
}

export function onChatBridgeEvent(type: string, handler: (detail: Record<string, unknown>) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent).detail)
  window.addEventListener(type, listener)
  return () => window.removeEventListener(type, listener)
}
