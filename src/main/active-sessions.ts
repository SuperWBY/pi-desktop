import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

function file(): string {
  return join(app.getPath('userData'), 'active-sessions.json')
}

function load(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [cwd, path] of Object.entries(parsed)) {
      if (typeof path === 'string') out[cwd] = path
    }
    return out
  } catch {
    return {}
  }
}

export function rememberActiveSession(cwd: string, sessionPath: string): void {
  const map = load()
  map[cwd] = sessionPath
  mkdirSync(dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify(map, null, 2))
}
