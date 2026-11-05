import { useTranslation } from '../i18n'
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import type { ToolCallBlock, ToolResultMessage, ToolRun } from '@shared/types'
import { formatDuration } from '../lib/format'
import { durationOf, toolPhrases } from '../lib/tools'
import { useElapsed } from '../lib/use-elapsed'
import { ToolCard } from './ToolCard'

/**
 * Collapses a burst of same-name tool calls into one action row
 * ("运行了 3 条命令") — the unit a reader thinks in, not one card per call.
 */
export function ToolGroup({
  calls,
  toolRuns,
  results,
  defaultOpen = false,
  firstCallDefaultOpen = false
}: {
  calls: ToolCallBlock[]
  toolRuns: Record<string, ToolRun>
  results: Record<string, ToolResultMessage>
  defaultOpen?: boolean
  firstCallDefaultOpen?: boolean
}): ReactNode {
  const t = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const name = calls[0]?.name ?? 'tool'
  const phrases = toolPhrases(name)
  const runs = calls.map((call) => toolRuns[call.id])
  const running = calls.some((call) => {
    const run = toolRuns[call.id]
    return run?.status === 'running' || (!run && !results[call.id])
  })
  const failed = calls.filter(
    (call) => toolRuns[call.id]?.status === 'error' || results[call.id]?.isError
  ).length

  const durations = calls.map((call) => durationOf(toolRuns[call.id], results[call.id]))
  const settled = durations.every((value) => typeof value === 'number')
  const total = settled
    ? durations.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : undefined
  const startedAt = runs.reduce<number | undefined>(
    (earliest, run) =>
      run?.startedAt && (!earliest || run.startedAt < earliest) ? run.startedAt : earliest,
    undefined
  )
  const elapsed = useElapsed(startedAt, running)
  const duration = running ? elapsed : total

  const label = t(phrases.group)
    .replace('{count}', String(calls.length))
    .replace('{name}', name)

  return (
    <div className={clsx('tool-group', running && 'is-running', failed > 0 && 'has-error', open && 'is-open')}>
      <button
        type="button"
        className="tool-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="tool-chevron">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="tool-title">{label}</span>
        <span className="tool-status">
          {duration !== undefined && <span className="tool-duration">{formatDuration(duration)}</span>}
          {failed > 0 && <span className="tool-failed">{failed}</span>}
        </span>
      </button>
      {open && (
        <div className="tool-group-body">
          {calls.map((call, index) => (
            <ToolCard
              key={call.id}
              call={call}
              run={toolRuns[call.id]}
              result={results[call.id]}
              defaultOpen={index === 0 && firstCallDefaultOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}
