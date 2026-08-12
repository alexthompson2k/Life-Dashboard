import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ensureSeeded } from './lib/store'
import { isCloudMode } from './lib/supabase'
import './index.css'

// Without cloud keys the app runs on a seeded local dataset so it is usable
// (and reviewable) immediately.
if (!isCloudMode) ensureSeeded()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
