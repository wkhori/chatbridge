import { z } from 'zod'
import { AppManifestSchema } from '@shared/protocol/types'

// --- Types ---

export const FindingSchema = z.object({
  category: z.enum(['permissions', 'network', 'identity', 'tools', 'data']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string(),
})

export type Finding = z.infer<typeof FindingSchema>

export const SecurityReportSchema = z.object({
  riskScore: z.number().min(1).max(10),
  recommendation: z.enum(['approve', 'review', 'reject']),
  findings: z.array(FindingSchema),
  summary: z.string(),
})

export type SecurityReport = z.infer<typeof SecurityReportSchema>

// --- Constants ---

const RESERVED_IDS = ['system', 'admin', 'platform', 'chatbridge', 'root', 'internal']
const BUILT_IN_TOOL_NAMES = ['launch_app', 'suggest_actions', 'generate_micro_app']

// --- Layer 1: Schema Validation ---

function validateSchema(manifest: unknown): { valid: boolean; errors: string[] } {
  const result = AppManifestSchema.safeParse(manifest)
  if (result.success) return { valid: true, errors: [] }
  return {
    valid: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    ),
  }
}

// --- Layer 2: Deterministic Checks ---

function runDeterministicChecks(manifest: Record<string, unknown>): Finding[] {
  const findings: Finding[] = []
  const id = manifest.id as string | undefined
  const url = manifest.url as string | undefined
  const permissions = manifest.permissions as string[] | undefined
  const tools = manifest.tools as Array<{ name: string }> | undefined
  const auth = manifest.auth as { type: string; scopes?: string[] } | undefined

  // Reserved ID check
  if (id && RESERVED_IDS.includes(id.toLowerCase())) {
    findings.push({
      category: 'identity',
      severity: 'critical',
      description: `App ID "${id}" is reserved and cannot be used by third-party apps.`,
    })
  }

  // URL checks
  if (url) {
    // Non-HTTPS in production
    if (url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
      findings.push({
        category: 'network',
        severity: 'high',
        description: `App URL uses HTTP instead of HTTPS: "${url}". All production apps must use HTTPS.`,
      })
    }
    // Raw IP address
    if (/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(url)) {
      findings.push({
        category: 'network',
        severity: 'medium',
        description: `App URL uses a raw IP address: "${url}". Use a domain name for production apps.`,
      })
    }
    // Localhost in what looks like a prod manifest
    if ((url.includes('localhost') || url.includes('127.0.0.1')) && manifest.version !== '0.0.0') {
      findings.push({
        category: 'network',
        severity: 'medium',
        description: `App URL points to localhost. This may indicate a development build submitted to production.`,
      })
    }
  }

  // Dangerous permission combos
  if (permissions) {
    if (permissions.includes('vision') && permissions.includes('long_running_tools')) {
      findings.push({
        category: 'permissions',
        severity: 'high',
        description: `App requests both "vision" and "long_running_tools" permissions. This combination allows continuous screen capture with extended processing — high risk for student data exfiltration.`,
      })
    }
    if (permissions.includes('vision') && auth?.type === 'oauth2') {
      findings.push({
        category: 'permissions',
        severity: 'medium',
        description: `App has both vision permission and OAuth2 auth. Could potentially relay screen content to external service.`,
      })
    }
  }

  // Tool name collisions
  if (tools) {
    for (const t of tools) {
      if (BUILT_IN_TOOL_NAMES.includes(t.name)) {
        findings.push({
          category: 'tools',
          severity: 'critical',
          description: `Tool name "${t.name}" collides with a built-in platform tool. This could override platform functionality.`,
        })
      }
    }
  }

  // OAuth without scopes
  if (auth?.type === 'oauth2' && (!auth.scopes || auth.scopes.length === 0)) {
    findings.push({
      category: 'permissions',
      severity: 'medium',
      description: `OAuth2 auth declared without specifying scopes. Apps must declare required scopes for transparency.`,
    })
  }

  return findings
}

// --- Layer 3: LLM Analysis ---

async function runLLMAnalysis(
  manifest: Record<string, unknown>,
  priorFindings: Finding[]
): Promise<SecurityReport> {
  // Try to use generateObject from Vercel AI SDK if available
  try {
    const { generateObject } = await import('ai')
    const { createAnthropic } = await import('@ai-sdk/anthropic')

    const anthropic = createAnthropic()
    const model = anthropic('claude-haiku-4-5-20251001')

    const { object } = await generateObject({
      model,
      schema: SecurityReportSchema,
      system:
        'You are a K-12 education platform security reviewer. ' +
        'Analyze this app manifest for risks to student data and safety. ' +
        'Focus on: COPPA compliance, data exfiltration risk, inappropriate content potential, ' +
        'permission scope, and network access. Be thorough but fair — not all apps are malicious.',
      prompt: `Analyze this app manifest for security risks:\n\n${JSON.stringify(manifest, null, 2)}\n\nPrior automated findings:\n${priorFindings.map((f) => `[${f.severity}] ${f.category}: ${f.description}`).join('\n') || 'None'}`,
    })

    return object
  } catch {
    // LLM not available — synthesize report from deterministic findings
    return synthesizeReport(priorFindings)
  }
}

// --- Fallback Report Synthesis ---

function synthesizeReport(findings: Finding[]): SecurityReport {
  const criticalCount = findings.filter((f) => f.severity === 'critical').length
  const highCount = findings.filter((f) => f.severity === 'high').length
  const mediumCount = findings.filter((f) => f.severity === 'medium').length

  let riskScore = 1
  riskScore += criticalCount * 3
  riskScore += highCount * 2
  riskScore += mediumCount * 1
  riskScore = Math.min(riskScore, 10)

  let recommendation: 'approve' | 'review' | 'reject' = 'approve'
  if (criticalCount > 0) recommendation = 'reject'
  else if (highCount > 0) recommendation = 'review'
  else if (mediumCount > 1) recommendation = 'review'

  const summary =
    findings.length === 0
      ? 'No security issues detected. Manifest passes all automated checks.'
      : `Found ${findings.length} issue(s): ${criticalCount} critical, ${highCount} high, ${mediumCount} medium, ${findings.length - criticalCount - highCount - mediumCount} low.`

  return { riskScore, recommendation, findings, summary }
}

// --- Public API ---

export async function auditManifest(manifest: unknown, useLLM = false): Promise<SecurityReport> {
  // Layer 1: Schema validation
  const schemaResult = validateSchema(manifest)
  if (!schemaResult.valid) {
    return {
      riskScore: 8,
      recommendation: 'reject',
      findings: schemaResult.errors.map((err) => ({
        category: 'data' as const,
        severity: 'critical' as const,
        description: `Schema validation failed: ${err}`,
      })),
      summary: `Manifest failed schema validation with ${schemaResult.errors.length} error(s). Cannot proceed with security review.`,
    }
  }

  const manifestObj = manifest as Record<string, unknown>

  // Layer 2: Deterministic checks
  const deterministicFindings = runDeterministicChecks(manifestObj)

  // Layer 3: LLM analysis (optional)
  if (useLLM) {
    return runLLMAnalysis(manifestObj, deterministicFindings)
  }

  // Synthesize from deterministic only
  return synthesizeReport(deterministicFindings)
}

// Re-export for testing
export { validateSchema, runDeterministicChecks, synthesizeReport }
