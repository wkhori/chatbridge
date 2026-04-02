import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ChessApp } from './ChessApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChessApp />
  </StrictMode>
)
