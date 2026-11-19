import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, FolderOpen, MessageCircle, Plus, Search } from 'lucide-react'
import { useApp } from '../store'
import { useTranslation } from '../i18n'
import { projectName, shortenPath } from '../lib/format'
import { isTemporaryWorkspace } from '@shared/paths'
import { Popover } from './ui'

/**
 * The project selector for a brand-new conversation. It lives in the empty
 * chat state, not in the sidebar: a new chat starts unbound, and the user can
 * choose a project before sending the first message (or stay in a new chat
 * without a folder, which shows up under Recent).
 */
export function ProjectPicker(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [query, setQuery] = useState('')

  const projects = useMemo(() => {
    const scratchPath = state.boot?.scratchPath
    const list = state.settings.workspaces.filter((path) => !isTemporaryWorkspace(path, scratchPath))
    if (
      state.workspace &&
      !state.scratchWorkspace &&
      !isTemporaryWorkspace(state.workspace, scratchPath) &&
      !list.includes(state.workspace)
    ) {
      list.unshift(state.workspace)
    }
    return Array.from(new Set(list))
  }, [state.boot?.scratchPath, state.scratchWorkspace, state.settings.workspaces, state.workspace])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return projects
    return projects.filter(
      (path) => projectName(state.settings.workspaceNames, path).toLowerCase().includes(needle) || path.toLowerCase().includes(needle)
    )
  }, [projects, query, state.settings.workspaceNames])

  const temporary = state.scratchWorkspace || isTemporaryWorkspace(state.workspace, state.boot?.scratchPath)
  const currentLabel = temporary
    ? t('新对话')
    : projectName(state.settings.workspaceNames, state.workspace) || t('选择文件夹')

  return (
    <Popover
      width={310}
      trigger={(_open, toggle, expanded) => (
        <button
          className={`project-picker-trigger composer-project-tab${temporary ? '' : ' active'}`}
          onClick={toggle}
          disabled={state.status === 'starting'}
          title={temporary ? t('这次对话没有关联文件夹') : shortenPath(state.workspace, state.boot?.home)}
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
                    <span className="project-picker-name">{projectName(state.settings.workspaceNames, path)}</span>
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
              actions.openAddProject(true)
            }}
          >
            <Plus size={15} />
            <span className="project-picker-main">
              <span className="project-picker-name">{t('新建项目')}</span>
              <span className="project-picker-path">{t('选择一个文件夹')}</span>
            </span>
          </button>
          <button
            className={temporary ? 'project-picker-item active' : 'project-picker-item'}
            onClick={() => {
              close()
              if (!temporary) void actions.newScratchSession()
            }}
          >
            <MessageCircle size={15} />
            <span className="project-picker-main">
              <span className="project-picker-name">{t('新对话')}</span>
              <span className="project-picker-path">{t('对话会出现在「最近对话」里')}</span>
            </span>
            {temporary && <Check size={14} className="project-picker-check" />}
          </button>
        </div>
      )}
    </Popover>
  )
}
