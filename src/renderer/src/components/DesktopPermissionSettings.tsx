import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ExternalLink, Monitor, RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../i18n'

type Status = { accessibility: boolean; screenRecording: boolean; provisional?: boolean }

/**
 * Inline macOS permission status for Settings. Keeping this on the page means
 * users can see what is missing without first opening a modal, and the
 * buttons still route to the native privacy panes.
 */
export function DesktopPermissionSettings(): ReactNode {
  const t = useTranslation()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const generation = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    const current = generation.current
    try {
      const value = await window.pi.desktopPermissionCheck()
      if (current === generation.current) {
        setStatus(value)
        setError('')
      }
    } catch (reason) {
      if (current === generation.current) {
        setStatus(null)
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    generation.current++
    void refresh()
    const interval = setInterval(() => { void refresh() }, 2500)
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      generation.current++
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const request = async (kind: 'accessibility' | 'screen'): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    const current = generation.current
    try {
      const value = await window.pi.desktopPermissionRequest(kind)
      if (current === generation.current) {
        setStatus(value)
        setError('')
      }
    } catch (reason) {
      if (current === generation.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const row = (kind: 'accessibility' | 'screen', granted: boolean, title: string, description: string): ReactNode => (
    <div className="desktop-permission-row">
      <span className="desktop-permission-icon">{kind === 'accessibility' ? <ShieldCheck size={19} /> : <Monitor size={19} />}</span>
      <span className="desktop-permission-copy"><strong>{t(title)}</strong><small>{t(description)}</small></span>
      {granted
        ? <span className="desktop-permission-granted"><Check size={15} />{t(status?.provisional ? '初步已开启' : '已开启')}</span>
        : <button className="button ghost desktop-permission-open" disabled={busy} onClick={() => void request(kind)}>
            {t(kind === 'accessibility' ? '打开辅助功能设置' : '打开屏幕录制设置')} <ExternalLink size={14} />
          </button>}
    </div>
  )

  return (
    <div className="settings-permission-block">
      <div className="settings-permission-head">
        <div>
          <strong>{t('macOS 权限')}</strong>
          <small>{t('桌面操作需要辅助功能与屏幕录制权限，可随时检查并前往系统设置。')}</small>
        </div>
        <button className="button ghost settings-permission-refresh" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw size={14} className={busy ? 'spin' : undefined} />{t('重新检测')}
        </button>
      </div>
      {status ? <div className="desktop-permission-list settings-permission-list">
        {row('accessibility', status.accessibility, '辅助功能', '用于识别并操作应用中的按钮和输入框')}
        {row('screen', status.screenRecording, '屏幕录制', '用于查看当前应用窗口，帮助确认操作结果')}
      </div> : <p className="settings-note">{busy ? t('正在检测权限…') : t('无法检测权限，请重试。')}</p>}
      {error && <p className="desktop-permissions-error" role="alert">{error}</p>}
      <p className="settings-permission-note">{t(status?.provisional
        ? '这是初步检测；任务开始时会复核实际使用的组件。'
        : status?.accessibility && status.screenRecording
          ? '权限检查完成。桌面任务开始时会再次检查实际使用的组件。'
          : '任务开始时会再次检测实际使用的组件。如果开启后仍未生效，请重启 Pi Desktop 再试。')}</p>
    </div>
  )
}
