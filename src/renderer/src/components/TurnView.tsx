import { useTranslation } from '../i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Copy, RotateCcw, Rows3 } from 'lucide-react'
import clsx from 'clsx'
import type { AssistantMessage, ToolResultMessage, ToolRun, UserMessage } from '@shared/types'
import { formatCost, formatDuration, formatTokens, timeOfDay } from '../lib/format'
import { summariseTools, type Turn } from '../lib/turns'
import type { FoldLevel } from '../lib/turn-fold'
import { AnswerOnly, AssistantMessageView, CustomMessageView, UserMessageView } from './Message'
import { ToolCard } from './ToolCard'
import { contentText } from '../lib/tools'
import { collectSessionChanges } from '../lib/session-changes'
import { requestReview } from '../lib/review-focus'
import { useApp } from '../store'

function turnMarkdown(turn: Turn): string {
  const lines: string[] = []
  if (turn.userText) lines.push(`### 你\n\n${turn.userText}`)
  const tools = summariseTools(turn.stats.tools)
  if (tools || turn.stats.files.length) {
    lines.push(
      `> 过程：${[turn.stats.steps ? `${turn.stats.steps} 步` : '', tools]
        .filter(Boolean)
        .join(' · ')}${turn.stats.files.length ? ` · ${turn.stats.files.length} 个文件` : ''}`
    )
  }
  if (turn.finalText) lines.push(`### pi\n\n${turn.finalText}`)
  return lines.join('\n\n')
}

/** One-line process summary shared by the folded turn and the history group. */
export function TurnSummary({
  turn,
  level,
  onLevel,
  onOpenTranscript,
  onRetry,
  busy
}: {
  turn: Turn
  level: FoldLevel
  onLevel: (level: FoldLevel) => void
  onOpenTranscript: () => void
  onRetry?: () => void
  busy?: boolean
}): ReactNode {
  const t = useTranslation()
  const [, setTick] = useState(0)
  const [copied, setCopied] = useState(false)

  // Live turns keep a running clock in the summary.
  useEffect(() => {
    if (!turn.streaming) return
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [turn.streaming])

  const { stats } = turn
  const elapsed = stats.startedAt && (turn.streaming || stats.endedAt)
    ? formatDuration(Math.max(0, (turn.streaming ? Date.now() : stats.endedAt!) - stats.startedAt))
    : ''
  const tools = summariseTools(stats.tools)
  const parts: string[] = [turn.streaming ? t('执行中') : turn.failed ? t('过程有错误') : t('已完成')]
  if (stats.steps) parts.push(t('{count} steps').replace('{count}', String(stats.steps)))
  if (tools) parts.push(tools)
  if (stats.files.length) parts.push(t('{count} files').replace('{count}', String(stats.files.length)))
  if (elapsed) parts.push(turn.streaming ? `${t('running')} ${elapsed}` : elapsed)
  if (stats.tokens) parts.push(`${formatTokens(stats.tokens)} tokens`)
  if (stats.cost) parts.push(formatCost(stats.cost))

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(turnMarkdown(turn))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div className={clsx('turn-summary', turn.failed && 'has-error', turn.streaming && 'is-live')}>
      <button
        className="turn-summary-main"
        onClick={() => onLevel(level === 0 ? 1 : 0)}
        title={t('展开/收起过程')}
        aria-expanded={level === 0}
      >
        {level === 0 ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="turn-summary-text">{parts.join(' · ')}</span>
        {stats.errors > 0 && (
          <span className="turn-summary-error">
            <AlertTriangle size={11} /> {stats.errors}
          </span>
        )}
      </button>

      <div className="turn-summary-actions">
        {!turn.streaming && level !== 0 && (
          <button className="turn-action" onClick={onOpenTranscript} title={t('完整记录')}>
            <Rows3 size={12} />
          </button>
        )}
        {!turn.streaming && level === 1 && (
          <button
            className="turn-action"
            onClick={() => onLevel(2)}
            title={t('只看摘要')}
          >
            <ChevronRight size={12} />
          </button>
        )}
        {!turn.streaming && level === 2 && (
          <button className="turn-action" onClick={() => onLevel(1)} title={t('显示结论')}>
            <ChevronDown size={12} />
          </button>
        )}
        {!turn.streaming && turn.userText && onRetry && (
          <button className="turn-action" onClick={onRetry} disabled={busy} title={t('重新发送这条问题')}>
            <RotateCcw size={12} />
          </button>
        )}
        <button className="turn-action" onClick={() => void copy()} title={t('复制本轮')}>
          <Copy size={12} />
        </button>
        {copied && <span className="turn-copied">{t('已复制')}</span>}
      </div>
    </div>
  )
}

function callIds(turn: Turn): Set<string> {
  const ids = new Set<string>()
  for (const item of turn.items) {
    if (item.role !== 'assistant') continue
    for (const block of (item as AssistantMessage).content ?? []) {
      if (block.type === 'toolCall') ids.add((block as { id: string }).id)
    }
  }
  return ids
}

export function TurnView({
  turn,
  level,
  onLevel,
  onOpenTranscript,
  onRetry,
  toolRuns,
  results,
  busy
}: {
  turn: Turn
  level: FoldLevel
  onLevel: (level: FoldLevel) => void
  onOpenTranscript: () => void
  onRetry?: () => void
  toolRuns: Record<string, ToolRun>
  results: Record<string, ToolResultMessage>
  busy?: boolean
}): ReactNode {
  const { state } = useApp()
  const rendered = callIds(turn)
  const changes = turn.streaming ? [] : collectSessionChanges([turn], toolRuns, state.workspace ?? '')
  const assistantCount = turn.items.filter((item) => item.role === 'assistant').length
  const hasProcess = assistantCount > 1 || turn.stats.thinkingLines > 0 ||
    Object.keys(turn.stats.tools).length > 0 || turn.items.some((item) => item.role === 'custom')
  const model = (() => {
    for (let index = turn.items.length - 1; index >= 0; index -= 1) {
      const item = turn.items[index]
      if (item.role === 'assistant') {
        const assistant = item as AssistantMessage
        return assistant.responseModel ?? assistant.model
      }
    }
    return undefined
  })()

  return (
    <div className={clsx('turn', turn.streaming && 'is-streaming')} data-turn-key={turn.key}>
      {turn.user ? (
        <UserMessageView message={turn.user as UserMessage} />
      ) : null}

      {(hasProcess || level === 2) && (
        <TurnSummary
          turn={turn}
          level={level}
          onLevel={onLevel}
          onOpenTranscript={onOpenTranscript}
          onRetry={onRetry}
          busy={busy}
        />
      )}

      {level === 0 ? (
        turn.items.map((item, index) => {
          if (item.role === 'assistant') {
            return (
              <AssistantMessageView
                key={index}
                message={item as AssistantMessage}
                toolRuns={toolRuns}
                results={results}
                streaming={turn.streaming && index === turn.items.length - 1}
              />
            )
          }
          if (item.role === 'toolResult') {
            const result = item as ToolResultMessage
            if (rendered.has(result.toolCallId)) return null
            return (
              <ToolCard
                key={index}
                call={{
                  type: 'toolCall',
                  id: result.toolCallId,
                  name: result.toolName,
                  arguments: {}
                }}
                result={result}
              />
            )
          }
          if (item.role === 'custom') {
            const custom = item as unknown as {
              content?: unknown
              display?: boolean
              customType?: string
            }
            if (custom.display === false) return null
            return (
              <CustomMessageView
                key={index}
                label={custom.customType ?? 'note'}
                content={contentText(custom.content)}
              />
            )
          }
          return null
        })
      ) : (
        level === 1 && <AnswerOnly text={turn.finalText} model={model} message={turn.finalMessage} />
      )}
      {level !== 2 && changes.length > 0 && (
        <section className="turn-changes" aria-label={state.settings.language === 'en' ? 'Files changed in this turn' : '本轮文件变更'}>
          <div className="turn-changes-title">{state.settings.language === 'en' ? 'Files changed' : '本轮文件变更'} · {changes.length}</div>
          {changes.slice(0, 5).map((file) => (
            <button key={file.path} className="turn-changes-row" onClick={() => requestReview(state.sessionPath, state.workspace, file.path)} title={file.relative}>
              <span>{file.relative}</span><span className="turn-changes-count">{file.unmeasuredWrite ? (state.settings.language === 'en' ? 'Counts unknown' : '行数未知') : <><span>+{file.additions}</span> <span>−{file.deletions}</span></>}</span>
            </button>
          ))}
          {changes.length > 5 && (
            <button className="turn-changes-row" onClick={() => requestReview(state.sessionPath, state.workspace, changes[0].path)}>
              {state.settings.language === 'en' ? `View all ${changes.length} files` : `查看全部 ${changes.length} 个文件`}
            </button>
          )}
        </section>
      )}
    </div>
  )
}

/** Aggregated row for turns that scrolled past the "recent" window. */
export function OlderTurnsRow({
  count,
  first,
  onExpand,
  onOpenTranscript
}: {
  count: number
  first?: Turn
  onExpand: () => void
  onOpenTranscript: () => void
}): ReactNode {
  const t = useTranslation()
  return (
    <div className="older-turns">
      <span className="older-turns-text">
        {t('更早的 {count} 轮').replace('{count}', String(count))}
        {first?.stats.startedAt ? ` · ${timeOfDay(first.stats.startedAt)}` : ''}
      </span>
      <button className="older-turns-action" onClick={onExpand}>
        {t('展开')}
      </button>
      <button className="older-turns-action" onClick={onOpenTranscript}>
        {t('完整记录')}
      </button>
    </div>
  )
}
