import { CREATOR_COMMAND } from '@shared/creator'
import { MyPlugins } from './MyPlugins'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowUpRight, Check, Download, GitFork, Link, LoaderCircle, Package, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react'
import type { PackageCatalogEntry, PackageDetails, PackageEntry } from '@shared/types'
import { useApp } from '../store'
import { usePackageOperations, operatePackage, confirmPackageOperations, packageOperationSnapshot, retryPackage } from '../lib/package-operations'
import { TranslatedPackageReadme } from './TranslatedPackageReadme'
import { usePackageTranslation } from '../lib/use-package-translation'
import { useNavigationHistory } from '../lib/use-navigation-history'
import { MarketRemoveDialog } from './MarketRemoveDialog'
import { MarketInstallDialog } from './MarketInstallDialog'
import { PackageArtwork } from './PackageArtwork'
import { MarketSelect } from './MarketSelect'
import { packageError } from '../lib/market-copy'
import { useTranslation } from '../i18n'
import './plugin-market.css'

const resourceLabels = { extensions: '扩展', skills: '技能', prompts: '提示词', themes: '主题' }
function date(value: string | null): string { return value ? new Date(value).toLocaleDateString('zh-CN').replaceAll('/', '-') : '—' }
function bytes(value: number | null): string { return value === null ? '—' : value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${(value / 1024).toFixed(1)} KB` }
const artwork = new Map<string, Promise<PackageDetails | null>>()
function catalogMetadata(entry: PackageCatalogEntry): Promise<PackageDetails | null> {
  const key = `${entry.name}@${entry.version}`
  let pending = artwork.get(key)
  if (!pending) {
    pending = window.pi.getPackageDetails({ name: entry.name, version: entry.version, metadataOnly: true })
      .then((result) => result.ok ? result.details : null).catch(() => null)
    if (artwork.size >= 128) artwork.delete(artwork.keys().next().value!)
    artwork.set(key, pending)
    void pending.then((value) => { if (!value) artwork.delete(key) })
  }
  return pending
}
function CatalogPreview({ entry, onMetadata }: { entry: PackageCatalogEntry; onMetadata: (entry: PackageCatalogEntry, details: PackageDetails) => void }): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const observer = new IntersectionObserver(([item]) => {
      if (!item.isIntersecting) return
      observer.disconnect()
      void catalogMetadata(entry).then((details) => { if (active && details) { setSrc(details.manifest.image); onMetadata(entry, details) } })
    })
    if (root.current) observer.observe(root.current)
    return () => { active = false; observer.disconnect() }
  }, [entry.name, entry.version, onMetadata])
  return <div ref={root}><PackageArtwork src={src} name={entry.name} /></div>
}
export function PluginMarketPage(): ReactNode {
  const { state, actions } = useApp()
  const t = useTranslation()
  const format = (text: string, values: Record<string, string | number>): string => Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), t(text))
  const resourceNames = Object.fromEntries(Object.entries(resourceLabels).map(([key, value]) => [key, t(value)])) as typeof resourceLabels
  const cwd = state.workspace ?? ''
  const tab = state.pluginMarketTab
  const setTab = actions.setPluginMarketTab
  const [entries, setEntries] = useState<PackageCatalogEntry[]>([])
  const [packages, setPackages] = useState<PackageEntry[]>([])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [composing, setComposing] = useState(false)
  const [sort, setSort] = useState('name')
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const [metadata, setMetadata] = useState<Record<string, PackageDetails>>({})
  const [typeLoading, setTypeLoading] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const recordMetadata = useCallback((entry: PackageCatalogEntry, details: PackageDetails) => {
    const key = `${entry.name}@${entry.version}`
    setMetadata((current) => current[key] === details ? current : { ...current, [key]: details })
  }, [])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [installedError, setInstalledError] = useState('')
  const [installedLoading, setInstalledLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [selection, setSelection] = useState<{ name: string; version?: string } | null>(null)
  const [returning, setReturning] = useState(false)
  const [gestureEntry, setGestureEntry] = useState(false)
  const returningNow = useRef(false)
  const content = useRef<HTMLDivElement>(null)
  const restoreTabFocus = useRef(false)
  useLayoutEffect(() => {
    if (!restoreTabFocus.current) return
    restoreTabFocus.current = false
    content.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus()
  }, [tab])
  const [details, setDetails] = useState<PackageDetails | null>(null)
  const [detailError, setDetailError] = useState('')
  const [readmeBusy, setReadmeBusy] = useState(false)
  const [readmeLocaleBusy, setReadmeLocaleBusy] = useState(false)
  const [remove, setRemove] = useState<PackageEntry | null>(null)
  const operations = usePackageOperations()
  const scroll = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const catalogPosition = useRef(0)
  const returnCard = useRef('')
  const installedRequest = useRef(0)
  const returnToCatalog = useCallback(() => {
    if (returningNow.current) return
    setGestureEntry(false)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setSelection(null); return }
    returningNow.current = true
    if (content.current) content.current.inert = true
    setReturning(true)
  }, [])
  useEffect(() => {
    if (!returning) return
    const duration = parseFloat(getComputedStyle(content.current!).getPropertyValue('--motion-2')) || 160
    const timer = window.setTimeout(() => {
      returningNow.current = false
      setReturning(false)
      setSelection(null)
    }, duration)
    return () => clearTimeout(timer)
  }, [returning])
  const refreshInstalled = useCallback(async () => {
    const request = ++installedRequest.current
    const observed = packageOperationSnapshot()
    setInstalledLoading(true)
    try {
      const next = await window.pi.listPackages(cwd)
      if (request !== installedRequest.current) return
      setPackages(next); setInstalledError(''); confirmPackageOperations(observed)
    } catch { if (request === installedRequest.current) setInstalledError(t('读取已安装插件失败。')) }
    finally { if (request === installedRequest.current) setInstalledLoading(false) }
  }, [cwd])
  useEffect(() => { void refreshInstalled() }, [refreshInstalled, operations])
  useEffect(() => {
    if (composing || query.trim() === search) return
    const timer = window.setTimeout(() => setSearch(query.trim()), query.trim() ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [query, search, composing])
  useEffect(() => {
    if (tab !== 'discover') return
    let active = true
    setBusy(true); setError('')
    void window.pi.searchPackageCatalog(search).then((result) => {
      if (!active) return
      setEntries(result.entries); setError(result.error ?? '')
    }).catch(() => { if (active) { setEntries([]); setError(t('暂时无法连接插件目录，请检查网络后重试。')) } })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [search, retry, tab])
  useEffect(() => {
    if (!selection) { setDetails(null); return }
    let active = true
    setDetailError(''); setReadmeBusy(true); setReadmeLocaleBusy(true)
    void (async () => {
      try {
        const info = await window.pi.getPackageDetails({ ...selection, metadataOnly: true })
        if (!active) return
        if (!info.ok) { setDetailError(info.error); return }
        const listed = entries.find((entry) => entry.name === info.details.name && entry.version === info.details.version)
        const publishedAt = info.details.publishedAt ?? listed?.publishedAt ?? null
        setDetails({ ...info.details, publishedAt })
        const full = await window.pi.getPackageDetails({ ...selection, fast: true })
        if (!active) return
        if (full.ok) setDetails({ ...full.details, publishedAt })
        setReadmeBusy(false)
        const localized = await window.pi.getPackageDetails({ ...selection, fast: true, language: state.settings.language ?? 'zh-CN' })
        if (active && localized.ok) setDetails({ ...localized.details, publishedAt })
      } catch { if (active) setDetailError(t('读取插件详情失败，请重试。')) }
      finally { if (active) { setReadmeBusy(false); setReadmeLocaleBusy(false) } }
    })()
    return () => { active = false }
  }, [selection, retry, state.settings.language])
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = selection ? 0 : catalogPosition.current
    if (selection) back.current?.focus()
    else if (returnCard.current) {
      document.getElementById(returnCard.current)?.focus({ preventScroll: true })
      returnCard.current = ''
    }
  }, [selection])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!state.skillsOpen || event.defaultPrevented || event.key !== 'Escape' || remove || installOpen) return
      event.preventDefault()
      if (returningNow.current) return
      if (selection) returnToCatalog()
      else actions.openSkills(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, state.skillsOpen, selection, remove, installOpen, returnToCatalog])
  useEffect(() => { setPage(1) }, [search, sort, type])
  useEffect(() => {
    if (type === 'all') { setTypeLoading(false); return }
    let active = true
    let cursor = 0
    setTypeLoading(true)
    const worker = async (): Promise<void> => {
      while (active && cursor < entries.length) {
        const entry = entries[cursor++]
        const details = await catalogMetadata(entry)
        if (active && details) recordMetadata(entry, details)
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker)).then(() => { if (active) setTypeLoading(false) })
    return () => { active = false }
  }, [entries, type, recordMetadata])
  const installed = (name: string): boolean => {
    const operation = operations[name]
    if (operation?.status === 'done' && operation.kind !== 'remove') return true
    return packages.some((item) => item.name === name)
  }
  const installButton = (name: string, source: string): ReactNode => {
    const operation = operations[name]
    const working = operation?.status === 'busy'
    const isInstalled = installed(name)
    const failed = operation?.status === 'error'
    return <div className="market-install" data-status={working ? 'busy' : failed ? 'error' : isInstalled ? 'done' : 'ready'}>
      <button className="market-install-button" disabled={working || isInstalled} aria-busy={working}
        onClick={() => operatePackage(name, 'install', source, cwd)}>
        <span key={working ? 'busy' : isInstalled ? 'done' : 'ready'} className="market-button-content">
          {working ? <LoaderCircle className="market-spin" size={17} /> : isInstalled ? <Check size={17} /> : <Download size={17} />}
          {working ? ({ install: t('正在安装'), remove: t('正在卸载'), update: t('正在更新') }[operation.kind]) : isInstalled ? t('已安装') : failed ? t('重试安装') : t('安装')}
        </span>
      </button>
      {working && <div className="market-indeterminate" role="progressbar" aria-label={t("正在安装插件")}><span /></div>}
      <span className="market-install-status" role="status">{working ? t('正在处理，请稍候…') : failed ? t('操作失败，请重试') : isInstalled ? t('新会话会加载此插件') : t('安装后可在 Pi 中使用')}</span>
    </div>
  }
  const searchPending = composing || query.trim() !== search
  const catalogBusy = busy || searchPending
  const sorted = useMemo(() => [...entries].sort((a, b) => sort === 'recent' ? (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') : a.name.localeCompare(b.name)), [entries, sort])
  const filtered = sorted.filter((entry) => type === 'all' || (metadata[`${entry.name}@${entry.version}`]?.manifest[type as keyof typeof resourceNames]?.length ?? 0) > 0)
  const unknownTypes = type === 'all' ? 0 : entries.filter((entry) => !metadata[`${entry.name}@${entry.version}`]).length
  const pageCount = Math.max(1, Math.ceil(filtered.length / 12))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * 12, currentPage * 12)
  const descriptions = usePackageTranslation(selection ? [details?.description ?? ''] : tab === 'installed' ? packages.map((entry) => entry.description ?? '') : visible.map((entry) => entry.description), false, Boolean(selection) || tab !== 'mine')
  const recent = useMemo(() => [...entries].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).slice(0, 3), [entries])
  const open = (name: string, version?: string, focusId = `market-${name}`, gesture = false): void => {
    catalogPosition.current = scroll.current?.scrollTop ?? 0
    returnCard.current = focusId
    setGestureEntry(gesture)
    setReadmeBusy(true); setDetails(metadata[`${name}@${version}`] ?? null); setSelection({ name, version })
  }
  useNavigationHistory({ value: { selection, tab, focus: returnCard.current }, key: selection ? `${tab}:${selection.name}@${selection.version}` : `list:${tab}`,
    isParent: (key) => key.startsWith('list:'),
    enabled: state.skillsOpen && state.skillsSection === 'plugins', busy: returning || installOpen || Boolean(remove),
    restore: (next, trigger) => {
      setTab(next.tab)
      if (next.selection) open(next.selection.name, next.selection.version, next.focus || undefined, trigger === 'gesture')
      else if (selection) {
        if (trigger === 'gesture') { setGestureEntry(true); setSelection(null) }
        else returnToCatalog()
      }
    } })
  const link = (url: string | null, label: string, icon: ReactNode): ReactNode => url && /^https?:\/\//i.test(url) ? <a href={url} onClick={(event) => { event.preventDefault(); actions.openExternal(url) }}>{icon}{t(label)}</a> : null
  return <section className="skills-page plugin-market-page" role="dialog" aria-modal="false" aria-label={t("Pi 插件")}>
    <div className="market-scroll" ref={scroll}>
      <div className="market-content" key={selection?.name ?? tab} ref={content}
        data-view={selection ? 'detail' : 'catalog'} data-returning={returning} data-gesture-entry={gestureEntry} inert={returning}>
        {!installOpen && Object.entries(operations).filter(([name, job]) => selection?.name !== name && (job.status === 'error' || (job.resolveNpm && job.status === 'busy'))).map(([name, job]) => <div className="market-job" key={name} role={job.status === 'error' ? 'alert' : 'status'}><span>{name} · {job.status === 'busy' ? t('正在安装…') : packageError(t, job.error)}</span>{job.status === 'error' && <button onClick={() => retryPackage(name)}>{t("重试")}</button>}</div>)}

        {selection ? <>
          <button className="market-back" ref={back} onClick={returnToCatalog}><ArrowLeft size={18} aria-hidden="true" /><span>{t("所有插件")}</span></button>
          <h1>{selection.name}</h1>
          {detailError && !details ? <div className="market-empty" role="alert"><p>{packageError(t, detailError)}</p><button onClick={() => setRetry((value) => value + 1)}>{t("重新加载")}</button></div> : !details ? <div className="market-detail-loading" role="status"><LoaderCircle size={20} className="market-spin" />{t("正在读取插件详情…")}<div className="market-skeleton" /><div className="market-skeleton" /></div> : <>
            <p className="market-description">{descriptions.texts[0] || t('此插件暂未提供介绍。')}</p>
            <nav className="market-links" aria-label={t("插件相关链接")}>{link(details.npmUrl, 'npm', <Package size={16} />)}{link(details.repositoryUrl, 'GitHub', <GitFork size={16} />)}{link(details.catalogUrl, t('官网详情'), <ArrowUpRight size={16} />)}</nav>
            <section className="market-info" aria-label={t("插件信息")}><h2>{t("插件信息")}</h2><div className="market-info-body">
              <PackageArtwork src={details.manifest.image} name={details.name} />
              <dl>{[
                [t('版本'), details.version], [t('作者'), details.author ?? details.publisher ?? '—'], [t('许可证'), details.license ?? '—'], [t('发布于'), date(details.publishedAt)],
                [t('类型'), Object.entries(resourceNames).filter(([key]) => details.manifest[key as keyof typeof resourceNames].length).map(([, value]) => value).join(' · ') || t('Pi 插件')],
                [t('大小'), bytes(details.unpackedSize)], [t('依赖'), format('{count} 个依赖 · {peer} 个 peer', { count: Object.keys(details.dependencies).length, peer: Object.keys(details.peerDependencies).length })]
              ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              {installButton(details.name, details.installSource)}
            </div></section>
            {operations[details.name]?.status === 'error' && <p className="market-error" role="alert">{packageError(t, operations[details.name].error)}</p>}
            <div className="market-readme-title"><h2>README</h2><span>{format('发布版本 {version}', { version: details.version })}</span></div>
            {readmeBusy || (readmeLocaleBusy && !details.readme) ? <p className="market-note" role="status"><LoaderCircle size={14} className="market-spin" />{t("正在读取说明文档…")}</p> : details.readme ? <>{!details.readme.versionMatched && <p className="market-note">{t("此说明来自仓库，内容可能与当前发布版本不同。")}</p>}<TranslatedPackageReadme key={`${state.settings.language}:${details.readme.url}`} readme={details.readme} localeBusy={readmeLocaleBusy} /></> : <p className="market-empty">{t('暂时无法读取说明文档，可稍后重试或查看来源。')}{link(details.repositoryUrl, t('前往 GitHub 查看'), <ArrowUpRight size={14} />)}</p>}
          </>}
        </> : <>
          <button className="market-back market-catalog-back" onClick={() => actions.openSkills(false)}><ArrowLeft size={18} aria-hidden="true" /><span>{t("返回")}</span></button>
          <div className="market-heading"><div><h1>{t("Pi 插件")}</h1><p>{t("发现社区为 Pi 构建的扩展、技能、提示词与主题。")}</p></div><div className="market-heading-actions">{state.commands.some(command=>command.name===CREATOR_COMMAND)&&<button className="market-link-install" disabled={state.streaming||state.creatorBusy} onClick={()=>void actions.beginCreator()}><Sparkles size={15}/>{t('创建插件')}</button>}<button className="market-link-install" onClick={() => setInstallOpen(true)}><Link size={15} />{t("从链接安装")}</button></div></div>
          <div className="market-tabs" role="tablist" aria-label={t("插件目录")}>{([['discover', t('发现插件')], ['installed', t('已安装')], ['mine', t('我的插件')]] as const).map(([id, title]) => <button key={id} role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const tabs = ['discover', 'installed', 'mine'] as const
            const index = tabs.indexOf(tab)
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
            restoreTabFocus.current = true
            setTab(tabs[nextIndex])
            if (tabs[nextIndex] === tab) event.currentTarget.focus()
          }}>{title}{id === 'installed' && <span>{packages.length}</span>}</button>)}</div>
          {tab === 'mine' ? <MyPlugins onInstalled={refreshInstalled} /> : tab === 'discover' ? <>
            {!query.trim() && !catalogBusy && recent.length > 0 && <section className="market-recent"><h2>{t("最近发布")}</h2><div>{recent.map((entry) => <button key={entry.name} onClick={() => open(entry.name, entry.version)}><Package size={18} /><strong>{entry.name}</strong><span>{date(entry.publishedAt)}</span><ArrowUpRight size={14} /></button>)}</div></section>}
            {!catalogBusy && descriptions.busy && <p className="market-note" role="status">{t("正在翻译简介…")}</p>}
            {!catalogBusy && descriptions.failed && <p className="market-note">{t("简介翻译暂不可用，已显示原文。")}<button className="market-text-button" onClick={descriptions.retry}>{t("重试翻译")}</button></p>}
            <div className="market-section-heading"><h2>{t("全部插件")}</h2><span>{catalogBusy ? t('正在读取…') : type === 'all' ? format('已载入 {count} 个', { count: entries.length }) : format('{matches} 个匹配 · 已载入 {count} 个', { matches: filtered.length, count: entries.length })}</span></div>
            <form className="market-filters" onSubmit={(event) => { event.preventDefault(); if (composing) return; setSearch(query.trim()); if (query.trim() === search) setRetry((value) => value + 1) }}>
              <label className="market-search"><Search size={17} /><input aria-label={t("搜索插件")} value={query} onChange={(event) => setQuery(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={(event) => { setQuery(event.currentTarget.value); setComposing(false) }} placeholder={t("搜索插件名称、功能或作者…")} /><button type="submit">{t("搜索")}</button></label>
              <MarketSelect label={t('插件类型')} value={type} onChange={setType} options={[{ value: 'all', label: t('全部类型') }, ...Object.entries(resourceNames).map(([value, label]) => ({ value, label: t(label) }))]} />
              <MarketSelect label={t('插件排序')} value={sort} onChange={setSort} options={[{ value: 'name', label: t('名称排序') }, { value: 'recent', label: t('最近发布') }]} />
            </form>
            {catalogBusy ? <div className="market-grid" aria-busy="true" aria-label={t("正在加载插件")}>{[0, 1, 2, 3].map((value) => <div key={value} className="market-skeleton" />)}</div> : error && !entries.length ? <div className="market-empty" role="status"><Package size={28} /><p>{packageError(t, error)}</p><button onClick={() => setRetry((value) => value + 1)}>{t("重新加载")}</button></div> : <div className="market-grid">{visible.map((entry, index) => <article key={entry.name} className="market-card">
              <div className="market-card-main"><CatalogPreview entry={entry} onMetadata={recordMetadata} /><div><button id={`market-${entry.name}`} className="market-card-title market-card-open" onClick={() => open(entry.name, entry.version)}>{entry.name}<ArrowUpRight size={15} /></button><p>{descriptions.texts[index] || t('此插件暂未提供介绍。')}</p><span className="market-card-author">{entry.publisher ?? t('社区作者')} · v{entry.version}</span><div className="market-card-types">{Object.entries(resourceNames).filter(([key]) => (metadata[`${entry.name}@${entry.version}`]?.manifest[key as keyof typeof resourceNames]?.length ?? 0) > 0).map(([key, label]) => <span key={key}>{label}</span>)}</div><div className="market-links">{link(entry.npmUrl, 'npm', <Package size={13} />)}{link(entry.repositoryUrl, 'GitHub', <GitFork size={13} />)}</div></div></div>
              <div className="market-card-footer"><button onClick={() => open(entry.name, entry.version)}>{t("查看详情")}</button>{installButton(entry.name, `npm:${entry.name}@${entry.version}`)}</div>
            </article>)}</div>}
            {!catalogBusy && typeLoading && <p className="market-note" role="status">{t("正在读取插件声明的类型…")}</p>}
            {!catalogBusy && !typeLoading && unknownTypes > 0 && <p className="market-note" role="status">{format('有 {count} 个插件暂未读到类型。', { count: unknownTypes })}<button className="market-text-button" onClick={() => setRetry((value) => value + 1)}>{t("重试读取")}</button></p>}
            {!catalogBusy && !error && !typeLoading && filtered.length === 0 && <div className="market-empty" role="status"><Search size={28} /><p>{unknownTypes ? t('已读取的插件中没有匹配项。') : t('没有找到匹配的插件，换个关键词或类型试试。')}</p></div>}
            {!catalogBusy && filtered.length > 0 && <nav className="market-pagination" aria-label={t("目录分页")}><button disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1); scroll.current?.scrollTo({ top: 0 }) }}>{t("上一页")}</button>{Array.from({ length: pageCount }, (_, index) => <button key={index} aria-current={currentPage === index + 1 ? 'page' : undefined} onClick={() => { setPage(index + 1); scroll.current?.scrollTo({ top: 0 }) }}>{index + 1}</button>)}<button disabled={currentPage === pageCount} onClick={() => { setPage(currentPage + 1); scroll.current?.scrollTo({ top: 0 }) }}>{t("下一页")}</button></nav>}
            {!catalogBusy && entries.length > 0 && <div className="market-footer"><p className="market-directory-note">{t("目录来自 npm 社区索引。搜索可查找更多 Pi 插件。")}</p>{link('https://pi.dev/packages', t('在 pi.dev 查看'), <ArrowUpRight size={13} />)}</div>}
          </> : <>
            <div className="market-section-heading"><h2>{t("已安装插件")}</h2><button className="market-text-button" onClick={() => void refreshInstalled()}><RefreshCw size={14} />{t("刷新")}</button></div>
            {installedError && <p className="market-error" role="alert">{packageError(t, installedError)}</p>}
            {!packages.length && !installedError && (installedLoading ? <div className="market-empty" role="status"><LoaderCircle size={24} className="market-spin" /><p>{t("正在读取已安装插件…")}</p></div> : <div className="market-empty"><Package size={32} /><p>{t("还没有安装插件")}</p><button onClick={() => setTab('discover')}>{t("发现插件")}</button></div>)}
            <div className="market-installed">{packages.map((entry, index) => <article key={`${entry.scope}:${entry.source}`}><Package size={22} /><div><button id={`market-${entry.scope}-${entry.name}`} disabled={!entry.source.startsWith('npm:')} className="market-card-title" onClick={() => open(entry.name, entry.version, `market-${entry.scope}-${entry.name}`)}>{entry.name}</button><p>{descriptions.texts[index] || t('Pi 插件')}</p>{entry.version && <small>v{entry.version}</small>}<span role="status">{operations[entry.name]?.status === 'busy' ? t('正在处理…') : operations[entry.name]?.status === 'error' ? t('操作失败，请重试') : t('已安装')}</span></div>{entry.scope === 'user' && <div className="market-manage"><button disabled={operations[entry.name]?.status === 'busy'} onClick={() => operatePackage(entry.name, 'update', entry.source, cwd)}><RefreshCw size={15} className={operations[entry.name]?.status === 'busy' ? 'market-spin' : ''} />{t("更新")}</button><button aria-label={format('卸载 {name}', { name: entry.name })} disabled={operations[entry.name]?.status === 'busy'} onClick={() => setRemove(entry)}><Trash2 size={15} /></button></div>}</article>)}</div>
          </>}
        </>}
      </div>
    </div>
    {installOpen && <MarketInstallDialog cwd={cwd} onClose={() => setInstallOpen(false)} />}
    {remove && <MarketRemoveDialog entry={remove} onClose={() => setRemove(null)} onConfirm={() => operatePackage(remove.name, 'remove', remove.source, cwd)} />}
  </section>
}
