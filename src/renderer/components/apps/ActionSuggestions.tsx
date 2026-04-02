import type { ActionSuggestion } from '@shared/types'

interface ActionSuggestionsProps {
  suggestions: ActionSuggestion[]
  onAction?: (suggestion: ActionSuggestion) => void
}

export function ActionSuggestions({ suggestions, onAction }: ActionSuggestionsProps) {
  if (!suggestions.length) return null

  return (
    <div className="flex flex-wrap gap-2 my-2">
      {suggestions.map((suggestion, i) => (
        <button
          key={`${suggestion.toolName}-${i}`}
          onClick={() => onAction?.(suggestion)}
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
}
