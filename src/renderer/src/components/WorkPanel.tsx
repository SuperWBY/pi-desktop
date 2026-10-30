import { useTranslation } from '../i18n'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FileText, Files, FolderTree, Image, Maximize2, Minimize2, Plus, SquareTerminal, X } from 'lucide-react'
import clsx from 'clsx'
import { useApp } from '../store'
import { ChangesTab } from './work/ChangesTab'
import { FilesTab } from './work/FilesTab'
import { TerminalTab } from './work/TerminalTab'
import { ArtifactsTab } from './work/ArtifactsTab'
import { FilePreview } from './work/FilePreview'
import { Popover } from './ui'
import { baseName } from '../lib/format'

type TabId = 'changes' | 'files' | 'terminal' | 'artifacts'

const TABS: { id: TabId; label: string; icon: typeof Files }[] = [
  { id: 'changes', label: '变更', icon: Files },
  { id: 'files', label: '文件', icon: FolderTree },
  { id: 'terminal', label: '终端', icon: SquareTerminal },
  { id: 'artifacts', label: '产物', icon: Image }
]

const MIN_WIDTH = 280
const MAX_WIDTH = 620
const DEFAULT_WIDTH = 360
/** Dragging narrower than this and releasing collapses the panel. */
const COLLAPSE_AT = 240

export function WorkPanel(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const open = state.settings.workPanelOpen === true
  const storedWidth = state.settings.workPanelWidth ?? DEFAULT_WIDTH
  const preferredTab = state.settings.workPanelTab ?? 'changes'
  const [width, setWidth] = useState(storedWidth)
  const [maximized, setMaximized] = useState(false)
  const [tabs, setTabs] = useState<TabId[]>(() => {
    const saved = state.settings.workPanelTabs?.filter((id, index, all) => TABS.some((item) => item.id === id) && all.indexOf(id) === index)
    return saved?.length ? saved : ['changes']
  })
  const [fileTabs, setFileTabs] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const cancelResize = useRef<(() => void) | null>(null)
  const tabListRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef(state.workspace)
  const builtinTab = tabs.includes(preferredTab) ? preferredTab : tabs[0]
  const tab = activeFile ? `file:${activeFile}` : builtinTab
  const allTabs = [...tabs, ...fileTabs.map((path) => `file:${path}`)]
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([builtinTab]))
  const restoredTabs = useRef(false)

  useEffect(() => {
    if (restoredTabs.current || !state.boot) return
    restoredTabs.current = true
    const saved = state.boot.settings.workPanelTabs?.filter((id, index, all) => TABS.some((item) => item.id === id) && all.indexOf(id) === index)
    if (saved?.length) setTabs(saved)
  }, [state.boot])

  useEffect(() => {
    setWidth(storedWidth)
  }, [storedWidth])

  useEffect(() => {
    setVisited((current) => current.has(builtinTab) ? current : new Set([...current, builtinTab]))
  }, [builtinTab])

  useEffect(() => {
    const list = tabListRef.current
    if (!list || !open) return
    const reveal = (): void => {
      const active = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (!active) return
      const strip = list.getBoundingClientRect()
      const rect = active.getBoundingClientRect()
      if (rect.left < strip.left) list.scrollLeft -= strip.left - rect.left
      else if (rect.right > strip.right) list.scrollLeft += rect.right - strip.right
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(list)
    return () => observer.disconnect()
  }, [tab, open])

  useEffect(() => {
    if (workspaceRef.current === state.workspace) return
    workspaceRef.current = state.workspace
    setFileTabs([])
    setActiveFile(null)
  }, [state.workspace])

  const update = useCallback(
    (patch: { workPanelOpen?: boolean; workPanelWidth?: number; workPanelTab?: TabId; workPanelTabs?: TabId[] }) => {
      void actions.updateSettings(patch)
    },
    [actions]
  )

  const closeTab = (id: string): void => {
    if (id.startsWith('file:')) {
      const path = id.slice(5)
      setFileTabs((current) => current.filter((item) => item !== path))
      if (activeFile === path) setActiveFile(null)
      return
    }
    if (tabs.length <= 1) return
    const remaining = tabs.filter((item) => item !== id)
    const next = id === builtinTab ? remaining[Math.max(0, tabs.indexOf(id as TabId) - 1)] : builtinTab
    setTabs(remaining)
    update({ workPanelTabs: remaining, workPanelTab: next })
  }

  const openTab = (id: TabId): void => {
    const next = tabs.includes(id) ? tabs : [...tabs, id]
    setTabs(next)
    setActiveFile(null)
    update({ workPanelTabs: next, workPanelTab: id })
  }

  const selectTab = (id: string): void => {
    if (id.startsWith('file:')) setActiveFile(id.slice(5))
    else { setActiveFile(null); update({ workPanelTab: id as TabId }) }
  }

  const openFile = (path: string): void => {
    setFileTabs((current) => current.includes(path) ? current : [...current, path])
    setActiveFile(path)
  }

  useEffect(() => {
    const onReview = (): void => {
      const next = tabs.includes('changes') ? tabs : [...tabs, 'changes' as const]
      setTabs(next)
      setActiveFile(null)
      setVisited((current) => new Set([...current, 'changes']))
      actions.setWorkPanelOpen(true)
      void actions.updateSettings({ workPanelTabs: next, workPanelTab: 'changes' })
    }
    window.addEventListener('pi:review-request', onReview)
    return () => window.removeEventListener('pi:review-request', onReview)
  }, [tabs, actions])

  // Drag locally (instant) and persist once on release. Persisting on every
  // mousemove made the edge lag behind the cursor, which felt like the panel
  // refusing to shrink.
  const onDragStart = (event: React.MouseEvent): void => {
    if (maximized) return
    cancelResize.current?.()
    event.preventDefault()
    const startX = event.clientX
    const startWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? width
    let latest = startWidth
    document.body.classList.add('is-resizing')

    const onMove = (moveEvent: MouseEvent): void => {
      latest = Math.max(120, Math.min(MAX_WIDTH, startWidth + (startX - moveEvent.clientX)))
      setWidth(latest)
    }
    const cleanup = (): void => {
      document.body.classList.remove('is-resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onBlur)
      cancelResize.current = null
    }
    const onBlur = (): void => {
      cleanup()
      setWidth(storedWidth)
    }
    const onUp = (): void => {
      cleanup()
      if (latest < COLLAPSE_AT) {
        setWidth(storedWidth)
        actions.setWorkPanelOpen(false)
        return
      }
      void actions.updateSettings({ workPanelWidth: Math.round(Math.max(MIN_WIDTH, latest)) })
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
    cancelResize.current = onBlur
  }

  useEffect(() => {
    if (!open) cancelResize.current?.()
  }, [open])
  useEffect(() => () => cancelResize.current?.(), [])

  return (
    <aside className={clsx('work-panel', maximized && 'is-maximized')} style={{ width }} hidden={!open}>
      <div
        className="work-resize"
        onMouseDown={onDragStart}
        onDoubleClick={() =>
          void actions.updateSettings({ workPanelWidth: DEFAULT_WIDTH })
        }
        role="separator"
        aria-orientation="vertical"
        aria-disabled={maximized}
        aria-label={state.settings.language === 'en' ? 'Resize work panel' : '调整工作面板宽度'}
        tabIndex={maximized ? -1 : 0}
        onKeyDown={(event) => {
          if (maximized || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const panel = event.currentTarget.parentElement
          if (!panel) return
          const current = panel.getBoundingClientRect().width
          const cssMax = Number.parseFloat(getComputedStyle(panel).maxWidth)
          const maximum = Number.isFinite(cssMax) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, cssMax)) : MAX_WIDTH
          const delta = event.shiftKey ? 32 : 16
          const requested = event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? maximum : current + (event.key === 'ArrowLeft' ? delta : -delta)
          void actions.updateSettings({ workPanelWidth: Math.round(Math.min(maximum, Math.max(MIN_WIDTH, requested))) })
        }}
        title={t('拖动调整宽度，双击恢复默认，拖到最窄可收起')}
      />
      <header className="work-head">
        <div className="work-tabs" ref={tabListRef} role="tablist" onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const current = allTabs.indexOf(tab)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? allTabs.length - 1 :
            (current + (event.key === 'ArrowRight' ? 1 : -1) + allTabs.length) % allTabs.length
          selectTab(allTabs[next])
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
        }}>
          {allTabs.map((id) => {
            const file = id.startsWith('file:') ? id.slice(5) : null
            const item = TABS.find((candidate) => candidate.id === id)
            const label = file ? baseName(file) : t(item!.label)
            const Icon = file ? FileText : item!.icon
            return <div className={clsx('work-tab-item', tab === id && 'active', file && 'is-file')} key={id}>
            <button
              role="tab"
              aria-selected={tab === id}
              aria-label={label}
              title={file ?? label}
              className={clsx('work-tab-button', tab === id && 'active')}
              onClick={() => selectTab(id)}
            >
              <Icon size={12} />
              <span className="work-tab-label">{label}</span>
            </button>
            <button className="work-tab-close" onClick={() => closeTab(id)} disabled={!file && tabs.length <= 1}
              aria-label={state.settings.language === 'en' ? `Close ${label} tab` : `关闭${label}标签`}
              title={state.settings.language === 'en' ? `Close ${label} tab` : `关闭${label}标签`}>
              <X size={11} />
            </button>
            </div>
          })}
        </div>
        <div className="work-head-actions">
          <Popover align="right" width={170} trigger={(_open, toggle, expanded) => (
            <button className="work-icon" onClick={toggle} aria-label={state.settings.language === 'en' ? 'Add work tab' : '添加工作区标签'} title={state.settings.language === 'en' ? 'Add work tab' : '添加工作区标签'} {...expanded}>
              <Plus size={15} />
            </button>
          )}>
            {(close) => <div className="menu">{TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} className="menu-item" onClick={() => { openTab(id); close() }}>
                <Icon size={14} /><span className="menu-item-title">{t(label)}</span>
              </button>
            ))}</div>}
          </Popover>
          <button
            className="work-icon"
            onClick={() => setMaximized((value) => !value)}
            aria-label={state.settings.language === 'en' ? (maximized ? 'Restore work panel' : 'Maximize work panel') : (maximized ? '恢复工作面板' : '放大工作面板')}
            title={state.settings.language === 'en' ? (maximized ? 'Restore work panel' : 'Maximize work panel') : (maximized ? '恢复工作面板' : '放大工作面板')}
            aria-pressed={maximized}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button className="work-icon" onClick={() => actions.setWorkPanelOpen(false)} aria-label={t('关闭')} title={t('关闭')}>
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="work-body">
        {(visited.has('changes') || tab === 'changes') && <div className="work-tab-container" hidden={tab !== 'changes'}><ChangesTab /></div>}
        {(visited.has('files') || tab === 'files') && <div className="work-tab-container" hidden={tab !== 'files'}><FilesTab onOpenFile={openFile} /></div>}
        {(visited.has('terminal') || tab === 'terminal') && <div className="work-tab-container" hidden={tab !== 'terminal'}><TerminalTab /></div>}
        {(visited.has('artifacts') || tab === 'artifacts') && <div className="work-tab-container" hidden={tab !== 'artifacts'}><ArtifactsTab /></div>}
        {fileTabs.map((path) => <div key={path} className="work-tab-container" hidden={tab !== `file:${path}`}><FilePreview path={path} /></div>)}
      </div>
    </aside>
  )
}
