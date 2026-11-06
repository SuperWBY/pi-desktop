import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, FolderOpen, RefreshCw, ShieldCheck, Zap } from 'lucide-react'
import { Modal } from './ui'
import { useTranslation } from '../i18n'

export function ChromeBridgeDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): ReactNode {
  const t = useTranslation()
  const [path, setPath] = useState('')
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [connection, setConnection] = useState<'unknown' | 'connected' | 'missing' | 'busy'>('unknown')

  useEffect(() => {
    if (!open) return
    setCopied(false)
    setNotice(null)
    setConnection('unknown')
    void window.pi.chromeBridgeInfo().then(setPath).catch(() => setPath(''))
  }, [open])

  const copyPath = async (): Promise<void> => {
    if (!path) return
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setNotice(t('复制失败，请手动选择上面的路径。'))
    }
  }

  const openExtensions = async (): Promise<void> => {
    try {
      await window.pi.openChromeExtensions()
      setNotice(t('已打开 Chrome 扩展页，请在那里完成安装。'))
    } catch {
      setNotice(t('无法打开 Chrome，请手动打开 chrome://extensions。'))
    }
  }

  const openFolder = async (): Promise<void> => {
    if (!path) return
    try {
      await window.pi.showItem(path)
      setNotice(t('已打开扩展目录。'))
    } catch {
      setNotice(t('无法打开扩展目录，请手动复制上面的路径。'))
    }
  }

  const checkConnection = async (): Promise<void> => {
    setChecking(true)
    setConnection('unknown')
    try {
      const result = await window.pi.chromeBridgeCheck()
      setConnection(result.busy ? 'busy' : result.connected ? 'connected' : 'missing')
    } catch {
      setConnection('missing')
    } finally {
      setChecking(false)
    }
  }

  return (
    <Modal
      open={open}
      title={t('启用日常 Chrome 登录态')}
      subtitle={t('只需安装一次扩展，之后 Pi 可以直接操作你当前登录的网页。')}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="button ghost" onClick={onClose}>
            {t('稍后再说')}
          </button>
          <button className="button ghost" onClick={() => void checkConnection()} disabled={checking}>
            <RefreshCw size={12} className={checking ? 'spin' : ''} />
            {t('检测连接')}
          </button>
          <button className="button primary" onClick={() => void openExtensions()}>
            <ExternalLink size={13} />
            {t('打开 Chrome 扩展页')}
          </button>
        </>
      }
    >
      <div className="chrome-bridge-benefits">
        <div>
          <Zap size={15} />
          <span>{t('直接使用你已登录的网站，不用重新登录。')}</span>
        </div>
        <div>
          <ShieldCheck size={15} />
          <span>{t('只操作当前标签页，密码框不会被读取。')}</span>
        </div>
        <div>
          <Check size={15} />
          <span>{t('点击、提交等敏感动作仍会先请求你的确认。')}</span>
        </div>
      </div>

      <ol className="chrome-bridge-steps">
        <li
          className="chrome-bridge-step clickable"
          role="button"
          tabIndex={0}
          onClick={() => void openExtensions()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') void openExtensions()
          }}
        >
          <div className="chrome-bridge-step-head">
            <strong>{t('打开扩展页')}</strong>
            <button
              className="button ghost"
              onClick={(event) => {
                event.stopPropagation()
                void openExtensions()
              }}
            >
              <ExternalLink size={12} />
              {t('打开')}
            </button>
          </div>
          <span>{t('点击这一行，或手动打开 chrome://extensions。')}</span>
        </li>
        <li
          className="chrome-bridge-step clickable"
          role="button"
          tabIndex={0}
          onClick={() => void openExtensions()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') void openExtensions()
          }}
        >
          <div className="chrome-bridge-step-head">
            <strong>{t('打开开发者模式')}</strong>
          </div>
          <span>{t('打开页面右上角的「开发者模式」开关。')}</span>
        </li>
        <li
          className="chrome-bridge-step clickable"
          role="button"
          tabIndex={0}
          onClick={() => void openFolder()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') void openFolder()
          }}
        >
          <div className="chrome-bridge-step-head">
            <strong>{t('加载已解压的扩展')}</strong>
            <button
              className="button ghost"
              onClick={(event) => {
                event.stopPropagation()
                void openFolder()
              }}
              disabled={!path}
            >
              <FolderOpen size={12} />
              {t('打开文件夹')}
            </button>
          </div>
          <span>{t('点击「加载已解压的扩展程序」，选择下面的目录。')}</span>
        </li>
      </ol>

      <div className="chrome-bridge-path clickable" role="button" tabIndex={0} onClick={() => void copyPath()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') void copyPath() }}>
        <code>{path || t('正在读取扩展目录…')}</code>
        <button className="button ghost" onClick={(event) => { event.stopPropagation(); void copyPath() }} disabled={!path}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t('已复制') : t('复制路径')}
        </button>
      </div>

      <div className="chrome-bridge-check">
        <button className="button ghost" onClick={() => void checkConnection()} disabled={checking}>
          <RefreshCw size={12} className={checking ? 'spin' : ''} />
          {checking ? t('检测中…') : t('检测连接')}
        </button>
        {connection === 'connected' && <span className="chrome-bridge-status ok">{t('已连接，可以开始使用')}</span>}
        {connection === 'missing' && <span className="chrome-bridge-status">{t('未检测到扩展')}</span>}
        {connection === 'busy' && <span className="chrome-bridge-status">{t('端口被占用，请关闭其他 Pi 任务后重试')}</span>}
      </div>

      <p className="chrome-bridge-note">
        {t('Chrome 不允许应用自动安装扩展，这一步需要你亲手确认一次。安装后，Pi 会优先使用当前 Chrome 标签页的登录态。')}
      </p>

      {notice && <div className="chrome-bridge-notice">{notice}</div>}
    </Modal>
  )
}
