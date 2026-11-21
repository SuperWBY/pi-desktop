import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, FolderOpen, GitBranch, Laptop, MessageCircle, Plus, Search } from 'lucide-react'
import { useApp } from '../store'
import { useTranslation } from '../i18n'
import { projectName, shortenPath } from '../lib/format'
import { isTemporaryWorkspace } from '@shared/paths'
import { Popover } from './ui'

export function ProjectPicker({ disabled, covered = false }: { disabled: boolean; covered?: boolean }): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [query, setQuery] = useState('')
  const [branch, setBranch] = useState<{ workspace: string; name: string } | null>(null)

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

  const unbound = !state.workspace || state.scratchWorkspace || isTemporaryWorkspace(state.workspace, state.boot?.scratchPath)
  const project = unbound ? null : state.workspace
  const currentLabel = unbound
    ? t('选择项目')
    : projectName(state.settings.workspaceNames, state.workspace) || t('选择文件夹')
  const established = state.messages.some((message) => message.role === 'user')
  const busy = state.streaming || state.compacting

  useEffect(() => {
    if (!project || busy || disabled) return
    let active = true
    let request = 0
    const refresh = (): void => {
      const id = ++request
      void window.pi.gitBranch(project).then((name) => {
        if (active && id === request) setBranch(name ? { workspace: project, name } : null)
      }).catch(() => {
        if (active && id === request) setBranch(null)
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.removeEventListener('focus', refresh)
    }
  }, [project, busy, disabled])

  return (
    <div className="composer-project-row">
      <span className="composer-location"><Laptop size={14} />{t('本机')}</span>
      <Popover
        key={covered ? 'covered' : 'visible'}
        width={310}
        trigger={(_open, toggle, expanded) => (
          <button
            className="project-picker-trigger"
            onClick={() => { setQuery(''); toggle() }}
            disabled={disabled}
            title={unbound ? t('这次对话没有关联文件夹') : shortenPath(state.workspace, state.boot?.home)}
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
            {established && <div className="project-picker-heading">{t('在其他项目中新建对话')}</div>}
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
              className={unbound ? 'project-picker-item active' : 'project-picker-item'}
              onClick={() => {
                close()
                if (!unbound) void actions.openSession('', null, { scratch: true })
              }}
            >
              <MessageCircle size={15} />
              <span className="project-picker-main">
                <span className="project-picker-name">{t(established && !unbound ? '新建无项目对话' : '不关联文件夹')}</span>
                <span className="project-picker-path">{t('对话会出现在「最近对话」里')}</span>
              </span>
              {unbound && <Check size={14} className="project-picker-check" />}
            </button>
          </div>
        )}
      </Popover>
      {branch && branch.workspace === project && (
        <span className="composer-branch" title={branch.name}><GitBranch size={13} /><span>{branch.name}</span></span>
      )}
    </div>
  )
}
