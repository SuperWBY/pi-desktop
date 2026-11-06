import {
  BrowserWindow,
  WebContentsView,
  shell,
  type WebContents
} from 'electron'
import type { BrowserState, BrowserBounds } from '@shared/types'

let host: BrowserWindow | null = null
let view: WebContentsView | null = null
let currentUrl = ''
let attached = false

function send(state: Partial<BrowserState>): void {
  if (!host || host.isDestroyed()) return
  host.webContents.send('browser:state', {
    ...getFallbackState(),
    ...state
  })
}

function getFallbackState(): BrowserState {
  return {
    open: Boolean(view),
    url: currentUrl,
    title: '',
    favicon: null,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null
  }
}

function isLocalhost(hostname: string): boolean {
  const value = hostname.toLowerCase()
  return value === 'localhost' || value.endsWith('.localhost') || value === '127.0.0.1' || value === '::1'
}

function isPrivateHost(hostname: string): boolean {
  if (isLocalhost(hostname)) return true
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return true
  if (/^169\.254\./.test(hostname)) return true
  return false
}

export function normalizeBrowserUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (isPrivateHost(url.hostname) && !isLocalhost(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

function assertSafe(url: string): string {
  const safe = normalizeBrowserUrl(url)
  if (!safe) throw new Error('Only public http(s) URLs are allowed in the browser panel.')
  return safe
}

function emitState(): void {
  if (!view) return
  const wc = view.webContents
  send({
    open: true,
    url: currentUrl || wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    error: null
  })
}

function wire(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    const safe = normalizeBrowserUrl(url)
    if (safe) void shell.openExternal(safe)
    return { action: 'deny' }
  })

  wc.on('will-navigate', (event, url) => {
    if (!normalizeBrowserUrl(url)) event.preventDefault()
  })

  wc.on('did-start-loading', () => send({ loading: true, error: null }))
  wc.on('did-stop-loading', () => emitState())
  wc.on('did-navigate', (_event, url) => {
    currentUrl = url
    emitState()
  })
  wc.on('did-navigate-in-page', (_event, url) => {
    currentUrl = url
    emitState()
  })
  wc.on('page-title-updated', (_event, title) => send({ title }))
  wc.on('page-favicon-updated', (_event, favicons) => send({ favicon: favicons[0] ?? null }))
  wc.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    send({ loading: false, error: `${description} (${code})`, url: validatedURL })
  })
  wc.on('render-process-gone', () => send({ loading: false, error: 'The page crashed.' }))
  wc.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  wc.session.setPermissionCheckHandler(() => false)
  wc.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ defaultPath: item.getFilename(), buttonLabel: 'Save' })
    item.once('done', (_doneEvent, state) => {
      send({ download: { filename: item.getFilename(), state } })
    })
  })
}

function createView(): WebContentsView {
  if (view) return view
  view = new WebContentsView({
    webPreferences: {
      partition: 'persist:pi-browser',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  wire(view.webContents)
  return view
}

export function initBrowser(window: BrowserWindow): void {
  host = window
}

export function browserOpen(input: string): BrowserState {
  if (!host || host.isDestroyed()) throw new Error('Browser host is unavailable.')
  const url = assertSafe(input)
  const next = createView()
  if (!attached) {
    host.contentView.addChildView(next)
    attached = true
  }
  next.setVisible(true)
  currentUrl = url
  void next.webContents.loadURL(url).catch((error: unknown) => {
    send({ loading: false, error: error instanceof Error ? error.message : String(error) })
  })
  emitState()
  return { ...getFallbackState(), open: true, url }
}

export function browserBounds(bounds: BrowserBounds): void {
  if (!view) return
  view.setBounds({
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  })
}

export function browserSetVisible(visible: boolean): void {
  if (!view) return
  view.setVisible(visible)
}

export function browserNavigate(input: string): BrowserState {
  if (!view) return browserOpen(input)
  const url = assertSafe(input)
  currentUrl = url
  void view.webContents.loadURL(url).catch((error: unknown) => {
    send({ loading: false, error: error instanceof Error ? error.message : String(error) })
  })
  return { ...getFallbackState(), open: true, url }
}

export function browserBack(): void {
  if (view?.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack()
}

export function browserForward(): void {
  if (view?.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward()
}

export function browserReload(): void {
  view?.webContents.reload()
}

export function browserStop(): void {
  view?.webContents.stop()
}

export function browserClose(): void {
  if (view && host && !host.isDestroyed() && attached) {
    host.contentView.removeChildView(view)
    attached = false
  }
  view?.webContents.close()
  view = null
  currentUrl = ''
  send({ open: false, url: '', title: '', favicon: null, loading: false, error: null })
}

const domObserveCode = `(() => {
  const selector = 'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]'
  const candidates = []
  for (const el of document.querySelectorAll(selector)) {
    if (!(el instanceof HTMLElement)) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue
    const type = (el.getAttribute('type') || '').toLowerCase()
    const secure = type === 'password' || el.getAttribute('autocomplete') === 'current-password'
    const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.value || el.getAttribute('name') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 160)
    const id = 'b' + (candidates.length + 1)
    el.setAttribute('data-pi-cua-id', id)
    candidates.push({
      id,
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      name,
      type,
      value: secure ? '' : String(el.value ?? '').slice(0, 160),
      secure,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
    if (candidates.length >= 120) break
  }
  return candidates
})()`

export function browserState(): Record<string, unknown> {
  if (!view) return { open: false, url: '', title: '' }
  const wc = view.webContents
  return { open: true, url: wc.getURL() || currentUrl, title: wc.getTitle(), loading: wc.isLoading() }
}

export async function browserDomObserve(): Promise<Array<Record<string, unknown>>> {
  if (!view) throw new Error('Open the in-app browser before observing a page.')
  const result = await view.webContents.executeJavaScript(domObserveCode, true)
  return Array.isArray(result) ? result as Array<Record<string, unknown>> : []
}

export async function browserDomAct(action: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!view) throw new Error('Open the in-app browser before acting on a page.')
  const candidateId = String(action.candidateId ?? '')
  if (!/^b\d+$/.test(candidateId)) throw new Error('candidateId must look like b1')
  const type = String(action.type ?? '')
  const selector = `[data-pi-cua-id="${candidateId}"]`
  const text = String(action.text ?? '')
  const key = String(action.key ?? 'Enter')
  let code = ''
  if (type === 'click') {
    code = `(() => { const el = document.querySelector('${selector}'); if (!el) throw new Error('candidate not found'); el.scrollIntoView({block:'center'}); el.click(); return { ok: true, title: document.title, url: location.href }; })()`
  } else if (type === 'type') {
    if (!text) throw new Error('type requires text')
    code = `(() => { const el = document.querySelector('${selector}'); if (!el) throw new Error('candidate not found'); if (el instanceof HTMLInputElement && el.type === 'password') throw new Error('secure field'); el.focus(); if (el.isContentEditable) el.textContent = ${JSON.stringify(text)}; else { const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; if (setter) setter.call(el, ${JSON.stringify(text)}); else el.value = ${JSON.stringify(text)}; } el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return { ok: true, value: el.value }; })()`
  } else if (type === 'press') {
    code = `(() => { const el = document.querySelector('${selector}'); if (!el) throw new Error('candidate not found'); el.focus(); const key = ${JSON.stringify(key)}; el.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles:true})); el.dispatchEvent(new KeyboardEvent('keyup', {key, bubbles:true})); if (key === 'Enter' && el.form) el.form.requestSubmit(); return { ok: true }; })()`
  } else {
    throw new Error(`Unknown browser action: ${type}`)
  }
  const result = await view.webContents.executeJavaScript(code, true)
  return result && typeof result === 'object' ? result as Record<string, unknown> : { ok: true }
}
