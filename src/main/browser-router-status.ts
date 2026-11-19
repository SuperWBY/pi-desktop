import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { browserState } from './browser'
import { checkChromeBridge } from './chrome-bridge-check'

export type BrowserRouterBackend = 'inapp' | 'cdp' | 'extension'

export interface BrowserRouterBackendStatus {
  backend: BrowserRouterBackend
  connected: boolean
  detail: string
}

const CDP_PORT = Number(process.env.PI_CDP_PORT ?? '9223')
const CDP_PROFILE = join(homedir(), '.pi', 'computer-use', 'chrome-cdp-profile')

async function cdpVersion(): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1200)
  try {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: controller.signal })
    if (!response.ok) return null
    const body = await response.json() as { Browser?: string }
    return typeof body.Browser === 'string' ? body.Browser : 'CDP'
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function browserRouterStatus(): Promise<{
  backends: BrowserRouterBackendStatus[]
  cdpPort: number
}> {
  const state = browserState()
  const inappConnected = state.open === true
  const [cdp, extension] = await Promise.all([
    cdpVersion(),
    checkChromeBridge()
  ])
  return {
    cdpPort: CDP_PORT,
    backends: [
      {
        backend: 'inapp',
        connected: inappConnected,
        detail: inappConnected ? String(state.url || state.title || '面板已打开') : '面板未打开；打开后登录态保存在 Pi 内'
      },
      {
        backend: 'cdp',
        connected: Boolean(cdp),
        detail: cdp ? `${cdp} · 端口 ${CDP_PORT}` : `未连接；专用 profile ${CDP_PROFILE}`
      },
      {
        backend: 'extension',
        connected: extension.connected,
        detail: extension.connected ? '已连接当前 Chrome 标签页' : extension.busy ? '扩展端口被占用' : '未连接；需要在 Chrome 中加载扩展'
      }
    ]
  }
}

export async function startCdpBrowser(): Promise<{ ok: boolean; detail: string }> {
  const running = await cdpVersion()
  if (running) return { ok: true, detail: `已经连接：${running}` }
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ]
  const executable = candidates.find((path) => existsSync(path))
  if (!executable) return { ok: false, detail: '没有找到 Google Chrome 或 Chromium。' }
  try { mkdirSync(CDP_PROFILE, { recursive: true, mode: 0o700 }) } catch { /* Chrome can create it */ }
  const child = spawn(executable, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CDP_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://www.google.com/'
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const version = await cdpVersion()
    if (version) return { ok: true, detail: version }
  }
  return { ok: false, detail: 'Chrome 已启动，但 CDP 端口还没有响应。请稍后重新检测。' }
}
