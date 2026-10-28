import { useTranslation } from '../../i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, ExternalLink, FolderSearch, Search } from 'lucide-react'
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

export function FilesTab(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const root = state.workspace ?? ''
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState('')
  const [preview, setPreview] = useState<{ path: string; text: string; truncated: boolean } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)

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
    setPreview(null)
    if (root) void load(root)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  const toggle = (entry: DirEntry): void => {
    if (!entry.isDir) {
      void openFile(entry.path)
      return
    }
    const next = !expanded[entry.path]
    setExpanded((current) => ({ ...current, [entry.path]: next }))
    if (next && !children[entry.path]) void load(entry.path)
  }

  const openFile = async (path: string): Promise<void> => {
    setError(null)
    const result = await window.pi.readText(path, 200_000)
    if (!result.ok || typeof result.content !== 'string') {
      setError(result.error ?? t('无法预览这个文件'))
      return
    }
    if (result.content.includes('\u0000')) {
      setError(t('二进制文件不支持预览'))
      return
    }
    setPreview({ path, text: result.content, truncated: Boolean(result.truncated) })
  }

  const matches = (entry: DirEntry): boolean => {
    const query = filter.trim().toLowerCase()
    if (!query) return true
    return entry.name.toLowerCase().includes(query)
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

      {preview ? (
        <div className="file-preview">
          <div className="file-preview-head">
            <button className="work-icon" onClick={() => setPreview(null)} title={t('返回')}>
              <ChevronRight size={13} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <span className="file-preview-path" title={preview.path}>
              {preview.path.replace(`${root}/`, '')}
            </span>
            <button className="work-icon" onClick={() => void window.pi.openPath(preview.path)}>
              <ExternalLink size={12} />
            </button>
            <button className="work-icon" onClick={() => window.pi.showItem(preview.path)}>
              <FolderSearch size={12} />
            </button>
          </div>
          <pre className="file-preview-body">{preview.text}</pre>
          {preview.truncated && <div className="work-hint">{t('只显示前 200 KB。')}</div>}
        </div>
      ) : (
        <div className="work-tree">
          <button className="tree-row root" onClick={() => void load(root)}>
            <span className="tree-name dir">{baseName(root)}</span>
          </button>
          {renderLevel(root, 0)}
          {error && <div className="work-empty small">{error}</div>}
        </div>
      )}
    </div>
  )
}
