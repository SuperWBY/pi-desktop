import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Check, Copy, ExternalLink, FolderOpen, MousePointer2, RefreshCw, ShieldCheck, Zap } from 'lucide-react'
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
  const [connection, setConnection] = useState<'unknown' | 'connected' | 'outdated' | 'version-unknown' | 'missing' | 'busy'>('unknown')

  useEffect(() => {
    if (!open) return
    setCopied(false)
    setNotice(null)
    setConnection('unknown')
    void window.pi.chromeBridgeInfo().then(setPath).catch(() => setPath(''))
    let active = true
    setChecking(true)
    void window.pi.chromeBridgeCheck().then((result) => {
      if (!active) return
      setConnection(result.busy ? 'busy' : !result.connected ? 'missing' : result.versionStatus === 'current' ? 'connected' : result.versionStatus === 'outdated' ? 'outdated' : 'version-unknown')
    }).catch(() => { if (active) setConnection('missing') }).finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [open])

  const copyPath = async (): Promise<void> => {
    if (!path) return
    try {
      await window.pi.chromeBridgeCopyPath()
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setNotice(t('复制失败，请手动选择上面的路径。'))
    }
  }

  const openExtensions = async (): Promise<void> => {
    try {
      await window.pi.openChromeExtensions()
      setNotice(t(connection === 'outdated' || connection === 'version-unknown' ? '已打开 Chrome 扩展页，请刷新已安装的扩展。' : '已打开 Chrome 扩展页，请在那里完成安装。'))
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
      setConnection(result.busy ? 'busy' : !result.connected ? 'missing' : result.versionStatus === 'current' ? 'connected' : result.versionStatus === 'outdated' ? 'outdated' : 'version-unknown')
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
            {checking ? t('检测中…') : t('检测连接')}
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
          <span>{t('扩展可读取和操作当前标签页，请只在信任的网站使用。')}</span>
        </div>
        <div>
          <Check size={15} />
          <span>{t('操作是否需要确认取决于 Computer Use 的审批设置。')}</span>
        </div>
      </div>

      <div className="chrome-bridge-check" role="status" aria-live="polite">
        {connection === 'connected' && <span className="chrome-bridge-status">{t('已连接并验证本机配对。')}</span>}
        {connection === 'outdated' && <span className="chrome-bridge-status">{t('Chrome 正在使用旧版扩展。请打开扩展页，找到 Pi Desktop Chrome Bridge，点击卡片上的刷新按钮，然后重新检测。')}</span>}
        {connection === 'version-unknown' && <span className="chrome-bridge-status">{t('已连接，但无法确认扩展版本。请在 Chrome 扩展页刷新 Pi Desktop Chrome Bridge，然后重新检测。')}</span>}
        {connection === 'missing' && <span className="chrome-bridge-status">{t('未收到扩展响应。请确认扩展已启用；如刚更新，请在 Chrome 扩展页重新加载，然后点击扩展图标并重试。')}</span>}
        {connection === 'busy' && <span className="chrome-bridge-status">{t('端口被占用，请关闭其他 Pi 任务后重试')}</span>}
      </div>

      {connection !== 'outdated' && connection !== 'version-unknown' && <>
      <div className="chrome-guide-start">
        <span className="chrome-guide-number">1</span>
        <div><strong>{t('打开 Chrome 扩展页')}</strong><p>{t('在 Chrome 右上角打开「开发者模式」。')}</p></div>
        <button className="button ghost" onClick={() => void openExtensions()}><ExternalLink size={13} />{t('打开')}</button>
      </div>
      <div className="chrome-guide-step-title"><span className="chrome-guide-number">2</span><strong>{t('把扩展拖到 Chrome 页面')}</strong></div>
      <p className="chrome-guide-hint">{t('将 Pi Desktop 和 Chrome 并排放置，按住下方文件夹，拖到 Chrome 扩展页的空白处后松开。')}</p>
      <div className="chrome-drag-demo" aria-hidden="true">
        <div className="chrome-demo-source"><span>Pi Desktop</span><div className="chrome-demo-folder"><FolderOpen size={18} /><MousePointer2 size={15} className="chrome-demo-cursor" /></div></div>
        <ArrowRight className="chrome-demo-arrow" size={20} />
        <div className="chrome-demo-target"><div className="chrome-demo-bar"><i /><i /><i /><span>chrome://extensions</span></div><div className="chrome-demo-drop">{t('拖到页面空白处')}</div></div>
      </div>
      <div
        className="chrome-bridge-drag"
        data-chrome-bridge-drag
        draggable={Boolean(path)}
        onDragStart={(event) => {
          event.preventDefault()
          if (path) window.pi.chromeBridgeDrag()
        }}
      >
        <FolderOpen size={25} />
        <div><strong>{t('按住这里拖动')}</strong><span>{t('Pi Desktop 扩展文件夹')}</span></div>
        <span className="chrome-drag-grip" aria-hidden="true">⠿</span>
      </div>
      <details className="chrome-bridge-advanced">
        <summary>{t('拖不动？试试其他方式')}</summary>
        <p className="chrome-bridge-note">{t('也可在 Chrome 点击「加载未打包的扩展程序」，选择 Finder 中显示的文件夹。')}</p>
        <button className="button ghost chrome-bridge-fallback" onClick={() => void openFolder()} disabled={!path}>
          <FolderOpen size={12} />{t('在 Finder 中显示文件夹')}
        </button>
        <div className="chrome-bridge-path">
          <code>{path || t('正在读取扩展目录…')}</code>
          <button className="button ghost" onClick={() => void copyPath()} disabled={!path}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? t('已复制') : t('复制路径')}
          </button>
        </div>
      </details>

      </>}



      {connection !== 'outdated' && connection !== 'version-unknown' && <>
        <p className="chrome-bridge-note">
          {t('这是内测安装方式，需要你手动加载扩展。使用扩展桥时，Pi 可以操作当前 Chrome 标签页。')}
        </p>
        <p className="chrome-bridge-note">{t('如果之前安装过扩展，更新后请在 Chrome 扩展页点击重新加载。')}</p>
      </>}

      {notice && <div className="chrome-bridge-notice">{notice}</div>}
    </Modal>
  )
}
