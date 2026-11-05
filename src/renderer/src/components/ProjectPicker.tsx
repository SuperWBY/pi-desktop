import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, FolderOpen, MessageCircle, Plus, Search } from 'lucide-react'
import { useApp } from '../store'
import { useTranslation } from '../i18n'
import { baseName, shortenPath } from '../lib/format'
import { Popover } from './ui'

/**
 * The project selector for a brand-new conversation. It lives in the empty
 * chat state, not in the sidebar: a new chat starts unbound, and the user can
 * choose a project before sending the first message (or stay in a temporary
 * conversation, which shows up under Recent).
 */
export function ProjectPicker(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [query, setQuery] = useState('')

  const projects = useMemo(() => {
    const list = [...state.settings.workspaces]
    if (state.workspace && !state.scratchWorkspace && !list.includes(state.workspace)) {
      list.unshift(state.workspace)
    }
    return Array.from(new Set(list))
  }, [state.scratchWorkspace, state.settings.workspaces, state.workspace])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return projects
    return projects.filter(
      (path) => baseName(path).toLowerCase().includes(needle) || path.toLowerCase().includes(needle)
    )
  }, [projects, query])

  const currentLabel = state.scratchWorkspace
    ? t('选择项目')
    : baseName(state.workspace) || t('选择项目')

  return (
    <Popover
      width={310}
      trigger={(_open, toggle, expanded) => (
        <button
          className={`project-picker-trigger composer-project-tab${state.scratchWorkspace ? '' : ' active'}`}
          onClick={toggle}
          title={state.scratchWorkspace ? t('不关联项目') : state.workspace ?? ''}
          {...expanded}
        >
          <FolderOpen size={13} />
          <span>{currentLabel}</span>
          <ChevronDown size={12} className="project-picker-chevron" />
        </button>
      )}
    >
      {(close) => (
        <div className="project-picker">
          <label className="project-picker-search">
            <Search size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索项目')}
              autoFocus
            />
          </label>
          <div className="project-picker-list">
            {filtered.map((path) => {
              const active = !state.scratchWorkspace && state.workspace === path
              return (
                <button
                  className="project-picker-item"
                  key={path}
                  onClick={() => {
                    close()
                    if (!active) void actions.openSession(path, null)
                  }}
                >
                  <FolderOpen size={15} />
                  <span className="project-picker-main">
                    <span className="project-picker-name">{baseName(path)}</span>
                    <span className="project-picker-path">
                      {shortenPath(path, state.boot?.home)}
                    </span>
                  </span>
                  {active && <Check size={14} className="project-picker-check" />}
                </button>
              )
            })}
          </div>
          <div className="menu-separator" />
          <button
            className="project-picker-item"
            onClick={() => {
              close()
              void actions.pickFolder()
            }}
          >
            <Plus size={15} />
            <span className="project-picker-main">
              <span className="project-picker-name">{t('新建项目')}</span>
              <span className="project-picker-path">{t('选择一个文件夹')}</span>
            </span>
          </button>
          <button
            className={state.scratchWorkspace ? 'project-picker-item active' : 'project-picker-item'}
            onClick={() => {
              close()
              if (!state.scratchWorkspace) void actions.newScratchSession()
            }}
          >
            <MessageCircle size={15} />
            <span className="project-picker-main">
              <span className="project-picker-name">{t('不在项目中工作')}</span>
              <span className="project-picker-path">{t('出现在最近对话')}</span>
            </span>
            {state.scratchWorkspace && <Check size={14} className="project-picker-check" />}
          </button>
        </div>
      )}
    </Popover>
  )
}
