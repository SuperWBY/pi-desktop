import { useTranslation } from '../i18n'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ChevronsUpDown,
  ChevronRight,
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
import { PiLogo } from './PiLogo'
import { ContextMenu, Modal, Popover } from './ui'

function groupSessions(sessions: SessionSummary[], language: 'zh-CN' | 'en'): { label: string; items: SessionSummary[] }[] {
  const groups: { label: string; items: SessionSummary[] }[] = []
  let current: { label: string; items: SessionSummary[] } | null = null

  for (const session of sessions) {
    const label = dayLabel(session.updatedAt, language)
    if (!current || current.label !== label) {
      current = { label, items: [] }
      groups.push(current)
    }
    current.items.push(session)
  }

  return groups
}

function SessionMenu({
  session,
  close,
  onRename,
  onDelete
}: {
  session: SessionSummary
  close: () => void
  onRename: (value: string) => void
  onDelete: () => void
}): ReactNode {
  const t = useTranslation()
  const { actions, state } = useApp()
  return (
    <div className="menu">
      {session.path === state.sessionPath && <button
        className="menu-item"
        onClick={() => {
          close()
          onRename(session.name)
        }}
      >{t("重命名")}</button>}
      <button
        className="menu-item"
        onClick={() => {
          close()
          actions.revealSession(session.path)
        }}
      >{t("在 Finder 中显示")}</button>
      {session.path === state.sessionPath && <><div className="menu-separator" />
      <button
        className="menu-item"
        onClick={() => {
          close()
          void actions.exportMarkdown()
        }}
      >
        导出 Markdown
      </button>
      <button
        className="menu-item"
        onClick={() => {
          close()
          void actions.exportHtml()
        }}
      >
        导出 HTML
      </button>
      </>}
      <div className="menu-separator" />
      <button
        className="menu-item danger"
        onClick={() => {
          close()
          onDelete()
        }}
      >
        <Trash2 size={13} />{t("删除")}</button>
    </div>
  )
}

export function Sidebar(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null)
  const [contextMenu, setContextMenu] = useState<{ session: SessionSummary; x: number; y: number } | null>(null)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set())
  const [, setTick] = useState(0)

  // Relative timestamps ("2h", "now") should age while the app stays open.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const workspace = state.workspace ?? state.settings.lastWorkspace ?? null

  const language = state.settings.language ?? 'zh-CN'

  const workspaces = useMemo(() => {
    const set = new Set(state.settings.workspaces)
    if (workspace) set.add(workspace)
    for (const session of state.sessions) if (session.cwd) set.add(session.cwd)
    return Array.from(set)
  }, [state.settings.workspaces, workspace, state.sessions])

  useEffect(() => {
    if (workspace) setExpandedProjects((current) => current.has(workspace) ? current : new Set([...current, workspace]))
  }, [workspace])

  return (
    <aside className={clsx('sidebar', !state.sidebarOpen && 'collapsed')} aria-hidden={!state.sidebarOpen}>
      <div className="sidebar-inner">
      <div className="sidebar-drag" />

      <div className="sidebar-brand">
        <span className="brand-mark">
          <PiLogo size={17} />
        </span>
        <span className="brand-name">Pi</span>
        <button
          className="icon-button brand-action"
          title={t("新建会话 (⌘N)")}
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
              <span className="workspace-name">{workspace ? baseName(workspace) : t("未选择项目")}</span>
              <span className="workspace-path">
                {workspace ? shortenPath(workspace, state.boot?.home) : t("选择一个文件夹开始")}
              </span>
            </span>
            <ChevronsUpDown size={13} className="workspace-chevron" />
          </button>
        )}
      >
        {(close) => (
          <div className="menu">
            <div className="menu-group">
              <div className="menu-group-label">{t("Projects")}</div>
              {workspaces.length === 0 && <div className="menu-empty">{t("No recent projects")}</div>}
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
              <span className="menu-item-title">{t("打开文件夹…")}</span>
            </button>
          </div>
        )}
      </Popover>

      <div className="sidebar-actions">
        <button className="new-session" onClick={() => void actions.newSession()}>
          <Plus size={14} />
          <span>{t("新建会话")}</span>
          <span className="shortcut">⌘N</span>
        </button>
      </div>

      <div className="search-box">
        <Search size={13} />
        <input
          value={query}
          placeholder={t("搜索会话")}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} aria-label={t("Clear search")}>
            <X size={11} />
          </button>
        )}
      </div>

      <div className="session-list">
        <div className="project-shortcuts-label">{t('Projects')}</div>
        {workspaces.map((path) => {
          const expanded = expandedProjects.has(path) || Boolean(query.trim())
          const text = query.trim().toLowerCase()
          const sessions = state.sessions.filter((session) => session.cwd === path &&
            (!text || `${session.name} ${session.preview} ${session.cwd}`.toLowerCase().includes(text))).slice(0, 200)
          const groups = groupSessions(sessions, language)
          return <div className="project-tree" key={path}>
            <div className="project-tree-head">
              <button className="project-tree-toggle" aria-expanded={expanded}
                aria-label={state.settings.language === 'en' ? `${expanded ? 'Collapse' : 'Expand'} sessions for ${baseName(path)}` : `${expanded ? '收起' : '展开'} ${baseName(path)} 的会话`}
                onClick={() => setExpandedProjects((current) => {
                  const next = new Set(current)
                  if (next.has(path)) next.delete(path); else next.add(path)
                  return next
                })}>
                <ChevronRight size={13} className={clsx(expanded && 'open')} />
              </button>
              <button className={clsx('project-shortcut', path === workspace && 'active')}
                aria-current={path === workspace ? 'true' : undefined}
                title={shortenPath(path, state.boot?.home)}
                onClick={() => { if (path !== workspace) void actions.openSession(path, null) }}>
                <FolderOpen size={13} /><span>{baseName(path)}</span>
              </button>
            </div>
            {expanded && <div className="project-tree-sessions">
            {groups.length === 0 && <div className="session-empty">{query ? t('没有匹配的会话。') : t('还没有会话，新建一个开始。')}</div>}
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
                      onBlur={() => {
                        const next = renameValue.trim()
                        if (next && next !== session.name) void actions.renameSession(next)
                        setRenaming(null)
                      }}
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
                <div
                  className={clsx('session-item', active && 'active')}
                  key={session.path}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setContextMenu({ session, x: event.clientX, y: event.clientY })
                  }}
                >
                  <button
                    className="session-main"
                    onClick={() => void actions.openSession(session.cwd, session.path)}
                    title={session.name}
                  >
                    <span className="session-title">{truncate(session.name, 52)}</span>
                    <span className="session-meta">
                      {relativeTime(session.updatedAt, language)}
                      <span className="dot-sep">·</span>
                      {state.settings.language === 'en' ? `${session.messageCount} messages` : `${session.messageCount} 条`}
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
                    trigger={(_open, toggle, expanded) => (
                      <button
                        className="icon-button session-menu-button"
                        onClick={(event) => {
                          event.stopPropagation()
                          toggle()
                        }}
                        aria-label={t("Session actions")}
                        {...expanded}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    )}
                  >
                    {(close) => (
                      <SessionMenu
                        session={session}
                        close={close}
                        onRename={(value) => {
                          setRenaming(session.path)
                          setRenameValue(value)
                        }}
                        onDelete={() => setPendingDelete(session)}
                      />
                    )}
                  </Popover>
                </div>
              )
            })}
          </div>
            ))}
            </div>}
          </div>
        })}
      </div>

      <div className="sidebar-footer">
        <button className="icon-button settings-entry" onClick={() => actions.openSettings(true)} title={t("设置")} aria-label={t("设置")}>
          <Settings size={15} />
        </button>
        <button
          className="footer-meta"
          onClick={() => actions.openDiagnostics(true)}
          title={t("pi 运行状态与诊断")}
        >
          <span className={clsx('status-dot', `is-${state.status}`)} />
          <span>pi {state.boot?.piVersion ?? '—'}</span>
        </button>
      </div>

      </div>

      <ContextMenu
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        onClose={() => setContextMenu(null)}
      >
        {contextMenu && (
          <SessionMenu
            session={contextMenu.session}
            close={() => setContextMenu(null)}
            onRename={(value) => {
              setRenaming(contextMenu.session.path)
              setRenameValue(value)
            }}
            onDelete={() => setPendingDelete(contextMenu.session)}
          />
        )}
      </ContextMenu>

      <Modal
        open={Boolean(pendingDelete)}
        title={t("Delete session?")}
        subtitle={pendingDelete?.name}
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <button className="button ghost" onClick={() => setPendingDelete(null)}>{t("取消")}</button>
            <button
              className="button danger"
              onClick={() => {
                if (pendingDelete) void actions.deleteSession(pendingDelete.path)
                setPendingDelete(null)
              }}
            >{t("删除")}</button>
          </>
        }
      >
        <p className="modal-text">
          {state.settings.language === 'en' ? 'The session will be moved to ' : '会话记录会被移到 '}
          <code>{shortenPath(state.boot?.sessionsRoot)}/.trash</code>
          {state.settings.language === 'en' ? '. You can undo this from the notification within 24 hours. Files changed by pi are not affected.' : '，24 小时内可在提示条里「撤销」。pi 在磁盘上改过的文件不受影响。'}
        </p>
      </Modal>
    </aside>
  )
}
