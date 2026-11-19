import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface InterruptedUiEntry { id: string; cwd: string; sessionPath: string | null; at: number; state: 'pending' | 'interrupted' }

/** Minimal local record: never stores the prompt, confirmation text or response. */
export class InterruptedUiJournal {
  private file: string
  private entries: InterruptedUiEntry[]
  constructor(file: string) {
    this.file = file
    const parsed: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
    if (!Array.isArray(parsed) || !parsed.every((x) => x && typeof x.id === 'string' && typeof x.cwd === 'string' && (x.sessionPath === null || typeof x.sessionPath === 'string') && typeof x.at === 'number' && (x.state === 'pending' || x.state === 'interrupted'))) throw new Error('Invalid interrupted confirmation journal')
    this.entries = parsed.map((entry) => ({ ...entry, state: 'interrupted' }))
    if (parsed.some((entry) => entry.state === 'pending')) this.save(this.entries)
  }
  private save(entries: InterruptedUiEntry[]): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = `${this.file}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      fd = openSync(temp, 'wx', 0o600)
      writeFileSync(fd, JSON.stringify(entries))
      fsyncSync(fd)
      closeSync(fd); fd = undefined
      renameSync(temp, this.file)
    } catch (error) {
      if (fd !== undefined) closeSync(fd)
      try { unlinkSync(temp) } catch { /* no temporary file */ }
      throw error
    }
  }
  private replace(entries: InterruptedUiEntry[]): void { this.save(entries); this.entries = entries }
  begin(id: string, meta: { cwd: string; sessionPath: string | null }): void {
    if (this.entries.some((entry) => entry.id === id)) throw new Error('Duplicate interrupted confirmation ID')
    this.replace([...this.entries, { id, ...meta, at: Date.now(), state: 'pending' }])
  }
  finish(id: string): void { this.replace(this.entries.filter((entry) => entry.id !== id)) }
  interrupt(id: string): void { this.replace(this.entries.map((entry) => entry.id === id ? { ...entry, state: 'interrupted' } : entry)) }
  acknowledge(id: string): void { this.replace(this.entries.filter((entry) => entry.id !== id || entry.state !== 'interrupted')) }
  interrupted(): InterruptedUiEntry[] { return this.entries.filter((entry) => entry.state === 'interrupted').map((entry) => ({ ...entry })) }
}
