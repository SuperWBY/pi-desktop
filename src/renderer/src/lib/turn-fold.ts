import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Turn } from './turns'

/** 0 = full, 1 = steps (answer + one summary line), 2 = compact. */
export type FoldLevel = 0 | 1 | 2

export interface FoldEntry {
  level: FoldLevel
  manual: boolean
}

export type FoldMap = Record<string, FoldEntry>

export interface FoldSettings {
  autoFold: boolean
  aggregateAfter: number
  defaultLevel: FoldLevel
}

const DEFAULT_SETTINGS: FoldSettings = { autoFold: true, aggregateAfter: 5, defaultLevel: 1 }

function storageKey(sessionPath: string | null): string {
  return `pi.folds.${sessionPath ?? 'draft'}`
}

export function loadFolds(sessionPath: string | null): FoldMap {
  try {
    const raw = localStorage.getItem(storageKey(sessionPath))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as FoldMap
    if (!parsed || typeof parsed !== 'object') return {}
    const result: FoldMap = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const level = (value as FoldEntry).level
      if (level !== 0 && level !== 1 && level !== 2) continue
      result[key] = { level, manual: Boolean((value as FoldEntry).manual) }
    }
    return result
  } catch {
    return {}
  }
}

export function saveFolds(sessionPath: string | null, map: FoldMap): void {
  try {
    localStorage.setItem(storageKey(sessionPath), JSON.stringify(map))
  } catch {
    // storage full / disabled: folding still works in memory
  }
}

/**
 * Per-turn fold state with persistence, plus the automatic policy:
 * a streaming turn is always expanded, a finished turn collapses to `steps`
 * (Codex's contract: process is folded once the final answer landed), and
 * anything older than `aggregateAfter` turns is aggregated above.
 */
export function useTurnFolds(
  sessionPath: string | null,
  turns: Turn[],
  settings: FoldSettings = DEFAULT_SETTINGS
): {
  levelOf: (turn: Turn) => FoldLevel
  setLevel: (turn: Turn, level: FoldLevel) => void
  collapseAll: () => void
  expandAll: () => void
  reset: () => void
} {
  const [map, setMap] = useState<FoldMap>(() => loadFolds(sessionPath))
  const sessionRef = useRef(sessionPath)

  useEffect(() => {
    if (sessionRef.current === sessionPath) return
    sessionRef.current = sessionPath
    setMap(loadFolds(sessionPath))
  }, [sessionPath])

  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => saveFolds(sessionRef.current, map), 200)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [map])

  const levelOf = useCallback(
    (turn: Turn): FoldLevel => {
      if (turn.streaming) return 0
      const entry = map[turn.key]
      if (entry) return entry.level
      return settings.autoFold ? settings.defaultLevel : 0
    },
    [map, settings.autoFold, settings.defaultLevel]
  )

  const setLevel = useCallback((turn: Turn, level: FoldLevel) => {
    setMap((current) => ({ ...current, [turn.key]: { level, manual: true } }))
  }, [])

  const collapseAll = useCallback(() => {
    setMap((current) => {
      const next: FoldMap = { ...current }
      for (const turn of turns) next[turn.key] = { level: 2, manual: true }
      return next
    })
  }, [turns])

  const expandAll = useCallback(() => {
    setMap((current) => {
      const next: FoldMap = { ...current }
      for (const turn of turns) next[turn.key] = { level: 0, manual: true }
      return next
    })
  }, [turns])

  const reset = useCallback(() => setMap({}), [])

  return useMemo(
    () => ({ levelOf, setLevel, collapseAll, expandAll, reset }),
    [levelOf, setLevel, collapseAll, expandAll, reset]
  )
}

export { DEFAULT_SETTINGS as DEFAULT_FOLD_SETTINGS }
