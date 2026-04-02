import { useState } from 'react'

interface AuthGateProps {
  onAuthenticated: () => void
}

export default function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<'student' | 'teacher'>('student')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Please enter your name')
      return
    }
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters')
      return
    }
    localStorage.setItem(
      'chatbridge_auth',
      JSON.stringify({ name: trimmed, role, timestamp: Date.now() })
    )
    onAuthenticated()
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-50 dark:bg-slate-900">
      <div className="w-full max-w-md mx-4">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 mb-4">
            <span className="text-3xl" role="img" aria-label="bridge">
              🌉
            </span>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            ChatBridge
          </h1>
          <p className="mt-2 text-slate-500 dark:text-slate-400 text-sm">
            AI-powered learning, one conversation at a time
          </p>
        </div>

        {/* Form Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg shadow-slate-200/50 dark:shadow-black/20 border border-slate-200 dark:border-slate-700 p-8"
        >
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-6">
            Welcome! Let's get started.
          </h2>

          {/* Name */}
          <div className="mb-5">
            <label
              htmlFor="auth-name"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Your Name
            </label>
            <input
              id="auth-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (error) setError('')
              }}
              placeholder="Enter your name"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
            />
          </div>

          {/* Role */}
          <div className="mb-6">
            <label
              htmlFor="auth-role"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              I am a...
            </label>
            <select
              id="auth-role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'student' | 'teacher')}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow appearance-none cursor-pointer"
            >
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
            </select>
          </div>

          {/* Error */}
          {error && (
            <p className="text-red-500 dark:text-red-400 text-sm mb-4">
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
          >
            Get Started
          </button>
        </form>

        {/* Footer */}
        <p className="text-center mt-6 text-xs text-slate-400 dark:text-slate-500">
          Built for K-12 classrooms. No password required.
        </p>
      </div>
    </div>
  )
}
