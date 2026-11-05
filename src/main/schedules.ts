import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, Notification } from 'electron'
import type {
  ScheduleCadence,
  ScheduleEvent,
  ScheduledRun,
  ScheduledRunStatus,
  ScheduledTask,
  ScheduledTaskInput
} from '@shared/types'
import { nextRun, nextRuns, isValidTimezone } from './schedule-cadence'
import { addSessionNotice } from './session-notices'
import { locatePi, augmentedPath } from './pi-locate'
import { scheduleGuidance } from './schedule-bridge'
import { loadSettings } from './settings'

const RUN_TIMEOUT_MS = 30 * 60_000
const MAX_RUNS_PER_TASK = 100
const TICK_MS = 30_000

interface StoreState {
  cleanShutdown?: boolean
  lastExitAt?: number
}

interface TaskFile {
  version: 1
  tasks: ScheduledTask[]
}

function rootDir(): string {
  return join(app.getPath('userData'), 'schedules')
}

function tasksFile(): string {
  return join(rootDir(), 'tasks.json')
}

function stateFile(): string {
  return join(rootDir(), 'state.json')
}

function runsDir(): string {
  return join(rootDir(), 'runs')
}

function logsDir(): string {
  return join(rootDir(), 'logs')
}

function sessionsDir(): string {
  return join(rootDir(), 'sessions')
}

function inboxDir(): string {
  return join(rootDir(), 'inbox')
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2))
  renameSync(temp, file)
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function validTask(task: unknown): task is ScheduledTask {
  if (!task || typeof task !== 'object') return false
  const value = task as Partial<ScheduledTask>
  return typeof value.id === 'string' && typeof value.name === 'string' && typeof value.prompt === 'string'
}

class ScheduleStore {
  tasks: ScheduledTask[] = []
  state: StoreState = {}

  load(): void {
    mkdirSync(rootDir(), { recursive: true })
    mkdirSync(runsDir(), { recursive: true })
    mkdirSync(logsDir(), { recursive: true })
    mkdirSync(sessionsDir(), { recursive: true })
    mkdirSync(inboxDir(), { recursive: true })

    const file = readJson<TaskFile>(tasksFile(), { version: 1, tasks: [] })
    this.tasks = Array.isArray(file.tasks) ? file.tasks.filter(validTask) : []
    this.state = readJson<StoreState>(stateFile(), { cleanShutdown: true })
    this.recoverInterrupted()
  }

  private recoverInterrupted(): void {
    const now = Date.now()
    for (const task of this.tasks) {
      const runs = this.runs(task.id)
      let changed = false
      for (const run of runs) {
        if (run.status === 'running') {
          run.status = 'interrupted'
          run.endedAt = now
          run.durationMs = run.endedAt - run.startedAt
          run.error = 'Pi Desktop 在运行期间退出'
          changed = true
        }
      }
      if (changed) {
        this.saveRuns(task.id, runs)
        if (task.lastStatus === 'running') task.lastStatus = 'interrupted'
        if (task.catchUp && task.pendingCatchUpAt == null) {
          const interrupted = runs.find((run) => run.status === 'interrupted')
          if (interrupted) task.pendingCatchUpAt = interrupted.scheduledFor ?? interrupted.startedAt
        }
      }
    }
    this.saveTasks()
  }

  saveTasks(): void {
    writeJson(tasksFile(), { version: 1, tasks: this.tasks })
  }

  saveState(patch: Partial<StoreState>): void {
    this.state = { ...this.state, ...patch }
    writeJson(stateFile(), this.state)
  }

  runs(taskId: string): ScheduledRun[] {
    const file = join(runsDir(), `${taskId}.json`)
    const list = readJson<ScheduledRun[]>(file, [])
    return Array.isArray(list) ? list : []
  }

  saveRuns(taskId: string, runs: ScheduledRun[]): void {
    writeJson(join(runsDir(), `${taskId}.json`), runs.slice(0, MAX_RUNS_PER_TASK))
  }

  appendRun(run: ScheduledRun): void {
    const runs = this.runs(run.taskId)
    runs.unshift(run)
    this.saveRuns(run.taskId, runs)
  }

  updateRun(run: ScheduledRun): void {
    const runs = this.runs(run.taskId)
    const index = runs.findIndex((item) => item.id === run.id)
    if (index >= 0) runs[index] = run
    else runs.unshift(run)
    this.saveRuns(run.taskId, runs)
  }

  removeTask(taskId: string): void {
    this.tasks = this.tasks.filter((task) => task.id !== taskId)
    this.saveTasks()
    rmSync(join(runsDir(), `${taskId}.json`), { force: true })
    rmSync(join(logsDir(), taskId), { recursive: true, force: true })
  }
}

export class ScheduleScheduler {
  private store = new ScheduleStore()
  private timer: NodeJS.Timeout | null = null
  private running = new Set<string>()
  private queuedCatchUp = new Set<string>()
  private children = new Map<string, ChildProcess>()
  private watchers = new Map<string, FSWatcher>()
  private eventTimers = new Map<string, NodeJS.Timeout>()
  private inboxTimer: NodeJS.Timeout | null = null
  private inboxBusy = false
  private started = false
  private shuttingDown = false
  private notifyChanged: () => void = () => undefined
  private notifyEvent: (event: ScheduleEvent) => void = () => undefined
  private openTask: (taskId: string) => void = () => undefined

  init(
    notifyChanged: () => void,
    notifyEvent?: (event: ScheduleEvent) => void,
    openTask?: (taskId: string) => void
  ): void {
    if (this.started) return
    this.started = true
    this.notifyChanged = notifyChanged
    this.notifyEvent = notifyEvent ?? (() => undefined)
    this.openTask = openTask ?? (() => undefined)
    this.store.load()
    this.pruneCompletedOnce()
    this.store.saveState({ cleanShutdown: false })
    this.recover()
    this.syncWatchers()
    this.startInbox()
    this.arm()
  }

  async runHeadlessTick(): Promise<void> {
    this.store.load()
    this.store.saveState({ cleanShutdown: false })
    this.processInbox()
    this.recover()
    this.syncWatchers()
    this.checkDue()
    const deadline = Date.now() + RUN_TIMEOUT_MS + 120_000
    while (Date.now() < deadline) {
      if (this.running.size === 0 && this.queuedCatchUp.size === 0 && this.eventTimers.size === 0) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    this.closeWatchers()
    this.store.saveState({ cleanShutdown: true, lastExitAt: Date.now() })
  }

  list(): ScheduledTask[] {
    return [...this.store.tasks].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      return (a.nextRunAt ?? Number.MAX_SAFE_INTEGER) - (b.nextRunAt ?? Number.MAX_SAFE_INTEGER)
    })
  }

  get(id: string): { task: ScheduledTask; runs: ScheduledRun[] } | null {
    const task = this.store.tasks.find((item) => item.id === id)
    if (!task) return null
    return { task, runs: this.store.runs(id) }
  }

  preview(cadence: ScheduleCadence, count = 3, timezone?: string): number[] {
    return nextRuns(cadence, count, Date.now(), timezone)
  }

  create(input: ScheduledTaskInput, announce = false): ScheduledTask {
    const now = Date.now()
    const projectPath = input.projectPath || homedir()
    const cadence =
      input.cadence.type === 'event' && !input.cadence.path
        ? { ...input.cadence, path: projectPath }
        : input.cadence
    const task: ScheduledTask = {
      id: randomUUID(),
      name: input.name.trim(),
      prompt: input.prompt.trim(),
      projectPath,
      sourceSessionPath: input.sourceSessionPath,
      cadence,
      timezone: input.timezone && isValidTimezone(input.timezone) ? input.timezone : undefined,
      runMode: input.runMode ?? 'new-session',
      model: input.model,
      thinking: input.thinking,
      tools: input.tools,
      catchUp: input.catchUp ?? true,
      catchUpWindowMs: 24 * 60 * 60_000,
      notifications: input.notifications ?? true,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      nextRunAt: null,
      pendingCatchUpAt: null,
      lastRunAt: null,
      lastStatus: null,
      consecutiveFailures: 0
    }
    task.nextRunAt = task.enabled ? nextRun(task.cadence, now, task.timezone) : null
    if (task.enabled && task.nextRunAt == null && task.cadence.type === 'once') {
      task.nextRunAt = now + 100
    }
    if (task.cadence.type !== 'event' && task.nextRunAt == null) task.enabled = false
    this.store.tasks.push(task)
    this.store.saveTasks()
    this.syncWatchers()
    this.arm()
    this.changed()
    if (announce) {
      this.notifyEvent({
        type: 'created',
        taskId: task.id,
        name: task.name,
        nextRunAt: task.nextRunAt
      })
    }
    return task
  }

  update(id: string, patch: Partial<ScheduledTaskInput>): ScheduledTask | null {
    const task = this.store.tasks.find((item) => item.id === id)
    if (!task) return null
    if (patch.name !== undefined) task.name = patch.name.trim()
    if (patch.prompt !== undefined) task.prompt = patch.prompt.trim()
    if (patch.projectPath !== undefined) task.projectPath = patch.projectPath
    if (patch.sourceSessionPath !== undefined) task.sourceSessionPath = patch.sourceSessionPath || undefined
    if (patch.cadence !== undefined) {
      task.cadence =
        patch.cadence.type === 'event' && !patch.cadence.path
          ? { ...patch.cadence, path: task.projectPath || homedir() }
          : patch.cadence
    }
    if (patch.timezone !== undefined) {
      task.timezone = patch.timezone && isValidTimezone(patch.timezone) ? patch.timezone : undefined
    }
    if (patch.runMode !== undefined) task.runMode = patch.runMode
    if (patch.model !== undefined) task.model = patch.model || undefined
    if (patch.thinking !== undefined) task.thinking = patch.thinking || undefined
    if (patch.tools !== undefined) task.tools = patch.tools.length ? patch.tools : undefined
    if (patch.catchUp !== undefined) task.catchUp = patch.catchUp
    if (patch.notifications !== undefined) task.notifications = patch.notifications
    if (patch.enabled !== undefined) task.enabled = patch.enabled
    task.updatedAt = Date.now()
    task.nextRunAt = task.enabled ? nextRun(task.cadence, Date.now(), task.timezone) : null
    if (task.cadence.type !== 'event' && task.nextRunAt == null) task.enabled = false
    this.store.saveTasks()
    this.syncWatchers()
    this.arm()
    this.changed()
    return task
  }

  setEnabled(id: string, enabled: boolean): ScheduledTask | null {
    const task = this.store.tasks.find((item) => item.id === id)
    if (!task) return null
    task.enabled = enabled
    task.updatedAt = Date.now()
    task.nextRunAt = enabled ? nextRun(task.cadence, Date.now(), task.timezone) : null
    if (task.cadence.type !== 'event' && task.nextRunAt == null) task.enabled = false
    this.store.saveTasks()
    this.syncWatchers()
    this.arm()
    this.changed()
    return task
  }

  remove(id: string): boolean {
    if (!this.store.tasks.some((task) => task.id === id)) return false
    this.store.removeTask(id)
    this.syncWatchers()
    this.arm()
    this.changed()
    return true
  }

  async runNow(id: string): Promise<ScheduledRun | null> {
    const task = this.store.tasks.find((item) => item.id === id)
    if (!task) return null
    return this.execute(task, 'manual', null)
  }

  shutdown(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.inboxTimer) clearInterval(this.inboxTimer)
    this.inboxTimer = null
    this.shuttingDown = true
    this.closeWatchers()
    for (const task of this.store.tasks) {
      if (!this.running.has(task.id)) continue
      task.lastStatus = 'interrupted'
      if (task.catchUp) task.pendingCatchUpAt = Date.now()
    }
    this.store.saveTasks()
    for (const child of this.children.values()) {
      this.killTree(child)
    }
    this.store.saveState({ cleanShutdown: true, lastExitAt: Date.now() })
  }

  /** Re-check due work after the machine wakes or the clock changes. */
  recoverNow(): void {
    this.recover()
    this.arm()
    this.changed()
  }

  private changed(): void {
    this.notifyChanged()
  }

  /** One-off tasks that already succeeded should not linger as paused rows. */
  private pruneCompletedOnce(): void {
    const completed = this.store.tasks.filter(
      (task) => task.cadence.type === 'once' && task.lastStatus === 'success'
    )
    if (!completed.length) return
    for (const task of completed) this.store.removeTask(task.id)
    this.changed()
  }

  private recover(): void {
    const now = Date.now()
    let catchUpIndex = 0
    for (const task of this.store.tasks) {
      if (!task.enabled) task.nextRunAt = null
      const due = task.nextRunAt
      if (task.enabled && task.pendingCatchUpAt == null && due != null && due <= now) {
        const late = now - due
        if (task.catchUp && late <= task.catchUpWindowMs) {
          task.pendingCatchUpAt = due
        } else {
          this.recordMissed(task, due)
        }
      }
      if (task.cadence.type === 'event') {
        task.nextRunAt = null
      } else if (task.enabled) {
        if (task.nextRunAt != null && task.nextRunAt <= now) {
          task.nextRunAt = nextRun(task.cadence, now, task.timezone)
        } else if (task.nextRunAt == null && task.cadence.type !== 'once') {
          task.nextRunAt = nextRun(task.cadence, now, task.timezone)
        }
        if (task.nextRunAt == null) task.enabled = false
      }

      if (task.pendingCatchUpAt != null && !this.queuedCatchUp.has(task.id)) {
        const scheduledFor = task.pendingCatchUpAt
        const delay = 1200 + catchUpIndex * 1200
        catchUpIndex += 1
        this.queuedCatchUp.add(task.id)
        setTimeout(() => {
          this.queuedCatchUp.delete(task.id)
          void this.execute(task, 'catch-up', scheduledFor)
        }, delay)
      }
    }
    this.store.saveTasks()
  }

  private handleFileEvent(taskId: string): void {
    const task = this.store.tasks.find((item) => item.id === taskId)
    if (!task || !task.enabled || task.cadence.type !== 'event') return
    if (this.running.has(taskId)) return
    const delay = Math.max(100, task.cadence.debounceMs || 1000)
    const existing = this.eventTimers.get(taskId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.eventTimers.delete(taskId)
      if (this.running.has(taskId)) return
      void this.execute(task, 'event', null)
    }, delay)
    this.eventTimers.set(taskId, timer)
  }

  private syncWatchers(): void {
    const wanted = new Map<string, string>()
    for (const task of this.store.tasks) {
      if (task.enabled && task.cadence.type === 'event') {
        wanted.set(task.id, task.cadence.path)
      }
    }
    for (const [taskId, watcher] of this.watchers) {
      if (wanted.has(taskId)) continue
      watcher.close()
      this.watchers.delete(taskId)
      const timer = this.eventTimers.get(taskId)
      if (timer) clearTimeout(timer)
      this.eventTimers.delete(taskId)
    }
    for (const [taskId, target] of wanted) {
      if (this.watchers.has(taskId) || !existsSync(target)) continue
      try {
        let watcher: FSWatcher
        try {
          watcher = watch(target, { recursive: true }, () => this.handleFileEvent(taskId))
        } catch {
          watcher = watch(target, () => this.handleFileEvent(taskId))
        }
        watcher.on('error', () => {
          watcher.close()
          this.watchers.delete(taskId)
        })
        this.watchers.set(taskId, watcher)
      } catch {
        // Path disappeared or is unreadable; the row stays enabled so the user
        // can fix it, and the next create/update retries.
      }
    }
  }

  private closeWatchers(): void {
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    for (const timer of this.eventTimers.values()) clearTimeout(timer)
    this.eventTimers.clear()
  }

  private startInbox(): void {
    if (this.inboxTimer) return
    mkdirSync(inboxDir(), { recursive: true })
    this.processInbox()
    this.inboxTimer = setInterval(() => this.processInbox(), 2000)
    if (typeof this.inboxTimer.unref === 'function') this.inboxTimer.unref()
  }

  private processInbox(): void {
    if (this.inboxBusy) return
    this.inboxBusy = true
    try {
      mkdirSync(inboxDir(), { recursive: true })
      for (const name of readdirSync(inboxDir())) {
        if (!name.endsWith('.json')) continue
        const file = join(inboxDir(), name)
        try {
          const input = JSON.parse(readFileSync(file, 'utf8')) as ScheduledTaskInput
          if (!input.prompt || !input.cadence || !input.name) throw new Error('incomplete task')
          this.create(input, true)
        } catch (error) {
          console.error('[schedules] invalid inbox task', error)
        } finally {
          rmSync(file, { force: true })
        }
      }
    } finally {
      this.inboxBusy = false
    }
  }

  private recordMissed(task: ScheduledTask, scheduledFor: number): void {
    const run: ScheduledRun = {
      id: randomUUID(),
      taskId: task.id,
      trigger: 'catch-up',
      scheduledFor,
      status: 'missed',
      startedAt: Date.now(),
      endedAt: Date.now(),
      durationMs: 0,
      logPath: '',
      error: '超出补跑窗口'
    }
    this.store.appendRun(run)
    task.lastStatus = 'missed'
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer)
    const next = this.store.tasks
      .filter((task) => task.enabled && task.nextRunAt != null)
      .reduce<number | null>((min, task) => {
        if (task.nextRunAt == null) return min
        return min == null ? task.nextRunAt : Math.min(min, task.nextRunAt)
      }, null)
    if (next == null) return
    const delay = Math.max(0, Math.min(next - Date.now(), TICK_MS))
    this.timer = setTimeout(() => {
      this.checkDue()
      this.arm()
    }, delay)
  }

  private checkDue(): void {
    const now = Date.now()
    for (const task of this.store.tasks) {
      if (!task.enabled || task.nextRunAt == null || task.nextRunAt > now + 500) continue
      if (task.pendingCatchUpAt != null) continue
      const scheduledFor = task.nextRunAt
      task.nextRunAt = nextRun(task.cadence, Math.max(now, scheduledFor), task.timezone)
      if (task.nextRunAt == null) task.enabled = false
      this.store.saveTasks()
      if (this.running.has(task.id)) {
        const run: ScheduledRun = {
          id: randomUUID(),
          taskId: task.id,
          trigger: 'schedule',
          scheduledFor,
          status: 'skipped',
          startedAt: now,
          endedAt: now,
          durationMs: 0,
          logPath: '',
          error: '上一次运行尚未结束'
        }
        this.store.appendRun(run)
        task.lastStatus = 'skipped'
        this.changed()
        continue
      }
      void this.execute(task, 'schedule', scheduledFor)
    }
  }

  private async execute(
    task: ScheduledTask,
    trigger: ScheduledRun['trigger'],
    scheduledFor: number | null
  ): Promise<ScheduledRun | null> {
    if (this.running.has(task.id)) return null
    const startedAt = Date.now()
    const runId = randomUUID()
    const logDir = join(logsDir(), task.id)
    mkdirSync(logDir, { recursive: true })
    const logPath = join(logDir, `${runId}.log`)
    const run: ScheduledRun = {
      id: runId,
      taskId: task.id,
      trigger,
      scheduledFor,
      status: 'running',
      startedAt,
      logPath
    }
    this.running.add(task.id)
    task.pendingCatchUpAt = null
    this.store.appendRun(run)
    task.lastRunAt = startedAt
    task.lastStatus = 'running'
    this.store.saveTasks()
    this.changed()
    this.notifyEvent({
      type: 'started',
      taskId: task.id,
      name: task.name,
      runId,
      startedAt
    })

    const promise = new Promise<ScheduledRun>((resolve) => {
      const pi = locatePi(loadSettings().piPath)
      const sessionDir = join(sessionsDir(), task.id)
      mkdirSync(sessionDir, { recursive: true })
      const priorSession =
        task.runMode === 'continue-session'
          ? this.store.runs(task.id).find((item) => item.sessionPath && existsSync(item.sessionPath))?.sessionPath
          : undefined
      const sessionId =
        task.runMode === 'continue-session' ? `sched-${task.id}` : `sched-${task.id}-${startedAt}`
      const args = [
        '-p',
        ...(priorSession
          ? ['--session', priorSession]
          : ['--session-dir', sessionDir, '--session-id', sessionId]),
        '--name',
        `定时任务：${task.name} ${new Date(startedAt).toLocaleString('zh-CN')}`,
        '--append-system-prompt',
        scheduleGuidance()
      ]
      if (task.model) args.push('--model', task.model)
      if (task.thinking) args.push('--thinking', task.thinking)
      if (task.tools?.length) args.push('--tools', task.tools.join(','))
      args.push(task.prompt)

      const cwd = existsSync(task.projectPath) && statSync(task.projectPath).isDirectory()
        ? task.projectPath
        : homedir()
      const log = createWriteStream(logPath, { flags: 'a' })
      let tail = ''
      let finished = false
      let timedOut = false
      let timeout: NodeJS.Timeout | null = null

      const finish = (status: ScheduledRunStatus, code: number | null, error?: string): void => {
        if (finished) return
        finished = true
        if (timeout) clearTimeout(timeout)
        if (this.shuttingDown && status === 'failed') {
          status = 'interrupted'
          error = 'Pi Desktop 已退出'
        }
        this.running.delete(task.id)
        this.children.delete(task.id)
        const endedAt = Date.now()
        run.status = status
        run.endedAt = endedAt
        run.durationMs = endedAt - startedAt
        run.exitCode = code
        run.error = error
        if (status === 'success') task.pendingCatchUpAt = null
        run.sessionPath = priorSession ?? this.findSession(sessionDir, sessionId)
        run.summary = this.cleanSummary(tail)
        this.store.updateRun(run)

        task.lastRunAt = startedAt
        task.lastStatus = status
        if (status === 'success') {
          task.consecutiveFailures = 0
        } else if (status === 'failed' || status === 'timeout') {
          task.consecutiveFailures += 1
          if (task.consecutiveFailures >= 3) task.enabled = false
        }
        if (task.cadence.type === 'once' && status !== 'skipped') task.enabled = false
        if (!task.enabled) task.nextRunAt = null
        this.store.saveTasks()
        this.changed()
        const removeAfter = task.cadence.type === 'once' && status === 'success'
        if (task.sourceSessionPath && task.notifications) {
          const statusText =
            status === 'success'
              ? `定时任务「${task.name}」已完成${run.durationMs ? `，用时 ${Math.max(1, Math.round(run.durationMs / 1000))}s` : ''}。`
              : status === 'failed' || status === 'timeout'
                ? `定时任务「${task.name}」执行${status === 'timeout' ? '超时' : '失败'}${error ? `：${error}` : '。'}`
                : `定时任务「${task.name}」已结束（${status}）。`
          const notice = {
            id: `notice-${run.id}`,
            sessionPath: task.sourceSessionPath,
            taskId: task.id,
            taskName: task.name,
            status,
            runId: run.id,
            text: statusText,
            createdAt: endedAt
          }
          addSessionNotice(notice)
          this.notifyEvent({ type: 'notice', notice })
        }
        this.notifyEvent({
          type: 'finished',
          taskId: task.id,
          name: task.name,
          runId,
          status,
          durationMs: run.durationMs,
          error,
          sessionPath: run.sessionPath,
          removed: removeAfter
        })
        this.notify(task, status)
        log.end()
        if (removeAfter) {
          this.store.removeTask(task.id)
          this.changed()
        }
        resolve(run)
      }

      let child: ChildProcess
      try {
        child = spawn(pi, args, {
          cwd,
          env: { ...process.env, PATH: augmentedPath() },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
          shell: process.platform === 'win32'
        })
      } catch (error) {
        finish('failed', null, error instanceof Error ? error.message : String(error))
        return
      }
      this.children.set(task.id, child)

      const capture = (chunk: Buffer): void => {
        log.write(chunk)
        tail = (tail + chunk.toString()).slice(-8000)
      }
      child.stdout?.on('data', capture)
      child.stderr?.on('data', capture)
      child.on('error', (error) => finish('failed', null, error.message))
      child.on('close', (code) => {
        if (timedOut) finish('timeout', code, '运行超过 30 分钟，已终止')
        else if (code === 0) finish('success', code)
        else finish('failed', code, `pi 退出码 ${code ?? 'unknown'}`)
      })

      timeout = setTimeout(() => {
        timedOut = true
        this.killTree(child)
      }, RUN_TIMEOUT_MS)
    })

    return promise
  }

  private killTree(child: ChildProcess): void {
    const pid = child.pid
    if (!pid) return
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        process.kill(-pid, 'SIGTERM')
        setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL')
          } catch {
            // already gone
          }
        }, 5000)
      }
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }
  }

  private findSession(dir: string, sessionId: string): string | undefined {
    try {
      const files = readdirSync(dir)
        .filter((file) => file.endsWith('.jsonl'))
        .map((file) => ({ file: join(dir, file), mtime: statSync(join(dir, file)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
      const match = files.find((item) => item.file.includes(sessionId))
      return (match ?? files[0])?.file
    } catch {
      return undefined
    }
  }

  private cleanSummary(text: string): string {
    return text
      .replace(/\u001b\[[0-9;]*m/g, '')
      .trim()
      .slice(-600)
  }

  private notify(task: ScheduledTask, status: ScheduledRunStatus): void {
    if (!task.notifications || !Notification.isSupported()) return
    const ok = status === 'success'
    const notification = new Notification({
      title: ok ? `${task.name} 已完成` : `${task.name} ${status === 'timeout' ? '超时' : '失败'}`,
      body: ok ? '点击打开 Pi Desktop 查看本次运行' : '点击打开 Pi Desktop 查看日志'
    })
    notification.on('click', () => {
      this.openTask(task.id)
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    })
    notification.show()
  }
}

export const scheduler = new ScheduleScheduler()
