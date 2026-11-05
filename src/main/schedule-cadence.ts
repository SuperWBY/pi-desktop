import type { ScheduleCadence } from '@shared/types'

interface CronSpec {
  minutes: boolean[]
  hours: boolean[]
  doms: boolean[]
  months: boolean[]
  dows: boolean[]
  domRestricted: boolean
  dowRestricted: boolean
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const CRON_ALIASES: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *'
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timezone?: string): Intl.DateTimeFormat {
  const key = timezone || '__local__'
  const cached = formatterCache.get(key)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    ...(timezone ? { timeZone: timezone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  })
  formatterCache.set(key, formatter)
  return formatter
}

function zonedParts(timestamp: number, timezone?: string): ZonedParts {
  const parts = formatterFor(timezone).formatToParts(new Date(timestamp))
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second')
  }
}

function localToUtcUnix(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone?: string
): number | null {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0)
  let guess = desired
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(guess, timezone)
    const actualUnix = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0)
    const delta = desired - actualUnix
    if (delta === 0) break
    guess += delta
  }
  const final = zonedParts(guess, timezone)
  if (
    final.year !== year ||
    final.month !== month ||
    final.day !== day ||
    final.hour !== hour ||
    final.minute !== minute
  ) {
    return null
  }
  return guess
}

function parseNumber(value: string, names: string[] | undefined): number | null {
  const upper = value.toUpperCase()
  if (names) {
    const index = names.indexOf(upper)
    if (index >= 0) return names === MONTH_NAMES ? index + 1 : index
  }
  if (!/^\d+$/.test(value)) return null
  return Number(value)
}

function expandField(
  field: string,
  min: number,
  max: number,
  names?: string[],
  normalize?: (value: number) => number
): { values: number[]; restricted: boolean } {
  const trimmed = field.trim()
  if (!trimmed || trimmed === '*' || trimmed === '?') {
    return { values: Array.from({ length: max - min + 1 }, (_, index) => min + index), restricted: false }
  }
  const output = new Set<number>()
  for (const part of trimmed.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step <= 0) throw new Error(`无效步长：${part}`)
    let start: number
    let end: number
    if (rangePart === '*') {
      start = min
      end = max
    } else if (rangePart.includes('-')) {
      const [rawStart, rawEnd] = rangePart.split('-')
      const parsedStart = parseNumber(rawStart, names)
      const parsedEnd = parseNumber(rawEnd, names)
      if (parsedStart == null || parsedEnd == null) throw new Error(`无效范围：${part}`)
      start = parsedStart
      end = parsedEnd
    } else {
      const parsed = parseNumber(rangePart, names)
      if (parsed == null) throw new Error(`无效值：${part}`)
      start = parsed
      end = parsed
    }
    if (start > end) throw new Error(`范围起点大于终点：${part}`)
    for (let value = start; value <= end; value += step) {
      const normalized = normalize ? normalize(value) : value
      if (normalized < min || normalized > max) throw new Error(`超出范围：${value}`)
      output.add(normalized)
    }
  }
  if (output.size === 0) throw new Error(`空字段：${field}`)
  return { values: [...output].sort((a, b) => a - b), restricted: true }
}

function parseCron(expression: string): CronSpec {
  const alias = CRON_ALIASES[expression.trim().toLowerCase()]
  const fields = (alias ?? expression).trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error('cron 需要 5 个字段：分 时 日 月 周')
  }
  const minutes = expandField(fields[0], 0, 59)
  const hours = expandField(fields[1], 0, 23)
  const doms = expandField(fields[2], 1, 31)
  const months = expandField(fields[3], 1, 12, MONTH_NAMES)
  const dows = expandField(fields[4], 0, 6, DAY_NAMES, (value) => (value === 7 ? 0 : value))
  const toFlags = (values: number[], min: number, max: number): boolean[] => {
    const flags = Array.from({ length: max - min + 1 }, () => false)
    for (const value of values) flags[value - min] = true
    return flags
  }
  return {
    minutes: toFlags(minutes.values, 0, 59),
    hours: toFlags(hours.values, 0, 23),
    doms: toFlags(doms.values, 1, 31),
    months: toFlags(months.values, 1, 12),
    dows: toFlags(dows.values, 0, 6),
    domRestricted: doms.restricted,
    dowRestricted: dows.restricted
  }
}

export function validateCron(expression: string): string | null {
  try {
    parseCron(expression)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function isValidTimezone(timezone?: string): boolean {
  if (!timezone) return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

function nextCron(expression: string, from: number, timezone?: string): number | null {
  const spec = parseCron(expression)
  const start = zonedParts(from, timezone)
  const startDate = Date.UTC(start.year, start.month - 1, start.day)
  const days = 366 * 8
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(startDate)
    date.setUTCDate(date.getUTCDate() + offset)
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    const day = date.getUTCDate()
    if (!spec.months[month - 1]) continue
    const domMatch = spec.doms[day - 1]
    const dowMatch = spec.dows[date.getUTCDay()]
    const dayMatch =
      spec.domRestricted && spec.dowRestricted ? domMatch || dowMatch : domMatch && dowMatch
    if (!dayMatch) continue
    for (let hour = 0; hour < 24; hour += 1) {
      if (!spec.hours[hour]) continue
      for (let minute = 0; minute < 60; minute += 1) {
        if (!spec.minutes[minute]) continue
        const candidate = localToUtcUnix(year, month, day, hour, minute, timezone)
        if (candidate != null && candidate > from) return candidate
      }
    }
  }
  return null
}

function parseTime(time: string): { hours: number; minutes: number } {
  const [hours, minutes] = time.split(':').map(Number)
  return {
    hours: Number.isFinite(hours) ? Math.min(23, Math.max(0, hours)) : 9,
    minutes: Number.isFinite(minutes) ? Math.min(59, Math.max(0, minutes)) : 0
  }
}

function cadenceExpression(cadence: Exclude<ScheduleCadence, { type: 'once' | 'event' }>): string {
  if (cadence.type === 'cron') return cadence.expression
  if (cadence.type === 'hourly') return `${Math.min(59, Math.max(0, cadence.minute))} * * * *`
  const { hours, minutes } = parseTime(cadence.time)
  const dow =
    cadence.type === 'weekly'
      ? String(Math.min(6, Math.max(0, cadence.weekday)))
      : cadence.type === 'weekdays'
        ? '1-5'
        : '*'
  return `${minutes} ${hours} * * ${dow}`
}

/**
 * Compute the next occurrence in a named IANA timezone (defaults to the
 * machine timezone). Wall-clock cadences stay stable across DST changes;
 * nonexistent spring-forward times are skipped.
 */
export function nextRun(cadence: ScheduleCadence, from = Date.now(), timezone?: string): number | null {
  if (cadence.type === 'once') return cadence.at > from ? cadence.at : null
  if (cadence.type === 'event') return null
  try {
    return nextCron(cadenceExpression(cadence), from, timezone)
  } catch {
    return null
  }
}

export function nextRuns(
  cadence: ScheduleCadence,
  count = 3,
  from = Date.now(),
  timezone?: string
): number[] {
  if (cadence.type === 'event') return []
  const result: number[] = []
  let cursor = from
  for (let index = 0; index < count; index += 1) {
    const next = nextRun(cadence, cursor, timezone)
    if (next == null) break
    result.push(next)
    cursor = next
  }
  return result
}

export function describeCadence(cadence: ScheduleCadence): string {
  if (cadence.type === 'once') {
    const date = new Date(cadence.at)
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes()
    ).padStart(2, '0')}`
  }
  if (cadence.type === 'hourly') return `每小时 :${String(cadence.minute).padStart(2, '0')}`
  if (cadence.type === 'daily') return `每天 ${cadence.time}`
  if (cadence.type === 'weekdays') return `工作日 ${cadence.time}`
  if (cadence.type === 'cron') return `cron ${cadence.expression}`
  if (cadence.type === 'event') return `文件变化 · ${cadence.path}`
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${names[cadence.weekday] ?? '每周'} ${cadence.time}`
}
