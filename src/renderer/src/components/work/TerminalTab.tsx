import { useTranslation } from '../../i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Play, Square, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useApp } from '../../store'
import { baseName } from '../../lib/format'

/** How many recent completed commands keep their full output in the
 * scrollback; older ones collapse to their echo line. */
const FULL_OUTPUT_ENTRIES = 4

function EchoLine({ command, exitCode, running }: { command: string; exitCode?: number | null; running?: boolean }): ReactNode {
  const t = useTranslation()
  return (
    <div className="terminal-echo">
      <span className="terminal-prompt" aria-hidden="true">$</span>
      <span className="terminal-cmd">{command}</span>
      {running ? (
        <span className="terminal-run-dot" role="status" aria-label={t('运行中…')} />
      ) : exitCode != null ? (
        <span className={clsx('terminal-exit', exitCode === 0 ? 'ok' : 'error')}>{exitCode === 0 ? '✓' : '✕'}</span>
      ) : null}
    </div>
  )
}

export function TerminalTab(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const terminal = state.terminal
  const [command, setCommand] = useState('')
  const [excluded, setExcluded] = useState(terminal.excluded)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const historyDraft = useRef('')
  const [clearedEntries, setClearedEntries] = useState(() => new WeakSet<object>())
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = outputRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [terminal.output, terminal.history.length, terminal.running, terminal.command])

  const run = (): void => {
    const next = command.trim()
    if (!next || terminal.running) return
    void actions.runBash(next, excluded)
    setCommand('')
    setHistoryIndex(-1)
    historyDraft.current = ''
  }

  const recall = (delta: number): void => {
    const entries = terminal.history
    if (!entries.length) return
    if (historyIndex === -1) historyDraft.current = command
    const next = Math.min(Math.max(historyIndex + delta, -1), entries.length - 1)
    setHistoryIndex(next)
    setCommand(next === -1 ? historyDraft.current : entries[entries.length - 1 - next].command)
  }

  const completed = terminal.history.filter(entry => !clearedEntries.has(entry))
  const echoOnly = completed.slice(0, Math.max(0, completed.length - FULL_OUTPUT_ENTRIES))
  const fullEntries = completed.slice(-FULL_OUTPUT_ENTRIES)
  const workspace = state.workspace ? baseName(state.workspace) : ''

  return (
    <div className="work-tab terminal">
      <div className="terminal-head">
        <span className="terminal-title">bash{workspace ? ` · ${workspace}` : ''}</span>
        <span className="terminal-head-spacer" />
        {terminal.running ? (
          <span className="terminal-running">{t('运行中…')}</span>
        ) : terminal.exitCode !== null ? (
          <span className={clsx('terminal-exit', terminal.exitCode === 0 ? 'ok' : 'error')}>
            exit {terminal.exitCode}
          </span>
        ) : null}
        {terminal.running && (
          <button className="work-icon" onClick={() => void actions.stopBash()} title={t('停止')}>
            <Square size={11} />
          </button>
        )}
        <button className="work-icon" onClick={() => { setClearedEntries(new WeakSet(terminal.history)); actions.clearBash() }} title={t('清空')}>
          <Trash2 size={11} />
        </button>
        <label className="work-check" title={t('默认不写进上下文，需要 Pi 看到时再打开')}>
          <input
            type="checkbox"
            checked={!excluded}
            onChange={(event) => setExcluded(!event.target.checked)}
          />
          {t('同步给 Pi')}
        </label>
      </div>

      <div className="terminal-output" ref={outputRef}>
        {echoOnly.map((entry, index) => (
          <div className="terminal-entry" key={`echo-${index}`}>
            <EchoLine command={entry.command} exitCode={entry.exitCode} />
          </div>
        ))}
        {fullEntries.map((entry, index) => (
          <div className="terminal-entry" key={`full-${index}`}>
            <EchoLine command={entry.command} exitCode={entry.exitCode} />
            {entry.output && <pre>{entry.output}</pre>}
          </div>
        ))}
        {terminal.running && (
          <div className="terminal-entry terminal-entry-running">
            <EchoLine command={terminal.command} running />
            {terminal.output && <pre>{terminal.output}</pre>}
          </div>
        )}
        {!completed.length && !terminal.running && (
          <div className="work-empty">
            {t('在项目目录里运行命令。默认不会写进模型上下文。')}
          </div>
        )}
      </div>

      <div className="terminal-input">
        <span className="terminal-prompt" aria-hidden="true">$</span>
        <input
          value={command}
          placeholder={t('输入命令，⏎ 执行')}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          onChange={(event) => { setCommand(event.target.value); setHistoryIndex(-1); historyDraft.current = event.target.value }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              run()
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              recall(1)
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              recall(-1)
            }
          }}
        />
        <button
          className="work-icon primary"
          onClick={run}
          disabled={terminal.running || !command.trim()}
          title={t('执行')}
        >
          <Play size={12} />
        </button>
      </div>
    </div>
  )
}
