import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader, Text } from '@mantine/core'
import { IconAlertTriangle, IconRefresh, IconWifi } from '@tabler/icons-react'
import { appBridgeManager } from '@/packages/app-bridge'
import { BRIDGE_POLL_INTERVAL, IFRAME_MIN_HEIGHT, IFRAME_MAX_HEIGHT, READY_TIMEOUT } from '@shared/protocol/types'

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
  const [heartbeatWarning, setHeartbeatWarning] = useState(false)

  const manifest = appBridgeManager.getManifest(appId)

  // Attach bridge when iframe mounts
  useEffect(() => {
    if (!manifest || !iframeRef.current) return

    // View-only apps skip bridge setup entirely
    if (manifest.viewOnly) {
      setStatus('ready')
      return
    }

    const cleanups: Array<() => void> = []

    appBridgeManager.attachBridge(sessionId, iframeRef.current)

    // Track session status changes
    const offSession = appBridgeManager.onSessionChange((session) => {
      if (session.id !== sessionId) return
      switch (session.status) {
        case 'ready':
        case 'active':
          setStatus('ready')
          setHeartbeatWarning(false)
          break
        case 'error':
          setStatus('error')
          setError('App encountered an error')
          break
      }
    })
    cleanups.push(offSession)

    // Once bridge exists, listen for heartbeat timeouts + UI_RESIZE via bridge events
    const pollForBridge = setInterval(() => {
      const bridge = appBridgeManager.getBridge(sessionId)
      if (!bridge) return
      clearInterval(pollForBridge)

      const offHb = bridge.on('heartbeat_timeout', () => {
        setHeartbeatWarning(true)
      })
      cleanups.push(offHb)

      const offResize = bridge.on('ui_resize', (event) => {
        const { height } = event.data as { height: number }
        setIframeHeight(Math.min(Math.max(height, IFRAME_MIN_HEIGHT), IFRAME_MAX_HEIGHT))
      })
      cleanups.push(offResize)
    }, BRIDGE_POLL_INTERVAL)
    cleanups.push(() => clearInterval(pollForBridge))

    // Timeout for READY
    const readyTimeout = setTimeout(() => {
      setStatus((prev) => {
        if (prev === 'loading') {
          setError(`App failed to load within ${READY_TIMEOUT / 1000} seconds`)
          return 'error'
        }
        return prev
      })
    }, READY_TIMEOUT)
    cleanups.push(() => clearTimeout(readyTimeout))

    return () => {
      for (const fn of cleanups) fn()
      appBridgeManager.detachBridge(sessionId)
    }
  }, [manifest, appId, sessionId])

  const handleRetry = useCallback(() => {
    setStatus('loading')
    setError(null)
    setHeartbeatWarning(false)
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

      {/* Heartbeat warning */}
      {heartbeatWarning && status === 'ready' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800">
          <IconWifi size={14} className="text-yellow-600 dark:text-yellow-400" />
          <Text size="xs" className="text-yellow-700 dark:text-yellow-300">
            App is not responding — it may have frozen
          </Text>
          <button
            onClick={handleRetry}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-yellow-100 dark:bg-yellow-800 text-yellow-700 dark:text-yellow-300 hover:opacity-80 transition-opacity cursor-pointer border-none"
          >
            <IconRefresh size={12} />
            Reload
          </button>
        </div>
      )}

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
        sandbox={
          manifest.auth?.type === 'oauth2'
            ? 'allow-scripts allow-popups allow-popups-to-escape-sandbox'
            : 'allow-scripts'
        }
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
