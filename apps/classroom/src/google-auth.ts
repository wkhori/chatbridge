/**
 * Google OAuth2 implicit flow for sandboxed iframe context.
 * Opens a popup for Google sign-in, receives the access token via postMessage from the callback page.
 */

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || `${window.location.origin}/auth-callback.html`
const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ')

export interface GoogleUser {
  name: string
  email: string
  picture: string
}

export function startOAuthFlow(): Promise<string> {
  return new Promise((resolve, reject) => {
    const state = crypto.randomUUID()
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    authUrl.searchParams.set('response_type', 'token')
    authUrl.searchParams.set('scope', SCOPES)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('prompt', 'select_account')

    const popup = window.open(authUrl.toString(), 'google-auth', 'width=500,height=600')
    if (!popup) {
      reject(new Error('Popup blocked — please allow popups for this site'))
      return
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'google-oauth-callback') return
      if (event.data.state !== state) return
      window.removeEventListener('message', handleMessage)
      clearInterval(pollTimer)

      if (event.data.error) {
        reject(new Error(event.data.error))
      } else if (event.data.access_token) {
        resolve(event.data.access_token)
      } else {
        reject(new Error('No access token received'))
      }
    }

    window.addEventListener('message', handleMessage)

    // Poll to detect if popup was closed without completing auth
    const pollTimer = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollTimer)
        window.removeEventListener('message', handleMessage)
        reject(new Error('Auth popup was closed'))
      }
    }, 500)

    // Timeout after 2 minutes
    setTimeout(() => {
      clearInterval(pollTimer)
      window.removeEventListener('message', handleMessage)
      if (!popup.closed) popup.close()
      reject(new Error('Auth timed out'))
    }, 120_000)
  })
}

export async function fetchUserProfile(accessToken: string): Promise<GoogleUser> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Failed to fetch user profile')
  const data = await res.json()
  return { name: data.name, email: data.email, picture: data.picture }
}
