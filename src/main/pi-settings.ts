import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PiSettings } from '@shared/types'

export function agentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR?.trim()
  return override || join(homedir(), '.pi', 'agent')
}

export function piSettingsFile(): string {
  return join(agentDir(), 'settings.json')
}

let cached: PiSettings | null = null

export function loadPiSettings(): PiSettings {
  if (cached) return cached
  try {
    const raw = readFileSync(piSettingsFile(), 'utf8')
    const parsed = JSON.parse(raw) as PiSettings
    cached = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cached = {}
  }
  return cached
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    next[key] = isPlainObject(value) && isPlainObject(base[key])
      ? merge(base[key] as Record<string, unknown>, value)
      : value
  }
  return next
}

export function savePiSettings(patch: PiSettings): PiSettings {
  const next = merge(loadPiSettings() as Record<string, unknown>, patch as Record<string, unknown>) as PiSettings
  cached = next
  const file = piSettingsFile()
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}
