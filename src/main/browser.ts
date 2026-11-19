import {
  BrowserWindow,
  WebContentsView,
  shell,
  type DownloadItem,
  type Event,
  type WebContents
} from 'electron'
import { randomUUID } from 'node:crypto'
import type { BrowserState, BrowserBounds } from '@shared/types'
import { browserChallengeCode } from '../../extensions/computer-use/src/browser-challenge'
import { browserTargetGuardCode } from '../../extensions/computer-use/src/browser-target'
import { browserPageTextCode } from '../../extensions/computer-use/src/browser-page-text'
import { browserFileSnapshotCode, browserFileHashCode } from '../../extensions/computer-use/src/browser-file-context'

let host: BrowserWindow | null = null
const downloadEpoch = randomUUID()
let downloadSequence = 0
const downloads: Array<{ id: string; sequence: number; filename: string; state: 'in_progress' | 'completed' | 'cancelled' | 'interrupted'; bytes?: number; path?: string }> = []

export function browserDownloads(after = 0): { epoch: string; cursor: number; truncated: boolean; downloads: typeof downloads } {
  const first = downloads[0]?.sequence ?? downloadSequence + 1
  return { epoch: downloadEpoch, cursor: downloadSequence, truncated: after < first - 1, downloads: downloads.filter((item) => item.sequence > after).map((item) => ({ ...item })) }
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

export function initBrowser(window: BrowserWindow): void {
  host = window
}

let displayedKey = 'main'
let panelVisible = false
let panelBounds: BrowserBounds | undefined

export function setPanelBounds(bounds: BrowserBounds) {
  panelBounds = bounds
  panelPage().browserBounds(bounds)
}

export function setPanelVisible(visible: boolean) {
  panelVisible = visible
  panelPage().browserSetVisible(visible)
}

function selectPanel(key: string) {
  if (key === displayedKey) return
  panelPage().browserSetVisible(false)
  const previous = displayedKey
  displayedKey = key
  if (previous === '@retained') { pages.get(previous)?.browserClose(); pages.delete(previous) }
  if (panelBounds) panelPage().browserBounds(panelBounds)
  panelPage().browserSetVisible(panelVisible)
  panelPage().publishState()
}
let popupSequence = 0
const pages = new Map<string, ReturnType<typeof createPage>>()

export function taskPage(key = 'main') {
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(key)) throw new Error('Invalid page name.')
  let page = pages.get(key)
  if (!page) {
    if (key !== 'main' && [...pages.keys()].filter(name => name !== 'main' && !name.startsWith('@')).length >= 7) throw new Error('Page limit reached. Reuse an open page.')
    page = createPage(key)
    pages.set(key, page)
  }
  return page
}

export function panelPage(separate = false) {
  if (separate && displayedKey !== '@user') {
    if (!pages.has('@user')) pages.set('@user', createPage('@user'))
    selectPanel('@user')
  }
  return pages.get(displayedKey) ?? taskPage(displayedKey)
}

function pageForDocument(doc: string) {
  return Array.from(pages.entries()).find(([, page]) => page.ownsDocument(doc))
}

export function revealPage(doc: string, openPanel = true) {
  const entry = pageForDocument(doc)
  if (!entry) return false
  selectPanel(entry[0])
  if (openPanel) host?.webContents.send('browser:reveal', doc)
  return true
}

export function releaseTaskPages() {
  if (!displayedKey.startsWith('@') && (displayedKey !== 'main' || (panelVisible && panelPage().hasTaskViewport()))) {
    if (panelVisible) {
      const retained = panelPage()
      pages.delete(displayedKey)
      displayedKey = '@retained'
      retained.setKey(displayedKey)
      pages.set(displayedKey, retained)
    } else selectPanel('main')
  }
  pages.get('main')?.resetTaskViewport()
  for (const [key, page] of pages) {
    if (key !== 'main' && !key.startsWith('@')) { page.browserClose(); pages.delete(key) }
  }
}

export function browserState() { return panelPage().browserState() }
export function browserPreview(doc: string, url: string, candidate?: string) {
  return pageForDocument(doc)?.[1].browserPreview(doc, url, candidate) ?? null
}

function createPage(key: string) {
  let view: WebContentsView | null = null
  let currentUrl = ''
  let actionInFlight = false
  const popups = new Set<string>()
  let documentIdentity = randomUUID()
  let lastActionPoint: { doc: string; url: string; at: number; x: number; y: number } | null = null
  let requestedSize: { width: number; height: number } | undefined
  let rendererReady = false
  let emulationScale: string | undefined
  let attached = false

  function setTaskViewport(width: unknown, height: unknown) {
    if (typeof width !== 'number' || typeof height !== 'number' || ![width, height].every(n => Number.isInteger(n) && n >= 240 && n <= 2560)) throw new Error('Invalid viewport dimensions.')
    requestedSize = { width, height }
    layoutTaskView()
  }

  function layoutTaskView() {
    if (!view || !requestedSize) return
    const panel = key === displayedKey && panelVisible ? panelBounds : undefined
    const scale = panel ? Math.min(1, panel.width / requestedSize.width, panel.height / requestedSize.height) : 1
    const width = Math.max(1, Math.round(requestedSize.width * scale))
    const height = Math.max(1, Math.round(requestedSize.height * scale))
    view.setBounds({ x: panel ? Math.round(panel.x + (panel.width - width) / 2) : 0, y: panel ? Math.round(panel.y) : 0, width, height })
    const signature = [requestedSize.width, requestedSize.height, scale].join('/')
    if (rendererReady && signature !== emulationScale) {
      view.webContents.enableDeviceEmulation({ screenPosition: 'desktop',
        viewPosition: { x: 0, y: 0 }, screenSize: requestedSize, viewSize: requestedSize, deviceScaleFactor: 1, scale })
      emulationScale = signature
    }
  }

  function resetTaskViewport() {
    if (!requestedSize) return
    requestedSize = undefined
    emulationScale = undefined
    if (!view) return
    if (rendererReady) view.webContents.disableDeviceEmulation()
    if (key === displayedKey && panelVisible && panelBounds) browserBounds(panelBounds)
    else view.setBounds({ x: 0, y: 0, width: 1024, height: 768 })
  }
  let detachDownload: (() => void) | null = null

  function send(state: Partial<BrowserState>): void {
    if (!host || host.isDestroyed() || key !== displayedKey) return
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
      if (view?.webContents !== wc) return { action: 'deny' }
      const safe = normalizeBrowserUrl(url)
      if (safe && (actionInFlight || key !== 'main')) {
        const name = 'popup-' + (++popupSequence)
        if ([...pages.keys()].filter(name => !name.startsWith('@')).length < 8) {
          taskPage(name).browserOpen(safe, true)
          popups.add(name)
        }
      } else if (safe) void shell.openExternal(safe)
      return { action: 'deny' }
    })

    wc.on('will-navigate', (event, url) => {
      if (!normalizeBrowserUrl(url)) event.preventDefault()
    })

    wc.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace && view?.webContents === wc) documentIdentity = randomUUID()
    })
    wc.on('dom-ready', () => { rendererReady = true; emulationScale = undefined; layoutTaskView() })
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
    wc.on('render-process-gone', () => { if (view?.webContents === wc) { rendererReady = false; emulationScale = undefined; documentIdentity = randomUUID() } send({ loading: false, error: 'The page crashed.' }) })
    wc.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    wc.session.setPermissionCheckHandler(() => false)
    const onDownload = (_event: Event, item: DownloadItem, source: WebContents): void => {
      if (source !== wc) return
      const id = randomUUID()
      const record: (typeof downloads)[number] = { id, sequence: ++downloadSequence, filename: item.getFilename(), state: 'in_progress' }
      downloads.push(record)
      if (downloads.length > 100) downloads.shift()
      item.setSaveDialogOptions({ defaultPath: item.getFilename(), buttonLabel: 'Save' })
      item.once('done', (_doneEvent, state) => {
        record.state = state
        if (state === 'completed') {
          record.bytes = item.getReceivedBytes()
          const path = item.getSavePath()
          if (path) record.path = path
        }
        send({ download: { id, filename: item.getFilename(), state } })
      })
    }
    const browserSession = wc.session
    browserSession.on('will-download', onDownload)
    const detach = (): void => { browserSession.removeListener('will-download', onDownload) }
    detachDownload = detach
    wc.once('destroyed', detach)
  }

  function createView(): WebContentsView {
    if (view) return view
    documentIdentity = randomUUID()
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

  function browserOpen(input: string, background = false): BrowserState {
    if (!host || host.isDestroyed()) throw new Error('Browser host is unavailable.')
    const url = assertSafe(input)
    const next = createView()
    if (!attached) {
      host.contentView.addChildView(next)
      attached = true
    }
    if (requestedSize) layoutTaskView()
    else if (background) next.setBounds({ x: 0, y: 0, width: 1024, height: 768 })
    next.setVisible(!background || (key === displayedKey && panelVisible))
    currentUrl = url
    void next.webContents.loadURL(url).catch((error: unknown) => {
      send({ loading: false, error: error instanceof Error ? error.message : String(error) })
    })
    emitState()
    return { ...getFallbackState(), open: true, url }
  }

  function browserBounds(bounds: BrowserBounds): void {
    if (!view) return
    if (requestedSize) { layoutTaskView(); return }
    view.setBounds({
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height))
    })
  }

  function browserSetVisible(visible: boolean): void {
    if (!view) return
    layoutTaskView()
    view.setVisible(visible)
  }

  function browserNavigate(input: string, background = false): BrowserState {
    if (!view) return browserOpen(input, background)
    const url = assertSafe(input)
    currentUrl = url
    void view.webContents.loadURL(url).catch((error: unknown) => {
      send({ loading: false, error: error instanceof Error ? error.message : String(error) })
    })
    return { ...getFallbackState(), open: true, url }
  }

  function browserBack(): void {
    if (view?.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack()
  }

  function browserForward(): void {
    if (view?.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward()
  }

  function browserReload(): void {
    view?.webContents.reload()
  }

  function browserStop(): void {
    view?.webContents.stop()
  }

  function browserClose(): void {
    detachDownload?.()
    detachDownload = null
    if (view && host && !host.isDestroyed() && attached) {
      host.contentView.removeChildView(view)
      attached = false
    }
    view?.webContents.close()
    view = null
    rendererReady = false
    requestedSize = undefined
    emulationScale = undefined
    currentUrl = ''
    send({ open: false, url: '', title: '', favicon: null, loading: false, error: null })
  }

  const domObserveCode = `(() => {
    const selector = 'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]'
    const candidates = []
    const targets = new Map()
    ;${browserFileSnapshotCode};
    for (const el of document.querySelectorAll(selector)) {
      if (!(el instanceof HTMLElement)) continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue
      const type = (el.getAttribute('type') || '').toLowerCase()
      const secure = type === 'password' || (el.getAttribute('autocomplete') || '').toLowerCase().split(/\\s+/).some(token => ['current-password', 'new-password', 'one-time-code'].includes(token))
      const name = (el.getAttribute('aria-label') || Array.from(el.labels || [], label => { const copy = label.cloneNode(true); copy.querySelectorAll('input,textarea,select,button').forEach(node => node.remove()); return copy.textContent || '' }).join(' ').trim() || el.getAttribute('placeholder') || (!secure && el.innerText) || (!secure && type !== 'file' && el.value) || el.getAttribute('name') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 160)
      const id = 'b' + (candidates.length + 1)
      el.setAttribute('data-pi-cua-id', id)
      candidates.push({
        id,
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        name,
        type,
        value: secure || type === 'file' ? '' : String(el.value ?? '').slice(0, 160),
        ...(type === 'file' && !secure ? { files: Array.from(el.files || []).slice(0, 20).map(file => ({ name: file.name.slice(0, 256), size: file.size, type: file.type.slice(0, 128) })), fileCount: el.files?.length || 0, filesTruncated: (el.files?.length || 0) > 20 } : {}),
        secure,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      })
      const destination = JSON.stringify([el.getAttribute('href'), el.href || '', el.getAttribute('target'), el.getAttribute('formaction'), el.getAttribute('formmethod'), el.getAttribute('formtarget'), el.form?.action || '', el.form?.method || '', el.form?.target || ''])
      targets.set(id, { element: el, name, role: el.getAttribute('role') || el.tagName.toLowerCase(), type, secure, destination })
      if (candidates.length >= 120) break
    }
    globalThis.__piInappTargets = targets
    return candidates
  })()`

  function browserState(): Record<string, unknown> {
    if (!view) return { open: false, url: '', title: '' }
    const wc = view.webContents
    return { open: true, url: wc.getURL() || currentUrl, title: wc.getTitle(), loading: wc.isLoading() }
  }

  // Only capture the document identified by this task's observation.
  async function browserPreview(documentId: string, url: string, candidateId?: string) {
    const page = view?.webContents
    const matches = () => page && page === view?.webContents && !page.isDestroyed() && documentId === documentIdentity && page.getURL() === url
    if (!page || !matches()) return null
    const point = candidateId && /^b\d+$/.test(candidateId) ? await page.executeJavaScript(`(() => {
      const el = globalThis.__piInappTargets?.get(${JSON.stringify(candidateId)})?.element
      if (!el?.isConnected) return null
      const rect = el.getBoundingClientRect()
      const x = (rect.left + rect.width / 2) / innerWidth, y = (rect.top + rect.height / 2) / innerHeight
      return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null
    })()`) : null
    if (!matches()) return null
    const recent = lastActionPoint
    const latestPoint = recent && recent.doc === documentId && recent.url === url && Date.now() - recent.at < 1800 ? { x: recent.x, y: recent.y } : null
    const frame = await page.capturePage(undefined, { stayHidden: true })
    if (!matches() || frame.isEmpty()) return null
    const { width, height } = frame.getSize()
    const thumb = frame.resize(height > width ? { height: 600 } : { width: 480 })
    return { width, height, image: 'data:image/jpeg;base64,' + thumb.toJPEG(72).toString('base64'), point: point ?? latestPoint, at: Date.now() }
  }

  async function browserDomObserve(snapshotId?: string): Promise<{ candidates: Array<Record<string, unknown>>; requiresHuman: boolean; documentId: string; viewport: { width: number; height: number } }> {
    if (!view) throw new Error('Open the in-app browser before observing a page.')
    const currentView = view
    const documentId = documentIdentity
    const code = `(() => { ${snapshotId ? `document.documentElement.setAttribute('data-pi-session-snapshot', ${JSON.stringify(snapshotId)});` : ''} return { viewport: { width: innerWidth, height: innerHeight }, candidates: ${domObserveCode}, requiresHuman: ${browserChallengeCode} }; })()`
    const result = await currentView.webContents.executeJavaScript(code, true)
    if (view !== currentView || documentIdentity !== documentId) throw new Error('Browser document changed during observation; observe again.')
    if (!result || !Array.isArray(result.candidates)) throw new Error('Invalid browser observation.')
    return { viewport: result.viewport, candidates: result.candidates, requiresHuman: result.requiresHuman === true, documentId }
  }

  async function browserDomReadText(snapshotId: string, expectedUrl: string): Promise<{ text: string; truncated: boolean; requiresHuman?: boolean }> {
    if (!view) throw new Error('Open the in-app browser before reading a page.')
    if (!snapshotId || !expectedUrl) throw new Error('Observe the page before reading it.')
    const code = `(() => { if (location.href !== ${JSON.stringify(expectedUrl)} || document.documentElement.getAttribute('data-pi-session-snapshot') !== ${JSON.stringify(snapshotId)}) return { error: 'Browser page changed; observe again.' }; if (${browserChallengeCode}) return { text: '', truncated: false, requiresHuman: true }; return ${browserPageTextCode}; })()`
    const result = await view.webContents.executeJavaScript(code, true)
    if (result?.error) throw new Error(String(result.error))
    return result
  }

  async function browserDomCheckFile(snapshotId: string, expectedUrl: string, expectedDocumentId: string, candidateId: string): Promise<void> {
    if (!view || !snapshotId || !expectedUrl || !expectedDocumentId || !/^b\d+$/.test(candidateId)) throw new Error('Inspect the selected file again.')
    const currentView = view
    if (documentIdentity !== expectedDocumentId) throw new Error('Browser document changed; inspect the selected file again.')
    const selector = `[data-pi-cua-id="${candidateId}"]`
    const code = `(() => { if (location.href !== ${JSON.stringify(expectedUrl)} || document.documentElement.getAttribute('data-pi-session-snapshot') !== ${JSON.stringify(snapshotId)} || ${browserChallengeCode}) return false; return (${browserTargetGuardCode})(${JSON.stringify(candidateId)}, ${JSON.stringify(selector)}, '__piInappTargets', true); })()`
    const valid = await currentView.webContents.executeJavaScript(code, true)
    if (view !== currentView || documentIdentity !== expectedDocumentId || valid !== true) throw new Error('Selected file or page changed; inspect and confirm again.')
  }

  async function browserDomHashFile(snapshotId: string, expectedUrl: string, expectedDocumentId: string, candidateId: string): Promise<{ sha256: string; size: number }> {
    if (!view || !snapshotId || !expectedUrl || !expectedDocumentId || !/^b\d+$/.test(candidateId)) throw new Error('Observe the selected file again.')
    const currentView = view
    if (documentIdentity !== expectedDocumentId) throw new Error('Browser document changed; observe again.')
    const code = `(${browserFileHashCode})(${JSON.stringify(candidateId)}, ${JSON.stringify(snapshotId)}, ${JSON.stringify(expectedUrl)}, '__piInappTargets', 'data-pi-session-snapshot')`
    const result = await currentView.webContents.executeJavaScript(code, true)
    if (view !== currentView || documentIdentity !== expectedDocumentId) throw new Error('Browser document changed during content verification.')
    return result
  }

  async function browserDomAct(action: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!view) throw new Error('Open the in-app browser before acting on a page.')
    if (typeof action.snapshotId !== 'string' || !action.snapshotId || typeof action.expectedUrl !== 'string' || !action.expectedUrl) throw new Error('Observe the browser with a unified session before acting.')
    const candidateId = String(action.candidateId ?? '')
    if (!/^b\d+$/.test(candidateId)) throw new Error('candidateId must look like b1')
    const type = String(action.type ?? '')
    const selector = `[data-pi-cua-id="${candidateId}"]`
    const text = String(action.text ?? '')
    const key = String(action.key ?? 'Enter')
    if (type === 'click' && typeof action.snapshotId === 'string' && typeof action.expectedUrl === 'string') {
      const currentView = view
      const fileTarget = await currentView.webContents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el instanceof HTMLInputElement && el.type.toLowerCase() === 'file'; })()`)
      if (fileTarget) {
        const isReady = (): boolean => {
          if (view !== currentView || !host || host.isDestroyed() || currentView.webContents.isDestroyed()) return false
          const bounds = currentView.getBounds()
          return currentView.getVisible() && bounds.width > 1 && bounds.height > 1
        }
        if (!isReady()) {
          revealPage(documentIdentity)
          const deadline = Date.now() + 4_000
          while (!isReady() && Date.now() < deadline && view === currentView && host && !host.isDestroyed()) {
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
        }
        if (!isReady()) return { __piGuardRejected: 'view_hidden' }
      }
    }
    let code = ''
    if (type === 'click') {
      code = `(() => { const el = document.querySelector('${selector}'); if (!el) throw new Error('candidate not found'); el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); const piPoint = { x:(r.left+r.width/2)/innerWidth, y:(r.top+r.height/2)/innerHeight }; el.click(); return { ok: true, piPoint, title: document.title, url: location.href }; })()`
    } else if (type === 'type') {
      if (!text) throw new Error('type requires text')
      code = `(() => { const el = document.querySelector('${selector}'); if (!el) throw new Error('candidate not found'); if ((el.getAttribute('type') || '').toLowerCase() === 'password' || (el.getAttribute('autocomplete') || '').toLowerCase().split(/\\s+/).some(token => ['current-password', 'new-password', 'one-time-code'].includes(token))) throw new Error('secure field'); el.focus(); if (el.isContentEditable) el.textContent = ${JSON.stringify(text)}; else { const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; if (setter) setter.call(el, ${JSON.stringify(text)}); else el.value = ${JSON.stringify(text)}; } el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return { ok: true, value: el.value }; })()`
    } else if (type === 'press') {
      code = `(() => { const el = document.querySelector('${selector}'); if (!el) throw new Error('candidate not found'); el.focus(); const key = ${JSON.stringify(key)}; el.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles:true})); el.dispatchEvent(new KeyboardEvent('keyup', {key, bubbles:true})); if (key === 'Enter' && el.form) el.form.requestSubmit(); return { ok: true }; })()`
    } else {
      throw new Error(`Unknown browser action: ${type}`)
    }
    if (typeof action.snapshotId === 'string' && typeof action.expectedUrl === 'string') {
      code = `(() => { if (location.href !== ${JSON.stringify(action.expectedUrl)} || document.documentElement.getAttribute('data-pi-session-snapshot') !== ${JSON.stringify(action.snapshotId)}) return { __piGuardRejected: 'page_changed' }; document.documentElement.removeAttribute('data-pi-session-snapshot'); if (${browserChallengeCode}) return { __piGuardRejected: 'human' }; if (!(${browserTargetGuardCode})(${JSON.stringify(candidateId)}, ${JSON.stringify(selector)}, '__piInappTargets', true)) return { __piGuardRejected: 'target_changed' }; return ${code}; })()`
    }
    const doc = documentIdentity
    actionInFlight = true
    let result
    try { result = await view.webContents.executeJavaScript(code, true) }
    finally { actionInFlight = false }
    if (result?.ok && result.piPoint && doc === documentIdentity) {
      const { x, y } = result.piPoint
      if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1)
        lastActionPoint = { doc, url: String(action.expectedUrl), x, y, at: Date.now() }
      delete result.piPoint
    }
    return result && typeof result === 'object' ? result as Record<string, unknown> : { ok: true }
  }

  const publishState = () => view ? emitState() : send(getFallbackState())
  return { hasTaskViewport: () => !!requestedSize, setKey: (value: string) => { key = value }, setTaskViewport, resetTaskViewport, openedPages: () => [...popups].filter(name => pages.has(name)), getFallbackState, publishState, browserOpen, browserBounds, browserSetVisible, browserNavigate, browserBack, browserForward, browserReload, browserStop, browserClose, browserState, browserPreview, browserDomObserve, browserDomReadText, browserDomCheckFile, browserDomHashFile, browserDomAct, ownsDocument: (doc: string) => view !== null && documentIdentity === doc }
}
