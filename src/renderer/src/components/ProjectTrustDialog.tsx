import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ProjectTrustStatus } from '@shared/types'
import { useTranslation } from '../i18n'
import { useApp } from '../store'
import { isTemporaryWorkspace } from '@shared/paths'
import { projectName, shortenPath } from '../lib/format'
import { Modal } from './ui'

export function ProjectTrustDialog(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [loaded, setLoaded] = useState<{ cwd: string; status: ProjectTrustStatus } | null>(null)
  const [cwd, setCwd] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const requestId = useRef(0)
  const currentSession = useRef({ workspace: state.workspace, sessionPath: state.sessionPath, streaming: state.streaming })
  currentSession.current = { workspace: state.workspace, sessionPath: state.sessionPath, streaming: state.streaming }

  const status = loaded?.cwd === cwd ? loaded?.status : null

  const refresh = useCallback(async (): Promise<void> => {
    const id = ++requestId.current
    setLoadError(false)
    if (!cwd) {
      setLoaded(null)
      return
    }
    try {
      const value = await window.pi.projectTrustStatus(cwd)
      if (id === requestId.current) setLoaded({ cwd, status: value })
    } catch {
      if (id === requestId.current) { setLoaded(null); setLoadError(true) }
    }
  }, [cwd])

  useEffect(() => {
    void refresh()
    if (!cwd) return
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { requestId.current++; window.removeEventListener('focus', onFocus) }
  }, [cwd, refresh])

  useEffect(() => {
    const manage = (event: Event): void => {
      const path = (event as CustomEvent<string>).detail
      if (isTemporaryWorkspace(path, state.boot?.scratchPath)) return
      setCwd(path)
    }
    window.addEventListener('pi:manage-project-trust', manage)
    return () => window.removeEventListener('pi:manage-project-trust', manage)
  }, [state.boot?.scratchPath])

  if (!cwd) return null

  const apply = async (decision: boolean | null, scope: 'project' | 'parent'): Promise<void> => {
    if (busy) return
    const owner = currentSession.current
    setBusy(true)
    try {
      const next = await window.pi.projectTrustSet(cwd, decision, scope)
      requestId.current++
      setLoaded({ cwd, status: next })
      setCwd(null)
      const sameSession = cwd === owner.workspace && cwd === currentSession.current.workspace && owner.sessionPath === currentSession.current.sessionPath
      if (decision === true && sameSession && state.messages.length > 0 && !currentSession.current.streaming) {
        actions.notify('info', t('已信任此项目'), t('正在重新打开会话以加载项目资源。'))
        await actions.restartSession()
      } else if (decision === true) {
        actions.notify('info', t('已信任此项目'), t('项目资源将在新建会话时加载。'))
      } else {
        actions.notify('info', t('项目扩展未启用'), t('新建会话时将跳过项目自带的配置和扩展。'))
      }
    } catch (error) {
      actions.notify('error', t('无法更新项目信任'), error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t('项目信任')}
      subtitle={`${projectName(state.settings.workspaceNames, cwd)} · ${shortenPath(cwd, state.boot?.home)}`}
      width={540}
      onClose={() => (busy ? undefined : setCwd(null))}
      footer={<button className="button ghost" disabled={busy} onClick={() => setCwd(null)}>{t(status?.decision == null ? '取消' : '关闭')}</button>}
    >
      <div className="project-trust-dialog">
        <div className="project-trust-warning">
          <ShieldAlert size={18} />
          <p>{t('信任会允许加载此文件夹里的配置、扩展和技能；其中部分内容可能执行代码。它不会自动改变工具审批或沙箱设置。')}</p>
        </div>
        {loadError && <p className="modal-text" role="alert">{t('无法读取项目信任状态。')}</p>}
        {status?.decision === false && <p className="modal-text">{t('项目扩展未启用')}</p>}
        {status?.decision === true && <p className="modal-text">{t('已信任此项目')}</p>}
        {Boolean(status?.resources?.length) && <div className="project-trust-resources"><strong>{t('检测到的项目资源')}</strong>{status?.resources?.map((path) => <code key={path}>{path}</code>)}</div>}
        <button className="project-trust-option primary" disabled={busy || !status || status.decision === true} onClick={() => void apply(true, 'project')}>
          <ShieldCheck size={17} />
          <span><strong>{t('始终信任此项目')}</strong><small>{t('保存决定，之后打开此文件夹时也会加载项目资源。')}</small></span>
        </button>
        <button className="project-trust-option danger" disabled={busy || !status || status.decision === false} onClick={() => void apply(false, 'project')}>
          <ShieldAlert size={17} />
          <span><strong>{t('不信任此项目')}</strong><small>{t('不加载项目本地扩展、技能和设置。')}</small></span>
        </button>
        <details className="project-trust-more"><summary>{t('更多选项')}</summary><button className="project-trust-option" disabled={busy || !status} onClick={() => void apply(true, 'parent')}>
          <ShieldCheck size={17} />
          <span><strong>{t('信任父目录')}</strong><small>{t('范围更广：父目录下的其他项目也可能继承此信任。')}</small></span>
        </button></details>
        {state.streaming && <p className="settings-note">{t('当前任务运行期间不会重启会话；信任会在下次打开时生效。')}</p>}
      </div>
    </Modal>
  )
}
