import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { execFile, spawn } from 'node:child_process'
import { appendFile, mkdir, readFile, unlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const isWindows = process.platform === 'win32'
const helperPath = fileURLToPath(new URL(isWindows ? './bin/computer-use-helper.ps1' : './bin/computer-use-helper', import.meta.url))
const helperCommand = isWindows ? 'powershell.exe' : helperPath

interface UiElement {
  id: string
  role: string
  title: string | null
  description: string | null
  value: string | null
  identifier: string | null
  enabled: boolean
  focused: boolean
  secure: boolean
  bounds: { x: number; y: number; width: number; height: number } | null
  depth: number
}

interface OcrLine {
  text: string
  bounds: { x: number; y: number; width: number; height: number }
  confidence: number
}

interface Candidate extends UiElement {
  source: 'ax' | 'ocr'
  confidence: number
  actions: string[]
}

interface BrowserCandidate {
  id: string
  role: string
  tag: string
  name: string
  type: string
  value: string
  secure: boolean
  bounds: { x: number; y: number; width: number; height: number }
}

interface Snapshot {
  app: string
  bundleId: string | null
  active: boolean
  windowTitle: string | null
  windowBounds: { x: number; y: number; width: number; height: number } | null
  windowId: number | null
  captureMode: 'window' | 'region' | 'display'
  screenshot: string | null
  screenWidth: number
  screenHeight: number
  accessibility: boolean
  screenRecording: boolean
  elements: UiElement[]
  ocr?: OcrLine[]
  candidates?: Candidate[]
}

interface SnapshotState {
  id: string
  snapshot: Snapshot
  stale: boolean
}

const snapshots = new Map<string, SnapshotState>()
const auditDir = join(homedir(), '.pi', 'computer-use')
const auditFile = join(auditDir, 'audit.jsonl')
const approvalMode = process.env.PI_COMPUTER_USE_APPROVAL ?? 'always'
const cdpProfileDir = join(homedir(), '.pi', 'computer-use', 'chrome-cdp-profile')
let cdpProcess: ReturnType<typeof spawn> | null = null
let cdpSocket: WebSocket | null = null
const cdpPort = Number(process.env.PI_CDP_PORT ?? '9223')
let cdpMessageId = 0
const cdpPending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()

function cdpSend(method: string, params: Record<string, unknown> = {}): Promise<any> {
  if (!cdpSocket || cdpSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('CDP socket is not connected.'))
  }
  return new Promise((resolve, reject) => {
    const id = ++cdpMessageId
    const timer = setTimeout(() => {
      cdpPending.delete(id)
      reject(new Error(`CDP ${method} timed out`))
    }, 20_000)
    cdpPending.set(id, { resolve, reject, timer })
    cdpSocket!.send(JSON.stringify({ id, method, params }))
  })
}

async function cdpConnect(profileDir: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
      if (response.ok) break
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((response) => response.json()) as Array<Record<string, any>>
  const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
  if (!page) throw new Error('Chrome did not expose a page target.')
  cdpSocket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP WebSocket connection timed out.')), 10_000)
    cdpSocket!.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
    cdpSocket!.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('CDP WebSocket connection failed.'))
    }, { once: true })
  })
  cdpSocket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: any; error?: { message?: string } }
    if (!message.id || !cdpPending.has(message.id)) return
    const pending = cdpPending.get(message.id)!
    clearTimeout(pending.timer)
    cdpPending.delete(message.id)
    if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed'))
    else pending.resolve(message.result)
  })
  await cdpSend('Page.enable')
  await cdpSend('Runtime.enable')
}

async function ensureCdpPage(url?: string): Promise<void> {
  if (!cdpSocket || cdpSocket.readyState !== WebSocket.OPEN) {
    // A previous Pi process may have left the dedicated Chrome running.
    // Try its fixed CDP port before spawning another profile holder.
    try {
      await cdpConnect(cdpProfileDir, 700)
    } catch {
      // No live CDP endpoint; start one below.
    }
    if (!cdpSocket && cdpProcess && cdpProcess.exitCode === null) {
      try {
        await cdpConnect(cdpProfileDir)
      } catch {
        cdpProcess.kill()
        cdpProcess = null
      }
    }
    if (!cdpSocket) {
      await mkdir(cdpProfileDir, { recursive: true })
      await unlink(join(cdpProfileDir, 'DevToolsActivePort')).catch(() => undefined)
      cdpProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${cdpProfileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(process.env.PI_BROWSER_HEADLESS === '1' ? ['--headless=new'] : []),
      'about:blank'
    ], { stdio: 'ignore', detached: true })
    cdpProcess.unref()
    cdpProcess.once('exit', () => {
      cdpProcess = null
      cdpSocket = null
    })
    await cdpConnect(cdpProfileDir, 20_000)
    }
  }
  if (url) {
    await cdpSend('Page.navigate', { url })
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
}

async function cdpEval<T>(code: string): Promise<T> {
  const result = await cdpSend('Runtime.evaluate', {
    expression: code,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  }) as { result?: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text?: string } }
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'CDP evaluation failed')
  }
  return result.result?.value as T
}

function releaseCdpSocket(): void {
  cdpSocket?.close()
  cdpSocket = null
}

async function closeCdp(): Promise<void> {
  for (const pending of cdpPending.values()) {
    clearTimeout(pending.timer)
    pending.reject(new Error('CDP browser closed.'))
  }
  cdpPending.clear()
  cdpSocket?.close()
  cdpSocket = null
  if (cdpProcess) {
    cdpProcess.kill()
    cdpProcess = null
  }
}

const cdpObserveCode = `(() => {
  const selector = 'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]'
  const out = []
  for (const el of document.querySelectorAll(selector)) {
    if (!(el instanceof HTMLElement)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') continue
    const type = (el.getAttribute('type') || '').toLowerCase()
    const secure = type === 'password' || el.getAttribute('autocomplete') === 'current-password'
    const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.value || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    const id = 'c' + (out.length + 1)
    el.setAttribute('data-pi-cdp-id', id)
    out.push({ id, role: el.getAttribute('role') || el.tagName.toLowerCase(), name, type, value: secure ? '' : String(el.value ?? '').slice(0, 160), secure, bounds: { x: r.x, y: r.y, width: r.width, height: r.height } })
    if (out.length >= 120) break
  }
  return out
})()`

async function cdpObserve(url?: string): Promise<Array<Record<string, unknown>>> {
  try {
    await ensureCdpPage(url)
    const result = await cdpEval<Array<Record<string, unknown>>>(cdpObserveCode)
    return Array.isArray(result) ? result : []
  } finally {
    releaseCdpSocket()
  }
}

async function cdpAction(action: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureCdpPage()
  const candidateId = String(action.candidateId ?? '')
  if (!/^c\d+$/.test(candidateId)) throw new Error('candidateId must look like c1')
  const type = String(action.type ?? '')
  const selector = `[data-pi-cdp-id="${candidateId}"]`
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
    throw new Error(`Unknown CDP action: ${type}`)
  }
  try {
    const result = await cdpEval<Record<string, unknown>>(code)
    const state = await cdpEval<Record<string, unknown>>('({ title: document.title, url: location.href })')
    return { ...result, page: state }
  } finally {
    releaseCdpSocket()
  }
}

async function audit(entry: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(auditDir, { recursive: true })
    await appendFile(auditFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8')
  } catch {
    // audit failure must not break a UI action
  }
}

async function runHelper(args: string[]): Promise<Record<string, unknown>> {
  try {
    const commandArgs = isWindows
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath, ...args]
      : args
    const { stdout } = await execFileAsync(helperCommand, commandArgs, {
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    })
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    if (parsed.ok === false) throw new Error(String(parsed.error ?? 'Computer Use helper failed'))
    return parsed
  } catch (error) {
    const value = error as { stderr?: string; message?: string }
    throw new Error(value.stderr?.trim() || value.message || String(error))
  }
}

function actionsFor(element: UiElement, source: 'ax' | 'ocr'): string[] {
  if (source === 'ocr') return ['click']
  const role = element.role
  if (role.includes('Button') || role.includes('Link') || role.includes('MenuItem')) return ['press', 'click']
  if (role.includes('TextField') || role.includes('TextArea')) return ['focus', 'set_value', 'type']
  if (role.includes('CheckBox') || role.includes('RadioButton')) return ['toggle', 'click']
  if (role.includes('PopUpButton')) return ['press', 'menu']
  if (role.includes('Tab')) return ['press', 'click']
  return ['click']
}

function compileCandidates(snapshot: Snapshot): Candidate[] {
  const candidates: Candidate[] = []
  const seen = new Set<string>()
  for (const element of snapshot.elements) {
    const key = `${element.role}|${element.title ?? ''}|${element.bounds?.x ?? -1},${element.bounds?.y ?? -1},${element.bounds?.width ?? -1},${element.bounds?.height ?? -1}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      ...element,
      source: 'ax',
      confidence: 0.95,
      actions: actionsFor(element, 'ax')
    })
  }
  for (const [index, line] of (snapshot.ocr ?? []).entries()) {
    if (line.confidence < 0.3 || !line.text.trim() || !line.bounds) continue
    const duplicate = candidates.some((candidate) => {
      if (!candidate.bounds) return false
      const a = candidate.bounds
      const b = line.bounds
      const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
      const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
      const overlap = overlapX * overlapY
      return overlap > 0.5 * b.width * b.height
    })
    if (duplicate) continue
    candidates.push({
      id: `o${index + 1}`,
      role: 'text',
      title: line.text,
      description: null,
      value: null,
      identifier: null,
      enabled: true,
      focused: false,
      secure: false,
      bounds: line.bounds,
      depth: 0,
      source: 'ocr',
      confidence: line.confidence,
      actions: ['click']
    })
  }
  return candidates
}

interface BrowserBridge {
  port: number
  token: string
}

async function readBrowserBridge(): Promise<BrowserBridge | null> {
  try {
    const raw = await readFile(join(auditDir, 'browser-bridge.json'), 'utf8')
    const value = JSON.parse(raw) as BrowserBridge
    if (!Number.isFinite(value.port) || !value.token) return null
    return value
  } catch {
    return null
  }
}

async function bridgeRequest<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const bridge = await readBrowserBridge()
  if (!bridge) throw new Error('In-app browser bridge is not available. Open Pi Desktop and the browser panel first.')
  const response = await fetch(`http://127.0.0.1:${bridge.port}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${bridge.token}`,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000)
  })
  const value = await response.json() as { ok?: boolean; error?: string } & Record<string, unknown>
  if (!response.ok || value.ok === false) throw new Error(value.error || `Browser bridge failed (${response.status})`)
  return value as T
}

async function chromeJS<T>(code: string): Promise<T> {
  const escaped = code.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  const script = `tell application "Google Chrome"
tell active tab of front window
execute javascript "${escaped}"
end tell
end tell`
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 20_000 })
    const text = stdout.trim()
    if (!text) throw new Error('Chrome returned an empty result.')
    return JSON.parse(text) as T
  } catch (error) {
    const value = error as { stderr?: string; message?: string }
    const message = value.stderr?.trim() || value.message || String(error)
    if (message.includes('通过 AppleScript 执行 JavaScript 的功能已关闭')) {
      throw new Error('Chrome JavaScript from Apple Events is disabled. Enable View → Developer → Allow JavaScript from Apple Events in Chrome, then retry.')
    }
    throw new Error(message)
  }
}

const browserObserveCode = `(() => {
  const selector = 'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]'
  const nodes = [...document.querySelectorAll(selector)]
  const candidates = []
  for (const el of nodes) {
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
      tag: el.tagName.toLowerCase(),
      name,
      type,
      value: secure ? '' : String(el.value ?? '').slice(0, 160),
      secure,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
    if (candidates.length >= 120) break
  }
  return JSON.stringify(candidates)
})()`

async function browserObserve(url?: string): Promise<BrowserCandidate[]> {
  const bridge = await readBrowserBridge()
  if (bridge) {
    if (url) await bridgeRequest('/navigate', { url })
    const result = await bridgeRequest<{ candidates: BrowserCandidate[] }>('/observe', {})
    return Array.isArray(result.candidates) ? result.candidates : []
  }
  if (url) throw new Error('The in-app browser is not open. Open the browser panel first, or use computer_use_browser_observe without a URL for Chrome AppleScript.')
  const candidates = await chromeJS<BrowserCandidate[]>(browserObserveCode)
  return Array.isArray(candidates) ? candidates : []
}

async function browserAction(action: Record<string, unknown>): Promise<string> {
  const candidateId = String(action.candidateId ?? '')
  if (!/^b\d+$/.test(candidateId)) throw new Error('candidateId must be a browser candidate such as b1')
  const bridge = await readBrowserBridge()
  if (bridge) {
    const result = await bridgeRequest<{ result: Record<string, unknown> }>('/act', { ...action, candidateId })
    return `in-app browser ${String(action.type ?? 'action')} ${candidateId}`
  }
  const type = String(action.type ?? '')
  const selector = `[data-pi-cua-id="${candidateId}"]`
  if (type === 'click') {
    const code = `(() => {
      const el = document.querySelector('${selector}')
      if (!el) return JSON.stringify({ ok: false, error: 'candidate not found' })
      el.scrollIntoView({ block: 'center', inline: 'center' })
      if (typeof el.click === 'function') el.click()
      else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      return JSON.stringify({ ok: true, title: document.title, url: location.href })
    })()`
    const result = await chromeJS<{ ok: boolean; error?: string; title?: string; url?: string }>(code)
    if (!result.ok) throw new Error(result.error || 'Browser click failed')
    return `browser click ${candidateId} (${result.title ?? ''})`
  }
  if (type === 'type') {
    const text = String(action.text ?? '')
    if (!text) throw new Error('type requires text')
    const code = `(() => {
      const el = document.querySelector('${selector}')
      if (!el) return JSON.stringify({ ok: false, error: 'candidate not found' })
      if (el instanceof HTMLInputElement && el.type === 'password') return JSON.stringify({ ok: false, error: 'secure field' })
      el.focus()
      if (el.isContentEditable) {
        el.textContent = ${JSON.stringify(text)}
      } else {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        if (setter) setter.call(el, ${JSON.stringify(text)})
        else el.value = ${JSON.stringify(text)}
      }
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return JSON.stringify({ ok: true, value: el.isContentEditable ? el.textContent : el.value })
    })()`
    const result = await chromeJS<{ ok: boolean; error?: string; value?: string }>(code)
    if (!result.ok) throw new Error(result.error || 'Browser type failed')
    return `browser type ${candidateId} (${String(result.value ?? '').length} characters)`
  }
  if (type === 'press') {
    const key = String(action.key ?? 'Enter')
    const code = `(() => {
      const el = document.querySelector('${selector}')
      if (!el) return JSON.stringify({ ok: false, error: 'candidate not found' })
      el.focus()
      const key = ${JSON.stringify(key)}
      el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }))
      el.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }))
      if (key === 'Enter' && el.form) el.form.requestSubmit()
      return JSON.stringify({ ok: true })
    })()`
    const result = await chromeJS<{ ok: boolean; error?: string }>(code)
    if (!result.ok) throw new Error(result.error || 'Browser press failed')
    return `browser press ${key} on ${candidateId}`
  }
  throw new Error(`Unknown browser action: ${type}`)
}

function describeSnapshot(snapshot: Snapshot, id: string): string {
  const lines = [
    `App: ${snapshot.app}${snapshot.bundleId ? ` (${snapshot.bundleId})` : ''}${snapshot.active ? ' [active]' : ' [background]'}`,
    `Window: ${snapshot.windowTitle ?? '(untitled)'}`,
    `Snapshot: ${id}`,
    `Capture: ${snapshot.captureMode}${snapshot.windowBounds ? ` @ ${Math.round(snapshot.windowBounds.x)},${Math.round(snapshot.windowBounds.y)} ${Math.round(snapshot.windowBounds.width)}×${Math.round(snapshot.windowBounds.height)}` : ''}`,
    `Screen: ${snapshot.screenWidth}×${snapshot.screenHeight}`,
    `Accessibility: ${snapshot.accessibility ? 'granted' : 'missing'}`,
    `Screen recording: ${snapshot.screenRecording ? 'granted' : 'missing'}`,
    '',
    `Candidates: ${snapshot.candidates?.length ?? snapshot.elements.length} (AX ${snapshot.elements.length}, OCR ${snapshot.ocr?.length ?? 0})`
  ]
  const rows = snapshot.candidates ?? snapshot.elements
  for (const element of rows) {
    const label = element.title || element.description || element.value || ''
    const bounds = element.bounds
      ? ` @ ${Math.round(element.bounds.x)},${Math.round(element.bounds.y)} ${Math.round(element.bounds.width)}×${Math.round(element.bounds.height)}`
      : ''
    const source = 'source' in element ? ` ${element.source}` : ''
    const actions = 'actions' in element && Array.isArray(element.actions) ? ` [${element.actions.join(',')}]` : ''
    lines.push(
      `${element.id} ${element.role}${source}${label ? ` “${label.slice(0, 120)}”` : ''}${element.secure ? ' [secure]' : ''}${element.enabled ? '' : ' [disabled]'}${actions}${bounds}`
    )
  }
  if (!rows.length) lines.push('(no accessible elements or OCR text; use the screenshot and x/y coordinates)')
  return lines.join('\n')
}

function findElement(snapshot: Snapshot | undefined, id: string): UiElement {
  if (!snapshot) throw new Error('Snapshot not found. Call computer_use_observe again.')
  const element = (snapshot.candidates ?? snapshot.elements).find((item) => item.id === id) ?? snapshot.elements.find((item) => item.id === id)
  if (!element) throw new Error(`Element ${id} is no longer in the snapshot. Observe again.`)
  if (!element.bounds) throw new Error(`Element ${id} has no bounds; observe again.`)
  return element
}

interface SnapshotDiff {
  status: 'confirmed' | 'unverified'
  changed: boolean
  windowTitleChanged: boolean
  elementCountBefore: number
  elementCountAfter: number
  changedElements: number
}

function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const beforeById = new Map(before.elements.map((element) => [element.id, element]))
  let changedElements = 0
  for (const element of after.elements) {
    const previous = beforeById.get(element.id)
    if (!previous) {
      changedElements += 1
      continue
    }
    const previousValue = `${previous.role}|${previous.title ?? ''}|${previous.value ?? ''}|${previous.bounds?.x ?? ''},${previous.bounds?.y ?? ''},${previous.bounds?.width ?? ''},${previous.bounds?.height ?? ''}|${previous.enabled}|${previous.focused}`
    const nextValue = `${element.role}|${element.title ?? ''}|${element.value ?? ''}|${element.bounds?.x ?? ''},${element.bounds?.y ?? ''},${element.bounds?.width ?? ''},${element.bounds?.height ?? ''}|${element.enabled}|${element.focused}`
    if (previousValue !== nextValue) changedElements += 1
  }
  const windowTitleChanged = before.windowTitle !== after.windowTitle
  return {
    status: windowTitleChanged || changedElements > 0 ? 'confirmed' : 'unverified',
    changed: windowTitleChanged || changedElements > 0,
    windowTitleChanged,
    elementCountBefore: before.elements.length,
    elementCountAfter: after.elements.length,
    changedElements
  }
}

function point(element: UiElement): { x: number; y: number } {
  if (!element.bounds) throw new Error('Element has no bounds')
  return {
    x: element.bounds.x + element.bounds.width / 2,
    y: element.bounds.y + element.bounds.height / 2
  }
}

async function screenshotContent(path: string | null): Promise<Array<Record<string, unknown>>> {
  if (!path) return []
  try {
    const bytes = await readFile(path)
    if (bytes.length > 3 * 1024 * 1024) return []
    return [{ type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' }]
  } catch {
    return []
  } finally {
    await unlink(path).catch(() => undefined)
  }
}

async function verify(state: SnapshotState): Promise<{ snapshot?: Snapshot; diff?: SnapshotDiff }> {
  try {
    const result = await runHelper(['observe', '--app', state.snapshot.app])
    const snapshot = result.snapshot as Snapshot
    return { snapshot, diff: diffSnapshots(state.snapshot, snapshot) }
  } catch {
    return {}
  }
}

async function doAction(action: Record<string, unknown>, state: SnapshotState | undefined): Promise<string> {
  const type = String(action.type ?? '')
  const snapshot = state?.snapshot
  const target = typeof action.elementId === 'string' ? findElement(snapshot, action.elementId) : null
  const xy = target ? point(target) : null

  if (type === 'press') {
    if (!target) throw new Error('press requires elementId')
    await runHelper(['ax-action', '--app', snapshot?.app ?? '', '--id', target.id, '--action', 'press'])
    return `AXPress ${target.id}`
  }

  if (type === 'set_value') {
    if (!target) throw new Error('set_value requires elementId')
    if (target.secure) throw new Error('Refusing to type into a secure text field.')
    const text = String(action.text ?? '')
    if (!text) throw new Error('set_value requires text')
    await runHelper(['ax-action', '--app', snapshot?.app ?? '', '--id', target.id, '--action', 'set_value', '--text', text])
    return `AXSetValue ${target.id}`
  }

  if (type === 'click' || type === 'double_click' || type === 'right_click') {
    // Prefer the native accessibility action for buttons, links, tabs and
    // menu items. It works without moving the cursor or stealing focus.
    if (type === 'click' && target && /Button|Link|MenuItem|CheckBox|RadioButton|Tab/.test(target.role)) {
      try {
        await runHelper(['ax-action', '--app', snapshot?.app ?? '', '--id', target.id, '--action', 'press'])
        return `AXPress ${target.id}`
      } catch {
        // Fall back to a coordinate click when the app does not implement AXPress.
      }
    }
    const x = xy?.x ?? Number(action.x)
    const y = xy?.y ?? Number(action.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('click requires elementId or x/y')
    const button = type === 'right_click' ? 'right' : 'left'
    const count = type === 'double_click' ? 2 : 1
    await runHelper(['click', '--x', String(x), '--y', String(y), '--button', button, '--count', String(count)])
    return `${type} ${Math.round(x)},${Math.round(y)}`
  }

  if (type === 'hover') {
    const x = xy?.x ?? Number(action.x)
    const y = xy?.y ?? Number(action.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('hover requires elementId or x/y')
    await runHelper(['scroll', '--x', String(x), '--y', String(y), '--delta', '0'])
    return `hover ${Math.round(x)},${Math.round(y)}`
  }

  if (type === 'type') {
    if (target?.secure) throw new Error('Refusing to type into a secure text field.')
    const text = String(action.text ?? '')
    if (!text) throw new Error('type requires text')
    if (target && /TextField|TextArea/.test(target.role)) {
      try {
        await runHelper(['ax-action', '--app', snapshot?.app ?? '', '--id', target.id, '--action', 'set_value', '--text', text])
        return `AXSetValue ${target.id} (${text.length} characters)`
      } catch {
        // Fall through to focus + paste when the app rejects direct value writes.
      }
    }
    if (target) {
      const p = point(target)
      await runHelper(['click', '--x', String(p.x), '--y', String(p.y)])
    }
    await runHelper(['type', '--text', text])
    return `typed ${text.length} characters`
  }

  if (type === 'key') {
    const key = String(action.key ?? '')
    if (!key) throw new Error('key requires key')
    await runHelper(['key', '--key', key, '--modifiers', String(action.modifiers ?? '')])
    return `key ${key}${action.modifiers ? ` + ${String(action.modifiers)}` : ''}`
  }

  if (type === 'scroll') {
    const x = xy?.x ?? Number(action.x ?? (snapshot?.screenWidth ?? 0) / 2)
    const y = xy?.y ?? Number(action.y ?? (snapshot?.screenHeight ?? 0) / 2)
    const delta = Number(action.delta ?? 0)
    await runHelper(['scroll', '--x', String(x), '--y', String(y), '--delta', String(delta)])
    return `scrolled ${delta}`
  }

  if (type === 'wait') {
    const ms = Math.max(0, Math.min(30_000, Number(action.ms ?? 500)))
    await new Promise((resolve) => setTimeout(resolve, ms))
    return `waited ${ms}ms`
  }

  throw new Error(`Unknown action type: ${type}`)
}

export default function computerUse(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'computer_use_apps',
    label: 'Computer Use: Apps',
    description: 'List running desktop applications. Use this before observing an app.',
    promptSnippet: 'List desktop apps and windows for computer use.',
    parameters: Type.Object({}),
    async execute() {
      const result = await runHelper(['apps'])
      const apps = (result.apps ?? []) as Array<Record<string, unknown>>
      return {
        content: [{ type: 'text', text: apps.map((app) => `${app.name} (${app.bundleId})`).join('\n') || 'No apps' }],
        details: { result }
      }
    }
  })

  pi.registerTool({
    name: 'computer_use_observe',
    label: 'Computer Use: Observe',
    description:
      'Capture a screenshot and accessibility tree for an application window. Always observe before acting, and observe again after a state change.',
    promptSnippet: 'Observe an app window (screenshot + accessibility elements) before computer_use_act.',
    promptGuidelines: [
      'Use computer_use_observe before computer_use_act, and again after any action that changes the window.',
      'Prefer elementId from the latest snapshot over x/y coordinates.',
      'Do not read or repeat values from secure text fields.'
    ],
    parameters: Type.Object({
      app: Type.Optional(Type.String({ description: 'Application name or bundle id. Defaults to the frontmost app.' })),
      includeScreenshot: Type.Optional(Type.Boolean({ description: 'Include a screenshot in the result. Default true.' }))
    }),
    async execute(_toolCallId, params) {
      const screenshotPath = join(tmpdir(), `pi-cua-${Date.now()}.png`)
      const result = await runHelper(['observe', '--app', params.app ?? '', '--screenshot', screenshotPath])
      const snapshot = result.snapshot as Snapshot
      const candidates = compileCandidates(snapshot)
      snapshot.candidates = candidates
      const id = `s${Date.now()}`
      snapshots.set(id, { id, snapshot, stale: false })
      const text = describeSnapshot(snapshot, id)
      const content: Array<Record<string, unknown>> = [{ type: 'text', text }]
      if (params.includeScreenshot !== false) content.push(...(await screenshotContent(screenshotPath)))
      return {
        content,
        details: {
          snapshotId: id,
          app: snapshot.app,
          elements: snapshot.elements.length,
          ocr: snapshot.ocr?.length ?? 0,
          candidates: candidates.length
        }
      }
    }
  })

  pi.registerTool({
    name: 'computer_use_act',
    label: 'Computer Use: Act',
    description:
      'Perform one desktop action against the latest computer_use_observe snapshot. Prefer elementId; use x/y only when no element exists.',
    promptSnippet: 'Click, type, press keys, or scroll in a desktop app after computer_use_observe.',
    promptGuidelines: [
      'Use computer_use_act only with a snapshotId from the latest computer_use_observe.',
      'Do not click buttons that delete data, pay, send messages, or change security settings without explicit user approval.',
      'After an action, call computer_use_observe again to verify the result.'
    ],
    parameters: Type.Object({
      snapshotId: Type.Optional(Type.String({ description: 'Snapshot from computer_use_observe.' })),
      type: Type.Union([
        Type.Literal('click'),
        Type.Literal('double_click'),
        Type.Literal('right_click'),
        Type.Literal('hover'),
        Type.Literal('press'),
        Type.Literal('set_value'),
        Type.Literal('type'),
        Type.Literal('key'),
        Type.Literal('scroll'),
        Type.Literal('wait')
      ]),
      elementId: Type.Optional(Type.String()),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      text: Type.Optional(Type.String()),
      key: Type.Optional(Type.String()),
      modifiers: Type.Optional(Type.String()),
      delta: Type.Optional(Type.Number()),
      ms: Type.Optional(Type.Number())
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.type !== 'wait' && approvalMode !== 'never') {
        const ok = await ctx.ui.confirm(
          'Computer Use',
          `Run ${params.type}${params.elementId ? ` on ${params.elementId}` : ''} in the current desktop?`
        )
        if (!ok) {
          await audit({ type: params.type, target: params.elementId ?? '', ok: false, cancelled: true })
          return { content: [{ type: 'text', text: 'Action cancelled by user.' }], details: { cancelled: true } }
        }
      }
      const state = params.snapshotId ? snapshots.get(params.snapshotId) : undefined
      if (!state && params.type !== 'wait') throw new Error('Call computer_use_observe before acting.')
      if (state?.stale) throw new Error('This snapshot is stale. Call computer_use_observe again.')
      const text = await doAction(params as Record<string, unknown>, state)
      if (state && params.type !== 'wait') state.stale = true
      const verification = state && params.type !== 'wait' ? await verify(state) : null
      const after = verification?.snapshot
      await audit({ type: params.type, target: params.elementId ?? `${params.x},${params.y}`, app: state?.snapshot.app, ok: true, verification: verification?.diff?.status })
      return {
        content: [{
          type: 'text',
          text: after
            ? `${text}\nVerification: ${verification?.diff?.status ?? 'unverified'} (${verification?.diff?.changedElements ?? 0} changed elements, ${after.elements.length} visible)`
            : text
        }],
        details: {
          action: text,
          snapshotId: params.snapshotId,
          after: after ? { elements: after.elements.length, windowTitle: after.windowTitle } : null,
          verification: verification?.diff ?? null
        }
      }
    }
  })

  pi.registerTool({
    name: 'computer_use_batch',
    label: 'Computer Use: Batch',
    description: 'Run a short sequence of desktop actions against one observed snapshot. Stops at the first failure.',
    promptSnippet: 'Run a short sequence of desktop actions after computer_use_observe.',
    promptGuidelines: [
      'Use computer_use_batch only for closely related steps that do not need a new observation between each action.',
      'Use computer_use_observe after the batch to verify the final state.'
    ],
    parameters: Type.Object({
      snapshotId: Type.Optional(Type.String()),
      actions: Type.Array(Type.Record(Type.String(), Type.Any()))
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (approvalMode !== 'never') {
        const ok = await ctx.ui.confirm('Computer Use', `Run ${params.actions.length} desktop actions?`)
        if (!ok) return { content: [{ type: 'text', text: 'Batch cancelled by user.' }], details: { cancelled: true } }
      }
      const state = params.snapshotId ? snapshots.get(params.snapshotId) : undefined
      if (!state) throw new Error('Call computer_use_observe before running a batch.')
      if (state.stale) throw new Error('This snapshot is stale. Call computer_use_observe again.')
      const completed: string[] = []
      for (const action of params.actions) {
        try {
          completed.push(await doAction(action, state))
        } catch (error) {
          if (state) state.stale = true
          await audit({ type: 'batch', target: completed.length, app: state?.snapshot.app, ok: false, error: String(error) })
          return {
            content: [{ type: 'text', text: `Stopped after ${completed.length}/${params.actions.length}: ${String(error)}` }],
            details: { completed, error: String(error) }
          }
        }
      }
      if (state) state.stale = true
      await audit({ type: 'batch', target: completed.length, app: state?.snapshot.app, ok: true })
      const verification = state ? await verify(state) : null
      const after = verification?.snapshot
      return {
        content: [{
          type: 'text',
          text: `${completed.join('\n')}${after ? `\nVerification: ${verification?.diff?.status ?? 'unverified'} (${verification?.diff?.changedElements ?? 0} changed elements)` : ''}`
        }],
        details: { completed, after, verification: verification?.diff ?? null }
      }
    }
  })

  pi.registerTool({
    name: 'computer_use_browser_observe',
    label: 'Computer Use: Browser Observe',
    description:
      'Read interactive DOM elements from the active Google Chrome tab. Use this for web pages instead of desktop Accessibility.',
    promptSnippet: 'Observe the active Chrome page as DOM candidates.',
    promptGuidelines: [
      'Use browser observe for web pages; use desktop observe for native apps.',
      'Browser candidate IDs are b1, b2, ... and apply only to the current page state.'
    ],
    parameters: Type.Object({}),
    async execute() {
      const candidates = await browserObserve()
      const lines = candidates.map((candidate) => {
        const label = candidate.name ? ` “${candidate.name.slice(0, 120)}”` : ''
        const secure = candidate.secure ? ' [secure]' : ''
        const value = candidate.value ? ` value=${JSON.stringify(candidate.value)}` : ''
        return `${candidate.id} ${candidate.role}${candidate.type ? `[${candidate.type}]` : ''}${label}${secure}${value} @ ${Math.round(candidate.bounds.x)},${Math.round(candidate.bounds.y)} ${Math.round(candidate.bounds.width)}×${Math.round(candidate.bounds.height)}`
      })
      return {
        content: [{ type: 'text', text: `Browser candidates: ${candidates.length}\n${lines.join('\n') || '(no interactive DOM elements)'}` }],
        details: { candidates: candidates.length }
      }
    }
  })

  pi.registerTool({
    name: 'computer_use_browser_act',
    label: 'Computer Use: Browser Act',
    description: 'Click, type into, or press a key on a computer_use_browser_observe candidate in the active Chrome tab.',
    promptSnippet: 'Act on a DOM candidate in the active Chrome page.',
    promptGuidelines: [
      'Use only a candidateId from the latest computer_use_browser_observe result.',
      'Do not type into password fields or submit payment/security forms without explicit user approval.'
    ],
    parameters: Type.Object({
      candidateId: Type.String(),
      type: Type.Union([Type.Literal('click'), Type.Literal('type'), Type.Literal('press')]),
      text: Type.Optional(Type.String()),
      key: Type.Optional(Type.String())
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (approvalMode !== 'never') {
        const ok = await ctx.ui.confirm('Computer Use: Browser', `Run ${params.type} on ${params.candidateId}?`)
        if (!ok) {
          await audit({ type: 'browser', action: params.type, target: params.candidateId, ok: false, cancelled: true })
          return { content: [{ type: 'text', text: 'Browser action cancelled by user.' }], details: { cancelled: true } }
        }
      }
      const text = await browserAction(params as Record<string, unknown>)
      await audit({ type: 'browser', action: params.type, target: params.candidateId, ok: true })
      const state = await chromeJS<{ title?: string; url?: string }>('JSON.stringify({ title: document.title, url: location.href })').catch(() => ({}))
      return {
        content: [{ type: 'text', text: `${text}\nPage: ${state.title ?? ''} ${state.url ?? ''}` }],
        details: { action: text, page: state }
      }
    }
  })

  pi.registerTool({
    name: 'computer_use_cdp_observe',
    label: 'Computer Use: CDP Observe',
    description: 'Read DOM candidates from a dedicated Chrome profile over Playwright/CDP.',
    promptSnippet: 'Observe a page in the dedicated CDP Chrome profile.',
    promptGuidelines: [
      'Use CDP observe for isolated browser automation. The profile is separate from everyday Chrome.',
      'CDP candidate IDs start at c1 and are only valid for the current page state.'
    ],
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: 'Optional URL to open in the dedicated profile.' }))
    }),
    async execute(_toolCallId, params) {
      const candidates = await cdpObserve(params.url)
      const lines = candidates.map((candidate) => {
        const c = candidate as Record<string, any>
        return `${c.id} ${c.role}${c.type ? `[${c.type}]` : ''}${c.name ? ` “${String(c.name).slice(0, 120)}”` : ''}${c.secure ? ' [secure]' : ''} @ ${Math.round(c.bounds?.x ?? 0)},${Math.round(c.bounds?.y ?? 0)} ${Math.round(c.bounds?.width ?? 0)}×${Math.round(c.bounds?.height ?? 0)}`
      })
      return { content: [{ type: 'text', text: `CDP candidates: ${candidates.length}\n${lines.join('\n') || '(none)'}` }], details: { candidates: candidates.length } }
    }
  })

  pi.registerTool({
    name: 'computer_use_cdp_act',
    label: 'Computer Use: CDP Act',
    description: 'Click, type, or press on a dedicated CDP Chrome candidate.',
    promptSnippet: 'Act on a c1/c2 candidate in the CDP Chrome profile.',
    parameters: Type.Object({
      candidateId: Type.String(),
      type: Type.Union([Type.Literal('click'), Type.Literal('type'), Type.Literal('press')]),
      text: Type.Optional(Type.String()),
      key: Type.Optional(Type.String())
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (approvalMode !== 'never') {
        const ok = await ctx.ui.confirm('Computer Use: CDP', `Run ${params.type} on ${params.candidateId}?`)
        if (!ok) return { content: [{ type: 'text', text: 'CDP action cancelled.' }], details: { cancelled: true } }
      }
      const result = await cdpAction(params as Record<string, unknown>)
      await audit({ type: 'cdp-browser', action: params.type, target: params.candidateId, ok: true })
      return { content: [{ type: 'text', text: `${params.type} ${params.candidateId} → ${String((result.page as any)?.url ?? '')}` }], details: { result } }
    }
  })

  pi.registerTool({
    name: 'computer_use_cdp_close',
    label: 'Computer Use: CDP Close',
    description: 'Close the dedicated CDP Chrome context.',
    parameters: Type.Object({}),
    async execute() {
      await closeCdp()
      return { content: [{ type: 'text', text: 'CDP browser closed.' }], details: {} }
    }
  })

  pi.registerTool({
    name: 'computer_use_permissions',
    label: 'Computer Use: Permissions',
    description: 'Check macOS Accessibility and Screen Recording permissions for computer use.',
    parameters: Type.Object({}),
    async execute() {
      const result = await runHelper(['check'])
      return {
        content: [{
          type: 'text',
          text: `Accessibility: ${result.accessibility ? 'granted' : 'missing'}\nScreen Recording: ${result.screenRecording ? 'granted' : 'missing'}`
        }],
        details: result
      }
    }
  })
}
