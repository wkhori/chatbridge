import { useCallback, useEffect, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { ChatBridgeSDK } from './chatbridge-sdk'

const APP_ID = 'chess'

// Tool definitions for the platform
const TOOLS = [
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
    description: 'Analyze the current board position and suggest the best move. Returns analysis.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'resign',
    description: 'Resign the current game on behalf of the player.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_status',
    description: 'Get the current game status including FEN, PGN, move history, and game state.',
    inputSchema: { type: 'object', properties: {} },
  },
]

export function ChessApp() {
  const [game, setGame] = useState(new Chess())
  const [playerColor, setPlayerColor] = useState<'white' | 'black'>('white')
  const [gameStarted, setGameStarted] = useState(false)
  const [gameOver, setGameOver] = useState(false)
  const [statusText, setStatusText] = useState('Waiting for game to start...')
  const sdkRef = useRef<ChatBridgeSDK | null>(null)

  // Initialize SDK on mount
  useEffect(() => {
    const sdk = new ChatBridgeSDK(APP_ID)
    sdkRef.current = sdk

    // Register tool handlers
    sdk.registerToolHandler('start_game', async (params) => {
      const color = (params.playerColor as string) || 'white'
      const newGame = new Chess()
      setGame(newGame)
      setPlayerColor(color as 'white' | 'black')
      setGameStarted(true)
      setGameOver(false)
      setStatusText(color === 'white' ? 'Your turn (White)' : "AI's turn (White)")

      sendStateUpdate(sdk, newGame)
      return {
        message: `Game started! Player is ${color}.`,
        fen: newGame.fen(),
        playerColor: color,
      }
    })

    sdk.registerToolHandler('make_move', async (params) => {
      const moveStr = params.move as string
      if (!moveStr) return { error: 'No move provided' }

      const currentGame = gameRef.current
      try {
        const result = currentGame.move(moveStr)
        if (!result) return { error: `Invalid move: ${moveStr}` }
        setGame(new Chess(currentGame.fen()))
        sendStateUpdate(sdk, currentGame)
        checkGameOver(sdk, currentGame)
        return {
          move: result.san,
          fen: currentGame.fen(),
          isCheck: currentGame.isCheck(),
          isCheckmate: currentGame.isCheckmate(),
          turn: currentGame.turn() === 'w' ? 'white' : 'black',
        }
      } catch {
        return { error: `Invalid move: ${moveStr}. Legal moves: ${currentGame.moves().join(', ')}` }
      }
    })

    sdk.registerToolHandler('get_hint', async () => {
      const currentGame = gameRef.current
      const moves = currentGame.moves({ verbose: true })
      if (moves.length === 0) return { error: 'No legal moves available' }

      // Simple evaluation: prioritize captures, checks, center control
      const scored = moves.map((m) => {
        let score = Math.random() * 0.5
        if (m.captured) score += 3
        if (m.san.includes('+')) score += 2
        if (['e4', 'e5', 'd4', 'd5'].includes(m.to)) score += 1
        if (m.san === 'O-O' || m.san === 'O-O-O') score += 1.5
        return { move: m, score }
      })
      scored.sort((a, b) => b.score - a.score)

      const best = scored[0].move
      return {
        suggestedMove: best.san,
        from: best.from,
        to: best.to,
        reason: best.captured
          ? `Captures ${best.captured} on ${best.to}`
          : best.san.includes('+')
            ? 'Gives check'
            : 'Develops position',
        fen: currentGame.fen(),
        legalMoves: currentGame.moves(),
      }
    })

    sdk.registerToolHandler('resign', async () => {
      setGameOver(true)
      setStatusText('Game over — Player resigned')
      const currentGame = gameRef.current
      sdk.sendCompletion('game_over', {
        result: 'resignation',
        winner: playerColor === 'white' ? 'black' : 'white',
        pgn: currentGame.pgn(),
        fen: currentGame.fen(),
        moves: currentGame.history().length,
      }, `Player (${playerColor}) resigned after ${currentGame.history().length} moves.`)
      return { message: 'Player resigned.', pgn: currentGame.pgn() }
    })

    sdk.registerToolHandler('get_status', async () => {
      const currentGame = gameRef.current
      return {
        fen: currentGame.fen(),
        pgn: currentGame.pgn(),
        turn: currentGame.turn() === 'w' ? 'white' : 'black',
        moveHistory: currentGame.history(),
        moveCount: currentGame.history().length,
        isCheck: currentGame.isCheck(),
        isCheckmate: currentGame.isCheckmate(),
        isDraw: currentGame.isDraw(),
        isStalemate: currentGame.isStalemate(),
        isGameOver: currentGame.isGameOver(),
        legalMoves: currentGame.moves(),
      }
    })

    // Send READY and register tools
    sdk.sendReady('Chess', '1.0.0')
    sdk.registerTools(TOOLS)

    // Check for restored state
    const checkRestore = setInterval(() => {
      const restored = sdk.getRestoredState()
      if (restored?.fen) {
        try {
          const restoredGame = new Chess(restored.fen as string)
          setGame(restoredGame)
          setPlayerColor((restored.playerColor as 'white' | 'black') || 'white')
          setGameStarted(true)
          setStatusText('Game restored')
          clearInterval(checkRestore)
        } catch {
          // Invalid restored state, ignore
        }
      }
    }, 500)
    setTimeout(() => clearInterval(checkRestore), 5000)

    // Request resize
    sdk.requestResize(480)

    return () => {
      clearInterval(checkRestore)
      sdk.destroy()
    }
  }, [])

  // Keep a ref to the latest game state for tool handlers
  const gameRef = useRef(game)
  gameRef.current = game

  const sendStateUpdate = useCallback((sdk: ChatBridgeSDK, g: Chess) => {
    sdk.sendStateUpdate(
      {
        fen: g.fen(),
        pgn: g.pgn(),
        turn: g.turn() === 'w' ? 'white' : 'black',
        moveCount: g.history().length,
        lastMove: g.history().length > 0 ? g.history()[g.history().length - 1] : null,
        isCheck: g.isCheck(),
      },
      `Chess game: ${g.history().length} moves played. Turn: ${g.turn() === 'w' ? 'White' : 'Black'}. FEN: ${g.fen()}`,
      g.history().length
    )
  }, [])

  const checkGameOver = useCallback((sdk: ChatBridgeSDK, g: Chess) => {
    if (!g.isGameOver()) {
      setStatusText(g.turn() === 'w' ? 'White to move' : 'Black to move')
      return
    }

    setGameOver(true)
    let result = 'draw'
    let winner: string | null = null
    let reason = ''

    if (g.isCheckmate()) {
      winner = g.turn() === 'w' ? 'black' : 'white'
      result = 'checkmate'
      reason = `Checkmate! ${winner === 'white' ? 'White' : 'Black'} wins.`
    } else if (g.isStalemate()) {
      reason = 'Stalemate — draw.'
    } else if (g.isDraw()) {
      reason = 'Draw.'
    }

    setStatusText(reason)
    sdk.sendCompletion('game_over', {
      result,
      winner,
      pgn: g.pgn(),
      fen: g.fen(),
      moves: g.history().length,
    }, `${reason} Game lasted ${g.history().length} moves. PGN: ${g.pgn()}`)
  }, [])

  // Handle player move on the board
  const onDrop = useCallback(
    (sourceSquare: Square, targetSquare: Square): boolean => {
      if (gameOver || !gameStarted) return false
      const currentTurn = game.turn() === 'w' ? 'white' : 'black'
      if (currentTurn !== playerColor) return false

      try {
        const move = game.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: 'q', // auto-promote to queen
        })
        if (!move) return false

        const newGame = new Chess(game.fen())
        setGame(newGame)

        if (sdkRef.current) {
          sendStateUpdate(sdkRef.current, game)
          checkGameOver(sdkRef.current, game)
        }
        return true
      } catch {
        return false
      }
    },
    [game, playerColor, gameOver, gameStarted, sendStateUpdate, checkGameOver]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%', maxWidth: '460px' }}>
      {/* Status bar */}
      <div style={{
        width: '100%',
        padding: '6px 12px',
        borderRadius: '6px',
        background: gameOver ? '#2d1b30' : '#16213e',
        fontSize: '13px',
        textAlign: 'center',
        color: gameOver ? '#e74c3c' : '#a8d8ea',
      }}>
        {statusText}
      </div>

      {/* Board */}
      <div style={{ width: '100%', aspectRatio: '1' }}>
        <Chessboard
          position={game.fen()}
          onPieceDrop={onDrop}
          boardOrientation={playerColor}
          animationDuration={200}
          customDarkSquareStyle={{ backgroundColor: '#34495e' }}
          customLightSquareStyle={{ backgroundColor: '#ecf0f1' }}
          customBoardStyle={{ borderRadius: '4px' }}
        />
      </div>

      {/* Move history */}
      {game.history().length > 0 && (
        <div style={{
          width: '100%',
          padding: '6px 12px',
          borderRadius: '6px',
          background: '#16213e',
          fontSize: '12px',
          color: '#7f8c8d',
          maxHeight: '60px',
          overflow: 'auto',
        }}>
          {game.history().map((move, i) => (
            <span key={i}>
              {i % 2 === 0 && <span style={{ color: '#546e7a' }}>{Math.floor(i / 2) + 1}. </span>}
              <span style={{ color: '#a8d8ea' }}>{move} </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
