import { randomUUID } from 'node:crypto'
import type { PiRecord } from '@shared/types'

type Request = { owner: object; originalId: string; record: PiRecord; timer?: ReturnType<typeof setTimeout> }
type JournalHooks = { begin: (owner: object, token: string) => void; finish: (token: string) => void; interrupt: (token: string) => void; error: () => void }
const informational = new Set(['creator_result', 'creator_state', 'notify', 'setStatus', 'setTitle', 'setWidget', 'set_editor_text'])

/** Keeps UI requests bound to the Pi process that emitted them. */
export class SessionUiRequests {
  private current: object | null = null
  private requests = new Map<string, Request>()
  private send: (record: PiRecord) => void
  private reply: (owner: object, response: Record<string, unknown>) => void
  private changed: () => void
  private journal?: JournalHooks
  constructor(send: (record: PiRecord) => void, reply: (owner: object, response: Record<string, unknown>) => void, changed: () => void = () => {}, journal?: JournalHooks) { this.send = send; this.reply = reply; this.changed = changed; this.journal = journal }
  pendingOwners(): object[] { return [...new Set([...this.requests.values()].map((item) => item.owner))] }

  receive(owner: object, record: PiRecord): boolean {
    if (record.type !== 'extension_ui_request' || typeof record.id !== 'string' || informational.has(String(record.method))) return false
    const token = randomUUID()
    try { this.journal?.begin(owner, token) } catch { this.journal?.error(); this.reply(owner, { type: 'extension_ui_response', id: record.id, cancelled: true }); return true }
    const item: Request = { owner, originalId: record.id, record: { ...record, id: token } }
    const timeout = Number(record.timeout)
    if (Number.isFinite(timeout) && timeout > 0) {
      item.timer = setTimeout(() => { this.requests.delete(token); try { this.journal?.finish(token) } catch { this.journal?.error() }; if (this.current === owner) this.refresh(); this.changed() }, timeout)
      item.timer.unref()
    }
    this.requests.set(token, item)
    if (this.current === owner) this.send(item.record)
    this.changed()
    return true
  }

  activate(owner: object | null): void { this.current = owner; this.refresh(); this.changed() }
  private refresh(): void {
    this.send({ type: 'desktop_ui_requests_reset' })
    for (const item of this.requests.values()) if (item.owner === this.current) this.send(item.record)
  }
  respond(response: Record<string, unknown>): boolean {
    if (typeof response.id !== 'string' || response.type !== 'extension_ui_response') return false
    const item = this.requests.get(response.id)
    if (!item || item.owner !== this.current) return false
    this.requests.delete(response.id)
    if (item.timer) clearTimeout(item.timer)
    try { this.journal?.finish(response.id) } catch { this.journal?.error(); this.reply(item.owner, { type: 'extension_ui_response', id: item.originalId, cancelled: true }); this.changed(); return true }
    this.reply(item.owner, { ...response, id: item.originalId })
    this.changed()
    return true
  }
  drop(owner: object): void {
    for (const [id, item] of this.requests) if (item.owner === owner) { if (item.timer) clearTimeout(item.timer); this.requests.delete(id); try { this.journal?.interrupt(id) } catch { this.journal?.error() } }
    if (this.current === owner) this.activate(null)
    else this.changed()
  }
  dispose(): void { for (const item of this.requests.values()) if (item.timer) clearTimeout(item.timer); this.requests.clear(); this.current = null }
}
