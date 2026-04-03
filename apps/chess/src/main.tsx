import { createRoot } from 'react-dom/client'
import { ChessApp } from './ChessApp'

// No StrictMode — it double-invokes effects, which breaks the ChatBridge
// handshake (nonce tracker rejects replayed READY from the second mount)
createRoot(document.getElementById('root')!).render(<ChessApp />)
