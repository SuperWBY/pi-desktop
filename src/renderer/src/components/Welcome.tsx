import { useTranslation } from '../i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Download, FolderOpen, Plus, RefreshCw } from 'lucide-react'
import { useApp } from '../store'
import { projectName, shortenPath } from '../lib/format'
import { PiLogo } from './PiLogo'

export function Welcome(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const workspaces = state.settings.workspaces.slice().reverse()
  const piMissing = Boolean(state.boot && !state.boot.piVersion)
  const needsModel = Boolean(state.boot?.piVersion && !state.piSettings?.defaultProvider && !state.piSettings?.defaultModel)
  const piBundled = state.boot?.piBundled === true
  const [installing, setInstalling] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [installError, setInstallError] = useState('')
  const [installMessage, setInstallMessage] = useState('')
  const [installLog, setInstallLog] = useState('')
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
        setInstallError(result.error || t('准备失败，请检查网络后重试。'))
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
        setInstallError(t('还没有找到 Pi。请先完成准备，或检查设置里的 Pi 路径。'))
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
        <p className="welcome-sub">{needsModel ? t('先选择 AI 模型，再打开项目开始对话。') : t('打开一个项目，让 Pi 帮你研究问题、处理文件、规划任务或编写代码。')}</p>

        {piMissing && (
          <div className="welcome-setup" role="region" aria-label={t('准备 Pi')}>
            <div className="welcome-setup-head">
              <span className="welcome-setup-icon"><Download size={17} /></span>
              <div>
                <strong>{t('准备 Pi')}</strong>
                <p>{t('Pi 是这个应用的 AI 引擎，负责理解问题、使用工具和处理文件。首次启动会自动准备，通常不需要你操作。')}</p>
              </div>
            </div>
            <div className="welcome-setup-actions">
              <button className="button primary" disabled={installing} onClick={() => void installPi()}>
                {installing ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}
                {installing ? t('正在准备…') : installError ? t('重试准备') : t('立即准备')}
              </button>
              <button className="button ghost" disabled={installing || rechecking} onClick={() => void recheckPi()}>
                <RefreshCw size={14} className={rechecking ? 'spin' : undefined} />
                {t('重新检测')}
              </button>
            </div>
            {installing && <p className="welcome-setup-status">{installMessage || t('正在自动准备，通常需要一两分钟。请不要关闭窗口。')}</p>}
            {installError && <p className="welcome-setup-error" role="alert">{installError}</p>}
            {installLog && (
              <details className="welcome-setup-log">
                <summary>{t('查看安装日志')}</summary>
                <pre>{installLog.replace(/\x1b\[[0-9;]*m/g, '').slice(-4000)}</pre>
              </details>
            )}
            <button className="welcome-setup-settings" onClick={() => actions.openSettings(true)}>{t('已经安装过？设置 Pi 路径')}</button>
          </div>
        )}

        {!piMissing && needsModel && (
          <div className="welcome-model" role="region" aria-label={t('选择模型')}>
            <div className="welcome-model-head">
              <strong>{t('还差一步：选择 AI 模型')}</strong>
              <p>{t(piBundled ? 'Pi 已准备好。选择一个 AI 服务商并填写 API Key 即可使用。' : 'Pi 已安装。选择一个 AI 服务商并填写 API Key 即可使用。')}</p>
            </div>
            <button className="button primary" onClick={openModelSettings}>{t('选择模型')}</button>
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
            <button className={clsx('button', needsModel ? 'ghost' : 'primary')} onClick={() => actions.openAddProject(true)}>
              <FolderOpen size={15} />{t("打开项目")}</button>
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

        <div className="welcome-hint">
          {state.boot ? `${piBundled ? '内置 Pi' : 'pi'} ${state.boot.piVersion ?? 'unknown'}` : ''}
        </div>
      </div>
    </div>
  )
}
