import { app, shell, type WebContents } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { agentDir } from './pi-settings'
import { seedRoot } from './pi-runtime'

export interface OAuthProvider {
  id: string
  name: string
  oauth: boolean
  apiKey: boolean
}

function helperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'pi-auth-helper.mjs')
    : join(app.getAppPath(), 'build', 'pi-auth-helper.mjs')
}

function authPackagePath(): string {
  const root = seedRoot()
  if (!existsSync(root)) throw new Error('内置 Pi runtime 不存在，无法使用账号登录。')
  const versions = readdirSync(root)
    .filter((name) => /^\d+\.\d+\.\d+/.test(name))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const version of versions) {
    const file = join(root, version, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js')
    if (existsSync(file)) return file
  }
  throw new Error('找不到 Pi 的认证模块，请重新安装 Pi Desktop。')
}

function deviceId(): string {
  const file = join(app.getPath('userData'), 'device-id')
  try {
    const value = readFileSync(file, 'utf8').trim()
    if (value) return value
  } catch { /* create below */ }
  const value = randomUUID()
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file, value, { mode: 0o600 })
  return value
}

function helperEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PI_AUTH_PACKAGE: authPackagePath(),
    PI_AUTH_FILE: join(agentDir(), 'auth.json'),
    PI_DESKTOP_DEVICE_ID: deviceId()
  }
}

function collect(provider: ChildProcessWithoutNullStreams, onLine: (value: Record<string, unknown>) => void): void {
  let buffer = ''
  provider.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { onLine(JSON.parse(line) as Record<string, unknown>) } catch { /* installer noise */ }
    }
  })
}

export async function listOAuthProviders(): Promise<OAuthProvider[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath(), '--list'], { env: helperEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', () => undefined)
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('读取服务商列表超时。')) }, 15_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const line = output.trim().split(/\r?\n/).pop() ?? ''
        const parsed = JSON.parse(line) as { type?: string; providers?: OAuthProvider[] }
        if (parsed.type !== 'providers' || !Array.isArray(parsed.providers)) throw new Error('服务商列表格式无效。')
        resolve(parsed.providers.filter((provider) => provider.oauth))
      } catch (error) {
        reject(new Error(code === 0 ? (error instanceof Error ? error.message : String(error)) : '无法读取 OAuth 服务商列表。'))
      }
    })
  })
}

let active: { child: ChildProcessWithoutNullStreams; sender: WebContents; timer: NodeJS.Timeout } | null = null

function finishActive(): void {
  if (!active) return
  clearTimeout(active.timer)
  try { active.child.kill('SIGTERM') } catch { /* already gone */ }
  active = null
}

export async function startOAuth(provider: string, sender: WebContents): Promise<{ ok: boolean; error?: string }> {
  finishActive()
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(provider)) return { ok: false, error: '服务商 ID 不合法。' }
  try {
    const known = await listOAuthProviders()
    if (!known.some((item) => item.id === provider)) return { ok: false, error: '该服务商不支持账号授权。' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(process.execPath, [helperPath(), provider], { env: helperEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const timer = setTimeout(() => {
    sender.send('auth:oauth-event', { type: 'error', message: '登录超时，请重试。' })
    finishActive()
  }, 10 * 60_000)
  active = { child, sender, timer }
  collect(child, (event) => {
    sender.send('auth:oauth-event', event)
    if (event.type === 'event') {
      const payload = event.event as { type?: string; url?: string; verificationUri?: string } | undefined
      const url = payload?.type === 'auth_url' ? payload.url : payload?.type === 'device_code' ? payload.verificationUri : undefined
      if (url && /^https:\/\//.test(url)) void shell.openExternal(url)
    }
    if (event.type === 'done' || event.type === 'error') finishActive()
  })
  child.stderr.on('data', () => undefined)
  child.on('error', (error) => {
    sender.send('auth:oauth-event', { type: 'error', message: error.message })
    finishActive()
  })
  child.on('close', (code) => {
    if (active?.child === child) {
      if (code !== 0) sender.send('auth:oauth-event', { type: 'error', message: `登录进程退出（${code ?? 'unknown'}）。` })
      finishActive()
    }
  })
  return { ok: true }
}

export function respondOAuth(id: string, value: string, cancelled = false): void {
  if (!active) return
  active.child.stdin.write(JSON.stringify({ type: 'response', id, value, cancelled }) + '\n')
}

export function cancelOAuth(): void {
  finishActive()
}
