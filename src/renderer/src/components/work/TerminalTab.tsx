import { useTranslation } from '../../i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useApp } from '../../store'
import { baseName } from '../../lib/format'
import { TerminalRunner } from './TerminalRunner'

/** xterm colors follow the app's CSS variables so dark/light themes carry over. */
function xtermTheme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const v = (name: string): string | undefined => style.getPropertyValue(name).trim() || undefined
  return {
    background: v('--code-bg'),
    foreground: v('--text'),
    cursor: v('--accent-strong'),
    cursorAccent: v('--code-bg'),
    selectionBackground: v('--accent-soft'),
    red: v('--red'),
    green: v('--green'),
    blue: v('--accent-strong'),
    brightBlack: v('--text-dim')
  }
}

function monoFont(): string {
  const style = getComputedStyle(document.documentElement)
  return style.getPropertyValue('--mono').trim() || 'Menlo, monospace'
}

/** Real PTY terminal: the user's own login shell, deliberately outside pi's
 * sandbox and approval system — this terminal is the user typing, not the
 * agent. Falls back to the command runner when node-pty is unavailable. */
export function TerminalTab(): ReactNode {
  const [failed, setFailed] = useState(false)
  if (failed) return <TerminalRunner />
  return <PtyTerminal onUnavailable={() => setFailed(true)} />
}

function PtyTerminal({ onUnavailable }: { onUnavailable: () => void }): ReactNode {
  const t = useTranslation()
  const { state } = useApp()
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const [exited, setExited] = useState<number | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let sessionId: string | null = null
    const disposers: Array<() => void> = []

    const term = new Terminal({
      fontFamily: monoFont(),
      fontSize: 11.5,
      lineHeight: 1.3,
      cursorBlink: true,
      scrollback: 5000,
      theme: xtermTheme()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    term.focus()
    terminalRef.current = term
    const safeFit = (): void => {
      try { fit.fit() } catch { /* container not measurable yet */ }
    }
    safeFit()

    const workspace = state.workspace || state.boot?.home || ''
    void window.pi.createTerminal(workspace).then((created) => {
      if (disposed) {
        if ('error' in created) onUnavailable()
        else void window.pi.killTerminal(created.id)
        return
      }
      if ('error' in created) {
        onUnavailable()
        return
      }
      sessionId = created.id
      if (created.buffer) term.write(created.buffer)
      term.onData((data) => { void window.pi.writeTerminal(sessionId!, data) })
      term.onResize(({ cols, rows }) => { void window.pi.resizeTerminal(sessionId!, cols, rows) })
      disposers.push(window.pi.onTerminalData((payload) => {
        if (payload.id === sessionId) term.write(payload.data)
      }))
      disposers.push(window.pi.onTerminalExit((payload) => {
        if (payload.id === sessionId) setExited(payload.exitCode)
      }))
      safeFit()
      void window.pi.resizeTerminal(sessionId, term.cols, term.rows)
    })

    const resizeObserver = new ResizeObserver(() => safeFit())
    resizeObserver.observe(container)
    const themeObserver = new MutationObserver(() => {
      term.options.theme = xtermTheme()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })

    return () => {
      disposed = true
      resizeObserver.disconnect()
      themeObserver.disconnect()
      disposers.forEach((dispose) => dispose())
      if (sessionId) void window.pi.killTerminal(sessionId)
      term.dispose()
      terminalRef.current = null
    }
    // The shell session lives for this mount; the workspace is its starting
    // point, the user can cd anywhere (a real terminal has no cwd cage).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEpoch])

  const workspaceLabel = state.workspace ? baseName(state.workspace) : ''

  return (
    <div className="work-tab terminal pty">
      <div className="terminal-head">
        <span className="terminal-title">zsh{workspaceLabel ? ` · ${workspaceLabel}` : ''}</span>
        <span className="terminal-head-spacer" />
        {exited !== null && (
          <span className={clsx('terminal-exit', exited === 0 ? 'ok' : 'error')}>exit {exited}</span>
        )}
        <button
          className="work-icon"
          onClick={() => { setExited(null); setSessionEpoch((epoch) => epoch + 1) }}
          title={exited !== null ? t('重新打开') : t('新建终端')}
          aria-label={t('新建终端')}
        >
          <RotateCcw size={11} />
        </button>
        <button className="work-icon" onClick={() => terminalRef.current?.clear()} title={t('清空')} aria-label={t('清空')}>
          <Trash2 size={11} />
        </button>
      </div>
      <div className="terminal-pty-host" ref={containerRef} />
    </div>
  )
}
