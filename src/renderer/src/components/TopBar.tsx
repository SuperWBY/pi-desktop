import { useTranslation } from '../i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { Archive, PanelLeft, PanelRight } from 'lucide-react'
import clsx from 'clsx'
import { useApp } from '../store'
import { projectName, shortenPath, truncate } from '../lib/format'
import { isTemporaryWorkspace, looksLikeRawPath } from '@shared/paths'
import { shortcutKeys, shiftMod } from '../lib/platform'
import { contentText } from '../lib/tools'

export function TopBar(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const temporary = state.scratchWorkspace || isTemporaryWorkspace(state.workspace, state.boot?.scratchPath)
  const place = temporary
    ? t('临时对话')
    : projectName(state.settings.workspaceNames, state.workspace) || t('不关联文件夹')
  const placeLabel = looksLikeRawPath(place) ? t('临时对话') : place
  const firstUser = state.messages.find((message) => message.role === 'user')
  const fallbackTitle = firstUser
    ? truncate(contentText((firstUser as { content?: unknown }).content), 56)
    : placeLabel
  const title =
    state.sessionName ??
    (state.messages.length > 0
      ? fallbackTitle
      : state.workspace || state.scratchWorkspace
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
        {percent >= 40 && (
          <button
            className={clsx('icon-button', percent > 80 && 'warn')}
            onClick={() => void actions.compact()}
            title={t('Compact context ({percent}% used)').replace('{percent}', String(Math.round(percent)))}
          >
            <Archive size={15} />
          </button>
        )}
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
