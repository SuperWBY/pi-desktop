import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { DesktopPermissionGuide } from './components/DesktopPermissionGuide'

document.documentElement.dataset.platform = window.pi.platform
document.documentElement.dataset.theme = window.pi.initialTheme ?? 'dark'

/** One bad record or README edge case must not blank the whole window:
 * keep the shell alive and offer a reload. */
class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('[renderer] uncaught component error:', error)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 12, padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>界面遇到了一个错误</div>
          <div style={{ fontSize: 12, opacity: 0.7, maxWidth: 460, wordBreak: 'break-all', textAlign: 'center' }}>{this.state.error.message}</div>
          <button className="button primary" onClick={() => { this.setState({ error: null }); window.location.reload() }}>重载界面</button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      {new URLSearchParams(window.location.search).get('view') === 'permission-guide' ? <DesktopPermissionGuide /> : <App />}
    </RootErrorBoundary>
  </React.StrictMode>
)
