import { execFileSync } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { session } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import type {
  ChromeDomain,
  ChromeImportResult,
  ChromeProfile
} from '@shared/types'

const BROWSER_PARTITION = 'persist:pi-browser'

interface CookieRow {
  host_key: string
  name: string
  value: string
  encrypted_value: Uint8Array | string | null
  path: string
  expires_utc: number
  is_secure: number
  is_httponly: number
  samesite: number
}

interface ChromeProfileMeta {
  name?: string
  user_name?: string
}

function chromeRoot(): string {
  if (process.env.PI_CHROME_ROOT) return process.env.PI_CHROME_ROOT
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
  }
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data')
  }
  return join(homedir(), '.config', 'google-chrome')
}

function cookieFile(profileDir: string): string | null {
  const candidates = [join(profileDir, 'Cookies'), join(profileDir, 'Network', 'Cookies')]
  return candidates.find((path) => existsSync(path)) ?? null
}

function profileMeta(): Record<string, ChromeProfileMeta> {
  try {
    const state = JSON.parse(readFileSync(join(chromeRoot(), 'Local State'), 'utf8')) as {
      profile?: { info_cache?: Record<string, ChromeProfileMeta> }
    }
    return state.profile?.info_cache ?? {}
  } catch {
    return {}
  }
}

function resolveProfile(id: string): { dir: string; db: string } {
  if (!/^[A-Za-z0-9 _-]+$/.test(id)) throw new Error('Invalid Chrome profile.')
  const root = chromeRoot()
  const dir = join(root, id)
  const db = cookieFile(dir)
  if (!db) throw new Error('This Chrome profile has no cookie database.')
  return { dir, db }
}

export function chromeRunning(): boolean {
  if (process.env.PI_CHROME_RUNNING === '0') return false
  if (process.platform === 'darwin') {
    try {
      execFileSync('pgrep', ['-x', 'Google Chrome'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq chrome.exe'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      })
      return out.includes('chrome.exe')
    } catch {
      return false
    }
  }
  return false
}

export function listChromeProfiles(): { profiles: ChromeProfile[]; running: boolean; error?: string } {
  const root = chromeRoot()
  if (!existsSync(root)) {
    return { profiles: [], running: false, error: 'Chrome is not installed.' }
  }
  const meta = profileMeta()
  const profiles: ChromeProfile[] = []
  for (const id of Object.keys(meta)) {
    const db = cookieFile(join(root, id))
    if (!db) continue
    profiles.push({
      id,
      name: meta[id].name || id,
      account: meta[id].user_name || undefined
    })
  }
  // Older profiles are still usable even if Local State has no entry.
  if (profiles.length === 0) {
    for (const id of ['Default', 'Profile 1', 'Profile 2', 'Profile 3']) {
      const db = cookieFile(join(root, id))
      if (db) profiles.push({ id, name: id })
    }
  }
  return { profiles, running: chromeRunning() }
}

function copyCookieDb(dbPath: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-chrome-'))
  const target = join(dir, 'Cookies')
  copyFileSync(dbPath, target)
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(`${dbPath}${suffix}`)) {
      copyFileSync(`${dbPath}${suffix}`, `${target}${suffix}`)
    }
  }
  return { dir, path: target }
}

function readCookies<T>(dbPath: string, sql: string, map: (row: CookieRow) => T): T[] {
  const copy = copyCookieDb(dbPath)
  try {
    const db = new DatabaseSync(copy.path, { readOnly: true })
    try {
      const rows = db.prepare(sql).all() as unknown as CookieRow[]
      return rows.map(map)
    } finally {
      db.close()
    }
  } finally {
    rmSync(copy.dir, { recursive: true, force: true })
  }
}

export function previewChromeProfile(id: string): { domains: ChromeDomain[]; running: boolean } {
  const { db } = resolveProfile(id)
  const grouped = readCookies(db, 'SELECT host_key, COUNT(*) AS count FROM cookies GROUP BY host_key', (row) => ({
    domain: String(row.host_key ?? '').replace(/^\./, ''),
    count: Number((row as unknown as { count: number }).count ?? 0)
  }))
  const merged = new Map<string, number>()
  for (const item of grouped) {
    if (!item.domain) continue
    merged.set(item.domain, (merged.get(item.domain) ?? 0) + item.count)
  }
  return {
    domains: [...merged.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)),
    running: chromeRunning()
  }
}

let cachedKey: string | null = null

function chromeKey(): string {
  if (process.platform !== 'darwin') throw new Error('Importing encrypted Chrome cookies is currently supported on macOS only.')
  if (cachedKey) return cachedKey
  const services = ['Chrome Safe Storage', 'Chromium Safe Storage', 'Chrome Beta Safe Storage', 'Chrome Canary Safe Storage']
  for (const service of services) {
    try {
      const key = execFileSync('/usr/bin/security', ['find-generic-password', '-w', '-s', service], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15_000
      }).trim()
      if (key) {
        cachedKey = key
        return key
      }
    } catch {
      // Try the next Chrome channel.
    }
  }
  throw new Error('Chrome Safe Storage was not available in Keychain.')
}

function decryptCookie(row: CookieRow): string {
  const raw = Buffer.from(row.encrypted_value ?? [])
  if (raw.length < 3) return row.value ?? ''
  const prefix = raw.subarray(0, 3).toString('ascii')
  if (prefix === 'v20') {
    throw new Error('This Chrome version uses app-bound cookie encryption, which is not supported yet.')
  }
  if (prefix !== 'v10' && prefix !== 'v11') {
    return row.value ?? raw.toString('utf8')
  }
  const key = pbkdf2Sync(chromeKey(), 'saltysalt', 1003, 16, 'sha1')
  const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  return Buffer.concat([decipher.update(raw.subarray(3)), decipher.final()]).toString('utf8')
}

function chromeExpiry(value: number): number | undefined {
  if (!value) return undefined
  const unix = value / 1_000_000 - 11_644_473_600
  return unix > 0 ? unix : undefined
}

function sameSite(value: number): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  if (value === 0) return 'no_restriction'
  if (value === 1) return 'lax'
  if (value === 2) return 'strict'
  return 'unspecified'
}

export async function importChromeCookies(id: string, requestedDomains: string[]): Promise<ChromeImportResult> {
  const domains = new Set(
    requestedDomains
      .map((domain) => domain.trim().toLowerCase().replace(/^\./, ''))
      .filter((domain) => domain && /^[a-z0-9.-]+$/.test(domain))
  )
  if (domains.size === 0) return { ok: false, imported: 0, skipped: 0, failed: 0, errors: [], error: 'Select at least one site.' }
  if (chromeRunning()) {
    return {
      ok: false,
      imported: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      error: 'Quit Google Chrome before importing cookies.'
    }
  }

  const { db } = resolveProfile(id)
  let rows: CookieRow[]
  try {
    rows = readCookies(
      db,
      `SELECT host_key, name, value, encrypted_value, path, expires_utc,
              is_secure, is_httponly, samesite FROM cookies`,
      (row) => row
    )
  } catch (error) {
    return {
      ok: false,
      imported: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }

  const target = session.fromPartition(BROWSER_PARTITION)
  let imported = 0
  let skipped = 0
  let failed = 0
  const errors: { domain: string; reason: string }[] = []

  for (const row of rows) {
    const host = String(row.host_key ?? '').replace(/^\./, '').toLowerCase()
    if (![...domains].some((domain) => host === domain || host.endsWith(`.${domain}`))) continue
    try {
      const value = decryptCookie(row)
      if (!value) {
        skipped += 1
        continue
      }
      const path = row.path?.startsWith('/') ? row.path : '/'
      const secure = Boolean(row.is_secure)
      const url = `${secure ? 'https' : 'http'}://${host}${path}`
      const expirationDate = chromeExpiry(Number(row.expires_utc ?? 0))
      if (expirationDate !== undefined && expirationDate <= Date.now() / 1000) {
        skipped += 1
        continue
      }
      const details: Electron.CookiesSetDetails = {
        url,
        name: String(row.name ?? ''),
        value,
        path,
        secure,
        httpOnly: Boolean(row.is_httponly),
        sameSite: sameSite(Number(row.samesite ?? -1))
      }
      if (expirationDate !== undefined) details.expirationDate = expirationDate
      // __Host- cookies must not carry a Domain attribute.
      if (row.host_key.startsWith('.') && !row.name.startsWith('__Host-')) {
        details.domain = row.host_key
      }
      await target.cookies.set(details)
      imported += 1
    } catch (error) {
      failed += 1
      if (errors.length < 20) {
        errors.push({
          domain: host,
          reason: error instanceof Error ? error.message : 'Could not import cookie.'
        })
      }
    }
  }

  await target.cookies.flushStore()
  return { ok: failed === 0, imported, skipped, failed, errors }
}
