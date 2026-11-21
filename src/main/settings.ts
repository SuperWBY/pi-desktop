import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { canonicalWorkspacePath, pathsEqual } from '@shared/paths'
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

function folderName(names: Record<string, string> | undefined, path: string): string | undefined {
  if (!names) return undefined
  const direct = names[path]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const alias = Object.entries(names).find(([key, value]) => typeof value === 'string' && value.trim() && pathsEqual(key, path))
  return alias?.[1].trim()
}

function projectFolders(paths: string[], names?: Record<string, string>): string[] {
  const chosen = new Map<string, string>()
  for (const path of paths) {
    if (typeof path !== 'string' || !path) continue
    let resolved = path
    try {
      resolved = realpathSync.native(path)
    } catch {
      // Keep disconnected volumes and temporarily unavailable projects in the list.
      resolved = path
    }
    const key = canonicalWorkspacePath(resolved)
    const current = chosen.get(key)
    // /var and /private/var are the same folder. Prefer the entry that has a name.
    if (!current || (!folderName(names, current) && folderName(names, resolved))) chosen.set(key, resolved)
  }
  return [...chosen.values()]
}

function remapWorkspaceNames(names: Record<string, string> | undefined, folders: string[]): Record<string, string> | undefined {
  if (!names) return names
  const next: Record<string, string> = {}
  for (const folder of folders) {
    const name = folderName(names, folder)
    if (name) next[folder] = name
  }
  return next
}

export function loadSettings(): Settings {
  if (cached) return cached
  try {
    const raw = readFileSync(settingsFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    const workspaces = projectFolders(parsed.workspaces ?? [], parsed.workspaceNames)
    cached = {
      ...defaults,
      ...parsed,
      // Retire the workshop tab without reopening an empty side panel on upgrade.
      ...(parsed.workPanelTab === 'creator' ? { workPanelOpen: false, workPanelTab: 'home' as const } : {}),
      ...(parsed.workPanelTabs ? { workPanelTabs: parsed.workPanelTabs.filter(tab => tab !== 'creator') } : {}),
      toolApprovalMode: parsed.toolApprovalMode === 'all' ? 'all' : 'dangerous',
      computerUseEnabled: parsed.computerUseEnabled === true,
      language: parsed.language === 'en' ? 'en' : 'zh-CN',
      workspaces,
      workspaceNames: remapWorkspaceNames(parsed.workspaceNames, workspaces)
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
  if (patch.workspaces || patch.workspaceNames) {
    next.workspaces = projectFolders(next.workspaces, next.workspaceNames)
    next.workspaceNames = remapWorkspaceNames(next.workspaceNames, next.workspaces)
  }
  const file = settingsFile()
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  cached = next
  return next
}
