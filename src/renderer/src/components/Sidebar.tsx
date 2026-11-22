import { useTranslation } from '../i18n'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Archive,
  ArchiveRestore,
  Clock,
  ChevronRight,
  FolderOpen,
  Lock,
  MoreHorizontal,
  Package,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import clsx from 'clsx'
import type { SessionSearchMatch, SessionSummary, SessionTreeData, SessionTreeNode } from '@shared/types'
import { useApp } from '../store'
import { baseName, disambiguateProjectNames, projectName, relativeTime, shortenPath, truncate } from '../lib/format'
import { sessionDisplayTitle } from '../lib/session-title'
import { useDraftLocations } from '../lib/composer-drafts'
import { isTemporaryWorkspace, pathsEqual, projectReadOnly } from '@shared/paths'
import { mod } from '../lib/platform'
import { PiLogo } from './PiLogo'
import { ContextMenu, Modal, Popover, Spinner } from './ui'

function SessionMenu({
  session,
  close,
  pinned,
  onTogglePin,
  archived,
  onToggleArchive,
  onRename,
  onDelete,
  onClone,
  onTree
}: {
  session: SessionSummary
  close: () => void
  pinned: boolean
  onTogglePin: () => void
  archived: boolean
  onToggleArchive: () => void
  onRename: (value: string) => void
  onDelete: () => void
  onClone: () => void
  onTree: () => void
}): ReactNode {
  const t = useTranslation()
  const { actions, state } = useApp()
  return (
    <div className="menu">
      {!archived && <button className="menu-item" onClick={() => { close(); onTogglePin() }}>
        {pinned ? <PinOff size={13} /> : <Pin size={13} />}{t(pinned ? '取消置顶' : '置顶对话')}
      </button>}
      <button className="menu-item" onClick={() => { close(); onToggleArchive() }}>
        {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}{t(archived ? '取消归档' : '归档对话')}
      </button>
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
          onClone()
        }}
      >{t("复制会话")}</button>
      <button
        className="menu-item"
        onClick={() => {
          close()
          onTree()
        }}
      >{t("查看分支树")}</button>
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

interface FlatTreeRow {
  node: SessionTreeNode
  depth: number
}

function flattenTree(nodes: SessionTreeNode[], depth = 0, rows: FlatTreeRow[] = []): FlatTreeRow[] {
  for (const node of nodes) {
    rows.push({ node, depth })
    flattenTree(node.children ?? [], depth + 1, rows)
  }
  return rows
}

function treeEntryText(entry: SessionTreeNode['entry']): string {
  const content = entry.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        const value = block as { type?: string; text?: unknown; content?: unknown; name?: unknown }
        if (value.type === 'text') return String(value.text ?? '')
        if (value.type === 'tool_use') return `[${String(value.name ?? 'tool')}]`
        if (value.type === 'tool_result') return String(value.content ?? '')
        return ''
      })
      .filter(Boolean)
      .join(' ')
  }
  return entry.type
}

export function Sidebar(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const draftLocations = useDraftLocations()
  const [query, setQuery] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const pinPending = useRef(false)
  const pinnedPaths = state.settings.pinnedSessionPaths ?? []
  const archivedPaths = state.settings.archivedSessionPaths ?? []
  const archivePending = useRef(false)
  const toggleArchive = useCallback(async (session: SessionSummary) => {
    if (archivePending.current) return
    const archived = archivedPaths.includes(session.path)
    if (!archived && (state.runningSessionPaths.includes(session.path) || state.backgroundUiPending.some(item => item.path === session.path) || (state.sessionPath === session.path && (state.streaming || state.awaitingResponse || state.uiRequests.length > 0)))) {
      actions.notify('warning', t('暂时无法归档'), t('该对话正在执行或等待确认，请先处理完当前任务。'))
      return
    }
    archivePending.current = true
    try {
      if (!archived && state.sessionPath === session.path && !await actions.newScratchSession()) return
      await actions.updateSettings({
        archivedSessionPaths: archived ? archivedPaths.filter(path => path !== session.path) : [session.path, ...archivedPaths],
        ...(archived ? {} : { pinnedSessionPaths: pinnedPaths.filter(path => path !== session.path) })
      })
      actions.notify('success', t(archived ? '对话已恢复' : '对话已归档'), t(archived ? '已回到原来的对话列表。' : '可以在侧栏的已归档中找到。'))
    } catch { actions.notify('error', t('无法保存归档状态')) }
    finally { archivePending.current = false }
  }, [actions, archivedPaths, pinnedPaths, state.runningSessionPaths, state.backgroundUiPending, state.sessionPath, state.streaming, state.awaitingResponse, state.uiRequests, t])
  const togglePin = useCallback(async (path: string) => {
    if (pinPending.current) return
    pinPending.current = true
    setPinBusy(true)
    const next = pinnedPaths.includes(path) ? pinnedPaths.filter(item => item !== path) : [path, ...pinnedPaths]
    try { await actions.updateSettings({ pinnedSessionPaths: next }) }
    catch { actions.notify('error', t('无法保存置顶状态')) }
    finally { pinPending.current = false; setPinBusy(false) }
  }, [actions, pinnedPaths, t])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null)
  const [pendingProjectRemoval, setPendingProjectRemoval] = useState<string | null>(null)
  const [removingProject, setRemovingProject] = useState(false)
  const projectRemovalBusy = Boolean(pendingProjectRemoval && (state.runningSessionPaths.some(path => state.sessions.some(session => session.path === path && pathsEqual(session.cwd, pendingProjectRemoval))) || state.backgroundUiPending.some(item => pathsEqual(item.cwd, pendingProjectRemoval)) || (pathsEqual(pendingProjectRemoval, state.workspace) && (state.streaming || state.awaitingResponse || state.uiRequests.length > 0))))
  const [forkTarget, setForkTarget] = useState<SessionSummary | null>(null)
  const [forkList, setForkList] = useState<{ entryId: string; text: string }[] | null>(null)
  const [forkBusy, setForkBusy] = useState(false)
  const [forkSelected, setForkSelected] = useState<{ entryId: string; text: string } | null>(null)
  const [forkDraft, setForkDraft] = useState('')
  const [messageResults, setMessageResults] = useState<SessionSearchMatch[] | null>(null)
  const [treeOpen, setTreeOpen] = useState(false)
  const [treeData, setTreeData] = useState<SessionTreeData | null>(null)
  const [treeBusy, setTreeBusy] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ session: SessionSummary; x: number; y: number } | null>(null)
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set())
  const [scheduleCount, setScheduleCount] = useState<number | null>(null)
  const [runningSchedules, setRunningSchedules] = useState<Set<string>>(new Set())
  const [scheduleUnread, setScheduleUnread] = useState(0)
  const [pendingRename, setPendingRename] = useState<{ path: string; name: string } | null>(null)
  const [, setTick] = useState(0)

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
  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) {
      setMessageResults(null)
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      window.pi.searchSessions(text).then((results) => {
        if (alive) setMessageResults(results)
      }).catch(() => {
        if (alive) setMessageResults([])
      })
    }, 220)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [query])

  const queryText = query.trim().toLowerCase()

  // Only actual projects are listed as projects. A session whose folder is not
  // a project falls through to "Recent conversations".
  const workspaces = useMemo(() => {
    const set = new Set(state.settings.workspaces)
    // A scratch or OS temp path may have been persisted by an older build.
    // Never render it as a project, and never remove a real project just
    // because a temporary chat is active. /var and /private/var are one folder.
    const knownSession = state.sessionPath && state.sessions.some(session => session.path === state.sessionPath)
    if (workspace && !knownSession && !isScratchWorkspace && !isTemporaryWorkspace(workspace, scratchPath)) set.add(workspace)
    const unique: string[] = []
    for (const path of set) {
      if (isTemporaryWorkspace(path, scratchPath)) continue
      if (unique.some((item) => pathsEqual(item, path))) continue
      unique.push(path)
    }
    return unique
  }, [isScratchWorkspace, scratchPath, state.settings.workspaces, state.sessionPath, state.sessions, workspace])

  const matching = useMemo(
    () =>
      state.sessions
        .filter(
          (session) =>
            !archivedPaths.includes(session.path) && (!queryText ||
            `${session.name} ${session.preview} ${session.cwd}`.toLowerCase().includes(queryText))
        )
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [state.sessions, queryText, archivedPaths]
  )

  // A session that belongs to a project lives only under that project; the
  // recent list is for conversations without a project.
  const recent = useMemo(() => {
    const listed = matching.filter((session) => !workspaces.some((path) => pathsEqual(session.cwd, path)))
    const activeText = `${state.sessionName ?? ''} ${workspace ?? ''}`.toLowerCase()
    if (
      state.sessionPath &&
      !archivedPaths.includes(state.sessionPath) &&
      isTemporaryWorkspace(workspace, scratchPath) &&
      !draftLocations.some((item) => item.key === `session:${state.sessionPath}`) &&
      (!queryText || activeText.includes(queryText)) &&
      !listed.some((session) => session.path === state.sessionPath) &&
      !matching.some((session) => session.path === state.sessionPath)
    ) {
      listed.unshift({
        path: state.sessionPath,
        id: state.sessionPath,
        cwd: workspace || scratchPath || '',
        name: sessionDisplayTitle({
          sessionName: state.sessionName,
          messages: state.messages,
          emptyLabel: t('未命名会话')
        }),
        preview: '',
        updatedAt: Date.now(),
        createdAt: Date.now(),
        messageCount: state.messages.length,
        size: 0
      })
    }
    return listed
  }, [archivedPaths, draftLocations, matching, queryText, scratchPath, state.messages, state.sessionName, state.sessionPath, t, workspace, workspaces])
  const projectLabels = useMemo(
    () => disambiguateProjectNames(workspaces, state.settings.workspaceNames),
    [workspaces, state.settings.workspaceNames]
  )
  const archivedSessions = state.sessions.filter(session => archivedPaths.includes(session.path) && (!queryText || `${session.name} ${session.preview} ${session.cwd}`.toLowerCase().includes(queryText))).sort((a, b) => archivedPaths.indexOf(a.path) - archivedPaths.indexOf(b.path))
  const searchResults = [...(messageResults ?? []), ...archivedSessions.filter(session => queryText && !(messageResults ?? []).some(result => result.session.path === session.path)).map(session => ({ session, matches: [] }))]
  const pinnedSessions = pinnedPaths.map(path => matching.find(session => session.path === path)).filter((session): session is SessionSummary => Boolean(session))

  const renderSession = (session: SessionSummary, showProject: boolean): ReactNode => {
    const active = state.sessionPath === session.path
    const running = state.runningSessionPaths.includes(session.path)
    const label = sessionDisplayTitle({
      sessionName: session.name,
      messages: active
        ? state.messages
        : session.preview
          ? [{ role: 'user', content: session.preview }]
          : [],
      emptyLabel: t('未命名会话')
    })

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
          title={label}
        >
          {running && (
            <span className="session-running" title={t('执行中')} aria-label={t('执行中')}>
              <Spinner size={11} />
            </span>
          )}
          <span className="session-title">{truncate(label, 52)}</span>
          {showProject && (
            <span className="session-meta">{archivedPaths.includes(session.path) ? `${projectLabels.get(session.cwd) || projectName(state.settings.workspaceNames, session.cwd)} · ` : ''}{relativeTime(session.updatedAt, language)}</span>
          )}
        </button>

        {!archivedPaths.includes(session.path) && <button
          type="button"
          className={clsx('icon-button session-pin-button', pinnedPaths.includes(session.path) && 'is-pinned')}
          aria-label={t(pinnedPaths.includes(session.path) ? '取消置顶' : '置顶对话')}
          title={t(pinnedPaths.includes(session.path) ? '取消置顶' : '置顶对话')}
          aria-pressed={pinnedPaths.includes(session.path)}
          disabled={pinBusy}
          onClick={() => void togglePin(session.path)}
        ><Pin size={14} /></button>}

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
              pinned={pinnedPaths.includes(session.path)}
              archived={archivedPaths.includes(session.path)}
              onToggleArchive={() => void toggleArchive(session)}
              onTogglePin={() => void togglePin(session.path)}
              close={close}
              onRename={(value) => {
                setRenaming(session.path)
                setRenameValue(value)
              }}
              onDelete={() => setPendingDelete(session)}
              onClone={() => void actions.cloneSession()}
              onTree={() => void openTree()}
            />
          )}
        </Popover>
      </div>
    )
  }

  const openFork = useCallback(async (session: SessionSummary): Promise<void> => {
    if (session.path !== state.sessionPath) {
      const opened = await actions.openSession(session.cwd, session.path)
      if (!opened) return
    }
    setForkTarget(session)
    setForkList(null)
    setForkSelected(null)
    setForkDraft('')
    try {
      setForkList(await actions.forkMessages())
    } catch {
      setForkList([])
    }
  }, [actions, state.sessionPath])

  useEffect(() => {
    const forkCurrent = (): void => {
      const session = state.sessions.find((item) => item.path === state.sessionPath)
      if (session && state.status === 'ready' && !state.streaming && !state.compacting) void openFork(session)
    }
    window.addEventListener('pi:fork-current-session', forkCurrent)
    return () => window.removeEventListener('pi:fork-current-session', forkCurrent)
  }, [openFork, state.compacting, state.sessionPath, state.sessions, state.status, state.streaming])

  const chooseFork = async (send: boolean): Promise<void> => {
    if (forkBusy || !forkSelected) return
    setForkBusy(true)
    try {
      const text = forkDraft.trim() || forkSelected.text
      const result = await actions.forkSession(forkSelected.entryId)
      if (!result.ok) {
        actions.notify('error', '创建分支失败', result.error)
        return
      }
      setForkTarget(null)
      setForkList(null)
      setForkSelected(null)
      if (send) await actions.sendMessage(text, [])
      else actions.fillComposer(text, true)
    } finally {
      setForkBusy(false)
    }
  }

  const openTree = async (): Promise<void> => {
    if (treeBusy) return
    setTreeOpen(true)
    setTreeBusy(true)
    try {
      setTreeData(await actions.sessionTree())
    } catch {
      setTreeData(null)
    } finally {
      setTreeBusy(false)
    }
  }

  const forkFromTree = async (entryId: string): Promise<void> => {
    if (treeBusy) return
    setTreeBusy(true)
    try {
      const result = await actions.forkSession(entryId)
      if (!result.ok) {
        actions.notify('error', '创建分支失败', result.error)
        return
      }
      setTreeOpen(false)
      setTreeData(null)
      if (result.text) actions.fillComposer(result.text, true)
    } finally {
      setTreeBusy(false)
    }
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
        <button className={clsx('skills-entry skills-page-entry', state.skillsOpen && state.skillsSection === 'skills' && 'is-current')}
          aria-current={state.skillsOpen && state.skillsSection === 'skills' ? 'page' : undefined}
          onClick={() => actions.openSkills(true)}>
          <Sparkles size={13} />
          <span>{t('技能与工具')}</span>
        </button>
        <button className={clsx('skills-entry plugins-page-entry', state.skillsOpen && state.skillsSection === 'plugins' && 'is-current')}
          aria-current={state.skillsOpen && state.skillsSection === 'plugins' ? 'page' : undefined}
          onClick={() => actions.openSkills(true, 'plugins')}>
          <Package size={13} />
          <span>{t('Pi 插件')}</span>
        </button>
        <button
          className={clsx('skills-entry schedules-entry', state.schedulesOpen && 'is-current')}
          aria-current={state.schedulesOpen ? 'page' : undefined}
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
            <span className="shortcut">{scheduleCount || ''}</span>
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
        {state.interruptedUiError && <div className="interrupted-approval">{t('确认记录不可用，请检查应用数据目录。')}</div>}
        {state.interruptedUi.map((item) => (
          <div className="interrupted-approval" key={item.id}>
            <strong>{t('任务在等待确认时中断')}</strong>
            <span>{baseName(item.cwd)} · {t('请先核对实际结果，再决定是否重新发起。')}</span>
            <button onClick={() => { void window.pi.acknowledgeInterruptedUi(item.id).catch(() => actions.notify('error', t('无法更新中断提示'))) }}>{t('知道了')}</button>
          </div>
        ))}
        {state.backgroundUiPending.map((pending) => {
          const session = state.sessions.find((item) => item.path === pending.path)
          const name = session?.name || baseName(pending.cwd)
          return (
            <button className="background-approval" key={pending.path}
              onClick={() => void actions.openSession(pending.cwd, pending.path)}>
              <span>{t('后台任务等待确认')}</span>
              <span>{truncate(name, 42)} · {t('查看')}</span>
            </button>
          )
        })}
        {queryText && searchResults.length > 0 && (
          <div className="session-search-results">
            <div className="recent-label">{t('消息结果')}</div>
            {searchResults.map((result) => (
              <button
                key={result.session.path}
                className="session-search-hit"
                onClick={() => void actions.openSession(result.session.cwd, result.session.path)}
                title={result.session.name}
              >
                <span className="session-search-name">{result.session.name}{archivedPaths.includes(result.session.path) && ` · ${t('已归档')}`}</span>
                {result.matches[0] && <span className="session-search-snippet">{result.matches[0].text}</span>}
              </button>
            ))}
          </div>
        )}
        {pinnedSessions.length > 0 && <div className="pinned-sessions">
          <div className="project-shortcuts-header recent-header"><span className="project-shortcuts-label">{t('置顶')}</span></div>
          {pinnedSessions.map(session => renderSession(session, false))}
        </div>}
        <div className="project-shortcuts-header">
          <span className="project-shortcuts-label">{t('Projects')}</span>
          <button className="icon-button project-add" onClick={() => actions.openAddProject(true)}
            title={t('添加项目')} aria-label={t('添加项目')}><Plus size={14} /></button>
        </div>
        {Boolean(queryText) && matching.length === 0 && archivedSessions.length === 0 && (
          <div className="session-empty">{t('没有匹配的会话。')}</div>
        )}
        {workspaces.map((path) => {
          const name = projectLabels.get(path) || projectName(state.settings.workspaceNames, path)
          const readOnly = projectReadOnly(state.settings, path)
          const matches = matching.filter((session) => pathsEqual(session.cwd, path))
          const activeText = `${state.sessionName ?? ''} ${workspace ?? ''}`.toLowerCase()
          if (
            state.sessionPath &&
            !archivedPaths.includes(state.sessionPath) &&
            workspace &&
            pathsEqual(workspace, path) &&
            !isTemporaryWorkspace(workspace, scratchPath) &&
            (!queryText || activeText.includes(queryText)) &&
            !matches.some((session) => session.path === state.sessionPath)
          ) {
            matches.unshift({
              path: state.sessionPath,
              id: state.sessionPath,
              cwd: path,
              name: sessionDisplayTitle({
                sessionName: state.sessionName,
                messages: state.messages,
                emptyLabel: t('未命名会话')
              }),
              preview: '',
              updatedAt: Date.now(),
              createdAt: Date.now(),
              messageCount: state.messages.length,
              size: 0
            })
          }
          if (queryText && matches.length === 0) return null
          const expanded = !collapsedProjects.has(path) || Boolean(queryText)
          return (
            <div className="project-tree" key={path}>
              <div className={clsx('project-row', workspace && pathsEqual(path, workspace) && !isTemporaryWorkspace(workspace, scratchPath) && 'active')}>
                <button
                  className="project-row-main"
                  aria-expanded={expanded}
                  title={shortenPath(path, state.boot?.home)}
                  aria-label={state.settings.language === 'en' ? `${expanded ? 'Collapse' : 'Expand'} sessions for ${name}` : `${expanded ? '收起' : '展开'} ${name} 的会话`}
                  onClick={() => setCollapsedProjects((current) => {
                    const next = new Set(current)
                    if (next.has(path)) next.delete(path); else next.add(path)
                    return next
                  })}
                >
                  <FolderOpen size={13} />
                  <span>{name}</span>
                </button>
                <button
                  className="icon-button project-new-chat"
                  title={state.settings.language === 'en' ? `New conversation in ${name}` : `在 ${name} 中新建对话`}
                  aria-label={state.settings.language === 'en' ? `New conversation in ${name}` : `在 ${name} 中新建对话`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void actions.openSession(path, null)
                  }}
                >
                  <Plus size={13} />
                </button>
                <Popover width={190} align="right" trigger={(_open, toggle, expanded) => (
                  <button className="icon-button project-remove" onClick={toggle}
                    title={t('项目操作')} aria-label={t('项目操作')} {...expanded}>
                    <MoreHorizontal size={14} />
                  </button>
                )}>
                  {(close) => <div className="menu">
                    <button className="menu-item" onClick={() => {
                      close()
                      window.dispatchEvent(new CustomEvent('pi:manage-project-trust', { detail: path }))
                    }}><ShieldCheck size={14} />{t('项目信任')}</button>
                    <button className="menu-item" onClick={() => {
                      close()
                      const preferences = Object.fromEntries(Object.entries(state.settings.workspaceReadOnly ?? {})
                        .filter(([project]) => !pathsEqual(project, path)))
                      void actions.updateSettings({ workspaceReadOnly: { ...preferences, [path]: !readOnly } })
                        .then(() => actions.notify('success', t(readOnly ? '项目可修改' : '项目已设为只读'), t('新启动的对话生效。')))
                        .catch(() => actions.notify('error', t('无法保存项目设置')))
                    }}><Lock size={14} />{t(readOnly ? '允许修改项目文件' : '设为项目只读')}</button>
                    <button className="menu-item" onClick={() => { close(); setPendingProjectRemoval(path) }}>
                      <Trash2 size={14} />{t('删除项目')}
                    </button>
                  </div>}
                </Popover>
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
          title={(() => {
            const version = state.boot?.piVersion
            const needsCheck = state.status === 'error' || state.status === 'exited' || Boolean(state.boot && !version)
            const preparing = !needsCheck && state.status !== 'ready' && state.status !== 'idle'
            const needsModel = Boolean(
              version && !preparing && !state.piSettings?.defaultProvider && !state.piSettings?.defaultModel
            )
            const ready = !needsCheck && !preparing && !needsModel
            if (needsModel) return t('先连接模型')
            return ready && version ? `${t('已就绪')} · ${version}` : needsCheck ? t('需要检查') : ready ? t('已就绪') : t('正在准备')
          })()}
        >
          {(() => {
            const version = state.boot?.piVersion
            const needsCheck = state.status === 'error' || state.status === 'exited' || Boolean(state.boot && !version)
            const preparing = !needsCheck && state.status !== 'ready' && state.status !== 'idle'
            const needsModel = Boolean(
              version && !preparing && !state.piSettings?.defaultProvider && !state.piSettings?.defaultModel
            )
            const ready = !needsCheck && !preparing && !needsModel
            const label = needsCheck ? t('需要检查') : preparing ? t('正在准备') : needsModel ? t('先连接模型') : ready ? t('已就绪') : t('正在准备')
            return (
              <>
                <span className={clsx('status-dot', needsCheck || needsModel ? 'is-error' : ready ? 'is-ready' : 'is-starting')} />
                <span>{label}</span>
              </>
            )
          })()}
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
            pinned={pinnedPaths.includes(contextMenu.session.path)}
            archived={archivedPaths.includes(contextMenu.session.path)}
            onToggleArchive={() => void toggleArchive(contextMenu.session)}
            onTogglePin={() => void togglePin(contextMenu.session.path)}
            close={() => setContextMenu(null)}
            onRename={(value) => {
              setRenaming(contextMenu.session.path)
              setRenameValue(value)
            }}
            onDelete={() => setPendingDelete(contextMenu.session)}
            onClone={() => void actions.cloneSession()}
            onTree={() => void openTree()}
          />
        )}
      </ContextMenu>

      <Modal
        open={Boolean(pendingProjectRemoval)}
        title={t('删除项目？')}
        subtitle={pendingProjectRemoval ?? undefined}
        onClose={() => { if (!removingProject) setPendingProjectRemoval(null) }}
        footer={<>
          <button className="button ghost" disabled={removingProject} onClick={() => setPendingProjectRemoval(null)}>{t('取消')}</button>
          <button className="button danger" disabled={removingProject || projectRemovalBusy} onClick={() => {
            const path = pendingProjectRemoval
            if (!path) return
            setRemovingProject(true)
            void (async () => {
              try {
                if (pathsEqual(path, workspace) && !await actions.newScratchSession()) return
                const result = await window.pi.removeProject(path)
                await actions.refreshSessions()
                setPendingProjectRemoval(null)
                actions.notify('success', t('项目已删除'), `${result.removedSessions} ${t('个对话已移到回收站。')}`)
              } catch (error) {
                actions.notify('error', t('无法删除项目'), error instanceof Error ? error.message : String(error))
              } finally { setRemovingProject(false) }
            })()
          }}>{removingProject ? t('正在删除…') : t('删除项目')}</button>
        </>}
      >
        <p className="modal-text">{t('项目会从列表中移除，该项目的所有对话（包括置顶和已归档对话）会移到回收站。电脑上的项目文件夹和文件不会删除。')}</p>
        {projectRemovalBusy && <p className="modal-text">{t('该项目有对话正在执行或等待确认，请先处理完当前任务。')}</p>}
      </Modal>

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
          {state.settings.language === 'en' ? '. You can undo this from the notification within 24 hours. Files changed by Pi are not affected.' : '，24 小时内可在提示条里「撤销」。Pi 在磁盘上改过的文件不受影响。'}
        </p>
      </Modal>
      <Modal
        open={forkTarget !== null}
        title={t('从历史提示分支')}
        subtitle={forkTarget?.name}
        width={560}
        onClose={() => (forkBusy ? undefined : setForkTarget(null))}
        footer={
          <>
            <button className="button ghost" disabled={forkBusy} onClick={() => setForkTarget(null)}>{t('取消')}</button>
            <button className="button ghost" disabled={forkBusy || !forkSelected} onClick={() => void chooseFork(false)}>{t('分支并编辑')}</button>
            <button className="button primary" disabled={forkBusy || !forkSelected} onClick={() => void chooseFork(true)}>{t('分支并发送')}</button>
          </>
        }
      >
        {forkList === null ? <p className="settings-note">{t('正在读取历史提示…')}</p> : forkList.length === 0 ? <p className="settings-note">{t('没有可以分支的用户提示。')}</p> : (
          <>
            <div className="fork-message-list">
              {forkList.map((item) => (
                <button
                  key={item.entryId}
                  className={clsx('fork-message-item', forkSelected?.entryId === item.entryId && 'selected')}
                  disabled={forkBusy}
                  onClick={() => { setForkSelected(item); setForkDraft(item.text) }}
                >
                  <span>{item.text}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
            {forkSelected && (
              <label className="form-field fork-edit-field">
                <span>{t('编辑要重新发送的提示')}</span>
                <textarea rows={4} value={forkDraft} onChange={(event) => setForkDraft(event.target.value)} />
              </label>
            )}
          </>
        )}
      </Modal>
      <Modal
        open={treeOpen}
        title={t('分支树')}
        subtitle={treeData ? `${treeData.tree.length} ${t('个根节点')}` : undefined}
        width={620}
        onClose={() => (treeBusy ? undefined : setTreeOpen(false))}
        footer={
          <>
            <button className="button ghost" disabled={treeBusy} onClick={() => void openTree()}>{t('刷新')}</button>
            <button className="button primary" disabled={treeBusy} onClick={() => setTreeOpen(false)}>{t('关闭')}</button>
          </>
        }
      >
        {treeBusy ? <p className="settings-note">{t('正在读取分支树…')}</p> : !treeData ? <p className="settings-note">{t('这个会话还没有分支记录。')}</p> : treeData.tree.length === 0 ? <p className="settings-note">{t('这个会话还没有消息。')}</p> : (() => {
          const rows = flattenTree(treeData.tree)
          const byId = new Map(rows.map((row) => [row.node.entry.id, row.node]))
          const active = new Set<string>()
          let cursor = treeData.leafId
          while (cursor) {
            if (active.has(cursor)) break
            active.add(cursor)
            cursor = byId.get(cursor)?.entry.parentId ?? null
          }
          return (
            <div className="tree-list">
              {rows.map(({ node, depth }) => {
                const entry = node.entry
                const role = entry.message?.role ?? entry.type
                const isUser = entry.message?.role === 'user'
                return (
                  <button
                    key={entry.id}
                    className={clsx('tree-row', active.has(entry.id) && 'active', isUser && 'clickable')}
                    style={{ paddingLeft: 10 + depth * 18 }}
                    disabled={treeBusy || !isUser}
                    title={isUser ? t('从此处分叉') : undefined}
                    onClick={() => void forkFromTree(entry.id)}
                  >
                    <span className="tree-connector">{depth > 0 ? '└' : '●'}</span>
                    <span className={clsx('tree-role', role)}>{role}</span>
                    <span className="tree-text">{treeEntryText(entry)}</span>
                    {entry.id === treeData.leafId && <span className="tree-current">{t('当前')}</span>}
                  </button>
                )
              })}
            </div>
          )
        })()}
      </Modal>
    </aside>
  )
}
