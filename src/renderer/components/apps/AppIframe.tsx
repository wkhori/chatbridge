import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader, Text } from '@mantine/core'
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react'
import { appBridgeManager } from '@/packages/app-bridge'

interface AppIframeProps {
  appId: string
  sessionId: string
  title?: string
}

export function AppIframe({ appId, sessionId, title }: AppIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [iframeHeight, setIframeHeight] = useState(400)
  const [error, setError] = useState<string | null>(null)

  const manifest = appBridgeManager.getManifest(appId)

  // Attach bridge when iframe mounts
  useEffect(() => {
    if (!manifest || !iframeRef.current) return

    appBridgeManager.attachBridge(sessionId, iframeRef.current)

    const off = appBridgeManager.onSessionChange((session) => {
      if (session.id !== sessionId) return
      switch (session.status) {
        case 'ready':
        case 'active':
          setStatus('ready')
          break
        case 'error':
          setStatus('error')
          setError('App encountered an error')
          break
      }
    })

    // Listen for UI_RESIZE from the bridge event system
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.protocol !== 'chatbridge') return
      if (event.data?.appId !== appId) return
      if (event.data?.type === 'UI_RESIZE' && typeof event.data.payload?.height === 'number') {
        setIframeHeight(Math.min(Math.max(event.data.payload.height, 200), 800))
      }
    }
    window.addEventListener('message', handleMessage)

    // Timeout for READY
    const readyTimeout = setTimeout(() => {
      setStatus((prev) => {
        if (prev === 'loading') {
          setError('App failed to load within 15 seconds')
          return 'error'
        }
        return prev
      })
    }, 15000)

    return () => {
      off()
      window.removeEventListener('message', handleMessage)
      clearTimeout(readyTimeout)
      appBridgeManager.detachBridge(sessionId)
    }
  }, [manifest, appId, sessionId])

  const handleRetry = useCallback(() => {
    setStatus('loading')
    setError(null)
    if (iframeRef.current && manifest) {
      iframeRef.current.src = manifest.url
    }
  }, [manifest])

  if (!manifest) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-chatbox-background-gray-secondary text-chatbox-tint-secondary">
        <IconAlertTriangle size={16} />
        <Text size="sm">App &quot;{appId}&quot; not found in registry</Text>
      </div>
    )
  }

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-chatbox-border-primary">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-chatbox-background-gray-secondary border-b border-chatbox-border-primary">
        {manifest.icon && <span className="text-sm">{manifest.icon}</span>}
        <Text size="xs" fw={500} className="text-chatbox-tint-secondary">
          {title || manifest.name}
        </Text>
        {status === 'loading' && <Loader size={12} />}
      </div>

      {/* Error state */}
      {status === 'error' && (
        <div className="flex flex-col items-center gap-2 p-6 bg-chatbox-background-gray-secondary">
          <IconAlertTriangle size={24} className="text-chatbox-tint-warning" />
          <Text size="sm" className="text-chatbox-tint-secondary">
            {error || 'Failed to load app'}
          </Text>
          <button
            onClick={handleRetry}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-sm bg-chatbox-background-brand-secondary text-chatbox-tint-brand hover:opacity-80 transition-opacity cursor-pointer border-none"
          >
            <IconRefresh size={14} />
            Try again
          </button>
        </div>
      )}

      {/* iframe */}
      <iframe
        ref={iframeRef}
        src={manifest.url}
        sandbox="allow-scripts"
        allow="accelerometer 'none'; camera 'none'; geolocation 'none'; microphone 'none'; clipboard-write 'none'"
        className="w-full border-none"
        style={{
          height: `${iframeHeight}px`,
          display: status === 'error' ? 'none' : 'block',
        }}
        title={manifest.name}
      />
    </div>
  )
}
