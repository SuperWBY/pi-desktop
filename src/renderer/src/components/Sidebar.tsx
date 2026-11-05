import { useTranslation } from '../i18n'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Clock,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import clsx from 'clsx'
import type { SessionSummary } from '@shared/types'
import { useApp } from '../store'
import { baseName, relativeTime, shortenPath, truncate } from '../lib/format'
import { mod } from '../lib/platform'
import { PiLogo } from './PiLogo'
import { ContextMenu, Modal, Popover, Spinner } from './ui'

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
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set())
  const [skillCount, setSkillCount] = useState<number | null>(null)
  const [scheduleCount, setScheduleCount] = useState<number | null>(null)
  const [runningSchedules, setRunningSchedules] = useState<Set<string>>(new Set())
  const [scheduleUnread, setScheduleUnread] = useState(0)
  const [pendingRename, setPendingRename] = useState<{ path: string; name: string } | null>(null)
  const [, setTick] = useState(0)

  // Skill count for the sidebar entry.
  useEffect(() => {
    let alive = true
    window.pi
      .countSkills(state.workspace ?? '')
      .then((count) => {
        if (alive) setSkillCount(count)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [state.workspace])

  // Double-click opens rename only after the session finishes loading; the
  // composer focuses itself when status becomes ready and would blur the input.
  useEffect(() => {
    if (!pendingRename || state.status === 'starting') return
    setRenaming(pendingRename.path)
    setRenameValue(pendingRename.name)
    setPendingRename(null)
  }, [pendingRename, state.status])

  useEffect(() => {
    let alive = true
    window.pi
      .listSchedules()
      .then((tasks) => {
        if (alive) setScheduleCount(tasks.filter((task) => task.enabled).length)
      })
      .catch(() => undefined)
    const unsubscribe = window.pi.onSchedulesChanged((next) => {
      setScheduleCount(next.filter((task) => task.enabled).length)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [state.workspace])

  useEffect(() => {
    return window.pi.onScheduleEvent((event) => {
      if (event.type === 'started') {
        setRunningSchedules((current) => new Set(current).add(event.taskId))
      } else if (event.type === 'finished') {
        setRunningSchedules((current) => {
          const next = new Set(current)
          next.delete(event.taskId)
          return next
        })
        if (!state.schedulesOpen) setScheduleUnread((count) => count + 1)
      }
    })
  }, [state.schedulesOpen])

  useEffect(() => {
    if (state.schedulesOpen) setScheduleUnread(0)
  }, [state.schedulesOpen])

  // Relative timestamps ("2h", "now") should age while the app stays open.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const workspace = state.workspace ?? (state.scratchWorkspace ? null : state.settings.lastWorkspace ?? null)
  const scratchPath = state.boot?.scratchPath ?? null
  const isScratchWorkspace =
    state.scratchWorkspace || Boolean(workspace && scratchPath && workspace === scratchPath)

  const language = state.settings.language ?? 'zh-CN'
  const queryText = query.trim().toLowerCase()

  // Only actual projects are listed as projects. A session whose folder is not
  // a project falls through to "Recent conversations".
  const workspaces = useMemo(() => {
    const set = new Set(state.settings.workspaces)
    // A scratch path may have been persisted by an older build; never render it
    // as a project, and never remove a real project just because a scratch chat
    // is active.
    if (scratchPath) set.delete(scratchPath)
    if (workspace && !isScratchWorkspace) set.add(workspace)
    return Array.from(set)
  }, [isScratchWorkspace, scratchPath, state.settings.workspaces, workspace])

  const matching = useMemo(
    () =>
      state.sessions
        .filter(
          (session) =>
            !queryText ||
            `${session.name} ${session.preview} ${session.cwd}`.toLowerCase().includes(queryText)
        )
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [state.sessions, queryText]
  )

  // A session that belongs to a project lives only under that project; the
  // recent list is for conversations without a project.
  const recent = useMemo(
    () => matching.filter((session) => !workspaces.includes(session.cwd)),
    [matching, workspaces]
  )

  const renderSession = (session: SessionSummary, showProject: boolean): ReactNode => {
    const active = state.sessionPath === session.path
    const running = active && state.streaming

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
        onDoubleClick={(event) => {
          event.preventDefault()
          setPendingRename({ path: session.path, name: session.name })
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          setContextMenu({ session, x: event.clientX, y: event.clientY })
        }}
      >
        <button
          className="session-main"
          onClick={() => void actions.openSession(session.cwd, session.path)}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setPendingRename({ path: session.path, name: session.name })
          }}
          title={session.name}
        >
          {running && (
            <span className="session-running" aria-label={t('执行中')}>
              <Spinner size={11} />
            </span>
          )}
          <span className="session-title">{truncate(session.name, 52)}</span>
          {showProject && (
            <span className="session-meta">{relativeTime(session.updatedAt, language)}</span>
          )}
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
  }

  return (
    <aside className={clsx('sidebar', !state.sidebarOpen && 'collapsed')} aria-hidden={!state.sidebarOpen}>
      <div className="sidebar-inner">
      <div className="sidebar-drag" />

      <div className="sidebar-brand">
        <span className="brand-mark">
          <PiLogo size={17} />
        </span>
        <span className="brand-name">Pi</span>
      </div>

      <div className="sidebar-actions">
        <button className="new-session" onClick={() => void actions.newSession()}>
          <Plus size={14} />
          <span>{t("新建会话")}</span>
          <span className="shortcut">{mod('N')}</span>
        </button>
        <button className="skills-entry skills-page-entry" onClick={() => actions.openSkills(true)}>
          <Sparkles size={13} />
          <span>{t('技能与插件')}</span>
          <span className="shortcut">{skillCount ?? ''}</span>
        </button>
        <button
          className="skills-entry schedules-entry"
          onClick={() => {
            setScheduleUnread(0)
            actions.openSchedules(true)
          }}
        >
          <Clock size={13} />
          <span>{t('定时任务')}</span>
          {runningSchedules.size > 0 ? (
            <span className="schedule-running-dot" title={t('运行中')} />
          ) : (
            <span className="shortcut">{scheduleCount ?? ''}</span>
          )}
          {scheduleUnread > 0 && <span className="schedule-unread-dot" />}
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
        <div className="project-shortcuts-header">
          <span className="project-shortcuts-label">{t('Projects')}</span>
          <button className="icon-button project-add" onClick={() => void actions.pickFolder()}
            title={t('打开文件夹…')} aria-label={t('打开文件夹…')}><Plus size={14} /></button>
        </div>
        {Boolean(queryText) && matching.length === 0 && (
          <div className="session-empty">{t('没有匹配的会话。')}</div>
        )}
        {workspaces.map((path) => {
          const matches = matching.filter((session) => session.cwd === path)
          if (queryText && matches.length === 0) return null
          const expanded = !collapsedProjects.has(path) || Boolean(queryText)
          return (
            <div className="project-tree" key={path}>
              <div className={clsx('project-row', path === workspace && 'active')}>
                <button
                  className="project-row-main"
                  aria-expanded={expanded}
                  title={shortenPath(path, state.boot?.home)}
                  aria-label={state.settings.language === 'en' ? `${expanded ? 'Collapse' : 'Expand'} sessions for ${baseName(path)}` : `${expanded ? '收起' : '展开'} ${baseName(path)} 的会话`}
                  onClick={() => setCollapsedProjects((current) => {
                    const next = new Set(current)
                    if (next.has(path)) next.delete(path); else next.add(path)
                    return next
                  })}
                >
                  <FolderOpen size={13} />
                  <span>{baseName(path)}</span>
                </button>
                <button
                  className="icon-button project-new-chat"
                  title={state.settings.language === 'en' ? `New conversation in ${baseName(path)}` : `在 ${baseName(path)} 中新建对话`}
                  aria-label={state.settings.language === 'en' ? `New conversation in ${baseName(path)}` : `在 ${baseName(path)} 中新建对话`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void actions.openSession(path, null)
                  }}
                >
                  <Plus size={13} />
                </button>
              </div>
              {expanded && (
                <div className="project-tree-sessions">
                  {matches.length === 0 && (
                    <div className="session-empty">
                      {queryText ? t('没有匹配的会话。') : t('还没有会话，新建一个开始。')}
                    </div>
                  )}
                  {matches.map((session) => renderSession(session, false))}
                </div>
              )}
            </div>
          )
        })}

        {recent.length > 0 && (
          <div className="recent-sessions">
            <div className="project-shortcuts-header recent-header">
              <span className="project-shortcuts-label">{t('最近对话')}</span>
            </div>
            {recent.map((session) => renderSession(session, true))}
          </div>
        )}
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
