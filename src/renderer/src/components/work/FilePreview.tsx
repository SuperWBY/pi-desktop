import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, FolderSearch } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useApp } from '../../store'

export function FilePreview({ path }: { path: string }): ReactNode {
  const t = useTranslation()
  const { state } = useApp()
  const [result, setResult] = useState<{ text?: string; truncated?: boolean; error?: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    void window.pi.readText(path, 200_000).then((value) => {
      if (cancelled) return
      if (!value.ok || typeof value.content !== 'string') setResult({ error: value.error ?? t('无法预览这个文件') })
      else if (value.content.includes('\u0000')) setResult({ error: t('二进制文件不支持预览') })
      else setResult({ text: value.content, truncated: value.truncated })
    }).catch((error: unknown) => {
      if (!cancelled) setResult({ error: error instanceof Error ? error.message : t('无法预览这个文件') })
    })
    return () => { cancelled = true }
  }, [path, t])

  return (
    <div className="file-preview">
      <div className="file-preview-head">
        <span className="file-preview-path" title={path}>{path.replace(`${state.workspace}/`, '')}</span>
        <button className="work-icon" onClick={() => void window.pi.openPath(path)} aria-label={t('打开')} title={t('打开')}><ExternalLink size={12} /></button>
        <button className="work-icon" onClick={() => window.pi.showItem(path)} aria-label={t('在 Finder 中显示')} title={t('在 Finder 中显示')}><FolderSearch size={12} /></button>
      </div>
      {!result ? <div className="work-empty">{t('读取中…')}</div> : result.error ? <div className="work-empty">{result.error}</div> : <pre className="file-preview-body">{result.text}</pre>}
      {result?.truncated && <div className="work-hint">{t('只显示前 200 KB。')}</div>}
    </div>
  )
}
