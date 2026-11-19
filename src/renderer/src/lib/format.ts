import { isTemporaryWorkspace, looksLikeRawPath, pathsEqual } from '@shared/paths'

export function relativeTime(timestamp: number, language: 'zh-CN' | 'en' = 'zh-CN'): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return language === 'en' ? 'just now' : '刚刚'
  if (minutes < 60) return language === 'en' ? `${minutes}m ago` : `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return language === 'en' ? `${hours}h ago` : `${hours} 小时`
  const days = Math.floor(hours / 24)
  if (days < 7) return language === 'en' ? `${days}d ago` : `${days} 天`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return language === 'en' ? `${weeks}w ago` : `${weeks} 周`
  return new Date(timestamp).toLocaleDateString(language, { month: 'short', day: 'numeric' })
}

export function dayLabel(timestamp: number, language: 'zh-CN' | 'en' = 'zh-CN'): string {
  const date = new Date(timestamp)
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const day = 86_400_000
  if (timestamp >= startOfToday) return language === 'en' ? 'Today' : '今天'
  if (timestamp >= startOfToday - day) return language === 'en' ? 'Yesterday' : '昨天'
  if (timestamp >= startOfToday - 7 * day) return language === 'en' ? 'Last 7 days' : '最近 7 天'
  if (timestamp >= startOfToday - 30 * day) return language === 'en' ? 'Last 30 days' : '最近 30 天'
  return date.toLocaleDateString(language, { month: 'long', year: 'numeric' })
}

export function formatTokens(value: number | null | undefined): string {
  if (!value || value < 0) return '0'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

export function formatCost(value: number | null | undefined): string {
  if (!value || value <= 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

export function shortenPath(path: string | null | undefined, home?: string): string {
  if (!path) return ''
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}`
  return path
}

export function baseName(path: string | null | undefined): string {
  if (!path) return ''
  const parts = path.split(/^(?:[A-Za-z]:\\|\\\\)/.test(path) ? /[\\/]/ : '/')
  return parts[parts.length - 1] || path
}

export function projectName(names: Record<string, string> | undefined, path: string | null | undefined): string {
  if (!path) return ''
  const direct = names?.[path]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (names) {
    for (const [key, value] of Object.entries(names)) {
      if (typeof value === 'string' && value.trim() && pathsEqual(key, path)) return value.trim()
    }
  }
  const base = baseName(path)
  if (!base || looksLikeRawPath(base) || isTemporaryWorkspace(path)) return ''
  return base
}

/** When two folders share a display name, add the parent folder so they can be told apart. */
export function disambiguateProjectNames(
  paths: string[],
  names: Record<string, string> | undefined
): Map<string, string> {
  const labels = paths.map((path) => ({ path, label: projectName(names, path) || baseName(path) || path }))
  const counts = new Map<string, number>()
  for (const item of labels) counts.set(item.label, (counts.get(item.label) ?? 0) + 1)
  const result = new Map<string, string>()
  for (const item of labels) {
    if ((counts.get(item.label) ?? 0) < 2) {
      result.set(item.path, item.label)
      continue
    }
    const parent = baseName(dirName(item.path))
    const generic = !parent || parent === item.label || looksLikeRawPath(parent) || /^(users|home|documents|desktop|downloads|var|tmp|private)$/i.test(parent)
    result.set(item.path, generic ? item.label : `${item.label} · ${parent}`)
  }
  return result
}

export function dirName(path: string): string {
  const parts = path.split('/')
  parts.pop()
  return parts.join('/') || '/'
}

export function formatDuration(ms: number | undefined): string {
  if (!ms || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) {
    const seconds = ms / 1000
    return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`
  }
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function truncate(text: string, length: number): string {
  if (text.length <= length) return text
  return `${text.slice(0, length - 1).trimEnd()}…`
}

export function timeOfDay(timestamp: number | undefined): string {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
