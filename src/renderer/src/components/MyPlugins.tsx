import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Check, FolderOpen, LoaderCircle, Package, Play, RefreshCw, Sparkles } from 'lucide-react'
import { CREATOR_COMMAND, type CreatedPlugin, type CreatedPluginsResult, type CreatorAction } from '@shared/creator'
import { pathsEqual, projectReadOnly } from '@shared/paths'
import { useApp } from '../store'
import { useTranslation } from '../i18n'
import { runPackageWrite, usePackageOperations } from '../lib/package-operations'
import { baseName } from '../lib/format'
import './creator.css'

const labels = { draft: '草稿', checked: '检查通过', tested: '可安装', installed: '已安装' }
// Survives navigation while a package write waits in the shared queue.
let pluginJob: { path: string; action: string } | null = null
const jobListeners = new Set<() => void>()
const subscribeJob = (listener: () => void): (() => void) => { jobListeners.add(listener); return () => { jobListeners.delete(listener) } }
function publishJob(job: typeof pluginJob): void { pluginJob = job; jobListeners.forEach(listener => listener()) }
export function MyPlugins({ onInstalled }: { onInstalled: () => Promise<void> }): ReactNode {
  const { state, actions } = useApp()
  const t = useTranslation()
  const [result, setResult] = useState<CreatedPluginsResult>({ plugins: [], warnings: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pending = useSyncExternalStore(subscribeJob, () => pluginJob)
  const request = useRef(0)
  const mounted = useRef(true)
  const operations = usePackageOperations()
  const refresh = useCallback(async () => {
    const version = ++request.current
    setLoading(true)
    try {
      const next = await window.pi.listCreatedPlugins()
      if (mounted.current && version === request.current) { setResult(next); setError('') }
    } catch { if (mounted.current && version === request.current) setError('读取我的插件失败，请重试。') }
    finally { if (mounted.current && version === request.current) setLoading(false) }
  }, [])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++ } }, [])
  useEffect(() => { void refresh() }, [refresh, state.workspace, state.creator, operations, pending])
  const busy = Boolean(pending) || state.creatorBusy || Boolean(state.creator?.busy) || state.streaming
  const available = state.status === 'ready' && state.commands.some(command => command.name === CREATOR_COMMAND)
  const readOnly = state.sessionSecurity?.files === 'read-only' || projectReadOnly(state.settings, state.workspace ?? '')
  const operate = async (plugin: CreatedPlugin, action: 'check' | 'test' | 'install'): Promise<void> => {
    if (pluginJob || busy || !available || !pathsEqual(plugin.workspace, state.workspace ?? '')) return
    publishJob({ path: plugin.path, action })
    try {
      const expected = { workspace: state.workspace!, sessionPath: state.sessionPath }
      if (!state.creator?.enabled && !await actions.creatorAction({ action: 'enable' }, expected)) return
      const input = { action, id: plugin.id } as CreatorAction
      if (action === 'install') {
        const installed = await runPackageWrite(() => actions.creatorAction(input, expected))
        if (installed) await onInstalled()
      }
      else await actions.creatorAction(input, expected)
      await refresh()
    } finally { publishJob(null) }
  }
  return <section className="my-plugins" aria-label={t('我的插件')} aria-busy={Boolean(pending)}>
    <div className="my-plugins-heading"><div><h2>{t('我的插件')}</h2><p>{t('你创建的插件都在这里。继续在对话里完善，验证后即可安装使用。')}</p></div>
      <button className="my-plugins-refresh" aria-label={t('刷新我的插件')} disabled={loading || busy} onClick={() => void refresh()}><RefreshCw size={16} className={loading ? 'creator-spin' : ''} /></button>
    </div>
    {error && <p className="my-plugins-error" role="alert">{t(error)}<button onClick={() => void refresh()}>{t('重试')}</button></p>}
    {result.warnings.map(warning => <p className="my-plugins-warning" key={warning.workspace} role="status">{t('部分项目暂时无法读取：')}{baseName(warning.workspace)}<span title={warning.error}> · {t('请检查项目目录后刷新。')}</span></p>)}
    {loading && !result.plugins.length ? <div className="my-plugins-empty" role="status"><LoaderCircle size={24} className="creator-spin" /><p>{t('正在读取我的插件…')}</p></div>
      : !error && !result.plugins.length ? <div className="my-plugins-empty"><Package size={32} /><h3>{t('还没有创建插件')}</h3><p>{t('想给 Pi 增加什么功能？进入创意模式，在对话里告诉它。')}</p><button disabled={busy || !available} onClick={() => void actions.beginCreator()}><Sparkles size={15} />{t('开始创作')}</button></div>
      : <div className="my-plugins-list">{result.plugins.map(plugin => {
        const current = pathsEqual(plugin.workspace, state.workspace ?? '')
        const active = pending?.path === plugin.path
        const project = state.settings.workspaceNames?.[plugin.workspace] || (pathsEqual(plugin.workspace, state.boot?.scratchPath ?? '') ? t('临时工作区') : baseName(plugin.workspace))
        return <article className="my-plugin" key={plugin.path} aria-label={plugin.name} aria-busy={active}>
          <Package className="my-plugin-icon" size={25} />
          <div className="my-plugin-body"><div className="my-plugin-title"><h3>{plugin.name}</h3><span key={plugin.status} className="my-plugin-status" role="status">{plugin.status === 'installed' && <Check size={13} />}{t(labels[plugin.status])}</span></div>
            <p className="my-plugin-project" title={plugin.workspace}>{t('所属项目')} · {project}</p>
            {plugin.description && <p className="my-plugin-description">{plugin.description}</p>}
            <p>{plugin.status === 'draft' ? t('完成检查和试运行后，即可安装使用。') : plugin.status === 'checked' ? t('检查已通过，下一步试运行插件。') : plugin.status === 'tested' ? t('加载验证已通过，可以安装并在对话中验证具体功能。') : t('插件已安装，可以继续创作和更新。')}</p>
            {plugin.error && <p className="my-plugins-error" role="alert">{plugin.error}</p>}
            <div className="my-plugin-actions">
              <button disabled={busy || !available} onClick={() => void actions.beginCreator(plugin.workspace, plugin)}>{t('继续创作')}</button>
              {current && <><button disabled={busy || !available || readOnly} onClick={() => void operate(plugin, 'check')}>{active && pending.action === 'check' && <LoaderCircle className="creator-spin" size={14} />}{t('检查')}</button>
                {plugin.checkedFingerprint === plugin.fingerprint && <button disabled={busy || !available || readOnly} onClick={() => void operate(plugin, 'test')}>{active && pending.action === 'test' ? <LoaderCircle className="creator-spin" size={14} /> : <Play size={13} />}{t('试运行')}</button>}
                {plugin.testedFingerprint === plugin.fingerprint && plugin.status !== 'installed' && <button className="my-plugin-install" disabled={busy || !available || readOnly} onClick={() => void operate(plugin, 'install')}>{active && pending.action === 'install' && <LoaderCircle className="creator-spin" size={14} />}{t(active && pending.action === 'install' ? '正在安装' : '安装并使用')}</button>}</>}
              <button className="my-plugin-files" aria-label={`${t('查看插件文件')} ${plugin.name}`} onClick={() => void window.pi.showItem(plugin.path)}><FolderOpen size={15} /></button>
            </div>
            {!current && <small>{t('继续创作会打开此插件所属项目的对话。')}</small>}
            {current && readOnly && <small>{t('当前会话只读，开启工作区写入后可创建和试运行插件。')}</small>}
          </div>
        </article>
      })}</div>}
  </section>
}
