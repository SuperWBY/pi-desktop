import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, truncateSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024

function filePath(): string {
  return join(app.getPath('userData'), 'sandbox', 'audit.jsonl')
}

function ensureFile(): string {
  const path = filePath()
  mkdirSync(join(app.getPath('userData'), 'sandbox'), { recursive: true, mode: 0o700 })
  if (existsSync(path) && statSync(path).size > MAX_BYTES) {
    try { truncateSync(path, 0) } catch { /* best effort */ }
  }
  return path
}

export function appendSandboxAudit(event: Record<string, unknown>): void {
  try {
    appendFileSync(ensureFile(), `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`, { mode: 0o600 })
  } catch { /* audit must never break a session */ }
}

export function readSandboxAudit(limit = 200): string[] {
  try {
    const path = filePath()
    if (!existsSync(path)) return []
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    return lines.slice(-Math.max(1, Math.min(limit, 1000)))
  } catch {
    return []
  }
}
