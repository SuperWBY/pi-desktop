import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Settings } from '@shared/types'
import { agentDir } from './pi-settings'
import { sessionsRoot } from './sessions'

export interface SandboxLaunch {
  cliPath: string
  configPath: string
  nodePath: string
}

const MODEL_DOMAINS = [
  'api.openai.com',
  'auth.openai.com',
  'platform.openai.com',
  '*.openai.com',
  'chatgpt.com',
  '*.chatgpt.com',
  'api.anthropic.com',
  'auth.anthropic.com',
  'console.anthropic.com',
  'claude.ai',
  '*.anthropic.com',
  'generativelanguage.googleapis.com',
  '*.googleapis.com',
  'openrouter.ai',
  '*.openrouter.ai',
  'api.deepseek.com',
  '*.deepseek.com',
  'api.groq.com',
  '*.groq.com',
  'api.x.ai',
  '*.x.ai',
  'api.mistral.ai',
  '*.mistral.ai',
  'api.githubcopilot.com',
  '*.githubcopilot.com',
  'api.github.com',
  'github.com',
  '*.github.com',
  '*.githubusercontent.com',
  '*.pi.dev',
  'accounts.google.com',
  '*.google.com'
]

const SECRET_PATHS = [
  join(homedir(), '.ssh'),
  join(homedir(), '.aws'),
  join(homedir(), '.gnupg'),
  join(homedir(), '.config', 'gh'),
  join(homedir(), '.npmrc'),
  join(homedir(), '.netrc')
]

function cliPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'srt-cli.cjs')
    : join(app.getAppPath(), 'build', 'srt-cli.cjs')
}

function nodePath(): string | null {
  const candidates = [
    process.env.PI_DESKTOP_NODE,
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/bin/node'
  ].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  try {
    const found = execFileSync('which', ['node'], { encoding: 'utf8', timeout: 2000 }).trim()
    return found || null
  } catch {
    return null
  }
}

export function sandboxAvailable(): boolean {
  return process.platform !== 'win32' && existsSync(cliPath()) && Boolean(nodePath())
}

function modelDomains(): string[] {
  const domains = new Set(MODEL_DOMAINS)
  try {
    const parsed = JSON.parse(readFileSync(join(agentDir(), 'models.json'), 'utf8')) as { providers?: Record<string, { baseUrl?: unknown }> }
    for (const provider of Object.values(parsed.providers ?? {})) {
      if (typeof provider?.baseUrl !== 'string') continue
      try {
        const host = new URL(provider.baseUrl).hostname
        if (host) domains.add(host)
      } catch { /* ignore malformed custom URLs */ }
    }
  } catch { /* default domains are enough */ }
  return [...domains]
}

function validDomain(value: string): boolean {
  return /^(\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::[0-9]{1,5})?$/i.test(value)
}

function allowedDomains(settings: Settings): string[] {
  if (settings.sandboxNetwork === 'off') return []
  const custom = Array.isArray(settings.sandboxAllowedDomains)
    ? settings.sandboxAllowedDomains.map((value) => value.trim()).filter(validDomain)
    : []
  return [...new Set([...modelDomains(), ...custom])]
}

export function createSandbox(cwd: string, settings: Settings, additionalRuntimeWrites: string[] = []): SandboxLaunch | null {
  if (!sandboxAvailable()) return null
  const workspace = resolve(cwd || homedir())
  const runtimeWrites = [agentDir(), sessionsRoot(), join(app.getPath('userData'), 'computer-use-sessions'), tmpdir(), ...additionalRuntimeWrites]
  const writes = settings.sandboxMode === 'read-only'
    ? runtimeWrites
    : [workspace, ...runtimeWrites]
  const config = {
    filesystem: {
      denyRead: SECRET_PATHS.filter((path) => existsSync(path)),
      allowRead: ['/'],
      allowWrite: [...new Set(writes)],
      denyWrite: []
    },
    network: {
      allowedDomains: allowedDomains(settings),
      deniedDomains: [],
      allowLocalBinding: true
    }
  }
  const directory = join(app.getPath('userData'), 'sandbox')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const configPath = join(directory, `${randomUUID()}.json`)
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 })
  return { cliPath: cliPath(), configPath, nodePath: nodePath() as string }
}

export function sandboxStatus(): { available: boolean; reason?: string; node?: string; cli?: string } {
  if (process.platform === 'win32') return { available: false, reason: 'Windows 暂不支持这种 sandbox；后续需要 WSL2 或 srt 的 Windows 安装。' }
  if (!existsSync(cliPath())) return { available: false, reason: 'sandbox runtime 还没有打包。' }
  const node = nodePath()
  if (!node) return { available: false, reason: '没有找到 Node.js，无法启动 sandbox runtime。' }
  return { available: true, node, cli: cliPath() }
}
