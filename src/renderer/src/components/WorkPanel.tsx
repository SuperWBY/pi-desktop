import { useTranslation } from '../i18n'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { Files, FolderTree, Image, SquareTerminal, X } from 'lucide-react'
import clsx from 'clsx'
import { useApp } from '../store'
import { ChangesTab } from './work/ChangesTab'
import { FilesTab } from './work/FilesTab'
import { TerminalTab } from './work/TerminalTab'
import { ArtifactsTab } from './work/ArtifactsTab'

type TabId = 'changes' | 'files' | 'terminal' | 'artifacts'

const TABS: { id: TabId; label: string; icon: typeof Files }[] = [
  { id: 'changes', label: '变更', icon: Files },
  { id: 'files', label: '文件', icon: FolderTree },
  { id: 'terminal', label: '终端', icon: SquareTerminal },
  { id: 'artifacts', label: '产物', icon: Image }
]

const MIN_WIDTH = 280
const MAX_WIDTH = 620

export function WorkPanel(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const open = state.settings.workPanelOpen === true
  const width = state.settings.workPanelWidth ?? 360
  const tab = state.settings.workPanelTab ?? 'changes'
  const dragging = useRef(false)

  const update = useCallback(
    (patch: { workPanelOpen?: boolean; workPanelWidth?: number; workPanelTab?: TabId }) => {
      void actions.updateSettings(patch)
    },
    [actions]
  )

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      if (!dragging.current) return
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - event.clientX))
      void actions.updateSettings({ workPanelWidth: Math.round(next) })
    }
    const onUp = (): void => {
      dragging.current = false
      document.body.classList.remove('is-resizing')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [actions])

  if (!open) return null

  return (
    <aside className="work-panel" style={{ width }}>
      <div
        className="work-resize"
        onMouseDown={() => {
          dragging.current = true
          document.body.classList.add('is-resizing')
        }}
        role="separator"
        aria-orientation="vertical"
      />
      <header className="work-head">
        <div className="work-tabs" role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={clsx('work-tab-button', tab === id && 'active')}
              onClick={() => update({ workPanelTab: id })}
            >
              <Icon size={12} />
              {t(label)}
            </button>
          ))}
        </div>
        <button className="work-icon" onClick={() => update({ workPanelOpen: false })} aria-label={t('关闭')}>
          <X size={13} />
        </button>
      </header>

      <div className="work-body">
        {tab === 'changes' && <ChangesTab />}
        {tab === 'files' && <FilesTab />}
        {tab === 'terminal' && <TerminalTab />}
        {tab === 'artifacts' && <ArtifactsTab />}
      </div>
    </aside>
  )
}
