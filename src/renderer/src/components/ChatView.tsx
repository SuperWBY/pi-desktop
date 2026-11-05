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
import { TurnPreview } from './TurnPreview'
import { buildTurns, type Turn } from '../lib/turns'
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
  const [showStarting, setShowStarting] = useState(false)
  const followRef = useRef(state.settings.followStream !== false)
  followRef.current = state.settings.followStream !== false
  const streamingRef = useRef(state.streaming)
  streamingRef.current = state.streaming

  // Quick session switches should not flash a loading state. Only show it
  // once a switch has actually been slow enough to notice.
  useEffect(() => {
    if (state.status !== 'starting') {
      setShowStarting(false)
      return
    }
    const timer = window.setTimeout(() => setShowStarting(true), 180)
    return () => window.clearTimeout(timer)
  }, [state.status])

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
  }, [state.messages.length > 0, state.status])

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const node = scrollerRef.current
    if (!node || event.deltaY >= 0 || node.scrollTop <= 0) return
    // A nested code block or tool result may consume the wheel itself.
    let target = event.target as HTMLElement | null
    while (target && target !== node) {
      const overflow = getComputedStyle(target).overflowY
      if ((overflow === 'auto' || overflow === 'scroll') && target.scrollTop > 0) return
      target = target.parentElement
    }
    if (programmatic.current) {
      node.scrollTo({ top: node.scrollTop, behavior: 'instant' })
      programmatic.current = false
    }
    stickRef.current = false
  }

  const onScroll = (): void => {
    if (programmatic.current) return
    const node = scrollerRef.current
    if (!node) return
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    stickRef.current = distance < 80
    setShowJump(distance >= 80 && state.messages.length > 0)
    setRailPreview(null)
  }

  const streamingIndex = state.streaming ? lastAssistantIndex : -1
  const turns = useMemo(
    () => buildTurns(state.messages, state.toolRuns, results, streamingIndex),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.messages, state.toolRuns, results, streamingIndex]
  )

  const folds = useTurnFolds(state.sessionPath, turns, {
    autoFold: state.settings.turnAutoFold === true,
    aggregateAfter: state.settings.turnAggregate ?? 0,
    defaultLevel: state.settings.turnAutoFold === true ? 1 : 0
  })

  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [olderOpen, setOlderOpen] = useState(false)
  const [activeTurn, setActiveTurn] = useState<string | null>(null)
  const [railPreview, setRailPreview] = useState<{
    turn: Turn
    index: number
    left: number
    top: number
  } | null>(null)
  const tickRefs = useRef<HTMLButtonElement[]>([])
  const railFrame = useRef<number | null>(null)
  const railClose = useRef<number | null>(null)
  const railHoverIndex = useRef(-1)
  const railInside = useRef(false)

  const cancelRailClose = useCallback(() => {
    if (railClose.current) {
      window.clearTimeout(railClose.current)
      railClose.current = null
    }
  }, [])

  const scheduleRailClose = useCallback(() => {
    cancelRailClose()
    railClose.current = window.setTimeout(() => setRailPreview(null), 180)
  }, [cancelRailClose])

  const jumpToTurn = useCallback((key: string) => {
    const node = scrollerRef.current?.querySelector<HTMLElement>(`[data-turn-key="${key}"]`)
    node?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setActiveTurn(key)
    setRailPreview(null)
  }, [])

  /** The rail's "slope": ticks grow by proximity to the pointer. Returns the nearest index. */
  const applyRailSlope = useCallback((clientY: number): number => {
    const ticks = tickRefs.current
    if (!ticks.length) return -1
    // Read geometry first, then write styles: a write between reads would force
    // a layout for every tick.
    const centers = ticks.map((tick) => {
      if (!tick) return Number.NaN
      const rect = tick.getBoundingClientRect()
      return rect.top + rect.height / 2
    })
    let nearest = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < ticks.length; index += 1) {
      const center = centers[index]
      if (!Number.isFinite(center)) continue
      const distance = Math.abs(clientY - center)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = index
      }
    }
    const hoverRadius = 26
    for (let index = 0; index < ticks.length; index += 1) {
      const tick = ticks[index]
      const center = centers[index]
      if (!tick || !Number.isFinite(center)) continue
      const raw = Math.max(0, 1 - Math.abs(clientY - center) / hoverRadius)
      const falloff = raw * raw * (3 - 2 * raw)
      tick.style.setProperty('--tick-hover', falloff.toFixed(3))
    }
    return nearest
  }, [])

  const onRailMove = (event: React.PointerEvent<HTMLElement>): void => {
    const y = event.clientY
    if (railFrame.current) return
    railFrame.current = window.requestAnimationFrame(() => {
      railFrame.current = null
      if (!railInside.current) return
      const nearest = applyRailSlope(y)
      if (nearest >= 0 && nearest !== railHoverIndex.current) {
        railHoverIndex.current = nearest
        const turn = visibleTurns[nearest]
        const tick = tickRefs.current[nearest]
        if (turn && tick) openRailPreview(turn, turn.index + 1, tick)
      }
    })
  }

  const openRailPreview = useCallback(
    (turn: Turn, index: number, element: HTMLElement) => {
      cancelRailClose()
      const rect = element.getBoundingClientRect()
      const width = 380
      const half = Math.min(260, window.innerHeight / 2 - 12)
      const left = Math.min(rect.right + 10, window.innerWidth - width - 12)
      const top = Math.min(
        Math.max(rect.top + rect.height / 2, half + 12),
        window.innerHeight - half - 12
      )
      setRailPreview({ turn, index, left, top })
    },
    [cancelRailClose]
  )

  const onRailEnter = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      railInside.current = true
      onRailMove(event)
    },
    [onRailMove]
  )

  const onRailLeave = useCallback(() => {
    railInside.current = false
    railHoverIndex.current = -1
    if (railFrame.current) {
      window.cancelAnimationFrame(railFrame.current)
      railFrame.current = null
    }
    for (const tick of tickRefs.current) tick?.style.setProperty('--tick-hover', '0')
    scheduleRailClose()
  }, [scheduleRailClose])

  useEffect(() => {
    if (!railPreview) return
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setRailPreview(null)
        event.stopPropagation()
      }
    }
    document.addEventListener('keydown', onEscape, true)
    return () => document.removeEventListener('keydown', onEscape, true)
  }, [railPreview])

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
    if (!showStarting) {
      return (
        <div className="chat-scroll" ref={scrollerRef} aria-live="polite" aria-relevant="additions text">
          <div className="chat-inner" />
        </div>
      )
    }
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
          <h1 className="empty-title">
            {state.settings.language === 'en'
              ? `What would you like to do in ${state.scratchWorkspace ? t('临时对话') : baseName(state.workspace)}?`
              : `在 ${state.scratchWorkspace ? t('临时对话') : baseName(state.workspace)} 里做点什么？`}
          </h1>
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
    <div className="chat-wrap">
      {showStarting && <div className="top-progress" />}
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
        <nav
          className="turn-rail"
          aria-label={t('轮次导航')}
          onPointerEnter={onRailEnter}
          onPointerMove={onRailMove}
          onPointerLeave={onRailLeave}
        >
          {visibleTurns.map((turn, index) => {
            return (
              <button
                key={turn.key}
                ref={(element) => {
                  if (element) tickRefs.current[index] = element
                  else delete tickRefs.current[index]
                }}
                className={clsx(
                  'turn-rail-tick',
                  turn.failed && 'has-error',
                  turn.streaming && 'is-live',
                  activeTurn === turn.key && 'is-active'
                )}
                aria-label={`${t('第 {count} 轮').replace('{count}', String(index + 1))}: ${(turn.userText || t('无提问')).slice(0, 60)}`}
                aria-describedby={railPreview?.turn.key === turn.key ? 'turn-preview' : undefined}
                onPointerEnter={(event) =>
                  openRailPreview(turn, turn.index + 1, event.currentTarget)
                }
                onPointerLeave={scheduleRailClose}
                onFocus={(event) => openRailPreview(turn, turn.index + 1, event.currentTarget)}
                onBlur={scheduleRailClose}
                onClick={() => jumpToTurn(turn.key)}
              />
            )
          })}
        </nav>
      )}

      {railPreview && (
        <TurnPreview
          turn={railPreview.turn}
          index={railPreview.index}
          left={railPreview.left}
          top={railPreview.top}
          onKeep={cancelRailClose}
          onLeave={scheduleRailClose}
          onJump={() => jumpToTurn(railPreview.turn.key)}
        />
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
