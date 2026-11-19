import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '@shared/types'

const defaults: Settings = {
  theme: 'dark',
  language: 'zh-CN',
  workspaces: [],
  toolCardsExpanded: false,
  followStream: true,
  computerUseEnabled: false
}

let cached: Settings | null = null

export function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function projectFolders(paths: string[]): string[] {
  const folders = new Set<string>()
  for (const path of paths) {
    if (typeof path !== 'string' || !path) continue
    try {
      folders.add(realpathSync.native(path))
    } catch {
      // Keep disconnected volumes and temporarily unavailable projects in the list.
      folders.add(path)
    }
  }
  return [...folders]
}

export function loadSettings(): Settings {
  if (cached) return cached
  try {
    const raw = readFileSync(settingsFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    cached = {
      ...defaults,
      ...parsed,
      toolApprovalMode: parsed.toolApprovalMode === 'all' ? 'all' : 'dangerous',
      allowFullAccess: parsed.allowFullAccess === true,
      computerUseEnabled: parsed.computerUseEnabled === true,
      language: parsed.language === 'en' ? 'en' : 'zh-CN',
      workspaces: projectFolders(parsed.workspaces ?? [])
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
  if (next.language !== 'en') next.language = 'zh-CN'
  next.toolApprovalMode = next.toolApprovalMode === 'all' ? 'all' : 'dangerous'
  next.allowFullAccess = next.allowFullAccess === true
  if (patch.workspaces) {
    next.workspaces = projectFolders(patch.workspaces)
  }
  const file = settingsFile()
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  cached = next
  return next
}
