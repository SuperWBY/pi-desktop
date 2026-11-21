import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from '../i18n'
import { InlineImage } from './ImageLightbox'

const maxDiagramLength = 24_000
let nextDiagram = 0
let mermaidModule: Promise<typeof import('mermaid').default> | undefined

function loadMermaid() {
  return mermaidModule ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      htmlLabels: false,
      maxTextSize: maxDiagramLength,
      maxEdges: 250,
      theme: 'neutral'
    })
    return mermaid
  })
}

async function diagramSvg(source: string, type: 'mermaid' | 'svg'): Promise<string> {
  const markup = type === 'mermaid'
    ? (await (await loadMermaid()).render(`pi-diagram-${++nextDiagram}`, source)).svg
    : source
  const document = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = document.documentElement
  if (root.localName !== 'svg' || document.querySelector('parsererror')) throw new Error('Invalid SVG')
  if (!root.hasAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  // A percentage-only SVG has no intrinsic width in the shrink-to-fit image button.
  const [, , width, height] = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (width > 0 && height > 0) {
    if (!root.hasAttribute('width') || root.getAttribute('width')?.endsWith('%')) root.setAttribute('width', String(width))
    if (!root.hasAttribute('height') || root.getAttribute('height')?.endsWith('%')) root.setAttribute('height', String(height))
  }
  return new XMLSerializer().serializeToString(root)
}

export function DiagramPreview({ source, code, type }: { source: string; code: ReactNode; type: 'mermaid' | 'svg' }): ReactNode {
  const t = useTranslation()
  const [preview, setPreview] = useState<{ source: string; url: string | null } | null>(null)
  const result = preview?.source === source ? preview : null

  useEffect(() => {
    let live = true
    let url: string | undefined
    if (source.length > maxDiagramLength) return
    void diagramSvg(source, type).then((svg) => {
      // Not live means the cleanup already ran; returning here never creates
      // the blob, so there is nothing to revoke.
      if (!live) return
      url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      setPreview({ source, url })
    }).catch(() => { if (live) setPreview({ source, url: null }) })
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [source, type])

  if (source.length > maxDiagramLength || (result && !result.url)) return (
    <div className="diagram-fallback"><span>{t('图形预览不可用')}</span>{code}</div>
  )

  return (
    <div className="diagram-preview" data-diagram-type={type}>
      {result?.url ? <InlineImage src={result.url} alt={type === 'svg' ? 'SVG' : t('流程图')} /> : <span role="status">{t('正在渲染图形…')}</span>}
      <details>
        <summary>{t('查看源码')}</summary>
        {code}
      </details>
    </div>
  )
}
