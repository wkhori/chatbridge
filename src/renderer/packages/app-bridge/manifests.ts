import type { AppManifest } from '@shared/protocol/types'

const isDev = import.meta.env.DEV

/**
 * Built-in app manifests. In production, these would come from a registry.
 * In dev mode, apps run on localhost for fast iteration.
 */

export const CHESS_MANIFEST: AppManifest = {
  id: 'chess',
  name: 'Chess',
  version: '1.0.0',
  description:
    'Interactive chess game. Students can play chess, ask for move suggestions, and analyze positions. Supports full game lifecycle with move validation.',
  url: isDev ? 'http://localhost:5173' : 'https://chatbridge-chess-production.up.railway.app',
  icon: '♟️',
  permissions: ['state_push', 'completion'],
  auth: { type: 'none' },
  keywords: ['chess', 'game', 'play', 'board', 'move', 'checkmate'],
  tools: [
    {
      name: 'start_game',
      description: 'Start a new chess game. Optionally set player color and difficulty.',
      inputSchema: {
        type: 'object',
        properties: {
          playerColor: {
            type: 'string',
            enum: ['white', 'black'],
            description: 'Color the human player plays as. Default: white.',
          },
          difficulty: {
            type: 'string',
            enum: ['easy', 'medium', 'hard'],
            description: 'AI difficulty level. Easy = beginner friendly, Medium = intermediate, Hard = strong play. Default: medium.',
          },
        },
      },
    },
    {
      name: 'make_move',
      description: 'Make a chess move in algebraic notation (e.g., "e4", "Nf3", "O-O"). Only use when the user explicitly asks to make a specific move via chat text.',
      inputSchema: {
        type: 'object',
        properties: {
          move: { type: 'string', description: 'Move in SAN notation (e.g., "e4", "Nf3", "O-O")' },
        },
        required: ['move'],
      },
    },
    {
      name: 'get_hint',
      description: 'Analyze the current board position and suggest the best move. Returns analysis.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'resign',
      description: 'Resign the current game on behalf of the player.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
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
  url: 'https://chatbridge-classroom-production.up.railway.app',
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
