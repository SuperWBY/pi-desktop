import { useTranslation } from '../i18n'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { PanelLeft, PanelRight } from 'lucide-react'
import clsx from 'clsx'
import { useApp } from '../store'
import { projectName, shortenPath } from '../lib/format'
import { isTemporaryWorkspace, looksLikeRawPath } from '@shared/paths'
import { shortcutKeys, shiftMod } from '../lib/platform'
import { sessionDisplayTitle } from '../lib/session-title'

export function TopBar(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const temporary = state.scratchWorkspace || isTemporaryWorkspace(state.workspace, state.boot?.scratchPath)
  const place = temporary
    ? t('新对话')
    : projectName(state.settings.workspaceNames, state.workspace) || t('新对话')
  const placeLabel = looksLikeRawPath(place) ? t('新对话') : place
  const title = sessionDisplayTitle({
    sessionName: state.sessionName,
    messages: state.messages,
    emptyLabel:
      state.messages.length > 0
        ? placeLabel
        : state.workspace || state.scratchWorkspace
          ? t('New session')
          : 'Pi Desktop'
  })

  useEffect(() => {
    setEditing(false)
  }, [state.sessionPath])

  const beginEditing = useCallback((): void => {
    setValue(state.sessionName ?? '')
    setEditing(true)
  }, [state.sessionName])

  useEffect(() => {
    window.addEventListener('pi:rename-current-session', beginEditing)
    return () => window.removeEventListener('pi:rename-current-session', beginEditing)
  }, [beginEditing])

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
          title={state.sidebarOpen ? shortcutKeys(t("Hide sidebar (⌘B)")) : shortcutKeys(t("Show sidebar (⌘B)"))}
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
              onClick={beginEditing}
              title={t("Rename session")}
            >
              {title}
            </button>
          )}
          <div className="topbar-sub">
            <span
              className="topbar-path"
              title={temporary ? t('这次对话没有关联文件夹') : shortenPath(state.workspace, state.boot?.home) || placeLabel}
            >
              {placeLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="topbar-right">
        <button
          className={clsx('icon-button', state.settings.workPanelOpen && 'work-panel-toggle-active')}
          onClick={actions.toggleWorkPanel}
          title={
            state.settings.language === 'en'
              ? `Work panel (${shiftMod('E')})`
              : `工作面板 (${shiftMod('E')})`
          }
          aria-label={state.settings.language === 'en' ? 'Work panel' : '工作面板'}
          aria-pressed={state.settings.workPanelOpen === true}
        >
          <PanelRight size={15} />
        </button>
      </div>
    </header>
  )
}
