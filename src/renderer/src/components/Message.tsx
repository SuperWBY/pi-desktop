import { useTranslation } from '../i18n'
import { useApp } from '../store'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Brain } from 'lucide-react'
import clsx from 'clsx'
import type {
  AssistantMessage,
  ContentBlock,
  ToolCallBlock,
  ToolResultMessage,
  ToolRun,
  UserMessage
} from '@shared/types'
import { formatCost, formatTokens, timeOfDay } from '../lib/format'
import { Markdown, CopyButton } from './Markdown'
import { ToolCard } from './ToolCard'
import { ToolGroup } from './ToolGroup'

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
  streaming
}: {
  text: string
  streaming: boolean
}): ReactNode {
  const shown = useSmoothText(text, streaming)
  if (!shown.trim()) return null
  return <Markdown>{shown}</Markdown>
})

function ThinkingBlock({
  text,
  streaming,
  defaultOpen
}: {
  text: string
  streaming: boolean
  defaultOpen: boolean
}): ReactNode {
  const t = useTranslation()
  const { state } = useApp()
  const mode = state.settings.thinkingDisplay ?? 'summary'
  const [open, setOpen] = useState(mode === 'full' || defaultOpen || streaming)
  const manual = useRef(false)

  useEffect(() => {
    if (streaming) {
      setOpen(mode !== 'summary')
    } else if (!manual.current) {
      setOpen(mode === 'full')
    }
  }, [streaming, mode])

  if (!text.trim() || mode === 'off') return null

  return (
    <div className={clsx('thinking', open && 'open')}>
      <button
        className="thinking-head"
        onClick={() => {
          manual.current = true
          setOpen((value) => !value)
        }}
      >
        <Brain size={13} />
        <span>{streaming ? t("Thinking…") : t("Thought process")}</span>
        <span className="thinking-lines">{t('{count} lines').replace('{count}', String(text.trim().split('\n').length))}</span>
      </button>
      {open && <div className="thinking-body fade-in">{text}</div>}
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
      <div className="message-label">
        <span>{t("你")}</span>
        <span className="message-time">{optimistic ? t('sending…') : timeOfDay(message.timestamp)}</span>
      </div>
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
        {text && (
          <div className="user-actions">
            <CopyButton text={text} />
          </div>
        )}
      </div>
    </div>
  )
})

interface AssistantProps {
  message: AssistantMessage
  toolRuns: Record<string, ToolRun>
  results: Record<string, ToolResultMessage>
  streaming: boolean
  /** Hide the model/time header (consecutive assistant blocks in the transcript). */
  hideHeader?: boolean
}

function AssistantMessageViewImpl({
  message,
  toolRuns,
  results,
  streaming,
  hideHeader
}: AssistantProps): ReactNode {
  const blocks = message.content ?? []
  const usage = message.usage
  const tokens = (usage?.totalTokens ?? 0) || (usage?.input ?? 0) + (usage?.output ?? 0)
  const cost = usage?.cost?.total ?? 0
  const model = message.responseModel || message.model
  const text = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')

  // 「read × 5」这种连续同类调用合成一组，避免一轮刷出十几张卡。
  type Segment =
    | { kind: 'block'; block: ContentBlock; index: number }
    | { kind: 'group'; calls: ToolCallBlock[] }

  const segments: Segment[] = []
  let pending: { name: string; calls: ToolCallBlock[]; indexes: number[] } | null = null

  const flush = (): void => {
    if (!pending) return
    if (pending.calls.length >= 3) {
      segments.push({ kind: 'group', calls: pending.calls })
    } else {
      pending.calls.forEach((call, offset) => {
        segments.push({ kind: 'block', block: call, index: pending?.indexes[offset] ?? 0 })
      })
    }
    pending = null
  }

  blocks.forEach((block, index) => {
    if (block.type === 'toolCall') {
      const call = block as ToolCallBlock
      // Diffs stay one-per-card; bursts of reads/greps are the noisy ones.
      const groupable = call.name !== 'edit' && call.name !== 'write'
      if (!groupable) {
        flush()
        segments.push({ kind: 'block', block, index })
        return
      }
      if (pending && pending.name === call.name) {
        pending.calls.push(call)
        pending.indexes.push(index)
        return
      }
      flush()
      pending = { name: call.name, calls: [call], indexes: [index] }
      return
    }
    flush()
    segments.push({ kind: 'block', block, index })
  })
  flush()

  return (
    <div className={clsx('message assistant-message', streaming && 'is-streaming')}>
      {!hideHeader && (
        <div className="message-label">
          <span className="assistant-mark">π</span>
          <span>{model ? model.split('/').pop() : 'pi'}</span>
          <span className="message-time">{timeOfDay(message.timestamp)}</span>
          {text && !streaming && (
            <span className="message-actions">
              <CopyButton text={text} />
            </span>
          )}
        </div>
      )}

      <div className="assistant-body">
        {segments.map((segment, segmentIndex) => {
          if (segment.kind === 'group') {
            return (
              <ToolGroup
                key={`group-${segmentIndex}`}
                calls={segment.calls}
                toolRuns={toolRuns}
                results={results}
              />
            )
          }
          const block = segment.block
          const index = segment.index
          if (block.type === 'text') {
            return <TextBlockView key={index} text={block.text} streaming={streaming} />
          }
          if (block.type === 'thinking') {
            return (
              <ThinkingBlock
                key={index}
                text={block.thinking}
                streaming={streaming}
                defaultOpen={false}
              />
            )
          }
          if (block.type === 'toolCall') {
            const call = block as ToolCallBlock
            return <ToolCard key={index} call={call} run={toolRuns[call.id]} result={results[call.id]} />
          }
          if (block.type === 'image') {
            return (
              <img
                key={index}
                className="md-image"
                src={`data:${block.mimeType};base64,${block.data}`}
                alt=""
              />
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

        {!streaming && (tokens > 0 || cost > 0) && (
          <div className="message-meta">
            {tokens > 0 && <span>{formatTokens(tokens)} tokens</span>}
            {cost > 0 && <span>{formatCost(cost)}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

export const AssistantMessageView = memo(function AssistantMessageView(props: AssistantProps) {
  return <AssistantMessageViewImpl {...props} />
}, areMessagePropsEqual)

function areMessagePropsEqual(prev: AssistantProps, next: AssistantProps): boolean {
  if (prev.message !== next.message || prev.streaming !== next.streaming) return false
  const blocks = next.message.content ?? []
  for (const block of blocks) {
    if (block.type === 'toolCall') {
      if (prev.toolRuns[block.id] !== next.toolRuns[block.id]) return false
      if (prev.results[block.id] !== next.results[block.id]) return false
    }
  }
  return true
}

/** The final answer of a folded turn: text only, with a copy button. */
export const AnswerOnly = memo(function AnswerOnly({
  text,
  model
}: {
  text: string
  model?: string
}): ReactNode {
  if (!text.trim()) return null
  return (
    <div className="message assistant-message folded-answer">
      <div className="message-label">
        <span className="assistant-mark">π</span>
        <span>{model ? model.split('/').pop() : 'pi'}</span>
        <span className="message-actions">
          <CopyButton text={text} />
        </span>
      </div>
      <div className="assistant-body">
        <TextBlockView text={text} streaming={false} />
      </div>
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
