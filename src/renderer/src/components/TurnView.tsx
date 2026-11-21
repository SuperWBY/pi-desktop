import { useTranslation } from '../i18n'
import { useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Copy, FileDiff, RotateCcw, Rows3 } from 'lucide-react'
import clsx from 'clsx'
import type { AssistantMessage, ToolCallBlock, ToolResultMessage, ToolRun, UserMessage } from '@shared/types'
import { formatCost, formatElapsedSeconds, formatTokens, timeOfDay } from '../lib/format'
import { useElapsed } from '../lib/use-elapsed'
import { summariseTools, type Turn } from '../lib/turns'
import type { FoldLevel } from '../lib/turn-fold'
import { AnswerOnly, AssistantMessageView, CustomMessageView, UserMessageView } from './Message'
import { ToolCard } from './ToolCard'
import { ToolSequence } from './ToolGroup'
import { buildProcessSteps } from '../lib/process-steps'
import { browserActionResultUnknown, computerUseOutcome, contentText, toolPhrases } from '../lib/tools'
import { collectSessionChanges, type FileChange } from '../lib/session-changes'
import { requestReview } from '../lib/review-focus'
import { useApp } from '../store'
import { collectTurnMedia } from '../lib/turn-media'
import { TurnMedia } from './TurnMedia'

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
  if (turn.finalText) lines.push(`### Pi\n\n${turn.finalText}`)
  return lines.join('\n\n')
}

function TurnElapsed({ turn }: { turn: Turn }): ReactNode {
  const t = useTranslation()
  const { startedAt, endedAt } = turn.stats
  const elapsed = useElapsed(startedAt, turn.streaming, 1000)
  const ms = turn.streaming ? elapsed : startedAt !== undefined && endedAt !== undefined ? endedAt - startedAt : undefined
  if (ms === undefined) return null
  return (
    <span className="turn-elapsed">
      {t(turn.streaming ? '执行中 {duration}' : '耗时 {duration}').replace('{duration}', formatElapsedSeconds(ms))}
    </span>
  )
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
  const [copied, setCopied] = useState(false)

  const { stats } = turn
  const toolCount = Object.values(stats.tools).reduce((total, count) => total + count, 0)
  const responseInterrupted = !turn.streaming && Boolean(turn.finalMessage?.errorMessage)
  const status = turn.streaming ? t('执行中') : responseInterrupted ? t('响应中断') : turn.failed ? t('过程结束') : '✓'
  const parts = [
    turn.streaming && stats.startedAt !== undefined ? '' : status,
    toolCount ? t('{count} 步').replace('{count}', String(toolCount)) : '',
    stats.files.length ? t('改了 {count} 个文件').replace('{count}', String(stats.files.length)) : ''
  ].filter(Boolean)
  const detail = [
    !turn.streaming && stats.tokens ? `${formatTokens(stats.tokens)} tokens` : '',
    !turn.streaming && stats.cost ? formatCost(stats.cost) : ''
  ].filter(Boolean).join(' · ')

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
    <div className={clsx('turn-summary', responseInterrupted && 'has-error', turn.streaming && 'is-live')}>
      <button
        className="turn-summary-main"
        onClick={() => onLevel(level === 0 ? 1 : 0)}
        title={detail || t('展开/收起过程')}
        aria-expanded={level === 0}
      >
        {level === 0 ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="turn-summary-text">{parts.join(' · ')}</span>
        <TurnElapsed turn={turn} />
        {stats.errors > 0 && (
          <span className="turn-summary-error" title={t('展开过程查看异常详情；异常不代表任务一定失败')}>
            <AlertTriangle size={11} /> {t('{count} 条异常记录').replace('{count}', String(stats.errors))}
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

function ComputerProgress({ turn, toolRuns, results, expanded, toggle, waiting }: {
  turn: Turn
  toolRuns: Record<string, ToolRun>
  results: Record<string, ToolResultMessage>
  expanded: boolean
  toggle: () => void
  waiting: boolean
}): ReactNode {
  const t = useTranslation()
  let page = ''
  let lastRead = ''
  let headline = t('正在处理任务')
  let error = false
  for (const item of turn.items) {
    if (item.role !== 'assistant') continue
    for (const block of (item as AssistantMessage).content ?? []) {
      if (block.type !== 'toolCall') continue
      const call = block as ToolCallBlock
      const run = toolRuns[call.id]
      const result = results[call.id]
      const details = run?.resultDetails ?? result?.details
      const info = details as { url?: string; windowTitle?: string } | undefined
      const done = run?.status === 'done' || !!result
      error = run?.status === 'error' || result?.isError === true
      const browser = call.name.startsWith('computer_use_session_')
      if (call.name === 'computer_use_session_open') page = ''
      if (call.name === 'computer_use_session_observe' || (call.name === 'computer_use_session_read' && info?.url)) {
        const url = info?.url ?? call.arguments?.url
        try { page = new URL(String(url)).hostname } catch { page = '' }
      }
      const target = browser ? page : info?.windowTitle ?? ''
      const phrases = toolPhrases(call.name)
      const outcome = done && !error ? computerUseOutcome(call.name, details) : null
      const unknown = browserActionResultUnknown(call.name, error, run?.resultText ?? contentText(result))
      const label = unknown ? '操作结果未知，请核对' : error ? phrases.failed : outcome || (done ? phrases.done : phrases.running)
      headline = [t(label), target].filter(Boolean).join(' · ')
      if (call.name === 'computer_use_session_read' && done && !error && page) lastRead = page
      if (call.name === 'computer_use_session_close') page = ''
    }
  }
  if (waiting) headline = t('等待你确认')
  const previous = lastRead && !headline.endsWith(' · ' + lastRead) ? t('已读取') + ' ' + lastRead : ''
  return <div className="computer-progress">
    <div className="computer-progress-title" role="status" data-error={error}><span />{headline}</div>
    <TurnElapsed turn={turn} />
    {previous && <div className="computer-progress-previous">{previous}</div>}
    <button className="computer-progress-steps" onClick={toggle} aria-expanded={expanded}>
      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{t(expanded ? '收起步骤' : '查看步骤')}
    </button>
  </div>
}

export function TurnView({
  turn,
  level,
  onLevel,
  onOpenTranscript,
  onRetry,
  toolRuns,
  results,
  busy,
  fresh,
  completed
}: {
  turn: Turn
  level: FoldLevel
  onLevel: (level: FoldLevel) => void
  onOpenTranscript: () => void
  onRetry?: () => void
  toolRuns: Record<string, ToolRun>
  results: Record<string, ToolResultMessage>
  busy?: boolean
  fresh?: boolean
  completed: boolean
}): ReactNode {
  const { state } = useApp()
  const computerLive = turn.streaming && Object.keys(turn.stats.tools).some(name => name.startsWith('computer_use_'))
  const rendered = callIds(turn)
  const steps = buildProcessSteps(turn.items, rendered)
  const changes = turn.streaming ? [] : collectSessionChanges([turn], toolRuns, state.workspace ?? '')
  const media = level === 2 || !completed ? [] : collectTurnMedia(turn.finalText, changes, state.workspace ?? '')
  const deferLocalImages = media.some((item) => item.kind === 'image')
  const assistantCount = turn.items.filter((item) => item.role === 'assistant').length
  const lastAssistantIndex = (() => {
    for (let index = turn.items.length - 1; index >= 0; index -= 1) {
      if (turn.items[index].role === 'assistant') return index
    }
    return -1
  })()
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
    <div className={clsx('turn', turn.streaming && 'is-streaming', fresh && 'is-new')} data-turn-key={turn.key}>
      {turn.user ? (
        <UserMessageView message={turn.user as UserMessage} />
      ) : null}

      {computerLive ? (
        <ComputerProgress turn={turn} toolRuns={toolRuns} results={results} waiting={state.uiRequests.length > 0}
          expanded={level === 0} toggle={() => onLevel(level === 0 ? 1 : 0)} />
      ) : (hasProcess || level === 2) ? (
        <TurnSummary
          turn={turn}
          level={level}
          onLevel={onLevel}
          onOpenTranscript={onOpenTranscript}
          onRetry={onRetry}
          busy={busy}
        />
      ) : <TurnElapsed turn={turn} />}

      {level === 0 && (
        <div className="turn-process-details">
        {steps.map((step) => {
          if (step.kind === 'calls') {
            return <ToolSequence key={`calls-${step.calls[0].id}`} calls={step.calls} toolRuns={toolRuns} results={results} />
          }
          const { item, index } = step
          if (item.role === 'assistant') {
            return (
              <AssistantMessageView
                key={index}
                message={item as AssistantMessage}
                toolRuns={toolRuns}
                results={results}
                streaming={turn.streaming && item === state.messages[state.streamingIndex]}
                deferLocalImages={deferLocalImages && index === lastAssistantIndex}
                isLast={index === lastAssistantIndex && !turn.streaming && !hasProcess}
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
        })}
        </div>
      )}
      {level === 1 && <AnswerOnly text={turn.finalText} model={model} message={turn.finalMessage} streaming={turn.streaming} deferLocalImages={deferLocalImages} />}
      {media.length > 0 && <TurnMedia key={state.sessionPath ?? state.workspace} items={media} workspace={state.workspace ?? ''} sessionPath={state.sessionPath} />}
      {level !== 2 && changes.length > 0 && (
        <TurnChanges key={turn.key} files={changes} onReview={(path) => requestReview(state.sessionPath, state.workspace, turn.key, path)} />
      )}
    </div>
  )
}

function TurnChanges({ files, onReview }: { files: FileChange[]; onReview: (path?: string) => void }): ReactNode {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const additions = files.reduce((total, file) => total + file.additions, 0)
  const deletions = files.reduce((total, file) => total + file.deletions, 0)
  const unknown = files.some((file) => file.unmeasuredWrite)
  return (
    <section className="turn-changes" aria-label={t('本轮文件变更')}>
      <div className="turn-changes-header">
        <span className="turn-card-icon"><FileDiff size={17} /></span>
        <div className="turn-card-text">
          <span>{t('本轮修改 {count} 个文件').replace('{count}', String(files.length))}</span>
          <small className="turn-changes-count">
            {(!unknown || additions > 0 || deletions > 0) && <><span>+{additions}</span> <span>−{deletions}</span></>}
            {unknown && <span className="turn-changes-unknown">{t(additions || deletions ? '部分行数未知' : '行数未知')}</span>}
          </small>
        </div>
        <button type="button" className="button ghost small" onClick={() => onReview()}>{t('查看变更')}</button>
      </div>
      {files.slice(0, expanded ? files.length : 3).map((file) => (
        <button type="button" key={file.path} className="turn-changes-row" onClick={() => onReview(file.path)} title={file.relative}>
          <span>{file.relative}</span>
          <span className="turn-changes-count">{file.unmeasuredWrite ? t('行数未知') : <><span>+{file.additions}</span> <span>−{file.deletions}</span></>}</span>
        </button>
      ))}
      {files.length > 3 && (
        <button type="button" className="turn-changes-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? t('收起文件') : t('再显示 {count} 个文件').replace('{count}', String(files.length - 3))}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
    </section>
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
