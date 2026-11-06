import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, ShieldCheck, Zap } from 'lucide-react'
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

  useEffect(() => {
    if (!open) return
    setCopied(false)
    setNotice(null)
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
    } catch {
      setNotice(t('无法打开 Chrome，请手动打开 chrome://extensions。'))
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
        <li>
          <strong>{t('打开扩展页')}</strong>
          <span>{t('点击下方按钮，或手动打开 chrome://extensions。')}</span>
        </li>
        <li>
          <strong>{t('打开开发者模式')}</strong>
          <span>{t('打开页面右上角的「开发者模式」开关。')}</span>
        </li>
        <li>
          <strong>{t('加载已解压的扩展')}</strong>
          <span>{t('点击「加载已解压的扩展程序」，选择下面的目录。')}</span>
        </li>
      </ol>

      <div className="chrome-bridge-path">
        <code>{path || t('正在读取扩展目录…')}</code>
        <button className="button ghost" onClick={() => void copyPath()} disabled={!path}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t('已复制') : t('复制路径')}
        </button>
      </div>

      <p className="chrome-bridge-note">
        {t('Chrome 不允许应用自动安装扩展，这一步需要你亲手确认一次。安装后，Pi 会优先使用当前 Chrome 标签页的登录态。')}
      </p>

      {notice && <div className="chrome-bridge-notice">{notice}</div>}
    </Modal>
  )
}
