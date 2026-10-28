import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import type { SessionSummary } from '@shared/types'

interface CacheEntry {
  mtimeMs: number
  size: number
  summary: SessionSummary | null
}

const cache = new Map<string, CacheEntry>()

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

async function summarize(file: string): Promise<SessionSummary | null> {
  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    return null
  }

  const cached = cache.get(file)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.summary
  }

  const header: { id?: string; cwd?: string; timestamp?: string } = {}
  let name: string | undefined
  let preview = ''
  let messageCount = 0
  let updatedAt = stat.mtimeMs

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
    name: name || preview || 'Untitled session',
    preview,
    updatedAt,
    createdAt: Number.isNaN(createdAt) ? stat.birthtimeMs : createdAt,
    messageCount,
    size: stat.size
  }

  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, summary })
  return summary
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
      const dir = join(root, dirName)
      try {
        const stat = await fs.stat(dir)
        if (!stat.isDirectory()) return []
        const files = await fs.readdir(dir)
        return Promise.all(
          files.filter((file) => file.endsWith('.jsonl')).map((file) => summarize(join(dir, file)))
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

export async function deleteSession(file: string): Promise<boolean> {
  const root = resolve(sessionsRoot())
  const target = resolve(file)
  if (!target.startsWith(root + sep)) throw new Error('Session is outside the session directory')
  await fs.unlink(target)
  cache.delete(target)
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
