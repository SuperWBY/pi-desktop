import { useTranslation } from '../i18n'
import { useApp } from '../store'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Pencil } from 'lucide-react'
import clsx from 'clsx'
import type {
  AssistantMessage,
  ContentBlock,
  ToolCallBlock,
  ToolResultMessage,
  ToolRun,
  UserMessage
} from '@shared/types'
import { formatElapsedSeconds, timeOfDay } from '../lib/format'
import { useElapsed } from '../lib/use-elapsed'
import { Markdown } from './Markdown'
import { InlineImage } from './ImageLightbox'
import { ToolCard } from './ToolCard'
import { ToolSequence } from './ToolGroup'
import { toolGroupKey } from '../lib/process-steps'

/**
 * Streaming text arrives much faster than needed for a readable typewriter
 * effect; cap markdown re-parsing so long responses stay smooth.
 */
function useSmoothText(text: string, streaming: boolean, interval = 55): string {
  const [shown, setShown] = useState(text)
  const last = useRef(0)

  useEffect(() => {
    if (!streaming) {
      setShown(text)
      return
    }
    const now = performance.now()
    const elapsed = now - last.current
    if (elapsed >= interval) {
      last.current = now
      setShown(text)
      return
    }
    const timer = window.setTimeout(() => {
      last.current = performance.now()
      setShown(text)
    }, interval - elapsed)
    return () => window.clearTimeout(timer)
  }, [text, streaming, interval])

  return streaming ? shown : text
}

const TextBlockView = memo(function TextBlockView({
  text,
  streaming,
  deferLocalImages
}: {
  text: string
  streaming: boolean
  deferLocalImages?: boolean
}): ReactNode {
  const shown = useSmoothText(text, streaming)
  if (!shown.trim()) return null
  return <Markdown streaming={streaming} deferLocalImages={deferLocalImages}>{shown}</Markdown>
})

function ThinkingBlock({
  text,
  streaming,
  defaultOpen,
  startedAt,
  endedAt,
  durationMs
}: {
  text: string
  streaming: boolean
  defaultOpen: boolean
  startedAt?: number
  endedAt?: number
  durationMs?: number
}): ReactNode {
  const t = useTranslation()
  const { state } = useApp()
  const mode = state.settings.thinkingDisplay ?? 'summary'
  const [open, setOpen] = useState(mode === 'full' || defaultOpen)
  const manual = useRef(false)
  const elapsed = useElapsed(startedAt, streaming, 1000)

  useEffect(() => {
    if (mode === 'full') setOpen(true)
    else if (!manual.current) setOpen(false)
  }, [mode])

  if (!text.trim() || mode === 'off') return null

  const thoughtMs = startedAt !== undefined && endedAt !== undefined ? endedAt - startedAt : durationMs
  const label = streaming
    ? elapsed !== undefined
      ? `${t('思考中')} ${formatElapsedSeconds(elapsed)}`
      : t('思考中')
    : thoughtMs === undefined
      ? t('思考过程')
      : thoughtMs < 1000
        ? t('思考了片刻')
        : `${t('思考了')} ${formatElapsedSeconds(thoughtMs)}`

  return (
    <div className={clsx('thinking', open && 'open')}>
      <button
        className="thinking-head"
        onClick={() => {
          manual.current = true
          setOpen((value) => !value)
        }}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{label}</span>
      </button>
      {open && <div className="thinking-body fade-in">{text}</div>}
    </div>
  )
}

function MessageActions({
  text,
  time,
  align,
  editable = false
}: {
  text: string
  time?: string
  align: 'start' | 'end'
  editable?: boolean
}): ReactNode {
  const t = useTranslation()
  const { actions } = useApp()
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div className={clsx('message-action-row', align === 'end' && 'is-end')}>
      {time ? <time>{time}</time> : null}
      <button type="button" className="message-action" aria-label={t('复制消息')} title={t('复制消息')} onClick={() => void copy()}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {editable ? (
        <button type="button" className="message-action" aria-label={t('编辑')} title={t('编辑')} onClick={() => actions.fillComposer(text)}>
          <Pencil size={14} />
        </button>
      ) : null}
      {copied ? <span className="message-copied" role="status">{t('已复制')}</span> : null}
    </div>
  )
}

export const UserMessageView = memo(function UserMessageView({
  message,
  optimistic
}: {
  message: UserMessage
  optimistic?: boolean
}): ReactNode {
  const t = useTranslation()
  const content = message.content
  const blocks: ContentBlock[] =
    typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? [])
  const text = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  const images = blocks.filter(
    (block): block is Extract<ContentBlock, { type: 'image' }> => block.type === 'image'
  )

  return (
    <div className={clsx('message user-message', optimistic && 'optimistic')}>
      <div className="user-card">
        {images.length > 0 && (
          <div className="user-images">
            {images.map((image, index) => (
              <img
                key={index}
                src={`data:${image.mimeType};base64,${image.data}`}
                alt="attachment"
              />
            ))}
          </div>
        )}
        {text && <div className="user-text">{text}</div>}
      </div>
      {text ? <MessageActions text={text} time={optimistic ? t('sending…') : timeOfDay(message.timestamp)} align="end" editable /> : null}
    </div>
  )
})

interface AssistantProps {
  message: AssistantMessage
  toolRuns: Record<string, ToolRun>
  results: Record<string, ToolResultMessage>
  streaming: boolean
  deferLocalImages?: boolean
  /** Hide the model/time header (consecutive assistant blocks in the transcript). */
  hideHeader?: boolean
  /** Usage belongs to the turn, not to every tool-only step. */
  isLast?: boolean
}

function AssistantMessageViewImpl({
  message,
  toolRuns,
  results,
  streaming,
  deferLocalImages
}: AssistantProps): ReactNode {
  const blocks = message.content ?? []
  const text = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
  const hasProse = text.trim().length > 0
  const hasImages = blocks.some((block: ContentBlock) => block.type === 'image')

  type Segment =
    | { kind: 'block'; block: ContentBlock; index: number }
    | { kind: 'group'; calls: ToolCallBlock[] }

  const segments: Segment[] = []
  let pending: { key: string; calls: ToolCallBlock[] } | null = null

  const flush = (): void => {
    if (!pending) return
    segments.push({ kind: 'group', calls: pending.calls })
    pending = null
  }

  blocks.forEach((block, index) => {
    if (block.type === 'toolCall') {
      const call = block as ToolCallBlock
      const key = toolGroupKey(call.name)
      if (!key) {
        flush()
        segments.push({ kind: 'block', block, index })
        return
      }
      if (pending?.key === key) {
        pending.calls.push(call)
        return
      }
      flush()
      pending = { key, calls: [call] }
      return
    }
    flush()
    segments.push({ kind: 'block', block, index })
  })
  flush()

  return (
    <div className={clsx('message assistant-message', streaming && 'is-streaming', !hasProse && !hasImages && 'is-tool-only')}>
      <div className="assistant-body">
        {segments.map((segment) => {
          if (segment.kind === 'group') {
            return (
              <ToolSequence
                key={`group-${segment.calls[0].id}`}
                calls={segment.calls}
                toolRuns={toolRuns}
                results={results}
              />
            )
          }
          const block = segment.block
          const index = segment.index
          if (block.type === 'text') {
            return <TextBlockView key={index} text={block.text} streaming={streaming} deferLocalImages={deferLocalImages} />
          }
          if (block.type === 'thinking') {
            return (
              <ThinkingBlock
                key={index}
                text={block.thinking}
                streaming={streaming && block.desktopEndedAt === undefined && index === message.content.length - 1}
                defaultOpen={false}
                startedAt={block.desktopStartedAt}
                endedAt={block.desktopEndedAt}
                durationMs={message.durationMs}
              />
            )
          }
          if (block.type === 'toolCall') {
            const call = block as ToolCallBlock
            return <ToolCard key={index} call={call} run={toolRuns[call.id]} result={results[call.id]} />
          }
          if (block.type === 'image') {
            return (
              <InlineImage key={index} src={`data:${block.mimeType};base64,${block.data}`} alt="" />
            )
          }
          return null
        })}

        {message.errorMessage && (
          <div className="message-error">
            <AlertTriangle size={14} />
            <span>{message.errorMessage}</span>
          </div>
        )}

      </div>
      {hasProse && !streaming ? <MessageActions text={text} time={timeOfDay(message.timestamp)} align="start" /> : null}
    </div>
  )
}

export const AssistantMessageView = memo(function AssistantMessageView(props: AssistantProps) {
  return <AssistantMessageViewImpl {...props} />
}, areMessagePropsEqual)

function areMessagePropsEqual(prev: AssistantProps, next: AssistantProps): boolean {
  if (prev.message !== next.message || prev.streaming !== next.streaming || prev.deferLocalImages !== next.deferLocalImages) return false
  const blocks = next.message.content ?? []
  for (const block of blocks) {
    if (block.type === 'toolCall') {
      if (prev.toolRuns[block.id] !== next.toolRuns[block.id]) return false
      if (prev.results[block.id] !== next.results[block.id]) return false
    }
  }
  return true
}

/** The visible answer of a folded turn, including images and failures. */
export const AnswerOnly = memo(function AnswerOnly({
  text,
  message,
  streaming = false,
  deferLocalImages
}: {
  text: string
  model?: string
  message?: AssistantMessage
  streaming?: boolean
  deferLocalImages?: boolean
}): ReactNode {
  const images = (message?.content ?? []).filter(
    (block): block is Extract<ContentBlock, { type: 'image' }> => block.type === 'image'
  )
  if (!text.trim() && !images.length && !message?.errorMessage) return null
  return (
    <div className="message assistant-message folded-answer">
      <div className="assistant-body">
        {text && <TextBlockView text={text} streaming={streaming} deferLocalImages={deferLocalImages} />}
        {images.map((image, index) => (
          <InlineImage key={index} src={`data:${image.mimeType};base64,${image.data}`} alt="" />
        ))}
        {message?.errorMessage && (
          <div className="message-error"><AlertTriangle size={14} /><span>{message.errorMessage}</span></div>
        )}
      </div>
      {text.trim() && !streaming ? <MessageActions text={text} time={message ? timeOfDay(message.timestamp) : undefined} align="start" /> : null}
    </div>
  )
})

export const CustomMessageView = memo(function CustomMessageView({
  content,
  label
}: {
  content: string
  label: string
}): ReactNode {
  return (
    <div className="custom-message">
      <span className="custom-label">{label}</span>
      <span className="custom-text">{content}</span>
    </div>
  )
})
