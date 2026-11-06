import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  UsageDay,
  UsageEntry,
  UsageModelRow,
  UsagePlanRow,
  UsageProjectRow,
  UsageRange,
  UsageSessionRow,
  UsageSkillRow,
  UsageSummary,
  UsageTotals
} from '@shared/types'
import { sessionsRoot } from './sessions'

interface SkillCall {
  name: string
  at: number
}

interface FileCache {
  mtimeMs: number
  size: number
  session: UsageSessionRow | null
  entries: UsageEntry[]
  skillCalls: SkillCall[]
}

const cache = new Map<string, FileCache>()

const PLAN_LABELS: Record<string, string> = {
  'opencode-go': 'OpenCode Go',
  'deepseek': 'DeepSeek API',
  'openai': 'OpenAI API',
  'anthropic': 'Anthropic API'
}

/**
 * One provider currently maps to one plan.  A future second account should be
 * given its own provider id/alias instead of guessing from a model name.
 */
function planFor(provider: string): { id: string; label: string } {
  const id = provider || 'unknown'
  return {
    id,
    label: PLAN_LABELS[id] ?? (id === 'unknown' ? '未归属套餐' : id)
  }
}

function emptyTotals(): UsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    requests: 0,
    cost: 0
  }
}

function addUsage(target: UsageTotals, usage: Record<string, unknown> | undefined): void {
  if (!usage) return
  const number = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  const input = number(usage.input)
  const output = number(usage.output)
  const cacheRead = number(usage.cacheRead)
  const cacheWrite = number(usage.cacheWrite)
  target.input += input
  target.output += output
  target.cacheRead += cacheRead
  target.cacheWrite += cacheWrite
  target.total += input + output + cacheRead + cacheWrite
  target.requests += 1
  const cost = usage.cost
  if (typeof cost === 'number') {
    target.cost += Number.isFinite(cost) ? cost : 0
  } else if (cost && typeof cost === 'object') {
    const values = cost as Record<string, unknown>
    const total = number(values.total)
    if (total) {
      target.cost += total
    } else {
      target.cost +=
        number(values.input) + number(values.output) + number(values.cacheRead) + number(values.cacheWrite)
    }
  }
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function timestampOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function projectFor(cwd: string): { path: string; name: string } {
  const scratch = join(app.getPath('userData'), 'scratch')
  if (cwd === scratch) return { path: scratch, name: '临时对话' }
  return { path: cwd, name: basename(cwd) || cwd }
}

function skillFromCall(name: unknown, args: unknown): string | null {
  if (typeof name !== 'string' || !args || typeof args !== 'object') return null
  const values = args as Record<string, unknown>
  if (name === 'skill' && typeof values.name === 'string') return values.name
  const raw = values.path ?? values.file
  if (typeof raw !== 'string') return null
  const path = raw.replace(/\\/g, '/')
  if (!/\/skills\/[^/]+\/SKILL\.md$/i.test(path)) return null
  const parts = path.split('/')
  return parts[parts.length - 2] || null
}

async function readSession(file: string): Promise<FileCache | null> {
  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    return null
  }
  const cached = cache.get(file)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached

  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, session: null, entries: [], skillCalls: [] })
    return null
  }

  let cwd = ''
  let name = ''
  let updatedAt = stat.mtimeMs
  const entries: UsageEntry[] = []
  const skillCalls: SkillCall[] = []

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (record.type === 'session') {
      if (typeof record.cwd === 'string') cwd = record.cwd
    } else if (record.type === 'session_info') {
      if (typeof record.name === 'string' && record.name.trim()) name = record.name.trim()
    }
    const entryTimestamp = timestampOf(record.timestamp)
    if (entryTimestamp > updatedAt) updatedAt = entryTimestamp

    if (record.type !== 'message') continue
    const message = record.message as Record<string, unknown> | undefined
    if (!message || message.role !== 'assistant') continue
    const content = message.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const item = block as Record<string, unknown>
        if (item.type !== 'toolCall') continue
        const skill = skillFromCall(item.name, item.arguments)
        if (skill) {
          skillCalls.push({ name: skill, at: timestampOf(message.timestamp) || entryTimestamp || stat.mtimeMs })
        }
      }
    }
    const usage = message.usage as Record<string, unknown> | undefined
    if (!usage) continue
    const at = timestampOf(message.timestamp) || entryTimestamp || stat.mtimeMs
    const provider =
      typeof message.provider === 'string' ? message.provider : 'unknown'
    const model = typeof message.model === 'string' ? message.model : 'unknown'
    entries.push({ at, provider, model, usage })
  }

  if (!cwd) return null
  const project = projectFor(cwd)
  const session: UsageSessionRow = {
    ...emptyTotals(),
    path: file,
    name: name || basename(file, '.jsonl'),
    cwd,
    projectPath: project.path,
    projectName: project.name,
    updatedAt
  }
  const next: FileCache = { mtimeMs: stat.mtimeMs, size: stat.size, session, entries, skillCalls }
  cache.set(file, next)
  return next
}

export async function usageSummary(range: UsageRange): Promise<UsageSummary> {
  const root = sessionsRoot()
  let dirs: string[]
  try {
    dirs = await fs.readdir(root)
  } catch {
    return {
      range,
      from: null,
      to: Date.now(),
      totals: emptyTotals(),
      byDay: [],
      byModel: [],
      byPlan: [],
      byProject: [],
      bySkill: [],
      sessions: [],
      generatedAt: Date.now()
    }
  }

  const files: string[] = []
  for (const dir of dirs) {
    if (dir.startsWith('.')) continue
    try {
      const path = join(root, dir)
      const stat = await fs.stat(path)
      if (!stat.isDirectory()) continue
      const names = await fs.readdir(path)
      for (const name of names) {
        if (name.endsWith('.jsonl')) files.push(join(path, name))
      }
    } catch {
      // ignore unreadable session directories
    }
  }

  const now = Date.now()
  const localStart = (offsetDays: number): number => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - offsetDays)
    return date.getTime()
  }
  let from: number | null = null
  if (range === 'today') from = localStart(0)
  else if (range === '7d') from = localStart(6)
  else if (range === '30d') from = localStart(29)
  else if (range === 'month') {
    const date = new Date()
    from = new Date(date.getFullYear(), date.getMonth(), 1).getTime()
  }

  const totals = emptyTotals()
  const dayMap = new Map<string, UsageTotals>()
  const modelMap = new Map<string, UsageModelRow>()
  const planMap = new Map<string, UsagePlanRow>()
  const projectMap = new Map<string, UsageProjectRow>()
  const skillMap = new Map<string, { name: string; calls: number; sessions: Set<string>; tokens: number; cost: number }>()
  const sessions: UsageSessionRow[] = []

  for (const file of files) {
    const parsed = await readSession(file)
    if (!parsed?.session) continue
    const inRange = parsed.entries.filter((entry) => {
      if (from != null && entry.at < from) return false
      if (entry.at > now) return false
      return true
    })
    if (!inRange.length) continue

    const session = parsed.session
    for (const call of parsed.skillCalls) {
      if (from != null && call.at < from) continue
      if (call.at > now) continue
      const current = skillMap.get(call.name) ?? { name: call.name, calls: 0, sessions: new Set<string>(), tokens: 0, cost: 0 }
      current.calls += 1
      current.sessions.add(session.path)
      skillMap.set(call.name, current)
    }
    const sessionTotals = emptyTotals()
    for (const entry of inRange) {
      addUsage(sessionTotals, entry.usage)
      addUsage(totals, entry.usage)

      const day = localDayKey(entry.at)
      const dayTotals = dayMap.get(day) ?? emptyTotals()
      addUsage(dayTotals, entry.usage)
      dayMap.set(day, dayTotals)

      const modelKey = `${entry.provider}\u0000${entry.model}`
      const modelRow =
        modelMap.get(modelKey) ??
        ({
          ...emptyTotals(),
          provider: entry.provider,
          model: entry.model,
          planId: planFor(entry.provider).id,
          planLabel: planFor(entry.provider).label
        } as UsageModelRow)
      addUsage(modelRow, entry.usage)
      modelMap.set(modelKey, modelRow)

      const plan = planFor(entry.provider)
      const planRow = planMap.get(plan.id) ?? ({ ...emptyTotals(), id: plan.id, label: plan.label } as UsagePlanRow)
      addUsage(planRow, entry.usage)
      planMap.set(plan.id, planRow)

      const projectKey = session.projectPath || session.cwd
      const projectRow =
        projectMap.get(projectKey) ??
        ({
          ...emptyTotals(),
          path: projectKey,
          name: session.projectName
        } as UsageProjectRow)
      addUsage(projectRow, entry.usage)
      projectMap.set(projectKey, projectRow)
    }

    sessions.push({
      ...session,
      ...sessionTotals
    })
  }

  const activeDays = Array.from(dayMap.entries())
    .map(([date, value]) => ({ date, ...value }))
    .sort((a, b) => a.date.localeCompare(b.date))
  // Keep empty days in the chart so a month does not collapse into only the
  // three days that happened to have usage.
  const chartStart = from ?? (activeDays.length ? Date.parse(`${activeDays[0].date}T00:00:00`) : now)
  const chartDays = Math.floor((now - chartStart) / 86_400_000) + 1
  const byDay: UsageDay[] =
    chartDays > 0 && chartDays <= 400
      ? Array.from({ length: chartDays }, (_, index) => {
          const timestamp = chartStart + index * 86_400_000
          return localDayKey(timestamp)
        }).map((date) => {
          const value = dayMap.get(date)
          return value ? { date, ...value } : { date, ...emptyTotals() }
        })
      : activeDays
  const byModel = Array.from(modelMap.values()).sort((a, b) => b.total - a.total || b.cost - a.cost)
  const byPlan = Array.from(planMap.values()).sort((a, b) => b.total - a.total || b.cost - a.cost)
  const byProject = Array.from(projectMap.values()).sort((a, b) => b.total - a.total || b.cost - a.cost)
  const bySkill: UsageSkillRow[] = Array.from(skillMap.values())
    .map((row) => ({ name: row.name, calls: row.calls, sessions: row.sessions.size, tokens: 0, cost: 0 }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
  sessions.sort((a, b) => b.total - a.total || b.cost - a.cost || b.updatedAt - a.updatedAt)

  return {
    range,
    from,
    to: now,
    totals,
    byDay,
    byModel,
    byPlan,
    byProject,
    bySkill,
    sessions: sessions.slice(0, 100),
    generatedAt: now
  }
}
