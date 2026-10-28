import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent as ReactWheelEvent
} from 'react'
import { ArrowDown, Hammer, Sparkles, TerminalSquare } from 'lucide-react'
import clsx from 'clsx'
import type {
  AssistantMessage,
  ToolCallBlock,
  ToolResultMessage,
  UserMessage
} from '@shared/types'
import { useApp } from '../store'
import { baseName } from '../lib/format'
import { AssistantMessageView, CustomMessageView, UserMessageView } from './Message'
import { ToolCard } from './ToolCard'
import { Spinner } from './ui'
import { contentText } from '../lib/tools'
import { PiLogo } from './PiLogo'

const SUGGESTIONS = [
  {
    icon: Sparkles,
    title: '讲讲这个代码库',
    prompt: 'Give me a tour of this codebase: what it does, the main modules, and where I should start.'
  },
  {
    icon: Hammer,
    title: '修一个失败的测试',
    prompt: 'Run the test suite, find the first failure, and fix it.'
  },
  {
    icon: TerminalSquare,
    title: '帮我 review 改动',
    prompt: 'Review my uncommitted changes for bugs, risky patterns, and missing tests.'
  }
]

export function ChatView(): ReactNode {
  const { state, actions } = useApp()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const programmatic = useRef(false)
  const [showJump, setShowJump] = useState(false)
  const followRef = useRef(state.settings.followStream !== false)
  followRef.current = state.settings.followStream !== false
  const streamingRef = useRef(state.streaming)
  streamingRef.current = state.streaming

  const results = useMemo(() => {
    const map: Record<string, ToolResultMessage> = {}
    for (const message of state.messages) {
      if (message.role === 'toolResult') {
        const result = message as ToolResultMessage
        map[result.toolCallId] = result
      }
    }
    return map
  }, [state.messages])

  const renderedCalls = useMemo(() => {
    const ids = new Set<string>()
    for (const message of state.messages) {
      if (message.role !== 'assistant') continue
      for (const block of (message as AssistantMessage).content ?? []) {
        if (block.type === 'toolCall') ids.add((block as ToolCallBlock).id)
      }
    }
    return ids
  }, [state.messages])

  const lastAssistantIndex = useMemo(() => {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      if (state.messages[index].role === 'assistant') return index
    }
    return -1
  }, [state.messages])

  const scrollToBottom = useCallback((smooth = false): void => {
    const node = scrollerRef.current
    if (!node) return
    programmatic.current = true
    stickRef.current = true
    setShowJump(false)
    if (smooth) {
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
    } else {
      node.scrollTop = node.scrollHeight
    }
    if (smooth) {
      setTimeout(() => {
        programmatic.current = false
      }, 450)
    } else {
      requestAnimationFrame(() => {
        programmatic.current = false
      })
    }
  }, [])

  useLayoutEffect(() => {
    if (stickRef.current && (followRef.current || !state.streaming)) scrollToBottom()
  }, [state.messages, state.streaming, state.toolRuns, scrollToBottom])

  useEffect(() => {
    const last = state.messages[state.messages.length - 1]
    if (last?.role === 'user') scrollToBottom()
  }, [state.messages.length, scrollToBottom])

  useEffect(() => {
    stickRef.current = true
    setShowJump(false)
    requestAnimationFrame(() => scrollToBottom())
  }, [state.sessionPath, scrollToBottom])

  // Keep the view pinned while content grows (markdown reflow, fonts, code blocks).
  useEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    const observer = new ResizeObserver(() => {
      if (!stickRef.current) return
      if (!followRef.current && streamingRef.current) return
      const scroller = scrollerRef.current
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (event.deltaY < 0 && state.messages.length > 0) {
      stickRef.current = false
      setShowJump(true)
    }
  }

  const onScroll = (): void => {
    if (programmatic.current) return
    const node = scrollerRef.current
    if (!node) return
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    stickRef.current = distance < 80
    setShowJump(distance >= 80 && state.messages.length > 0)
  }

  const streamingMessage =
    lastAssistantIndex >= 0 ? (state.messages[lastAssistantIndex] as AssistantMessage) : null
  const thinkingLive = Boolean(
    state.streaming &&
      streamingMessage?.content?.some(
        (block) => block.type === 'thinking' && block.thinking.trim().length > 0
      )
  )
  const runningTool = Object.values(state.toolRuns).find((run) => run.status === 'running')
  const activity = state.retry
    ? `Retrying ${state.retry.attempt}/${state.retry.maxAttempts}${state.retry.errorMessage ? ` — ${state.retry.errorMessage}` : ''}`
    : state.compacting
      ? 'Compacting context…'
      : runningTool
        ? `${runningTool.name}…`
        : '运行中…'

  if (state.status === 'starting' && state.messages.length === 0) {
    return (
      <div className="chat-scroll" aria-live="polite" aria-relevant="additions text">
        <div className="chat-inner">
          <div className="chat-starting">
            <Spinner size={16} />
            <span>正在 {baseName(state.workspace)} 里启动 pi…</span>
          </div>
        </div>
      </div>
    )
  }

  if (state.messages.length === 0) {
    return (
      <div className="chat-scroll" aria-live="polite" aria-relevant="additions text">
        <div className="chat-inner empty-session">
          <div className="empty-mark">
            <PiLogo size={32} />
          </div>
          <h1>在 {baseName(state.workspace)} 里做点什么？</h1>
          <p>
            pi 能读写文件、跑命令、搜网页。发出第一条消息后，这个会话就会被保存下来。
          </p>
          <div className="suggestions">
            {SUGGESTIONS.map((suggestion) => {
              const Icon = suggestion.icon
              return (
                <button
                  key={suggestion.title}
                  className="suggestion"
                  onClick={() => actions.fillComposer(suggestion.prompt)}
                >
                  <Icon size={15} />
                  <span>{suggestion.title}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('chat-wrap', state.status === 'starting' && 'is-switching')}>
      {state.status === 'starting' && <div className="top-progress" />}
      <div className="chat-scroll" aria-live="polite" aria-relevant="additions text" ref={scrollerRef} onScroll={onScroll} onWheel={onWheel}>
        <div className="chat-inner" ref={innerRef}>
          {state.messages.map((message, index) => {
            const key = `${message.role}-${(message as { timestamp?: number }).timestamp ?? index}-${index}`

            if (message.role === 'user') {
              return (
                <UserMessageView
                  key={key}
                  message={message as UserMessage}
                  optimistic={Boolean((message as { __optimistic?: boolean }).__optimistic)}
                />
              )
            }

            if (message.role === 'assistant') {
              return (
                <AssistantMessageView
                  key={key}
                  message={message as AssistantMessage}
                  toolRuns={state.toolRuns}
                  results={results}
                  streaming={state.streaming && index === lastAssistantIndex}
                />
              )
            }

            if (message.role === 'toolResult') {
              const result = message as ToolResultMessage
              if (renderedCalls.has(result.toolCallId)) return null
              return (
                <ToolCard
                  key={key}
                  call={{
                    type: 'toolCall',
                    id: result.toolCallId,
                    name: result.toolName,
                    arguments: {}
                  }}
                  result={result}
                  defaultOpen={state.settings.toolCardsExpanded}
                />
              )
            }

            if (message.role === 'custom') {
              const custom = message as unknown as { content?: unknown; display?: boolean; customType?: string }
              if (custom.display === false) return null
              return (
                <CustomMessageView
                  key={key}
                  label={custom.customType ?? 'note'}
                  content={contentText(custom.content)}
                />
              )
            }

            return null
          })}

          {state.streaming && !thinkingLive && (
            <div className="activity">
              <Spinner size={14} />
              <span>{activity}</span>
            </div>
          )}

          {state.statusText && !state.streaming && (
            <div className="status-text">{state.statusText}</div>
          )}
          <div className="chat-spacer" />
        </div>
      </div>

      {showJump && (
        <button className="jump-button" onClick={() => scrollToBottom(true)}>
          <ArrowDown size={14} /> 回到最新
        </button>
      )}
    </div>
  )
}
