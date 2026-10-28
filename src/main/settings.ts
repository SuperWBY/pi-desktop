import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '@shared/types'

const defaults: Settings = {
  theme: 'dark',
  workspaces: [],
  toolCardsExpanded: false,
  followStream: true
}

let cached: Settings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  if (cached) return cached
  try {
    const raw = readFileSync(settingsFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    cached = {
      ...defaults,
      ...parsed,
      workspaces: Array.from(
        new Set((parsed.workspaces ?? []).filter((value) => typeof value === 'string' && value))
      )
    }
  } catch {
    cached = { ...defaults }
  }
  return cached
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next: Settings = {
    ...loadSettings(),
    ...patch
  }
  if (patch.workspaces) {
    next.workspaces = Array.from(new Set(patch.workspaces.filter(Boolean)))
  }
  cached = next
  const file = settingsFile()
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  return next
}
