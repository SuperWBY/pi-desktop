import { useEffect, useState } from 'react'
import { FileText, Files, FolderTree, Globe2, Search, SquareTerminal } from 'lucide-react'
import { useApp } from '../../store'
import { useTranslation } from '../../i18n'
import { ArtifactsTab } from './ArtifactsTab'

const shortcuts = [
  { id: 'terminal', label: '终端', icon: SquareTerminal },
  { id: 'browser', label: '网页', icon: Globe2 },
  { id: 'changes', label: '变更', icon: Files },
  { id: 'files', label: '文件', icon: FolderTree }
] as const

export function WorkHome({ openTab, openFile }: {
  openTab: (tab: typeof shortcuts[number]['id'] | 'artifacts') => void
  openFile: (path: string) => void
}) {
  const { state, actions } = useApp()
  const t = useTranslation()
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<string[]>([])
  const value = query.trim()
  const isUrl = /^(https?:\/\/|localhost(?=[:/]|$)|[\w-]+(?:\.[\w-]+)+(?:[:/]|$))/i.test(value)
  const root = state.workspace
  useEffect(() => {
    let current = true
    setMatches([])
    if (!root || !value) return
    const timer = setTimeout(() => {
      void window.pi.listWorkspaceFiles(root, value).then(result => { if (current) setMatches(result.slice(0, 6)) }).catch(() => {})
    }, 120)
    return () => { current = false; clearTimeout(timer) }
  }, [value, root])
  const openMatch = (path: string) => { if (root) openFile(root.replace(/[\\/]$/, '') + '/' + path) }
  const go = () => {
    if (matches.length && !/^https?:\/\//i.test(value)) openMatch(matches[0])
    else if (isUrl) actions.openBrowser(/^https?:\/\//i.test(value) ? value : 'https://' + value)
  }
  return <div className="work-home">
    <form onSubmit={e => { e.preventDefault(); go() }} className="work-home-search"><Search size={16}/>
      <input aria-label={t('搜索文件或输入网址')} placeholder={t('搜索文件或输入网址')} value={query} onChange={e => setQuery(e.target.value)} />
    </form>
    {value && <div className="work-home-results">
      {matches.map(path => <button key={path} onClick={() => openMatch(path)}><FileText size={14}/>{path}</button>)}
      {isUrl && <button onClick={() => actions.openBrowser(/^https?:\/\//i.test(value) ? value : 'https://' + value)}><Globe2 size={14}/>{t('打开网址')} · {value}</button>}
      {!isUrl && !matches.length && <span>{t('没有匹配的文件')}</span>}
    </div>}
    <div className="work-home-shortcuts">{shortcuts.map(({id, label, icon: Icon}) =>
      <button key={id} onClick={() => openTab(id)}><Icon size={19}/>{t(label)}</button>)}</div>
    <div className="work-home-resource-head"><span>{t('本次会话')}</span><button onClick={() => openTab('artifacts')}>{t('全部产物')}</button></div>
    <ArtifactsTab suggested />
  </div>
}
