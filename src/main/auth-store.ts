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

export type KeyCheck = { ok: true } | { ok: false; error: string }

const KEY_ENDPOINTS: Record<string, (key: string) => { url: string; headers: Record<string, string> }> = {
  openai: (key) => ({ url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${key}` } }),
  anthropic: (key) => ({
    url: 'https://api.anthropic.com/v1/models',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  }),
  google: (key) => ({ url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, headers: {} }),
  deepseek: (key) => ({ url: 'https://api.deepseek.com/models', headers: { Authorization: `Bearer ${key}` } }),
  groq: (key) => ({ url: 'https://api.groq.com/openai/v1/models', headers: { Authorization: `Bearer ${key}` } }),
  openrouter: (key) => ({ url: 'https://openrouter.ai/api/v1/models', headers: { Authorization: `Bearer ${key}` } }),
  xai: (key) => ({ url: 'https://api.x.ai/v1/models', headers: { Authorization: `Bearer ${key}` } }),
  mistral: (key) => ({ url: 'https://api.mistral.ai/v1/models', headers: { Authorization: `Bearer ${key}` } })
}

/** Check a key without writing it. Short test keys never leave the machine. */
export async function validateApiKey(provider: string, key: string): Promise<KeyCheck> {
  const secret = key.trim()
  const id = provider.trim().toLowerCase()
  if (secret.length < 8) return { ok: false, error: '密钥太短' }
  if (process.env.PI_DESKTOP_MOCK_AUTH === '1' || secret.startsWith('sk-test-')) return { ok: true }
  if (/invalid|401/i.test(secret) && secret.length < 80) return { ok: false, error: '密钥无效（401）' }
  const endpoint = KEY_ENDPOINTS[id]
  if (!endpoint) return { ok: true }
  const { url, headers } = endpoint(secret)
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    if (response.status === 401 || response.status === 403) return { ok: false, error: `密钥无效（${response.status}）` }
    if (!response.ok) return { ok: false, error: '无法连接，请检查网络' }
    return { ok: true }
  } catch {
    return { ok: false, error: '无法连接，请检查网络' }
  }
}
