import { useTranslation } from '../i18n'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronDown, Clock, FolderOpen, Play, Plus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import type {
  BackgroundSchedulerStatus,
  ScheduleCadence,
  SchedulePlan,
  ScheduledRun,
  ScheduledRunStatus,
  ScheduledTask
} from '@shared/types'
import { useApp, type ScheduleDraft } from '../store'
import { baseName, formatDuration } from '../lib/format'
import { Modal } from './ui'
import { useNavigationHistory } from '../lib/use-navigation-history'

const DEFAULT_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

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

function describeCron(expression: string): string | null {
  const parts = expression.trim().split(/\s+/)
  if (parts.length < 5) return null
  const [minute, hour, day, month, weekday] = parts
  if (day !== '*' || month !== '*') return null
  if (hour === '*' && /^\d+$/.test(minute) && weekday === '*') return `每小时的第 ${Number(minute)} 分钟`
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  if (weekday === '*') return `每天 ${time}`
  if (weekday === '1-5' || weekday === '1,2,3,4,5') return `工作日 ${time}`
  if (weekday === '0,6' || weekday === '6,0') return `周末 ${time}`
  return null
}

function cadenceText(cadence: ScheduleCadence, timezone?: string): string {
  if (cadence.type === 'once') return `一次 · ${formatWhen(cadence.at, timezone)}`
  if (cadence.type === 'hourly') return `每小时 :${String(cadence.minute).padStart(2, '0')}`
  if (cadence.type === 'daily') return `每天 ${cadence.time}`
  if (cadence.type === 'weekdays') return `工作日 ${cadence.time}`
  if (cadence.type === 'weekly') return `${WEEKDAYS[cadence.weekday] ?? '每周'} ${cadence.time}`
  if (cadence.type === 'cron') return describeCron(cadence.expression) ?? '自定义时间'
  return `文件有变化时 · ${baseName(cadence.path)}`
}

function statusLabel(status: ScheduledRunStatus | null, t: (text: string) => string): string {
  if (!status) return t('还没运行')
  const labels: Record<ScheduledRunStatus, string> = {
    running: t('运行中'),
    success: t('成功'),
    failed: t('失败'),
    timeout: t('超时'),
    interrupted: t('中断 · 待核对'),
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

function ScheduleEditor({ task, draft, onClose, onSaved }: {
  task?: ScheduledTask
  draft?: ScheduleDraft
  onClose: () => void
  onSaved: (task: ScheduledTask) => void
}): ReactNode {
  const t = useTranslation()
  const { state } = useApp()
  const [description, setDescription] = useState(draft?.prompt ?? '')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [replies, setReplies] = useState<{ question: string; answer: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const pending = useRef<string | null>(null)
  const savingRef = useRef(false)
  const [advanced, setAdvanced] = useState(false)
  const [catchUp, setCatchUp] = useState(task?.catchUp ?? false)
  const [notifications, setNotifications] = useState(task?.notifications ?? true)
  const [runMode, setRunMode] = useState(task?.runMode ?? 'new-session')
  const [initial] = useState<SchedulePlan | null>(() => {
    if (task) return {
      name: task.name, prompt: task.prompt, cadence: task.cadence, timezone: task.timezone ?? DEFAULT_TZ,
      nextRuns: task.nextRunAt ? [task.nextRunAt] : []
    }
    return draft?.cadence ? {
      name: draft.name || deriveName(draft.prompt), prompt: draft.prompt, cadence: draft.cadence,
      timezone: DEFAULT_TZ, nextRuns: []
    } : null
  })
  const [plan, setPlan] = useState(initial)

  useEffect(() => {
    if (!initial) return
    let active = true
    void window.pi.previewSchedule(initial.cadence, 3, initial.timezone).then((nextRuns) => {
      if (active) setPlan((current) => current === initial ? { ...initial, nextRuns } : current)
    }).catch(() => undefined)
    return () => { active = false }
  }, [initial])

  useEffect(() => () => {
    if (pending.current) void window.pi.cancelScheduleInterpretation(pending.current).catch(() => undefined)
    pending.current = null
  }, [])

  const changeDescription = (value: string): void => {
    if (pending.current) {
      void window.pi.cancelScheduleInterpretation(pending.current).catch(() => undefined)
      pending.current = null
      setBusy(false)
    }
    setDescription(value)
    setQuestion('')
    setAnswer('')
    setReplies([])
    setError('')
    setPlan(task && !value.trim() ? initial : null)
  }

  const identify = async (): Promise<void> => {
    if (!description.trim() || pending.current || (question && !answer.trim())) return
    const id = crypto.randomUUID()
    pending.current = id
    setBusy(true)
    setError('')
    const answers = question ? [...replies, { question, answer: answer.trim() }] : replies
    const model = state.piState?.model
    try {
      const result = await window.pi.interpretSchedule(id, {
        description: description.trim(), replies: answers, taskId: task?.id,
        model: model ? { provider: model.provider, id: model.id } : undefined
      })
      if (pending.current !== id) return
      if ('plan' in result) {
        setPlan(result.plan)
        setQuestion('')
      } else if ('question' in result) {
        setReplies(answers)
        setAnswer('')
        setQuestion(result.question)
      } else if (result.error === 'offline') {
        setError('识别计划需要联网。打开联网后再试。')
      } else if (result.error === 'expired') {
        setError('这个时间已经过去了，请换一个时间。')
      } else {
        setError(result.error === 'model' ? '暂时无法连接模型，请检查模型连接后重试。' : '没能识别这条计划。请补充要做的事和具体时间，再试一次。')
      }
    } catch {
      if (pending.current === id) setError('暂时无法识别计划，请重试。')
    } finally {
      if (pending.current === id) {
        pending.current = null
        setBusy(false)
      }
    }
  }

  const save = async (): Promise<void> => {
    if (!plan || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      const { name, prompt, cadence, timezone } = plan
      const options = { catchUp, notifications, runMode }
      const schedule = { name, prompt, cadence, timezone }
      const result = task
        ? await window.pi.updateSchedule(task.id, description.trim() ? { ...schedule, ...options } : options, Boolean(description.trim()))
        : await window.pi.createSchedule({
          ...schedule, ...options, projectPath: state.workspace ?? '', sourceSessionPath: state.sessionPath ?? undefined
        }, true)
      if (!result) throw new Error('Task is no longer available')
      onSaved(result)
    } catch (err) {
      if (err instanceof Error && err.message.includes('SCHEDULE_TIME_EXPIRED')) {
        setError('这个时间已经过去了，请换一个时间。')
        setPlan(null)
      } else {
        setError('任务未保存，请再试一次。')
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const frequency = plan && (plan.cadence.type === 'cron'
    ? describeCron(plan.cadence.expression) || plan.summary || t('自定义时间')
    : plan.cadence.type === 'weekdays' ? `${t('周一至周五')} ${plan.cadence.time}` : cadenceText(plan.cadence, plan.timezone))
  return (
    <Modal open width={550}
      title={t(task ? '编辑定时任务' : '新建定时任务')}
      onClose={() => { if (!savingRef.current) onClose() }}
      footer={
        <>
          <button type="button" className="button ghost" disabled={saving} onClick={onClose}>{t('取消')}</button>
          <button type="button" className="button primary"
            disabled={busy || saving || (!plan && (!description.trim() || Boolean(question && !answer.trim())))}
            onClick={() => void (plan ? save() : identify())}>
            {t(saving ? '保存中…' : busy ? '正在识别…' : plan ? task ? '保存' : '创建任务' : question ? '继续识别' : '识别计划')}
          </button>
        </>
      }>
      <div className="schedule-form" aria-busy={busy || saving}>
        <label className="schedule-field">
          <span>{t(task ? '想怎么修改？' : '什么时候做什么？')}</span>
          <textarea className="schedule-textarea" autoFocus rows={3} maxLength={5000}
            disabled={saving} value={description} onChange={(event) => changeDescription(event.target.value)}
            placeholder={t(task ? '改为每周五下午 6 点' : '例如 每个工作日上午 9 点，汇总昨天的订单')} />
        </label>
        {question && (
          <label key={question} className="schedule-field schedule-question">
            <span>{question}</span>
            <input className="rename-input" autoFocus value={answer} maxLength={1000} disabled={busy}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void identify()
                }
              }}
              placeholder={t('补充一句即可')} />
          </label>
        )}
        {error && <p role="alert" className="schedule-error">{t(error)}</p>}
        {plan && (
          <div className="schedule-plan" aria-live="polite">
            <div className="schedule-plan-title"><Clock size={15} /> <strong>{plan.name}</strong></div>
            {plan.prompt !== plan.name && <p className="schedule-plan-prompt">{plan.prompt}</p>}
            <div className="schedule-plan-time">
              <span>{frequency}</span>
              {plan.cadence.type !== 'event' && <small>{plan.timezone}</small>}
            </div>
            {plan.nextRuns.length > 0 && (
              <div className="schedule-preview">
                <span>{t(plan.nextRuns.length === 1 ? '下次运行' : '接下来')}</span>
                {plan.nextRuns.map((date) => <time dateTime={new Date(date).toISOString()} key={date}>{formatWhen(date, plan.timezone)}</time>)}
              </div>
            )}
          </div>
        )}
        <button type="button" className={clsx('schedule-more', advanced && 'open')} aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}><ChevronDown size={13} />{t('更多选项')}</button>
        {advanced && (
          <div className="schedule-advanced">
            <label className="schedule-adv-row">
              <span>{t('运行方式')}</span>
              <select value={runMode} disabled={saving} onChange={(event) => setRunMode(event.target.value === 'continue-session' ? 'continue-session' : 'new-session')}>
                <option value="new-session">{t('每次新会话')}</option>
                <option value="continue-session">{t('继续同一会话')}</option>
              </select>
            </label>
            <div className="schedule-adv-row">
              <span>{t('完成通知')}</span>
              <button type="button" className={clsx('switch', notifications && 'on')} role="switch" aria-label={t('完成通知')}
                aria-checked={notifications} disabled={saving} onClick={() => setNotifications(!notifications)}><span className="switch-knob" /></button>
            </div>
            <div className="schedule-adv-row">
              <span>{t('错过时间后补跑')}</span>
              <button type="button" className={clsx('switch', catchUp && 'on')} role="switch" aria-label={t('错过时间后补跑')}
                aria-checked={catchUp} disabled={saving} onClick={() => setCatchUp(!catchUp)}><span className="switch-knob" /></button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export function SchedulesPage(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ScheduledTask | null>(null)
  const [runs, setRuns] = useState<ScheduledRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [editor, setEditor] = useState<{ task?: ScheduledTask; draft?: ScheduleDraft } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null)
  const [background, setBackground] = useState<BackgroundSchedulerStatus | null>(null)
  const [backgroundBusy, setBackgroundBusy] = useState(false)

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
      if (!state.schedulesOpen) return
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (editor || deleteTarget) return
      event.preventDefault()
      if (selected) setSelected(null)
      else actions.openSchedules(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, state.schedulesOpen, editor, deleteTarget, selected])

  const openDetailToken = useRef(0)
  const openDetail = useCallback(async (task: ScheduledTask) => {
    const token = ++openDetailToken.current
    setSelected(task)
    setRunsLoading(true)
    try {
      const detail = await window.pi.getSchedule(task.id)
      // A slower response for an earlier click must not overwrite the current one.
      if (token !== openDetailToken.current) return
      if (detail) {
        setSelected(detail.task)
        setRuns(detail.runs)
      }
    } finally {
      if (token === openDetailToken.current) setRunsLoading(false)
    }
  }, [])
  useNavigationHistory({ value: selected, key: selected?.id ?? 'list', enabled: state.schedulesOpen,
    isParent: (key) => key === 'list',
    canRestore: (next) => !next || tasks.some((task) => task.id === next.id),
    busy: Boolean(editor || deleteTarget), restore: (next) => {
      const fresh = next && tasks.find((task) => task.id === next.id)
      if (fresh) void openDetail(fresh)
      else setSelected(null)
    },
    animate: '.navigation-page:not([inert]) .detail-page,.navigation-page:not([inert]) .skills-scroll' })

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

  const openCreate = (): void => setEditor({})
  const openEdit = (task: ScheduledTask): void => setEditor({ task })
  useEffect(() => {
    if (!state.scheduleDraft) return
    setEditor({ draft: state.scheduleDraft })
    actions.clearScheduleDraft()
  }, [actions, state.scheduleDraft])

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

          {selected.lastStatus === 'interrupted' && <p className="install-warning">{t('任务运行时被中断，结果可能已经产生。请先核对实际结果，再决定是否重新运行或启用。')}</p>}
          <section className="detail-section">
            <h2>{t('要做的事情')}</h2>
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
                {t('也可以直接在对话里说「5 分钟后…」，Pi 会创建定时任务')}
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

      {editor && (
        <ScheduleEditor
          task={editor.task}
          draft={editor.draft}
          onClose={() => setEditor(null)}
          onSaved={(task) => {
            if (editor.task) setSelected(task)
            setEditor(null)
            void load()
          }}
        />
      )}

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
