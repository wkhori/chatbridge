import { describe, it, expect } from 'vitest'
import { auditManifest, validateSchema, runDeterministicChecks, synthesizeReport } from '../manifest-auditor'

const validManifest = {
  id: 'test-app',
  name: 'Test App',
  version: '1.0.0',
  description: 'A test app',
  url: 'https://example.com/app',
  permissions: ['state_push'],
  auth: { type: 'none' as const },
  keywords: ['test'],
}

// --- Layer 1: Schema Validation ---

describe('Layer 1: Schema validation', () => {
  it('accepts valid manifest', () => {
    const result = validateSchema(validManifest)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects manifest missing required fields', () => {
    const result = validateSchema({ id: 'test' })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects manifest with invalid URL', () => {
    const result = validateSchema({ ...validManifest, url: 'not-a-url' })
    expect(result.valid).toBe(false)
  })

  it('rejects non-object input', () => {
    expect(validateSchema('string').valid).toBe(false)
    expect(validateSchema(123).valid).toBe(false)
    expect(validateSchema(null).valid).toBe(false)
  })

  it('rejects invalid permission', () => {
    const result = validateSchema({ ...validManifest, permissions: ['dangerous'] })
    expect(result.valid).toBe(false)
  })
})

// --- Layer 2: Deterministic Checks ---

describe('Layer 2: Deterministic checks', () => {
  it('flags reserved app IDs', () => {
    const findings = runDeterministicChecks({ ...validManifest, id: 'system' })
    expect(findings.some(f => f.category === 'identity' && f.severity === 'critical')).toBe(true)
  })

  it('flags all reserved IDs', () => {
    for (const reservedId of ['system', 'admin', 'platform', 'chatbridge', 'root', 'internal']) {
      const findings = runDeterministicChecks({ ...validManifest, id: reservedId })
      expect(findings.some(f => f.category === 'identity')).toBe(true)
    }
  })

  it('flags non-HTTPS URLs', () => {
    const findings = runDeterministicChecks({ ...validManifest, url: 'http://example.com/app' })
    expect(findings.some(f => f.category === 'network' && f.description.includes('HTTP'))).toBe(true)
  })

  it('does not flag localhost HTTP (development)', () => {
    // localhost HTTP is only flagged as "might be dev build", not as the HTTPS check
    const findings = runDeterministicChecks({ ...validManifest, url: 'http://localhost:3000' })
    const httpsFindings = findings.filter(f => f.description.includes('HTTP instead of HTTPS'))
    expect(httpsFindings).toHaveLength(0)
  })

  it('flags raw IP addresses', () => {
    const findings = runDeterministicChecks({ ...validManifest, url: 'https://192.168.1.1/app' })
    expect(findings.some(f => f.description.includes('raw IP'))).toBe(true)
  })

  it('flags dangerous permission combos', () => {
    const findings = runDeterministicChecks({
      ...validManifest,
      permissions: ['vision', 'long_running_tools'],
    })
    expect(findings.some(f => f.category === 'permissions' && f.severity === 'high')).toBe(true)
  })

  it('flags tool name collisions', () => {
    const findings = runDeterministicChecks({
      ...validManifest,
      tools: [{ name: 'launch_app' }],
    })
    expect(findings.some(f => f.category === 'tools' && f.severity === 'critical')).toBe(true)
  })

  it('flags oauth2 without scopes', () => {
    const findings = runDeterministicChecks({
      ...validManifest,
      auth: { type: 'oauth2', provider: 'google' },
    })
    expect(findings.some(f => f.description.includes('scopes'))).toBe(true)
  })

  it('returns no findings for a clean manifest', () => {
    const findings = runDeterministicChecks(validManifest)
    expect(findings).toHaveLength(0)
  })
})

// --- Report Synthesis ---

describe('synthesizeReport', () => {
  it('returns approve for no findings', () => {
    const report = synthesizeReport([])
    expect(report.recommendation).toBe('approve')
    expect(report.riskScore).toBe(1)
  })

  it('returns reject for critical findings', () => {
    const report = synthesizeReport([{
      category: 'identity',
      severity: 'critical',
      description: 'Reserved ID',
    }])
    expect(report.recommendation).toBe('reject')
    expect(report.riskScore).toBeGreaterThanOrEqual(4)
  })

  it('returns review for high findings', () => {
    const report = synthesizeReport([{
      category: 'permissions',
      severity: 'high',
      description: 'Dangerous combo',
    }])
    expect(report.recommendation).toBe('review')
  })

  it('caps risk score at 10', () => {
    const manyFindings = Array.from({ length: 20 }, () => ({
      category: 'permissions' as const,
      severity: 'critical' as const,
      description: 'Bad',
    }))
    const report = synthesizeReport(manyFindings)
    expect(report.riskScore).toBeLessThanOrEqual(10)
  })
})

// --- Full Audit ---

describe('auditManifest', () => {
  it('returns correct report for valid clean manifest', async () => {
    const report = await auditManifest(validManifest)
    expect(report.recommendation).toBe('approve')
    expect(report.findings).toHaveLength(0)
    expect(report.riskScore).toBe(1)
  })

  it('rejects invalid manifest at schema level', async () => {
    const report = await auditManifest({ id: 'test' })
    expect(report.recommendation).toBe('reject')
    expect(report.findings.some(f => f.description.includes('Schema validation'))).toBe(true)
  })

  it('flags reserved ID through full pipeline', async () => {
    const report = await auditManifest({ ...validManifest, id: 'admin' })
    expect(report.findings.some(f => f.category === 'identity')).toBe(true)
    expect(report.recommendation).toBe('reject')
  })

  it('returns SecurityReport shape', async () => {
    const report = await auditManifest(validManifest)
    expect(report).toHaveProperty('riskScore')
    expect(report).toHaveProperty('recommendation')
    expect(report).toHaveProperty('findings')
    expect(report).toHaveProperty('summary')
    expect(typeof report.riskScore).toBe('number')
    expect(Array.isArray(report.findings)).toBe(true)
  })
})
