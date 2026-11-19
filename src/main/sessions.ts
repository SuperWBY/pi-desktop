import { chmodSync, mkdirSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SessionSearchMatch, SessionSummary } from '@shared/types'

interface IndexedMessage {
  role: 'user' | 'assistant'
  text: string
}

interface CacheEntry {
  mtimeMs: number
  size: number
  summary: SessionSummary | null
  messages?: IndexedMessage[]
}

const cache = new Map<string, CacheEntry>()
let indexDb: DatabaseSync | null | undefined
let indexUnavailable = false

function sessionIndex(): DatabaseSync | null {
  if (indexDb !== undefined) return indexDb
  try {
    const root = sessionsRoot()
    mkdirSync(root, { recursive: true })
    const indexPath = join(root, '.session-search.sqlite')
    const db = new DatabaseSync(indexPath)
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions (path TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL, summary TEXT NOT NULL, indexed INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS messages (path TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(path, seq)); CREATE INDEX IF NOT EXISTS messages_path ON messages(path);")
    try { chmodSync(indexPath, 0o600) } catch { /* best effort */ }
    indexDb = db
  } catch {
    indexUnavailable = true
    indexDb = null
  }
  return indexDb
}

function cachedSummary(file: string, mtimeMs: number, size: number): SessionSummary | null | undefined {
  const row = sessionIndex()?.prepare('SELECT summary, indexed FROM sessions WHERE path = ? AND mtime = ? AND size = ?').get(file, mtimeMs, size) as { summary: string; indexed: number } | undefined
  if (!row) return undefined
  try {
    return JSON.parse(row.summary) as SessionSummary
  } catch {
    return undefined
  }
}

function storeSummary(file: string, mtimeMs: number, size: number, summary: SessionSummary, messages: IndexedMessage[] | null): void {
  const db = sessionIndex()
  if (!db) return
  try {
    db.prepare('INSERT INTO sessions(path, mtime, size, summary, indexed) VALUES(?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size, summary=excluded.summary, indexed=excluded.indexed').run(file, mtimeMs, size, JSON.stringify(summary), messages ? 1 : 0)
    if (messages) {
      db.prepare('DELETE FROM messages WHERE path = ?').run(file)
      const insert = db.prepare('INSERT INTO messages(path, seq, role, text) VALUES(?, ?, ?, ?)')
      messages.forEach((message, index) => insert.run(file, index, message.role, message.text))
    }
  } catch { /* index is an optimization; never fail the session list */ }
}

function hasIndexedMessages(file: string): boolean {
  try {
    const row = sessionIndex()?.prepare('SELECT indexed FROM sessions WHERE path = ?').get(file) as { indexed: number } | undefined
    return row?.indexed === 1
  } catch { return false }
}

export function sessionsRoot(): string {
  const configured = process.env.PI_CODING_AGENT_SESSION_DIR?.trim()
  return configured || join(homedir(), '.pi', 'agent', 'sessions')
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        return String((block as { text?: string }).text ?? '')
      }
      return ''
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function readSession(file: string, force = false): Promise<{ summary: SessionSummary; messages: IndexedMessage[] } | null> {
  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    return null
  }

  const cached = cache.get(file)
  if (!force && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.summary ? { summary: cached.summary, messages: cached.messages ?? [] } : null
  }

  const header: { id?: string; cwd?: string; timestamp?: string } = {}
  let name: string | undefined
  let preview = ''
  let messageCount = 0
  let updatedAt = stat.mtimeMs
  const messages: IndexedMessage[] = []

  try {
    const raw = await fs.readFile(file, 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let entry: Record<string, unknown>
      try {
        entry = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }

      if (entry.type === 'session') {
        if (typeof entry.id === 'string') header.id = entry.id
        if (typeof entry.cwd === 'string') header.cwd = entry.cwd
        if (typeof entry.timestamp === 'string') header.timestamp = entry.timestamp
      } else if (entry.type === 'session_info') {
        const value = (entry as { name?: unknown }).name
        name = typeof value === 'string' && value.trim() ? value.trim() : undefined
      } else if (entry.type === 'message') {
        messageCount += 1
        const message = entry.message as { role?: string; content?: unknown } | undefined
        if (message?.role === 'user' || message?.role === 'assistant') {
          const text = textOf(message.content).slice(0, 20000)
          if (text) messages.push({ role: message.role, text })
        }
        if (message?.role === 'user' && !preview) {
          preview = textOf(message.content).slice(0, 160)
        }
      }

      const timestamp = entry.timestamp
      if (typeof timestamp === 'string') {
        const parsed = Date.parse(timestamp)
        if (!Number.isNaN(parsed) && parsed > updatedAt) updatedAt = parsed
      } else if (typeof timestamp === 'number' && timestamp > updatedAt) {
        updatedAt = timestamp
      }
    }
  } catch {
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, summary: null })
    return null
  }

  const createdAt = header.timestamp ? Date.parse(header.timestamp) : stat.birthtimeMs
  const summary: SessionSummary = {
    path: file,
    id: header.id ?? basename(file, '.jsonl'),
    cwd: header.cwd ?? homedir(),
    name: name || preview || '未命名会话',
    preview,
    updatedAt,
    createdAt: Number.isNaN(createdAt) ? stat.birthtimeMs : createdAt,
    messageCount,
    size: stat.size
  }

  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, summary, messages })
  storeSummary(file, stat.mtimeMs, stat.size, summary, messages)
  return { summary, messages }
}

async function summarize(file: string): Promise<SessionSummary | null> {
  const cached = cache.get(file)
  if (cached?.summary) return cached.summary
  return (await readSession(file))?.summary ?? null
}

export async function listSessions(): Promise<SessionSummary[]> {
  const root = sessionsRoot()
  let dirs: string[]
  try {
    dirs = await fs.readdir(root)
  } catch {
    return []
  }

  const summaries = await Promise.all(
    dirs.map(async (dirName) => {
      if (dirName.startsWith('.')) return []
      const dir = join(root, dirName)
      try {
        const stat = await fs.stat(dir)
        if (!stat.isDirectory()) return []
        const files = await fs.readdir(dir)
        return Promise.all(
          files.filter((file) => file.endsWith('.jsonl')).map(async (file) => {
            const path = join(dir, file)
            try {
              const stat = await fs.stat(path)
              const indexed = cachedSummary(path, stat.mtimeMs, stat.size)
              if (indexed !== undefined) {
                cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, summary: indexed })
                return indexed
              }
            } catch { /* fall through to the full parser */ }
            return summarize(path)
          })
        )
      } catch {
        return []
      }
    })
  )

  return summaries
    .flat()
    .filter((item): item is SessionSummary => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function searchSessions(query: string, limit = 40): Promise<SessionSearchMatch[]> {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  const summaries = await listSessions()
  const byPath = new Map(summaries.map((session) => [session.path, session]))
  const results: SessionSearchMatch[] = []

  // First-time search builds the message index for sessions that predate it.
  for (const session of summaries) {
    if (!hasIndexedMessages(session.path)) {
      const restored = await readSession(session.path, true)
      if (restored) {
        const stat = await fs.stat(session.path)
        storeSummary(session.path, stat.mtimeMs, stat.size, restored.summary, restored.messages)
      }
    }
  }

  const db = sessionIndex()
  if (db) {
    try {
      const escaped = needle.replace(/[\\%_]/g, '\\$&')
      const rows = db.prepare("SELECT path, role, text FROM messages WHERE text LIKE ? ESCAPE '\\' ORDER BY rowid DESC LIMIT 400").all(`%${escaped}%`) as { path: string; role: string; text: string }[]
      const grouped = new Map<string, { role: 'user' | 'assistant'; text: string }[]>()
      for (const row of rows) {
        const list = grouped.get(row.path) ?? []
        if (list.length < 3 && byPath.has(row.path)) list.push({ role: row.role === 'user' ? 'user' : 'assistant', text: previewSnippet(row.text, needle) })
        grouped.set(row.path, list)
      }
      for (const [path, matches] of grouped) {
        if (results.length >= limit) break
        const session = byPath.get(path)
        if (session && matches.length) results.push({ session, matches })
      }
    } catch { /* fall back to the file scan below */ }
  }

  if (results.length) return results

  // Metadata matches and a resilient fallback when SQLite is unavailable.
  for (const session of summaries) {
    if (results.length >= limit) break
    const matches: { role: 'user' | 'assistant'; text: string }[] = []
    if (`${session.name} ${session.preview} ${session.cwd}`.toLowerCase().includes(needle)) {
      matches.push({ role: 'assistant', text: session.preview || session.name })
    }
    if (matches.length) results.push({ session, matches })
  }
  if (results.length || !indexUnavailable) return results

  // Older runtimes without node:sqlite still get full-text search.
  for (const session of summaries) {
    if (results.length >= limit) break
    const matches: { role: 'user' | 'assistant'; text: string }[] = []
    if (`${session.name} ${session.preview} ${session.cwd}`.toLowerCase().includes(needle)) {
      matches.push({ role: 'assistant', text: session.preview || session.name })
    }
    try {
      const raw = await fs.readFile(session.path, 'utf8')
      for (const line of raw.split('\n')) {
        if (!line.trim() || matches.length >= 3) continue
        let entry: Record<string, unknown>
        try { entry = JSON.parse(line) as Record<string, unknown> } catch { continue }
        if (entry.type !== 'message') continue
        const message = entry.message as { role?: string; content?: unknown } | undefined
        if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue
        const text = textOf(message.content)
        if (!text || !text.toLowerCase().includes(needle)) continue
        matches.push({ role: message.role, text: previewSnippet(text, needle) })
      }
    } catch { /* skip unreadable session */ }
    if (matches.length) results.push({ session, matches })
  }
  return results
}

function previewSnippet(text: string, needle: string): string {
  const index = text.toLowerCase().indexOf(needle)
  const start = Math.max(0, index - 60)
  return `${start > 0 ? '…' : ''}${text.slice(start, start + 180)}${start + 180 < text.length ? '…' : ''}`
}

export interface DeletedSession {
  path: string
  trashPath: string
  name: string
}

/** Soft delete: move the transcript into `<sessions>/.trash` so it can be undone. */
export async function deleteSession(file: string): Promise<DeletedSession | null> {
  const root = resolve(sessionsRoot())
  const target = resolve(file)
  if (!target.startsWith(root + sep)) throw new Error('Session is outside the session directory')
  const trashDir = join(root, '.trash')
  await fs.mkdir(trashDir, { recursive: true })
  const trashPath = join(trashDir, `${Date.now()}-${basename(target)}`)
  await fs.rename(target, trashPath)
  cache.delete(target)
  return { path: target, trashPath, name: basename(target, '.jsonl') }
}

export async function restoreSession(trashPath: string, target: string): Promise<boolean> {
  const root = resolve(sessionsRoot())
  const trashDir = join(root, '.trash')
  const from = resolve(trashPath)
  const dest = resolve(target)
  if (!from.startsWith(trashDir + sep)) throw new Error('Not a trashed session')
  if (!dest.startsWith(root + sep)) throw new Error('Session is outside the session directory')
  await fs.mkdir(dirname(dest), { recursive: true })
  await fs.rename(from, dest)
  cache.delete(dest)
  return true
}

export async function sessionExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file)
    return stat.isFile()
  } catch {
    return false
  }
}
