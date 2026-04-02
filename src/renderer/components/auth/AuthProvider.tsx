import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import AuthGate from './AuthGate'

export interface AuthState {
  name: string
  role: 'student' | 'teacher'
  timestamp: number
}

interface AuthContextValue {
  auth: AuthState | null
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue>({
  auth: null,
  signOut: () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

function readAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem('chatbridge_auth')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.name === 'string' && (parsed.role === 'student' || parsed.role === 'teacher')) {
      return parsed as AuthState
    }
    return null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(() => readAuth())

  const handleAuthenticated = useCallback(() => {
    setAuth(readAuth())
  }, [])

  const signOut = useCallback(() => {
    localStorage.removeItem('chatbridge_auth')
    setAuth(null)
  }, [])

  if (!auth) {
    return <AuthGate onAuthenticated={handleAuthenticated} />
  }

  return (
    <AuthContext.Provider value={{ auth, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
