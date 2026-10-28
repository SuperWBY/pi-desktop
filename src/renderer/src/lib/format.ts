export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function dayLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const day = 86_400_000
  if (timestamp >= startOfToday) return 'Today'
  if (timestamp >= startOfToday - day) return 'Yesterday'
  if (timestamp >= startOfToday - 7 * day) return 'Previous 7 days'
  if (timestamp >= startOfToday - 30 * day) return 'Previous 30 days'
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
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
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

export function dirName(path: string): string {
  const parts = path.split('/')
  parts.pop()
  return parts.join('/') || '/'
}

export function formatDuration(ms: number | undefined): string {
  if (!ms || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
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
