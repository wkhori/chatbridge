import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { MICRO_APP_MIN_HEIGHT, MICRO_APP_MAX_HEIGHT, MICRO_APP_MAX_SIZE } from '@shared/protocol/types'

// Bridge SDK injected into micro-app iframes
const BRIDGE_SDK = `
<script>
(function() {
  var ChatBridge = {
    sendResult: function(data) {
      window.parent.postMessage({
        protocol: 'chatbridge',
        type: 'TOOL_RESULT',
        payload: { success: true, result: data }
      }, '*');
    },
    requestResize: function(height) {
      window.parent.postMessage({
        protocol: 'chatbridge',
        type: 'UI_RESIZE',
        payload: { height: height }
      }, '*');
    },
    logEvent: function(type, data) {
      window.parent.postMessage({
        protocol: 'chatbridge',
        type: 'STATE_UPDATE',
        payload: { data: { event: type, detail: data } }
      }, '*');
    }
  };
  window.ChatBridge = ChatBridge;
})();
</script>
`

// Block dangerous patterns in generated HTML
const BLOCKLIST = [/\beval\s*\(/, /\bnew\s+Function\s*\(/, /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bimportScripts\b/]

function validateHtml(html: string): string | null {
  if (html.length > MICRO_APP_MAX_SIZE) return `Micro-app exceeds ${MICRO_APP_MAX_SIZE / 1024}KB size limit`
  for (const pattern of BLOCKLIST) {
    if (pattern.test(html)) return `Blocked pattern detected: ${pattern.source}`
  }
  return null
}

interface MicroAppRendererProps {
  html: string
  title?: string
  sessionId: string
}

export function MicroAppRenderer({ html, title, sessionId }: MicroAppRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(300)
  const [error, setError] = useState<string | null>(null)

  const validationError = useMemo(() => validateHtml(html), [html])

  // Inject bridge SDK and CSP meta tag
  const wrappedHtml = useMemo(() => {
    if (validationError) return ''
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;">`
    // Insert bridge SDK and CSP before closing </head> or at start
    if (html.includes('</head>')) {
      return html.replace('</head>', `${csp}${BRIDGE_SDK}</head>`)
    }
    return `<!DOCTYPE html><html><head>${csp}${BRIDGE_SDK}</head><body>${html}</body></html>`
  }, [html, validationError])

  const blobUrl = useMemo(() => {
    if (!wrappedHtml) return null
    const blob = new Blob([wrappedHtml], { type: 'text/html' })
    return URL.createObjectURL(blob)
  }, [wrappedHtml])

  // Clean up blob URL
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  // Listen for resize messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.protocol !== 'chatbridge') return
      if (event.data?.type === 'UI_RESIZE' && typeof event.data.payload?.height === 'number') {
        setHeight(Math.min(Math.max(event.data.payload.height, MICRO_APP_MIN_HEIGHT), MICRO_APP_MAX_HEIGHT))
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  if (validationError) {
    return (
      <div className="flex items-center gap-2 p-3 my-2 rounded-lg bg-chatbox-background-error-secondary text-chatbox-tint-error">
        <IconAlertTriangle size={16} />
        <Text size="sm">{validationError}</Text>
      </div>
    )
  }

  if (!blobUrl) {
    return (
      <div className="flex items-center gap-2 p-3 my-2">
        <Loader size={14} />
        <Text size="sm" className="text-chatbox-tint-secondary">Loading micro-app...</Text>
      </div>
    )
  }

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-chatbox-border-primary">
      {title && (
        <div className="px-3 py-1.5 bg-chatbox-background-gray-secondary border-b border-chatbox-border-primary">
          <Text size="xs" fw={500} className="text-chatbox-tint-secondary">
            {title}
          </Text>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={blobUrl}
        sandbox="allow-scripts"
        allow="accelerometer 'none'; camera 'none'; geolocation 'none'; microphone 'none'; clipboard-write 'none'"
        className="w-full border-none"
        style={{ height: `${height}px` }}
        title={title || 'Interactive widget'}
      />
    </div>
  )
}
