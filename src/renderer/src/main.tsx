import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

document.documentElement.dataset.platform = window.pi.platform

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
