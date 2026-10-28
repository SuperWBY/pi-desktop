import { useTranslation } from '../i18n'
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import type { ToolCallBlock, ToolResultMessage, ToolRun } from '@shared/types'
import { baseName } from '../lib/format'
import { ToolCard } from './ToolCard'
import { Spinner } from './ui'

/**
 * Collapses a burst of identical tool calls (five `read`s, six `grep`s) into a
 * single row. Claude Code and Codex both keep the step list this dense; without
 * it a single turn can paint a dozen cards.
 */
export function ToolGroup({
  calls,
  toolRuns,
  results
}: {
  calls: ToolCallBlock[]
  toolRuns: Record<string, ToolRun>
  results: Record<string, ToolResultMessage>
}): ReactNode {
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  const name = calls[0]?.name ?? 'tool'
  const runs = calls.map((call) => toolRuns[call.id])
  const running = runs.some((run) => run?.status === 'running')
  const failed = runs.filter((run) => run?.status === 'error').length
  const files = calls
    .map((call) => (call.arguments as { path?: unknown })?.path)
    .filter((path): path is string => typeof path === 'string' && Boolean(path))
  const duration = runs.reduce((total, run) => total + (run?.durationMs ?? 0), 0)

  return (
    <div className={clsx('tool-group', running && 'is-running', failed && 'has-error')}>
      <button
        type="button"
        className="tool-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="tool-chevron">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="tool-title">
          {name} × {calls.length}
        </span>
        <span className="tool-subtitle" title={files.map((path) => baseName(path)).join('、')}>
          {files.length
            ? t('{count} files').replace('{count}', String(new Set(files).size))
            : t('{count} calls').replace('{count}', String(calls.length))}
        </span>
        <span className="tool-status">
          {running ? (
            <Spinner size={12} />
          ) : (
            duration > 0 && <span className="tool-duration">{Math.round(duration)}ms</span>
          )}
          {failed > 0 && <span className="tool-failed">{failed}</span>}
        </span>
      </button>
      {open && (
        <div className="tool-group-body">
          {calls.map((call) => (
            <ToolCard
              key={call.id}
              call={call}
              run={toolRuns[call.id]}
              result={results[call.id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
