import { Check, Mic, Square, X } from 'lucide-react'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { DictationError, DictationEvent, DictationLocale, DictationSettingsTarget } from '@shared/dictation'
import { useTranslation } from '../i18n'
import { Spinner } from './ui'
import './dictation.css'

type Status =
  | { kind: 'idle' | 'starting' | 'recording' | 'transcribing' | 'done' }
  | { kind: 'error'; error: DictationError }

interface Recording {
  id: string
  phase: 'starting' | 'recording' | 'transcribing'
  value: string
  start: number
  end: number
}

const errors: Record<DictationError, string> = {
  microphone: '请在系统设置中允许 Pi 使用麦克风。',
  speech: '请在系统设置中允许 Pi 使用语音识别。',
  'language-unavailable': '当前语言的本机听写资源不可用。',
  unavailable: '当前设备或语言暂不支持本机听写。',
  busy: '已有语音输入正在处理。请稍后重试。',
  'no-speech': '没听到清晰的语音，请重试。',
  failed: '语音输入失败，请确认麦克风可用后重试。',
  timeout: '转写超时，请试着缩短录音。'
}

export function useDictation(
  owner: string,
  covered: boolean,
  locale: DictationLocale,
  inputRef: RefObject<HTMLTextAreaElement | null>,
  updateDraft: (text: string) => void
) {
  const api = window.pi.dictation
  const [available, setAvailable] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const active = useRef<Recording | null>(null)
  const caret = useRef<{ start: number; end: number } | null>(null)
  const drawLevel = useRef<((level: number) => void) | null>(null)
  const [selection, setSelection] = useState(0)

  useLayoutEffect(() => {
    setStatus((current) => current.kind === 'idle' ? current : { kind: 'idle' })
    return () => {
      const operation = active.current
      active.current = null
      caret.current = null
      if (operation) void api?.cancel(operation.id).catch(() => {})
    }
  }, [api, owner, covered, locale])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (input && caret.current !== null) {
      input.focus({ preventScroll: true })
      input.setSelectionRange(caret.current.start, caret.current.end)
      caret.current = null
    }
  }, [inputRef, selection])

  const onEvent = useEffectEvent((event: DictationEvent & { id: string }) => {
    const operation = active.current
    if (!operation || operation.id !== event.id) return
    if (event.type === 'level') {
      if (operation.phase === 'recording') drawLevel.current?.(event.level)
      return
    }
    if (event.type === 'recording') {
      operation.phase = 'recording'
      setStatus({ kind: 'recording' })
      return
    }
    if (event.type === 'transcribing') {
      operation.phase = 'transcribing'
      setStatus({ kind: 'transcribing' })
      return
    }
    active.current = null
    if (event.type === 'error') {
      setStatus({ kind: 'error', error: event.error })
      focusDraft(operation)
      return
    }
    if (event.type !== 'result') return
    const transcript = event.text.trim()
    const input = inputRef.current
    if (!transcript || !input) {
      setStatus({ kind: 'error', error: 'no-speech' })
      focusDraft(operation)
      return
    }

    const value = input.value
    const unchanged = value === operation.value
    const start = unchanged ? operation.start : input.selectionEnd
    const end = unchanged ? operation.end : start
    const before = value.slice(0, start)
    const after = value.slice(end)
    const separator = locale === 'en-US' && /\S$/.test(before) ? ' ' : ''
    const trailing = locale === 'en-US' && /^[\p{L}\p{N}]/u.test(after) ? ' ' : ''
    const position = before.length + separator.length + transcript.length + trailing.length
    caret.current = { start: position, end: position }
    updateDraft(before + separator + transcript + trailing + after)
    setSelection((current) => current + 1)
    setStatus({ kind: 'done' })
  })

  useEffect(() => {
    if (!api) return
    let live = true
    const unsubscribe = api.onEvent((event) => onEvent(event))
    void api.available().then((value) => { if (live) setAvailable(value) }).catch(() => {})
    return () => {
      live = false
      unsubscribe()
    }
  }, [api])

  useEffect(() => {
    if (status.kind !== 'done') return
    const timer = setTimeout(() => setStatus((current) => current.kind === 'done' ? { kind: 'idle' } : current), 1400)
    return () => clearTimeout(timer)
  }, [status])

  function focusDraft(operation: Recording) {
    const input = inputRef.current
    if (!input) return
    caret.current = input.value === operation.value
      ? { start: operation.start, end: operation.end }
      : { start: input.selectionStart, end: input.selectionEnd }
    setSelection((current) => current + 1)
  }

  function failed(id: string) {
    const operation = active.current
    if (id !== operation?.id) return
    active.current = null
    void api?.cancel(id).catch(() => {})
    setStatus({ kind: 'error', error: 'failed' })
    focusDraft(operation)
  }

  function toggle() {
    if (!api || !available || covered) return
    const operation = active.current
    if (operation) {
      if (operation.phase !== 'recording') return
      operation.phase = 'transcribing'
      setStatus({ kind: 'transcribing' })
      void api.stop(operation.id).catch(() => failed(operation.id))
      return
    }
    const input = inputRef.current
    if (!input) return
    const id = crypto.randomUUID()
    active.current = { id, phase: 'starting', value: input.value, start: input.selectionStart, end: input.selectionEnd }
    setStatus({ kind: 'starting' })
    void api.start(id, locale).catch(() => failed(id))
  }

  function cancel() {
    const operation = active.current
    active.current = null
    setStatus({ kind: 'idle' })
    if (operation) {
      void api?.cancel(operation.id).catch(() => {})
      focusDraft(operation)
    }
  }

  const settingsTarget: DictationSettingsTarget | null = status.kind !== 'error' ? null
    : status.error === 'microphone' || status.error === 'speech' ? status.error
    : status.error === 'language-unavailable' ? 'language' : null

  const openSettings = () => {
    if (settingsTarget) void api?.openSettings(settingsTarget).catch(() => {})
  }

  const busy = status.kind === 'starting' || status.kind === 'recording' || status.kind === 'transcribing'
  return { active, available, busy, status, toggle, cancel, openSettings, settingsTarget, drawLevel }
}

type DictationControls = ReturnType<typeof useDictation>

const WAVEFORM_SAMPLES = 192
const WAVEFORM_SPACING = 5
const WAVEFORM_MIN_HEIGHT = 2
const WAVEFORM_MAX_HEIGHT = 24

function DictationWaveform({
  drawLevel,
  recording
}: {
  drawLevel: DictationControls['drawLevel']
  recording: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const samples = new Float32Array(WAVEFORM_SAMPLES)
    let nextSample = 0
    let width = 0
    let height = 0
    let color = ''
    let frame = 0

    function draw() {
      frame = 0
      if (!context) return
      context.clearRect(0, 0, width, height)
      context.fillStyle = color
      const count = Math.min(WAVEFORM_SAMPLES, Math.ceil(width / WAVEFORM_SPACING))
      for (let offset = 0; offset < count; offset++) {
        const index = (nextSample + WAVEFORM_SAMPLES - 1 - offset) % WAVEFORM_SAMPLES
        const level = motion.matches ? 0 : samples[index]
        const bar = WAVEFORM_MIN_HEIGHT + (WAVEFORM_MAX_HEIGHT - WAVEFORM_MIN_HEIGHT) * level
        context.globalAlpha = level > 0 ? .45 + .55 * level : .28
        context.beginPath()
        context.roundRect(width - offset * WAVEFORM_SPACING - 2, (height - bar) / 2, 2, bar, 1)
        context.fill()
      }
    }

    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width
      height = entry.contentRect.height
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      color = getComputedStyle(canvas).color
      draw()
    })
    resize.observe(canvas)
    motion.addEventListener('change', draw)
    if (recording) {
      drawLevel.current = (level) => {
        if (motion.matches) return
        samples[nextSample] = Math.min(1, Math.max(0, level))
        nextSample = (nextSample + 1) % WAVEFORM_SAMPLES
        if (!frame) frame = requestAnimationFrame(draw)
      }
    }
    return () => {
      drawLevel.current = null
      resize.disconnect()
      motion.removeEventListener('change', draw)
      cancelAnimationFrame(frame)
    }
  }, [drawLevel, recording])

  return <canvas ref={canvasRef} className="dictation-waveform" aria-hidden="true" />
}

export function DictationBar({ controls }: { controls: DictationControls }) {
  const t = useTranslation()
  const { status, busy, drawLevel, toggle, cancel } = controls
  const finishRef = useRef<HTMLButtonElement>(null)
  const recording = status.kind === 'recording'
  const label = recording ? t('麦克风已开启')
    : status.kind === 'transcribing' ? t('正在转写…')
    : t('正在准备麦克风…')

  useLayoutEffect(() => {
    if (busy) finishRef.current?.focus({ preventScroll: true })
  }, [busy])

  return <div className="dictation-bar" hidden={!busy} inert={!busy} data-state={status.kind}>
    {busy && <>
      <button type="button" className="dictation-cancel" onClick={cancel}
        aria-label={t('取消录音')} title={t('取消录音')}>
        <X size={17} aria-hidden="true" />
      </button>
      <div className="dictation-track">
        <span role="status" className="dictation-track-label">
          {recording && <span className="dictation-dot" aria-hidden="true" />}
          <span className={recording ? 'dictation-announcement' : 'dictation-label'}>{label}</span>
        </span>
        <DictationWaveform drawLevel={drawLevel} recording={recording} />
      </div>
      <button ref={finishRef} type="button" className="dictation-finish" onClick={recording ? toggle : undefined}
        aria-disabled={!recording} aria-label={recording ? t('结束录音并转写') : label}
        title={recording ? t('结束录音并转写') : label}>
        {recording ? <Square size={10} fill="currentColor" aria-hidden="true" /> : <Spinner size={14} />}
        <span>{t('转写')}</span>
      </button>
    </>}
  </div>
}

export function DictationStatus({ controls }: { controls: DictationControls }) {
  const t = useTranslation()
  const { status, openSettings, settingsTarget } = controls
  const visible = status.kind === 'done' || status.kind === 'error'
  const label = status.kind === 'error' ? t(errors[status.error]) : status.kind === 'done' ? t('已填入草稿') : ''
  return <div className="dictation-status" data-visible={visible}>
    <div className="dictation-status-content">
      <span role="status" className="dictation-message">
        {status.kind === 'done' && <Check size={14} aria-hidden="true" />}
        <span className="dictation-label" key={status.kind}>{label}</span>
      </span>
      {settingsTarget && <button type="button" onClick={openSettings}>
        {settingsTarget === 'language' ? t('打开听写设置') : t('打开系统设置')}
      </button>}
    </div>
  </div>
}

export function DictationButton({ controls, disabled }: { controls: DictationControls; disabled: boolean }) {
  const t = useTranslation()
  if (!controls.available) return null
  const label = t('语音输入')
  return <button type="button" className="icon-button dictation-button" disabled={disabled}
    aria-label={label} title={label} onClick={controls.toggle}>
    <Mic size={16} aria-hidden="true" />
  </button>
}
