import type { AppManifest } from '@shared/protocol/types'
import { INACTIVE_DEMOTION_MS } from '@shared/protocol/types'
import { appBridgeManager } from './manager'

export type InjectionTier = 'full' | 'summary' | 'none'

interface TierState {
  tier: InjectionTier
  lastActiveAt: number
  reason: string
}

/**
 * App routing: detects which apps are relevant based on user message keywords,
 * manages tier promotion/demotion for context window optimization.
 */
class AppRouter {
  private tiers = new Map<string, TierState>()

  /**
   * Analyze a user message and promote relevant apps to higher tiers.
   * Call this before each AI request.
   */
  promoteByMessage(message: string): void {
    const lower = message.toLowerCase()
    const manifests = appBridgeManager.getAllManifests()

    for (const [appId, manifest] of Object.entries(manifests)) {
      const keywords = manifest.keywords || []
      const nameMatch = lower.includes(manifest.name.toLowerCase())
      const keywordMatch = keywords.some((kw) => lower.includes(kw.toLowerCase()))

      if (nameMatch || keywordMatch) {
        this.promote(appId, keywordMatch ? `keyword match` : `name match`)
      }
    }

    // Demote stale apps
    this.demoteStale()
  }

  /**
   * Promote an app to Tier 1 (full tool injection).
   */
  promote(appId: string, reason: string): void {
    this.tiers.set(appId, {
      tier: 'full',
      lastActiveAt: Date.now(),
      reason,
    })
  }

  /**
   * Demote apps that have been inactive for too long.
   */
  demoteStale(): void {
    const now = Date.now()
    for (const [appId, state] of this.tiers) {
      if (state.tier === 'full' && now - state.lastActiveAt > INACTIVE_DEMOTION_MS) {
        this.tiers.set(appId, {
          ...state,
          tier: 'summary',
          reason: 'inactive demotion',
        })
      }
    }
  }

  /**
   * Get the current tier for an app.
   */
  getTier(appId: string): InjectionTier {
    return this.tiers.get(appId)?.tier || 'none'
  }

  /**
   * Get all tier states for debugging/display.
   */
  getAllTiers(): Record<string, TierState> {
    return Object.fromEntries(this.tiers)
  }

  /**
   * Reset all tiers (e.g., on conversation switch).
   */
  reset(): void {
    this.tiers.clear()
  }
}

export const appRouter = new AppRouter()
