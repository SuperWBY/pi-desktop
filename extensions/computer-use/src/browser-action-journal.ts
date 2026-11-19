import { randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export type JournalBackend = 'inapp' | 'cdp' | 'extension' | 'desktop'
export type PendingBrowserAction = { id: string; backend: JournalBackend; ownerPid: number; ownerId: string; createdAt: number }

/** Transactional primitive; callers must write before sending any guarded action. */
export class BrowserActionJournal {
  private readonly db: DatabaseSync
  private readonly ownerId = randomUUID()

  constructor(path: string) {
    closeSync(openSync(path, 'a', 0o600))
    this.db = new DatabaseSync(path)
    try {
      this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS pending_actions (
          backend TEXT PRIMARY KEY CHECK(backend IN ('inapp','cdp','extension','desktop')),
          id TEXT NOT NULL UNIQUE, owner_pid INTEGER NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS action_runners (action_id TEXT PRIMARY KEY, runner_pid INTEGER NOT NULL)`)
    } catch (error) { this.db.close(); throw error }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = fn(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  pending(backend: JournalBackend): PendingBrowserAction | null {
    const row = this.db.prepare('SELECT id, backend, owner_pid, owner_id, created_at FROM pending_actions WHERE backend = ?').get(backend)
    if (!row) return null
    if (typeof row.id !== 'string' || typeof row.owner_id !== 'string' || typeof row.owner_pid !== 'number' || typeof row.created_at !== 'number' || row.backend !== backend) throw new Error('Invalid browser action journal record.')
    return { id: row.id, backend, ownerPid: row.owner_pid, ownerId: row.owner_id, createdAt: row.created_at }
  }

  claim(backend: JournalBackend): PendingBrowserAction {
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM pending_actions LIMIT 1').get()) throw new Error('A browser action is already pending.')
      const record = { id: randomUUID(), backend, ownerPid: process.pid, ownerId: this.ownerId, createdAt: Date.now() }
      this.db.prepare('INSERT INTO pending_actions (backend,id,owner_pid,owner_id,created_at) VALUES (?,?,?,?,?)').run(backend, record.id, record.ownerPid, record.ownerId, record.createdAt)
      return record
    })
  }

  private assertRunnerStopped(id: string): void {
    const runner = this.db.prepare('SELECT runner_pid FROM action_runners WHERE action_id = ?').get(id)
    if (!runner) return
    if (typeof runner.runner_pid !== 'number' || !Number.isSafeInteger(runner.runner_pid) || runner.runner_pid <= 1) throw new Error('Invalid action runner record.')
    try { process.kill(runner.runner_pid, 0); throw new Error('The action runner is still active.') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
  }

  attachRunner(backend: JournalBackend, id: string, pid: number): void {
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid action runner PID.')
    this.transaction(() => {
      const current = this.pending(backend)
      if (!current || current.id !== id || current.ownerId !== this.ownerId) throw new Error('The pending action changed or is owned by another process.')
      this.assertRunnerStopped(id)
      this.db.prepare('INSERT OR REPLACE INTO action_runners (action_id,runner_pid) VALUES (?,?)').run(id, pid)
    })
  }

  acknowledge(backend: JournalBackend, id: string): void {
    this.transaction(() => {
      this.assertRunnerStopped(id)
      const result = this.db.prepare('DELETE FROM pending_actions WHERE backend = ? AND id = ? AND owner_id = ?').run(backend, id, this.ownerId)
      if (Number(result.changes) !== 1) throw new Error('The pending action changed or was not found.')
      this.db.prepare('DELETE FROM action_runners WHERE action_id = ?').run(id)
    })
  }

  resolve(backend: JournalBackend, id: string, confirmed: boolean): void {
    if (!confirmed) throw new Error('User confirmation is required.')
    this.transaction(() => {
      const record = this.pending(backend)
      if (!record || record.id !== id) throw new Error('The pending action changed or was not found.')
      this.assertRunnerStopped(id)
      if (record.ownerId !== this.ownerId) {
        try { process.kill(record.ownerPid, 0); throw new Error('The action owner is still active.') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      }
      const result = this.db.prepare('DELETE FROM pending_actions WHERE backend = ? AND id = ?').run(backend, id)
      if (Number(result.changes) !== 1) throw new Error('The pending action changed or was not found.')
      this.db.prepare('DELETE FROM action_runners WHERE action_id = ?').run(id)
    })
  }

  close(): void { this.db.close() }
}
