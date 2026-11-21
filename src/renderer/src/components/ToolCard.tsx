import { useTranslation } from '../i18n'
import { memo, useMemo, useState, type ReactNode } from 'react'
import {
  ChevronRight,
  ExternalLink,
  FilePlus2,
  FileText,
  FolderSearch,
  PencilLine,
  Search,
  Terminal,
  Wrench
} from 'lucide-react'
import clsx from 'clsx'
import type { ContentBlock, ToolCallBlock, ToolResultMessage, ToolRun } from '@shared/types'
import { baseName, formatDuration } from '../lib/format'
import { browserActionResultUnknown, computerUseOutcome, contentText, durationOf, readRangeLabel, toolImages, toolMeta, toolPhrases } from '../lib/tools'
import { editChange } from '../lib/edit-change'
import { describeSearch, shellOutput } from '../lib/shell-output'
import { useElapsed } from '../lib/use-elapsed'
import { Spinner } from './ui'
import { CopyButton } from './Markdown'
import { DiffView, PatchView } from './Diff'

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

function openToolFile(path: string, line?: number): void {
  window.dispatchEvent(new CustomEvent('pi:tool-file', { detail: { path, line } }))
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
            ? t(tail ? '只看最后几行' : '只看前几行')
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
  const details = run?.resultDetails ?? result?.details
  const meta = toolMeta(call.name, args, details)
  const phrases = toolPhrases(call.name)
  const status = run?.status === 'error' || result?.isError ? 'error' : run?.status ?? (result ? 'done' : 'running')
  const resultText = run?.resultText || contentText(result)
  const images = toolImages(run?.resultContent ?? (result?.content as ContentBlock[] | undefined))
  const running = status === 'running'
  const elapsed = useElapsed(run?.startedAt, running)
  const duration = running ? elapsed : durationOf(run, result)
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = expanded ?? internalOpen
  const [fullDiff, setFullDiff] = useState(false)

  const command = meta.kind === 'bash' && typeof args.command === 'string' ? args.command : ''
  const search = useMemo(() => describeSearch(command), [command])
  const path = typeof args.path === 'string' ? args.path : ''
  const nativeSearch = call.name === 'grep' && typeof args.pattern === 'string'
    ? { scope: path, pattern: args.pattern, files: false } : undefined
  const searchTarget = search ?? nativeSearch
  const Icon = searchTarget ? Search : ICONS[meta.kind]
  const range = readRangeLabel(args)
  const rangeText = range
    ? range.end != null
      ? t('第 {start}–{end} 行').replace('{start}', String(range.start)).replace('{end}', String(range.end))
      : t('从第 {start} 行').replace('{start}', String(range.start))
    : ''
  const edit = useMemo(() => meta.kind === 'edit' && status === 'done' ? editChange(args, details) : null, [meta.kind, status, args, details])
  const outcome = !running && status !== 'error' ? computerUseOutcome(call.name, details) : null
  const resultUnknown = browserActionResultUnknown(call.name, status === 'error', resultText)
  const outcomeIsTitle = outcome === '已取消' || outcome === '等待人工处理' || outcome === '等待选择文件'
  const verb = resultUnknown ? '操作结果未知，请核对' : status === 'error' ? phrases.failed
    : running ? phrases.running : outcomeIsTitle ? outcome : meta.kind === 'edit' ? '已编辑' : phrases.done
  const label = searchTarget
    ? t(searchTarget.files
      ? running ? '正在 {scope} 中查找文件' : '在 {scope} 中查找文件'
      : running ? '正在 {scope} 中搜索' : status === 'done' ? '已在 {scope} 中搜索' : '在 {scope} 中搜索')
      .replace('{scope}', searchTarget.scope || t('当前目录')) +
      (searchTarget.pattern ? ` “${searchTarget.pattern}”` : '')
    : meta.translateSubtitle ? t(meta.subtitle) : meta.subtitle
  const shell = meta.kind === 'bash'
    ? shellOutput(resultText || run?.partialText || '', status === 'error', run?.resultStructured ?? result?.structuredContent, details)
    : null
  const exitText = shell?.exitCode === undefined ? '' : t('退出码 {code}').replace('{code}', String(shell.exitCode))
  const fileRow = Boolean(path && (meta.kind === 'read' || meta.kind === 'edit' || meta.kind === 'write'))
  const focusLine = edit?.firstChangedLine ?? (meta.kind === 'read' ? range?.start : undefined)
  const toggle = (): void => {
    const next = !open
    setInternalOpen(next)
    onExpandedChange?.(next)
  }
  const head = (
    <>
      <span className="tool-chevron"><ChevronRight size={13} /></span>
      <span className={clsx('tool-icon', `kind-${meta.kind}`)}><Icon size={12} /></span>
      {!searchTarget && <span className="tool-title">{t(verb)}</span>}
    </>
  )
  const statusView = (
    <span className="tool-status">
      {outcome && !outcomeIsTitle && <span className="tool-outcome" title={t(outcome)}>{t(outcome)}</span>}
      {duration !== undefined && <span className="tool-duration">{formatDuration(duration)}</span>}
      {status === 'error' && !resultUnknown && <span className="tool-failed">{(!open && exitText) || t('failed')}</span>}
    </span>
  )

  return (
    <div className={clsx('tool-card', `status-${status}`, open && 'is-open')}>
      {fileRow ? (
        <div className="tool-file-row">
          <button type="button" className="tool-head" aria-expanded={open} onClick={toggle}>{head}</button>
          <button type="button" className="tool-subtitle tool-file-link" title={path} onClick={() => openToolFile(path, focusLine)}>{baseName(path)}</button>
          {edit && (edit.additions > 0 || edit.deletions > 0) && (
            <span className="tool-line-stats"><span>+{edit.additions}</span> <span>−{edit.deletions}</span></span>
          )}
          <span className="tool-file-spacer" />
          {statusView}
        </div>
      ) : (
        <button type="button" className="tool-head" aria-expanded={open} onClick={toggle}>
          {head}
          <span className={clsx('tool-subtitle', searchTarget && 'tool-search')} title={searchTarget ? label : command || label}>{label}</span>
          {statusView}
        </button>
      )}

      {open && (
        <div className="tool-body">
          {edit?.patch ? (
            <div className="diff-block">
              <div className="diff-head">
                <span>{edit.firstChangedLine
                  ? t('从第 {start} 行').replace('{start}', String(edit.firstChangedLine))
                  : baseName(path)}</span>
                <span className="diff-actions">
                  <CopyButton text={edit.patch.text} />
                  <FileActions path={path} />
                </span>
              </div>
              <PatchView patch={edit.patch} />
            </div>
          ) : edit?.pairs.length ? (
            edit.pairs.map((pair, index) => (
              <div className="diff-block" key={index}>
                <div className="diff-head">
                  <span>{baseName(path) || 'file'}</span>
                  {edit.pairs.length > 1 && (
                    <span className="diff-count">
                      {t('change {count}').replace('{count}', String(index + 1))}
                    </span>
                  )}
                  <span className="diff-actions">
                    <button
                      className="file-action"
                      onClick={() => setFullDiff((value) => !value)}
                    >
                      {t(fullDiff ? '只看上下文' : '展开片段')}
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
          ) : shell ? (
            <div className="bash-body">
              <div className="bash-command">
                <span className="bash-prompt">$</span>
                <code>{command}</code>
                <CopyButton text={command} />
              </div>
              {shell.text && (
                <CodeOutput text={shell.text} maxLines={20} tail />
              )}
              {(exitText || shell.fullOutputPath) && (
                <div className="bash-result-footer">
                  {shell.fullOutputPath && <button type="button" className="more-button" onClick={() => openToolFile(shell.fullOutputPath!)}>{t('查看保存的输出')}</button>}
                  {exitText && <span className={clsx('bash-exit-status', status === 'error' && 'failed')}>{exitText}</span>}
                </div>
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
                  <span className="file-path">{path}{rangeText ? ` · ${rangeText}` : ''}</span>
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
