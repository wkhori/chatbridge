import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatBridgeSDK } from '@chatbridge/sdk'
import { startOAuthFlow, fetchUserProfile, type GoogleUser } from './google-auth'
import { listCourses, listCourseWork, getSubmission, type Course, type CourseWork } from './classroom-api'

const APP_ID = 'classroom'

const TOOLS = [
  {
    name: 'sign_in',
    description: 'Prompt the student to sign in with their Google account to access Google Classroom.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_courses',
    description: 'List all active courses the student is enrolled in.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_assignments',
    description: 'List assignments/coursework for a specific course.',
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'string', description: 'The course ID to list assignments for' },
      },
      required: ['courseId'],
    },
  },
  {
    name: 'get_assignment_details',
    description: 'Get detailed info about a specific assignment including submission status and grade.',
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'string', description: 'The course ID' },
        courseWorkId: { type: 'string', description: 'The assignment/coursework ID' },
      },
      required: ['courseId', 'courseWorkId'],
    },
  },
]

export function ClassroomApp() {
  const [user, setUser] = useState<GoogleUser | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null)
  const [assignments, setAssignments] = useState<CourseWork[]>([])
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef<string | null>(null)
  const sdkRef = useRef<ChatBridgeSDK | null>(null)

  useEffect(() => {
    const sdk = new ChatBridgeSDK(APP_ID)
    sdkRef.current = sdk

    // Tool: sign_in
    sdk.registerToolHandler('sign_in', async () => {
      if (tokenRef.current && user) {
        return { already_signed_in: true, user: { name: user.name, email: user.email } }
      }
      try {
        setIsSigningIn(true)
        setError(null)
        const token = await startOAuthFlow()
        tokenRef.current = token
        const profile = await fetchUserProfile(token)
        setUser(profile)
        setIsSigningIn(false)

        // Auto-fetch courses after sign-in
        const courseList = await listCourses(token)
        setCourses(courseList)

        sdk.sendStateUpdate(
          { signedIn: true, user: profile.name, courseCount: courseList.length },
          `Signed in as ${profile.name}. ${courseList.length} active courses.`
        )

        return {
          success: true,
          user: { name: profile.name, email: profile.email },
          courses: courseList.map((c) => ({ id: c.id, name: c.name, section: c.section })),
        }
      } catch (err) {
        setIsSigningIn(false)
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        return { error: msg }
      }
    })

    // Tool: list_courses
    sdk.registerToolHandler('list_courses', async () => {
      if (!tokenRef.current) return { error: 'Not signed in. Please use sign_in first.' }
      try {
        const courseList = await listCourses(tokenRef.current)
        setCourses(courseList)
        return {
          courses: courseList.map((c) => ({
            id: c.id,
            name: c.name,
            section: c.section,
            state: c.courseState,
            link: c.alternateLink,
          })),
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })

    // Tool: list_assignments
    sdk.registerToolHandler('list_assignments', async (params) => {
      if (!tokenRef.current) return { error: 'Not signed in. Please use sign_in first.' }
      const courseId = params.courseId as string
      try {
        const work = await listCourseWork(tokenRef.current, courseId)
        setAssignments(work)
        const course = courses.find((c) => c.id === courseId)
        if (course) setSelectedCourse(course)

        return {
          assignments: work.map((w) => ({
            id: w.id,
            title: w.title,
            type: w.workType,
            dueDate: w.dueDate ? `${w.dueDate.year}-${String(w.dueDate.month).padStart(2, '0')}-${String(w.dueDate.day).padStart(2, '0')}` : null,
            maxPoints: w.maxPoints,
            link: w.alternateLink,
          })),
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })

    // Tool: get_assignment_details
    sdk.registerToolHandler('get_assignment_details', async (params) => {
      if (!tokenRef.current) return { error: 'Not signed in. Please use sign_in first.' }
      const { courseId, courseWorkId } = params as { courseId: string; courseWorkId: string }
      try {
        const submission = await getSubmission(tokenRef.current, courseId, courseWorkId)
        return {
          courseWorkId,
          submission: submission
            ? {
                state: submission.state,
                late: submission.late,
                grade: submission.assignedGrade ?? null,
                link: submission.alternateLink,
              }
            : null,
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })

    sdk.sendReady('Google Classroom', '1.0.0')
    sdk.registerTools(TOOLS)
    sdk.requestResize(400)

    return () => sdk.destroy()
  }, [])

  const handleManualSignIn = useCallback(async () => {
    if (!sdkRef.current) return
    setIsSigningIn(true)
    setError(null)
    try {
      const token = await startOAuthFlow()
      tokenRef.current = token
      const profile = await fetchUserProfile(token)
      setUser(profile)
      const courseList = await listCourses(token)
      setCourses(courseList)
      sdkRef.current.sendStateUpdate(
        { signedIn: true, user: profile.name, courseCount: courseList.length },
        `Signed in as ${profile.name}. ${courseList.length} active courses.`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSigningIn(false)
    }
  }, [])

  // Signed out state
  if (!user) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '32px 16px' }}>
        <div style={{ fontSize: '32px' }}>📚</div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#e0e0e0' }}>Google Classroom</div>
        <div style={{ fontSize: '13px', color: '#7f8c8d', textAlign: 'center', maxWidth: '280px' }}>
          Sign in with your Google account to see your courses and assignments.
        </div>
        <button
          onClick={handleManualSignIn}
          disabled={isSigningIn}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 24px', borderRadius: '8px', border: 'none',
            background: isSigningIn ? '#34495e' : '#4285f4', color: '#fff',
            fontSize: '14px', fontWeight: 500, cursor: isSigningIn ? 'default' : 'pointer',
            opacity: isSigningIn ? 0.7 : 1, transition: 'opacity 0.2s',
          }}
        >
          {isSigningIn ? (
            <span>Signing in...</span>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Sign in with Google
            </>
          )}
        </button>
        {error && (
          <div style={{ fontSize: '12px', color: '#e74c3c', textAlign: 'center', maxWidth: '280px' }}>
            {error}
          </div>
        )}
      </div>
    )
  }

  // Signed in state
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '460px', margin: '0 auto' }}>
      {/* User header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 12px', borderRadius: '8px', background: '#16213e',
      }}>
        <img
          src={user.picture}
          alt=""
          style={{ width: '28px', height: '28px', borderRadius: '50%' }}
          referrerPolicy="no-referrer"
        />
        <div>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#e0e0e0' }}>{user.name}</div>
          <div style={{ fontSize: '11px', color: '#7f8c8d' }}>{courses.length} active courses</div>
        </div>
      </div>

      {/* Course list */}
      {courses.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#7f8c8d', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Courses
          </div>
          {courses.map((course) => (
            <div
              key={course.id}
              style={{
                padding: '8px 12px', borderRadius: '6px',
                background: selectedCourse?.id === course.id ? '#1e3a5f' : '#16213e',
                border: selectedCourse?.id === course.id ? '1px solid #3498db' : '1px solid transparent',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onClick={() => setSelectedCourse(course)}
            >
              <div style={{ fontSize: '13px', fontWeight: 500, color: '#e0e0e0' }}>{course.name}</div>
              {course.section && (
                <div style={{ fontSize: '11px', color: '#7f8c8d' }}>{course.section}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Assignments for selected course */}
      {selectedCourse && assignments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#7f8c8d', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Assignments — {selectedCourse.name}
          </div>
          {assignments.map((work) => (
            <div
              key={work.id}
              style={{
                padding: '8px 12px', borderRadius: '6px', background: '#16213e',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 500, color: '#e0e0e0' }}>{work.title}</div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#7f8c8d', marginTop: '2px' }}>
                <span>{work.workType.replace('_', ' ').toLowerCase()}</span>
                {work.dueDate && (
                  <span>Due: {work.dueDate.year}-{String(work.dueDate.month).padStart(2, '0')}-{String(work.dueDate.day).padStart(2, '0')}</span>
                )}
                {work.maxPoints != null && <span>{work.maxPoints} pts</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {courses.length === 0 && (
        <div style={{ fontSize: '13px', color: '#7f8c8d', textAlign: 'center', padding: '16px' }}>
          No active courses found. Ask the AI to list your courses.
        </div>
      )}
    </div>
  )
}
