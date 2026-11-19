import { useId, useRef, useState, type ReactNode } from 'react'
import { FolderOpen, FolderPlus, ShieldAlert } from 'lucide-react'
import type { AddProjectResult } from '@shared/types'
import { useTranslation } from '../i18n'
import { projectName, shortenPath } from '../lib/format'
import { useApp } from '../store'
import { Modal } from './ui'

function ProjectResources({ cwd, paths }: { cwd: string; paths?: string[] }): ReactNode {
  const t = useTranslation()
  if (!paths?.length) return null
  return (
    <div className="project-trust-resources">
      <strong>{t('检测到的项目资源')}</strong>
      {paths.map((path) => (
        <code key={path} title={path}>
          {path.startsWith(cwd + '/') || path.startsWith(cwd + '\\') ? path.slice(cwd.length + 1) : path}
        </code>
      ))}
    </div>
  )
}

export function AddProjectDialog(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const formId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  const [trust, setTrust] = useState<Extract<AddProjectResult, { status: 'needs-trust' }> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const existing = state.settings.workspaces.includes(folder)
  const names = state.settings.workspaceNames

  async function perform(work: () => Promise<void>): Promise<void> {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (error) {
      setError((error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  function chooseFolder(): void {
    void perform(async () => {
      const selected = await window.pi.pickFolder()
      if (!selected) return
      if (!name.trim() || name === projectName(names, folder).slice(0, 80) || state.settings.workspaces.includes(selected)) {
        setName(projectName(names, selected).slice(0, 80))
      }
      setFolder(selected)
      requestAnimationFrame(() => nameRef.current?.focus())
    })
  }

  function add(decision?: boolean): void {
    if (!folder || (!existing && !name.trim())) return
    void perform(async () => {
      const result = await window.pi.addProject({ cwd: trust?.cwd ?? folder, name, trust: decision })
      if (result.status === 'needs-trust') {
        setTrust(result)
        return
      }
      const opened = await actions.openSession(result.cwd, null)
      if (opened && state.settingsOpen) actions.openSettings(false)
      actions.openAddProject(false)
    })
  }

  function close(): void {
    if (pending.current) return
    actions.openAddProject(false)
  }

  return trust ? (
    <Modal
      key="trust"
      open
      title={t('信任此项目？')}
      subtitle={`${name.trim()} · ${shortenPath(trust.cwd, state.boot?.home)}`}
      onClose={close}
      footer={<>
        <button className="button ghost project-add-back" disabled={busy} onClick={() => { setTrust(null); setError('') }}>{t('返回')}</button>
        <button className="button ghost" autoFocus disabled={busy} onClick={() => add(false)}>{t('继续，不加载')}</button>
        <button className="button primary" disabled={busy} onClick={() => add(true)}>{t('信任并加载')}</button>
      </>}
    >
      <div className="project-trust-dialog">
        <div className="project-trust-warning">
          <ShieldAlert size={18} aria-hidden="true" />
          <p>{t('信任后，Pi 可以加载这个文件夹里的项目设置、技能和连接器。项目扩展也可能执行代码。')}</p>
        </div>
        <ProjectResources cwd={trust.cwd} paths={trust.trust.resources} />
        <p className="modal-text">{t('选择「继续，不加载」后，仍可查看文件和开始对话。之后可以在项目菜单里调整信任。')}</p>
        {error && <p className="project-add-error" role="alert">{error}</p>}
      </div>
    </Modal>
  ) : (
    <Modal
      key="details"
      open
      title={t('添加项目')}
      onClose={close}
      footer={<>
        <button type="button" className="button ghost" disabled={busy} onClick={close}>{t('取消')}</button>
        <button type="submit" form={formId} className="button primary" disabled={busy || !folder || !name.trim()}>
          {t(existing ? '打开项目' : '添加项目')}
        </button>
      </>}
    >
      <form id={formId} className="project-add-form" onSubmit={(event) => { event.preventDefault(); add() }}>
        <label className="form-field">
          <span>{t('项目名称')}</span>
          <input ref={nameRef} autoFocus maxLength={80} required placeholder={t('例如：经营分析')} value={name}
            disabled={busy} readOnly={existing} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="project-folder-field">
          <span>{t('项目文件夹')}</span>
          <div className="project-folder-row">
            <FolderOpen size={20} aria-hidden="true" />
            <span className="project-folder-path" title={folder || undefined}>
              {folder ? shortenPath(folder, state.boot?.home) : t('选择此电脑上的文件夹')}
            </span>
            <button type="button" className="button ghost small" disabled={busy} onClick={chooseFolder}>
              <FolderPlus size={15} aria-hidden="true" /> {t(folder ? '更换文件夹' : '选择文件夹')}
            </button>
          </div>
        </div>
        {existing && <p className="modal-text">{t('这个文件夹已在项目列表中。')}</p>}
        {error && <p className="project-add-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
