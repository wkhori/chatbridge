let worker: Worker | null = null
let isReady = false

export async function initStockfish(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      worker = new Worker('/stockfish.js')

      const onMessage = (e: MessageEvent) => {
        const line =
          typeof e.data === 'string' ? e.data : e.data?.toString?.() || ''
        if (line === 'uciok') {
          worker!.postMessage('isready')
        } else if (line === 'readyok') {
          isReady = true
          worker!.removeEventListener('message', onMessage)
          resolve()
        }
      }

      worker.addEventListener('message', onMessage)
      worker.postMessage('uci')

      setTimeout(() => {
        if (!isReady) {
          worker?.removeEventListener('message', onMessage)
          reject(new Error('Stockfish init timeout'))
        }
      }, 10000)
    } catch (err) {
      reject(err)
    }
  })
}

export function setSkillLevel(level: number): void {
  if (!worker || !isReady) return
  worker.postMessage(`setoption name Skill Level value ${Math.max(0, Math.min(20, level))}`)
}

export async function getBestMove(
  fen: string,
  depth = 12,
): Promise<string> {
  if (!worker || !isReady) throw new Error('Stockfish not initialized')

  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const line =
        typeof e.data === 'string' ? e.data : e.data?.toString?.() || ''
      if (line.startsWith('bestmove')) {
        worker!.removeEventListener('message', onMessage)
        const move = line.split(' ')[1]
        if (move && move !== '(none)') {
          resolve(move)
        } else {
          reject(new Error('No best move found'))
        }
      }
    }

    worker!.addEventListener('message', onMessage)
    worker!.postMessage(`position fen ${fen}`)
    worker!.postMessage(`go depth ${depth}`)

    setTimeout(() => {
      worker!.removeEventListener('message', onMessage)
      reject(new Error('Stockfish search timeout'))
    }, 15000)
  })
}

export async function getAnalysis(
  fen: string,
  depth = 15,
): Promise<{ bestMove: string; score: number }> {
  if (!worker || !isReady) throw new Error('Stockfish not initialized')

  return new Promise((resolve, reject) => {
    let lastScore = 0

    const onMessage = (e: MessageEvent) => {
      const line =
        typeof e.data === 'string' ? e.data : e.data?.toString?.() || ''

      // Capture score from info lines
      const scoreMatch = line.match(/score cp (-?\d+)/)
      if (scoreMatch) {
        lastScore = parseInt(scoreMatch[1], 10)
      }
      const mateMatch = line.match(/score mate (-?\d+)/)
      if (mateMatch) {
        const mateIn = parseInt(mateMatch[1], 10)
        lastScore = mateIn > 0 ? 10000 - mateIn : -10000 - mateIn
      }

      if (line.startsWith('bestmove')) {
        worker!.removeEventListener('message', onMessage)
        const move = line.split(' ')[1]
        if (move && move !== '(none)') {
          resolve({ bestMove: move, score: lastScore })
        } else {
          reject(new Error('No best move found'))
        }
      }
    }

    worker!.addEventListener('message', onMessage)
    worker!.postMessage(`position fen ${fen}`)
    worker!.postMessage(`go depth ${depth}`)

    setTimeout(() => {
      worker!.removeEventListener('message', onMessage)
      reject(new Error('Stockfish analysis timeout'))
    }, 15000)
  })
}

export function destroy(): void {
  if (worker) {
    worker.postMessage('quit')
    worker.terminate()
    worker = null
    isReady = false
  }
}
