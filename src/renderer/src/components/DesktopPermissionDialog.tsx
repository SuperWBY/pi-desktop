import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ExternalLink, Monitor, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../i18n'
import { Modal } from './ui'

type Status = { accessibility: boolean; screenRecording: boolean; provisional?: boolean }

export function DesktopPermissionDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const t = useTranslation()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const generation = useRef(0)
  const wasIncomplete = useRef(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const updateStatus = (value: Status): void => {
    setStatus(value)
    if (!value.accessibility || !value.screenRecording) { wasIncomplete.current = true; return }
    if (wasIncomplete.current && !completeTimer.current) completeTimer.current = setTimeout(() => { completeTimer.current = null; closeRef.current() }, 1200)
  }
  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    const current = generation.current
    try { const value = await window.pi.desktopPermissionCheck(); if (current === generation.current) { updateStatus(value); setError('') } }
    catch (reason) { if (current === generation.current) { setStatus(null); setError(reason instanceof Error ? reason.message : String(reason)) } }
    finally { inFlight.current = false; setBusy(false) }
  }, [])
  useEffect(() => {
    if (!open) return
    generation.current++
    wasIncomplete.current = false
    setStatus(null)
    void refresh()
    const interval = setInterval(() => { void refresh() }, 1500)
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { generation.current++; clearInterval(interval); window.removeEventListener('focus', onFocus); if (completeTimer.current) clearTimeout(completeTimer.current); completeTimer.current = null; setStatus(null); window.pi.desktopPermissionGuideClose() }
  }, [open, refresh])
  const request = async (kind: 'accessibility' | 'screen'): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    const current = generation.current
    try { const value = await window.pi.desktopPermissionRequest(kind); if (current === generation.current) { updateStatus(value); setError('') } }
    catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const row = (kind: 'accessibility' | 'screen', granted: boolean, title: string, description: string): ReactNode => (
    <div className="desktop-permission-row">
      <span className="desktop-permission-icon">{kind === 'accessibility' ? <ShieldCheck size={19} /> : <Monitor size={19} />}</span>
      <span className="desktop-permission-copy"><strong>{t(title)}</strong><small>{t(description)}</small></span>
      {granted ? <span className="desktop-permission-granted"><Check size={15} />{t(status?.provisional ? '初步已开启' : '已开启')}</span> : <button className="button ghost desktop-permission-open" disabled={busy} onClick={() => void request(kind)}>{t(kind === 'accessibility' ? '打开辅助功能设置' : '打开屏幕录制设置')} <ExternalLink size={14} /></button>}
    </div>
  )
  return (
    <Modal open={open} title={t('开启桌面操作权限')} onClose={onClose} width={560}>
      <div className="desktop-permissions">
        <p className="desktop-permissions-intro">{t('允许 Pi 观察和操作桌面应用')}</p>
        <p className="desktop-permissions-description">{t(status?.accessibility && status.screenRecording ? '权限检查完成。桌面任务开始时会再次检查实际使用的组件。' : '仅在执行桌面任务时需要。请在系统设置中开启所需权限，我们会自动检测。')}</p>
        {status ? <div className="desktop-permission-list">
          {row('accessibility', status.accessibility, '辅助功能', '用于识别并操作应用中的按钮和输入框')}
          {row('screen', status.screenRecording, '屏幕录制', '用于查看当前应用窗口，帮助确认操作结果')}
        </div> : <p className="desktop-permissions-note">{busy ? t('正在检测权限…') : t('无法检测权限，请重试。')}</p>}
        {error && <p className="desktop-permissions-error" role="alert">{error}</p>}
        <p className="desktop-permissions-note">{t(status?.provisional ? '这是初步检测；任务开始时会复核实际使用的组件。' : '任务开始时会再次检测实际使用的组件。如果开启后仍未生效，请重启 Pi Desktop 再试。')}</p>
        <div className="confirm-actions">
          {status?.accessibility && status.screenRecording ? <button className="button primary" onClick={onClose}>{t('完成')}</button> : <><button className="button ghost" onClick={onClose}>{t('稍后再说')}</button><button className="button primary" disabled={busy} onClick={() => void refresh()}>{t('重新检测')}</button></>}
        </div>
      </div>
    </Modal>
  )
}
