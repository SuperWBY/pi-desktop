import { memo, useEffect, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  PencilLine,
  Terminal,
  Wrench
} from 'lucide-react'
import clsx from 'clsx'
import type { ContentBlock, ToolCallBlock, ToolResultMessage, ToolRun } from '@shared/types'
import { baseName, formatDuration } from '../lib/format'
import { contentText, diffParts, editPairs, toolImages, toolMeta } from '../lib/tools'
import { Spinner } from './ui'
import { CopyButton } from './Markdown'

const ICONS = {
  bash: Terminal,
  read: FileText,
  write: FilePlus2,
  edit: PencilLine,
  tool: Wrench
}

function CodeOutput({
  text,
  lineNumbers = false,
  maxLines = 240
}: {
  text: string
  lineNumbers?: boolean
  maxLines?: number
}): ReactNode {
  const [showAll, setShowAll] = useState(false)
  const lines = text.replace(/\n$/, '').split('\n')
  const visible = showAll ? lines : lines.slice(0, maxLines)

  return (
    <div className="output">
      <pre className={clsx('output-pre', lineNumbers && 'with-lines')}>
        {visible.map((line, index) => (
          <div className="output-line" key={index}>
            {lineNumbers && <span className="line-number">{index + 1}</span>}
            <span className="line-text">{line || ' '}</span>
          </div>
        ))}
      </pre>
      {lines.length > maxLines && (
        <button className="more-button" onClick={() => setShowAll((value) => !value)}>
          {showAll ? '收起' : `展开全部 ${lines.length} 行`}
        </button>
      )}
    </div>
  )
}

function DiffView({ oldText, newText }: { oldText: string; newText: string }): ReactNode {
  const parts = diffParts(oldText, newText)
  return (
    <div className="diff">
      {parts.map((part, index) => {
        const marker = part.added ? '+' : part.removed ? '-' : ' '
        const lines = part.value.replace(/\n$/, '').split('\n')
        return (
          <pre
            key={index}
            className={clsx('diff-part', part.added && 'added', part.removed && 'removed')}
          >
            {lines.map((line, lineIndex) => (
              <div className="diff-line" key={lineIndex}>
                <span className="diff-marker">{marker}</span>
                <span>{line || ' '}</span>
              </div>
            ))}
          </pre>
        )
      })}
    </div>
  )
}

export const ToolCard = memo(function ToolCard({
  call,
  run,
  result,
  defaultOpen = false
}: {
  call: ToolCallBlock
  run?: ToolRun
  result?: ToolResultMessage
  defaultOpen?: boolean
}): ReactNode {
  const args = run?.args && Object.keys(run.args).length ? run.args : (call.arguments ?? {})
  const meta = toolMeta(call.name, args)
  const status = run?.status ?? (result ? ((result as { isError?: boolean }).isError ? 'error' : 'done') : 'running')
  const resultText = run?.resultText ?? contentText(result)
  const images = toolImages(run?.resultContent ?? (result?.content as ContentBlock[] | undefined))
  const running = status === 'running'
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (status === 'running' || status === 'error') setOpen(true)
    else setOpen(defaultOpen)
  }, [status, defaultOpen])

  const Icon = ICONS[meta.kind]
  const path = typeof args.path === 'string' ? args.path : ''
  const pairs = meta.kind === 'edit' ? editPairs(args) : []

  return (
    <div className={clsx('tool-card', `status-${status}`)}>
      <button
        type="button"
        className="tool-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="tool-chevron">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className={clsx('tool-icon', `kind-${meta.kind}`)}>
          <Icon size={13} />
        </span>
        <span className="tool-title">{meta.title}</span>
        <span className="tool-subtitle" title={meta.subtitle}>
          {meta.subtitle}
        </span>
        <span className="tool-status">
          {running ? (
            <Spinner size={12} />
          ) : (
            run?.durationMs && <span className="tool-duration">{formatDuration(run.durationMs)}</span>
          )}
          {status === 'error' && <span className="tool-failed">failed</span>}
        </span>
      </button>

      {open && (
        <div className="tool-body">
          {meta.kind === 'edit' && pairs.length > 0 ? (
            pairs.map((pair, index) => (
              <div className="diff-block" key={index}>
                <div className="diff-head">
                  <span>{baseName(path) || 'file'}</span>
                  {pairs.length > 1 && <span className="diff-count">change {index + 1}</span>}
                </div>
                <DiffView oldText={pair.oldText} newText={pair.newText} />
              </div>
            ))
          ) : meta.kind === 'bash' ? (
            <div className="bash-body">
              <div className="bash-command">
                <span className="bash-prompt">$</span>
                <code>{String(args.command ?? '')}</code>
              </div>
              {(resultText || run?.partialText) && (
                <CodeOutput text={resultText || run?.partialText || ''} maxLines={400} />
              )}
              {running && !resultText && !run?.partialText && (
                <div className="bash-running">
                  <Spinner size={11} /> running…
                </div>
              )}
            </div>
          ) : meta.kind === 'read' ? (
            <div className="read-body">
              {path && (
                <div className="file-head">
                  <span className="file-path">{path}</span>
                  <CopyButton text={path} />
                </div>
              )}
              {resultText ? (
                <CodeOutput text={resultText} lineNumbers maxLines={200} />
              ) : (
                <div className="muted-line">读取中…</div>
              )}
            </div>
          ) : meta.kind === 'write' ? (
            <div className="write-body">
              {path && (
                <div className="file-head">
                  <span className="file-path">{path}</span>
                  <CopyButton text={String(args.content ?? '')} />
                </div>
              )}
              {typeof args.content === 'string' ? (
                <CodeOutput text={args.content} lineNumbers maxLines={80} />
              ) : (
                <div className="muted-line">写入中…</div>
              )}
            </div>
          ) : (
            <div className="generic-body">
              <div className="generic-section">
                <div className="section-label">参数</div>
                <pre className="json-block">{JSON.stringify(args, null, 2)}</pre>
              </div>
              {resultText && (
                <div className="generic-section">
                  <div className="section-label">结果</div>
                  <CodeOutput text={resultText} maxLines={120} />
                </div>
              )}
            </div>
          )}

          {images.length > 0 && (
            <div className="tool-images">
              {images.map((image, index) => (
                <img
                  key={index}
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt="tool output"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
