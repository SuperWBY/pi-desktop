import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SessionNotice } from '@shared/types'

const MAX_NOTICES = 500

function noticeFile(): string {
  return join(app.getPath('userData'), 'session-notices.json')
}

function load(): SessionNotice[] {
  const file = noticeFile()
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { notices?: SessionNotice[] }
    return Array.isArray(parsed.notices) ? parsed.notices : []
  } catch {
    return []
  }
}

function save(notices: SessionNotice[]): void {
  const file = noticeFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: 1, notices: notices.slice(0, MAX_NOTICES) }, null, 2))
}

export function addSessionNotice(notice: SessionNotice): void {
  const notices = load().filter((item) => item.id !== notice.id)
  notices.unshift(notice)
  save(notices)
}

export function listSessionNotices(sessionPath: string): SessionNotice[] {
  return load()
    .filter((notice) => notice.sessionPath === sessionPath)
    .sort((a, b) => a.createdAt - b.createdAt)
}
