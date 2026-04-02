import { useCallback, useEffect, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { ChatBridgeSDK } from '@chatbridge/sdk'

const APP_ID = 'chess'
const isStandalone = window.self === window.top

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

/** Simple heuristic: score moves and pick the best one with some randomness */
function pickComputerMove(g: Chess): string | null {
  const moves = g.moves({ verbose: true })
  if (moves.length === 0) return null

  const scored = moves.map((m) => {
    let score = Math.random() * 0.8
    if (m.captured) {
      const pieceValues: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
      score += (pieceValues[m.captured] || 1) * 2
    }
    if (m.san.includes('+')) score += 3
    if (m.san.includes('#')) score += 100
    // Center control
    if (['d4', 'd5', 'e4', 'e5'].includes(m.to)) score += 1.2
    if (['c3', 'c4', 'c5', 'c6', 'f3', 'f4', 'f5', 'f6'].includes(m.to)) score += 0.5
    // Castling
    if (m.san === 'O-O' || m.san === 'O-O-O') score += 2
    // Developing knights/bishops early
    if (g.moveNumber() < 10 && (m.piece === 'n' || m.piece === 'b')) score += 0.8
    return { move: m, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].move.san
}

export function ChessApp() {
  const [game, setGame] = useState(new Chess())
  const [playerColor, setPlayerColor] = useState<'white' | 'black'>('white')
  const [gameStarted, setGameStarted] = useState(isStandalone)
  const [gameOver, setGameOver] = useState(false)
  const [statusText, setStatusText] = useState(isStandalone ? 'Your turn (White)' : 'Waiting for game to start...')
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)
  const [legalMoveSquares, setLegalMoveSquares] = useState<Record<string, React.CSSProperties>>({})
  const sdkRef = useRef<ChatBridgeSDK | null>(null)
  const gameRef = useRef(game)
  gameRef.current = game

  const updateStatus = useCallback((g: Chess) => {
    if (g.isGameOver()) {
      setGameOver(true)
      if (g.isCheckmate()) {
        const winner = g.turn() === 'w' ? 'Black' : 'White'
        setStatusText(`Checkmate! ${winner} wins.`)
      } else if (g.isStalemate()) {
        setStatusText('Stalemate — draw.')
      } else {
        setStatusText('Draw.')
      }
    } else {
      const turn = g.turn() === 'w' ? 'White' : 'Black'
      const check = g.isCheck() ? ' (Check!)' : ''
      setStatusText(`${turn} to move${check}`)
    }
  }, [])

  /** Make computer respond in standalone mode */
  const makeComputerMove = useCallback((g: Chess) => {
    if (!isStandalone || g.isGameOver()) return
    const computerColor = playerColor === 'white' ? 'b' : 'w'
    if (g.turn() !== computerColor) return

    setTimeout(() => {
      const move = pickComputerMove(g)
      if (!move) return
      try {
        g.move(move)
        const newGame = new Chess(g.fen())
        setGame(newGame)
        updateStatus(newGame)
        // Check if game over after computer move
        if (!newGame.isGameOver()) {
          // Could chain, but one move is enough
        }
      } catch {
        // Shouldn't happen
      }
    }, 400)
  }, [playerColor, updateStatus])

  // Initialize SDK on mount
  useEffect(() => {
    const sdk = new ChatBridgeSDK(APP_ID)
    sdkRef.current = sdk

    const sendState = (g: Chess) => {
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
    }

    const handleGameOver = (g: Chess) => {
      if (!g.isGameOver()) return
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
      } else {
        reason = 'Draw.'
      }
      setStatusText(reason)
      sdk.sendCompletion('game_over', {
        result, winner, pgn: g.pgn(), fen: g.fen(), moves: g.history().length,
      }, `${reason} Game lasted ${g.history().length} moves.`)
    }

    sdk.registerToolHandler('start_game', async (params) => {
      const color = (params.playerColor as string) || 'white'
      const newGame = new Chess()
      setGame(newGame)
      setPlayerColor(color as 'white' | 'black')
      setGameStarted(true)
      setGameOver(false)
      setStatusText(color === 'white' ? 'Your turn (White)' : "AI's turn (White)")
      sendState(newGame)
      return { message: `Game started! Player is ${color}.`, fen: newGame.fen(), playerColor: color }
    })

    sdk.registerToolHandler('make_move', async (params) => {
      const moveStr = params.move as string
      if (!moveStr) return { error: 'No move provided' }
      const currentGame = gameRef.current
      try {
        const result = currentGame.move(moveStr)
        if (!result) return { error: `Invalid move: ${moveStr}` }
        setGame(new Chess(currentGame.fen()))
        sendState(currentGame)
        handleGameOver(currentGame)
        return {
          move: result.san, fen: currentGame.fen(),
          isCheck: currentGame.isCheck(), isCheckmate: currentGame.isCheckmate(),
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
        suggestedMove: best.san, from: best.from, to: best.to,
        reason: best.captured ? `Captures ${best.captured} on ${best.to}` : best.san.includes('+') ? 'Gives check' : 'Develops position',
        fen: currentGame.fen(), legalMoves: currentGame.moves(),
      }
    })

    sdk.registerToolHandler('resign', async () => {
      setGameOver(true)
      setStatusText('Game over — Player resigned')
      const currentGame = gameRef.current
      sdk.sendCompletion('game_over', {
        result: 'resignation', winner: playerColor === 'white' ? 'black' : 'white',
        pgn: currentGame.pgn(), fen: currentGame.fen(), moves: currentGame.history().length,
      }, `Player resigned after ${currentGame.history().length} moves.`)
      return { message: 'Player resigned.', pgn: currentGame.pgn() }
    })

    sdk.registerToolHandler('get_status', async () => {
      const currentGame = gameRef.current
      return {
        fen: currentGame.fen(), pgn: currentGame.pgn(),
        turn: currentGame.turn() === 'w' ? 'white' : 'black',
        moveHistory: currentGame.history(), moveCount: currentGame.history().length,
        isCheck: currentGame.isCheck(), isCheckmate: currentGame.isCheckmate(),
        isDraw: currentGame.isDraw(), isStalemate: currentGame.isStalemate(),
        isGameOver: currentGame.isGameOver(), legalMoves: currentGame.moves(),
      }
    })

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
        } catch { /* ignore */ }
      }
    }, 500)
    setTimeout(() => clearInterval(checkRestore), 5000)

    sdk.requestResize(480)

    return () => {
      clearInterval(checkRestore)
      sdk.destroy()
    }
  }, [])

  /** Show legal moves when clicking a square with own piece */
  const onSquareClick = useCallback((square: Square) => {
    if (gameOver || !gameStarted) return

    // If clicking on a legal move target, make the move
    if (selectedSquare && legalMoveSquares[square]) {
      try {
        const move = game.move({ from: selectedSquare, to: square, promotion: 'q' })
        if (move) {
          const newGame = new Chess(game.fen())
          setGame(newGame)
          setSelectedSquare(null)
          setLegalMoveSquares({})
          updateStatus(newGame)
          if (sdkRef.current) {
            sdkRef.current.sendStateUpdate(
              { fen: newGame.fen(), turn: newGame.turn() === 'w' ? 'white' : 'black' },
              `Move: ${move.san}`,
            )
          }
          makeComputerMove(newGame)
          return
        }
      } catch { /* fall through to piece selection */ }
    }

    // Select a piece and show its legal moves
    const piece = game.get(square)
    const myColor = playerColor === 'white' ? 'w' : 'b'
    if (!piece || piece.color !== myColor) {
      setSelectedSquare(null)
      setLegalMoveSquares({})
      return
    }

    const moves = game.moves({ square, verbose: true })
    const highlights: Record<string, React.CSSProperties> = {}

    // Highlight the selected square
    highlights[square] = { backgroundColor: 'rgba(52, 152, 219, 0.4)' }

    for (const m of moves) {
      highlights[m.to] = {
        background: m.captured
          ? 'radial-gradient(circle, rgba(231,76,60,0.5) 65%, transparent 65%)'
          : 'radial-gradient(circle, rgba(46,204,113,0.4) 25%, transparent 25%)',
        borderRadius: '50%',
      }
    }
    setSelectedSquare(square)
    setLegalMoveSquares(highlights)
  }, [game, gameOver, gameStarted, playerColor, selectedSquare, legalMoveSquares, updateStatus, makeComputerMove])

  /** Handle drag-and-drop moves */
  const onDrop = useCallback(
    (sourceSquare: Square, targetSquare: Square): boolean => {
      if (gameOver || !gameStarted) return false
      const currentTurn = game.turn() === 'w' ? 'white' : 'black'
      if (currentTurn !== playerColor) return false

      try {
        const move = game.move({ from: sourceSquare, to: targetSquare, promotion: 'q' })
        if (!move) return false

        const newGame = new Chess(game.fen())
        setGame(newGame)
        setSelectedSquare(null)
        setLegalMoveSquares({})
        updateStatus(newGame)

        if (sdkRef.current) {
          sdkRef.current.sendStateUpdate(
            { fen: newGame.fen(), turn: newGame.turn() === 'w' ? 'white' : 'black' },
            `Move: ${move.san}`,
          )
        }

        makeComputerMove(newGame)
        return true
      } catch {
        return false
      }
    },
    [game, playerColor, gameOver, gameStarted, updateStatus, makeComputerMove]
  )

  const handleNewGame = useCallback(() => {
    const newGame = new Chess()
    setGame(newGame)
    setPlayerColor('white')
    setGameStarted(true)
    setGameOver(false)
    setSelectedSquare(null)
    setLegalMoveSquares({})
    setStatusText('Your turn (White)')
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%', maxWidth: '460px' }}>
      {/* Status bar */}
      <div style={{
        width: '100%', padding: '6px 12px', borderRadius: '6px',
        background: gameOver ? '#2d1b30' : '#16213e',
        fontSize: '13px', color: gameOver ? '#e74c3c' : '#a8d8ea',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
      }}>
        <span>{statusText}</span>
        {isStandalone && (gameOver || gameStarted) && (
          <button onClick={handleNewGame} style={{
            padding: '2px 10px', borderRadius: '4px', border: '1px solid #3498db',
            background: 'transparent', color: '#3498db', fontSize: '12px', cursor: 'pointer',
          }}>
            New Game
          </button>
        )}
      </div>

      {/* Board */}
      <div style={{ width: '100%', aspectRatio: '1' }}>
        <Chessboard
          position={game.fen()}
          onPieceDrop={onDrop}
          onSquareClick={onSquareClick}
          boardOrientation={playerColor}
          animationDuration={200}
          customDarkSquareStyle={{ backgroundColor: '#34495e' }}
          customLightSquareStyle={{ backgroundColor: '#ecf0f1' }}
          customBoardStyle={{ borderRadius: '4px' }}
          customSquareStyles={legalMoveSquares}
        />
      </div>

      {/* Move history */}
      {game.history().length > 0 && (
        <div style={{
          width: '100%', padding: '6px 12px', borderRadius: '6px',
          background: '#16213e', fontSize: '12px', color: '#7f8c8d',
          maxHeight: '60px', overflow: 'auto',
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
