/**
 * Google Classroom API client — read-only access to courses and coursework.
 */

const BASE = 'https://classroom.googleapis.com/v1'

export interface Course {
  id: string
  name: string
  section?: string
  descriptionHeading?: string
  courseState: string
  enrollmentCode?: string
  alternateLink: string
}

export interface CourseWork {
  id: string
  courseId: string
  title: string
  description?: string
  state: string
  dueDate?: { year: number; month: number; day: number }
  dueTime?: { hours: number; minutes: number }
  maxPoints?: number
  workType: string
  alternateLink: string
}

export interface Submission {
  id: string
  courseId: string
  courseWorkId: string
  state: string
  late: boolean
  assignedGrade?: number
  alternateLink: string
}

async function apiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Classroom API error (${res.status}): ${text}`)
  }
  return res.json()
}

export async function listCourses(token: string): Promise<Course[]> {
  const data = await apiFetch<{ courses?: Course[] }>('/courses?courseStates=ACTIVE&pageSize=20', token)
  return data.courses || []
}

export async function listCourseWork(token: string, courseId: string): Promise<CourseWork[]> {
  const data = await apiFetch<{ courseWork?: CourseWork[] }>(
    `/courses/${courseId}/courseWork?pageSize=20&orderBy=dueDate desc`,
    token
  )
  return data.courseWork || []
}

export async function getSubmission(token: string, courseId: string, courseWorkId: string): Promise<Submission | null> {
  const data = await apiFetch<{ studentSubmissions?: Submission[] }>(
    `/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions?pageSize=1`,
    token
  )
  return data.studentSubmissions?.[0] || null
}
