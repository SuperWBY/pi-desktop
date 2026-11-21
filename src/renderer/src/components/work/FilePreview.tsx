import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ExternalLink, FolderSearch, Pencil, Save, X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useApp } from '../../store'

export function FilePreview({ path, focus }: { path: string; focus?: { line?: number } | null }): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [result, setResult] = useState<{ text?: string; truncated?: boolean; error?: string } | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const target = useRef<HTMLElement>(null)

  useEffect(() => {
    if (editing) return
    let cancelled = false
    setResult(null)
    void window.pi.readText(path, 200_000).then((value) => {
      if (cancelled) return
      if (!value.ok || typeof value.content !== 'string') setResult({ error: value.error ?? t('无法预览这个文件') })
      else if (value.content.includes('\u0000')) setResult({ error: t('二进制文件不支持预览') })
      else {
        setResult({ text: value.content, truncated: value.truncated })
        setDraft(value.content)
      }
    }).catch((error: unknown) => {
      if (!cancelled) setResult({ error: error instanceof Error ? error.message : t('无法预览这个文件') })
    })
    return () => { cancelled = true }
  }, [path, t, focus, editing])

  useEffect(() => {
    const line = target.current
    const pane = line?.parentElement
    if (!line || !pane) return
    pane.scrollTop += line.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 3
  }, [focus, result?.text, editing])

  const dirty = editing && result?.text !== undefined && draft !== result.text

  const save = async (): Promise<void> => {
    if (saving || result?.text === undefined) return
    setSaving(true)
    try {
      const ok = await window.pi.writeTextFile(path, draft)
      if (!ok) {
        actions.notify('error', t('保存失败'), path)
        return
      }
      setResult({ ...result, text: draft })
      setEditing(false)
      actions.notify('success', t('已保存'), path.replace(`${state.workspace}/`, ''))
    } finally {
      setSaving(false)
    }
  }

  const cancel = (): void => {
    if (dirty && !window.confirm(t('放弃未保存的修改？'))) return
    setDraft(result?.text ?? '')
    setEditing(false)
  }

  const parts = focus?.line && result?.text?.split('\n')
  const targetIndex = (focus?.line ?? 0) - 1
  const showTarget = parts && targetIndex >= 0 && targetIndex < parts.length

  return (
    <div className="file-preview">
      <div className="file-preview-head">
        <span className="file-preview-path" title={path}>{path.replace(`${state.workspace}/`, '')}</span>
        <div className="file-preview-actions">
          {editing ? (
            <>
              <button className="work-icon" onClick={() => void save()} disabled={saving} aria-label={t('保存')} title={t('保存（⌘S）')}><Save size={12} /></button>
              <button className="work-icon" onClick={cancel} disabled={saving} aria-label={t('取消')} title={t('取消')}><X size={12} /></button>
            </>
          ) : (
            <button className="work-icon" onClick={() => setEditing(true)} disabled={!result?.text || result.truncated} aria-label={t('编辑')} title={result?.truncated ? t('文件过大，暂不支持编辑') : t('编辑')}><Pencil size={12} /></button>
          )}
          <button className="work-icon" onClick={() => void window.pi.openPath(path)} aria-label={t('打开')} title={t('打开')}><ExternalLink size={12} /></button>
          <button className="work-icon" onClick={() => window.pi.showItem(path)} aria-label={t('在 Finder 中显示')} title={t('在 Finder 中显示')}><FolderSearch size={12} /></button>
        </div>
      </div>
      {!result ? <div className="work-empty">{t('读取中…')}</div> : result.error ? <div className="work-empty">{result.error}</div> : editing ? (
        <textarea
          className="file-preview-editor"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault()
              void save()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
        />
      ) : (
        <pre className="file-preview-body">
          {showTarget ? (
            <>
              {targetIndex > 0 && parts.slice(0, targetIndex).join('\n') + '\n'}
              <mark className="file-preview-target" ref={target} data-line={focus?.line}>{parts[targetIndex] || ' '}</mark>
              {targetIndex + 1 < parts.length && '\n' + parts.slice(targetIndex + 1).join('\n')}
            </>
          ) : result.text}
        </pre>
      )}
      {result?.truncated && <div className="work-hint">{t('只显示前 200 KB，暂不支持编辑。')}</div>}
      {dirty && <div className="work-hint">{t('有未保存的修改 · ⌘S 保存 · Esc 取消')}</div>}
    </div>
  )
}
