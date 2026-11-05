import { useTranslation } from '../i18n'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronDown, Clock, FolderOpen, Play, Plus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import type {
  BackgroundSchedulerStatus,
  ScheduleCadence,
  ScheduledRun,
  ScheduledRunStatus,
  ScheduledTask,
  ScheduledTaskInput
} from '@shared/types'
import { useApp } from '../store'
import { baseName, formatDuration } from '../lib/format'
import { Modal } from './ui'

type CadenceKind = 'once' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'cron' | 'event'

const DEFAULT_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function toLocalInput(timestamp: number): string {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000)
  return date.toISOString().slice(0, 16)
}

function zonedParts(timestamp: number, timezone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(timestamp))
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute')
  }
}

function toZonedInput(timestamp: number, timezone: string): string {
  try {
    const p = zonedParts(timestamp, timezone)
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
  } catch {
    return toLocalInput(timestamp)
  }
}

function zonedInputToUtc(value: string, timezone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0)
  let guess = desired
  try {
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
  } catch {
    return null
  }
}

function formatWhen(timestamp: number | null, timezone?: string): string {
  if (!timestamp) return '—'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      ...(timezone ? { timeZone: timezone } : {}),
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp))
  } catch {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp))
  }
}

function cadenceText(cadence: ScheduleCadence, timezone?: string): string {
  if (cadence.type === 'once') return `一次 · ${formatWhen(cadence.at, timezone)}`
  if (cadence.type === 'hourly') return `每小时 :${String(cadence.minute).padStart(2, '0')}`
  if (cadence.type === 'daily') return `每天 ${cadence.time}`
  if (cadence.type === 'weekdays') return `工作日 ${cadence.time}`
  if (cadence.type === 'weekly') return `${WEEKDAYS[cadence.weekday] ?? '每周'} ${cadence.time}`
  if (cadence.type === 'cron') return `cron · ${cadence.expression}`
  return `文件变化 · ${baseName(cadence.path)}`
}

function statusLabel(status: ScheduledRunStatus | null, t: (text: string) => string): string {
  if (!status) return t('还没运行')
  const labels: Record<ScheduledRunStatus, string> = {
    running: t('运行中'),
    success: t('成功'),
    failed: t('失败'),
    timeout: t('超时'),
    interrupted: t('已中断'),
    missed: t('已错过'),
    skipped: t('已跳过')
  }
  return labels[status]
}

function deriveName(prompt: string): string {
  const first = prompt
    .split('\n')[0]
    .replace(/^#+\s*/, '')
    .replace(/[*_`>]/g, '')
    .trim()
  if (!first) return '定时任务'
  return first.length > 24 ? `${first.slice(0, 24)}…` : first
}

const TIMEZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney'
]

export function SchedulesPage(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ScheduledTask | null>(null)
  const [runs, setRuns] = useState<ScheduledRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ScheduledTask | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null)
  const [saving, setSaving] = useState(false)
  const [background, setBackground] = useState<BackgroundSchedulerStatus | null>(null)
  const [backgroundBusy, setBackgroundBusy] = useState(false)

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<CadenceKind>('daily')
  const [time, setTime] = useState('09:00')
  const [onceAt, setOnceAt] = useState(() => toLocalInput(Date.now() + 60 * 60_000))
  const [weekday, setWeekday] = useState(1)
  const [minute, setMinute] = useState(0)
  const [cronExpression, setCronExpression] = useState('0 9 * * *')
  const [cronError, setCronError] = useState<string | null>(null)
  const [timezone, setTimezone] = useState(DEFAULT_TZ)
  const [tzError, setTzError] = useState<string | null>(null)
  const [runMode, setRunMode] = useState<'new-session' | 'continue-session'>('new-session')
  const [catchUp, setCatchUp] = useState(true)
  const [notifications, setNotifications] = useState(true)
  const [preview, setPreview] = useState<number[]>([])
  const [noNext, setNoNext] = useState(false)
  const [runningSince, setRunningSince] = useState<Record<string, number>>({})
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async () => {
    try {
      setTasks(await window.pi.listSchedules())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    void window.pi.getBackgroundScheduler().then(setBackground).catch(() => undefined)
    return window.pi.onSchedulesChanged((next) => setTasks(next))
  }, [load])

  useEffect(() => {
    if (!selected) return
    const fresh = tasks.find((task) => task.id === selected.id)
    if (fresh && fresh !== selected) setSelected(fresh)
  }, [selected, tasks])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (createOpen || deleteTarget) return
      event.preventDefault()
      if (selected) setSelected(null)
      else actions.openSchedules(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, createOpen, deleteTarget, selected])

  const openDetail = useCallback(async (task: ScheduledTask) => {
    setSelected(task)
    setRunsLoading(true)
    try {
      const detail = await window.pi.getSchedule(task.id)
      if (detail) {
        setSelected(detail.task)
        setRuns(detail.runs)
      }
    } finally {
      setRunsLoading(false)
    }
  }, [])

  useEffect(() => {
    return window.pi.onScheduleEvent((event) => {
      if (event.type === 'started') {
        setRunningSince((current) => ({ ...current, [event.taskId]: event.startedAt }))
      } else if (event.type === 'finished') {
        setRunningSince((current) => {
          const next = { ...current }
          delete next[event.taskId]
          return next
        })
      }
    })
  }, [])

  useEffect(() => {
    if (!Object.keys(runningSince).length && !tasks.some((task) => task.lastStatus === 'running')) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [runningSince, tasks])

  useEffect(() => {
    if (!state.scheduleFocusId) return
    const task = tasks.find((item) => item.id === state.scheduleFocusId)
    if (!task) return
    void openDetail(task)
    actions.clearScheduleFocus()
  }, [actions, openDetail, state.scheduleFocusId, tasks])

  useEffect(() => {
    if (!selected) return
    const id = selected.id
    return window.pi.onScheduleEvent((event) => {
      if (event.type === 'created' || event.type === 'notice') return
      if (event.taskId !== id) return
      void window.pi.getSchedule(id).then((detail) => {
        if (!detail) {
          setSelected(null)
          setRuns([])
          return
        }
        setSelected(detail.task)
        setRuns(detail.runs)
      })
    })
  }, [selected?.id])

  const cadence: ScheduleCadence = useMemo(() => {
    if (kind === 'once') {
      const at = zonedInputToUtc(onceAt, timezone)
      return { type: 'once', at: at ?? new Date(onceAt).getTime() }
    }
    if (kind === 'event') {
      const path =
        editing?.cadence.type === 'event'
          ? editing.cadence.path
          : editing?.projectPath || state.workspace || ''
      return { type: 'event', event: 'file-change', path, debounceMs: 800 }
    }
    if (kind === 'cron') return { type: 'cron', expression: cronExpression.trim() }
    if (kind === 'hourly') return { type: 'hourly', minute }
    if (kind === 'daily') return { type: 'daily', time }
    if (kind === 'weekdays') return { type: 'weekdays', time }
    return { type: 'weekly', weekday, time }
  }, [cronExpression, editing, kind, minute, onceAt, state.workspace, time, timezone, weekday])

  useEffect(() => {
    if (!createOpen) return
    let alive = true
    try {
      if (timezone.trim()) new Intl.DateTimeFormat('en-US', { timeZone: timezone.trim() })
      setTzError(null)
    } catch {
      setTzError('无效的时区')
    }
    if (kind === 'cron') {
      void window.pi.validateCron(cronExpression).then((error) => {
        if (alive) setCronError(error)
      })
    } else {
      setCronError(null)
    }
    void window.pi.previewSchedule(cadence, 3, timezone).then((next) => {
      if (alive) {
        setPreview(next)
        setNoNext(kind !== 'event' && next.length === 0)
      }
    })
    return () => {
      alive = false
    }
  }, [cadence, createOpen, cronExpression, kind, timezone])

  const resetForm = (task?: ScheduledTask): void => {
    setPrompt(task?.prompt ?? '')
    setTimezone(task?.timezone || DEFAULT_TZ)
    setRunMode(task?.runMode ?? 'new-session')
    setCatchUp(task?.catchUp ?? true)
    setNotifications(task?.notifications ?? true)
    setAdvancedOpen(false)
    const value = task?.cadence
    if (value) {
      setKind(value.type)
      if (value.type === 'once') setOnceAt(toZonedInput(value.at, task?.timezone || DEFAULT_TZ))
      if (value.type === 'hourly') setMinute(value.minute)
      if (value.type === 'weekly') {
        setWeekday(value.weekday)
        setTime(value.time)
      }
      if (value.type === 'daily' || value.type === 'weekdays') setTime(value.time)
      if (value.type === 'cron') setCronExpression(value.expression)
    } else {
      setKind('daily')
      setTime('09:00')
      setWeekday(1)
      setMinute(0)
      setOnceAt(toLocalInput(Date.now() + 60 * 60_000))
      setCronExpression('0 9 * * *')
    }
  }

  const openCreate = (): void => {
    setEditing(null)
    resetForm()
    setCreateOpen(true)
  }

  const openEdit = (task: ScheduledTask): void => {
    setEditing(task)
    resetForm(task)
    setCreateOpen(true)
  }

  useEffect(() => {
    const draft = state.scheduleDraft
    if (!draft) return
    setEditing(null)
    resetForm()
    setPrompt(draft.prompt)
    const value = draft.cadence
    if (value) {
      setKind(value.type)
      if (value.type === 'cron') setCronExpression(value.expression)
      if (value.type === 'once') setOnceAt(toZonedInput(value.at, DEFAULT_TZ))
      if (value.type === 'hourly') setMinute(value.minute)
      if (value.type === 'weekly') {
        setWeekday(value.weekday)
        setTime(value.time)
      }
      if (value.type === 'daily' || value.type === 'weekdays') setTime(value.time)
    }
    setCreateOpen(true)
    actions.clearScheduleDraft()
  }, [actions, state.scheduleDraft, state.workspace])

  const save = async (): Promise<void> => {
    if (!prompt.trim() || saving || cronError) return
    setSaving(true)
    try {
      const projectPath = editing?.projectPath || state.workspace || ''
      const input: ScheduledTaskInput = {
        name: editing?.name ?? deriveName(prompt),
        prompt: prompt.trim(),
        projectPath,
        sourceSessionPath: editing?.sourceSessionPath ?? state.sessionPath ?? undefined,
        cadence,
        timezone,
        runMode,
        catchUp,
        notifications,
        enabled: editing?.enabled ?? true
      }
      if (editing?.tools?.length) input.tools = editing.tools
      if (editing) {
        const updated = await window.pi.updateSchedule(editing.id, input)
        if (updated) setSelected(updated)
      } else {
        await window.pi.createSchedule(input)
      }
      setCreateOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (task: ScheduledTask): Promise<void> => {
    await window.pi.setScheduleEnabled(task.id, !task.enabled)
    await load()
    if (selected?.id === task.id) {
      const detail = await window.pi.getSchedule(task.id)
      if (detail) setSelected(detail.task)
    }
  }

  const runNow = async (task: ScheduledTask): Promise<void> => {
    await window.pi.runScheduleNow(task.id)
    const detail = await window.pi.getSchedule(task.id)
    if (detail) {
      setSelected(detail.task)
      setRuns(detail.runs)
    }
  }

  const remove = async (): Promise<void> => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    await window.pi.deleteSchedule(target.id)
    if (selected?.id === target.id) setSelected(null)
    await load()
  }

  const toggleBackground = async (enabled: boolean): Promise<void> => {
    setBackgroundBusy(true)
    try {
      const status = await window.pi.setBackgroundScheduler(enabled)
      setBackground(status)
      if (status.detail && status.installed !== enabled) {
        actions.notify('warning', t('系统级调度没有启用'), status.detail)
      }
    } finally {
      setBackgroundBusy(false)
    }
  }

  const enabledCount = tasks.filter((task) => task.enabled).length
  const runningCount = tasks.filter((task) => task.lastStatus === 'running').length
  const timezoneOptions = useMemo(
    () => Array.from(new Set([DEFAULT_TZ, ...TIMEZONES, timezone])),
    [timezone]
  )
  const canSave = Boolean(prompt.trim() && !cronError && !tzError && !noNext)

  return (
    <div className="skills-page" role="dialog" aria-label={t('定时任务')}>
      <div className="skills-drag" />
      <div className="skills-head">
        <button
          className="icon-button skills-back"
          onClick={() => (selected ? setSelected(null) : actions.openSchedules(false))}
          aria-label={t('返回')}
        >
          <ArrowLeft size={16} />
        </button>
        {selected ? (
          <div className="skills-crumbs">
            <span>{t('定时任务')}</span>
            <span className="crumb-sep">›</span>
            <b>{selected.name}</b>
          </div>
        ) : (
          <>
            <div className="skills-title">{t('定时任务')}</div>
            <div className="skills-count">
              {enabledCount} {t('个启用')} · {tasks.length - enabledCount} {t('个暂停')}
              {runningCount > 0 ? ` · ${runningCount} ${t('个运行中')}` : ''}
            </div>
            <div className="skills-head-actions">
              <label className="sched-login">
                <input
                  type="checkbox"
                  checked={state.settings.launchAtLogin === true}
                  onChange={(event) => void actions.updateSettings({ launchAtLogin: event.target.checked })}
                />
                {t('登录时启动')}
              </label>
              <label
                className="sched-login"
                title={t('安装系统级调度，应用完全关闭也会按计划启动')}
              >
                <input
                  type="checkbox"
                  checked={background?.installed === true}
                  disabled={!background?.supported || backgroundBusy}
                  onChange={(event) => void toggleBackground(event.target.checked)}
                />
                {t('关闭后继续运行')}
              </label>
              <button className="button primary small" onClick={openCreate}>
                <Plus size={13} /> {t('新建任务')}
              </button>
            </div>
          </>
        )}
      </div>

      {selected ? (
        <div className="detail-page schedule-detail">
          <div className="detail-hero">
            <div className="detail-icon">
              <Clock size={26} />
            </div>
            <div className="detail-heading">
              <h1>{selected.name}</h1>
              <p>
                {cadenceText(selected.cadence, selected.timezone)}
                {' · '}
                {selected.timezone || DEFAULT_TZ}
                {' · '}
                {selected.enabled ? t('启用') : t('暂停')}
              </p>
            </div>
            <div className="detail-actions">
              <button className="button primary small" onClick={() => void runNow(selected)}>
                <Play size={13} /> {t('立即运行')}
              </button>
              <button className="button ghost small" onClick={() => void toggle(selected)}>
                {selected.enabled ? t('暂停') : t('恢复')}
              </button>
              <button className="button ghost small" onClick={() => openEdit(selected)}>
                {t('编辑')}
              </button>
              <button className="button ghost small danger" onClick={() => setDeleteTarget(selected)}>
                <Trash2 size={13} /> {t('删除')}
              </button>
            </div>
          </div>

          <section className="detail-section">
            <h2>{t('信息')}</h2>
            <dl className="detail-info">
              <div>
                <dt>{t('频率')}</dt>
                <dd>{cadenceText(selected.cadence, selected.timezone)}</dd>
              </div>
              <div>
                <dt>{t('下次运行')}</dt>
                <dd>
                  {selected.pendingCatchUpAt != null
                    ? `${t('等待补跑')} · ${formatWhen(selected.pendingCatchUpAt, selected.timezone)}`
                    : formatWhen(selected.nextRunAt, selected.timezone)}
                </dd>
              </div>
              <div>
                <dt>{t('时区')}</dt>
                <dd>{selected.timezone || DEFAULT_TZ}</dd>
              </div>
              <div>
                <dt>{t('项目')}</dt>
                <dd className="mono">{selected.projectPath || '—'}</dd>
              </div>
              <div>
                <dt>{t('运行方式')}</dt>
                <dd>{selected.runMode === 'continue-session' ? t('继续同一会话') : t('每次新会话')}</dd>
              </div>
              <div>
                <dt>{t('工具白名单')}</dt>
                <dd>{selected.tools?.length ? selected.tools.join(', ') : t('默认工具')}</dd>
              </div>
              <div>
                <dt>{t('上次运行')}</dt>
                <dd className={selected.lastStatus && selected.lastStatus !== 'success' ? 'missing' : ''}>
                  {formatWhen(selected.lastRunAt, selected.timezone)} · {statusLabel(selected.lastStatus, t)}
                </dd>
              </div>
            </dl>
          </section>

          <section className="detail-section">
            <h2>{t('Prompt')}</h2>
            <pre className="schedule-prompt">{selected.prompt}</pre>
          </section>

          <section className="detail-section">
            <h2>{t('运行历史')}</h2>
            {runsLoading ? (
              <div className="skills-empty">{t('读取中…')}</div>
            ) : runs.length === 0 ? (
              <div className="skills-empty">{t('还没有运行记录')}</div>
            ) : (
              <div className="schedule-runs">
                {runs.map((run) => (
                  <div className="schedule-run" key={run.id}>
                    <span className={clsx('schedule-run-status', run.status)}>
                      {statusLabel(run.status, t)}
                    </span>
                    <span className="schedule-run-time">{formatWhen(run.startedAt, selected.timezone)}</span>
                    <span className="schedule-run-duration">{formatDuration(run.durationMs)}</span>
                    <span className="schedule-run-summary">{run.error || run.summary || run.trigger}</span>
                    <span className="schedule-run-actions">
                      {run.sessionPath && (
                        <button
                          className="button ghost small"
                          onClick={() => {
                            actions.openSchedules(false)
                            void actions.openSession(selected.projectPath, run.sessionPath)
                          }}
                        >
                          {t('打开会话')}
                        </button>
                      )}
                      {run.logPath && (
                        <button className="icon-button" title={t('查看日志')} onClick={() => window.pi.showItem(run.logPath)}>
                          <FolderOpen size={13} />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="skills-scroll">
          {loading ? (
            <div className="skills-empty">{t('读取中…')}</div>
          ) : tasks.length === 0 ? (
            <div className="skills-empty schedule-empty">
              <Clock size={22} />
              <p>{t('还没有定时任务')}</p>
              <button className="button primary small" onClick={openCreate}>
                <Plus size={13} /> {t('新建任务')}
              </button>
              <p className="schedule-empty-hint">
                {t('也可以直接在对话里说「5 分钟后…」，pi 会创建定时任务')}
              </p>
            </div>
          ) : (
            <div className="package-list">
              {tasks.map((task) => (
                <div
                  className="package-row schedule-row"
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void openDetail(task)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      void openDetail(task)
                    }
                  }}
                >
                  <div className="skill-tile">
                    <Clock size={15} />
                  </div>
                  <div className="package-body">
                    <div className="package-name">
                      {task.name}
                      <span className={clsx('connector-status', task.enabled ? 'ok' : 'missing')}>
                        {task.enabled ? t('启用') : t('暂停')}
                      </span>
                    </div>
                    <div className="package-desc">
                      {cadenceText(task.cadence, task.timezone)}
                      {task.projectPath ? ` · ${baseName(task.projectPath)}` : ''}
                    </div>
                  </div>
                  <div className="schedule-row-meta">
                    <span>{t('下次')} {formatWhen(task.nextRunAt, task.timezone)}</span>
                    <span className={clsx('schedule-last', task.lastStatus ?? '')}>
                      {task.pendingCatchUpAt != null
                        ? t('等待补跑')
                        : task.lastStatus === 'running'
                          ? `${t('运行中')} ${formatDuration(now - (runningSince[task.id] ?? task.lastRunAt ?? now))}`
                          : statusLabel(task.lastStatus, t)}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={task.enabled}
                    aria-label={t('启用')}
                    className={clsx('switch', task.enabled && 'on')}
                    onClick={(event) => {
                      event.stopPropagation()
                      void toggle(task)
                    }}
                  >
                    <span className="switch-knob" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal
        open={createOpen}
        title={editing ? t('编辑定时任务') : t('新建定时任务')}
        subtitle={t('任务会在后台启动一个独立的 pi 会话')}
        onClose={() => (saving ? undefined : setCreateOpen(false))}
        width={680}
        footer={
          <>
            <button className="button ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              {t('取消')}
            </button>
            <button className="button primary" onClick={() => void save()} disabled={!canSave || saving}>
              {saving ? t('保存中…') : t('保存')}
            </button>
          </>
        }
      >
        <div className="schedule-form">
          <label className="schedule-field">
            <span>{t('Prompt')}</span>
            <textarea
              className="schedule-textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              placeholder={t('每次运行时要执行的完整指令')}
            />
          </label>
          <div className="schedule-field">
            <span>{t('频率')}</span>
            <div className="schedule-cadence">
              {(['once', 'hourly', 'daily', 'weekdays', 'weekly', 'cron', 'event'] as CadenceKind[]).map((item) => (
                <button
                  key={item}
                  className={clsx('skills-filter', kind === item && 'active')}
                  onClick={() => setKind(item)}
                >
                  {item === 'once'
                    ? t('一次性')
                    : item === 'hourly'
                      ? t('每小时')
                      : item === 'daily'
                        ? t('每天')
                        : item === 'weekdays'
                          ? t('工作日')
                          : item === 'weekly'
                            ? t('每周')
                            : item === 'cron'
                              ? t('自定义 cron')
                              : t('文件变化')}
                </button>
              ))}
            </div>
            <div className="schedule-cadence-row">
              {kind === 'once' ? (
                <label>
                  {t('时间')}
                  <input type="datetime-local" value={onceAt} onChange={(event) => setOnceAt(event.target.value)} />
                </label>
              ) : kind === 'hourly' ? (
                <label>
                  {t('分钟')}
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={minute}
                    onChange={(event) => setMinute(Number(event.target.value))}
                  />
                </label>
              ) : kind === 'event' ? (
                <p className="schedule-hint">{t('监听当前项目，800ms 内合并多次变化')}</p>
              ) : kind === 'cron' ? (
                <label className="schedule-cron">
                  {t('表达式')}
                  <input
                    className="rename-input"
                    value={cronExpression}
                    onChange={(event) => setCronExpression(event.target.value)}
                    placeholder="0 9 * * 1-5"
                  />
                </label>
              ) : (
                <>
                  <label>
                    {t('时间')}
                    <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
                  </label>
                  {kind === 'weekly' && (
                    <label>
                      {t('星期')}
                      <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
                        {WEEKDAYS.map((label, index) => (
                          <option key={label} value={index}>{label}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
            </div>
            {kind === 'cron' && (
              <p className={clsx('schedule-hint', cronError && 'missing')}>
                {cronError || t('格式：分 时 日 月 周，例如 0 9 * * 1-5 表示工作日 09:00')}
              </p>
            )}
            {kind === 'event' && (
              <p className="schedule-hint">{t('目录内任意文件变化后触发，800ms 内合并多次变化')}</p>
            )}
            {noNext && !cronError && (
              <p className="schedule-hint missing">{t('未来 8 年没有匹配的运行时间')}</p>
            )}
          </div>
          <button
            className={clsx('schedule-more', advancedOpen && 'open')}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <ChevronDown size={13} /> {t('更多选项')}
          </button>
          {advancedOpen && (
            <div className="schedule-advanced">
              <label className="schedule-adv-row">
                <span>{t('时区')}</span>
                <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                  {timezoneOptions.map((zone) => (
                    <option key={zone} value={zone}>{zone}</option>
                  ))}
                </select>
              </label>
              <label className="schedule-adv-row">
                <span>{t('运行方式')}</span>
                <select
                  value={runMode}
                  onChange={(event) => setRunMode(event.target.value as 'new-session' | 'continue-session')}
                >
                  <option value="new-session">{t('每次新会话')}</option>
                  <option value="continue-session">{t('继续同一会话')}</option>
                </select>
              </label>
              <div className="schedule-adv-row">
                <span>{t('错过补跑')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={catchUp}
                  className={clsx('switch', catchUp && 'on')}
                  onClick={() => setCatchUp((value) => !value)}
                >
                  <span className="switch-knob" />
                </button>
              </div>
              <div className="schedule-adv-row">
                <span>{t('完成通知')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={notifications}
                  className={clsx('switch', notifications && 'on')}
                  onClick={() => setNotifications((value) => !value)}
                >
                  <span className="switch-knob" />
                </button>
              </div>
            </div>
          )}
          <div className="schedule-preview">
            <span>{t('接下来')}</span>
            {preview.length === 0 ? <span>—</span> : preview.map((timestamp) => (
              <span key={timestamp}>{formatWhen(timestamp, timezone)}</span>
            ))}
          </div>
          <p className="install-warning">
            {t('定时任务会在无人确认的情况下读写当前项目、执行命令。只给可信的 prompt。')}
          </p>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        title={t('删除定时任务？')}
        subtitle={deleteTarget?.name}
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <button className="button ghost" onClick={() => setDeleteTarget(null)}>{t('取消')}</button>
            <button className="button danger" onClick={() => void remove()}>{t('删除')}</button>
          </>
        }
      >
        <p className="modal-text">{t('任务和运行记录会被删除，已生成的会话保留。')}</p>
      </Modal>
    </div>
  )
}
