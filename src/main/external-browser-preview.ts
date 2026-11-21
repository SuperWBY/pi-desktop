import { randomUUID } from 'node:crypto'

type Backend = 'cdp' | 'extension'
type ExternalFrame = { documentId: string; url: string; image: string; at: number }
type Slot = { owner: string; backend: Backend; generation: string; frame: ExternalFrame | null }
const slots = new Map<string, Slot>()
const UUID = /^[a-f0-9-]{36}$/i
const TTL = 15_000

/** Ephemeral, task-scoped frames. Never write browser images to the transcript or disk. */
export function storeExternalFrame(owner: string, data: Record<string, unknown>): string {
  const { sessionId, documentId, url, backend, image, generation } = data
  if (!owner || owner.length > 128 || typeof sessionId !== 'string' || !UUID.test(sessionId) ||
      (backend !== 'cdp' && backend !== 'extension')) throw new Error('Invalid preview owner or session.')
  const existing = slots.get(sessionId)
  if (existing && (existing.owner !== owner || existing.backend !== backend)) throw new Error('Preview belongs to another task.')
  if (image === null) {
    if (slots.size >= 16 && !existing) slots.delete(slots.keys().next().value!)
    const slot: Slot = { owner, backend, generation: randomUUID(), frame: null }
    slots.set(sessionId, slot)
    const timer = setTimeout(() => { if (slots.get(sessionId) === slot) slots.delete(sessionId) }, TTL)
    timer.unref()
    return slot.generation
  }
  if (!existing || typeof generation !== 'string' || generation !== existing.generation) throw new Error('Preview is outdated; observe again.')
  if (typeof documentId !== 'string' || !documentId || documentId.length > 512 || typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 8192 ||
      typeof image !== 'string' || image.length > 1_500_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error('Invalid preview image or page identity.')
  const published: Slot = { ...existing, frame: { documentId, url, image, at: Date.now() } }
  slots.set(sessionId, published)
  const timer = setTimeout(() => { if (slots.get(sessionId) === published) slots.delete(sessionId) }, TTL)
  timer.unref()
  return published.generation
}

export function externalBrowserFrame(sessionId: string, backend: string, documentId: string, url: string, generation: string): { image: string; at: number } | null {
  const slot = slots.get(sessionId)
  const frame = slot?.frame
  if (!slot || !frame || slot.generation !== generation || Date.now() - frame.at > TTL || slot.backend !== backend || frame.documentId !== documentId || frame.url !== url) return null
  return { image: frame.image, at: frame.at }
}
export function clearExternalFrames(): void { slots.clear() }
