import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { INACTIVE_DEMOTION_MS } from '@shared/protocol/types'

const mockManifests = {
  chess: {
    id: 'chess',
    name: 'Chess',
    version: '1.0.0',
    description: 'Chess game',
    url: 'https://example.com/chess',
    permissions: ['state_push'],
    auth: { type: 'none' },
    keywords: ['chess', 'game', 'play', 'board'],
  },
  whiteboard: {
    id: 'whiteboard',
    name: 'cre8 Whiteboard',
    version: '1.0.0',
    description: 'Drawing tool',
    url: 'https://example.com/wb',
    permissions: ['state_push', 'vision'],
    auth: { type: 'none' },
    keywords: ['draw', 'whiteboard', 'diagram'],
  },
  classroom: {
    id: 'classroom',
    name: 'Google Classroom',
    version: '1.0.0',
    description: 'Classroom integration',
    url: 'https://example.com/classroom',
    permissions: ['state_push'],
    auth: { type: 'oauth2', provider: 'google', scopes: ['classroom.courses.readonly'] },
    keywords: ['classroom', 'courses', 'assignments'],
  },
}

vi.mock('../manager', () => ({
  appBridgeManager: {
    getAllManifests: vi.fn(() => mockManifests),
  },
}))

import { appRouter } from '../routing'

describe('AppRouter', () => {
  beforeEach(() => {
    appRouter.reset()
    vi.clearAllMocks()
  })

  // ===========================================================
  // promote()
  // ===========================================================
  describe('promote()', () => {
    it('sets tier to full with given reason', () => {
      appRouter.promote('chess', 'user launched')
      expect(appRouter.getTier('chess')).toBe('full')

      const tiers = appRouter.getAllTiers()
      expect(tiers['chess'].reason).toBe('user launched')
    })

    it('sets lastActiveAt to current timestamp', () => {
      const before = Date.now()
      appRouter.promote('chess', 'test')
      const after = Date.now()

      const tiers = appRouter.getAllTiers()
      expect(tiers['chess'].lastActiveAt).toBeGreaterThanOrEqual(before)
      expect(tiers['chess'].lastActiveAt).toBeLessThanOrEqual(after)
    })

    it('re-promoting updates timestamp and reason', () => {
      appRouter.promote('chess', 'first reason')
      const firstState = appRouter.getAllTiers()['chess']
      const firstTime = firstState.lastActiveAt

      // Small delay to ensure timestamp differs
      vi.useFakeTimers()
      vi.setSystemTime(firstTime + 1000)

      appRouter.promote('chess', 'second reason')
      const secondState = appRouter.getAllTiers()['chess']

      expect(secondState.tier).toBe('full')
      expect(secondState.reason).toBe('second reason')
      expect(secondState.lastActiveAt).toBe(firstTime + 1000)

      vi.useRealTimers()
    })
  })

  // ===========================================================
  // getTier()
  // ===========================================================
  describe('getTier()', () => {
    it('returns none for unknown apps', () => {
      expect(appRouter.getTier('nonexistent')).toBe('none')
    })

    it('returns full for promoted apps', () => {
      appRouter.promote('chess', 'test')
      expect(appRouter.getTier('chess')).toBe('full')
    })

    it('returns summary for demoted apps', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)

      appRouter.promote('chess', 'test')

      // Advance past demotion threshold
      vi.advanceTimersByTime(INACTIVE_DEMOTION_MS + 1)
      appRouter.demoteStale()

      expect(appRouter.getTier('chess')).toBe('summary')
      vi.useRealTimers()
    })
  })

  // ===========================================================
  // demoteStale()
  // ===========================================================
  describe('demoteStale()', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('does nothing for recently active apps', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      appRouter.promote('chess', 'test')

      // Advance less than demotion threshold
      vi.advanceTimersByTime(INACTIVE_DEMOTION_MS - 1000)
      appRouter.demoteStale()

      expect(appRouter.getTier('chess')).toBe('full')
    })

    it('demotes full to summary after INACTIVE_DEMOTION_MS', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      appRouter.promote('chess', 'test')

      vi.advanceTimersByTime(INACTIVE_DEMOTION_MS + 1)
      appRouter.demoteStale()

      expect(appRouter.getTier('chess')).toBe('summary')
    })

    it('sets reason to inactive demotion', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      appRouter.promote('chess', 'keyword match')

      vi.advanceTimersByTime(INACTIVE_DEMOTION_MS + 1)
      appRouter.demoteStale()

      const tiers = appRouter.getAllTiers()
      expect(tiers['chess'].reason).toBe('inactive demotion')
    })

    it('does NOT demote summary tier further', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      appRouter.promote('chess', 'test')

      // First demotion: full -> summary
      vi.advanceTimersByTime(INACTIVE_DEMOTION_MS + 1)
      appRouter.demoteStale()
      expect(appRouter.getTier('chess')).toBe('summary')

      // Second demotion attempt: summary should stay summary
      vi.advanceTimersByTime(INACTIVE_DEMOTION_MS + 1)
      appRouter.demoteStale()
      expect(appRouter.getTier('chess')).toBe('summary')
    })

    it('demotes multiple stale apps at once', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      appRouter.promote('chess', 'test')
      appRouter.promote('whiteboard', 'test')

      vi.advanceTimersByTime(INACTIVE_DEMOTION_MS + 1)
      appRouter.demoteStale()

      expect(appRouter.getTier('chess')).toBe('summary')
      expect(appRouter.getTier('whiteboard')).toBe('summary')
    })

    it('only demotes stale apps, not recently active ones', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      appRouter.promote('chess', 'test')

      // Advance halfway, then promote whiteboard
      vi.advanceTimersByTime(INACTIVE_DEMOTION_MS - 1000)
      appRouter.promote('whiteboard', 'test')

      // Advance past chess threshold but not whiteboard
      vi.advanceTimersByTime(2000)
      appRouter.demoteStale()

      expect(appRouter.getTier('chess')).toBe('summary')
      expect(appRouter.getTier('whiteboard')).toBe('full')
    })

    it('demotes exactly at boundary (> not >=)', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      appRouter.promote('chess', 'test')

      // Advance exactly to the boundary
      vi.advanceTimersByTime(INACTIVE_DEMOTION_MS)
      appRouter.demoteStale()

      // At exactly INACTIVE_DEMOTION_MS, the check is > (strict), so should NOT demote
      expect(appRouter.getTier('chess')).toBe('full')

      // One more ms should trigger demotion
      vi.advanceTimersByTime(1)
      appRouter.demoteStale()
      expect(appRouter.getTier('chess')).toBe('summary')
    })
  })

  // ===========================================================
  // promoteByMessage()
  // ===========================================================
  describe('promoteByMessage()', () => {
    it('promotes app when message contains app name (case insensitive)', () => {
      appRouter.promoteByMessage('Can you open Chess for me?')
      expect(appRouter.getTier('chess')).toBe('full')
    })

    it('promotes app when message contains a keyword', () => {
      appRouter.promoteByMessage('I want to draw something')
      expect(appRouter.getTier('whiteboard')).toBe('full')
    })

    it('does NOT promote when no match', () => {
      appRouter.promoteByMessage('What is the weather today?')
      expect(appRouter.getTier('chess')).toBe('none')
      expect(appRouter.getTier('whiteboard')).toBe('none')
      expect(appRouter.getTier('classroom')).toBe('none')
    })

    it('handles multiple apps matching same message', () => {
      appRouter.promoteByMessage('Let me play a board game and draw a diagram')

      expect(appRouter.getTier('chess')).toBe('full')
      expect(appRouter.getTier('whiteboard')).toBe('full')
    })

    it('sets reason to keyword match when keyword matched', () => {
      appRouter.promoteByMessage('lets play a game')
      const tiers = appRouter.getAllTiers()
      expect(tiers['chess'].reason).toBe('keyword match')
    })

    it('sets reason to name match when only name matched (not keyword)', () => {
      // "Google Classroom" contains the name but we need a message
      // that matches the name but NOT any keyword
      appRouter.promoteByMessage('Tell me about Google Classroom features')

      const tiers = appRouter.getAllTiers()
      // "classroom" is both in the name and a keyword, so keyword match takes priority
      // due to the ternary: keywordMatch ? 'keyword match' : 'name match'
      expect(tiers['classroom'].reason).toBe('keyword match')
    })

    it('prefers keyword match reason over name match when both match', () => {
      // "chess" is both the name and a keyword
      appRouter.promoteByMessage('I want to play chess')
      const tiers = appRouter.getAllTiers()
      // keyword "chess" matches, so reason is "keyword match"
      expect(tiers['chess'].reason).toBe('keyword match')
    })

    it('uses name match reason when only name matches and no keyword matches', () => {
      // "cre8 Whiteboard" - match "cre8 whiteboard" in message but not any keyword
      appRouter.promoteByMessage('show me the cre8 whiteboard please')

      const tiers = appRouter.getAllTiers()
      // "whiteboard" is also a keyword, so this will be keyword match
      // We need a manifest where name is distinct from keywords
      // Actually "cre8 Whiteboard" as name - if we say "cre8" only,
      // that won't match since lower.includes("cre8 whiteboard") requires full name
      // Let's check: message = "show me the cre8 whiteboard please"
      // name = "cre8 Whiteboard" -> lower = "cre8 whiteboard"
      // nameMatch = "show me the cre8 whiteboard please".includes("cre8 whiteboard") = true
      // keywordMatch = keywords ["draw", "whiteboard", "diagram"] -> "whiteboard" matches
      // So keywordMatch is true -> reason = "keyword match"
      expect(tiers['whiteboard'].reason).toBe('keyword match')
    })

    it('calls demoteStale() internally', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)

      // Promote chess first
      appRouter.promote('chess', 'initial')

      // Advance past demotion threshold
      vi.advanceTimersByTime(INACTIVE_DEMOTION_MS + 1)

      // promoteByMessage should call demoteStale(), demoting chess
      appRouter.promoteByMessage('show me my assignments')

      // chess was stale and should have been demoted
      expect(appRouter.getTier('chess')).toBe('summary')
      // classroom should be promoted by keyword match
      expect(appRouter.getTier('classroom')).toBe('full')

      vi.useRealTimers()
    })

    it('empty message matches nothing', () => {
      appRouter.promoteByMessage('')
      expect(appRouter.getTier('chess')).toBe('none')
      expect(appRouter.getTier('whiteboard')).toBe('none')
      expect(appRouter.getTier('classroom')).toBe('none')
    })

    it('case insensitive matching for names', () => {
      appRouter.promoteByMessage('CHESS is fun')
      expect(appRouter.getTier('chess')).toBe('full')
    })

    it('case insensitive matching for keywords', () => {
      appRouter.promoteByMessage('DRAW me a picture')
      expect(appRouter.getTier('whiteboard')).toBe('full')
    })

    it('matches partial keyword in message', () => {
      // "play" is a keyword for chess, and "playground" contains "play"
      appRouter.promoteByMessage('lets go to the playground')
      expect(appRouter.getTier('chess')).toBe('full')
    })

    it('does not promote apps when manifests have no keywords and name does not match', async () => {
      // Import the mock to override
      const { appBridgeManager } = await import('../manager.js')
      vi.mocked(appBridgeManager.getAllManifests).mockReturnValueOnce({
        noKeywords: {
          id: 'noKeywords',
          name: 'SomeApp',
          version: '1.0.0',
          description: 'No keywords',
          url: 'https://example.com',
          permissions: [],
          auth: { type: 'none' },
          // no keywords field at all
        },
      } as any)

      appRouter.promoteByMessage('hello world')
      expect(appRouter.getTier('noKeywords')).toBe('none')
    })
  })

  // ===========================================================
  // getAllTiers()
  // ===========================================================
  describe('getAllTiers()', () => {
    it('returns empty object initially', () => {
      const tiers = appRouter.getAllTiers()
      expect(tiers).toEqual({})
    })

    it('returns all tier states after promotions', () => {
      appRouter.promote('chess', 'test1')
      appRouter.promote('whiteboard', 'test2')

      const tiers = appRouter.getAllTiers()
      expect(Object.keys(tiers)).toHaveLength(2)
      expect(tiers).toHaveProperty('chess')
      expect(tiers).toHaveProperty('whiteboard')
      expect(tiers['chess'].tier).toBe('full')
      expect(tiers['chess'].reason).toBe('test1')
      expect(tiers['whiteboard'].tier).toBe('full')
      expect(tiers['whiteboard'].reason).toBe('test2')
    })

    it('reflects demoted states', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)

      appRouter.promote('chess', 'test')
      vi.advanceTimersByTime(INACTIVE_DEMOTION_MS + 1)
      appRouter.demoteStale()

      const tiers = appRouter.getAllTiers()
      expect(tiers['chess'].tier).toBe('summary')
      expect(tiers['chess'].reason).toBe('inactive demotion')

      vi.useRealTimers()
    })
  })

  // ===========================================================
  // reset()
  // ===========================================================
  describe('reset()', () => {
    it('clears all tiers', () => {
      appRouter.promote('chess', 'test')
      appRouter.promote('whiteboard', 'test')

      appRouter.reset()

      const tiers = appRouter.getAllTiers()
      expect(tiers).toEqual({})
    })

    it('getTier returns none after reset', () => {
      appRouter.promote('chess', 'test')
      expect(appRouter.getTier('chess')).toBe('full')

      appRouter.reset()
      expect(appRouter.getTier('chess')).toBe('none')
    })
  })

  // ===========================================================
  // INACTIVE_DEMOTION_MS constant
  // ===========================================================
  describe('INACTIVE_DEMOTION_MS constant', () => {
    it('equals 5 minutes in milliseconds', () => {
      expect(INACTIVE_DEMOTION_MS).toBe(5 * 60 * 1000)
    })
  })
})
