import type { ThinkingLevel } from '@shared/types'

type Lang = 'zh-CN' | 'en'

/** Standard plain labels for known thinking ids (composer + Settings). */
const KNOWN_LABELS: Record<string, { zh: string; en: string }> = {
  off: { zh: '关闭', en: 'Off' },
  none: { zh: '关闭', en: 'Off' },
  minimal: { zh: '最低', en: 'Minimal' },
  low: { zh: '低', en: 'Low' },
  medium: { zh: '中', en: 'Medium' },
  high: { zh: '高', en: 'High' },
  xhigh: { zh: '极高', en: 'Extra high' },
  max: { zh: '最高', en: 'Max' }
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

/**
 * Map a level id to UI copy. Known ids use plain wording; unknown ids keep the
 * raw id. Language-aware so 「关闭」 does not collide with the Close button.
 */
export function thinkingLabel(
  level: string | undefined | null,
  language: Lang = 'zh-CN'
): string | null {
  if (level == null || level === '') return null
  const known = KNOWN_LABELS[level]
  if (known) return language === 'en' ? known.en : known.zh
  return level
}

/** Show the model's reported levels in the order pi/metadata returned them. */
export function thinkingOptionsFor(
  levels: readonly string[],
  language: Lang = 'zh-CN'
): Array<{ value: ThinkingLevel; label: string }> {
  return levels.map((level) => ({
    value: level as ThinkingLevel,
    label: thinkingLabel(level, language) ?? level
  }))
}

/**
 * After a model switch: keep the previous selection when the new model still
 * supports it; otherwise use the level pi reported (model default), then a
 * sensible fallback from the new list.
 */
export function resolveThinkingAfterModelChange(
  levels: readonly string[],
  previous: string | undefined | null,
  reported: string | undefined | null
): ThinkingLevel | null {
  if (!levels.length) return null
  if (previous && levels.includes(previous)) return previous as ThinkingLevel
  if (reported && levels.includes(reported)) return reported as ThinkingLevel
  if (levels.includes('medium')) return 'medium'
  const firstOn = levels.find((level) => level !== 'off' && level !== 'none')
  return (firstOn ?? levels[0] ?? null) as ThinkingLevel | null
}
