import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { DesktopPermissionGuide } from './components/DesktopPermissionGuide'

document.documentElement.dataset.platform = window.pi.platform

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('view') === 'permission-guide' ? <DesktopPermissionGuide /> : <App />}
  </React.StrictMode>
)
