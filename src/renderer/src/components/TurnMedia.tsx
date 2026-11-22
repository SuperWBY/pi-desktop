import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ExternalLink, FileText, Film, Globe, Image, PanelTop, ZoomIn } from 'lucide-react'
import { useTranslation } from '../i18n'
import { openImage } from './ImageLightbox'
import type { TurnMediaItem } from '../lib/turn-media'
import { useApp } from '../store'
import { Popover } from './ui'
import { MediaActions } from './MediaActions'

interface MediaContext {
  workspace: string
  sessionPath: string | null
}

interface ResolvedMedia extends TurnMediaItem {
  url: string | null
  localPath?: string
}

export function TurnMedia({ items, workspace, sessionPath }: MediaContext & { items: TurnMediaItem[] }): ReactNode {
  const t = useTranslation()
  const [resolved, setResolved] = useState<ResolvedMedia[]>([])
  // A transcript can rerender on every streamed token. Keep the player
  // mounted until the result files or owning conversation actually change.
  const references = JSON.stringify(items)
  useEffect(() => {
    let live = true
    setResolved([])
    const requested = JSON.parse(references) as TurnMediaItem[]
    if (!requested.length) return
    void Promise.all(requested.map(async (item) => {
      if (item.remote) return { ...item, url: item.source }
      const preview = await window.pi.previewMedia({ path: item.source, workspace, sessionPath }).catch(() => null)
      return { ...item, url: preview?.url ?? null, localPath: preview?.path }
    })).then((next) => { if (live) setResolved(next) })
    return () => { live = false }
  }, [references, workspace, sessionPath])

  if (!resolved.length) return null
  const images = resolved.filter((item) => item.kind === 'image')
  const videos = resolved.filter((item) => item.kind === 'video')
  const files = resolved.filter((item) => item.kind === 'file')
  const pages = resolved.filter((item) => item.kind === 'html' || item.kind === 'website')
  return (
    <div className="turn-media">
      {images.length > 0 && <ImageResults key={images[0].key} images={images} />}
      {videos.map((video) => <VideoResult key={video.key} video={video} />)}
      {files.map((file) => <div className="turn-file-result" key={file.key}>
        <FileText size={17} aria-hidden="true" /><span title={file.name}>{file.name}</span>
        {file.url ? <MediaActions src={file.url} name={file.name} kind="file" /> : <small>{t('文件不可用。')}</small>}
      </div>)}
      {pages[0] && <PageResult key={pages[0].key} page={pages[0]} />}
      {pages.length > 1 && (
        <details className="turn-other-pages">
          <summary>{t('其他页面')} <span>{pages.length - 1}</span></summary>
          {pages.slice(1).map((page) => <PageResult key={page.key} page={page} />)}
        </details>
      )}
    </div>
  )
}

function PageResult({ page }: { page: ResolvedMedia }): ReactNode {
  const t = useTranslation()
  const { actions } = useApp()
  const [expanded, setExpanded] = useState(false)
  const [watchPreview, setWatchPreview] = useState(false)
  const [offline, setOffline] = useState(false)
  const { name, url, localPath } = page
  const website = page.kind === 'website'
  const address = website && url ? new URL(url) : null
  const localSite = !!address && ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)
  const subtitle = address?.host ?? t('本地网页')
  const openElsewhere = website && url
    ? () => actions.openExternal(url)
    : localPath ? () => void window.pi.openPath(localPath) : null

  useEffect(() => {
    if (!localSite) return
    return window.pi.onBrowserState((next) => {
      if (next.url === url) setOffline(Boolean(next.error?.includes('ERR_CONNECTION_REFUSED')))
    })
  }, [localSite, url])

  return (
    <section className="turn-html" aria-label={name}>
      <div className="turn-page-header">
        <span className="turn-card-icon">{website ? <Globe size={17} /> : <PanelTop size={17} />}</span>
        <div className="turn-card-text">
          <span title={name}>{name}</span>
          <small title={subtitle}>{!url ? t('页面预览不可用') : offline && watchPreview ? t('预览未运行') : subtitle}</small>
        </div>
        {url && <div className="turn-page-actions">
          <button type="button" className="button ghost small" aria-expanded={website ? undefined : expanded}
            onClick={() => {
              if (!website) { setExpanded(!expanded); return }
              if (localSite) setWatchPreview(true)
              actions.openBrowser(url)
            }}>
            {t(website ? '在右侧打开' : expanded ? '关闭预览' : '打开预览')}
          </button>
          {openElsewhere && <Popover align="right" width={182}
            trigger={(_open, toggle, aria) => (
              <button type="button" className="work-icon" title={t('打开方式')} aria-label={t('打开方式')} onClick={toggle} {...aria}><ChevronDown size={14} /></button>
            )}>
            {(close) => (
              <button type="button" className="menu-item" onClick={() => { close(); openElsewhere() }}>
                <ExternalLink size={14} />{t(website ? '在默认浏览器打开' : '用默认应用打开')}
              </button>
            )}
          </Popover>}
        </div>}
      </div>
      {!website && expanded && url && (
        <iframe title={name} src={url} className="turn-html-frame" sandbox="allow-scripts" allowFullScreen
          onLoad={(event) => event.currentTarget.focus()} />
      )}
    </section>
  )
}

function ImageResults({ images }: { images: ResolvedMedia[] }): ReactNode {
  const t = useTranslation()
  const available = images.filter((image) => image.url)
  const [selected, setSelected] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const active = available.find((image) => image.key === selected) ?? available[0]

  return (
    <>
      {active?.url && (
        <figure className="turn-image-gallery">
          <div className="turn-image-active">
            {failed === active.key ? (
              <div className="turn-media-unavailable"><Image size={18} />{t('图片预览不可用')}</div>
            ) : (
              <button type="button" className="turn-image-open" onClick={() => openImage(active.url!)} aria-label={`${t('放大图片')} · ${active.name}`}>
                <img src={active.url} alt={active.name} loading="lazy" onError={() => setFailed(active.key)} />
                <span className="turn-image-zoom"><ZoomIn size={16} /></span>
              </button>
            )}
            <figcaption className="turn-media-caption"><span title={active.name}>{active.name}</span><MediaActions src={active.url} name={active.name} kind="image" /></figcaption>
          </div>
          {available.length > 1 && (
            <div className="turn-image-thumbnails" aria-label={t('切换预览图片')}>
              {available.map((image) => (
                <button type="button" key={image.key} title={image.name} aria-label={image.name}
                  aria-pressed={image.key === active.key} onClick={() => setSelected(image.key)}>
                  <img src={image.url!} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </figure>
      )}
      {images.filter((image) => !image.url).map((image) => (
        <div className="turn-media-unavailable" key={image.key}><Image size={17} />{image.name} · {t('图片预览不可用')}</div>
      ))}
    </>
  )
}

function VideoResult({ video }: { video: ResolvedMedia }): ReactNode {
  const t = useTranslation()
  const [failed, setFailed] = useState(false)
  return (
    <figure className="turn-video">
      {video.url && !failed ? (
        <video controls playsInline preload={video.remote ? 'none' : 'metadata'} src={video.url}
          aria-label={video.name} onError={() => setFailed(true)} />
      ) : (
        <div className="turn-media-unavailable"><Film size={18} />{t('视频预览不可用')}</div>
      )}
      <figcaption className="turn-media-caption">
        <span title={video.name}>{video.name}</span>
        {video.url && <MediaActions src={video.url} name={video.name} kind="video" />}
        {video.remote ? (
          <button type="button" className="work-icon" title={t('在浏览器打开')}
            aria-label={t('在浏览器打开')} onClick={() => void window.pi.openExternal(video.source)}><ExternalLink size={14} /></button>
        ) : video.localPath && (
          <button type="button" className="work-icon" title={t('用默认应用打开')}
            aria-label={t('用默认应用打开')} onClick={() => void window.pi.openPath(video.localPath!)}><ExternalLink size={14} /></button>
        )}
      </figcaption>
    </figure>
  )
}
