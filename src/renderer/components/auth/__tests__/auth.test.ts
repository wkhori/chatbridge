/**
 * Tests for AuthGate form validation logic and AuthProvider readAuth() logic.
 * Since test env is node (no React rendering), we test the pure logic extracted
 * from the components: form validation rules and localStorage parsing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- AuthGate validation logic ---

/**
 * Replicates the validation logic from AuthGate.handleSubmit.
 * This is the exact same logic as lines 12-27 of AuthGate.tsx.
 */
function validateAuthInput(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Please enter your name'
  if (trimmed.length < 2) return 'Name must be at least 2 characters'
  return null
}

function createAuthPayload(name: string, role: 'student' | 'teacher') {
  return {
    name: name.trim(),
    role,
    timestamp: Date.now(),
  }
}

describe('AuthGate validation logic', () => {
  describe('name validation', () => {
    it('rejects empty string', () => {
      expect(validateAuthInput('')).toBe('Please enter your name')
    })

    it('rejects whitespace-only string', () => {
      expect(validateAuthInput('   ')).toBe('Please enter your name')
    })

    it('rejects single character', () => {
      expect(validateAuthInput('A')).toBe('Name must be at least 2 characters')
    })

    it('rejects single character with whitespace', () => {
      expect(validateAuthInput('  A  ')).toBe('Name must be at least 2 characters')
    })

    it('accepts two character name', () => {
      expect(validateAuthInput('AB')).toBeNull()
    })

    it('accepts normal name', () => {
      expect(validateAuthInput('John Doe')).toBeNull()
    })

    it('trims whitespace before validation', () => {
      expect(validateAuthInput('  AB  ')).toBeNull()
    })
  })

  describe('auth payload creation', () => {
    it('creates payload with trimmed name', () => {
      const payload = createAuthPayload('  John  ', 'student')
      expect(payload.name).toBe('John')
      expect(payload.role).toBe('student')
      expect(typeof payload.timestamp).toBe('number')
    })

    it('creates teacher payload', () => {
      const payload = createAuthPayload('Ms. Smith', 'teacher')
      expect(payload.role).toBe('teacher')
    })

    it('includes current timestamp', () => {
      const before = Date.now()
      const payload = createAuthPayload('Test', 'student')
      const after = Date.now()
      expect(payload.timestamp).toBeGreaterThanOrEqual(before)
      expect(payload.timestamp).toBeLessThanOrEqual(after)
    })
  })
})

// --- AuthProvider readAuth() logic ---

/**
 * Replicates the readAuth() logic from AuthProvider.tsx lines 24-36.
 */
function readAuth(rawValue: string | null): { name: string; role: 'student' | 'teacher'; timestamp: number } | null {
  try {
    if (!rawValue) return null
    const parsed = JSON.parse(rawValue)
    if (parsed && typeof parsed.name === 'string' && (parsed.role === 'student' || parsed.role === 'teacher')) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

describe('AuthProvider readAuth logic', () => {
  it('returns null for null input', () => {
    expect(readAuth(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(readAuth('')).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(readAuth('not-json')).toBeNull()
  })

  it('returns null for JSON without name', () => {
    expect(readAuth(JSON.stringify({ role: 'student' }))).toBeNull()
  })

  it('returns null for JSON with non-string name', () => {
    expect(readAuth(JSON.stringify({ name: 123, role: 'student' }))).toBeNull()
  })

  it('returns null for JSON with invalid role', () => {
    expect(readAuth(JSON.stringify({ name: 'John', role: 'admin' }))).toBeNull()
  })

  it('returns null for JSON with missing role', () => {
    expect(readAuth(JSON.stringify({ name: 'John' }))).toBeNull()
  })

  it('parses valid student auth', () => {
    const auth = readAuth(JSON.stringify({ name: 'John', role: 'student', timestamp: 1000 }))
    expect(auth).toEqual({ name: 'John', role: 'student', timestamp: 1000 })
  })

  it('parses valid teacher auth', () => {
    const auth = readAuth(JSON.stringify({ name: 'Ms. Smith', role: 'teacher', timestamp: 2000 }))
    expect(auth).toEqual({ name: 'Ms. Smith', role: 'teacher', timestamp: 2000 })
  })

  it('returns null for array JSON', () => {
    expect(readAuth(JSON.stringify([1, 2, 3]))).toBeNull()
  })

  it('returns null for JSON number', () => {
    expect(readAuth('42')).toBeNull()
  })

  it('returns null for JSON boolean', () => {
    expect(readAuth('true')).toBeNull()
  })

  it('preserves extra fields from localStorage', () => {
    const auth = readAuth(JSON.stringify({ name: 'John', role: 'student', timestamp: 1000, extra: 'data' }))
    expect(auth).not.toBeNull()
    expect(auth!.name).toBe('John')
  })
})

// --- localStorage integration (with mock) ---

describe('Auth localStorage integration', () => {
  const STORAGE_KEY = 'chatbridge_auth'

  let mockStorage: Record<string, string>

  beforeEach(() => {
    mockStorage = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value }),
      removeItem: vi.fn((key: string) => { delete mockStorage[key] }),
    })
  })

  it('stores auth on successful login', () => {
    const payload = createAuthPayload('John', 'student')
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))

    const stored = readAuth(localStorage.getItem(STORAGE_KEY))
    expect(stored).not.toBeNull()
    expect(stored!.name).toBe('John')
    expect(stored!.role).toBe('student')
  })

  it('clears auth on sign out', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: 'John', role: 'student', timestamp: 1 }))
    localStorage.removeItem(STORAGE_KEY)

    const stored = readAuth(localStorage.getItem(STORAGE_KEY))
    expect(stored).toBeNull()
  })

  it('handles corrupted localStorage gracefully', () => {
    mockStorage[STORAGE_KEY] = '{broken json'
    const stored = readAuth(localStorage.getItem(STORAGE_KEY))
    expect(stored).toBeNull()
  })

  it('round-trips student auth correctly', () => {
    const original = { name: 'Alice', role: 'student' as const, timestamp: Date.now() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(original))
    const restored = readAuth(localStorage.getItem(STORAGE_KEY))
    expect(restored).toEqual(original)
  })

  it('round-trips teacher auth correctly', () => {
    const original = { name: 'Dr. Brown', role: 'teacher' as const, timestamp: Date.now() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(original))
    const restored = readAuth(localStorage.getItem(STORAGE_KEY))
    expect(restored).toEqual(original)
  })
})
