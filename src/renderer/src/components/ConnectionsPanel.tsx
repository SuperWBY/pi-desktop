import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Cable, ChevronRight, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { userFacingError } from '@shared/errors'
import type { ConnectorEntry, McpConnectionTest, McpConnector, McpConnectorInput } from '@shared/types'
import { useTranslation } from '../i18n'
import { Modal } from './ui'

export function appConnectionName(command: string): string {
  if (command === 'lark-cli') return '飞书'
  if (command === 'gh') return 'GitHub'
  return command
}

type Editor = { connector?: McpConnector }
type Header = McpConnectorInput['headers'][number] & { key: number }

function testLabel(result: McpConnectionTest | undefined): string {
  if (!result) return '未测试'
  if (result.status === 'connected') return '测试通过'
  if (result.status === 'unauthorized') return '需要授权'
  if (result.status === 'unsupported') return '当前 Pi 版本无法测试'
  return '连接失败'
}

function errorText(error: unknown): string {
  return userFacingError(error)
}

function ConnectionEditor({ connector, onClose, onSaved }: {
  connector?: McpConnector
  onClose: () => void
  onSaved: (item: McpConnector, result: McpConnectionTest | undefined) => void
}): ReactNode {
  const t = useTranslation()
  const [name, setName] = useState(connector?.name ?? '')
  const [url, setUrl] = useState(connector?.url ?? '')
  const [headers, setHeaders] = useState<Header[]>(() => (connector?.headerNames ?? []).map((name, key) => ({ key, name, value: '', keep: true })))
  const [nextKey, setNextKey] = useState(headers.length)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [result, setResult] = useState<McpConnectionTest>()
  const [error, setError] = useState('')
  const hasFields = Boolean(name.trim() && url.trim())

  function edited(): void {
    setResult(undefined)
    setError('')
  }

  async function submit(kind: 'test' | 'save', event?: FormEvent): Promise<void> {
    event?.preventDefault()
    if (busy || !hasFields) return
    setError('')
    setBusy(kind)
    const input = { id: connector?.id, name, url, headers: headers.map(({ name, value, keep }) => ({ name, value, keep })) }
    try {
      if (kind === 'test') setResult(await window.pi.testMcpConnector(input))
      else onSaved(await window.pi.saveMcpConnector(input), result)
    } catch (error) {
      setResult(undefined)
      setError(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open
      title={t(connector ? '编辑连接器' : '手动添加连接器')}
      subtitle={t('连接 MCP 服务，让 Pi 在对话中使用它提供的工具。')}
      onClose={() => { if (!busy) onClose() }}
      footer={
        <>
          <button type="button" className="button ghost" disabled={!!busy} onClick={onClose}>{t('取消')}</button>
          <button type="button" className="button ghost" disabled={!hasFields || !!busy} onClick={() => void submit('test')}>
            <RefreshCw size={14} /> {t(busy === 'test' ? '正在测试…' : '测试连接')}
          </button>
          <button type="submit" form="mcp-connector-form" className="button primary" disabled={!hasFields || !!busy}>
            {t(busy === 'save' ? '保存中…' : '保存')}
          </button>
        </>
      }
    >
      <form id="mcp-connector-form" className="connector-form" onSubmit={(event) => void submit('save', event)}>
        <fieldset disabled={!!busy}>
          <label className="form-field">
            <span>{t('连接名称')}</span>
            <input autoFocus required maxLength={80} value={name} placeholder={t('例如：GitHub MCP')} onChange={(event) => { setName(event.target.value); edited() }} />
          </label>
          <label className="form-field">
            <span>{t('服务器 URL')}</span>
            <input type="url" required value={url} placeholder="https://example.com/mcp" spellCheck={false} onChange={(event) => { setUrl(event.target.value); edited() }} />
            <small>{t('接入方式：MCP（Streamable HTTP）')}</small>
          </label>
          <div className="connector-form-headers">
            <div className="connector-headers-head">
              <span>{t('自定义请求头')}</span>
              <button type="button" className="button ghost small" onClick={() => {
                setHeaders([...headers, { key: nextKey, name: '', value: '' }])
                setNextKey(nextKey + 1)
              }}><Plus size={14} /> {t('添加请求头')}</button>
            </div>
            <small>{t('服务方提供了认证信息时再填写，例如 Authorization。')}</small>
            {headers.map((row) => (
              <div className="connector-header-row" key={row.key}>
                <input aria-label={t('请求头名称')} value={row.name} placeholder="Authorization" disabled={row.keep}
                  onChange={(event) => { setHeaders(headers.map((item) => item.key === row.key ? { ...item, name: event.target.value } : item)); edited() }} />
                <input aria-label={t('请求头值')} type="password" value={row.value} placeholder={row.keep ? t('已保存，填写可替换') : 'Bearer …'} autoComplete="off"
                  onChange={(event) => { setHeaders(headers.map((item) => item.key === row.key ? { ...item, value: event.target.value, keep: !!connector?.headerNames.includes(row.name) && !event.target.value } : item)); edited() }} />
                <button type="button" className="icon-button" aria-label={t('移除请求头')} onClick={() => { setHeaders(headers.filter((item) => item.key !== row.key)); edited() }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </fieldset>
        {(error || result) && (
          <div role={error || result?.status !== 'connected' ? 'alert' : 'status'} className={clsx('connector-feedback', { ok: !error && result?.status === 'connected' })}>
            {t(error) || (result?.status === 'connected'
              ? t('已连接，发现 {count} 个工具。').replace('{count}', String(result.toolCount))
              : result?.status === 'unauthorized' ? t('服务需要授权，请检查请求头或服务方的登录说明。')
                : result?.status === 'unsupported' ? t('当前 Pi 版本无法测试，请检查 Pi 版本。')
                  : t('未能连接，请检查服务器地址和网络。'))}
          </div>
        )}
      </form>
    </Modal>
  )
}

export function ConnectionsPanel({ cli, refreshCli, onOpenCli, onDialogChange }: {
  cli: ConnectorEntry[]
  refreshCli: () => void
  onOpenCli: (item: ConnectorEntry) => void
  onDialogChange: (open: boolean) => void
}): ReactNode {
  const t = useTranslation()
  const [mcp, setMcp] = useState<McpConnector[]>([])
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [remove, setRemove] = useState<McpConnector | null>(null)
  const [removeError, setRemoveError] = useState('')
  const [removing, setRemoving] = useState(false)
  const [tests, setTests] = useState<Record<string, McpConnectionTest | undefined>>({})
  const [testing, setTesting] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    try { setMcp(await window.pi.listMcpConnectors()); setLoadError('') }
    catch (error) { setLoadError(errorText(error)) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    onDialogChange(!!editor || !!remove)
    return () => onDialogChange(false)
  }, [editor, onDialogChange, remove])

  const search = query.trim().toLowerCase()
  const matches = (...parts: string[]): boolean => parts.some((part) => part.toLowerCase().includes(search))
  const apps = cli.filter((item) => appConnectionName(item.name) !== item.name && matches(item.name, appConnectionName(item.name), t(appConnectionName(item.name))))
  const local = cli.filter((item) => appConnectionName(item.name) === item.name && matches(item.name))
  const services = mcp.filter((item) => matches(item.name, item.id, item.url ?? ''))

  async function testSaved(item: McpConnector): Promise<void> {
    if (!item.url || testing) return
    setTesting(item.id)
    try {
      const result = await window.pi.testMcpConnector({
        id: item.id, name: item.name, url: item.url,
        headers: item.headerNames.map((name) => ({ name, value: '', keep: true }))
      })
      setTests((current) => ({ ...current, [item.id]: result }))
    } catch (error) {
      setTests((current) => ({ ...current, [item.id]: { status: 'unreachable' } }))
      setLoadError(t(errorText(error)))
    } finally {
      setTesting(null)
    }
  }

  return (
    <>
      <div className="skills-toolbar">
        <div className="skills-search">
          <Search size={13} />
          <input aria-label={t('搜索应用连接')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索应用连接')} />
        </div>
        <button className="icon-button" title={t('刷新')} aria-label={t('刷新')} onClick={() => { setTests({}); void load(); refreshCli() }}><RefreshCw size={14} /></button>
        <button className="button primary small" onClick={() => setEditor({})}><Plus size={14} /> {t('手动添加')}</button>
      </div>
      <div className="skills-scroll connections-scroll">
        {notice && <p className="connections-notice" role="status">{notice} {t('新建或重启会话后生效。')}</p>}
        {loadError && <p className="connector-feedback" role="alert">{t('无法读取 MCP 连接。')} {loadError}</p>}
        {!apps.length && !services.length && !local.length && !loadError && (
          <div className="skills-empty">{t(search ? '没有匹配的连接' : '还没有应用连接')}</div>
        )}
        {(apps.length > 0 || services.length > 0) && (
          <div className="package-list">
            {apps.map((item) => (
              <button type="button" className="connection-row" key={item.name} onClick={() => onOpenCli(item)}>
                <span className="skill-tile"><Cable size={16} /></span>
                <span className="package-body">
                  <span className="package-name">{t(appConnectionName(item.name))}</span>
                  <span className="package-desc">{t(item.name === 'lark-cli' ? '通过飞书访问文档、日程和多维表格' : '通过 GitHub 访问仓库和拉取请求')}</span>
                </span>
                <span className="connector-status">{t(item.installed ? '已安装' : '未安装')}</span>
                <ChevronRight size={15} />
              </button>
            ))}
            {services.map((item) => (
              <div className="connection-row" key={item.id}>
                <span className="skill-tile"><Cable size={16} /></span>
                <span className="package-body">
                  <span className="package-name">{item.name}</span>
                  <span className="package-desc">{t(item.transport === 'http' ? 'MCP 服务' : '本机 MCP 服务')}</span>
                </span>
                <span className={clsx('connector-status', { ok: item.enabled && tests[item.id]?.status === 'connected' })}>
                  {t(testing === item.id ? '正在测试…' : item.enabled ? testLabel(tests[item.id]) : '已停用')}
                </span>
                {item.transport === 'http' && (
                  <>
                    {item.enabled && <button className="button ghost small" aria-label={`${t('测试连接')} ${item.name}`} disabled={!!testing} onClick={() => void testSaved(item)}>{t('测试连接')}</button>}
                    <button className="button ghost small" aria-label={`${t('编辑')} ${item.name}`} onClick={() => setEditor({ connector: item })}>{t('编辑')}</button>
                    <button className="icon-button" title={t('移除')} aria-label={`${t('移除')} ${item.name}`} onClick={() => { setRemoveError(''); setRemove(item) }}><Trash2 size={14} /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {local.length > 0 && (
          <details className="connection-dependencies" open={search ? true : undefined}>
            <summary>{t('本机依赖')} <span>{local.length}</span></summary>
            <div className="package-list">
              {local.map((item) => (
                <button type="button" className="connection-row" key={item.name} onClick={() => onOpenCli(item)}>
                  <span className="package-body">{item.name}</span>
                  <span className="connector-status">{t(item.installed ? '已安装' : '未安装')}</span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
      {editor && <ConnectionEditor connector={editor.connector} onClose={() => setEditor(null)} onSaved={(item, result) => {
        setMcp((items) => [...items.filter(({ id }) => id !== item.id), item].sort((a, b) => a.name.localeCompare(b.name)))
        setTests((current) => ({ ...current, [item.id]: result }))
        setNotice(t('连接已保存。'))
        setEditor(null)
      }} />}
      {remove && (
        <Modal open title={t('移除此连接？')} subtitle={remove.name} onClose={() => { if (!removing) setRemove(null) }}
          footer={<>
            <button className="button ghost" disabled={removing} onClick={() => setRemove(null)}>{t('取消')}</button>
            <button className="button primary" disabled={removing} onClick={async () => {
              setRemoving(true)
              try {
                await window.pi.removeMcpConnector(remove.id)
                setMcp((items) => items.filter(({ id }) => id !== remove.id))
                setNotice(t('连接已移除。'))
                setRemove(null)
                      } catch (error) { setRemoveError(errorText(error)) }
              finally { setRemoving(false) }
            }}>{t('移除')}</button>
          </>}>
          {removeError && <div className="connector-feedback" role="alert">{removeError}</div>}
        </Modal>
      )}
    </>
  )
}
