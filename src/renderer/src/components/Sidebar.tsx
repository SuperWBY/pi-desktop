import { useMemo, useState, type ReactNode } from 'react'
import {
  ChevronsUpDown,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Trash2,
  X
} from 'lucide-react'
import clsx from 'clsx'
import type { SessionSummary } from '@shared/types'
import { useApp } from '../store'
import { baseName, dayLabel, relativeTime, shortenPath, truncate } from '../lib/format'
import { Modal, Popover } from './ui'

function groupSessions(sessions: SessionSummary[]): { label: string; items: SessionSummary[] }[] {
  const groups: { label: string; items: SessionSummary[] }[] = []
  let current: { label: string; items: SessionSummary[] } | null = null

  for (const session of sessions) {
    const label = dayLabel(session.updatedAt)
    if (!current || current.label !== label) {
      current = { label, items: [] }
      groups.push(current)
    }
    current.items.push(session)
  }

  return groups
}

export function Sidebar(): ReactNode {
  const { state, actions } = useApp()
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null)

  const workspace = state.workspace ?? state.settings.lastWorkspace ?? null

  const workspaceSessions = useMemo(() => {
    const scoped = workspace
      ? state.sessions.filter((session) => session.cwd === workspace)
      : state.sessions
    const text = query.trim().toLowerCase()
    const filtered = text
      ? scoped.filter((session) =>
          `${session.name} ${session.preview} ${session.cwd}`.toLowerCase().includes(text)
        )
      : scoped
    return filtered.slice(0, 200)
  }, [state.sessions, workspace, query])

  const groups = useMemo(() => groupSessions(workspaceSessions), [workspaceSessions])

  const workspaces = useMemo(() => {
    const set = new Set(state.settings.workspaces)
    if (workspace) set.add(workspace)
    return Array.from(set)
  }, [state.settings.workspaces, workspace])

  return (
    <aside className={clsx('sidebar', !state.sidebarOpen && 'collapsed')} aria-hidden={!state.sidebarOpen}>
      <div className="sidebar-inner">
      <div className="sidebar-drag" />

      <div className="sidebar-brand">
        <span className="brand-mark">π</span>
        <span className="brand-name">Pi</span>
        <button
          className="icon-button brand-action"
          title="New session (⌘N)"
          onClick={() => void actions.newSession()}
        >
          <Plus size={16} />
        </button>
      </div>

      <Popover
        width={280}
        className="workspace-popover"
        trigger={(open, toggle) => (
          <button className={clsx('workspace-button', open && 'open')} onClick={toggle}>
            <span className="workspace-icon">
              <FolderOpen size={14} />
            </span>
            <span className="workspace-text">
              <span className="workspace-name">{workspace ? baseName(workspace) : 'No project'}</span>
              <span className="workspace-path">
                {workspace ? shortenPath(workspace, state.boot?.home) : 'Choose a folder to start'}
              </span>
            </span>
            <ChevronsUpDown size={13} className="workspace-chevron" />
          </button>
        )}
      >
        {(close) => (
          <div className="menu">
            <div className="menu-group">
              <div className="menu-group-label">Projects</div>
              {workspaces.length === 0 && <div className="menu-empty">No recent projects</div>}
              {workspaces.map((path) => (
                <button
                  key={path}
                  className={clsx('menu-item', path === workspace && 'active')}
                  onClick={() => {
                    close()
                    void actions.openSession(path, null)
                  }}
                >
                  <span className="menu-item-main">
                    <span className="menu-item-title">{baseName(path)}</span>
                    <span className="menu-item-sub">{shortenPath(path, state.boot?.home)}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="menu-separator" />
            <button
              className="menu-item"
              onClick={() => {
                close()
                void actions.pickFolder()
              }}
            >
              <FolderOpen size={14} />
              <span className="menu-item-title">Open folder…</span>
            </button>
          </div>
        )}
      </Popover>

      <div className="sidebar-actions">
        <button className="new-session" onClick={() => void actions.newSession()}>
          <Plus size={14} />
          <span>New session</span>
          <span className="shortcut">⌘N</span>
        </button>
      </div>

      <div className="search-box">
        <Search size={13} />
        <input
          value={query}
          placeholder="Search sessions"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
            <X size={11} />
          </button>
        )}
      </div>

      <div className="session-list">
        {groups.length === 0 && (
          <div className="session-empty">
            {query ? 'No sessions match.' : 'No sessions yet. Start one below.'}
          </div>
        )}
        {groups.map((group) => (
          <div className="session-group" key={group.label}>
            <div className="session-group-label">{group.label}</div>
            {group.items.map((session) => {
              const active = state.sessionPath === session.path
              if (renaming === session.path) {
                return (
                  <div className="session-item renaming" key={session.path}>
                    <input
                      autoFocus
                      className="rename-input"
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => setRenaming(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void actions.renameSession(renameValue)
                          setRenaming(null)
                        }
                        if (event.key === 'Escape') setRenaming(null)
                      }}
                    />
                  </div>
                )
              }

              return (
                <div className={clsx('session-item', active && 'active')} key={session.path}>
                  <button
                    className="session-main"
                    onClick={() => void actions.openSession(session.cwd, session.path)}
                    title={session.name}
                  >
                    <span className="session-title">{truncate(session.name, 52)}</span>
                    <span className="session-meta">
                      {relativeTime(session.updatedAt)}
                      <span className="dot-sep">·</span>
                      {session.messageCount} msg
                      {session.cwd !== workspace && (
                        <>
                          <span className="dot-sep">·</span>
                          {baseName(session.cwd)}
                        </>
                      )}
                    </span>
                  </button>

                  <Popover
                    width={190}
                    align="right"
                    trigger={(_open, toggle) => (
                      <button
                        className="icon-button session-menu-button"
                        onClick={(event) => {
                          event.stopPropagation()
                          toggle()
                        }}
                        aria-label="Session actions"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    )}
                  >
                    {(close) => (
                      <div className="menu">
                        <button
                          className="menu-item"
                          onClick={() => {
                            close()
                            setRenaming(session.path)
                            setRenameValue(session.name)
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="menu-item"
                          onClick={() => {
                            close()
                            actions.revealSession(session.path)
                          }}
                        >
                          Show in Finder
                        </button>
                        <div className="menu-separator" />
                        <button
                          className="menu-item danger"
                          onClick={() => {
                            close()
                            setPendingDelete(session)
                          }}
                        >
                          <Trash2 size={13} />
                          Delete
                        </button>
                      </div>
                    )}
                  </Popover>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="icon-button" onClick={() => actions.openSettings(true)} title="Settings">
          <Settings size={15} />
        </button>
        <div className="footer-meta">
          <span className={clsx('status-dot', `is-${state.status}`)} />
          <span>pi {state.boot?.piVersion ?? '—'}</span>
        </div>
      </div>

      </div>

      <Modal
        open={Boolean(pendingDelete)}
        title="Delete session?"
        subtitle={pendingDelete?.name}
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <button className="button ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </button>
            <button
              className="button danger"
              onClick={() => {
                if (pendingDelete) void actions.deleteSession(pendingDelete.path)
                setPendingDelete(null)
              }}
            >
              Delete
            </button>
          </>
        }
      >
        <p className="modal-text">
          This permanently removes the session transcript from{' '}
          <code>{shortenPath(state.boot?.sessionsRoot)}</code>. The files pi changed on disk are not
          affected.
        </p>
      </Modal>
    </aside>
  )
}
