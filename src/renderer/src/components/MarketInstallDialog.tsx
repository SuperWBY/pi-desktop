import { useState, type ReactNode } from 'react'
import { Check, Download, LoaderCircle } from 'lucide-react'
import { packageError } from '../lib/market-copy'
import { useTranslation } from '../i18n'
import { MarketDialog } from './MarketDialog'
import { packageSource } from '../lib/package-source'
import { operatePackage, usePackageOperations } from '../lib/package-operations'

export function MarketInstallDialog({ cwd, onClose }: { cwd: string; onClose: () => void }): ReactNode {
  const t = useTranslation()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const operations = usePackageOperations()
  const parsed = packageSource(value)
  const operation = parsed ? operations[parsed.name] : undefined
  const busy = operation?.status === 'busy'
  const done = (submitted && !busy && operation?.status !== 'error')
  const install = (): void => {
    if (busy || done) return
    if (!parsed) { setError(t('请输入 npm 插件名称、npm 页面或 GitHub 仓库链接。')); return }
    setError(''); setSubmitted(true)
    operatePackage(parsed.name, 'install', parsed.source, cwd, { resolveNpm: parsed.npm, version: parsed.version })
  }

  return <MarketDialog title={t("从链接安装")} onClose={onClose}>{(close, run) => <form onSubmit={(event) => { event.preventDefault(); run(install) }}>
    <label className="market-source-label">{t("插件名称或链接")}<input value={value} disabled={busy || done} onChange={(event) => { setValue(event.target.value); setError(''); setSubmitted(false) }} placeholder={t("npm 插件名称、npm 页面或 GitHub 仓库链接")} /></label>
    <p className="market-note">{t("支持 npm 发布的 Pi 插件和 GitHub 仓库。")}</p>
    {(error || operation?.status === 'error') && <p className="market-error" role="alert">{packageError(t, error || operation?.error)}</p>}
    {busy && <div className="market-indeterminate" role="progressbar" aria-label={t("正在安装插件")}><span /></div>}
    {submitted && !busy && <p role="status" className="market-note">{operation?.status === 'error' ? t('安装未完成，请重试。') : t('安装完成，新会话会加载此插件。')}</p>}
    <div className="market-modal-actions"><button type="button" onClick={close}>{done ? t('完成') : busy ? t('后台继续') : t('取消')}</button><button className="market-install-button" type="submit" disabled={busy || done} aria-busy={busy}>{busy ? <LoaderCircle size={15} className="market-spin" /> : done ? <Check size={15} /> : <Download size={15} />}{busy ? t('正在安装') : done ? t('已安装') : operation?.status === 'error' ? t('重试安装') : t('安装')}</button></div>
  </form>}</MarketDialog>
}
