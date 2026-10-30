import { useTranslation } from '../../i18n'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, FolderSearch, RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import type { GitStatus } from '@shared/types'
import { useApp } from '../../store'
import { buildTurns } from '../../lib/turns'
import { collectSessionChanges, type FileChange } from '../../lib/session-changes'
import { latestReview } from '../../lib/review-focus'
import { DiffView } from '../Diff'
import { baseName, shortenPath } from '../../lib/format'


export function ChangesTab(): ReactNode {
  const t = useTranslation()
  const { state } = useApp()
  const [mode, setMode] = useState<'session' | 'workspace'>('session')
  const [git, setGit] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [patch, setPatch] = useState<string>('')
  const [hideTests, setHideTests] = useState(false)
  const [fullDiff, setFullDiff] = useState(false)

  const turns = useMemo(
    () => buildTurns(state.messages, state.toolRuns, {}, -1),
    [state.messages, state.toolRuns]
  )
  const sessionFiles = useMemo(() => collectSessionChanges(turns, state.toolRuns, state.workspace ?? ''), [turns, state.toolRuns, state.workspace])
  const handledReview = useRef(0)

  useEffect(() => {
    const apply = (): void => {
      const request = latestReview()
      if (!request || request.sequence === handledReview.current || request.session !== state.sessionPath || request.workspace !== state.workspace) return
      if (!sessionFiles.some((file) => file.path === request.path)) return
      handledReview.current = request.sequence
      setMode('session')
      setOpenFile(request.path)
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-work-file="${CSS.escape(request.path)}"]`)?.scrollIntoView({ block: 'nearest' })
      })
    }
    window.addEventListener('pi:review-request', apply)
    apply()
    return () => window.removeEventListener('pi:review-request', apply)
  }, [sessionFiles, state.sessionPath, state.workspace])

  const loadGit = async (): Promise<void> => {
    if (!state.workspace) return
    setLoading(true)
    try {
      setGit(await window.pi.gitStatus(state.workspace))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (mode === 'workspace') void loadGit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, state.workspace])

  const files =
    mode === 'session'
      ? sessionFiles
      : (git?.files ?? []).map((file) => ({
          path: file.path,
          relative: file.relative,
          additions: file.additions,
          deletions: file.deletions,
          unmeasuredWrite: false,
          turnKeys: [],
          calls: []
        }))

  const visible = hideTests
    ? files.filter((file) => !/(\.test\.|\.spec\.|__tests__|\/tests?\/)/.test(file.relative))
    : files

  const totals = visible.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions
    }),
    { additions: 0, deletions: 0 }
  )

  const openPatch = async (file: FileChange, staged = false): Promise<void> => {
    if (openFile === file.path) {
      setOpenFile(null)
      return
    }
    setOpenFile(file.path)
    setPatch('')
    if (mode === 'workspace' && state.workspace) {
      const text = await window.pi.gitDiff(state.workspace, file.relative, staged)
      setPatch(text)
    }
  }

  return (
    <div className="work-tab">
      <div className="work-toolbar">
        <div className="work-segment">
          <button
            className={clsx(mode === 'session' && 'active')}
            onClick={() => setMode('session')}
          >
            {t('本会话')}
          </button>
          <button
            className={clsx(mode === 'workspace' && 'active')}
            onClick={() => setMode('workspace')}
          >
            {t('工作区')}
          </button>
        </div>
        {mode === 'workspace' && (
          <button className="work-icon" onClick={() => void loadGit()} title={t('刷新')}>
            <RefreshCw size={12} className={clsx(loading && 'spin')} />
          </button>
        )}
        <label className="work-check" title={t('折叠测试文件')}>
          <input type="checkbox" checked={hideTests} onChange={(e) => setHideTests(e.target.checked)} />
          {t('跳过测试')}
        </label>
      </div>

      <div className="work-summary">
        <span className="work-diff-stat">
          <span className="plus">+{totals.additions}</span>
          <span className="minus">−{totals.deletions}</span>
        </span>
        <span className="work-dim">
          {t('{count} 个文件').replace('{count}', String(visible.length))}
          {mode === 'workspace' && git?.branch ? ` · ${git.branch}` : ''}
          {mode === 'session' && visible.some((file) => file.unmeasuredWrite) ? ` · ${state.settings.language === 'en' ? 'some counts unknown' : '部分行数未知'}` : ''}
        </span>
      </div>

      {visible.length === 0 && (
        <div className="work-empty">
          {mode === 'session'
            ? t('本次会话还没有改动文件。')
            : git?.ok
              ? t('工作区是干净的。')
              : t('当前目录不是 git 仓库，或读不到 git 状态。')}
        </div>
      )}

      <div className="work-list">
        {visible.map((file) => {
          const expanded = openFile === file.path
          return (
            <div className="work-file" key={file.path} data-work-file={file.path}>
              <button className="work-file-head" onClick={() => void openPatch(file)}>
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="work-file-name" title={file.relative}>
                  {baseName(file.relative)}
                </span>
                <span className="work-file-dir">{shortenPath(file.relative.replace(/\/[^/]+$/, ''))}</span>
                <span className="work-diff-stat small">
                  {file.unmeasuredWrite ? <span>{state.settings.language === 'en' ? 'Counts unknown' : '行数未知'}</span> : <><span className="plus">+{file.additions}</span><span className="minus">−{file.deletions}</span></>}
                </span>
              </button>
              {expanded && (
                <div className="work-file-body">
                  {mode === 'workspace' ? (
                    patch ? (
                      <pre className="git-patch">
                        {patch.split('\n').map((line, index) => (
                          <div
                            key={index}
                            className={clsx(
                              'git-patch-line',
                              line.startsWith('+') && !line.startsWith('+++') && 'added',
                              line.startsWith('-') && !line.startsWith('---') && 'removed',
                              line.startsWith('@@') && 'hunk'
                            )}
                          >
                            {line || ' '}
                          </div>
                        ))}
                      </pre>
                    ) : (
                      <div className="work-empty small">{t('读取 diff…')}</div>
                    )
                  ) : (
                    file.calls.map((call, index) =>
                      call.name === 'edit' ? (
                        <DiffView
                          key={index}
                          oldText={call.oldText}
                          newText={call.newText}
                          context={fullDiff ? Number.MAX_SAFE_INTEGER : 3}
                        />
                      ) : (
                        <pre className="git-patch" key={index}>
                          <div>{state.settings.language === 'en' ? 'Written content; previous content unavailable' : '写入内容；原文件内容不可用'}</div>
                          {call.newText
                            .split('\n')
                            .slice(0, 80)
                            .map((line, lineIndex) => (
                              <div className="git-patch-line" key={lineIndex}>
                                {line || ' '}
                              </div>
                            ))}
                        </pre>
                      )
                    )
                  )}
                  <div className="work-file-actions">
                    {mode === 'session' && (
                      <button
                        className="settings-button"
                        onClick={() => setFullDiff((value) => !value)}
                        title={fullDiff ? t('只看上下文') : t('展开全文件')}
                      >
                        {fullDiff ? t('全文') : '±3'}
                      </button>
                    )}
                    <button className="settings-button" onClick={() => void window.pi.openPath(file.path)}>
                      <ExternalLink size={11} /> {t('打开')}
                    </button>
                    <button
                      className="settings-button"
                      onClick={() => {
                        window.pi.showItem(file.path)
                      }}
                    >
                      <FolderSearch size={11} /> {t('在 Finder 中显示')}
                    </button>
                    {mode === 'session' && file.turnKeys.length > 0 && (
                      <button
                        className="settings-button"
                        onClick={() => {
                          const node = document.querySelector<HTMLElement>(
                            `[data-turn-key="${file.turnKeys[file.turnKeys.length - 1]}"]`
                          )
                          node?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                        }}
                      >
                        {t('定位到轮次')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {mode === 'workspace' && !git?.ok && (
        <p className="work-hint">
          {t('提示：工作区模式需要项目是 git 仓库；本会话模式只看 pi 的改动。')}
        </p>
      )}
      {mode === 'session' && visible.length > 0 && (
        <p className="work-hint">
          {t('数据来自本会话的工具调用参数，可能和磁盘最终状态略有差异。')}
        </p>
      )}
    </div>
  )
}
