import './payrollHubBridge.js' // defines window.PayrollHubBridge
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyStoredTheme } from './lib/theme.ts'

applyStoredTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
