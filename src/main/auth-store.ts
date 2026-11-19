import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { agentDir } from './pi-settings'

type Credential = { type?: unknown; key?: unknown; [key: string]: unknown }

function authFile(): string {
  return join(agentDir(), 'auth.json')
}

function readAuth(): Record<string, Credential> {
  try {
    const parsed = JSON.parse(readFileSync(authFile(), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, Credential>
  } catch {
    return {}
  }
}

function writeAuth(data: Record<string, Credential>): void {
  const path = authFile()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

export type AuthProviderStatus = { provider: string; type: 'api_key' | 'oauth' | 'unknown' }

export function listAuthProviders(): AuthProviderStatus[] {
  return Object.entries(readAuth())
    .filter(([, value]) => value && typeof value === 'object')
    .map(([provider, value]) => ({
      provider,
      type: (value.type === 'api_key' ? 'api_key' : value.type === 'oauth' ? 'oauth' : 'unknown') as AuthProviderStatus['type']
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider))
}

export function saveApiKey(provider: string, key: string): AuthProviderStatus[] {
  const id = provider.trim()
  const secret = key.trim()
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(id)) throw new Error('服务商 ID 不合法。')
  if (!secret || secret.length > 20_000) throw new Error('API Key 不能为空或过长。')
  const data = readAuth()
  data[id] = { type: 'api_key', key: secret }
  writeAuth(data)
  return listAuthProviders()
}

export function removeAuthProvider(provider: string): AuthProviderStatus[] {
  const data = readAuth()
  delete data[provider]
  writeAuth(data)
  return listAuthProviders()
}
