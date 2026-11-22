import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Archive, X } from 'lucide-react'
import clsx from 'clsx'
import type { ContextCategoryId, SessionStats } from '@shared/types'
import { useApp } from '../store'
import { useTranslation } from '../i18n'
import { Spinner } from './ui'
import './context-usage.css'

function formatTokens(value: number | null): string {
  if (value === null) return '—'
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1000) return `${Number((value / 1000).toFixed(1))}K`
  return String(Math.round(value))
}

export function measureContextUsage(usage: SessionStats['contextUsage'] | undefined, modelCapacity?: number) {
  const windowSize = usage?.contextWindow ?? modelCapacity
  const capacity = typeof windowSize === 'number' && Number.isFinite(windowSize) && windowSize > 0 ? windowSize : null
  const used = typeof usage?.tokens === 'number' && Number.isFinite(usage.tokens) && usage.tokens >= 0 ? usage.tokens : null
  return { capacity, used, percent: capacity !== null && used !== null ? used / capacity * 100 : null }
}

const CATEGORIES: Array<{ id: ContextCategoryId; label: string }> = [
  { id: 'system', label: '系统提示词' }, { id: 'rules', label: '项目规则' },
  { id: 'tools', label: '工具定义' }, { id: 'mcp', label: 'MCP 与连接器' },
  { id: 'skills', label: '技能' }, { id: 'summary', label: '历史摘要' },
  { id: 'conversation', label: '对话消息' }, { id: 'toolResults', label: '工具调用与结果' },
  { id: 'other', label: '其他 / 未分类' }
]

export function ContextUsage(): ReactNode {
  const { state, actions } = useApp()
  const t = useTranslation()
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [present, setPresent] = useState(false)
  const [entered, setEntered] = useState(false)
  const [placement, setPlacement] = useState<{ style: CSSProperties; above: boolean }>({ style: {}, above: true })
  const [changingAuto, setChangingAuto] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const usage = state.status === 'ready' ? state.stats?.contextUsage : null
  const model = state.status === 'ready' ? state.piState?.model : undefined
  const { capacity, used, percent } = measureContextUsage(usage, model?.contextWindow)
  const known = used !== null && capacity !== null
  const shown = percent === null ? '—' : `${Math.round(percent)}%`
  const snapshot = usage?.breakdown
  const breakdown = snapshot && snapshot.modelKey === (model ? `${model.provider}/${model.id}` : null)
    && snapshot.sessionId === state.stats?.sessionId && snapshot.totalTokens === used && snapshot.contextWindow === capacity ? snapshot : null
  const rows = CATEGORIES.flatMap(({ id, label }) => {
    const tokens = breakdown?.categories.find((row) => row.id === id)?.tokens ?? 0
    return tokens > 0 ? [{ id, label, tokens }] : []
  })
  const busy = state.streaming || state.compacting || compacting || Boolean(state.retry) || state.uiRequests.length > 0 || state.status !== 'ready'
  const auto = state.piState?.autoCompactionEnabled
  const tip = known
    ? t('上下文 {percent}% · 已用 {used} / {total} tokens').replace('{percent}', (percent ?? 0).toFixed(1)).replace('{used}', formatTokens(used)).replace('{total}', formatTokens(capacity))
    : t('上下文用量暂不可用')

  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    setEntered(false)
    if (restoreFocus) root.current?.querySelector('button')?.focus()
  }, [])

  useLayoutEffect(() => {
    if (!present) return
    const place = (): void => {
      const trigger = root.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const composer = trigger.closest('.composer')?.getBoundingClientRect() ?? rect
      const width = Math.min(346, window.innerWidth - 24)
      const above = composer.top - 20
      const below = window.innerHeight - composer.bottom - 20
      const openAbove = above >= Math.min(360, below)
      const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12)
      setPlacement({ above: openAbove, style: {
        width, left, maxHeight: Math.max(0, Math.min(640, openAbove ? above : below)),
        ...(openAbove ? { bottom: window.innerHeight - composer.top + 8 } : { top: composer.bottom + 8 })
      } })
    }
    place()
    const observer = new ResizeObserver(place)
    const composer = root.current?.closest('.composer')
    if (composer) observer.observe(composer)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [present])

  useEffect(() => {
    if (open) {
      // Flush the pre-open style before entering, including when quickly reopening.
      const frame = requestAnimationFrame(() => {
        if (panel.current) void panel.current.offsetWidth
        setEntered(true)
        closeButton.current?.focus()
      })
      return () => cancelAnimationFrame(frame)
    }
    if (!present) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur')) || 150
    const timer = window.setTimeout(() => setPresent(false), reduced ? 0 : duration)
    return () => clearTimeout(timer)
  }, [open, present])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !panel.current?.contains(target)) close(false)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key, true)
    }
  }, [open, close])

  useEffect(() => { close(false) }, [state.sessionPath, state.workspace, close])

  useEffect(() => {
    if (!open || state.status !== 'ready') return
    void actions.refreshMeta()
    if (!state.streaming) return
    const timer = setInterval(() => { void actions.refreshMeta() }, 4000)
    return () => clearInterval(timer)
  }, [open, state.streaming, state.status, actions.refreshMeta])

  return (
    <div className="context-usage-root" ref={root}>
      <button type="button" className={clsx('context-ring', open && 'is-open', percent !== null && percent > 80 && 'is-warning')}
        title={tip} aria-label={`${t('查看上下文用量')} · ${known ? shown : t('暂不可用')}`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={present ? id : undefined}
        onClick={() => { if (open) close(); else { setPresent(true); setOpen(true) } }}>
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" className="ring-bg" />
          <circle cx="10" cy="10" r="7.5" className={clsx('ring-fg', percent !== null && percent > 80 && 'warning')}
            strokeDasharray={`${Math.max(0, Math.min(percent ?? 0, 100)) * 0.471} 47.1`} transform="rotate(-90 10 10)" />
        </svg>
        <span className="context-ring-pct">{shown}</span>
      </button>
      {present && createPortal(
        <div ref={panel} id={id} role="dialog" aria-labelledby={`${id}-title`} aria-hidden={!open}
          inert={!open} className={clsx('context-usage-panel t-dropdown', entered && open && 'is-open', !open && 'is-closing')}
          data-origin={placement.above ? 'bottom-right' : 'top-right'} style={placement.style}
          onWheel={(event) => event.stopPropagation()}>
          <div className="context-usage-heading">
            <h2 id={`${id}-title`}>{t('上下文用量')}</h2>
            <button ref={closeButton} className="icon-button" onClick={() => close()} aria-label={t('关闭上下文用量')}><X size={16} /></button>
          </div>
          <div className="context-usage-total">
            <strong>{percent === null ? '—' : `${percent.toFixed(1)}%`}</strong>
            <span>{known ? t('已用 {used} / {total} tokens').replace('{used}', formatTokens(used)).replace('{total}', formatTokens(capacity)) : t('等待用量更新')}</span>
          </div>
          <div className="context-usage-bar" role="progressbar" aria-label={t('上下文用量')}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent === null ? undefined : Number(Math.min(percent, 100).toFixed(1))} aria-valuetext={tip}>
            {known && (rows.length ? rows : [{ id: 'other', tokens: used }]).map((row) => (
              <span key={row.id} className={`context-segment context-color-${row.id}`} style={{ width: `${row.tokens / capacity * 100}%` }} />
            ))}
          </div>
          <div className="context-usage-content">
            {known && rows.length > 0 ? <ul className="context-usage-list">
              {rows.map((row) => <li key={row.id}>
                <span className={`context-usage-dot context-color-${row.id}`} />
                <span className="context-usage-label">{t(row.label)}</span>
                <span className="context-usage-tokens">{formatTokens(row.tokens)}</span>
                <span className="context-usage-percent">{row.tokens / capacity * 100 < 0.1 ? '<0.1' : (row.tokens / capacity * 100).toFixed(1)}%</span>
              </li>)}
            </ul> : <p className="context-usage-empty">{t(state.compacting || compacting ? '正在整理历史内容，完成后更新用量。' : known ? '分类明细暂不可用，总用量仍可参考。' : '新会话或压缩后，用量将在下一次模型响应后更新。')}</p>}
            {known && rows.length > 0 && <p className="context-usage-note">{t(breakdown?.calibrated ? '分类按内容估算，并按总用量校准。' : '分类按内容估算，统计差额计入未分类。')}</p>}
          </div>
          <div className="context-usage-footer">
            <div className="context-usage-model"><span>{model?.name ?? t('模型待确认')}</span><span>{capacity ? `${formatTokens(capacity)} ${t('上下文')}` : t('容量未知')}</span></div>
            <div className="context-usage-auto">
              <span>{t('自动压缩上下文')}</span>
              <button type="button" role="switch" aria-label={t('自动压缩上下文')} aria-checked={auto === true}
                className={clsx('context-auto-switch', auto && 'is-on')} disabled={busy || changingAuto || typeof auto !== 'boolean'}
                title={typeof auto !== 'boolean' ? t('状态待确认') : undefined}
                onClick={async () => { setChangingAuto(true); try { await actions.setAutoCompaction(!auto) } finally { setChangingAuto(false) } }}><span /></button>
            </div>
            <p className="context-usage-note">{t(typeof auto !== 'boolean' ? '自动压缩状态待确认。' : auto ? '接近上限时，将历史内容整理为摘要。' : '自动压缩已关闭，可手动整理历史内容。')}</p>
            <button type="button" className="context-compact-button" disabled={busy || used === null || used <= 0}
              title={state.streaming ? t('本轮结束后可压缩上下文') : undefined}
              onClick={async () => { setCompacting(true); try { await actions.compact() } finally { setCompacting(false) } }}>
              {state.compacting || compacting ? <Spinner size={14} /> : <Archive size={14} />}
              {t(state.compacting || compacting ? '正在压缩上下文…' : '压缩上下文')}
            </button>
          </div>
        </div>, document.body)}
    </div>
  )
}
