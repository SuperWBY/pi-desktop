import { useSyncExternalStore } from 'react'
import type { Attachment } from '../store'

export type ComposerDraft = { text: string; attachments: Attachment[] }
type DraftLocation = { key: string; workspace: string; scratch: boolean; draftOnly: boolean; updatedAt: number }

const drafts = new Map<string, ComposerDraft>()
const listeners = new Set<() => void>()
const indexKey = 'pi.composer.draftLocations'
const textKey = (key: string): string => `pi.composer.draft.${key}`

let locations: DraftLocation[] = []
try {
  const stored: unknown = JSON.parse(localStorage.getItem(indexKey) ?? '[]')
  if (Array.isArray(stored)) {
    locations = stored.filter((item): item is DraftLocation => item &&
      typeof item.key === 'string' && typeof item.workspace === 'string' &&
      typeof item.scratch === 'boolean' && typeof item.draftOnly === 'boolean' && typeof item.updatedAt === 'number' &&
      Boolean(localStorage.getItem(textKey(item.key))?.trim()))
  }
  const legacyPrefix = textKey('project:')
  for (const storageKey of Object.keys(localStorage)) {
    if (!storageKey.startsWith(legacyPrefix) || !localStorage.getItem(storageKey)?.trim()) continue
    const workspace = storageKey.slice(legacyPrefix.length)
    const key = `project:${workspace}`
    if (workspace && !locations.some((item) => item.key === key)) {
      locations.push({ key, workspace, scratch: false, draftOnly: true, updatedAt: 0 })
    }
  }
} catch { /* The index is also kept in memory. */ }

export function readDraft(key: string): ComposerDraft {
  const cached = drafts.get(key)
  if (cached) return cached
  try { return { text: localStorage.getItem(textKey(key)) ?? '', attachments: [] } }
  catch { return { text: '', attachments: [] } }
}

export function saveDraft(key: string, draft: ComposerDraft, location?: Pick<DraftLocation, 'workspace' | 'scratch' | 'draftOnly'>): void {
  const hasDraft = Boolean(draft.text.trim() || draft.attachments.length)
  const old = locations.find((item) => item.key === key)
  if (hasDraft) drafts.set(key, draft)
  else drafts.delete(key)
  try {
    if (draft.text.trim()) localStorage.setItem(textKey(key), draft.text)
    else localStorage.removeItem(textKey(key))
  } catch { /* The in-memory draft still works when storage is unavailable. */ }

  if (hasDraft && location?.workspace) {
    // Refresh subscribers so a draft-only row can display its current preview.
    locations = [...locations.filter((item) => item.key !== key), {
      key, workspace: location.workspace, scratch: location.scratch, draftOnly: location.draftOnly,
      updatedAt: old?.updatedAt || Date.now()
    }]
  } else if (!hasDraft && old) {
    locations = locations.filter((item) => item.key !== key)
  } else return

  try { localStorage.setItem(indexKey, JSON.stringify(locations)) } catch { /* Keep the in-memory index. */ }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useDraftLocations(): DraftLocation[] {
  return useSyncExternalStore(subscribe, () => locations)
}
