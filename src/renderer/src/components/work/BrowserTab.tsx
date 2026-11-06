import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  Lock,
  RotateCw,
  X
} from 'lucide-react'
import type { BrowserState } from '@shared/types'
import { useTranslation } from '../../i18n'
import { useApp } from '../../store'

const EMPTY: BrowserState = {
  open: false,
  url: '',
  title: '',
  favicon: null,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null
}

export interface BrowserRequest {
  url: string
  nonce: number
}

function normalizeAddress(input: string): string {
  const value = input.trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(value)) return `https://${value}`
  return value
}

export function BrowserTab({
  active,
  request,
  onRequestConsumed,
  onTitle
}: {
  active: boolean
  request: BrowserRequest | null
  onRequestConsumed: () => void
  onTitle?: (title: string) => void
}): ReactNode {
  const t = useTranslation()
  const { actions } = useApp()
  const [browser, setBrowser] = useState<BrowserState>(EMPTY)
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const lastDownload = useRef<string | null>(null)

  useEffect(() => window.pi.onBrowserState(setBrowser), [])

  useEffect(() => {
    if (!editing) setAddress(browser.url)
  }, [browser.url, editing])

  useEffect(() => {
    onTitle?.(browser.title || '')
  }, [browser.title, onTitle])

  useEffect(() => {
    if (!request || !active) return
    onRequestConsumed()
    void window.pi
      .browserOpen(request.url)
      .then(setBrowser)
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)))
  }, [request, active, onRequestConsumed])

  useEffect(() => {
    if (!browser.download) return
    const key = `${browser.download.filename}:${browser.download.state}`
    if (lastDownload.current === key) return
    lastDownload.current = key
    actions.notify(
      browser.download.state === 'completed' ? 'success' : 'error',
      browser.download.state === 'completed' ? t("下载完成") : t("下载未完成"),
      browser.download.filename
    )
  }, [actions, browser.download])

  const syncBounds = useCallback(() => {
    const surface = surfaceRef.current
    if (!surface || !active) {
      void window.pi.browserVisible(false)
      return
    }
    const rect = surface.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) {
      void window.pi.browserVisible(false)
      return
    }
    void window.pi.browserBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    void window.pi.browserVisible(true)
  }, [active])

  useEffect(() => {
    syncBounds()
    if (!active) return
    const surface = surfaceRef.current
    if (!surface) return
    let frame = 0
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(syncBounds)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(surface)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      void window.pi.browserVisible(false)
    }
  }, [active, syncBounds])

  useEffect(() => {
    if (!active || !browser.open) return
    syncBounds()
  }, [active, browser.open, browser.url, browser.error, syncBounds])

  const go = (): void => {
    const next = normalizeAddress(address)
    if (!next) return
    setEditing(false)
    setNotice(null)
    void window.pi
      .browserNavigate(next)
      .then(setBrowser)
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)))
  }

  const retry = (): void => {
    if (browser.url) void window.pi.browserNavigate(browser.url)
  }

  return (
    <div className="browser-tab" hidden={!active}>
      <div className="browser-toolbar">
        <button
          className="browser-icon"
          onClick={() => window.pi.browserBack()}
          disabled={!browser.canGoBack}
          aria-label={t("后退")}
          title={t("后退")}
        >
          <ArrowLeft size={15} />
        </button>
        <button
          className="browser-icon"
          onClick={() => window.pi.browserForward()}
          disabled={!browser.canGoForward}
          aria-label={t("前进")}
          title={t("前进")}
        >
          <ArrowRight size={15} />
        </button>
        <button
          className="browser-icon"
          onClick={() => (browser.loading ? window.pi.browserStop() : retry())}
          disabled={!browser.url}
          aria-label={browser.loading ? t("停止加载") : t("刷新")}
          title={browser.loading ? t("停止加载") : t("刷新")}
        >
          {browser.loading ? <X size={15} /> : <RotateCw size={14} />}
        </button>
        <div className={`browser-address ${browser.error ? 'has-error' : ''}`}>
          {browser.url.startsWith('https://') && !browser.error ? (
            <Lock size={12} />
          ) : (
            <Globe2 size={12} />
          )}
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => {
              setEditing(true)
              event.currentTarget.select()
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') go()
              if (event.key === 'Escape') {
                setAddress(browser.url)
                setEditing(false)
                event.currentTarget.blur()
              }
            }}
            placeholder={t("输入网址")}
            spellCheck={false}
            aria-label={t("网址")}
          />
          {browser.loading && <span className="browser-progress" />}
        </div>
        <button
          className="browser-icon"
          onClick={() => browser.url && actions.openExternal(browser.url)}
          disabled={!browser.url}
          aria-label={t("在系统浏览器中打开")}
          title={t("在系统浏览器中打开")}
        >
          <ExternalLink size={14} />
        </button>
        <button
          className="browser-icon"
          onClick={() => void window.pi.browserClose()}
          aria-label={t("关闭浏览器")}
          title={t("关闭浏览器")}
        >
          <X size={15} />
        </button>
      </div>
      {browser.error && (
        <div className="browser-error">
          <span>{browser.error}</span>
          <button onClick={retry}>{t("重试")}</button>
          <button onClick={() => browser.url && actions.openExternal(browser.url)}>{t("系统浏览器")}</button>
        </div>
      )}
      {notice && (
        <div className="browser-error">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)}>{t("关闭")}</button>
        </div>
      )}
      <div className="browser-surface" ref={surfaceRef}>
        {!browser.url && (
          <div className="browser-empty">
            <Globe2 size={26} />
            <strong>{t("应用内浏览器")}</strong>
            <span>{t("从对话中点击链接，或在上方输入网址。")}</span>
            <div className="browser-guide">
              <div className="browser-guide-title">{t("使用前请了解")}</div>
              <div className="browser-guide-item">
                <span className="browser-guide-index">1</span>
                <span>{t("在这个面板里登录目标网站，登录状态会保留。")}</span>
              </div>
              <div className="browser-guide-item">
                <span className="browser-guide-index">2</span>
                <span>{t("让 Pi 观察页面时，会读取页面 DOM，而不是猜截图坐标。")}</span>
              </div>
              <div className="browser-guide-item">
                <span className="browser-guide-index">3</span>
                <span>{t("密码框不会返回值；点击、提交和敏感操作仍需要你确认。")}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}