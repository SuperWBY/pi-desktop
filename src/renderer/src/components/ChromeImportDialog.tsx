import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Loader2 } from 'lucide-react'
import type { ChromeDomain, ChromeImportResult, ChromeProfile } from '@shared/types'
import { useTranslation } from '../i18n'
import { useApp } from '../store'
import { Modal } from './ui'

export function ChromeImportDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): ReactNode {
  const t = useTranslation()
  const { actions } = useApp()
  const [profiles, setProfiles] = useState<ChromeProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [domains, setDomains] = useState<ChromeDomain[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ChromeImportResult | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setResult(null)
    setSearch('')
    setSelected(new Set())
    setLoading(true)
    void window.pi
      .chromeProfiles()
      .then((value) => {
        setProfiles(value.profiles)
        setRunning(value.running)
        if (value.error) setError(value.error)
        const first = value.profiles[0]
        setProfileId((current) => current || first?.id || '')
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open || !profileId) return
    setLoading(true)
    setError(null)
    setSelected(new Set())
    void window.pi
      .chromePreview(profileId)
      .then((value) => {
        setDomains(value.domains)
        setRunning(value.running)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }, [open, profileId])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query ? domains.filter((item) => item.domain.includes(query)) : domains
  }, [domains, search])

  const toggle = (domain: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }

  const selectVisible = (): void => {
    setSelected((current) => {
      const next = new Set(current)
      const all = filtered.every((item) => next.has(item.domain))
      for (const item of filtered) {
        if (all) next.delete(item.domain)
        else next.add(item.domain)
      }
      return next
    })
  }

  const runImport = async (): Promise<void> => {
    if (!profileId || selected.size === 0 || importing || running) return
    setImporting(true)
    setError(null)
    setResult(null)
    try {
      const value = await window.pi.chromeImport(profileId, [...selected])
      setResult(value)
      if (value.error) setError(value.error)
      if (value.imported > 0) {
        actions.notify('success', t('已导入 Chrome 登录状态'), `${value.imported} Cookie`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setImporting(false)
    }
  }

  const refresh = (): void => {
    if (!profileId) return
    void window.pi.chromePreview(profileId).then((value) => {
      setRunning(value.running)
      setDomains(value.domains)
    })
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((item) => selected.has(item.domain))

  return (
    <Modal
      open={open}
      title={t('从 Chrome 导入登录状态')}
      subtitle={t('只导入 Cookie，不导入密码、Passkey 或扩展数据。')}
      onClose={() => (importing ? undefined : onClose())}
      width={580}
      footer={
        <>
          <button className="button ghost" onClick={onClose} disabled={importing}>
            {t('取消')}
          </button>
          <button
            className="button primary"
            onClick={() => void runImport()}
            disabled={selected.size === 0 || importing || running || !profileId}
          >
            {importing ? <Loader2 size={13} className="spin" /> : null}
            {importing ? t('导入中…') : t('导入所选站点')}
          </button>
        </>
      }
    >
      <div className="chrome-import-warning">
        {t('这会让 Pi Desktop 以你的身份访问所选站点。只导入你信任的站点，导入的数据仅保存在本机。')}
      </div>

      {profiles.length > 1 && (
        <label className="chrome-import-field">
          <span>{t('Chrome 配置文件')}</span>
          <select
            className="chrome-profile-select"
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
            disabled={importing}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}{profile.account ? ` · ${profile.account}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {running && (
        <div className="chrome-import-blocked">
          <span>{t('Google Chrome 正在运行。请退出 Chrome 后再导入。')}</span>
          <button className="settings-button" onClick={refresh}>{t('重新检查')}</button>
        </div>
      )}

      <div className="chrome-import-tools">
        <input
          className="chrome-search"
          value={search}
          placeholder={t('搜索站点…')}
          onChange={(event) => setSearch(event.target.value)}
          spellCheck={false}
        />
        <button className="settings-button" onClick={selectVisible} disabled={!filtered.length || importing}>
          {allVisibleSelected ? t('取消全选') : t('全选')}
        </button>
        <span className="chrome-selected-count">
          {t('已选')} {selected.size} {t('个站点')}
        </span>
      </div>

      {loading ? (
        <div className="chrome-loading">
          <Loader2 size={15} className="spin" />
          {t('正在读取 Chrome 配置…')}
        </div>
      ) : (
        <div className="chrome-domain-list">
          {filtered.map((item) => (
            <label className="chrome-domain-row" key={item.domain}>
              <input
                type="checkbox"
                checked={selected.has(item.domain)}
                onChange={() => toggle(item.domain)}
                disabled={importing}
              />
              <span className="chrome-domain-name">{item.domain}</span>
              <span className="chrome-domain-count">{item.count}</span>
            </label>
          ))}
          {!filtered.length && <div className="chrome-empty">{t('没有匹配的站点。')}</div>}
        </div>
      )}

      {error && <div className="chrome-import-error">{error}</div>}
      {result && !result.error && (
        <div className="chrome-import-result">
          <Check size={14} />
          <span>
            {t('已导入')} {result.imported} {t('个 Cookie；跳过')} {result.skipped} {t('个；失败')} {result.failed} {t('个。')}
          </span>
        </div>
      )}
      {result?.errors.length ? (
        <div className="chrome-import-errors">
          {result.errors.map((item) => (
            <div key={`${item.domain}-${item.reason}`}>{item.domain}: {item.reason}</div>
          ))}
        </div>
      ) : null}
    </Modal>
  )
}