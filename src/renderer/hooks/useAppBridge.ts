import { useEffect, useRef, useCallback } from 'react'
import { appBridgeManager } from '@/packages/app-bridge'
import { BUILT_IN_MANIFESTS } from '@/packages/app-bridge/manifests'
import type { AppManifest, AppSession } from '@shared/protocol/types'

/**
 * Initialize the app bridge system. Call once at app root.
 */
export function useAppBridgeInit() {
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // Register built-in app manifests
    for (const manifest of BUILT_IN_MANIFESTS) {
      appBridgeManager.registerManifest(manifest)
    }
  }, [])
}

/**
 * Hook to launch an app and create a session.
 * Returns a function that creates a session and returns the content part to insert.
 */
export function useAppLauncher() {
  const launchApp = useCallback(
    (appId: string, conversationId: string): AppSession | null => {
      const manifest = appBridgeManager.getManifest(appId)
      if (!manifest) {
        console.error(`[useAppLauncher] No manifest for app: ${appId}`)
        return null
      }
      return appBridgeManager.createSession(manifest, conversationId)
    },
    []
  )

  return { launchApp }
}
