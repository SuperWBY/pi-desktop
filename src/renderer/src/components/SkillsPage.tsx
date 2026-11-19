import { useTranslation } from '../i18n'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Cable,
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
import type { ConnectorEntry, PackageCatalogEntry, PackageEntry, PackageInspection, SkillEntry } from '@shared/types'
import { useApp } from '../store'
import { appConnectionName, ConnectionsPanel } from './ConnectionsPanel'
import { Markdown } from './Markdown'
import { Modal } from './ui'

type Tab = 'skills' | 'plugins' | 'connectors'
type Scope = 'all' | 'user' | 'project' | 'plugin'

function sourceLabel(source: SkillEntry['source'], t: (text: string) => string): string {
  if (source === 'project') return t('项目')
  if (source === 'package') return t('插件')
  return t('个人')
}

const skillLabels: Record<string, [string, string]> = {
  'agent-reach': ['搜索网页与社交平台', '搜索帖子、查看评论或读取视频字幕。'],
  'chatcut-auto-screen-recorder': ['录制产品演示', '录制操作过程，可添加旁白。'],
  'chatcut-app-promo-guide': ['制作产品宣传片', '用产品画面和动效介绍应用功能。'],
  'chatcut-digital-human': ['制作数字人口播', '用照片或数字人形象生成口播视频。'],
  'chatcut-image-gen': ['生成与编辑图片', '生成封面、海报或剪辑需要的图片。'],
  'chatcut-lipsync': ['视频口型同步', '让视频里人物的嘴型匹配新的音频。'],
  'chatcut-create-motion-graphics': ['制作视频动效', '在剪辑项目中添加动态文字和图形。'],
  'chatcut-caption-template-impl': ['制作字幕样式', '创建可在剪辑中重复使用的动态字幕。'],
  'chatcut-audio-processing-gen': ['制作音频效果', '调整音质，添加音效和转场。'],
  'chatcut-casting-director': ['选择视频角色', '为视频场景制作或选择角色形象。'],
  'chatcut-create-pixel-processor': ['制作画面效果', '为视频画面添加遮罩、色彩或特效。'],
  'chatcut-doctor': ['排查 ChatCut 问题', '诊断连接、项目打开或导出失败。'],
  'chatcut-media-offer': ['整理素材与文字稿', '整理字幕、文案及音视频素材信息。'],
  'anti-ui-slop': ['改进界面设计', '检查界面布局与交互，提出具体修改。'],
  'design-taste-frontend': ['设计落地页', '按说明调整页面、作品集和改版，避免套用模板。'],
  'frontend-design': ['设计界面', '做新界面或改现有界面时，给出具体的视觉方案。'],
  gamma: ['生成演示文稿', '把内容做成可以翻页的演示。'],
  'guizang-ppt-skill': ['生成演示文稿', '把内容做成可以翻页的演示。'],
  alpha: ['读取表格', '读取表格里的记录、字段和视图。'],
  beta: ['整理长内容', '把很长的文字整理成摘要。'],
  'lark-approval': ['处理飞书审批', '查看和处理审批待办。'],
  'lark-apps': ['使用飞书应用', '查看和操作飞书里的应用。'],
  'lark-attendance': ['查看考勤', '查看自己的考勤打卡记录。'],
  'lark-base': ['使用多维表格', '查看和整理飞书多维表格。'],
  'lark-calendar': ['管理日历', '查看日程，创建或更新会议。'],
  'lark-contact': ['查找联系人', '按姓名或部门查找飞书联系人。']
}

const SKILL_GROUP_ORDER = ['查找资料', '办公协作', '设计与呈现', '其他能力']

function skillGroupTitle(skill: SkillEntry): string {
  const blob = `${skill.name} ${skill.description} ${skill.summary ?? ''}`
  if (/lark|feishu|飞书|审批|考勤|日历|多维表格|联系人/.test(blob)) return '办公协作'
  if (/design|frontend|界面|设计|ppt|演示|动效|ui-slop/i.test(blob)) return '设计与呈现'
  if (/reach|search|research|搜索|调研|网页|字幕|摘要|表格/.test(blob)) return '查找资料'
  return '其他能力'
}

function sentenceOf(text: string): string {
  const sentence = text.replace(/\s+/g, ' ').trim().split(/[。！？\n]/)[0]?.trim() ?? ''
  if (!sentence) return ''
  return sentence.length > 32 ? `${sentence.slice(0, 31)}…` : sentence
}

function skillLabel(skill: SkillEntry, t: (text: string) => string): string {
  if (skill.displayName?.trim()) return skill.displayName.trim()
  if (skillLabels[skill.name]) return t(skillLabels[skill.name][0])
  const fromDescription = sentenceOf(skill.summary || skill.description || '')
  return fromDescription || t('未命名技能')
}

function skillSummary(skill: SkillEntry, t: (text: string) => string): string {
  return skill.summary || (skillLabels[skill.name] ? t(skillLabels[skill.name][1]) : skill.description)
}

/** Set before openSkills(true) so the page mounts on the right tab (event alone races mount). */
let pendingSkillsTab: Tab | null = null

export function requestSkillsTab(tab: Tab): void {
  pendingSkillsTab = tab
}

function takePendingSkillsTab(): Tab | null {
  const tab = pendingSkillsTab
  pendingSkillsTab = null
  return tab
}

export function SkillsPage(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [tab, setTab] = useState<Tab>(() => takePendingSkillsTab() ?? 'skills')

  useEffect(() => {
    const pending = takePendingSkillsTab()
    if (pending) setTab(pending)
    const onTab = (event: Event): void => {
      const detail = (event as CustomEvent<Tab>).detail
      if (detail === 'skills' || detail === 'plugins' || detail === 'connectors') setTab(detail)
    }
    window.addEventListener('pi:skills-tab', onTab)
    return () => window.removeEventListener('pi:skills-tab', onTab)
  }, [])
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [packages, setPackages] = useState<PackageEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [selected, setSelected] = useState<SkillEntry | null>(null)
  const [selectedPackage, setSelectedPackage] = useState<PackageEntry | null>(null)
  const [selectedConnector, setSelectedConnector] = useState<ConnectorEntry | null>(null)
  const [connectionDialog, setConnectionDialog] = useState(false)
  const [connectors, setConnectors] = useState<ConnectorEntry[]>([])
  const [content, setContent] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const [installSource, setInstallSource] = useState('')
  const [installLocal, setInstallLocal] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [inspection, setInspection] = useState<PackageInspection | null>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogEntries, setCatalogEntries] = useState<PackageCatalogEntry[] | null>(null)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [inspecting, setInspecting] = useState(false)
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
      if (event.defaultPrevented || connectionDialog) return
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
  }, [actions, connectionDialog, installOpen, removeTarget, selected, selectedConnector, selectedPackage])

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
        if (scope === 'user' && skill.source !== 'user' && skill.source !== 'agents') return false
        if (scope === 'project' && skill.source !== 'project') return false
        if (scope === 'plugin' && skill.source !== 'package') return false
      }
      if (!text) return true
      return `${skill.name} ${skillLabel(skill, t)} ${skillSummary(skill, t)} ${skill.description} ${skill.path}`.toLowerCase().includes(text)
    })
  }, [query, scope, skills, t])

  const visiblePackages = useMemo(() => {
    const text = query.trim().toLowerCase()
    return packages.filter(
      (item) => !text || `${item.name} ${item.source} ${item.description ?? ''}`.toLowerCase().includes(text)
    )
  }, [packages, query])

  const install = useCallback(async () => {
    const source = installSource.trim()
    if (!source || installing || inspecting) return
    if (!inspection || inspection.source !== source) {
      setInspecting(true)
      setProgress([])
      try {
        setInspection(await window.pi.inspectPackage(source, cwd))
      } catch (error) {
        actions.notify('error', t('无法检查来源'), error instanceof Error ? error.message : String(error))
      } finally {
        setInspecting(false)
      }
      return
    }
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
        setInspection(null)
        await load()
      } else {
        actions.notify('error', t('安装失败'), result.error)
      }
    } finally {
      setInstalling(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, cwd, installLocal, installSource, inspecting, inspection, installing, load, t])

  const searchCatalog = async (text = catalogQuery): Promise<void> => {
    if (catalogBusy) return
    setCatalogBusy(true)
    setCatalogError(null)
    try {
      const result = await window.pi.searchPackageCatalog(text)
      setCatalogEntries(result.entries)
      if (result.error) setCatalogError(result.error)
    } catch (error) {
      setCatalogEntries([])
      setCatalogError(error instanceof Error ? error.message : String(error))
    } finally {
      setCatalogBusy(false)
    }
  }

  const openCatalog = (): void => {
    setCatalogOpen(true)
    if (catalogEntries === null) void searchCatalog('')
  }

  const chooseCatalogEntry = (entry: PackageCatalogEntry): void => {
    setCatalogOpen(false)
    setInstallSource(entry.source)
    setInspection(null)
    setInstallOpen(true)
  }

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
    ? { kind: t('技能'), name: skillLabel(selected, t) }
    : selectedPackage
      ? { kind: t('插件'), name: selectedPackage.name }
      : selectedConnector
        ? { kind: t('应用连接'), name: t(appConnectionName(selectedConnector.name)) }
        : null

  return (
    <div className="skills-page" role="dialog" aria-label={t('技能与工具')}>
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
            <span>{t('技能与工具')}</span>
            <ChevronRight size={12} />
            <span>{detail.kind}</span>
            <ChevronRight size={12} />
            <b>{detail.name}</b>
          </div>
        ) : (
          <div className="skills-title">{t('技能与工具')}</div>
        )}
      </div>

      {selected ? (
        <div className="detail-page">
          <div className="detail-hero">
            <div className="detail-icon">
              <Sparkles size={26} />
            </div>
            <div className="detail-heading">
              <h1>{skillLabel(selected, t)}</h1>
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
                <dt>{t('来源')}</dt>
                <dd>{selected.packageName ?? sourceLabel(selected.source, t)}</dd>
              </div>
              <div>
                <dt>{t('技能标识')}</dt>
                <dd className="mono">{selected.name}</dd>
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
              <h1>{t(appConnectionName(selectedConnector.name))}</h1>
              <p>
                {selectedConnector.installed ? t('已安装') : t('未安装')}
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
              ? t('已检测到命令行工具。登录与授权由对应应用管理。')
              : t('安装此工具后，即可使用依赖它的技能。')}
          </p>

          <section className="detail-section">
            <h2>{t('信息')}</h2>
            <dl className="detail-info">
              <div>
                <dt>{t('状态')}</dt>
                <dd className={selectedConnector.installed ? '' : 'missing'}>
                  {selectedConnector.installed ? t('已安装') : t('未安装')}
                </dd>
              </div>
              <div><dt>{t('接入方式')}</dt><dd className="mono">CLI · {selectedConnector.name}</dd></div>
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
              {t('技能')}
            </button>
            <button className={clsx('skills-tab', tab === 'connectors' && 'active')} onClick={() => setTab('connectors')}>
              {t('应用连接')}
            </button>
            <button className={clsx('skills-tab', tab === 'plugins' && 'active')} onClick={() => setTab('plugins')}>
              {t('插件')}
            </button>
          </div>

          {tab === 'connectors' ? (
            <ConnectionsPanel
              cli={connectors}
              refreshCli={() => void load()}
              onOpenCli={setSelectedConnector}
              onDialogChange={setConnectionDialog}
            />
          ) : (
            <>
              <div className="skills-toolbar">
                <div className="skills-search">
                  <Search size={13} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={
                      tab === 'skills' ? t('搜索技能或描述') : t('搜索插件')
                    }
                  />
                </div>
                {tab === 'skills' && (
                  <label className="skills-source">
                    <span>{t('来源')}</span>
                    <select aria-label={t('来源')} value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
                      <option value="all">{t('全部')}</option>
                      <option value="user">{t('个人')}</option>
                      <option value="project">{t('项目')}</option>
                      <option value="plugin">{t('插件')}</option>
                    </select>
                  </label>
                )}
                <button className="icon-button" onClick={() => void load()} title={t('刷新')} aria-label={t('刷新')}>
                  <RefreshCw size={14} />
                </button>
                {tab === 'plugins' && (
                  <>
                    <button className="button ghost small" onClick={openCatalog}>
                      <Sparkles size={13} /> {t('浏览目录')}
                    </button>
                    <button className="button primary small" onClick={() => setInstallOpen(true)}>
                      <Plus size={13} /> {t('安装')}
                    </button>
                  </>
                )}
              </div>

              <div className="skills-scroll">
                {loading ? (
                  <div className="skills-empty">{t('读取中…')}</div>
                ) : tab === 'skills' ? (
                  visibleSkills.length === 0 ? (
                    <div className="skills-empty">{t('没有匹配的技能')}</div>
                  ) : (
                    SKILL_GROUP_ORDER.filter((title) => visibleSkills.some((skill) => skillGroupTitle(skill) === title)).map((title) => (
                      <section className="skills-group" key={title}>
                        <h3 className="skills-group-title">{t(title)}</h3>
                        <div className="skills-grid">
                          {visibleSkills.filter((skill) => skillGroupTitle(skill) === title).map((skill) => (
                            <button className="skill-card" key={skill.path} onClick={() => void openSkill(skill)}>
                              <div className="skill-tile">
                                <Sparkles size={16} />
                              </div>
                              <div className="skill-card-body">
                                <div className="skill-card-name">{skillLabel(skill, t)}</div>
                                <div className="skill-card-desc">{skillSummary(skill, t) || t('没有描述')}</div>
                                {skill.requires.missing.length > 0 && (
                                  <div className="skill-card-meta missing">{t('缺少依赖')}</div>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))
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
        </>
      )}

      <Modal
        open={catalogOpen}
        title={t('插件目录')}
        subtitle={t('从 npm 搜索 pi 相关插件；安装前仍会检查 package.json 和权限。')}
        width={680}
        onClose={() => setCatalogOpen(false)}
        footer={<button className="button ghost" onClick={() => setCatalogOpen(false)}>{t('关闭')}</button>}
      >
        <div className="catalog-search">
          <Search size={14} />
          <input
            autoFocus
            value={catalogQuery}
            placeholder={t('搜索插件，例如 cron、browser、memory…')}
            onChange={(event) => setCatalogQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void searchCatalog() }}
          />
          <button className="settings-button" disabled={catalogBusy} onClick={() => void searchCatalog()}>
            {catalogBusy ? t('搜索中…') : t('搜索')}
          </button>
        </div>
        {catalogError && <p className="settings-note">{catalogError}</p>}
        {catalogEntries === null ? <p className="settings-note">{t('正在读取 npm 目录…')}</p> : catalogEntries.length === 0 ? <p className="settings-note">{t('没有找到匹配的插件。')}</p> : (
          <div className="catalog-list">
            {catalogEntries.map((entry) => (
              <div className="catalog-entry" key={entry.name}>
                <div className="catalog-entry-main">
                  <div className="catalog-entry-title">
                    <strong>{entry.name}</strong>
                    <span className="catalog-version">v{entry.version}</span>
                  </div>
                  <p>{entry.description || t('没有描述')}</p>
                  <div className="catalog-entry-meta">
                    {entry.publisher && <span>@{entry.publisher}</span>}
                    {entry.keywords.slice(0, 3).map((keyword) => <span key={keyword}>{keyword}</span>)}
                  </div>
                </div>
                <button className="button ghost small" onClick={() => chooseCatalogEntry(entry)}>
                  {t('检查并安装')}
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="install-warning">{t('目录来自 npm 搜索，不代表审核或背书。安装前请确认维护者和来源可信。')}</p>
      </Modal>

      <Modal
        open={installOpen}
        title={t('安装插件')}
        subtitle={t('支持 GitHub、npm 与本地目录')}
        onClose={() => {
          if (installing) return
          setInstallOpen(false)
          setInspection(null)
        }}
        footer={
          <>
            <button className="button ghost" onClick={() => { setInstallOpen(false); setInspection(null) }} disabled={installing}>
              {t('取消')}
            </button>
            <button className="button primary" onClick={() => void install()} disabled={!installSource.trim() || installing || inspecting}>
              {installing ? t('安装中…') : inspecting ? t('检查中…') : inspection ? t('确认安装') : t('检查来源')}
            </button>
          </>
        }
      >
        <input
          className="rename-input install-input"
          autoFocus
          value={installSource}
          onChange={(event) => { setInstallSource(event.target.value); setInspection(null) }}
          placeholder="https://github.com/user/repo · npm:pkg · ./local/path"
        />
        {inspection && (
          <div className={clsx('package-inspection', `risk-${inspection.risk}`)}>
            <div className="package-inspection-head">
              <strong>{inspection.name}{inspection.version ? ` ${inspection.version}` : ''}</strong>
              <span className={clsx('package-risk', inspection.risk)}>
                {inspection.risk === 'high' ? t('高风险') : inspection.risk === 'medium' ? t('中风险') : inspection.risk === 'low' ? t('低风险') : t('权限未知')}
              </span>
            </div>
            <div className="package-inspection-meta">
              <span>{inspection.kind === 'local' ? t('本地目录') : inspection.kind === 'git' ? 'GitHub' : 'npm'}</span>
              {inspection.files !== undefined && <span>{inspection.files} {t('个文件')}</span>}
              {inspection.bytes !== undefined && <span>{Math.round(inspection.bytes / 1024)} KB</span>}
            </div>
            {(inspection.resources.extensions > 0 || inspection.resources.skills > 0) && (
              <p className="package-inspection-resources">
                {inspection.resources.extensions > 0 && `${inspection.resources.extensions} ${t('个扩展')}`}
                {inspection.resources.extensions > 0 && inspection.resources.skills > 0 && ' · '}
                {inspection.resources.skills > 0 && `${inspection.resources.skills} ${t('个技能')}`}
              </p>
            )}
            {inspection.scripts.length > 0 && (
              <div className="package-inspection-scripts">
                <span>{t('安装脚本会在安装时执行')}</span>
                {inspection.scripts.map((script) => <code key={script.name}>{script.name}: {script.command}</code>)}
              </div>
            )}
            {inspection.warnings.length > 0 && (
              <ul className="package-inspection-warnings">
                {inspection.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
          </div>
        )}
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
        <p className="modal-text">{t('插件会从 Pi 设置中移除，技能目录与项目文件不受影响。')}</p>
      </Modal>
    </div>
  )
}
