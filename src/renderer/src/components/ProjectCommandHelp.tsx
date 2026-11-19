import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from '../i18n'
import { Modal } from './ui'

export function ProjectCommandHelp(): ReactNode {
  const t = useTranslation()
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null)
  useEffect(() => {
    const show = (event: Event): void => {
      const path = (event as CustomEvent<{ workspace?: unknown }>).detail?.workspace
      if (typeof path === 'string' && path) { setWorkspace(path); setCopyStatus(null) }
    }
    window.addEventListener('pi:project-command-help', show)
    return () => window.removeEventListener('pi:project-command-help', show)
  }, [])
  return <Modal open={workspace !== null} title={t('排查项目命令')} onClose={() => setWorkspace(null)} width={520}
    footer={<button className="button primary" onClick={() => setWorkspace(null)}>{t('关闭')}</button>}>
    <p>{t('命令可能拼写有误、对应扩展未启用，或项目资源因未信任而未加载。')}</p>
    <p>{t('在终端进入项目目录，运行 pi，然后输入 /trust 并自行决定是否信任。')}</p>
    <p>{t('项目信任可能允许该目录中的扩展执行代码。只信任你了解的项目；处理后回到 Pi Desktop 新建会话，再重试原命令。')}</p>
    <p>{t('新建会话前，请先复制并清空输入框中的草稿，以便稍后重试。')}</p>
    <p>{t('当前项目')}：<code style={{overflowWrap:'anywhere'}}>{workspace}</code></p>
    <button className="button ghost" onClick={() => { if (workspace) void navigator.clipboard.writeText(workspace).then(() => setCopyStatus('copied')).catch(() => setCopyStatus('failed')) }}>{t('复制项目路径')}</button>
    {copyStatus && <span role="status"> {t(copyStatus === 'copied' ? '路径已复制' : '复制失败，请手动选择路径。')}</span>}
  </Modal>
}
