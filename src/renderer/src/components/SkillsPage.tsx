import { useTranslation } from '../i18n'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Cable,
  Check,
  ChevronRight,
  Copy,
  FolderOpen,
  Package,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2
} from 'lucide-react'
import clsx from 'clsx'
import type { ConnectorEntry, PackageEntry, SkillEntry } from '@shared/types'
import { useApp } from '../store'
import { Markdown } from './Markdown'
import { Modal } from './ui'

type Tab = 'skills' | 'plugins' | 'connectors'
type Scope = 'all' | 'user' | 'project' | 'plugin'

function sourceLabel(source: SkillEntry['source'], t: (text: string) => string): string {
  if (source === 'project') return t('项目')
  if (source === 'package') return t('插件')
  return t('用户')
}

export function SkillsPage(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [tab, setTab] = useState<Tab>('skills')
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [packages, setPackages] = useState<PackageEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [selected, setSelected] = useState<SkillEntry | null>(null)
  const [selectedPackage, setSelectedPackage] = useState<PackageEntry | null>(null)
  const [selectedConnector, setSelectedConnector] = useState<ConnectorEntry | null>(null)
  const [connectors, setConnectors] = useState<ConnectorEntry[]>([])
  const [content, setContent] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const [installSource, setInstallSource] = useState('')
  const [installLocal, setInstallLocal] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [removeTarget, setRemoveTarget] = useState<PackageEntry | null>(null)

  const cwd = state.workspace ?? ''

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextSkills, nextPackages, nextConnectors] = await Promise.all([
        window.pi.listSkills(cwd),
        window.pi.listPackages(cwd),
        window.pi.listConnectors(cwd)
      ])
      setSkills(nextSkills)
      setPackages(nextPackages)
      setConnectors(nextConnectors)
    } catch (error) {
      actions.notify('error', t('读取技能失败'), error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    return window.pi.onPackageProgress((item) => {
      if (item.line) setProgress((current) => [...current.slice(-300), item.line as string])
    })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return
      if (selected) {
        event.preventDefault()
        setSelected(null)
      } else if (selectedPackage) {
        event.preventDefault()
        setSelectedPackage(null)
      } else if (selectedConnector) {
        event.preventDefault()
        setSelectedConnector(null)
      } else if (!installOpen && !removeTarget) {
        event.preventDefault()
        actions.openSkills(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, installOpen, removeTarget, selected, selectedConnector, selectedPackage])

  const openSkill = useCallback(async (skill: SkillEntry) => {
    setSelected(skill)
    setContent('')
    setContentLoading(true)
    try {
      const result = await window.pi.readSkill(skill.path)
      setContent(result.content ?? '')
    } finally {
      setContentLoading(false)
    }
  }, [])

  const useSkill = useCallback(
    (skill: SkillEntry) => {
      actions.fillComposer(`/${skill.name} `)
      actions.openSkills(false)
    },
    [actions]
  )

  const visibleSkills = useMemo(() => {
    const text = query.trim().toLowerCase()
    return skills.filter((skill) => {
      if (scope !== 'all') {
        if (scope === 'user' && skill.source === 'project') return false
        if (scope === 'project' && skill.source !== 'project') return false
        if (scope === 'plugin' && skill.source !== 'package') return false
      }
      if (!text) return true
      return `${skill.name} ${skill.description} ${skill.path}`.toLowerCase().includes(text)
    })
  }, [query, scope, skills])

  const visiblePackages = useMemo(() => {
    const text = query.trim().toLowerCase()
    return packages.filter(
      (item) => !text || `${item.name} ${item.source} ${item.description ?? ''}`.toLowerCase().includes(text)
    )
  }, [packages, query])

  const visibleConnectors = useMemo(() => {
    const text = query.trim().toLowerCase()
    return connectors.filter(
      (item) => !text || `${item.name} ${item.path ?? ''} ${item.usedBy.map((use) => use.name).join(' ')}`.toLowerCase().includes(text)
    )
  }, [connectors, query])

  const install = useCallback(async () => {
    const source = installSource.trim()
    if (!source || installing) return
    setInstalling(true)
    setProgress([])
    try {
      const result = await window.pi.installPackage(source, { cwd, local: installLocal })
      if (result.ok) {
        actions.notify('success', t('已安装'), source, {
          label: t('重启会话'),
          run: () => void actions.restartSession()
        })
        setInstallOpen(false)
        setInstallSource('')
        await load()
      } else {
        actions.notify('error', t('安装失败'), result.error)
      }
    } finally {
      setInstalling(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, cwd, installLocal, installSource, installing, load, t])

  const remove = useCallback(async () => {
    if (!removeTarget) return
    const target = removeTarget
    setRemoveTarget(null)
    const result = await window.pi.removePackage(target.source, cwd)
    if (result.ok) {
      actions.notify('success', t('已移除'), target.name, {
        label: t('重启会话'),
        run: () => void actions.restartSession()
      })
      await load()
    } else {
      actions.notify('error', t('移除失败'), result.error)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, cwd, load, removeTarget, t])

  const update = useCallback(
    async (item: PackageEntry) => {
      const result = await window.pi.updatePackage(item.source, cwd)
      if (result.ok) {
        actions.notify('success', t('已更新'), item.name)
        await load()
      } else {
        actions.notify('error', t('更新失败'), result.error)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, cwd, load, t]
  )

  useEffect(() => {
    if (!selectedPackage) return
    const next = packages.find(
      (item) => item.source === selectedPackage.source && item.scope === selectedPackage.scope
    )
    if (next) setSelectedPackage(next)
    else if (!loading) setSelectedPackage(null)
  }, [loading, packages, selectedPackage])

  const detail = selected
    ? { kind: t('技能'), name: selected.name }
    : selectedPackage
      ? { kind: t('插件'), name: selectedPackage.name }
      : selectedConnector
        ? { kind: t('连接器'), name: selectedConnector.name }
        : null

  return (
    <div className="skills-page" role="dialog" aria-label={t('技能与插件')}>
      <div className="skills-drag" />
      <div className="skills-head">
        <button
          className="icon-button skills-back"
          onClick={() => {
            if (selected) setSelected(null)
            else if (selectedPackage) setSelectedPackage(null)
            else if (selectedConnector) setSelectedConnector(null)
            else actions.openSkills(false)
          }}
          aria-label={t('返回')}
        >
          <ArrowLeft size={16} />
        </button>
        {detail ? (
          <div className="skills-crumbs">
            <span>{t('技能与插件')}</span>
            <ChevronRight size={12} />
            <span>{detail.kind}</span>
            <ChevronRight size={12} />
            <b>{detail.name}</b>
          </div>
        ) : (
          <>
            <div className="skills-title">{t('技能与插件')}</div>
            <div className="skills-count">
              {skills.length} {t('技能')} · {packages.length} {t('插件')} · {connectors.length} {t('连接器')}
            </div>
          </>
        )}
      </div>

      {selected ? (
        <div className="detail-page">
          <div className="detail-hero">
            <div className="detail-icon">
              <Sparkles size={26} />
            </div>
            <div className="detail-heading">
              <h1>{selected.name}</h1>
              <p>
                {[
                  selected.version ? `v${selected.version}` : '',
                  sourceLabel(selected.source, t),
                  selected.symlink ? 'symlink' : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="detail-actions">
              <button className="button primary small" onClick={() => useSkill(selected)}>
                {t('在对话中使用')}
              </button>
              <button className="button ghost small" onClick={() => window.pi.showItem(selected.path)}>
                <FolderOpen size={13} /> {t('在 Finder 中显示')}
              </button>
              <button
                className="button ghost small"
                onClick={() => {
                  void navigator.clipboard.writeText(selected.path)
                  actions.notify('info', t('已复制'), selected.path)
                }}
              >
                <Copy size={13} /> {t('复制路径')}
              </button>
            </div>
          </div>

          {selected.description && <p className="detail-desc">{selected.description}</p>}

          <section className="detail-section">
            <h2>{t('信息')}</h2>
            <dl className="detail-info">
              {selected.version && (
                <div>
                  <dt>{t('版本')}</dt>
                  <dd>{selected.version}</dd>
                </div>
              )}
              <div>
                <dt>{t('作用域')}</dt>
                <dd>{sourceLabel(selected.source, t)}</dd>
              </div>
              <div>
                <dt>{t('路径')}</dt>
                <dd className="mono">{selected.path}</dd>
              </div>
              {selected.requires.bins.length > 0 && (
                <div>
                  <dt>{t('依赖')}</dt>
                  <dd className={selected.requires.missing.length ? 'missing' : ''}>
                    {selected.requires.bins.join(', ')}
                    {selected.requires.missing.length
                      ? ` · ${t('缺少')} ${selected.requires.missing.join(', ')}`
                      : ' ✓'}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="detail-section">
            <h2>{t('说明')}</h2>
            <div className="skill-readme">
              {contentLoading ? (
                <div className="skills-empty">{t('读取中…')}</div>
              ) : content ? (
                <Markdown>{content}</Markdown>
              ) : (
                <div className="skills-empty">{t('没有 SKILL.md')}</div>
              )}
            </div>
          </section>
        </div>
      ) : selectedPackage ? (
        <div className="detail-page package-detail">
          <div className="detail-hero">
            <div className="detail-icon">
              <Package size={26} />
            </div>
            <div className="detail-heading">
              <h1>{selectedPackage.name}</h1>
              <p>
                {[
                  selectedPackage.version ? `v${selectedPackage.version}` : '',
                  selectedPackage.scope === 'project' ? t('项目') : t('用户'),
                  selectedPackage.source
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="detail-actions">
              <button className="button primary small" onClick={() => void update(selectedPackage)}>
                {t('更新')}
              </button>
              {selectedPackage.path && (
                <button
                  className="button ghost small"
                  onClick={() => window.pi.showItem(selectedPackage.path as string)}
                >
                  <FolderOpen size={13} /> {t('在 Finder 中显示')}
                </button>
              )}
              <button
                className="button ghost small danger"
                onClick={() => setRemoveTarget(selectedPackage)}
              >
                <Trash2 size={13} /> {t('移除')}
              </button>
            </div>
          </div>

          {selectedPackage.description && (
            <p className="detail-desc">{selectedPackage.description}</p>
          )}

          <section className="detail-section">
            <h2>{t('信息')}</h2>
            <dl className="detail-info">
              {selectedPackage.version && (
                <div>
                  <dt>{t('版本')}</dt>
                  <dd>{selectedPackage.version}</dd>
                </div>
              )}
              <div>
                <dt>{t('来源')}</dt>
                <dd className="mono">{selectedPackage.source}</dd>
              </div>
              <div>
                <dt>{t('作用域')}</dt>
                <dd>{selectedPackage.scope === 'project' ? t('项目') : t('用户')}</dd>
              </div>
              {selectedPackage.path && (
                <div>
                  <dt>{t('路径')}</dt>
                  <dd className="mono">{selectedPackage.path}</dd>
                </div>
              )}
            </dl>
          </section>

          {(selectedPackage.resources.extensions > 0 ||
            selectedPackage.resources.skills > 0 ||
            selectedPackage.resources.prompts > 0 ||
            selectedPackage.resources.themes > 0) && (
            <section className="detail-section">
              <h2>{t('包含')}</h2>
              <div className="package-resources">
                {selectedPackage.resources.extensions > 0 && (
                  <span className="package-chip">{selectedPackage.resources.extensions} {t('扩展')}</span>
                )}
                {selectedPackage.resources.skills > 0 && (
                  <span className="package-chip">{selectedPackage.resources.skills} {t('技能')}</span>
                )}
                {selectedPackage.resources.prompts > 0 && (
                  <span className="package-chip">{selectedPackage.resources.prompts} {t('提示词')}</span>
                )}
                {selectedPackage.resources.themes > 0 && (
                  <span className="package-chip">{selectedPackage.resources.themes} {t('主题')}</span>
                )}
              </div>
            </section>
          )}
        </div>
      ) : selectedConnector ? (
        <div className="detail-page connector-detail">
          <div className="detail-hero">
            <div className="detail-icon">
              <Cable size={26} />
            </div>
            <div className="detail-heading">
              <h1>{selectedConnector.name}</h1>
              <p>
                {selectedConnector.installed ? t('已连接') : t('未连接')}
                {' · '}
                {t('{count} 个技能').replace('{count}', String(selectedConnector.usedBy.length))}
              </p>
            </div>
            <div className="detail-actions">
              <button className="button primary small" onClick={() => void load()}>
                <RefreshCw size={13} /> {t('重新检测')}
              </button>
              {selectedConnector.path && (
                <button
                  className="button ghost small"
                  onClick={() => window.pi.showItem(selectedConnector.path as string)}
                >
                  <FolderOpen size={13} /> {t('在 Finder 中显示')}
                </button>
              )}
              {selectedConnector.path && (
                <button
                  className="button ghost small"
                  onClick={() => {
                    void navigator.clipboard.writeText(selectedConnector.path as string)
                    actions.notify('info', t('已复制'), selectedConnector.path)
                  }}
                >
                  <Copy size={13} /> {t('复制路径')}
                </button>
              )}
            </div>
          </div>

          <p className="detail-desc">
            {selectedConnector.installed
              ? t('已连接：技能可以通过命令行调用它。')
              : t('未连接：使用它的技能无法正常执行。')}
          </p>

          <section className="detail-section">
            <h2>{t('信息')}</h2>
            <dl className="detail-info">
              <div>
                <dt>{t('状态')}</dt>
                <dd className={selectedConnector.installed ? '' : 'missing'}>
                  {selectedConnector.installed ? t('已连接') : t('未连接')}
                </dd>
              </div>
              {selectedConnector.path && (
                <div>
                  <dt>{t('路径')}</dt>
                  <dd className="mono">{selectedConnector.path}</dd>
                </div>
              )}
              <div>
                <dt>{t('使用它的技能')}</dt>
                <dd>
                  {t('{count} 个技能').replace('{count}', String(selectedConnector.usedBy.length))}
                </dd>
              </div>
            </dl>
          </section>

          <section className="detail-section">
            <h2>{t('使用它的技能')}</h2>
            <div className="connector-uses">
              {selectedConnector.usedBy.map((use) => (
                <div className="connector-use" key={use.path}>
                  <Sparkles size={12} />
                  <span>{use.name}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <>
          <div className="skills-tabs">
            <button className={clsx('skills-tab', tab === 'skills' && 'active')} onClick={() => setTab('skills')}>
              {t('技能')} {skills.length}
            </button>
            <button className={clsx('skills-tab', tab === 'plugins' && 'active')} onClick={() => setTab('plugins')}>
              {t('插件')} {packages.length}
            </button>
            <button className={clsx('skills-tab', tab === 'connectors' && 'active')} onClick={() => setTab('connectors')}>
              {t('连接器')} {connectors.length}
            </button>
          </div>

          <div className="skills-toolbar">
            <div className="skills-search">
              <Search size={13} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  tab === 'skills'
                    ? t('搜索技能或描述')
                    : tab === 'plugins'
                      ? t('搜索插件')
                      : t('搜索连接器')
                }
              />
            </div>
            {tab === 'skills' && (
              <div className="skills-filters">
                {(['all', 'user', 'project', 'plugin'] as Scope[]).map((item) => (
                  <button
                    key={item}
                    className={clsx('skills-filter', scope === item && 'active')}
                    onClick={() => setScope(item)}
                  >
                    {item === 'all' ? t('全部') : item === 'user' ? t('用户') : item === 'project' ? t('项目') : t('插件')}
                  </button>
                ))}
              </div>
            )}
            <button className="icon-button" onClick={() => void load()} title={t('刷新')} aria-label={t('刷新')}>
              <RefreshCw size={14} />
            </button>
            {tab === 'plugins' && (
              <button className="button primary small" onClick={() => setInstallOpen(true)}>
                <Plus size={13} /> {t('安装')}
              </button>
            )}
          </div>

          <div className="skills-scroll">
            {loading ? (
              <div className="skills-empty">{t('读取中…')}</div>
            ) : tab === 'skills' ? (
              visibleSkills.length === 0 ? (
                <div className="skills-empty">{t('没有匹配的技能')}</div>
              ) : (
                <div className="skills-grid">
                  {visibleSkills.map((skill) => (
                    <button className="skill-card" key={skill.path} onClick={() => void openSkill(skill)}>
                      <div className="skill-tile">
                        <Sparkles size={16} />
                      </div>
                      <div className="skill-card-body">
                        <div className="skill-card-name">
                          {skill.name}
                          <span className="skill-scope">{sourceLabel(skill.source, t)}</span>
                        </div>
                        <div className="skill-card-desc">{skill.description || t('没有描述')}</div>
                        <div className="skill-card-meta">
                          {skill.version ? `v${skill.version}` : ''}
                          {skill.requires.bins.length > 0 && (
                            <span className={skill.requires.missing.length ? 'missing' : ''}>
                              {skill.requires.bins.join(', ')}
                              {skill.requires.missing.length ? ` · ${t('缺少')}` : ' ✓'}
                            </span>
                          )}
                        </div>
                      </div>
                      {skill.requires.missing.length === 0 && <Check size={14} className="skill-check" />}
                    </button>
                  ))}
                </div>
              )
            ) : tab === 'connectors' ? (
              visibleConnectors.length === 0 ? (
                <div className="skills-empty">{t('还没有连接器')}</div>
              ) : (
                <div className="package-list">
                  {visibleConnectors.map((item) => (
                    <div
                      className="package-row"
                      key={item.name}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedConnector(item)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedConnector(item)
                        }
                      }}
                    >
                      <div className="skill-tile">
                        <Cable size={15} />
                      </div>
                      <div className="package-body">
                        <div className="package-name">
                          {item.name}
                          <span className={clsx('connector-status', item.installed ? 'ok' : 'missing')}>
                            {item.installed ? t('已连接') : t('未连接')}
                          </span>
                        </div>
                        <div className="package-desc">
                          {item.path || t('外部命令行工具，由技能调用。')}
                        </div>
                      </div>
                      <div className="package-actions">
                        <span className="package-source">
                          {t('{count} 个技能').replace('{count}', String(item.usedBy.length))}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : visiblePackages.length === 0 ? (
              <div className="skills-empty">{t('还没有安装插件')}</div>
            ) : (
              <div className="package-list">
                {visiblePackages.map((item) => (
                  <div
                    className="package-row"
                    key={`${item.scope}:${item.source}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedPackage(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedPackage(item)
                      }
                    }}
                  >
                    <div className="skill-tile">
                      <Package size={15} />
                    </div>
                    <div className="package-body">
                      <div className="package-name">
                        {item.name}
                        <span className="skill-scope">{item.scope === 'project' ? t('项目') : t('用户')}</span>
                        {item.version && <span className="package-version">v{item.version}</span>}
                        <span className="package-source" title={item.path}>{item.source}</span>
                      </div>
                      <div className="package-desc">{item.description || item.source}</div>
                    </div>
                    <div className="package-actions">
                      {item.path && (
                        <button
                          className="icon-button"
                          title={t('在 Finder 中显示')}
                          onClick={(event) => {
                            event.stopPropagation()
                            window.pi.showItem(item.path as string)
                          }}
                        >
                          <FolderOpen size={13} />
                        </button>
                      )}
                      <button
                        className="button ghost small"
                        onClick={(event) => {
                          event.stopPropagation()
                          void update(item)
                        }}
                      >
                        {t('更新')}
                      </button>
                      <button
                        className="button ghost small danger"
                        onClick={(event) => {
                          event.stopPropagation()
                          setRemoveTarget(item)
                        }}
                      >
                        <Trash2 size={13} /> {t('移除')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <Modal
        open={installOpen}
        title={t('安装插件')}
        subtitle={t('支持 GitHub、npm 与本地目录')}
        onClose={() => (installing ? undefined : setInstallOpen(false))}
        footer={
          <>
            <button className="button ghost" onClick={() => setInstallOpen(false)} disabled={installing}>
              {t('取消')}
            </button>
            <button className="button primary" onClick={() => void install()} disabled={!installSource.trim() || installing}>
              {installing ? t('安装中…') : t('安装')}
            </button>
          </>
        }
      >
        <input
          className="rename-input install-input"
          autoFocus
          value={installSource}
          onChange={(event) => setInstallSource(event.target.value)}
          placeholder="https://github.com/user/repo · npm:pkg · ./local/path"
        />
        <label className="install-scope">
          <input type="checkbox" checked={installLocal} onChange={(event) => setInstallLocal(event.target.checked)} />
          {t('只安装到当前项目（.pi/settings.json）')}
        </label>
        <p className="install-warning">
          {t('插件会执行代码（包括安装脚本）。只安装你信任的来源。')}
        </p>
        {progress.length > 0 && (
          <pre className="install-log">{progress.slice(-40).join('\n')}</pre>
        )}
      </Modal>

      <Modal
        open={Boolean(removeTarget)}
        title={t('移除插件？')}
        subtitle={removeTarget?.name}
        onClose={() => setRemoveTarget(null)}
        footer={
          <>
            <button className="button ghost" onClick={() => setRemoveTarget(null)}>
              {t('取消')}
            </button>
            <button className="button danger" onClick={() => void remove()}>
              {t('移除')}
            </button>
          </>
        }
      >
        <p className="modal-text">{t('插件会从 pi 设置中移除，技能目录与项目文件不受影响。')}</p>
      </Modal>
    </div>
  )
}
