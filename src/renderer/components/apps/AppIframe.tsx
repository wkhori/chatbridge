import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Loader, Text } from '@mantine/core'
import { IconAlertTriangle, IconRefresh, IconWifi } from '@tabler/icons-react'
import { appBridgeManager } from '@/packages/app-bridge'
import { BRIDGE_POLL_INTERVAL, IFRAME_MIN_HEIGHT, IFRAME_MAX_HEIGHT, READY_TIMEOUT } from '@shared/protocol/types'

interface AppIframeProps {
  appId: string
  sessionId: string
  title?: string
}

export const AppIframe = memo(function AppIframe({ appId, sessionId, title }: AppIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [iframeHeight, setIframeHeight] = useState(580)
  const [error, setError] = useState<string | null>(null)
  const [heartbeatWarning, setHeartbeatWarning] = useState(false)

  const manifest = appBridgeManager.getManifest(appId)
  const [retryCount, setRetryCount] = useState(0)

  // Check for stale session (destroyed or missing)
  const session = appBridgeManager.getSession(sessionId)
  const isStaleSession = !session || session.status === 'destroyed'

  // Attach bridge when iframe mounts
  useEffect(() => {
    if (!manifest || !iframeRef.current || isStaleSession) return

    // View-only apps skip bridge setup entirely
    if (manifest.viewOnly) {
      setStatus('ready')
      return
    }

    const cleanups: Array<() => void> = []

    const existingBridge = appBridgeManager.getBridge(sessionId)
    const isFirstAttach = !existingBridge

    // Always ensure iframe src is set — React may create a new iframe DOM element
    // on remount (StrictMode, virtualization) while the bridge object persists.
    const iframeSrc = iframeRef.current.src
    const needsSrc = !iframeSrc || iframeSrc === 'about:blank' || iframeSrc === ''

    if (isFirstAttach) {
      // First time: set src after bridge listener is attached to avoid race
      iframeRef.current.src = 'about:blank'
    }

    // Idempotent: creates new bridge on first call, swaps iframe ref on subsequent
    appBridgeManager.attachBridge(sessionId, iframeRef.current)

    if (needsSrc && iframeRef.current) {
      iframeRef.current.src = manifest.url
    }

    // If bridge was already ready (e.g. StrictMode remount), update status immediately
    const bridge = appBridgeManager.getBridge(sessionId)
    if (bridge?.isReady) {
      setStatus('ready')
    }

    // Track session status changes — only update state when it actually changes
    const offSession = appBridgeManager.onSessionChange((s) => {
      if (s.id !== sessionId) return
      switch (s.status) {
        case 'ready':
        case 'active':
          setStatus((prev) => prev === 'ready' ? prev : 'ready')
          setHeartbeatWarning(false)
          break
        case 'error':
          setStatus('error')
          setError('App encountered an error')
          break
      }
    })
    cleanups.push(offSession)

    // Listen for heartbeat timeouts + UI_RESIZE via bridge events
    if (bridge) {
      const offHb = bridge.on('heartbeat_timeout', () => {
        setHeartbeatWarning(true)
      })
      cleanups.push(offHb)

      const offResize = bridge.on('ui_resize', (event) => {
        const { height } = event.data as { height: number }
        setIframeHeight(Math.min(Math.max(height, IFRAME_MIN_HEIGHT), IFRAME_MAX_HEIGHT))
      })
      cleanups.push(offResize)
    } else {
      // Poll for bridge to become available (first attach)
      const pollForBridge = setInterval(() => {
        const b = appBridgeManager.getBridge(sessionId)
        if (!b) return
        clearInterval(pollForBridge)

        const offHb = b.on('heartbeat_timeout', () => {
          setHeartbeatWarning(true)
        })
        cleanups.push(offHb)

        const offResize = b.on('ui_resize', (event) => {
          const { height } = event.data as { height: number }
          setIframeHeight(Math.min(Math.max(height, IFRAME_MIN_HEIGHT), IFRAME_MAX_HEIGHT))
        })
        cleanups.push(offResize)
      }, BRIDGE_POLL_INTERVAL)
      cleanups.push(() => clearInterval(pollForBridge))
    }

    // Timeout for READY (only on first attach)
    if (isFirstAttach) {
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
    }

    return () => {
      for (const fn of cleanups) fn()
      // Don't destroy bridge on unmount — just detach iframe ref
      // Bridge stays alive in manager for reconnection
      appBridgeManager.detachIframe(sessionId)
    }
  }, [manifest, appId, sessionId, retryCount, isStaleSession])

  const handleRetry = useCallback(() => {
    // Destroy old bridge so we get a fresh start
    appBridgeManager.detachBridge(sessionId)
    setStatus('loading')
    setError(null)
    setHeartbeatWarning(false)
    setRetryCount((c) => c + 1)
  }, [sessionId])

  if (!manifest) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-chatbox-background-gray-secondary text-chatbox-tint-secondary">
        <IconAlertTriangle size={16} />
        <Text size="sm">App &quot;{appId}&quot; not found in registry</Text>
      </div>
    )
  }

  // Stale session — show compact expired state
  if (isStaleSession) {
    return (
      <div className="my-2 rounded-lg overflow-hidden border border-chatbox-border-primary">
        <div className="flex items-center gap-2 px-3 py-2 bg-chatbox-background-gray-secondary">
          {manifest.icon && <span className="text-sm">{manifest.icon}</span>}
          <Text size="xs" className="text-chatbox-tint-secondary">
            {title || manifest.name} — session ended
          </Text>
        </div>
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

      {/* iframe — always rendered so embedded components can measure dimensions */}
      {status !== 'error' && (
        <iframe
          ref={iframeRef}
          src={manifest.viewOnly ? manifest.url : undefined}
          sandbox={
            manifest.auth?.type === 'oauth2'
              ? 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'
              : 'allow-scripts allow-same-origin'
          }
          allow="accelerometer 'none'; camera 'none'; geolocation 'none'; microphone 'none'; clipboard-write 'none'"
          className="w-full border-none"
          style={{ height: `${iframeHeight}px` }}
          title={manifest.name}
        />
      )}
    </div>
  )
})
