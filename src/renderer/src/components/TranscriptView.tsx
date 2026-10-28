import { useTranslation } from '../i18n'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'
import clsx from 'clsx'
import type { AgentMessage, AssistantMessage, ToolResultMessage, ToolRun } from '@shared/types'
import { AssistantMessageView, CustomMessageView, UserMessageView } from './Message'
import { ToolCard } from './ToolCard'
import { contentText } from '../lib/tools'

function searchableText(message: AgentMessage): string {
  if (message.role === 'user') {
    const content = (message as { content?: unknown }).content
    return typeof content === 'string' ? content : contentText(content)
  }
  if (message.role === 'assistant') {
    return (message as AssistantMessage).content
      .map((block) => {
        if (block.type === 'text') return block.text
        if (block.type === 'thinking') return block.thinking
        if (block.type === 'toolCall') return `${block.name} ${JSON.stringify(block.arguments)}`
        return ''
      })
      .join('\n')
  }
  if (message.role === 'toolResult') {
    return contentText((message as ToolResultMessage).content)
  }
  return ''
}

/**
 * Full transcript, nothing folded — the `ctrl+o` / transcript-overlay pattern
 * from Claude Code and Codex. Search jumps between matching messages.
 */
export function TranscriptView({
  open,
  onClose,
  messages,
  toolRuns,
  results
}: {
  open: boolean
  onClose: () => void
  messages: AgentMessage[]
  toolRuns: Record<string, ToolRun>
  results: Record<string, ToolResultMessage>
}): ReactNode {
  const t = useTranslation()
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const renderedCalls = useMemo(() => {
    const ids = new Set<string>()
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      for (const block of (message as AssistantMessage).content ?? []) {
        if (block.type === 'toolCall') ids.add(block.id)
      }
    }
    return ids
  }, [messages])

  const matches = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return []
    const hits: number[] = []
    messages.forEach((message, index) => {
      if (searchableText(message).toLowerCase().includes(text)) hits.push(index)
    })
    return hits
  }, [messages, query])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    setCurrent(0)
  }, [query])

  const jumpTo = (position: number): void => {
    if (!matches.length) return
    const next = (position + matches.length) % matches.length
    setCurrent(next)
    const node = listRef.current?.querySelector<HTMLElement>(`[data-message-index="${matches[next]}"]`)
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="transcript-overlay" onMouseDown={onClose}>
      <section
        className="transcript"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={t('完整记录')}
      >
        <header className="transcript-head">
          <h2>{t('完整记录')}</h2>
          <div className="transcript-search">
            <Search size={13} />
            <input
              ref={inputRef}
              value={query}
              placeholder={t('搜索这段对话…')}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  jumpTo(event.shiftKey ? current - 1 : current + 1)
                }
              }}
            />
            {query && (
              <span className="transcript-count">
                {matches.length ? `${Math.min(current + 1, matches.length)}/${matches.length}` : '0/0'}
              </span>
            )}
            <button
              className="transcript-nav"
              onClick={() => jumpTo(current - 1)}
              disabled={!matches.length}
              aria-label={t('上一处')}
            >
              <ArrowUp size={13} />
            </button>
            <button
              className="transcript-nav"
              onClick={() => jumpTo(current + 1)}
              disabled={!matches.length}
              aria-label={t('下一处')}
            >
              <ArrowDown size={13} />
            </button>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('关闭')}>
            <X size={16} />
          </button>
        </header>

        <div className="transcript-body" ref={listRef}>
          {messages.map((message, index) => {
            const hit = matches.includes(index)
            const isCurrent = matches[current] === index
            const className = clsx('transcript-item', hit && 'is-hit', isCurrent && 'is-current')
            if (message.role === 'user') {
              return (
                <div className={className} key={index} data-message-index={index}>
                  <UserMessageView message={message} />
                </div>
              )
            }
            if (message.role === 'assistant') {
              const previous = messages[index - 1]
              const sameModel =
                previous?.role === 'assistant' &&
                ((previous as AssistantMessage).responseModel ?? (previous as AssistantMessage).model) ===
                  ((message as AssistantMessage).responseModel ?? (message as AssistantMessage).model)
              return (
                <div className={className} key={index} data-message-index={index}>
                  <AssistantMessageView
                    message={message as AssistantMessage}
                    toolRuns={toolRuns}
                    results={results}
                    streaming={false}
                    hideHeader={sameModel}
                  />
                </div>
              )
            }
            if (message.role === 'toolResult') {
              const result = message as ToolResultMessage
              if (renderedCalls.has(result.toolCallId)) return null
              return (
                <div className={className} key={index} data-message-index={index}>
                  <ToolCard
                    call={{
                      type: 'toolCall',
                      id: result.toolCallId,
                      name: result.toolName,
                      arguments: {}
                    }}
                    result={result}
                    defaultOpen={false}
                  />
                </div>
              )
            }
            if (message.role === 'custom') {
              const custom = message as unknown as {
                content?: unknown
                display?: boolean
                customType?: string
              }
              if (custom.display === false) return null
              return (
                <div className={className} key={index} data-message-index={index}>
                  <CustomMessageView
                    label={custom.customType ?? 'note'}
                    content={contentText(custom.content)}
                  />
                </div>
              )
            }
            return null
          })}
          {messages.length === 0 && <div className="transcript-empty">{t('还没有内容。')}</div>}
        </div>
      </section>
    </div>
  )
}
