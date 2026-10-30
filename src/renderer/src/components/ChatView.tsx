import { useTranslation } from '../i18n'
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
import type { AssistantMessage, ToolResultMessage } from '@shared/types'
import { useApp } from '../store'
import { Spinner } from './ui'
import { baseName } from '../lib/format'
import { PiLogo } from './PiLogo'
import { TurnView, OlderTurnsRow } from './TurnView'
import { TranscriptView } from './TranscriptView'
import { buildTurns } from '../lib/turns'
import { useTurnFolds, type FoldLevel } from '../lib/turn-fold'

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
  const t = useTranslation()
  const { state, actions } = useApp()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const programmatic = useRef(false)
  const readingPositions = useRef(new Map<string, { top: number; following: boolean }>())
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

  useLayoutEffect(() => {
    const node = scrollerRef.current
    if (!node || state.status !== 'ready') return
    const key = state.sessionPath ?? `project:${state.workspace ?? ''}`
    const saved = readingPositions.current.get(key)
    if (saved && !saved.following) {
      stickRef.current = false
      node.scrollTop = saved.top
      setShowJump(node.scrollHeight - node.scrollTop - node.clientHeight >= 80)
    } else {
      stickRef.current = true
      setShowJump(false)
      scrollToBottom()
    }
    return () => {
      readingPositions.current.set(key, { top: node.scrollTop, following: stickRef.current })
    }
  }, [state.sessionPath, state.workspace, state.status, scrollToBottom])

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

  const streamingIndex = state.streaming ? lastAssistantIndex : -1
  const turns = useMemo(
    () => buildTurns(state.messages, state.toolRuns, results, streamingIndex),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.messages, state.toolRuns, results, streamingIndex]
  )

  const folds = useTurnFolds(state.sessionPath, turns, {
    autoFold: state.settings.turnAutoFold !== false,
    aggregateAfter: state.settings.turnAggregate ?? 0,
    defaultLevel: 1
  })

  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [olderOpen, setOlderOpen] = useState(false)
  const [activeTurn, setActiveTurn] = useState<string | null>(null)

  useEffect(() => {
    setOlderOpen(false)
    setTranscriptOpen(false)
  }, [state.sessionPath])

  /** Fold/unfold without letting the transcript jump under the cursor. */
  const changeLevel = useCallback(
    (turnKey: string, level: FoldLevel) => {
      const scroller = scrollerRef.current
      const node = scroller?.querySelector<HTMLElement>(`[data-turn-key="${turnKey}"]`)
      const before = node?.getBoundingClientRect().top
      folds.setLevel(
        turns.find((turn) => turn.key === turnKey) ?? turns[turns.length - 1],
        level
      )
      if (!node || before === undefined || !scroller) return
      programmatic.current = true
      requestAnimationFrame(() => {
        const after = node.getBoundingClientRect().top
        scroller.scrollTop += after - before
        requestAnimationFrame(() => {
          programmatic.current = false
        })
      })
    },
    [folds, turns]
  )

  const jumpTurn = useCallback(
    (direction: -1 | 1) => {
      const scroller = scrollerRef.current
      if (!scroller) return
      const nodes = Array.from(scroller.querySelectorAll<HTMLElement>('[data-turn-key]'))
      if (!nodes.length) return
      const top = scroller.getBoundingClientRect().top + 80
      const index = nodes.findIndex((node) => node.getBoundingClientRect().bottom > top)
      const current = index === -1 ? nodes.length - 1 : index
      const next = Math.min(nodes.length - 1, Math.max(0, current + direction))
      const node = nodes[next]
      if (!node) return
      programmatic.current = true
      node.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setActiveTurn(node.dataset.turnKey ?? null)
      window.setTimeout(() => {
        programmatic.current = false
      }, 400)
    },
    []
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey
      if (!meta || event.altKey) return
      const key = event.key.toLowerCase()
      const period = event.code === 'Period' || key === '.'
      if (period && !event.shiftKey) {
        event.preventDefault()
        folds.collapseAll()
      } else if (period && event.shiftKey) {
        event.preventDefault()
        folds.expandAll()
      } else if (key === 'o' && event.shiftKey) {
        event.preventDefault()
        setTranscriptOpen((value) => !value)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        jumpTurn(-1)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        jumpTurn(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [folds, jumpTurn])

  const aggregateAfter = state.settings.turnAggregate ?? 0
  const olderTurns =
    olderOpen || aggregateAfter <= 0 || aggregateAfter >= 200 || turns.length <= aggregateAfter
      ? []
      : turns.slice(0, turns.length - aggregateAfter)
  const visibleTurns = olderTurns.length ? turns.slice(turns.length - aggregateAfter) : turns

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
    ? `${t('Retrying {attempt}/{max}').replace('{attempt}', String(state.retry.attempt)).replace('{max}', String(state.retry.maxAttempts))}${state.retry.errorMessage ? ` — ${state.retry.errorMessage}` : ''}`
    : state.compacting
      ? t('Compacting context…')
      : runningTool
        ? `${runningTool.name}…`
        : t('运行中…')

  if (state.status === 'starting' && state.messages.length === 0) {
    return (
      <div className="chat-scroll" ref={scrollerRef} aria-live="polite" aria-relevant="additions text">
        <div className="chat-inner">
          <div className="chat-starting">
            <Spinner size={16} />
            <span>{state.settings.language === 'en' ? `Starting pi in ${baseName(state.workspace)}…` : `正在 ${baseName(state.workspace)} 里启动 pi…`}</span>
          </div>
        </div>
      </div>
    )
  }

  if (state.messages.length === 0) {
    return (
      <div className="chat-scroll" ref={scrollerRef} aria-live="polite" aria-relevant="additions text">
        <div className="chat-inner empty-session">
          <div className="empty-mark">
            <PiLogo size={32} />
          </div>
          <h1>{state.settings.language === 'en' ? `What would you like to do in ${baseName(state.workspace)}?` : `在 ${baseName(state.workspace)} 里做点什么？`}</h1>
          <p>{t("pi 能读写文件、跑命令、搜网页。发出第一条消息后，这个会话就会被保存下来。")}</p>
          <div className="suggestions">
            {SUGGESTIONS.map((suggestion) => {
              const Icon = suggestion.icon
              return (
                <button
                  key={suggestion.title}
                  className="suggestion"
                  onClick={() => actions.fillComposer(t(suggestion.prompt))}
                >
                  <Icon size={15} />
                  <span>{t(suggestion.title)}</span>
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
      <div
        className="chat-scroll"
        aria-live="polite"
        aria-relevant="additions text"
        ref={scrollerRef}
        onScroll={onScroll}
        onWheel={onWheel}
      >
        <div
          className={clsx('chat-inner', turns.length > 40 && 'is-virtual')}
          ref={innerRef}
        >
          {olderTurns.length > 0 && (
            <OlderTurnsRow
              count={olderTurns.length}
              first={olderTurns[0]}
              onExpand={() => setOlderOpen(true)}
              onOpenTranscript={() => setTranscriptOpen(true)}
            />
          )}

          {visibleTurns.map((turn) => (
            <TurnView
              key={turn.key}
              turn={turn}
              level={folds.levelOf(turn)}
              onLevel={(level) => changeLevel(turn.key, level)}
              onOpenTranscript={() => setTranscriptOpen(true)}
              onRetry={
                turn.userText
                  ? () => {
                      void actions.sendMessage(turn.userText, [])
                    }
                  : undefined
              }
              toolRuns={state.toolRuns}
              results={results}
              busy={state.streaming}
            />
          ))}

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

      {turns.length >= 4 && (
        <div className="turn-rail" aria-hidden="true">
          {visibleTurns.map((turn) => (
            <button
              key={turn.key}
              className={clsx(
                'turn-rail-tick',
                turn.failed && 'has-error',
                turn.streaming && 'is-live',
                activeTurn === turn.key && 'is-active'
              )}
              onClick={() => {
                const node = scrollerRef.current?.querySelector<HTMLElement>(
                  `[data-turn-key="${turn.key}"]`
                )
                node?.scrollIntoView({ block: 'start', behavior: 'smooth' })
              }}
              title={turn.userText ? turn.userText.slice(0, 80) : ''}
            />
          ))}
        </div>
      )}

      {showJump && (
        <button className="jump-button" onClick={() => scrollToBottom(true)}>
          <ArrowDown size={14} />
          {t('回到最新')}
        </button>
      )}

      <TranscriptView
        open={transcriptOpen}
        onClose={() => setTranscriptOpen(false)}
        messages={state.messages}
        toolRuns={state.toolRuns}
        results={results}
      />
    </div>
  )
}
