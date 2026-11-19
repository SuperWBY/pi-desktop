import { useTranslation } from '../i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { useApp } from '../store'
import { PiLogo } from './PiLogo'
import { ConnectModelPanel } from './ConnectModelPanel'

export function Welcome(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const piMissing = Boolean(state.boot && !state.boot.piVersion)
  const needsModel = Boolean(state.boot?.piVersion && !state.piSettings?.defaultProvider && !state.piSettings?.defaultModel)
  const [installing, setInstalling] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [failed, setFailed] = useState(false)
  const [installLog, setInstallLog] = useState('')
  const [connectOpen, setConnectOpen] = useState(false)
  const autoStarted = useRef(false)

  useEffect(() => window.pi.onPiInstallProgress(() => undefined), [])

  const installPi = async (): Promise<void> => {
    if (installing) return
    setInstalling(true)
    setFailed(false)
    setInstallLog('')
    try {
      const result = await window.pi.installPi()
      if (!result.ok) {
        setFailed(true)
        setInstallLog(result.output || '')
        return
      }
      window.location.reload()
    } catch {
      setFailed(true)
    } finally {
      setInstalling(false)
    }
  }

  useEffect(() => {
    if (!piMissing || state.boot?.autoInstallPi === false || autoStarted.current) return
    autoStarted.current = true
    const timer = setTimeout(() => { void installPi() }, 700)
    return () => clearTimeout(timer)
  }, [piMissing, state.boot?.autoInstallPi])

  const recheckPi = async (): Promise<void> => {
    if (rechecking) return
    setRechecking(true)
    setFailed(false)
    try {
      const result = await window.pi.recheckPi()
      if (!result.piVersion) {
        setFailed(true)
        return
      }
      window.location.reload()
    } catch {
      setFailed(true)
    } finally {
      setRechecking(false)
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-mark">
          <PiLogo size={44} />
        </div>

        {piMissing && (
          <div className="welcome-setup" role="region" aria-label={t('准备')}>
            <div className="welcome-progress" aria-hidden="true"><span style={{ width: installing ? '62%' : '14%' }} /></div>
            <p>{t('约 1 分钟')}</p>
            <div className="welcome-setup-actions">
              <button className="button primary" disabled={installing} onClick={() => void installPi()}>
                {installing ? <RefreshCw size={14} className="spin" /> : null}
                {installing ? t('正在准备…') : t('开始准备')}
              </button>
              <button className="button ghost" disabled={installing || rechecking} onClick={() => void recheckPi()}>
                {t('重新检测')}
              </button>
            </div>
            {failed && <p className="welcome-error" role="alert">{t('还没准备好')}</p>}
            {failed && (
              <details className="welcome-setup-log" open>
                <summary>{t('高级')}</summary>
                <button className="button ghost" onClick={() => actions.openSettings(true)}>{t('手动指定程序位置')}</button>
                {installLog ? <pre>{installLog.replace(/\x1b\[[0-9;]*m/g, '').slice(-4000)}</pre> : null}
              </details>
            )}
          </div>
        )}

        {!piMissing && connectOpen && <ConnectModelPanel onClose={() => setConnectOpen(false)} />}

        {!piMissing && !connectOpen && (
          <>
            <h1>{needsModel ? t('先连接模型') : t('可以开始了')}</h1>
            {needsModel ? (
              <button className="button primary" onClick={() => setConnectOpen(true)}>{t('连接模型')}</button>
            ) : (
              <button className="button primary" onClick={() => void actions.newScratchSession()}>{t('开始聊天')}</button>
            )}
            <button type="button" className="welcome-link" onClick={() => actions.openAddProject(true)}>{t('选择文件夹')}</button>
          </>
        )}
      </div>
    </div>
  )
}
