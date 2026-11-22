import type { ContextBreakdown, ContextCategoryId, SessionStats } from '@shared/types'

const categories = new Set<ContextCategoryId>(['system', 'rules', 'tools', 'mcp', 'skills', 'summary', 'conversation', 'toolResults', 'other'])

/** Reject stale snapshots rather than mixing sessions, models or compaction states. */
export function matchingContextBreakdown(stats: SessionStats, value: unknown): ContextBreakdown | null {
  if (!value || typeof value !== 'object') return null
  const snapshot = value as ContextBreakdown
  const usage = stats.contextUsage
  if (!usage || snapshot.sessionId !== stats.sessionId || snapshot.contextWindow !== usage.contextWindow || snapshot.totalTokens !== usage.tokens) return null
  if (snapshot.estimated !== true || typeof snapshot.calibrated !== 'boolean' || !Number.isFinite(snapshot.capturedAt) || !Array.isArray(snapshot.categories)) return null
  if (snapshot.modelKey !== null && typeof snapshot.modelKey !== 'string') return null
  const seen = new Set<string>()
  for (const row of snapshot.categories) {
    if (!row || !categories.has(row.id) || seen.has(row.id) || !Number.isInteger(row.tokens) || row.tokens < 0) return null
    seen.add(row.id)
  }
  if (usage.tokens === null || snapshot.categories.reduce((sum, row) => sum + row.tokens, 0) !== Math.round(usage.tokens)) return null
  return snapshot
}
