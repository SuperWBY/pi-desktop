import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { agentDir } from './pi-settings'
import type { JevStatus } from '@shared/types'

export type JevProvider = 'typesafe' | 'opencode-free'

interface StoredJev {
  enabled?: boolean
  provider?: JevProvider
  model?: string
  key?: string
  sharePageText?: boolean
}

function filePath(): string {
  return join(agentDir(), 'jev.json')
}

function read(): StoredJev {
  try {
    const parsed = JSON.parse(readFileSync(filePath(), 'utf8')) as unknown
    return parsed && typeof parsed === 'object' ? parsed as StoredJev : {}
  } catch {
    return {}
  }
}

function write(value: StoredJev): void {
  const path = filePath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

function envKey(provider: JevProvider): string | undefined {
  return provider === 'opencode-free' ? process.env.OPENCODE_CONSOLE_API_KEY : process.env.TYPESAFE_API_KEY
}

export function jevStatus(): JevStatus {
  const value = read()
  const provider: JevProvider = value.provider === 'opencode-free' ? 'opencode-free' : 'typesafe'
  const key = typeof value.key === 'string' && value.key.trim() ? value.key.trim() : envKey(provider)
  return {
    enabled: value.enabled === true,
    provider,
    model: typeof value.model === 'string' ? value.model : '',
    sharePageText: value.sharePageText === true,
    keyConfigured: Boolean(key),
    keySource: typeof value.key === 'string' && value.key.trim() ? 'file' : envKey(provider) ? 'env' : null
  }
}

export function saveJevSettings(patch: {
  enabled?: boolean
  provider?: JevProvider
  model?: string
  key?: string
  sharePageText?: boolean
}): JevStatus {
  const current = read()
  if (typeof patch.enabled === 'boolean') current.enabled = patch.enabled
  if (patch.provider === 'typesafe' || patch.provider === 'opencode-free') current.provider = patch.provider
  if (typeof patch.model === 'string') current.model = patch.model.trim().slice(0, 120)
  if (typeof patch.sharePageText === 'boolean') current.sharePageText = patch.sharePageText
  if (typeof patch.key === 'string') {
    const key = patch.key.trim()
    if (key) current.key = key
    else delete current.key
  }
  write(current)
  return jevStatus()
}

/** Environment for the pi child. Secrets stay in the main process. */
export function jevEnv(): Record<string, string> {
  const value = read()
  const provider: JevProvider = value.provider === 'opencode-free' ? 'opencode-free' : 'typesafe'
  const key = typeof value.key === 'string' && value.key.trim() ? value.key.trim() : envKey(provider)
  if (value.enabled !== true || !key) return {}
  const env: Record<string, string> = {
    PI_JEV_ENABLED: '1',
    PI_JEV_PROVIDER: provider,
    ...(provider === 'opencode-free' ? { OPENCODE_CONSOLE_API_KEY: key } : { TYPESAFE_API_KEY: key })
  }
  if (typeof value.model === 'string' && value.model.trim()) env.PI_JEV_MODEL = value.model.trim()
  if (value.sharePageText === true) env.PI_JEV_SHARE_PAGE_TEXT = '1'
  return env
}
