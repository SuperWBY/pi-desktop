import { useTranslation } from '../i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { Archive, Moon, PanelLeft, PanelRight, Plus, Settings, Sun } from 'lucide-react'
import clsx from 'clsx'
import { useApp } from '../store'
import { baseName, formatTokens, shortenPath, truncate } from '../lib/format'
import { contentText } from '../lib/tools'

export function TopBar(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const firstUser = state.messages.find((message) => message.role === 'user')
  const fallbackTitle = firstUser
    ? truncate(contentText((firstUser as { content?: unknown }).content), 56)
    : baseName(state.workspace) || t('Session')
  const title =
    state.sessionName ??
    (state.messages.length > 0
      ? fallbackTitle
      : state.workspace
        ? t('New session')
        : 'Pi Desktop')
  const percent = state.stats?.contextUsage?.percent ?? 0

  useEffect(() => {
    setEditing(false)
  }, [state.sessionPath])

  const commit = (): void => {
    setEditing(false)
    const next = value.trim()
    if (next && next !== title) void actions.renameSession(next)
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className={clsx('icon-button', state.sidebarOpen && 'subtle')}
          onClick={actions.toggleSidebar}
          title={state.sidebarOpen ? t("Hide sidebar (⌘B)") : t("Show sidebar (⌘B)")}
        >
          <PanelLeft size={15} />
        </button>
        <div className="title-area">
          {editing ? (
            <input
              autoFocus
              className="title-input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit()
                if (event.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <button
              className="title-button"
              onClick={() => {
                setValue(state.sessionName ?? '')
                setEditing(true)
              }}
              title={t("Rename session")}
            >
              {title}
            </button>
          )}
          <div className="topbar-sub">
            <span className="topbar-path" title={state.workspace ?? ''}>
              {shortenPath(state.workspace, state.boot?.home) || t("No project")}
            </span>
            {state.sessionPath && (
              <>
                <span className="dot-sep">·</span>
                <span>{t('{count} messages').replace('{count}', String(state.messages.length))}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="topbar-right">
        {(state.stats?.tokens?.total ?? 0) > 0 && (
          <div className="token-pill" title={t("Session token usage")}>
            {formatTokens(state.stats?.tokens?.total)} tokens
          </div>
        )}
        {percent >= 40 && (
          <button
            className={clsx('icon-button', percent > 80 && 'warn')}
            onClick={() => void actions.compact()}
            title={t('Compact context ({percent}% used)').replace('{percent}', String(Math.round(percent)))}
          >
            <Archive size={15} />
          </button>
        )}
        <button className="icon-button" onClick={() => void actions.newSession()} title={t("New session (⌘N)")}>
          <Plus size={16} />
        </button>
        <button
          className="icon-button"
          onClick={() => void actions.setTheme(state.settings.theme === 'dark' ? 'light' : 'dark')}
          title={t("Toggle theme (⌘⇧L)")}
        >
          {state.settings.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button className="icon-button settings-entry" onClick={() => actions.openSettings(true)} title={t("Settings")} aria-label={t("Settings")}>
          <Settings size={15} />
        </button>
        <button
          className={clsx('icon-button', state.settings.workPanelOpen && 'work-panel-toggle-active')}
          onClick={actions.toggleWorkPanel}
          title={state.settings.language === 'en' ? 'Work panel (⌘⇧E)' : '工作面板 (⌘⇧E)'}
          aria-label={state.settings.language === 'en' ? 'Work panel' : '工作面板'}
          aria-pressed={state.settings.workPanelOpen === true}
        >
          <PanelRight size={15} />
        </button>
      </div>
    </header>
  )
}
