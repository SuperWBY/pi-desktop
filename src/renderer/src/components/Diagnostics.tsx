import { useTranslation } from '../i18n'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Copy, FolderOpen, RotateCw, X } from 'lucide-react'
import clsx from 'clsx'
import { useApp } from '../store'
import { shortenPath } from '../lib/format'

/**
 * "Why did it break?" panel. pi's stderr was collected since the first version
 * but never surfaced, which made auth/model-config failures invisible.
 */
export function Diagnostics(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const open = state.diagnosticsOpen
  const [copied, setCopied] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') actions.openDiagnostics(false)
    }
    document.addEventListener('keydown', onKey)
    void window.pi.readModelsConfig().then((config) => setModelsError(config.error ?? null))
    return () => document.removeEventListener('keydown', onKey)
  }, [open, actions])

  const stderrTail = useMemo(() => {
    const lines = state.stderr.split('\n').filter((line) => line.trim())
    return lines.slice(-60)
  }, [state.stderr])

  if (!open) return null

  const report = [
    `Pi Desktop ${state.boot?.appVersion ?? '?'} · Electron ${state.boot?.electronVersion ?? '?'}`,
    `status: ${state.status}`,
    `pi: ${state.boot?.piPath ?? '?'} (${state.boot?.piVersion ?? '?'})`,
    `agent dir: ${state.boot?.agentDir ?? '?'}`,
    `sessions: ${state.boot?.sessionsRoot ?? '?'}`,
    `workspace: ${state.workspace ?? '-'}`,
    `session: ${state.sessionPath ?? '-'}`,
    `models.json error: ${modelsError ?? 'none'}`,
    '',
    '...stderr tail...',
    ...stderrTail
  ].join('\n')

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      actions.notify('error', t('复制失败'), t('剪贴板不可用'))
    }
  }

  return (
    <div className="drawer-overlay" onMouseDown={() => actions.openDiagnostics(false)}>
      <aside
        className="drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={t("诊断")}
      >
        <header className="drawer-head">
          <div>
            <h2>{t("诊断")}</h2>
            <p>{t("pi 的运行状态与最后 60 行 stderr")}</p>
          </div>
          <button
            className="icon-button"
            onClick={() => actions.openDiagnostics(false)}
            aria-label={t("关闭")}
          >
            <X size={16} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="diagnostics-grid">
            <Row label={t("状态")}>
              <span className={clsx('settings-pill', state.status === 'ready' ? 'ok' : 'warn')}>
                {state.status}
              </span>
            </Row>
            <Row label="pi">
              <span className="mono" title={state.boot?.piPath}>
                {state.boot?.piVersion ? `${state.boot.piVersion} · ` : ''}
                {shortenPath(state.boot?.piPath ?? '', state.boot?.home)}
              </span>
            </Row>
            <Row label={t("Agent 目录")}>
              <span className="mono">{shortenPath(state.boot?.agentDir ?? '', state.boot?.home)}</span>
            </Row>
            <Row label={t("会话目录")}>
              <span className="mono">
                {shortenPath(state.boot?.sessionsRoot ?? '', state.boot?.home)}
              </span>
            </Row>
            <Row label={t("当前会话")}>
              <span className="mono" title={state.sessionPath ?? ''}>
                {state.sessionPath ? shortenPath(state.sessionPath, state.boot?.home) : '—'}
              </span>
            </Row>
          </section>

          {modelsError && (
            <section className="diagnostics-error">
              <strong>{t("models.json 有问题")}</strong>
              <pre>{modelsError}</pre>
            </section>
          )}

          <section className="diagnostics-log">
            <div className="diagnostics-log-head">
              <span>stderr</span>
              <span className="diagnostics-count">{stderrTail.length} {state.settings.language === 'en' ? 'lines' : '行'}</span>
            </div>
            {stderrTail.length === 0 ? (
              <div className="diagnostics-empty">{t("没有输出，一切正常。")}</div>
            ) : (
              <pre>{stderrTail.join('\n')}</pre>
            )}
          </section>
        </div>

        <footer className="drawer-foot">
          <button className="settings-button primary" onClick={() => void copy(report)}>
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? t("已复制") : t("复制诊断信息")}
          </button>
          <button
            className="settings-button"
            onClick={() => state.boot?.sessionsRoot && actions.revealSession(state.boot.sessionsRoot)}
          >
            <FolderOpen size={12} />{t("会话目录")}</button>
          <button
            className="settings-button"
            onClick={() => {
              actions.openDiagnostics(false)
              void actions.restartSession()
            }}
          >
            <RotateCw size={12} />{t("重启会话")}</button>
        </footer>
      </aside>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="diagnostics-row">
      <span className="diagnostics-label">{label}</span>
      <div className="diagnostics-value">{children}</div>
    </div>
  )
}
