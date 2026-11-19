import type { ThinkingLevel } from '@shared/types'

/** Plain wording for every known thinking level (composer + Settings). */
export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: '关',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高'
}

/** Full catalog for Settings › 默认思考程度 (plus 「自动」 in the UI). */
export const ALL_THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]

export function thinkingLabel(level: ThinkingLevel | undefined | null): string | null {
  if (!level) return null
  return THINKING_LABELS[level] ?? null
}

/** Show the model's reported levels in the order pi/provider returned them. */
export function thinkingOptionsFor(
  levels: ThinkingLevel[]
): Array<{ value: ThinkingLevel; label: string }> {
  return levels.map((level) => ({
    value: level,
    label: THINKING_LABELS[level] ?? level
  }))
}

/**
 * After a model switch: keep the previous selection when the new model still
 * supports it; otherwise use the level pi reported (model default), then a
 * sensible fallback from the new list.
 */
export function resolveThinkingAfterModelChange(
  levels: ThinkingLevel[],
  previous: ThinkingLevel | undefined | null,
  reported: ThinkingLevel | undefined | null
): ThinkingLevel | null {
  if (!levels.length) return null
  if (previous && levels.includes(previous)) return previous
  if (reported && levels.includes(reported)) return reported
  if (levels.includes('medium')) return 'medium'
  return levels.find((level) => level !== 'off') ?? levels[0] ?? null
}
