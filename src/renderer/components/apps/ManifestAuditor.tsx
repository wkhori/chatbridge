import { useState } from 'react'
import { auditManifest, type SecurityReport } from '@/packages/security/manifest-auditor'

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-red-50 dark:bg-red-950', text: 'text-red-700 dark:text-red-300', border: 'border-red-200 dark:border-red-800' },
  high: { bg: 'bg-orange-50 dark:bg-orange-950', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-200 dark:border-orange-800' },
  medium: { bg: 'bg-yellow-50 dark:bg-yellow-950', text: 'text-yellow-700 dark:text-yellow-300', border: 'border-yellow-200 dark:border-yellow-800' },
  low: { bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800' },
}

const RECOMMENDATION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  approve: { bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-800 dark:text-green-200', label: 'APPROVED' },
  review: { bg: 'bg-yellow-100 dark:bg-yellow-900', text: 'text-yellow-800 dark:text-yellow-200', label: 'NEEDS REVIEW' },
  reject: { bg: 'bg-red-100 dark:bg-red-900', text: 'text-red-800 dark:text-red-200', label: 'REJECTED' },
}

const EXAMPLE_MANIFEST = JSON.stringify({
  id: 'my-app',
  name: 'My Education App',
  version: '1.0.0',
  description: 'An interactive learning tool',
  url: 'https://example.com/app',
  permissions: ['state_push', 'completion'],
  auth: { type: 'none' },
  keywords: ['learn', 'study'],
}, null, 2)

export function ManifestAuditor() {
  const [input, setInput] = useState('')
  const [report, setReport] = useState<SecurityReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  const handleAudit = async () => {
    setParseError(null)
    setReport(null)

    let parsed: unknown
    try {
      parsed = JSON.parse(input)
    } catch {
      setParseError('Invalid JSON. Please check your manifest syntax.')
      return
    }

    setLoading(true)
    try {
      const result = await auditManifest(parsed)
      setReport(result)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Audit failed')
    } finally {
      setLoading(false)
    }
  }

  const loadExample = () => {
    setInput(EXAMPLE_MANIFEST)
    setReport(null)
    setParseError(null)
  }

  return (
    <div className="flex flex-col gap-4 p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-chatbox-tint-primary">App Security Auditor</h2>
          <p className="text-sm text-chatbox-tint-secondary mt-0.5">
            Paste an app manifest JSON to audit it for security risks
          </p>
        </div>
        <button
          onClick={loadExample}
          className="px-3 py-1.5 text-xs rounded-md border border-chatbox-border-primary text-chatbox-tint-secondary hover:bg-chatbox-background-gray-secondary transition-colors cursor-pointer bg-transparent"
        >
          Load Example
        </button>
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder='{\n  "id": "my-app",\n  "name": "My App",\n  ...\n}'
        className="w-full h-64 p-3 rounded-lg border border-chatbox-border-primary bg-chatbox-background-gray-secondary text-chatbox-tint-primary font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      />

      {parseError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          {parseError}
        </div>
      )}

      <button
        onClick={handleAudit}
        disabled={loading || !input.trim()}
        className="px-4 py-2 rounded-lg font-medium text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer border-none"
      >
        {loading ? 'Auditing...' : 'Run Security Audit'}
      </button>

      {report && (
        <div className="flex flex-col gap-3 mt-2">
          {/* Header: Score + Recommendation */}
          <div className="flex items-center gap-4 p-4 rounded-lg bg-chatbox-background-gray-secondary border border-chatbox-border-primary">
            <div className="flex flex-col items-center">
              <span className="text-3xl font-bold text-chatbox-tint-primary">{report.riskScore}</span>
              <span className="text-xs text-chatbox-tint-secondary">/10 risk</span>
            </div>
            <div className="flex-1">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${RECOMMENDATION_STYLES[report.recommendation].bg} ${RECOMMENDATION_STYLES[report.recommendation].text}`}>
                {RECOMMENDATION_STYLES[report.recommendation].label}
              </span>
              <p className="text-sm text-chatbox-tint-secondary mt-2">{report.summary}</p>
            </div>
          </div>

          {/* Findings */}
          {report.findings.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-chatbox-tint-primary">Findings ({report.findings.length})</h3>
              {report.findings.map((finding, i) => {
                const colors = SEVERITY_COLORS[finding.severity]
                return (
                  <div key={i} className={`p-3 rounded-lg border ${colors.bg} ${colors.border}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold uppercase ${colors.text}`}>{finding.severity}</span>
                      <span className="text-xs text-chatbox-tint-secondary">{finding.category}</span>
                    </div>
                    <p className={`text-sm ${colors.text}`}>{finding.description}</p>
                  </div>
                )
              })}
            </div>
          )}

          {report.findings.length === 0 && (
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-200 text-sm text-center">
              No security issues found. This manifest passes all automated checks.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
