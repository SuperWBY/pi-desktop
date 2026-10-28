import { useTranslation } from '../../i18n'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ExternalLink, FolderSearch, Image as ImageIcon, X } from 'lucide-react'
import clsx from 'clsx'
import type { AssistantMessage, ToolCallBlock, UserMessage } from '@shared/types'
import { useApp } from '../../store'
import { baseName } from '../../lib/format'
import { openImage } from '../ImageLightbox'

interface Artifact {
  key: string
  label: string
  kind: 'image' | 'html' | 'file'
  src?: string
  path?: string
}

const PREVIEW_EXT = new Set(['html', 'htm', 'svg', 'md'])

export function ArtifactsTab(): ReactNode {
  const t = useTranslation()
  const { state } = useApp()
  const [html, setHtml] = useState<{ path: string; text: string } | null>(null)

  const artifacts = useMemo(() => {
    const list: Artifact[] = []
    for (const message of state.messages) {
      if (message.role === 'user') {
        const content = (message as UserMessage).content
        if (Array.isArray(content)) {
          content.forEach((block, index) => {
            if (block.type === 'image') {
              list.push({
                key: `u-${index}-${(message as UserMessage).timestamp ?? index}`,
                label: t('附件图片'),
                kind: 'image',
                src: `data:${block.mimeType};base64,${block.data}`
              })
            }
          })
        }
      }
      if (message.role === 'assistant') {
        for (const block of (message as AssistantMessage).content ?? []) {
          if (block.type === 'image') {
            list.push({
              key: `a-${block.data.slice(0, 12)}`,
              label: t('生成的图片'),
              kind: 'image',
              src: `data:${block.mimeType};base64,${block.data}`
            })
          }
          if (block.type === 'toolCall') {
            const call = block as ToolCallBlock
            if (call.name !== 'write') continue
            const path = String((call.arguments as { path?: unknown })?.path ?? '')
            if (!path) continue
            const ext = path.split('.').pop()?.toLowerCase() ?? ''
            list.push({
              key: `w-${call.id}`,
              label: baseName(path),
              kind: PREVIEW_EXT.has(ext) ? 'html' : 'file',
              path
            })
          }
        }
      }
    }
    return list
  }, [state.messages, t])

  useEffect(() => {
    if (!html) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setHtml(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [html])

  const openHtml = async (path: string): Promise<void> => {
    const result = await window.pi.readText(path, 400_000)
    if (!result.ok || typeof result.content !== 'string') return
    setHtml({ path, text: result.content })
  }

  if (artifacts.length === 0) {
    return (
      <div className="work-empty">
        {t('这个会话还没有图片或写出的文件。')}
      </div>
    )
  }

  return (
    <div className="work-tab">
      <div className="artifact-grid">
        {artifacts.map((artifact) => (
          <div className="artifact-card" key={artifact.key}>
            {artifact.kind === 'image' && artifact.src ? (
              <button className="artifact-thumb" onClick={() => artifact.src && openImage(artifact.src)}>
                <img src={artifact.src} alt={artifact.label} />
              </button>
            ) : artifact.kind === 'html' && artifact.path ? (
              <button className="artifact-thumb code" onClick={() => void openHtml(artifact.path!)}>
                <span>{'</>'}</span>
              </button>
            ) : (
              <div className="artifact-thumb file">
                <ImageIcon size={16} />
              </div>
            )}
            <div className="artifact-meta">
              <span className="artifact-label" title={artifact.path ?? artifact.label}>
                {artifact.label}
              </span>
              {artifact.path && (
                <span className="artifact-actions">
                  <button
                    className="work-icon"
                    onClick={() => void window.pi.openPath(artifact.path!)}
                    title={t('用默认应用打开')}
                  >
                    <ExternalLink size={11} />
                  </button>
                  <button
                    className="work-icon"
                    onClick={() => window.pi.showItem(artifact.path!)}
                    title={t('在 Finder 中显示')}
                  >
                    <FolderSearch size={11} />
                  </button>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {html && (
        <div className="artifact-preview">
          <div className="artifact-preview-head">
            <span title={html.path}>{baseName(html.path)}</span>
            <button className="work-icon" onClick={() => setHtml(null)} aria-label={t('关闭')}>
              <X size={13} />
            </button>
          </div>
          <iframe
            title={html.path}
            sandbox="allow-scripts"
            srcDoc={html.text}
            className={clsx('artifact-frame')}
          />
        </div>
      )}
    </div>
  )
}
