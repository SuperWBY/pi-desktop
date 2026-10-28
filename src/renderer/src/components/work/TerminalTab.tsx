import { useTranslation } from '../../i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Play, Square, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useApp } from '../../store'

export function TerminalTab(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const terminal = state.terminal
  const [command, setCommand] = useState('')
  const [excluded, setExcluded] = useState(terminal.excluded)
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = outputRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [terminal.output])

  const run = (): void => {
    const next = command.trim()
    if (!next || terminal.running) return
    void actions.runBash(next, excluded)
    setCommand('')
  }

  return (
    <div className="work-tab terminal">
      <div className="terminal-output" ref={outputRef}>
        {terminal.output ? (
          <pre>{terminal.output}</pre>
        ) : (
          <div className="work-empty">
            {t('在项目目录里运行命令。默认不会写进模型上下文。')}
          </div>
        )}
      </div>

      <div className="terminal-status">
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
        <button className="work-icon" onClick={() => actions.clearBash()} title={t('清空')}>
          <Trash2 size={11} />
        </button>
        <label className="work-check" title={t('默认不写进上下文，需要 pi 看到时再打开')}>
          <input
            type="checkbox"
            checked={!excluded}
            onChange={(event) => setExcluded(!event.target.checked)}
          />
          {t('同步给 pi')}
        </label>
      </div>

      <div className="terminal-input">
        <span className="terminal-prompt">$</span>
        <input
          value={command}
          placeholder={t('输入命令，⏎ 执行')}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              run()
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

      {terminal.history.length > 0 && (
        <div className="terminal-history">
          {terminal.history
            .slice()
            .reverse()
            .slice(0, 8)
            .map((entry, index) => (
              <button
                key={index}
                className="terminal-history-item"
                onClick={() => setCommand(entry.command)}
                title={entry.command}
              >
                <span className={clsx('history-exit', entry.exitCode === 0 ? 'ok' : 'error')}>
                  {entry.exitCode ?? '-'}
                </span>
                <span className="history-cmd">{entry.command}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
