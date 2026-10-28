import { useTranslation } from '../i18n'
import type { ReactNode } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import { useApp } from '../store'
import { baseName, shortenPath } from '../lib/format'
import { PiLogo } from './PiLogo'

export function Welcome(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const workspaces = state.settings.workspaces.slice().reverse()

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-mark">
          <PiLogo size={44} />
        </div>
        <h1>Pi Desktop</h1>
        <p className="welcome-sub">{t("把 pi 装进桌面。打开一个项目，然后让 pi 读代码、改文件、跑命令。")}</p>

        {state.error && (
          <div className="welcome-error">
            <strong>{t("pi 没有在运行")}</strong>
            <span>{state.error}</span>
            <button className="button ghost" onClick={() => actions.openSettings(true)}>{t("检查设置")}</button>
          </div>
        )}

        <div className="welcome-actions">
          <button className="button primary" onClick={() => void actions.pickFolder()}>
            <FolderOpen size={15} />{t("打开项目")}</button>
          <button className="button ghost" onClick={() => actions.openSettings(true)}>{t("设置")}</button>
        </div>

        {workspaces.length > 0 && (
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
                  <span className="recent-name">{baseName(workspace)}</span>
                  <span className="recent-path">{shortenPath(workspace, state.boot?.home)}</span>
                </span>
                <Plus size={14} className="recent-plus" />
              </button>
            ))}
          </div>
        )}

        <div className="welcome-hint">
          {state.boot ? `pi ${state.boot.piVersion ?? 'unknown'} · Electron ${state.boot.electronVersion}` : ''}
        </div>
      </div>
    </div>
  )
}
