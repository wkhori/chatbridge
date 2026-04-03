import { memo } from 'react'
import type { ActionSuggestion } from '@shared/types'
import { CHATBRIDGE_EVENTS, dispatchChatBridgeEvent } from '@/packages/app-bridge/events'

interface ActionSuggestionsProps {
  suggestions: ActionSuggestion[]
}

export const ActionSuggestions = memo(function ActionSuggestions({ suggestions }: ActionSuggestionsProps) {
  if (!suggestions.length) return null

  const handleClick = (suggestion: ActionSuggestion) => {
    // Dispatch as a user message — the AI will process it and invoke the tool
    dispatchChatBridgeEvent(CHATBRIDGE_EVENTS.ACTION_SUGGESTION_CLICK, {
      text: suggestion.label,
      toolName: suggestion.toolName,
      args: suggestion.args,
    })
  }

  return (
    <div className="flex flex-wrap gap-2 my-2">
      {suggestions.map((suggestion, i) => (
        <button
          key={`${suggestion.toolName}-${i}`}
          onClick={() => handleClick(suggestion)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
            bg-chatbox-background-brand-secondary text-chatbox-tint-brand
            hover:opacity-80 transition-opacity cursor-pointer
            border border-chatbox-border-brand"
        >
          {suggestion.icon && <span>{suggestion.icon}</span>}
          <span>{suggestion.label}</span>
        </button>
      ))}
    </div>
  )
})
