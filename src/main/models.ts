import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  CustomModelEntry,
  CustomProviderEntry,
  ModelsConfig,
  PiModelRow
} from '@shared/types'
import { augmentedPath } from './pi-locate'
import { agentDir } from './pi-settings'

const run = promisify(execFile)

/** APIs pi can talk to, from docs/models-configuration.md. */
export const PI_APIS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai'
] as const

export function modelsConfigFile(): string {
  return join(agentDir(), 'models.json')
}

type RawConfig = Record<string, unknown> & { providers?: Record<string, unknown> }

function readRaw(): { raw: RawConfig; error?: string } {
  const file = modelsConfigFile()
  if (!existsSync(file)) return { raw: {} }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { raw: {}, error: 'models.json 顶层必须是一个对象' }
    }
    return { raw: parsed as RawConfig }
  } catch (error) {
    return { raw: {}, error: error instanceof Error ? error.message : String(error) }
  }
}

export function readModelsConfig(): ModelsConfig {
  const { raw, error } = readRaw()
  const providers: Record<string, CustomProviderEntry> = {}
  const section = raw.providers
  if (section && typeof section === 'object' && !Array.isArray(section)) {
    for (const [id, value] of Object.entries(section as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = value as Record<string, unknown>
      providers[id] = {
        name: typeof entry.name === 'string' ? entry.name : undefined,
        baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl : undefined,
        api: typeof entry.api === 'string' ? entry.api : undefined,
        apiKey: typeof entry.apiKey === 'string' ? entry.apiKey : undefined,
        models: Array.isArray(entry.models)
          ? entry.models
              .filter((model): model is Record<string, unknown> => Boolean(model) && typeof model === 'object')
              .map((model) => ({
                id: String(model.id ?? ''),
                name: typeof model.name === 'string' ? model.name : undefined,
                reasoning: model.reasoning === true,
                input: Array.isArray(model.input) ? model.input.map(String) : undefined,
                contextWindow:
                  typeof model.contextWindow === 'number' ? model.contextWindow : undefined,
                maxTokens: typeof model.maxTokens === 'number' ? model.maxTokens : undefined
              }))
          : undefined
      }
    }
  }
  return {
    file: modelsConfigFile(),
    exists: existsSync(modelsConfigFile()),
    providers,
    error
  }
}

function writeRaw(raw: RawConfig): ModelsConfig {
  const file = modelsConfigFile()
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  const next: RawConfig = { $schema: 'https://pi.dev/schemas/models.schema.json', ...raw }
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return readModelsConfig()
}

function sanitizeProvider(id: string, entry: CustomProviderEntry): CustomProviderEntry {
  const providerId = id.trim()
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(providerId)) {
    throw new Error('服务商 ID 只能包含字母、数字、点、下划线和短横线')
  }
  const models = (entry.models ?? [])
    .map((model) => ({ ...model, id: String(model.id ?? '').trim() }))
    .filter((model) => model.id)
  if (!models.length && !entry.baseUrl?.trim() && !entry.apiKey?.trim()) {
    throw new Error('至少需要填写一个模型 ID，或 Base URL / API Key 来覆盖内置服务商')
  }
  const api = entry.api?.trim()
  if (api && !(PI_APIS as readonly string[]).includes(api)) {
    throw new Error(`不支持的 API：${api}`)
  }
  const next: CustomProviderEntry = {}
  if (entry.name?.trim()) next.name = entry.name.trim()
  if (entry.baseUrl?.trim()) next.baseUrl = entry.baseUrl.trim()
  if (api) next.api = api
  if (entry.apiKey?.trim()) next.apiKey = entry.apiKey.trim()
  if (models.length) {
    next.models = models.map((model) => {
      const out: CustomModelEntry = { id: model.id }
      if (model.name?.trim()) out.name = model.name.trim()
      if (model.reasoning) out.reasoning = true
      if (model.input?.length) out.input = model.input
      if (typeof model.contextWindow === 'number' && model.contextWindow > 0) {
        out.contextWindow = model.contextWindow
      }
      if (typeof model.maxTokens === 'number' && model.maxTokens > 0) {
        out.maxTokens = model.maxTokens
      }
      return out
    })
  }
  return next
}

export function saveProvider(id: string, entry: CustomProviderEntry): ModelsConfig {
  const { raw, error } = readRaw()
  if (error) throw new Error(`无法读取 models.json，未保存任何修改：${error}`)
  if (raw.providers !== undefined && (!raw.providers || typeof raw.providers !== 'object' || Array.isArray(raw.providers))) throw new Error('models.json 的 providers 格式无效，未保存任何修改')
  const providers =
    raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers)
      ? { ...(raw.providers as Record<string, unknown>) }
      : {}
  const clean = sanitizeProvider(id, entry)
  const old = providers[id.trim()]
  const existing = old && typeof old === 'object' && !Array.isArray(old) ? old as Record<string, unknown> : {}
  const { name: _name, baseUrl: _baseUrl, api: _api, apiKey: _apiKey, models: oldModels, ...other } = existing
  const models = clean.models?.map((model) => {
    const previous = Array.isArray(oldModels) ? oldModels.find((item) => item && typeof item === 'object' && item.id === model.id) : undefined
    const { id: _id, name: _modelName, reasoning: _reasoning, input: _input, contextWindow: _context, maxTokens: _max, ...extra } = previous ?? {}
    return { ...extra, ...model }
  })
  providers[id.trim()] = { ...other, ...clean, ...(models ? { models } : {}) }
  return writeRaw({ ...raw, providers })
}

export function removeProvider(id: string): ModelsConfig {
  const { raw, error } = readRaw()
  if (error) throw new Error(`无法读取 models.json，未删除任何配置：${error}`)
  if (raw.providers !== undefined && (!raw.providers || typeof raw.providers !== 'object' || Array.isArray(raw.providers))) throw new Error('models.json 的 providers 格式无效，未删除任何配置')
  const providers =
    raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers)
      ? { ...(raw.providers as Record<string, unknown>) }
      : {}
  delete providers[id]
  return writeRaw({ ...raw, providers })
}

/**
 * Recent `pi --list-models` output, which is the authoritative answer to
 * "what can pi actually use right now": built-in catalog, models.json and
 * credentials, all resolved by pi itself.
 */
export function parseModelTable(text: string): PiModelRow[] {
  const rows: PiModelRow[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    if (!line.trim()) continue
    if (/^provider\s+model\b/.test(line.trim())) continue
    const cells = line.split(/\s{2,}/).map((cell) => cell.trim())
    if (cells.length < 6) continue
    const [provider, id, context, maxOut, thinking, images] = cells
    rows.push({
      provider,
      id,
      context,
      maxOut,
      thinking: thinking === 'yes',
      images: images === 'yes'
    })
  }
  return rows
}

export async function listPiModels(piPath: string): Promise<{ models: PiModelRow[]; error?: string }> {
  try {
    const { stdout } = await run(piPath, ['--list-models'], {
      cwd: homedir(),
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PATH: augmentedPath() }
    })
    return { models: parseModelTable(stdout) }
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/** `pi update --models` refreshes the model catalog pi caches from pi.dev. */
export async function refreshModelCatalog(piPath: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await run(piPath, ['update', '--models'], {
      cwd: homedir(),
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PATH: augmentedPath() }
    })
    return { ok: true, output: `${stdout}${stderr}`.trim() }
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) }
  }
}
