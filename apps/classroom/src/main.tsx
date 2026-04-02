import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClassroomApp } from './ClassroomApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClassroomApp />
  </StrictMode>
)
