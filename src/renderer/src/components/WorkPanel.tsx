import { useTranslation } from '../i18n'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FileText, Files, FolderTree, Globe2, Image, Maximize2, Minimize2, Plus, SquareTerminal, X } from 'lucide-react'
import clsx from 'clsx'
import type { Settings } from '@shared/types'
import { useApp } from '../store'
import { ChangesTab } from './work/ChangesTab'
import { FilesTab } from './work/FilesTab'
import { TerminalTab } from './work/TerminalTab'
import { ArtifactsTab } from './work/ArtifactsTab'
import { BrowserTab, type BrowserRequest } from './work/BrowserTab'
import { FilePreview } from './work/FilePreview'
import { WorkHome } from './work/WorkHome'
import { baseName } from '../lib/format'

type TabId = 'home' | 'changes' | 'files' | 'terminal' | 'artifacts' | 'browser'

const TABS: { id: TabId; label: string; icon: typeof Files }[] = [
  { id: 'home', label: '新标签页', icon: Globe2 },
  { id: 'changes', label: '变更', icon: Files },
  { id: 'files', label: '文件', icon: FolderTree },
  { id: 'terminal', label: '终端', icon: SquareTerminal },
  { id: 'artifacts', label: '产物', icon: Image },
  { id: 'browser', label: '浏览器', icon: Globe2 }
]

const MIN_WIDTH = 280
const MAX_WIDTH = 620
const DEFAULT_WIDTH = 360
/** Dragging narrower than this and releasing collapses the panel. */
const COLLAPSE_AT = 240

function restoreTabs(settings: Settings): TabId[] {
  const saved = settings.workPanelTabs ?? (settings.workPanelTab ? [settings.workPanelTab] : [])
  const valid = saved.filter((id) => TABS.some((tab) => tab.id === id))
  const tabs = [...new Set(valid)]
  if (!tabs.length || (tabs.length === 1 && tabs[0] === 'files')) tabs.push('home')
  return tabs
}

function restoreSelection(tabs: TabId[], preferred?: TabId): TabId {
  if (tabs.includes('home') && tabs.every((tab) => tab === 'home' || tab === 'files')) return 'home'
  return preferred && tabs.includes(preferred) ? preferred : tabs[0]
}

export function WorkPanel({onExpandedDocument}: {onExpandedDocument: (doc: string | null) => void}): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const open = state.settings.workPanelOpen === true
  const storedWidth = state.settings.workPanelWidth ?? DEFAULT_WIDTH
  const [width, setWidth] = useState(storedWidth)
  const [maximized, setMaximized] = useState(false)
  const [tabs, setTabs] = useState<TabId[]>(() => restoreTabs(state.settings))
  const [preferredTab, setPreferredTab] = useState(() => restoreSelection(tabs, state.settings.workPanelTab))
  const [fileTabs, setFileTabs] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [browserRequest, setBrowserRequest] = useState<BrowserRequest | null>(null)
  const [browserTitle, setBrowserTitle] = useState('')
  const [followTurn, setFollowTurn] = useState<string | null>(null)
  const turnKey = (state.sessionPath ?? state.workspace ?? '') + '/' + state.turnStartedAt
  let taskDoc: string | undefined
  if (state.streaming) for (const run of Object.values(state.toolRuns)) {
    if (run.startedAt < state.turnStartedAt || run.status !== 'done') continue
    if (run.name === 'computer_use_session_open' || run.name === 'computer_use_session_close') taskDoc = undefined
    const details = run.resultDetails as {backend?: string; documentId?: string} | undefined
    if (run.name === 'computer_use_session_observe' && details?.backend === 'inapp') taskDoc = details.documentId
  }
  const following = followTurn === turnKey
  const cancelResize = useRef<(() => void) | null>(null)
  const tabListRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef(state.workspace)
  const builtinTab = tabs.includes(preferredTab) ? preferredTab : tabs[0]
  const tab = activeFile ? `file:${activeFile}` : builtinTab
  const allTabs = [...tabs, ...fileTabs.map((path) => `file:${path}`)]
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([builtinTab]))
  const restoredTabs = useRef(false)
  const wasOpen = useRef(open)
  const browserSelected = useRef(false)

  useEffect(() => {
    if (restoredTabs.current || !state.boot) return
    restoredTabs.current = true
    const saved = restoreTabs(state.boot.settings)
    setTabs(saved)
    setPreferredTab(restoreSelection(saved, state.boot.settings.workPanelTab))
    // A saved browser tab can outlive its native page when the app restarts.
    if (saved.length === 1 && saved[0] === 'browser') {
      void window.pi.browserCurrent().then((browser) => {
        if (browserSelected.current || browser.url || browser.loading) return
        setTabs((current) => current === saved ? ['home'] : current)
      }).catch(() => {})
    }
  }, [state.boot])

  useEffect(() => {
    const opening = open && !wasOpen.current
    wasOpen.current = open
    if (!opening || fileTabs.length || tabs.some((id) => id !== 'home' && id !== 'files')) return
    if (!tabs.includes('home')) setTabs([...tabs, 'home'])
    setPreferredTab('home')
  }, [open, fileTabs.length, tabs])

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
      if (patch.workPanelTab) setPreferredTab(patch.workPanelTab)
      void actions.updateSettings(patch)
    },
    [actions]
  )

  const closeTab = (id: string): void => {
    if (id === 'browser') {
      if (!taskDoc) void window.pi.browserClose()
      setFollowTurn(null)
      setBrowserRequest(null)
    }
    if (id.startsWith('file:')) {
      const path = id.slice(5)
      setFileTabs((current) => current.filter((item) => item !== path))
      if (activeFile === path) setActiveFile(null)
      return
    }
    const remaining = tabs.filter((item) => item !== id)
    const nextTabs: TabId[] = remaining.length ? remaining : ['home']
    const next = id === builtinTab ? nextTabs[Math.max(0, tabs.indexOf(id as TabId) - 1)] : builtinTab
    if (!remaining.length && !activeFile && fileTabs.length) setActiveFile(fileTabs[fileTabs.length - 1])
    setTabs(nextTabs)
    update({ workPanelTabs: nextTabs, workPanelTab: next })
  }

  const openTab = (id: TabId): void => {
    if (id === 'browser') browserSelected.current = true
    const retained = id === 'home' ? tabs : tabs.filter(item => item !== 'home')
    const next = retained.includes(id) ? retained : [...retained, id]
    setTabs(next)
    setActiveFile(null)
    update({ workPanelTabs: next, workPanelTab: id })
  }

  const selectTab = (id: string): void => {
    if (id === 'browser') browserSelected.current = true
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
      update({ workPanelTabs: next, workPanelTab: 'changes' })
    }
    window.addEventListener('pi:review-request', onReview)
    return () => window.removeEventListener('pi:review-request', onReview)
  }, [tabs, actions, update])

  useEffect(() => {
    const onOpenBrowser = (event: Event): void => {
      const detail = (event as CustomEvent<{ url: string }>).detail
      if (!detail?.url) return
      browserSelected.current = true
      const next = tabs.includes('browser') ? tabs : [...tabs, 'browser' as const]
      setTabs(next)
      setActiveFile(null)
      setVisited((current) => new Set([...current, 'browser']))
      setBrowserRequest({ url: detail.url, nonce: Date.now() })
      actions.setWorkPanelOpen(true)
      const targetWidth = Math.max(width, 520)
      if (targetWidth !== width) {
        setWidth(targetWidth)
        void actions.updateSettings({ workPanelWidth: targetWidth })
      }
      update({ workPanelTabs: next, workPanelTab: 'browser' })
    }
    window.addEventListener('pi:open-browser', onOpenBrowser)
    return () => window.removeEventListener('pi:open-browser', onOpenBrowser)
  }, [tabs, actions, update, width])

  useEffect(() => {
    const revealBrowser = (doc?: string | Event): void => {
      browserSelected.current = true
      setFollowTurn(doc && doc === taskDoc ? turnKey : null)
      const next = tabs.includes('browser') ? tabs : [...tabs, 'browser' as const]
      setTabs(next)
      setActiveFile(null)
      setVisited((current) => new Set([...current, 'browser']))
      actions.setWorkPanelOpen(true)
      update({ workPanelTabs: next, workPanelTab: 'browser' })
    }
    const unsubscribe = window.pi.onBrowserReveal(revealBrowser)
    window.addEventListener('pi:reveal-browser', revealBrowser)
    return () => { unsubscribe(); window.removeEventListener('pi:reveal-browser', revealBrowser) }
  }, [actions, tabs, taskDoc, turnKey, update])

  useEffect(() => {
    const onToggleBrowser = (): void => {
      if (open && tab === 'browser') {
        actions.setWorkPanelOpen(false)
        return
      }
      browserSelected.current = true
      const next = tabs.includes('browser') ? tabs : [...tabs, 'browser' as const]
      setTabs(next)
      setActiveFile(null)
      setVisited((current) => new Set([...current, 'browser']))
      actions.setWorkPanelOpen(true)
      const targetWidth = Math.max(width, 520)
      if (targetWidth !== width) {
        setWidth(targetWidth)
        void actions.updateSettings({ workPanelWidth: targetWidth })
      }
      update({ workPanelTabs: next, workPanelTab: 'browser' })
    }
    window.addEventListener('pi:toggle-browser', onToggleBrowser)
    return () => window.removeEventListener('pi:toggle-browser', onToggleBrowser)
  }, [actions, open, tab, tabs, update, width])

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

  const browserActive =
    open &&
    tab === 'browser' &&
    !state.addProjectOpen &&
    !state.settingsOpen &&
    !state.skillsOpen &&
    !state.schedulesOpen &&
    !state.diagnosticsOpen

  useEffect(() => {
    let current = true
    if (browserActive && following && taskDoc) {
      void window.pi.revealBrowserPage(taskDoc, false).then(shown => {
        if (current) onExpandedDocument(shown ? taskDoc : null)
      }).catch(() => { if (current) onExpandedDocument(null) })
    } else onExpandedDocument(null)
    return () => { current = false }
  }, [browserActive, following, taskDoc, onExpandedDocument])
  useEffect(() => {
    if (!browserActive) return
    const pick = (event: Event) => {
      const doc = (event as CustomEvent<string>).detail
      if (!doc) return
      setFollowTurn(doc === taskDoc ? turnKey : null)
      void window.pi.revealBrowserPage(doc, false)
    }
    window.addEventListener('pi:preview-select', pick)
    return () => window.removeEventListener('pi:preview-select', pick)
  }, [browserActive, taskDoc, turnKey])

  return (
    <aside className={clsx('work-panel', !open && 'is-closed', maximized && 'is-maximized')} style={{ width: open ? width : 0 }} aria-hidden={!open}>
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
            const label = file ? baseName(file) : item!.id === 'browser' && browserTitle ? browserTitle : t(item!.label)
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
            <button className="work-tab-close" onClick={() => closeTab(id)} disabled={id === 'home' && tabs.length === 1}
              aria-label={state.settings.language === 'en' ? `Close ${label} tab` : `关闭${label}标签`}
              title={state.settings.language === 'en' ? `Close ${label} tab` : `关闭${label}标签`}>
              <X size={11} />
            </button>
            </div>
          })}
        </div>
        <div className="work-head-actions">
          <button className="work-icon" onClick={() => openTab('home')} aria-label={t('新标签页')} title={t('新标签页')}><Plus size={15}/></button>
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
        {tab === 'home' && <WorkHome key={state.workspace} openTab={openTab} openFile={openFile} />}
        {(visited.has('changes') || tab === 'changes') && <div className="work-tab-container" hidden={tab !== 'changes'}><ChangesTab /></div>}
        {(visited.has('files') || tab === 'files') && <div className="work-tab-container" hidden={tab !== 'files'}><FilesTab onOpenFile={openFile} /></div>}
        {(visited.has('terminal') || tab === 'terminal') && <div className="work-tab-container" hidden={tab !== 'terminal'}><TerminalTab /></div>}
        {(visited.has('artifacts') || tab === 'artifacts') && <div className="work-tab-container" hidden={tab !== 'artifacts'}><ArtifactsTab /></div>}
        {(visited.has('browser') || tab === 'browser') && (
          <div className="work-tab-container" hidden={tab !== 'browser'}>
            <BrowserTab
              active={browserActive}
              canFollow={!!taskDoc} following={following} onFollow={enabled => setFollowTurn(enabled ? turnKey : null)}
              request={browserRequest}
              onRequestConsumed={() => setBrowserRequest(null)}
              onTitle={setBrowserTitle}
              onClose={() => taskDoc ? actions.setWorkPanelOpen(false) : closeTab('browser')}
            />
          </div>
        )}
        {fileTabs.map((path) => <div key={path} className="work-tab-container" hidden={tab !== `file:${path}`}><FilePreview path={path} /></div>)}
      </div>
    </aside>
  )
}
