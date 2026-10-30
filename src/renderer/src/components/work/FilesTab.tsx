import { useTranslation } from '../../i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import clsx from 'clsx'
import type { DirEntry } from '@shared/types'
import { useApp } from '../../store'
import { baseName } from '../../lib/format'

function formatSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function FilesTab({ onOpenFile }: { onOpenFile: (path: string) => void }): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const root = state.workspace ?? ''
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState('')

  const load = async (path: string): Promise<void> => {
    try {
      const entries = await window.pi.readDir(path)
      setChildren((current) => ({ ...current, [path]: entries }))
    } catch (err) {
      actions.notify('error', t('无法读取目录'), err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    setChildren({})
    setExpanded({})
    if (root) void load(root)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  const toggle = (entry: DirEntry): void => {
    if (!entry.isDir) {
      onOpenFile(entry.path)
      return
    }
    const next = !expanded[entry.path]
    setExpanded((current) => ({ ...current, [entry.path]: next }))
    if (next && !children[entry.path]) void load(entry.path)
  }

  const matches = (entry: DirEntry): boolean => {
    const query = filter.trim().toLowerCase()
    if (!query) return true
    // Keep folders navigable: their children are loaded only on expansion.
    return entry.isDir || entry.name.toLowerCase().includes(query)
  }

  const renderLevel = (path: string, depth: number): ReactNode => {
    const entries = (children[path] ?? []).filter(matches)
    return entries.map((entry) => (
      <div key={entry.path}>
        <button
          className="tree-row"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => toggle(entry)}
          title={entry.path}
        >
          {entry.isDir ? (
            <ChevronRight
              size={11}
              className={clsx('tree-chevron', expanded[entry.path] && 'open')}
            />
          ) : (
            <span className="tree-dot" />
          )}
          <span className={clsx('tree-name', entry.isDir && 'dir')}>{entry.name}</span>
          {!entry.isDir && <span className="tree-size">{formatSize(entry.size)}</span>}
        </button>
        {entry.isDir && expanded[entry.path] && renderLevel(entry.path, depth + 1)}
      </div>
    ))
  }

  if (!root) {
    return <div className="work-empty">{t('先打开一个项目。')}</div>
  }

  return (
    <div className="work-tab">
      <div className="work-toolbar">
        <div className="work-search">
          <Search size={12} />
          <input
            value={filter}
            placeholder={t('过滤文件名…')}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </div>

        <div className="work-tree">
          <button className="tree-row root" onClick={() => void load(root)}>
            <span className="tree-name dir">{baseName(root)}</span>
          </button>
          {renderLevel(root, 0)}
        </div>
    </div>
  )
}
