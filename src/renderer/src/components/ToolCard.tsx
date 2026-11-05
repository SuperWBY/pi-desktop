import { useTranslation } from '../i18n'
import { memo, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FilePlus2,
  FileText,
  FolderSearch,
  PencilLine,
  Terminal,
  Wrench
} from 'lucide-react'
import clsx from 'clsx'
import type { ContentBlock, ToolCallBlock, ToolResultMessage, ToolRun } from '@shared/types'
import { baseName, formatDuration } from '../lib/format'
import { contentText, durationOf, editPairs, toolImages, toolMeta, toolPhrases } from '../lib/tools'
import { useElapsed } from '../lib/use-elapsed'
import { Spinner } from './ui'
import { CopyButton } from './Markdown'
import { DiffView } from './Diff'

/** Reveal / open a path straight from a tool card. */
function FileActions({ path }: { path: string }): ReactNode {
  const t = useTranslation()
  if (!path.includes('/')) return null
  return (
    <>
      <button
        className="file-action"
        title={t('用默认应用打开')}
        onClick={(event) => {
          event.stopPropagation()
          void window.pi.openPath(path)
        }}
      >
        <ExternalLink size={12} />
      </button>
      <button
        className="file-action"
        title={t('在 Finder 中显示')}
        onClick={(event) => {
          event.stopPropagation()
          window.pi.showItem(path)
        }}
      >
        <FolderSearch size={12} />
      </button>
    </>
  )
}

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
  maxLines = 20,
  tail = false
}: {
  text: string
  lineNumbers?: boolean
  maxLines?: number
  /** bash output is most useful at the end: show the tail instead of the head. */
  tail?: boolean
}): ReactNode {
  const t = useTranslation()
  const [showAll, setShowAll] = useState(false)
  const lines = text.replace(/\n$/, '').split('\n')
  const hidden = Math.max(0, lines.length - maxLines)
  const visible = showAll ? lines : tail ? lines.slice(-maxLines) : lines.slice(0, maxLines)
  const offset = showAll || !tail ? 0 : hidden

  return (
    <div className="output">
      {hidden > 0 && !showAll && tail && (
        <div className="output-more">
          {t('… 前面省略 {count} 行').replace('{count}', String(hidden))}
        </div>
      )}
      <pre className={clsx('output-pre', lineNumbers && 'with-lines')}>
        {visible.map((line, index) => (
          <div className="output-line" key={index}>
            {lineNumbers && <span className="line-number">{offset + index + 1}</span>}
            <span className="line-text">{line || ' '}</span>
          </div>
        ))}
      </pre>
      {hidden > 0 && (
        <button className="more-button" onClick={() => setShowAll((value) => !value)}>
          {showAll
            ? t('只看前几行')
            : t('… 还有 {count} 行 · 显示全部').replace('{count}', String(hidden))}
        </button>
      )}
    </div>
  )
}

export const ToolCard = memo(function ToolCard({
  call,
  run,
  result,
  defaultOpen = false,
  expanded,
  onExpandedChange
}: {
  call: ToolCallBlock
  run?: ToolRun
  result?: ToolResultMessage
  defaultOpen?: boolean
  expanded?: boolean
  onExpandedChange?: (value: boolean) => void
}): ReactNode {
  const t = useTranslation()
  const args = run?.args && Object.keys(run.args).length ? run.args : (call.arguments ?? {})
  const meta = toolMeta(call.name, args)
  const phrases = toolPhrases(call.name)
  const status = run?.status === 'error' || result?.isError ? 'error' : run?.status ?? (result ? 'done' : 'running')
  const resultText = run?.resultText ?? contentText(result)
  const images = toolImages(run?.resultContent ?? (result?.content as ContentBlock[] | undefined))
  const running = status === 'running'
  const elapsed = useElapsed(run?.startedAt, running)
  const duration = running ? elapsed : durationOf(run, result)
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = expanded ?? internalOpen
  const [fullDiff, setFullDiff] = useState(false)

  const Icon = ICONS[meta.kind]
  const path = typeof args.path === 'string' ? args.path : ''
  const pairs = meta.kind === 'edit' ? editPairs(args) : []
  const verb = status === 'error' ? phrases.failed : running ? phrases.running : phrases.done

  return (
    <div className={clsx('tool-card', `status-${status}`, open && 'is-open')}>
      <button
        type="button"
        className="tool-head"
        onClick={() => {
          const next = !open
          setInternalOpen(next)
          onExpandedChange?.(next)
        }}
        aria-expanded={open}
      >
        <span className="tool-chevron">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className={clsx('tool-icon', `kind-${meta.kind}`)}>
          <Icon size={12} />
        </span>
        <span className="tool-title">{t(verb)}</span>
        <span className="tool-subtitle" title={meta.subtitle}>
          {meta.subtitle}
        </span>
        <span className="tool-status">
          {duration !== undefined && <span className="tool-duration">{formatDuration(duration)}</span>}
          {status === 'error' && !running && <span className="tool-failed">{t('failed')}</span>}
        </span>
      </button>

      {open && (
        <div className="tool-body">
          {meta.kind === 'edit' && pairs.length > 0 ? (
            pairs.map((pair, index) => (
              <div className="diff-block" key={index}>
                <div className="diff-head">
                  <span>{baseName(path) || 'file'}</span>
                  {pairs.length > 1 && (
                    <span className="diff-count">
                      {t('change {count}').replace('{count}', String(index + 1))}
                    </span>
                  )}
                  <span className="diff-actions">
                    <button
                      className="file-action"
                      onClick={() => setFullDiff((value) => !value)}
                      title={fullDiff ? t('只看上下文') : t('展开全文件')}
                    >
                      {fullDiff ? t('全文') : `±${3}`}
                    </button>
                    <CopyButton text={pair.newText} />
                    <FileActions path={path} />
                  </span>
                </div>
                <DiffView
                  oldText={pair.oldText}
                  newText={pair.newText}
                  context={fullDiff ? Number.MAX_SAFE_INTEGER : 3}
                />
              </div>
            ))
          ) : meta.kind === 'bash' ? (
            <div className="bash-body">
              <div className="bash-command">
                <span className="bash-prompt">$</span>
                <code>{String(args.command ?? '')}</code>
                <CopyButton text={String(args.command ?? '')} />
              </div>
              {(resultText || run?.partialText) && (
                <CodeOutput text={resultText || run?.partialText || ''} maxLines={20} tail />
              )}
              {running && !resultText && !run?.partialText && (
                <div className="bash-running">
                  <Spinner size={11} />{t("running…")}</div>
              )}
            </div>
          ) : meta.kind === 'read' ? (
            <div className="read-body">
              {path && (
                <div className="file-head">
                  <span className="file-path">{path}</span>
                  <span className="file-actions">
                    <CopyButton text={path} />
                    <FileActions path={path} />
                  </span>
                </div>
              )}
              {resultText ? (
                <CodeOutput text={resultText} lineNumbers maxLines={24} />
              ) : (
                <div className="muted-line">{t("读取中…")}</div>
              )}
            </div>
          ) : meta.kind === 'write' ? (
            <div className="write-body">
              {path && (
                <div className="file-head">
                  <span className="file-path">{path}</span>
                  <span className="file-actions">
                    <CopyButton text={String(args.content ?? '')} />
                    <FileActions path={path} />
                  </span>
                </div>
              )}
              {typeof args.content === 'string' ? (
                <CodeOutput text={args.content} lineNumbers maxLines={24} />
              ) : (
                <div className="muted-line">{t("写入中…")}</div>
              )}
            </div>
          ) : (
            <div className="generic-body">
              <div className="generic-section">
                <div className="section-label">{t("参数")}</div>
                <pre className="json-block">{JSON.stringify(args, null, 2)}</pre>
              </div>
              {resultText && (
                <div className="generic-section">
                  <div className="section-label">{t("结果")}</div>
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
