import { app, shell, type WebContents } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { agentDir } from './pi-settings'
import { backgroundNodeExecutable } from './pi-exec'
import { locatePi } from './pi-locate'
import { seedRoot } from './pi-runtime'

export interface OAuthProvider {
  id: string
  name: string
  oauth: boolean
  apiKey: boolean
}

export const OAUTH_UNAVAILABLE = '当前版本暂不支持账号登录，请用 API Key'

function helperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'pi-auth-helper.mjs')
    : join(app.getAppPath(), 'build', 'pi-auth-helper.mjs')
}

function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] => value.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** Look for pi-coding-agent dist/index.js under a versioned root (seed or releases). */
function findAuthPackageInRoot(root: string): string | null {
  if (!existsSync(root)) return null
  const direct = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js')
  if (existsSync(direct)) return direct
  let versions: string[] = []
  try {
    versions = readdirSync(root)
      .filter((name) => /^\d+\.\d+\.\d+/.test(name))
      .sort(compareVersions)
      .reverse()
  } catch {
    return null
  }
  for (const version of versions) {
    const file = join(root, version, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js')
    if (existsSync(file)) return file
  }
  return null
}

function managedInstallRoots(): string[] {
  const roots = [join(homedir(), '.pi', 'agent', 'install', 'releases')]
  const appData = process.env.APPDATA
  if (appData) roots.push(join(appData, 'pi', 'agent', 'install', 'releases'))
  return roots
}

/** Prefer bundled seed, then the user's managed Pi install (same as chat fallback). */
export function authPackagePath(): string {
  if (process.env.PI_DESKTOP_SKIP_SEED !== '1') {
    const bundled = findAuthPackageInRoot(seedRoot())
    if (bundled) return bundled
  }

  for (const root of managedInstallRoots()) {
    const found = findAuthPackageInRoot(root)
    if (found) return found
  }

  // Derive from a located pi binary under ~/.pi/agent/bin → ../install/releases
  try {
    const piPath = locatePi()
    if (piPath !== 'pi' && existsSync(piPath)) {
      const agentRoot = dirname(dirname(piPath))
      const releases = join(agentRoot, 'install', 'releases')
      const found = findAuthPackageInRoot(releases)
      if (found) return found
    }
  } catch {
    // ignore and fall through
  }

  throw new Error(OAUTH_UNAVAILABLE)
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
  if (!existsSync(helperPath())) throw new Error(OAUTH_UNAVAILABLE)
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

export async function listRuntimeAuthProviders(): Promise<OAuthProvider[]> {
  return new Promise((resolve, reject) => {
    let env: NodeJS.ProcessEnv
    try {
      env = helperEnv()
    } catch (error) {
      reject(error instanceof Error ? error : new Error(OAUTH_UNAVAILABLE))
      return
    }
    const child = spawn(backgroundNodeExecutable(), [helperPath(), '--list'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
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
        resolve(parsed.providers.filter((provider) => typeof provider.id === 'string' && typeof provider.name === 'string' && (provider.oauth || provider.apiKey)))
      } catch (error) {
        reject(new Error(code === 0 ? (error instanceof Error ? error.message : String(error)) : '无法读取账号登录服务商列表。'))
      }
    })
  })
}

export async function listOAuthProviders(): Promise<OAuthProvider[]> {
  return (await listRuntimeAuthProviders()).filter((provider) => provider.oauth)
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
    child = spawn(backgroundNodeExecutable(), [helperPath(), provider], { env: helperEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
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
