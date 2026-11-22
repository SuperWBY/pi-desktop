import ReactMarkdown from 'react-markdown'
import { useMemo, useState } from 'react'
import remarkGfm from 'remark-gfm'
import type { PackageReadme } from '@shared/types'
import { useApp } from '../store'
import { hideInstallInstructions, readmeHeadings, readmeImageSources } from '../lib/package-readme'
import { useTranslation } from '../i18n'

function ReadmeImage({ sources, alt }: { sources: string[]; alt: string }): React.ReactNode {
  const t = useTranslation()
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!sources.length) return null
  return <span className="market-readme-image">
    {failed ? <span className="market-readme-image-error" role="status">{alt || t('图片暂时无法加载。')}<button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setAttempt(0); setLoaded(false); setFailed(false) }}>{t('重新加载图片')}</button></span>
      : <img src={sources[attempt]} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" data-loaded={loaded}
        onLoad={() => setLoaded(true)} onError={() => {
          setLoaded(false)
          if (attempt + 1 < sources.length) setAttempt(attempt + 1)
          else setFailed(true)
        }} />}
  </span>
}

function ReadmeLink({ href, children }: { href?: string; children?: React.ReactNode }): React.ReactNode {
  const { actions } = useApp()
  return <a href={href} onClick={(event) => {
    event.preventDefault()
    if (href?.startsWith('#')) {
      try { document.getElementById(`market-readme-${decodeURIComponent(href.slice(1))}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }) } catch { /* malformed upstream anchor */ }
    } else if (href) actions.openExternal(href)
  }}>{children}</a>
}

function ReadmeTable({ children }: { children?: React.ReactNode }): React.ReactNode {
  return <div className="table-wrap"><table>{children}</table></div>
}

export function PackageReadmeView({ readme, source }: { readme: PackageReadme; source?: string }): React.ReactNode {
  const { baseUrl, imageFallbackBaseUrl } = readme
  // Keep the image renderer stable when the surrounding app/translation updates.
  const Image = useMemo(() => function Image({ src, alt }: { src?: string; alt?: string }) {
    return src ? <ReadmeImage key={`${baseUrl}:${imageFallbackBaseUrl}:${src}`} sources={readmeImageSources(src, { baseUrl, imageFallbackBaseUrl })} alt={alt ?? ''} /> : null
  }, [baseUrl, imageFallbackBaseUrl])
  const resolve = (url: string): string => {
    if (url.startsWith('#')) return url
    try { const parsed = new URL(url, readme.baseUrl); return /^https?:$/.test(parsed.protocol) ? parsed.href : '' } catch { return '' }
  }
  return <div className="markdown market-readme"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm, [hideInstallInstructions, { headings: source ? readmeHeadings(source) : undefined }]]}
    urlTransform={(url, key) => key === 'src' ? url : resolve(url)} components={{
      a: ReadmeLink,
      img: Image,
      table: ReadmeTable
    }}>{readme.markdown}</ReactMarkdown></div>
}
