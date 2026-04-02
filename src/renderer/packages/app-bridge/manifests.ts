import type { AppManifest } from '@shared/protocol/types'

/**
 * Built-in app manifests. In production, these would come from a registry.
 * For now, hardcode the chess app.
 */

export const CHESS_MANIFEST: AppManifest = {
  id: 'chess',
  name: 'Chess',
  version: '1.0.0',
  description:
    'Interactive chess game. Students can play chess, ask for move suggestions, and analyze positions. Supports full game lifecycle with move validation.',
  url: import.meta.env.DEV
    ? 'http://localhost:5173'
    : 'https://chatbridge-chess-production.up.railway.app',
  icon: '♟️',
  permissions: ['state_push', 'completion'],
  auth: { type: 'none' },
  keywords: ['chess', 'game', 'play', 'board', 'move', 'checkmate'],
}

export const WHITEBOARD_MANIFEST: AppManifest = {
  id: 'whiteboard',
  name: 'cre8 Whiteboard',
  version: '1.0.0',
  description:
    'Interactive infinite canvas whiteboard. Students can draw diagrams, create flowcharts, add shapes and sticky notes, and collaborate visually. View-only embed — no AI tool integration.',
  url: 'https://cre8-seven.vercel.app/demo',
  icon: '🎨',
  permissions: ['state_push', 'vision', 'ui_resize'],
  auth: { type: 'none' },
  keywords: ['draw', 'whiteboard', 'diagram', 'sketch', 'canvas', 'flowchart', 'sticky', 'visual', 'cre8'],
  viewOnly: true,
}

export const CLASSROOM_MANIFEST: AppManifest = {
  id: 'classroom',
  name: 'Google Classroom',
  version: '1.0.0',
  description:
    'Connect to Google Classroom to view courses, assignments, and grades. Students can ask the AI for help with specific assignments. Requires Google sign-in.',
  url: import.meta.env.DEV
    ? 'http://localhost:5174'
    : 'https://chatbridge-classroom-production.up.railway.app',
  icon: '📚',
  permissions: ['state_push', 'completion'],
  auth: {
    type: 'oauth2',
    provider: 'google',
    scopes: [
      'classroom.courses.readonly',
      'classroom.coursework.me.readonly',
      'classroom.student-submissions.me.readonly',
    ],
  },
  keywords: ['classroom', 'courses', 'assignments', 'homework', 'grades', 'google', 'school', 'class'],
}

export const BUILT_IN_MANIFESTS: AppManifest[] = [CHESS_MANIFEST, WHITEBOARD_MANIFEST, CLASSROOM_MANIFEST]
