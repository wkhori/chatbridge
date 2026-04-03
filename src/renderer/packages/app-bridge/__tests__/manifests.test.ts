import { describe, it, expect } from 'vitest'
import { CHESS_MANIFEST, WHITEBOARD_MANIFEST, CLASSROOM_MANIFEST, BUILT_IN_MANIFESTS } from '../manifests'
import { AppManifestSchema } from '@shared/protocol/types'

const RESERVED_IDS = ['system', 'admin', 'platform', 'chatbridge', 'root', 'internal']

// ---------------------------------------------------------------------------
// BUILT_IN_MANIFESTS collection
// ---------------------------------------------------------------------------
describe('BUILT_IN_MANIFESTS', () => {
  it('contains exactly 3 manifests', () => {
    expect(BUILT_IN_MANIFESTS).toHaveLength(3)
  })

  it('all manifests have unique IDs', () => {
    const ids = BUILT_IN_MANIFESTS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all manifests pass AppManifestSchema validation', () => {
    for (const manifest of BUILT_IN_MANIFESTS) {
      expect(() => AppManifestSchema.parse(manifest)).not.toThrow()
    }
  })

  it('all manifests have required fields', () => {
    for (const manifest of BUILT_IN_MANIFESTS) {
      expect(manifest.id).toBeDefined()
      expect(manifest.name).toBeDefined()
      expect(manifest.version).toBeDefined()
      expect(manifest.description).toBeDefined()
      expect(manifest.url).toBeDefined()
      expect(manifest.icon).toBeDefined()
      expect(manifest.permissions).toBeDefined()
      expect(manifest.auth).toBeDefined()
      expect(manifest.keywords).toBeDefined()
    }
  })

  it('no manifest uses reserved IDs', () => {
    for (const manifest of BUILT_IN_MANIFESTS) {
      expect(RESERVED_IDS).not.toContain(manifest.id)
    }
  })
})

// ---------------------------------------------------------------------------
// Chess manifest
// ---------------------------------------------------------------------------
describe('CHESS_MANIFEST', () => {
  it('has correct ID', () => {
    expect(CHESS_MANIFEST.id).toBe('chess')
  })

  it('has correct name', () => {
    expect(CHESS_MANIFEST.name).toBe('Chess')
  })

  it('uses no auth', () => {
    expect(CHESS_MANIFEST.auth.type).toBe('none')
  })

  it('has chess-related keywords', () => {
    expect(CHESS_MANIFEST.keywords).toEqual(expect.arrayContaining(['chess', 'game', 'move', 'checkmate']))
  })

  it('is NOT viewOnly', () => {
    expect(CHESS_MANIFEST.viewOnly).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Whiteboard manifest
// ---------------------------------------------------------------------------
describe('WHITEBOARD_MANIFEST', () => {
  it('has correct ID', () => {
    expect(WHITEBOARD_MANIFEST.id).toBe('whiteboard')
  })

  it('has correct name', () => {
    expect(WHITEBOARD_MANIFEST.name).toBe('cre8 Whiteboard')
  })

  it('uses no auth', () => {
    expect(WHITEBOARD_MANIFEST.auth.type).toBe('none')
  })

  it('is viewOnly', () => {
    expect(WHITEBOARD_MANIFEST.viewOnly).toBe(true)
  })

  it('has vision permission', () => {
    expect(WHITEBOARD_MANIFEST.permissions).toContain('vision')
  })
})

// ---------------------------------------------------------------------------
// Classroom manifest
// ---------------------------------------------------------------------------
describe('CLASSROOM_MANIFEST', () => {
  it('has correct ID', () => {
    expect(CLASSROOM_MANIFEST.id).toBe('classroom')
  })

  it('uses OAuth2 auth', () => {
    expect(CLASSROOM_MANIFEST.auth.type).toBe('oauth2')
  })

  it('has Google provider', () => {
    expect(CLASSROOM_MANIFEST.auth.provider).toBe('google')
  })

  it('has OAuth scopes', () => {
    expect(CLASSROOM_MANIFEST.auth.scopes).toBeDefined()
    expect(CLASSROOM_MANIFEST.auth.scopes!.length).toBeGreaterThan(0)
    expect(CLASSROOM_MANIFEST.auth.scopes).toContain('classroom.courses.readonly')
  })

  it('has classroom-related keywords', () => {
    expect(CLASSROOM_MANIFEST.keywords).toEqual(
      expect.arrayContaining(['classroom', 'courses', 'assignments', 'google']),
    )
  })
})
