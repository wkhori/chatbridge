import { useCallback, useEffect, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { ChatBridgeSDK } from '@chatbridge/sdk'
import {
  initStockfish,
  getBestMove,
  getAnalysis,
  setSkillLevel,
  destroy as destroyStockfish,
} from './stockfish-worker'

const APP_ID = 'chess'
const isStandalone = window.self === window.top

// Stockfish config by difficulty
const DIFFICULTY_CONFIG: Record<string, { depth: number; skillLevel: number; randomChance: number }> = {
  easy: { depth: 1, skillLevel: 0, randomChance: 0.4 },
  medium: { depth: 6, skillLevel: 10, randomChance: 0 },
  hard: { depth: 15, skillLevel: 20, randomChance: 0 },
}

// Tool definitions for the platform
const TOOLS = [
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
]

/** Fallback heuristic / easy mode random move picker */
function pickRandomMove(g: Chess): string | null {
  const moves = g.moves({ verbose: true })
  if (moves.length === 0) return null

  const scored = moves.map((m) => {
    let score = Math.random() * 2
    if (m.captured) {
      const pieceValues: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
      score += (pieceValues[m.captured] || 1) * 1.5
    }
    if (m.san.includes('+')) score += 2
    if (m.san.includes('#')) score += 100
    if (['d4', 'd5', 'e4', 'e5'].includes(m.to)) score += 0.8
    if (m.san === 'O-O' || m.san === 'O-O-O') score += 1.5
    if (g.moveNumber() < 10 && (m.piece === 'n' || m.piece === 'b')) score += 0.6
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
  const [difficulty, setDifficulty] = useState<string>('medium')
  const sdkRef = useRef<ChatBridgeSDK | null>(null)
  const stockfishReady = useRef(false)
  const gameRef = useRef(game)
  gameRef.current = game
  const playerColorRef = useRef(playerColor)
  playerColorRef.current = playerColor
  const gameStartedRef = useRef(gameStarted)
  gameStartedRef.current = gameStarted
  const difficultyRef = useRef(difficulty)
  difficultyRef.current = difficulty
  const gameOverRef = useRef(gameOver)
  gameOverRef.current = gameOver

  /** Start a new game from the in-app buttons */
  const startNewGame = useCallback((color: 'white' | 'black', diff: string) => {
    const config = DIFFICULTY_CONFIG[diff] || DIFFICULTY_CONFIG.medium
    if (stockfishReady.current) {
      setSkillLevel(config.skillLevel)
    }
    const newGame = new Chess()
    setGame(newGame)
    setPlayerColor(color)
    setDifficulty(diff)
    setGameStarted(true)
    setGameOver(false)
    setSelectedSquare(null)
    setLegalMoveSquares({})
    setStatusText(color === 'white' ? 'Your turn (White)' : "Computer's turn (White)")
    if (sdkRef.current) {
      sdkRef.current.sendStateUpdate(
        { fen: newGame.fen(), turn: 'white', playerColor: color, gameStarted: true, difficulty: diff },
        `New game started. Player: ${color}. Difficulty: ${diff}.`,
      )
    }
  }, [])

  /** Send game-over completion to the platform */
  const sendGameOver = useCallback((g: Chess) => {
    if (!g.isGameOver()) return
    const sdk = sdkRef.current
    if (!sdk) return
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
    sdk.sendCompletion('game_over', {
      result, winner, pgn: g.pgn(), fen: g.fen(), moves: g.history().length,
    }, `${reason} Game lasted ${g.history().length} moves.`)
  }, [])

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
      sendGameOver(g)
    } else {
      const turn = g.turn() === 'w' ? 'White' : 'Black'
      const check = g.isCheck() ? ' (Check!)' : ''
      setStatusText(`${turn} to move${check}`)
    }
  }, [sendGameOver])

  /** Make computer respond using Stockfish (with fallback heuristic) */
  const makeComputerMove = useCallback((g: Chess) => {
    if (g.isGameOver()) return
    const computerColor = playerColorRef.current === 'white' ? 'b' : 'w'
    if (g.turn() !== computerColor) return

    const config = DIFFICULTY_CONFIG[difficultyRef.current] || DIFFICULTY_CONFIG.medium

    const applyMove = (san: string) => {
      try {
        g.move(san)
        const newGame = new Chess(g.fen())
        setGame(newGame)
        updateStatus(newGame)
        if (sdkRef.current) {
          sdkRef.current.sendStateUpdate(
            {
              fen: newGame.fen(),
              turn: newGame.turn() === 'w' ? 'white' : 'black',
              playerColor: playerColorRef.current,
              gameStarted: true,
            },
            `Computer played: ${san}`,
          )
        }
      } catch {
        // Shouldn't happen with valid moves
      }
    }

    setTimeout(async () => {
      // On easy mode, sometimes play a random move instead of best
      if (config.randomChance > 0 && Math.random() < config.randomChance) {
        const move = pickRandomMove(g)
        if (move) {
          applyMove(move)
          return
        }
      }

      if (stockfishReady.current) {
        try {
          const uciMove = await getBestMove(g.fen(), config.depth)
          const from = uciMove.slice(0, 2)
          const to = uciMove.slice(2, 4)
          const promotion = uciMove[4] || undefined
          const result = g.move({ from, to, promotion })
          if (result) {
            const newGame = new Chess(g.fen())
            setGame(newGame)
            updateStatus(newGame)
            if (sdkRef.current) {
              sdkRef.current.sendStateUpdate(
                {
                  fen: newGame.fen(),
                  turn: newGame.turn() === 'w' ? 'white' : 'black',
                  playerColor: playerColorRef.current,
                  gameStarted: true,
                },
                `Computer played: ${result.san}`,
              )
            }
            return
          }
        } catch {
          // Fall through to heuristic
        }
      }
      // Fallback to random/heuristic
      const move = pickRandomMove(g)
      if (move) applyMove(move)
    }, 400)
  }, [updateStatus])

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
          playerColor: playerColorRef.current,
          gameStarted: gameStartedRef.current,
        },
        `Chess game: ${g.history().length} moves played. Turn: ${g.turn() === 'w' ? 'White' : 'Black'}. FEN: ${g.fen()}`,
        g.history().length
      )
    }

    sdk.registerToolHandler('start_game', async (params) => {
      const color = (params.playerColor as string) || 'white'
      const diff = (params.difficulty as string) || 'medium'
      const config = DIFFICULTY_CONFIG[diff] || DIFFICULTY_CONFIG.medium
      if (stockfishReady.current) {
        setSkillLevel(config.skillLevel)
      }
      const newGame = new Chess()
      setGame(newGame)
      setPlayerColor(color as 'white' | 'black')
      setDifficulty(diff)
      setGameStarted(true)
      setGameOver(false)
      setSelectedSquare(null)
      setLegalMoveSquares({})
      setStatusText(color === 'white' ? 'Your turn (White)' : "Computer's turn (White)")
      sendState(newGame)
      return { message: `Game started! Player is ${color}. Difficulty: ${diff}.`, fen: newGame.fen(), playerColor: color, difficulty: diff }
    })

    sdk.registerToolHandler('make_move', async (params) => {
      const moveStr = params.move as string
      if (!moveStr) return { error: 'No move provided' }
      const currentGame = gameRef.current
      try {
        const result = currentGame.move(moveStr)
        if (!result) return { error: `Invalid move: ${moveStr}` }
        const newGame = new Chess(currentGame.fen())
        setGame(newGame)
        sendState(currentGame)
        if (currentGame.isGameOver()) {
          setGameOver(true)
          const winner = currentGame.turn() === 'w' ? 'black' : 'white'
          setStatusText(currentGame.isCheckmate() ? `Checkmate! ${winner === 'white' ? 'White' : 'Black'} wins.` : 'Draw.')
          sdk.sendCompletion('game_over', {
            result: currentGame.isCheckmate() ? 'checkmate' : 'draw',
            winner: currentGame.isCheckmate() ? winner : null,
            pgn: currentGame.pgn(), fen: currentGame.fen(), moves: currentGame.history().length,
          }, `Game over after ${currentGame.history().length} moves.`)
        }
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

      if (stockfishReady.current) {
        try {
          const analysis = await getAnalysis(currentGame.fen(), 15)
          const uciMove = analysis.bestMove
          const from = uciMove.slice(0, 2)
          const to = uciMove.slice(2, 4)
          const promotion = uciMove[4] || undefined

          const copy = new Chess(currentGame.fen())
          const result = copy.move({ from, to, promotion })
          if (result) {
            const evalScore = analysis.score / 100
            let reason: string
            if (Math.abs(analysis.score) >= 9000) {
              const mateIn = analysis.score > 0
                ? 10000 - analysis.score
                : -(10000 + analysis.score)
              reason = `Mate in ${Math.abs(mateIn)} moves`
            } else if (result.captured) {
              reason = `Captures ${result.captured} on ${result.to} (eval: ${evalScore > 0 ? '+' : ''}${evalScore.toFixed(1)})`
            } else if (result.san.includes('+')) {
              reason = `Gives check (eval: ${evalScore > 0 ? '+' : ''}${evalScore.toFixed(1)})`
            } else {
              reason = `Best move by Stockfish analysis (eval: ${evalScore > 0 ? '+' : ''}${evalScore.toFixed(1)})`
            }

            return {
              suggestedMove: result.san,
              from: result.from,
              to: result.to,
              evaluation: evalScore,
              reason,
              fen: currentGame.fen(),
              legalMoves: currentGame.moves(),
            }
          }
        } catch {
          // Fall through to heuristic fallback
        }
      }

      // Fallback heuristic
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

    sdk.sendReady('Chess', '1.0.0')
    sdk.registerTools(TOOLS)

    // Initialize Stockfish engine
    initStockfish()
      .then(() => {
        stockfishReady.current = true
        console.log('[Chess] Stockfish engine ready')
      })
      .catch((err) => {
        console.warn('[Chess] Stockfish init failed, using heuristic fallback:', err)
      })

    // Check for restored state (from platform INIT with restoredState)
    const checkRestore = setInterval(() => {
      const restored = sdk.getRestoredState()
      if (restored?.fen || restored?.gameStarted) {
        try {
          const restoredGame = new Chess((restored.fen as string) || undefined)
          const color = (restored.playerColor as 'white' | 'black') || 'white'
          setGame(restoredGame)
          setPlayerColor(color)
          setGameStarted(true)
          setGameOver(restoredGame.isGameOver())
          if (restored.difficulty) setDifficulty(restored.difficulty as string)
          const turn = restoredGame.turn() === 'w' ? 'White' : 'Black'
          setStatusText(restoredGame.isGameOver() ? 'Game over' : `${turn} to move`)
          clearInterval(checkRestore)
        } catch { /* ignore */ }
      }
    }, 500)
    setTimeout(() => clearInterval(checkRestore), 5000)

    sdk.requestResize(580)

    // Retry READY every 2s until we receive INIT
    const readyRetry = setInterval(() => {
      if (sdk.getSessionId()) {
        clearInterval(readyRetry)
        return
      }
      sdk.sendReady('Chess', '1.0.0')
      sdk.registerTools(TOOLS)
    }, 2000)

    return () => {
      clearInterval(checkRestore)
      clearInterval(readyRetry)
      sdk.destroy()
      destroyStockfish()
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

  /** Show legal moves while dragging a piece */
  const onPieceDragBegin = useCallback((_piece: string, sourceSquare: Square) => {
    if (gameOver || !gameStarted) return
    const moves = game.moves({ square: sourceSquare, verbose: true })
    const highlights: Record<string, React.CSSProperties> = {}
    highlights[sourceSquare] = { backgroundColor: 'rgba(52, 152, 219, 0.4)' }
    for (const m of moves) {
      highlights[m.to] = {
        background: m.captured
          ? 'radial-gradient(circle, rgba(231,76,60,0.5) 65%, transparent 65%)'
          : 'radial-gradient(circle, rgba(46,204,113,0.4) 25%, transparent 25%)',
        borderRadius: '50%',
      }
    }
    setLegalMoveSquares(highlights)
  }, [game, gameOver, gameStarted])

  /** Only allow dragging own pieces on your turn */
  const isDraggablePiece = useCallback(({ piece }: { piece: string }) => {
    if (gameOver || !gameStarted) return false
    const currentTurn = game.turn() === 'w' ? 'white' : 'black'
    if (currentTurn !== playerColor) return false
    const pieceColor = piece[0] === 'w' ? 'white' : 'black'
    return pieceColor === playerColor
  }, [game, playerColor, gameOver, gameStarted])

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '100%', maxWidth: '460px', margin: '0 auto', overflow: 'hidden' }}>
      {/* Status bar */}
      <div style={{
        width: '100%', padding: '6px 12px', borderRadius: '6px',
        background: gameOver ? '#2d1b30' : '#16213e',
        fontSize: '13px', color: gameOver ? '#e74c3c' : '#a8d8ea',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
      }}>
        <span>{statusText}</span>
        {difficulty !== 'medium' && !gameOver && gameStarted && (
          <span style={{ fontSize: '11px', opacity: 0.6 }}>({difficulty})</span>
        )}
      </div>

      {/* Board */}
      <div style={{ width: '100%', aspectRatio: '1' }}>
        <Chessboard
          position={game.fen()}
          onPieceDrop={onDrop}
          onSquareClick={onSquareClick}
          onPieceDragBegin={onPieceDragBegin}
          isDraggablePiece={isDraggablePiece}
          boardOrientation={playerColor}
          animationDuration={200}
          customDarkSquareStyle={{ backgroundColor: '#34495e' }}
          customLightSquareStyle={{ backgroundColor: '#ecf0f1' }}
          customBoardStyle={{ borderRadius: '4px' }}
          customSquareStyles={legalMoveSquares}
        />
      </div>

      {/* Move history */}
      {game.history().length > 0 && !gameOver && (
        <div style={{
          width: '100%', padding: '6px 12px', borderRadius: '6px',
          background: '#16213e', fontSize: '12px', color: '#7f8c8d',
          maxHeight: '80px', overflowY: 'auto',
        }}>
          {game.history().map((move, i) => (
            <span key={i}>
              {i % 2 === 0 && <span style={{ color: '#546e7a' }}>{Math.floor(i / 2) + 1}. </span>}
              <span style={{ color: '#a8d8ea' }}>{move} </span>
            </span>
          ))}
        </div>
      )}

      {/* Game over — new game buttons */}
      {gameOver && (
        <div style={{
          width: '100%', display: 'flex', flexDirection: 'column', gap: '6px',
          padding: '8px 12px', borderRadius: '6px', background: '#16213e',
        }}>
          <div style={{ fontSize: '12px', color: '#7f8c8d', textAlign: 'center' }}>
            Play again?
          </div>
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {(['easy', 'medium', 'hard'] as const).map((diff) => (
              <button
                key={diff}
                onClick={() => startNewGame('white', diff)}
                style={{
                  padding: '4px 12px', borderRadius: '4px',
                  border: `1px solid ${diff === 'easy' ? '#2ecc71' : diff === 'medium' ? '#3498db' : '#e74c3c'}`,
                  background: 'transparent',
                  color: diff === 'easy' ? '#2ecc71' : diff === 'medium' ? '#3498db' : '#e74c3c',
                  fontSize: '12px', cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {diff}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
