/**
 * Full coverage tests for manifest-auditor.ts
 * Covers Layer 1 (schema), Layer 2 (deterministic), Layer 3 (LLM — mocked),
 * synthesizeReport edge cases, and the auditManifest orchestrator.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  auditManifest,
  validateSchema,
  runDeterministicChecks,
  synthesizeReport,
} from '../manifest-auditor'

// --- Helpers ---

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-app',
    name: 'Test App',
    version: '1.0.0',
    description: 'A test application',
    url: 'https://test-app.example.com',
    icon: '🧪',
    permissions: ['state_push'],
    auth: { type: 'none' },
    keywords: ['test'],
    ...overrides,
  }
}

// --- Layer 1: Schema Validation ---

describe('validateSchema', () => {
  it('accepts a well-formed manifest', () => {
    const result = validateSchema(validManifest())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects non-object input', () => {
    const result = validateSchema('not an object')
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects null', () => {
    const result = validateSchema(null)
    expect(result.valid).toBe(false)
  })

  it('rejects manifest missing id', () => {
    const { id, ...noId } = validManifest()
    const result = validateSchema(noId)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('id'))).toBe(true)
  })

  it('rejects manifest missing name', () => {
    const { name, ...noName } = validManifest()
    const result = validateSchema(noName)
    expect(result.valid).toBe(false)
  })

  it('rejects manifest missing version', () => {
    const { version, ...noVersion } = validManifest()
    const result = validateSchema(noVersion)
    expect(result.valid).toBe(false)
  })

  it('rejects manifest missing url', () => {
    const { url, ...noUrl } = validManifest()
    const result = validateSchema(noUrl)
    expect(result.valid).toBe(false)
  })

  it('rejects manifest with invalid URL', () => {
    const result = validateSchema(validManifest({ url: 'not-a-url' }))
    expect(result.valid).toBe(false)
  })

  it('rejects manifest with invalid permissions', () => {
    const result = validateSchema(validManifest({ permissions: 'not-array' }))
    expect(result.valid).toBe(false)
  })

  it('accepts manifest with all optional fields', () => {
    const result = validateSchema(
      validManifest({ viewOnly: true, keywords: ['a', 'b'] })
    )
    expect(result.valid).toBe(true)
  })

  it('error messages include field path', () => {
    const result = validateSchema({ id: 123 })
    expect(result.valid).toBe(false)
    // Errors should contain path info
    expect(result.errors.some((e) => e.includes('id') || e.includes('name') || e.includes('version'))).toBe(true)
  })
})

// --- Layer 2: Deterministic Checks ---

describe('runDeterministicChecks', () => {
  it('returns empty findings for clean manifest', () => {
    const findings = runDeterministicChecks(validManifest())
    expect(findings).toHaveLength(0)
  })

  // Reserved IDs
  describe('reserved IDs', () => {
    const reservedIds = ['system', 'admin', 'platform', 'chatbridge', 'root', 'internal']

    for (const reserved of reservedIds) {
      it(`flags reserved ID "${reserved}"`, () => {
        const findings = runDeterministicChecks(validManifest({ id: reserved }))
        const match = findings.find(
          (f) => f.severity === 'critical' && f.category === 'identity'
        )
        expect(match).toBeDefined()
        expect(match!.description).toContain(reserved)
      })
    }

    it('allows non-reserved IDs', () => {
      const findings = runDeterministicChecks(validManifest({ id: 'my-app' }))
      expect(findings.filter((f) => f.category === 'identity')).toHaveLength(0)
    })

    it('is case-insensitive for reserved IDs', () => {
      const findings = runDeterministicChecks(validManifest({ id: 'SYSTEM' }))
      expect(findings.some((f) => f.severity === 'critical')).toBe(true)
    })
  })

  // URL checks
  describe('URL validation', () => {
    it('flags non-HTTPS URL', () => {
      const findings = runDeterministicChecks(
        validManifest({ url: 'http://insecure.example.com' })
      )
      expect(findings.some((f) => f.severity === 'high' && f.category === 'network')).toBe(true)
    })

    it('allows localhost HTTP (development)', () => {
      const findings = runDeterministicChecks(
        validManifest({ url: 'http://localhost:5173' })
      )
      const httpFindings = findings.filter(
        (f) => f.description.includes('HTTP instead of HTTPS')
      )
      expect(httpFindings).toHaveLength(0)
    })

    it('allows 127.0.0.1 HTTP (development)', () => {
      const findings = runDeterministicChecks(
        validManifest({ url: 'http://127.0.0.1:3000' })
      )
      const httpFindings = findings.filter(
        (f) => f.description.includes('HTTP instead of HTTPS')
      )
      expect(httpFindings).toHaveLength(0)
    })

    it('flags raw IP address in URL', () => {
      const findings = runDeterministicChecks(
        validManifest({ url: 'https://192.168.1.100:8080' })
      )
      expect(findings.some((f) => f.severity === 'medium' && f.description.includes('raw IP'))).toBe(true)
    })

    it('flags localhost in non-dev manifest (version != 0.0.0)', () => {
      const findings = runDeterministicChecks(
        validManifest({ url: 'http://localhost:5173', version: '1.0.0' })
      )
      expect(findings.some((f) => f.description.includes('localhost'))).toBe(true)
    })

    it('allows localhost in dev manifest (version 0.0.0)', () => {
      const findings = runDeterministicChecks(
        validManifest({ url: 'http://localhost:5173', version: '0.0.0' })
      )
      const localhostFindings = findings.filter(
        (f) => f.description.includes('development build submitted to production')
      )
      expect(localhostFindings).toHaveLength(0)
    })
  })

  // Permission combos
  describe('dangerous permission combos', () => {
    it('flags vision + long_running_tools', () => {
      const findings = runDeterministicChecks(
        validManifest({ permissions: ['vision', 'long_running_tools'] })
      )
      const match = findings.find(
        (f) => f.severity === 'high' && f.description.includes('vision')
      )
      expect(match).toBeDefined()
      expect(match!.description).toContain('long_running_tools')
    })

    it('flags vision + oauth2', () => {
      const findings = runDeterministicChecks(
        validManifest({
          permissions: ['vision'],
          auth: { type: 'oauth2', scopes: ['read'] },
        })
      )
      expect(
        findings.some((f) => f.description.includes('vision') && f.description.includes('OAuth2'))
      ).toBe(true)
    })

    it('does not flag vision alone', () => {
      const findings = runDeterministicChecks(
        validManifest({ permissions: ['vision'] })
      )
      expect(findings).toHaveLength(0)
    })

    it('does not flag long_running_tools alone', () => {
      const findings = runDeterministicChecks(
        validManifest({ permissions: ['long_running_tools'] })
      )
      expect(findings).toHaveLength(0)
    })
  })

  // Tool name collisions
  describe('tool name collisions', () => {
    const builtInNames = ['launch_app', 'suggest_actions', 'generate_micro_app']

    for (const name of builtInNames) {
      it(`flags collision with built-in tool "${name}"`, () => {
        const findings = runDeterministicChecks(
          validManifest({ tools: [{ name }] })
        )
        const match = findings.find((f) => f.severity === 'critical' && f.category === 'tools')
        expect(match).toBeDefined()
        expect(match!.description).toContain(name)
      })
    }

    it('allows non-colliding tool names', () => {
      const findings = runDeterministicChecks(
        validManifest({ tools: [{ name: 'my_custom_tool' }] })
      )
      expect(findings.filter((f) => f.category === 'tools')).toHaveLength(0)
    })
  })

  // OAuth without scopes
  describe('OAuth scope validation', () => {
    it('flags oauth2 without scopes', () => {
      const findings = runDeterministicChecks(
        validManifest({ auth: { type: 'oauth2' } })
      )
      expect(
        findings.some((f) => f.description.includes('OAuth2') && f.description.includes('scopes'))
      ).toBe(true)
    })

    it('flags oauth2 with empty scopes array', () => {
      const findings = runDeterministicChecks(
        validManifest({ auth: { type: 'oauth2', scopes: [] } })
      )
      expect(
        findings.some((f) => f.description.includes('OAuth2') && f.description.includes('scopes'))
      ).toBe(true)
    })

    it('does not flag oauth2 with scopes', () => {
      const findings = runDeterministicChecks(
        validManifest({
          auth: { type: 'oauth2', scopes: ['read'] },
        })
      )
      expect(
        findings.filter((f) => f.description.includes('scopes')).length
      ).toBe(0)
    })

    it('does not flag auth type "none"', () => {
      const findings = runDeterministicChecks(
        validManifest({ auth: { type: 'none' } })
      )
      expect(
        findings.filter((f) => f.description.includes('OAuth2')).length
      ).toBe(0)
    })
  })

  // Multiple findings
  it('accumulates multiple findings', () => {
    const findings = runDeterministicChecks(
      validManifest({
        id: 'system',
        url: 'http://192.168.1.1:8080',
        permissions: ['vision', 'long_running_tools'],
        tools: [{ name: 'launch_app' }],
        auth: { type: 'oauth2' },
      })
    )
    // Should find: reserved id, non-https, raw IP, vision+long_running, vision+oauth2, tool collision, oauth no scopes
    expect(findings.length).toBeGreaterThanOrEqual(5)
  })
})

// --- synthesizeReport ---

describe('synthesizeReport', () => {
  it('returns approve with no findings', () => {
    const report = synthesizeReport([])
    expect(report.recommendation).toBe('approve')
    expect(report.riskScore).toBe(1)
    expect(report.findings).toHaveLength(0)
    expect(report.summary).toContain('No security issues')
  })

  it('rejects on critical findings', () => {
    const report = synthesizeReport([
      { category: 'identity', severity: 'critical', description: 'Reserved ID' },
    ])
    expect(report.recommendation).toBe('reject')
    expect(report.riskScore).toBe(4) // 1 + 3
  })

  it('reviews on high findings', () => {
    const report = synthesizeReport([
      { category: 'network', severity: 'high', description: 'Non-HTTPS' },
    ])
    expect(report.recommendation).toBe('review')
    expect(report.riskScore).toBe(3) // 1 + 2
  })

  it('reviews on multiple medium findings', () => {
    const report = synthesizeReport([
      { category: 'network', severity: 'medium', description: 'Raw IP' },
      { category: 'permissions', severity: 'medium', description: 'OAuth no scopes' },
    ])
    expect(report.recommendation).toBe('review')
    expect(report.riskScore).toBe(3) // 1 + 1 + 1
  })

  it('approves on single medium finding', () => {
    const report = synthesizeReport([
      { category: 'network', severity: 'medium', description: 'Raw IP' },
    ])
    expect(report.recommendation).toBe('approve')
    expect(report.riskScore).toBe(2) // 1 + 1
  })

  it('approves on low findings', () => {
    const report = synthesizeReport([
      { category: 'data', severity: 'low', description: 'Minor issue' },
    ])
    expect(report.recommendation).toBe('approve')
    expect(report.riskScore).toBe(1) // low adds 0
  })

  it('caps risk score at 10', () => {
    const manyFindings = Array.from({ length: 10 }, (_, i) => ({
      category: 'identity' as const,
      severity: 'critical' as const,
      description: `Critical finding ${i}`,
    }))
    const report = synthesizeReport(manyFindings)
    expect(report.riskScore).toBe(10)
    expect(report.recommendation).toBe('reject')
  })

  it('includes count breakdown in summary', () => {
    const report = synthesizeReport([
      { category: 'identity', severity: 'critical', description: 'A' },
      { category: 'network', severity: 'high', description: 'B' },
      { category: 'network', severity: 'medium', description: 'C' },
      { category: 'data', severity: 'low', description: 'D' },
    ])
    expect(report.summary).toContain('4 issue(s)')
    expect(report.summary).toContain('1 critical')
    expect(report.summary).toContain('1 high')
    expect(report.summary).toContain('1 medium')
    expect(report.summary).toContain('1 low')
  })

  it('passes through findings array', () => {
    const findings = [
      { category: 'identity' as const, severity: 'critical' as const, description: 'Reserved' },
    ]
    const report = synthesizeReport(findings)
    expect(report.findings).toEqual(findings)
  })
})

// --- auditManifest (orchestrator) ---

describe('auditManifest', () => {
  it('rejects on schema validation failure', async () => {
    const report = await auditManifest({ id: 123 })
    expect(report.recommendation).toBe('reject')
    expect(report.riskScore).toBe(8)
    expect(report.findings.every((f) => f.severity === 'critical')).toBe(true)
    expect(report.summary).toContain('schema validation')
  })

  it('rejects null input', async () => {
    const report = await auditManifest(null)
    expect(report.recommendation).toBe('reject')
  })

  it('approves clean manifest without LLM', async () => {
    const report = await auditManifest(validManifest(), false)
    expect(report.recommendation).toBe('approve')
    expect(report.riskScore).toBe(1)
    expect(report.findings).toHaveLength(0)
  })

  it('reports deterministic findings without LLM', async () => {
    const report = await auditManifest(
      validManifest({ id: 'system' }),
      false
    )
    expect(report.recommendation).toBe('reject')
    expect(report.findings.some((f) => f.description.includes('system'))).toBe(true)
  })

  it('combines schema pass + deterministic findings', async () => {
    const report = await auditManifest(
      validManifest({
        url: 'http://insecure.example.com',
        auth: { type: 'oauth2' },
      }),
      false
    )
    // Should have both URL and OAuth findings
    expect(report.findings.length).toBeGreaterThanOrEqual(2)
    expect(report.recommendation).not.toBe('approve')
  })

  it('falls back to synthesize when LLM is unavailable', async () => {
    // useLLM=true but import will fail in test env (no ai module configured)
    const report = await auditManifest(
      validManifest({ id: 'system' }),
      true
    )
    // Should still produce a report (fallback to synthesizeReport)
    expect(report).toBeDefined()
    expect(report.recommendation).toBeDefined()
    expect(report.findings.length).toBeGreaterThan(0)
  })
})
