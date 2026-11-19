import { useTranslation } from '../i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Download, FolderOpen, Plus, RefreshCw } from 'lucide-react'
import { useApp } from '../store'
import { projectName, shortenPath } from '../lib/format'
import { isTemporaryWorkspace } from '@shared/paths'
import { PiLogo } from './PiLogo'

export function Welcome(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const workspaces = state.settings.workspaces.filter((path) => !isTemporaryWorkspace(path, state.boot?.scratchPath)).slice().reverse()
  const piMissing = Boolean(state.boot && !state.boot.piVersion)
  const needsModel = Boolean(state.boot?.piVersion && !state.piSettings?.defaultProvider && !state.piSettings?.defaultModel)
  const [installing, setInstalling] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [installError, setInstallError] = useState('')
  const [installMessage, setInstallMessage] = useState('')
  const [installLog, setInstallLog] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const autoStarted = useRef(false)

  useEffect(() => window.pi.onPiInstallProgress((progress) => setInstallMessage(progress.message)), [])

  const installPi = async (): Promise<void> => {
    if (installing) return
    setInstalling(true)
    setInstallMessage(t('正在准备 Pi…'))
    setInstallError('')
    setInstallLog('')
    try {
      const result = await window.pi.installPi()
      if (!result.ok) {
        setInstallError(result.error || t('请检查网络后再试一次。'))
        setShowAdvanced(true)
        setInstallLog(result.output || '')
        return
      }
      window.location.reload()
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error))
    } finally {
      setInstalling(false)
    }
  }

  // A missing runtime is the one blocker a new user cannot solve in the UI.
  // Start the official installer automatically, while keeping retry/manual
  // detection available if the network or installer fails.
  useEffect(() => {
    if (!piMissing || state.boot?.autoInstallPi === false || autoStarted.current) return
    autoStarted.current = true
    const timer = setTimeout(() => { void installPi() }, 700)
    return () => clearTimeout(timer)
  }, [piMissing, state.boot?.autoInstallPi])

  const openModelSettings = (): void => {
    actions.openSettings(true)
    window.dispatchEvent(new CustomEvent('pi:settings-section', { detail: 'models' }))
  }

  const recheckPi = async (): Promise<void> => {
    if (rechecking) return
    setRechecking(true)
    setInstallError('')
    try {
      const result = await window.pi.recheckPi()
      if (!result.piVersion) {
        setInstallError(t('还是没有准备好。可以再试一次，或打开高级选项查看详情。'))
        setShowAdvanced(true)
        return
      }
      window.location.reload()
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error))
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
        <h1>Pi Desktop</h1>
        <p className="welcome-sub">{needsModel ? t('连接一个 AI 模型后就可以开始聊天。不一定要先选文件夹。') : t('可以直接开始聊天。如果要处理某个文件夹里的文件，再选择文件夹。')}</p>

        {piMissing && (
          <div className="welcome-setup" role="region" aria-label={t('准备 Pi')}>
            <div className="welcome-setup-head">
              <span className="welcome-setup-icon"><Download size={17} /></span>
              <div>
                <strong>{installError ? t('准备工作没有完成') : installing ? t('正在完成准备工作') : t('第一次使用，先完成准备工作')}</strong>
                <p>{installing ? t('通常一两分钟，请不要关闭窗口。') : t('这是应用自己的准备步骤，一般不需要你操作。')}</p>
              </div>
            </div>
            <div className="welcome-setup-actions">
              <button className="button primary" disabled={installing} onClick={() => void installPi()}>
                {installing ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}
                {installing ? t('正在准备…') : installError ? t('再试一次') : t('开始准备')}
              </button>
            </div>
            {installing && <p className="welcome-setup-status">{installMessage || t('通常一两分钟，请不要关闭窗口。')}</p>}
            {installError && <p className="welcome-setup-error" role="alert">{installError}</p>}
            {(installError || showAdvanced) ? (
              <details className="welcome-setup-log" open>
                <summary>{t('高级')}</summary>
                <div className="welcome-setup-actions">
                  <button className="button ghost" disabled={installing || rechecking} onClick={() => void recheckPi()}>
                    <RefreshCw size={14} className={rechecking ? 'spin' : undefined} />
                    {t('重新检测')}
                  </button>
                  <button className="button ghost" onClick={() => actions.openSettings(true)}>{t('手动指定程序位置')}</button>
                </div>
                {installLog && <pre>{installLog.replace(/\x1b\[[0-9;]*m/g, '').slice(-4000)}</pre>}
                {state.boot?.piVersion && <p className="welcome-setup-status">{t('检测到的版本')} {state.boot.piVersion}</p>}
              </details>
            ) : (
              <button className="welcome-setup-settings" onClick={() => setShowAdvanced(true)}>{t('高级')}</button>
            )}
          </div>
        )}

        {!piMissing && needsModel && (
          <div className="welcome-model is-guide" role="region" aria-label={t('连接模型')}>
            <div className="welcome-model-head">
              <strong>{t('还差一步：连接 AI 模型')}</strong>
              <p>{t('API Key 是服务商给你的一串密钥，只保存在这台电脑上。也可以用账号登录。连接后就能开始聊天，不需要先选文件夹。')}</p>
            </div>
            <button className="button primary" onClick={openModelSettings}>{t('连接模型')}</button>
            <details className="welcome-setup-log">
              <summary>{t('我还没有密钥')}</summary>
              <p>{t('到服务商网站的 API keys 页面创建。常见的有 OpenAI、Anthropic、Google AI Studio 和 DeepSeek。创建后回到这里粘贴。')}</p>
            </details>
          </div>
        )}

        {state.error && !piMissing && (
          <div className="welcome-error">
            <strong>{t("pi 没有在运行")}</strong>
            <span>{state.error}</span>
            <button className="button ghost" onClick={() => actions.openSettings(true)}>{t("检查设置")}</button>
          </div>
        )}

        {!piMissing && (
          <div className="welcome-actions">
            <button className={clsx('button', needsModel ? 'ghost' : 'primary')} onClick={() => void actions.newScratchSession()}>
              {t('开始聊天')}</button>
            <button className="button ghost" onClick={() => actions.openAddProject(true)}>
              <FolderOpen size={15} />{t('选择文件夹')}</button>
            <button className="button ghost" onClick={() => actions.openSettings(true)}>{t("设置")}</button>
          </div>
        )}

        {!piMissing && workspaces.length > 0 && (
          <div className="recent">
            <div className="recent-label">{t("Recent projects")}</div>
            {workspaces.slice(0, 8).map((workspace) => (
              <button
                key={workspace}
                className="recent-item"
                onClick={() => void actions.openSession(workspace, null)}
              >
                <span className="recent-icon">
                  <FolderOpen size={14} />
                </span>
                <span className="recent-text">
                  <span className="recent-name">{projectName(state.settings.workspaceNames, workspace)}</span>
                  <span className="recent-path">{shortenPath(workspace, state.boot?.home)}</span>
                </span>
                <Plus size={14} className="recent-plus" />
              </button>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
