import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { ChevronUp, Maximize2, Monitor, MousePointer2 } from 'lucide-react'
import { useApp } from '../store'
import { computerUseOutcome, toolImages, toolPhrases } from '../lib/tools'
import { useTranslation } from '../i18n'

type Frame = Awaited<ReturnType<typeof window.pi.browserPreview>>
type Page = { page?: string; sessionId?: string; documentId?: string; url?: string; title?: string; backend?: string; captureMode?: string; windowTitle?: string; app?: string; snapshotId?: string }

// Only the message content needs clearance; its native scroll container stays full-width.
function measurePreview(node: HTMLElement | null) {
  const region = node?.parentElement
  if (!node || !region) return
  const update = () => region.style.setProperty('--preview-card-width', node.offsetWidth + 'px')
  update()
  const observer = new ResizeObserver(update)
  observer.observe(node)
  return () => {
    observer.disconnect()
    region.style.removeProperty('--preview-card-width')
  }
}

function WebFrame({ doc, url, candidate, live, label, still = false, onSize }: { doc: string; url: string; candidate?: string; live: boolean; label: string; still?: boolean; onSize?: (ratio: number) => void }) {
  const [frame, setFrame] = useState<Frame>(null)
  useEffect(() => {
    if (!live) return
    let active = true
    let timer = 0
    const refresh = async () => {
      const next = await window.pi.browserPreview(doc, url, candidate).catch(() => null)
      if (!active) return
      setFrame(next)
      if (!still) timer = window.setTimeout(refresh, 800)
    }
    void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [doc, url, candidate, live, still])
  if (!frame) return <Monitor size={18} aria-label={label} />
  return <div className="cu-frame">
    <img src={frame.image} alt={label} draggable={false} onLoad={() => onSize?.(frame.width / frame.height)} />
    {frame.point && <span className="cu-pointer" style={{ left: frame.point.x * 100 + '%', top: frame.point.y * 100 + '%' }}><MousePointer2 size={14} fill="currentColor" />Pi</span>}
  </div>
}

export function ComputerPreview({expandedDocument}: {expandedDocument: string | null}) {
  const { state } = useApp()
  const t = useTranslation()
  const [toggle, setToggle] = useState<{ turn: number; live: boolean; open: boolean } | null>(null)
  const [selection, select] = useState<{ turn: number; key: string } | null>(null)
  const [ratios, setRatios] = useState<Record<string, number>>({})
  const [position, setPosition] = useState<{x: number; y: number} | null>(null)
  const drag = useRef<{id: number; x: number; y: number; dx: number; dy: number; moved: boolean} | null>(null)
  const recordSize = (id: string, ratio: number) => {
    if (Number.isFinite(ratio) && ratio > 0) setRatios(current => current[id] === ratio ? current : {...current, [id]: ratio})
  }
  const runs = Object.values(state.toolRuns).filter(r => r.startedAt >= state.turnStartedAt && r.name.startsWith('computer_use_'))
  const run = runs.at(-1)
  const open = toggle?.turn === state.turnStartedAt && toggle.live === state.streaming ? toggle.open : state.streaming
  const toggleOpen = () => setToggle({ turn: state.turnStartedAt, live: state.streaming, open: !open })
  const pages = new Map<string, Page>()
  let latest = ''
  let nativeImage = ''
  let closed = false
  for (const item of runs) {
    const d = item.resultDetails as Page | undefined
    if (item.name === 'computer_use_session_open' && item.status === 'done') { pages.clear(); latest = ''; closed = false }
    if (item.name === 'computer_use_session_close' && item.status === 'done') closed = true
    if (item.name === 'computer_use_session_observe' && d?.backend === 'inapp' && d.documentId && d.url) {
      latest = (d.sessionId ?? '') + '/' + (d.page ?? 'main')
      pages.set(latest, d)
    }
    if (item.name === 'computer_use_observe') {
      latest = 'desktop'
      pages.set(latest, d ?? {})
      const image = d?.captureMode === 'window' ? toolImages(item.resultContent)[0] : null
      nativeImage = image ? 'data:' + image.mimeType + ';base64,' + image.data : ''
    }
  }
  const key = selection?.turn === state.turnStartedAt && pages.has(selection.key) ? selection.key : latest
  const keys = [...pages.keys()]
  const index = keys.indexOf(key)
  if (!run || index < 0) return null
  const backKeys = [1, 2].slice(0, keys.length - 1).map(offset => keys[(index + offset) % keys.length])
  const selected = pages.get(key)
  if (expandedDocument && selected?.documentId === expandedDocument) return null
  const title = (d?: Page) => d?.title || d?.windowTitle || d?.app || d?.url || t('电脑操作预览')
  const choose = (k: string) => {
    select(k === latest ? null : {turn: state.turnStartedAt, key:k})
    const doc = pages.get(k)?.documentId
    if (doc) window.dispatchEvent(new CustomEvent('pi:preview-select', {detail: doc}))
  }
  const ratioId = selected?.documentId ?? selected?.snapshotId ?? key
  const style: CSSProperties = { '--cu-ratio': ratios[ratioId] ?? 1.5 } as CSSProperties
  if (position) Object.assign(style, {
    position: 'absolute', margin: 0, right: 'auto',
    left: `calc(36px + (100% - 48px) * ${position.x})`,
    top: `calc(12px + (100% - 24px) * ${position.y})`,
    transform: `translate(${-100 * position.x}%, ${-100 * position.y}%)`
  })
  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button') || !open) return
    const rect = event.currentTarget.getBoundingClientRect()
    drag.current = {id:event.pointerId, x:event.clientX, y:event.clientY, dx:event.clientX-rect.left, dy:event.clientY-rect.top, moved:false}
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || event.pointerId !== d.id) return
    if (!d.moved && Math.hypot(event.clientX - d.x, event.clientY - d.y) < 5) return
    d.moved = true
    const rect = event.currentTarget.getBoundingClientRect()
    const region = event.currentTarget.parentElement!.getBoundingClientRect()
    const clamp = (n: number) => Math.min(1, Math.max(0,n))
    setPosition({
      x: clamp((event.clientX-d.dx-region.left-36) / Math.max(1,region.width-rect.width-48)),
      y: clamp((event.clientY-d.dy-region.top-12) / Math.max(1,region.height-rect.height-24))
    })
  }
  const openPage = () => {
    if (selected?.documentId && !closed) void window.pi.revealBrowserPage(selected.documentId)
  }
  const step = (offset: number) => choose(keys[(index + offset + keys.length) % keys.length])
  const phrases = toolPhrases(run.name)
  const status = state.uiRequests.length && run.status === 'running' ? '等待你确认' : run.status === 'error' ? phrases.failed : computerUseOutcome(run.name, run.resultDetails) || (run.status === 'running' ? phrases.running : phrases.done)
  const pending = state.uiRequests.length > 0 && state.streaming
  return <section ref={measurePreview} className="cu-preview" style={style} data-moved={position ? 'true' : 'false'}
    onPointerDown={startDrag} onPointerMove={move} onPointerCancel={() => { drag.current = null }}
    onLostPointerCapture={() => { drag.current = null }} onPointerUp={e => {
      if (drag.current?.id !== e.pointerId) return
      if (!drag.current.moved) openPage()
      drag.current = null
    }} data-open={open} data-stack={Math.min(3,pages.size)} aria-label={t('电脑操作预览')}
    onKeyDown={e => {
      if (keys.length < 2 || !['ArrowLeft','ArrowRight'].includes(e.key)) return
      e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1)
    }}>
    {open && backKeys.map((k, i) => {
      const page = pages.get(k)!
      return <button key={k} className="cu-back-page" style={{ left: -16 * (i+1), top: -5 * (i+1), zIndex: -1-i }}
        aria-label={title(page)} title={title(page)} onClick={() => choose(k)}>
        {page.documentId && page.url && <WebFrame key={page.documentId + page.url} doc={page.documentId} url={page.url}
          live={!closed && state.streaming} label={title(page)} still />}
      </button>
    })}
    <button className="cu-summary" aria-expanded={open} onClick={toggleOpen} title={title(selected) + ' · ' + t(status)}>
      {open ? <ChevronUp size={13}/> : <Monitor size={16}/>}
    </button>
    <span className={'cu-status-dot' + (pending ? ' waiting' : '')} title={t(status)} role="status" aria-label={t(status)} />
    <div className="cu-surface" hidden={!open}>
      {keys.map(k => {
        const d = pages.get(k)!
        return <div className="cu-picture" key={k} hidden={k !== key}>
          {d.documentId && d.url ? <WebFrame key={d.documentId + d.url} doc={d.documentId} url={d.url}
            label={title(d)} onSize={ratio => recordSize(d.documentId!, ratio)} candidate={latest === k && run.name === 'computer_use_session_act' && run.status === 'running' ? String(run.args.candidateId ?? '') : undefined}
            live={open && k === key && state.streaming && !closed}/> : nativeImage && k === 'desktop' ? <img src={nativeImage} draggable={false} alt={title(d)} onLoad={e => recordSize(d.snapshotId ?? k, e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}/> : <Monitor size={18}/>}
        </div>
      })}
      <div className="cu-actions">
        {position && <button onClick={() => setPosition(null)} title={t('恢复右上角位置')} aria-label={t('恢复右上角位置')}>↗</button>}
        {selected?.documentId && !closed && <button title={t('查看网页')} aria-label={t('查看网页')} onClick={openPage}><Maximize2 size={13}/></button>}
      </div>
    </div>
  </section>
}
