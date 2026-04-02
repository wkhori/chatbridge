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
    ? 'http://localhost:5173' // Chess app dev server
    : 'https://chatbridge-chess.vercel.app', // Production URL (update after deploy)
  icon: '♟️',
  permissions: ['state_push', 'completion'],
  auth: { type: 'none' },
  tools: [
    {
      name: 'start_game',
      description: 'Start a new chess game. Optionally set player color.',
      inputSchema: {
        type: 'object',
        properties: {
          playerColor: {
            type: 'string',
            enum: ['white', 'black'],
            description: 'Color the human player plays as. Default: white.',
          },
        },
      },
    },
    {
      name: 'make_move',
      description: 'Make a chess move in algebraic notation (e.g., "e4", "Nf3", "O-O").',
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
      description: 'Analyze current board position and suggest the best move.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'resign',
      description: 'Resign the current game.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_status',
      description: 'Get current game status: FEN, PGN, move history, game state, legal moves.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  keywords: ['chess', 'game', 'play', 'board', 'move', 'checkmate'],
}

export const BUILT_IN_MANIFESTS: AppManifest[] = [CHESS_MANIFEST]
