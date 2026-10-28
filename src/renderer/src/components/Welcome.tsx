import type { ReactNode } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import { useApp } from '../store'
import { baseName, shortenPath } from '../lib/format'

export function Welcome(): ReactNode {
  const { state, actions } = useApp()
  const workspaces = state.settings.workspaces.slice().reverse()

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-mark">π</div>
        <h1>Pi Desktop</h1>
        <p className="welcome-sub">
          A desktop home for pi. Open a project, then ask pi to read, edit, and run code with you.
        </p>

        {state.error && (
          <div className="welcome-error">
            <strong>pi is not running</strong>
            <span>{state.error}</span>
            <button className="button ghost" onClick={() => actions.openSettings(true)}>
              Check settings
            </button>
          </div>
        )}

        <div className="welcome-actions">
          <button className="button primary" onClick={() => void actions.pickFolder()}>
            <FolderOpen size={15} />
            Open a project
          </button>
          <button className="button ghost" onClick={() => actions.openSettings(true)}>
            Settings
          </button>
        </div>

        {workspaces.length > 0 && (
          <div className="recent">
            <div className="recent-label">Recent projects</div>
            {workspaces.slice(0, 8).map((workspace) => (
              <button
                key={workspace}
                className="recent-item"
                onClick={() => void actions.openSession(workspace, null)}
              >
                <span className="recent-icon">
                  <FolderOpen size={14} />
                </span>
                <span className="recent-text">
                  <span className="recent-name">{baseName(workspace)}</span>
                  <span className="recent-path">{shortenPath(workspace, state.boot?.home)}</span>
                </span>
                <Plus size={14} className="recent-plus" />
              </button>
            ))}
          </div>
        )}

        <div className="welcome-hint">
          {state.boot ? `pi ${state.boot.piVersion ?? 'unknown'} · Electron ${state.boot.electronVersion}` : ''}
        </div>
      </div>
    </div>
  )
}
