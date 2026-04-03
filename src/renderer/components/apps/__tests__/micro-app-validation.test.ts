/**
 * Tests for MicroAppRenderer validation logic and HTML composition.
 * Tests the pure functions (validateHtml, wrappedHtml generation)
 * without requiring React rendering.
 */
import { describe, it, expect } from 'vitest'
import {
  MICRO_APP_MIN_HEIGHT,
  MICRO_APP_MAX_HEIGHT,
  MICRO_APP_MAX_SIZE,
} from '@shared/protocol/types'

// --- Replicate validation logic from MicroAppRenderer.tsx ---

const BLOCKLIST = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bimportScripts\b/,
]

function validateHtml(html: string): string | null {
  if (html.length > MICRO_APP_MAX_SIZE)
    return `Micro-app exceeds ${MICRO_APP_MAX_SIZE / 1024}KB size limit`
  for (const pattern of BLOCKLIST) {
    if (pattern.test(html)) return `Blocked pattern detected: ${pattern.source}`
  }
  return null
}

function wrapHtml(html: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;">`
  const bridgeSdk = '<script>/* bridge sdk */</script>'
  if (html.includes('</head>')) {
    return html.replace('</head>', `${csp}${bridgeSdk}</head>`)
  }
  return `<!DOCTYPE html><html><head>${csp}${bridgeSdk}</head><body>${html}</body></html>`
}

function clampHeight(height: number): number {
  return Math.min(Math.max(height, MICRO_APP_MIN_HEIGHT), MICRO_APP_MAX_HEIGHT)
}

// --- Tests ---

describe('MicroAppRenderer validation', () => {
  describe('validateHtml', () => {
    it('accepts clean HTML', () => {
      expect(validateHtml('<div>Hello</div>')).toBeNull()
    })

    it('accepts HTML with inline styles', () => {
      expect(validateHtml('<div style="color: red">styled</div>')).toBeNull()
    })

    it('accepts HTML with inline script (not using blocked patterns)', () => {
      expect(validateHtml('<script>var x = 1 + 2; console.log(x);</script>')).toBeNull()
    })

    it('accepts HTML with addEventListener', () => {
      expect(
        validateHtml('<script>document.addEventListener("click", function() {});</script>')
      ).toBeNull()
    })

    // Blocklist patterns
    describe('blocks dangerous patterns', () => {
      it('blocks eval()', () => {
        const result = validateHtml('<script>eval("alert(1)")</script>')
        expect(result).not.toBeNull()
        expect(result).toContain('eval')
      })

      it('blocks eval with spaces', () => {
        const result = validateHtml('<script>eval  ("alert(1)")</script>')
        expect(result).not.toBeNull()
      })

      it('blocks new Function()', () => {
        const result = validateHtml('<script>new Function("return 1")()</script>')
        expect(result).not.toBeNull()
        expect(result).toContain('Function')
      })

      it('blocks new Function with spaces', () => {
        const result = validateHtml('<script>new  Function ("return 1")</script>')
        expect(result).not.toBeNull()
      })

      it('blocks fetch()', () => {
        const result = validateHtml('<script>fetch("https://evil.com")</script>')
        expect(result).not.toBeNull()
        expect(result).toContain('fetch')
      })

      it('blocks fetch with spaces', () => {
        const result = validateHtml('<script>fetch  ("/api")</script>')
        expect(result).not.toBeNull()
      })

      it('blocks XMLHttpRequest', () => {
        const result = validateHtml('<script>new XMLHttpRequest()</script>')
        expect(result).not.toBeNull()
        expect(result).toContain('XMLHttpRequest')
      })

      it('blocks XMLHttpRequest in text', () => {
        const result = validateHtml('<script>var x = XMLHttpRequest;</script>')
        expect(result).not.toBeNull()
      })

      it('blocks WebSocket', () => {
        const result = validateHtml('<script>new WebSocket("ws://evil.com")</script>')
        expect(result).not.toBeNull()
        expect(result).toContain('WebSocket')
      })

      it('blocks importScripts', () => {
        const result = validateHtml('<script>importScripts("evil.js")</script>')
        expect(result).not.toBeNull()
        expect(result).toContain('importScripts')
      })
    })

    // Does NOT block safe references to similar names
    describe('does not false-positive on similar names', () => {
      it('allows "evaluation" (not eval())', () => {
        expect(validateHtml('<p>This is an evaluation</p>')).toBeNull()
      })

      it('allows "fetching" (not fetch())', () => {
        expect(validateHtml('<p>Fetching data...</p>')).toBeNull()
      })

      it('allows "Function" without new keyword', () => {
        expect(validateHtml('<p>This Function works</p>')).toBeNull()
      })
    })

    // Size limit
    describe('size limit enforcement', () => {
      it('accepts HTML under size limit', () => {
        const html = 'x'.repeat(MICRO_APP_MAX_SIZE - 1)
        expect(validateHtml(html)).toBeNull()
      })

      it('accepts HTML at exact size limit', () => {
        const html = 'x'.repeat(MICRO_APP_MAX_SIZE)
        expect(validateHtml(html)).toBeNull()
      })

      it('rejects HTML over size limit', () => {
        const html = 'x'.repeat(MICRO_APP_MAX_SIZE + 1)
        const result = validateHtml(html)
        expect(result).not.toBeNull()
        expect(result).toContain('size limit')
      })

      it('error message includes KB limit', () => {
        const html = 'x'.repeat(MICRO_APP_MAX_SIZE + 1)
        const result = validateHtml(html)
        expect(result).toContain(`${MICRO_APP_MAX_SIZE / 1024}KB`)
      })
    })

    // Priority: size check before blocklist
    it('reports size error even if HTML also has blocked patterns', () => {
      const html = 'eval('.repeat(MICRO_APP_MAX_SIZE)
      const result = validateHtml(html)
      expect(result).toContain('size limit')
    })

    it('accepts empty HTML', () => {
      expect(validateHtml('')).toBeNull()
    })
  })

  describe('HTML wrapping', () => {
    it('injects CSP and SDK before existing </head>', () => {
      const html = '<html><head><title>Test</title></head><body>Hi</body></html>'
      const result = wrapHtml(html)
      expect(result).toContain('Content-Security-Policy')
      expect(result).toContain('bridge sdk')
      expect(result).toContain('<title>Test</title>')
      // CSP and SDK should be before </head>
      const cspIndex = result.indexOf('Content-Security-Policy')
      const headCloseIndex = result.indexOf('</head>')
      expect(cspIndex).toBeLessThan(headCloseIndex)
    })

    it('wraps headless HTML in full document structure', () => {
      const html = '<div>No head tag</div>'
      const result = wrapHtml(html)
      expect(result).toContain('<!DOCTYPE html>')
      expect(result).toContain('<html>')
      expect(result).toContain('<head>')
      expect(result).toContain('</head>')
      expect(result).toContain('<body>')
      expect(result).toContain('<div>No head tag</div>')
      expect(result).toContain('Content-Security-Policy')
    })

    it('CSP blocks default-src', () => {
      const result = wrapHtml('<div>test</div>')
      expect(result).toContain("default-src 'none'")
    })

    it('CSP allows inline scripts', () => {
      const result = wrapHtml('<div>test</div>')
      expect(result).toContain("script-src 'unsafe-inline'")
    })

    it('CSP allows inline styles', () => {
      const result = wrapHtml('<div>test</div>')
      expect(result).toContain("style-src 'unsafe-inline'")
    })

    it('CSP allows data: and blob: images', () => {
      const result = wrapHtml('<div>test</div>')
      expect(result).toContain('img-src data: blob:')
    })
  })

  describe('height clamping', () => {
    it('clamps below minimum', () => {
      expect(clampHeight(50)).toBe(MICRO_APP_MIN_HEIGHT)
    })

    it('clamps above maximum', () => {
      expect(clampHeight(1000)).toBe(MICRO_APP_MAX_HEIGHT)
    })

    it('passes through values in range', () => {
      const mid = Math.floor((MICRO_APP_MIN_HEIGHT + MICRO_APP_MAX_HEIGHT) / 2)
      expect(clampHeight(mid)).toBe(mid)
    })

    it('returns minimum for negative values', () => {
      expect(clampHeight(-100)).toBe(MICRO_APP_MIN_HEIGHT)
    })

    it('returns minimum for zero', () => {
      expect(clampHeight(0)).toBe(MICRO_APP_MIN_HEIGHT)
    })

    it('accepts exact minimum', () => {
      expect(clampHeight(MICRO_APP_MIN_HEIGHT)).toBe(MICRO_APP_MIN_HEIGHT)
    })

    it('accepts exact maximum', () => {
      expect(clampHeight(MICRO_APP_MAX_HEIGHT)).toBe(MICRO_APP_MAX_HEIGHT)
    })
  })
})

describe('MicroApp constants', () => {
  it('MICRO_APP_MIN_HEIGHT is 100', () => {
    expect(MICRO_APP_MIN_HEIGHT).toBe(100)
  })

  it('MICRO_APP_MAX_HEIGHT is 600', () => {
    expect(MICRO_APP_MAX_HEIGHT).toBe(600)
  })

  it('MICRO_APP_MAX_SIZE is 200KB', () => {
    expect(MICRO_APP_MAX_SIZE).toBe(200 * 1024)
  })

  it('MIN < MAX', () => {
    expect(MICRO_APP_MIN_HEIGHT).toBeLessThan(MICRO_APP_MAX_HEIGHT)
  })
})
