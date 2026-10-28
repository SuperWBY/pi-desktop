import { useTranslation } from '../i18n'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  FolderSearch,
  Info,
  Keyboard,
  MessagesSquare,
  Palette,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import clsx from 'clsx'
import type {
  CustomProviderEntry,
  ModelsConfig,
  PiModelRow,
  PiSettings,
  ThinkingLevel
} from '@shared/types'
import { useApp } from '../store'
import { shortenPath } from '../lib/format'
import { Popover } from './ui'

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: '⌘N', label: '新建会话' },
  { keys: '⌘O', label: '打开项目' },
  { keys: '⌘B', label: '收起 / 展开侧栏' },
  { keys: '⌘⇧L', label: '切换主题' },
  { keys: '⌘⇧E', label: '右侧工作面板' },
  { keys: '⌘⇧O', label: '完整记录' },
  { keys: '⌘.', label: '收起所有轮次' },
  { keys: '⇧⌘.', label: '展开所有轮次' },
  { keys: '⌘,', label: '打开设置' },
  { keys: 'Enter', label: '发送消息' },
  { keys: '⇧Enter', label: '换行' },
  { keys: 'Esc', label: '停止运行 / 关闭面板' }
]

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大'
}

const BUILTIN_TOOLS: { name: string; desc: string }[] = [
  { name: 'read', desc: '读取文件内容' },
  { name: 'bash', desc: '执行 shell 命令' },
  { name: 'edit', desc: '按片段修改文件' },
  { name: 'write', desc: '写入或覆盖文件' },
  { name: 'grep', desc: '按内容搜索文件' },
  { name: 'find', desc: '按名称查找文件' },
  { name: 'ls', desc: '列出目录' }
]

const DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write']

/** APIs pi supports for a custom endpoint (docs/models-configuration.md). */
const API_OPTIONS = [
  { value: 'openai-completions', label: 'OpenAI 兼容 (openai-completions)' },
  { value: 'openai-responses', label: 'OpenAI Responses (openai-responses)' },
  { value: 'anthropic-messages', label: 'Anthropic 兼容 (anthropic-messages)' },
  { value: 'google-generative-ai', label: 'Google 兼容 (google-generative-ai)' }
]

interface ProviderPreset {
  key: string
  label: string
  provider: string
  api: string
  baseUrl: string
  apiKey: string
}

const PRESETS: ProviderPreset[] = [
  { key: 'custom', label: '自定义', provider: '', api: 'openai-completions', baseUrl: '', apiKey: '' },
  {
    key: 'ollama',
    label: 'Ollama',
    provider: 'ollama',
    api: 'openai-completions',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama'
  },
  {
    key: 'lmstudio',
    label: 'LM Studio',
    provider: 'lmstudio',
    api: 'openai-completions',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: 'lm-studio'
  },
  {
    key: 'vllm',
    label: 'vLLM / SGLang',
    provider: 'vllm',
    api: 'openai-completions',
    baseUrl: 'http://localhost:8000/v1',
    apiKey: ''
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    provider: 'openrouter',
    api: 'openai-completions',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '$OPENROUTER_API_KEY'
  },
  {
    key: 'anthropic',
    label: 'Anthropic 兼容',
    provider: '',
    api: 'anthropic-messages',
    baseUrl: '',
    apiKey: ''
  },
  {
    key: 'google',
    label: 'Google 兼容',
    provider: '',
    api: 'google-generative-ai',
    baseUrl: '',
    apiKey: ''
  }
]

interface ProviderDraft {
  preset: string
  id: string
  name: string
  baseUrl: string
  api: string
  apiKey: string
  modelIds: string
  contextWindow: string
  maxTokens: string
  reasoning: boolean
  images: boolean
}

const EMPTY_DRAFT: ProviderDraft = {
  preset: 'custom',
  id: '',
  name: '',
  baseUrl: '',
  api: 'openai-completions',
  apiKey: '',
  modelIds: '',
  contextWindow: '',
  maxTokens: '',
  reasoning: true,
  images: false
}

function draftToEntry(draft: ProviderDraft): CustomProviderEntry {
  const ids = draft.modelIds
    .split(/[\s,;]+/)
    .map((id) => id.trim())
    .filter(Boolean)
  const contextWindow = Number.parseInt(draft.contextWindow, 10)
  const maxTokens = Number.parseInt(draft.maxTokens, 10)
  const entry: CustomProviderEntry = {}
  if (draft.name.trim()) entry.name = draft.name.trim()
  if (draft.baseUrl.trim()) entry.baseUrl = draft.baseUrl.trim()
  if (draft.api) entry.api = draft.api
  if (draft.apiKey.trim()) entry.apiKey = draft.apiKey.trim()
  if (ids.length) {
    entry.models = ids.map((id) => ({
      id,
      ...(draft.reasoning ? { reasoning: true } : {}),
      ...(draft.images ? { input: ['text', 'image'] } : {}),
      ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
      ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens } : {})
    }))
  }
  return entry
}

type CategoryId = 'general' | 'models' | 'tools' | 'appearance' | 'sessions' | 'shortcuts' | 'about'

const NAV: {
  group: string
  items: { id: CategoryId; label: string; icon: typeof Info; keywords: string[] }[]
}[] = [
  {
    group: '个人',
    items: [
      {
        id: 'general',
        label: '常规',
        icon: SlidersHorizontal,
        keywords: ['pi', '路径', '版本', '重启', 'steering', 'follow', '压缩', '重试', '自动', '运行时', '语言', 'language']
      },
      {
        id: 'models',
        label: '模型',
        icon: Sparkles,
        keywords: [
          '模型',
          '推理',
          '强度',
          '默认',
          'thinking',
          'model',
          '添加',
          '自定义',
          '服务商',
          'provider',
          'api',
          'key',
          'baseurl',
          'ollama',
          'lmstudio',
          'vllm',
          'models.json'
        ]
      },
      {
        id: 'tools',
        label: '工具与技能',
        icon: Wrench,
        keywords: ['工具', 'bash', 'read', 'edit', 'write', 'grep', 'find', 'ls', '技能', '工具卡', '跟随']
      },
      {
        id: 'appearance',
        label: '外观',
        icon: Palette,
        keywords: ['主题', '深色', '浅色', '外观', 'theme']
      },
      {
        id: 'sessions',
        label: '会话',
        icon: MessagesSquare,
        keywords: ['会话', '存储', '目录', '工作区', '数量', '刷新', '记录']
      }
    ]
  },
  {
    group: '应用',
    items: [
      {
        id: 'shortcuts',
        label: '键盘快捷键',
        icon: Keyboard,
        keywords: ['快捷键', '键盘', 'shortcut', '按键']
      },
      {
        id: 'about',
        label: '关于',
        icon: Info,
        keywords: ['关于', '版本', 'electron', '平台', '设置文件']
      }
    ]
  }
]

function normalize(text: string): string {
  return text.toLowerCase()
}

function matches(query: string, ...terms: (string | undefined)[]): boolean {
  if (!query) return true
  const q = normalize(query)
  return terms.some((term) => term && normalize(term).includes(q))
}

function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={clsx('switch', checked && 'on')}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  )
}

function Select({
  value,
  onChange,
  options,
  label
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string; group?: string }[]
  label: string
}): ReactNode {
  const selected = options.find((option) => option.value === value)
  const menuWidth = useMemo(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return 180
    context.font = `12.2px ${getComputedStyle(document.body).fontFamily}`
    const widest = Math.max(0, ...options.map((option) => Math.max(
      context.measureText(option.label).width,
      option.group ? context.measureText(option.group).width : 0
    )))
    return Math.min(320, Math.max(140, Math.ceil(widest + 64)))
  }, [options])
  return (
    <Popover
      align="right"
      width={menuWidth}
      className="settings-select"
      trigger={(_open, toggle, expanded) => (
        <button type="button" className="settings-select-button" aria-label={label} title={selected?.label} onClick={toggle} {...expanded}>
          <span>{selected?.label ?? value}</span>
          <ChevronDown size={13} />
        </button>
      )}
    >
      {(close) => (
        <div className="menu">
          <div className="menu-list">
            {options.map((option, index) => (
              <div key={`${option.group ?? ''}:${option.value}`}>
                {option.group && option.group !== options[index - 1]?.group && (
                  <div className="menu-group-label">{option.group}</div>
                )}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.value === value}
                  title={option.label}
                  className={clsx('menu-item', option.value === value && 'active')}
                  onClick={() => {
                    if (option.value !== value) onChange(option.value)
                    close()
                  }}
                >
                  <span className="menu-item-main"><span className="menu-item-title">{option.label}</span></span>
                  {option.value === value && <Check size={14} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Popover>
  )
}

function Row({
  title,
  desc,
  query,
  children
}: {
  title: string
  desc?: string
  query: string
  children?: ReactNode
}): ReactNode {
  if (!matches(query, title, desc)) return null
  return (
    <div className="setting-row">
      <div className="setting-main">
        <div className="setting-title">{title}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      {children && <div className="setting-control">{children}</div>}
    </div>
  )
}

function Block({
  title,
  query,
  terms,
  children
}: {
  title: string
  query: string
  terms: string[]
  children: ReactNode
}): ReactNode {
  if (!matches(query, title, ...terms)) return null
  return (
    <section className="settings-block">
      <h3>{title}</h3>
      <div className="settings-card">{children}</div>
    </section>
  )
}

export function SettingsPage(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const open = state.settingsOpen
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<CategoryId>('general')
  const [piModels, setPiModels] = useState<PiModelRow[] | null>(null)
  const [modelSearch, setModelSearch] = useState('')
  const [modelsBusy, setModelsBusy] = useState(false)
  const [modelsMessage, setModelsMessage] = useState<string | null>(null)
  const [customConfig, setCustomConfig] = useState<ModelsConfig | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const piSettings: PiSettings = state.piSettings
  const piPath = state.settings.piPath ?? state.boot?.piPath ?? ''
  const sessionsRoot = state.boot?.sessionsRoot ?? ''

  const visibleNav = useMemo(
    () =>
      NAV.map((group) => ({
        ...group,
        items: group.items.filter((item) => matches(query, item.label, t(item.label), ...item.keywords))
      })).filter((group) => group.items.length > 0),
    [query, t]
  )

  useEffect(() => {
    if (!query) return
    const stillVisible = visibleNav.some((group) =>
      group.items.some((item) => item.id === active)
    )
    if (!stillVisible) {
      const first = visibleNav[0]?.items[0]
      if (first) setActive(first.id)
    }
  }, [query, visibleNav, active])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [active])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const loadModels = useMemo(
    () => async (): Promise<void> => {
      setModelsBusy(true)
      try {
        const [config, list] = await Promise.all([
          window.pi.readModelsConfig(),
          window.pi.listPiModels()
        ])
        setCustomConfig(config)
        setPiModels(list.models)
        setModelsMessage(list.error ?? config.error ?? null)
      } finally {
        setModelsBusy(false)
      }
    },
    []
  )

  useEffect(() => {
    if (!open || active !== 'models') return
    void loadModels()
  }, [open, active, loadModels])

  const modelGroups = useMemo(() => {
    const groups = new Map<string, { id: string; name: string }[]>()
    for (const model of state.models) {
      const list = groups.get(model.provider) ?? []
      list.push({ id: model.id, name: model.name })
      groups.set(model.provider, list)
    }
    // No live session (or it has not answered yet): fall back to pi's own
    // `--list-models` output so the default model can still be chosen.
    if (groups.size === 0) {
      for (const row of piModels ?? []) {
        const list = groups.get(row.provider) ?? []
        if (!list.some((model) => model.id === row.id)) list.push({ id: row.id, name: row.id })
        groups.set(row.provider, list)
      }
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [state.models, piModels])

  if (!open) return null

  const close = (): void => actions.openSettings(false)

  const selectCategory = (id: CategoryId): void => {
    setActive(id)
    setQuery('')
  }

  const choosePiPath = async (): Promise<void> => {
    const file = await window.pi.pickFile({
      title: 'Select the pi executable',
      defaultPath: piPath
    })
    if (!file) return
    await actions.updateSettings({ piPath: file })
    actions.notify('success', t('已更新 pi 路径'), t('重启会话后生效。'))
  }

  const restart = async (): Promise<void> => {
    if (!state.workspace) return
    close()
    await actions.openSession(state.workspace, state.sessionPath)
  }

  const saveDefaultModel = async (value: string): Promise<void> => {
    if (!value) return
    const [provider, id] = value.split('\u0000')
    await actions.updatePiSettings({ defaultProvider: provider, defaultModel: id })
    actions.notify('success', t('已更新默认模型'), t('新建会话时生效。'))
  }

  const modelValue =
    piSettings.defaultProvider && piSettings.defaultModel
      ? `${piSettings.defaultProvider}\u0000${piSettings.defaultModel}`
      : ''

  const refreshCatalog = async (): Promise<void> => {
    setModelsBusy(true)
    try {
      const result = await window.pi.refreshModelCatalog()
      actions.notify(
        result.ok ? 'success' : 'error',
        result.ok ? t('模型目录已更新') : t('模型目录更新失败'),
        result.output.slice(0, 240) || undefined
      )
      await loadModels()
    } finally {
      setModelsBusy(false)
    }
  }

  const saveProviderDraft = async (): Promise<void> => {
    if (!draft.id.trim()) {
      actions.notify('error', t('缺少服务商 ID'), t('例如 ollama、my-gateway。'))
      return
    }
    setSaving(true)
    try {
      const next = await window.pi.saveProvider(draft.id, draftToEntry(draft))
      setCustomConfig(next)
      setShowAdd(false)
      setDraft(EMPTY_DRAFT)
      actions.notify('success', t('已写入 models.json'), state.settings.language === 'en' ? `${next.file} · Restart the session to load changes.` : `${next.file} · 重启会话后 pi 才会加载。`)
      if (!state.streaming) await actions.restartSession()
      await loadModels()
    } catch (error) {
      actions.notify('error', t('保存失败'), error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const deleteProvider = async (id: string): Promise<void> => {
    try {
      const next = await window.pi.removeProvider(id)
      setCustomConfig(next)
      actions.notify('success', state.settings.language === 'en' ? `Removed ${id}` : `已移除 ${id}`, t('重启会话后生效。'))
      if (!state.streaming) await actions.restartSession()
      await loadModels()
    } catch (error) {
      actions.notify('error', t('删除失败'), error instanceof Error ? error.message : String(error))
    }
  }

  const thinkingValue = piSettings.defaultThinkingLevel ?? ''
  const steering = state.piState?.steeringMode ?? piSettings.steeringMode ?? 'one-at-a-time'
  const followUp = state.piState?.followUpMode ?? piSettings.followUpMode ?? 'one-at-a-time'
  const autoCompaction =
    state.piState?.autoCompactionEnabled ?? piSettings.compaction?.enabled ?? true
  const autoRetry = piSettings.retry?.enabled ?? true
  const enabledTools = piSettings.defaultTools ?? DEFAULT_TOOLS
  const toolsExplicit = Array.isArray(piSettings.defaultTools)

  const toggleTool = async (name: string, on: boolean): Promise<void> => {
    const next = new Set(enabledTools)
    if (on) next.add(name)
    else next.delete(name)
    await actions.updatePiSettings({ defaultTools: [...next] })
  }

  const renderGeneral = (): ReactNode => (
    <>
      <Block title={t("语言")} query={query} terms={['界面语言', 'language', '中文', 'english']}>
        <Row title={t("界面语言")} desc={t("选择应用界面显示的语言。")} query={query}>
          <Select
            label={t("界面语言")}
            value={state.settings.language ?? 'zh-CN'}
            onChange={(language) => void actions.updateSettings({ language: language as 'zh-CN' | 'en' })}
            options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]}
          />
        </Row>
      </Block>
      <Block title={t("Pi 运行时")} query={query} terms={['路径', '版本', '重启', '可执行文件']}>
        <Row
          title={t("Pi 可执行文件")}
          desc={t("启动 pi 子进程时使用；更换后需要重启会话。")}
          query={query}
        >
          <span className="setting-value" title={piPath}>
            {shortenPath(piPath, state.boot?.home)}
          </span>
          <button className="settings-button" onClick={() => void choosePiPath()}>{t("更改")}</button>
        </Row>
        <Row title={t("检测到的版本")} desc={t("来自当前 pi 可执行文件。")} query={query}>
          <span className={clsx('settings-pill', state.boot?.piVersion ? 'ok' : 'warn')}>
            {state.boot?.piVersion ?? t("未检测到")}
          </span>
          <button className="settings-button" onClick={() => void restart()}>
            <RotateCw size={12} />{t("重启会话")}</button>
        </Row>
      </Block>

      <Block
        title={t("会话行为")}
        query={query}
        terms={['steering', 'follow', '排队', '自动压缩', '自动重试', '重试']}
      >
        <Row
          title={t("Steering 消息投递")}
          desc={t("运行中插入的指令：一次性全部投递，还是每轮投递一条。")}
          query={query}
        >
          <Select
            label={t("Steering 模式")}
            value={steering}
            onChange={(value) =>
              void actions.setSteeringMode(value as 'all' | 'one-at-a-time')
            }
            options={[{ value: 'one-at-a-time', label: t('逐条投递') }, { value: 'all', label: t('全部投递') }]}
          />
        </Row>
        <Row
          title={t("Follow-up 消息投递")}
          desc={t("任务结束后排队的消息：一次性全部投递，还是每轮投递一条。")}
          query={query}
        >
          <Select
            label={t("Follow-up 模式")}
            value={followUp}
            onChange={(value) =>
              void actions.setFollowUpMode(value as 'all' | 'one-at-a-time')
            }
            options={[{ value: 'one-at-a-time', label: t('逐条投递') }, { value: 'all', label: t('全部投递') }]}
          />
        </Row>
        <Row
          title={t("自动压缩上下文")}
          desc={t("上下文接近上限时自动摘要历史，避免请求被截断。")}
          query={query}
        >
          <Switch
            label={t("自动压缩上下文")}
            checked={autoCompaction}
            onChange={(value) => void actions.setAutoCompaction(value)}
          />
        </Row>
        <Row
          title={t("自动重试")}
          desc={t("遇到限流、过载或 5xx 时按指数退避重试。")}
          query={query}
        >
          <Switch
            label={t("自动重试")}
            checked={autoRetry}
            onChange={(value) => void actions.setAutoRetry(value)}
          />
        </Row>
      </Block>
    </>
  )

  const renderModels = (): ReactNode => {
    const customEntries = Object.entries(customConfig?.providers ?? {})
    const text = modelSearch.trim().toLowerCase()
    const rows = (piModels ?? []).filter(
      (row) => !text || `${row.provider}/${row.id}`.toLowerCase().includes(text)
    )
    const providers = new Set((piModels ?? []).map((row) => row.provider))
    const current = state.piState?.model

    return (
      <>
        <Block title={t("新会话默认值")} query={query} terms={['默认模型', '推理强度', 'thinking']}>
        <Row
          title={t("默认模型")}
          desc={t("新建会话时使用；当前会话仍可在输入框里随时切换。")}
          query={query}
        >
          <Select label={t("默认模型")} value={modelValue} onChange={(value) => void saveDefaultModel(value)}
            options={[{ value: '', label: t('跟随 pi 配置') }, ...modelGroups.flatMap(([provider, models]) => models.map((model) => ({ value: `${provider}\u0000${model.id}`, label: model.name, group: provider })))]}
          />
        </Row>
        <Row
          title={t("默认推理强度")}
          desc={t("新会话启动时的 thinking level，可在底部选择器临时覆盖。")}
          query={query}
        >
          <Select
            label={t("默认推理强度")}
            value={thinkingValue}
            onChange={(value) =>
              void actions.updatePiSettings({
                defaultThinkingLevel: (value || undefined) as ThinkingLevel | undefined
              })
            }
            options={[{ value: '', label: t('跟随 pi 配置') }, ...(Object.keys(THINKING_LABELS) as ThinkingLevel[]).map((level) => ({ value: level, label: level === 'off' ? (state.settings.language === 'en' ? 'Off' : '关闭') : t(THINKING_LABELS[level]) }))]}
          />
        </Row>
      </Block>

      <Block title={t("当前模型")} query={query} terms={['上下文', '模型信息', '窗口']}>
        <Row
          title={state.piState?.model?.name ?? t("未选择模型")}
          desc={
            state.piState?.model
              ? `${state.piState.model.provider} · ${t('上下文')} ${Math.round(
                  (state.piState.model.contextWindow ?? 0) / 1000
                )}k · ${t('思维')} ${state.piState.model.reasoning ? t("支持") : t("不支持")}`
              : t("打开一个会话后显示")
          }
          query={query}
        >
          {state.piState?.model && (
            <span className="settings-pill">{state.piState.thinkingLevel}</span>
          )}
        </Row>
      </Block>

      <Block title={t("pi 支持的模型")} query={query} terms={['模型列表', '目录', '刷新', '可用']}>
        <div className="model-catalog-head">
          <div className="settings-search model-search">
            <Search size={13} />
            <input
              value={modelSearch}
              placeholder={t("搜索模型或服务商")}
              onChange={(event) => setModelSearch(event.target.value)}
            />
            {modelSearch && (
              <button className="search-clear" onClick={() => setModelSearch('')} aria-label={t("清除")}>
                <X size={11} />
              </button>
            )}
          </div>
          <button className="settings-button" disabled={modelsBusy} onClick={() => void loadModels()}>
            <RefreshCw size={12} />{t("重新读取")}</button>
          <button
            className="settings-button"
            disabled={modelsBusy}
            onClick={() => void refreshCatalog()}
          >{t("更新目录")}</button>
        </div>
        <p className="settings-note model-note">
          {state.settings.language === 'en' ? 'From ' : '来自 '}<code>pi --list-models</code>：{rows.length} / {piModels?.length ?? 0}
          {state.settings.language === 'en' ? ` models, ${providers.size} providers. Only models with credentials configured in pi are shown.` : ` 个模型，${providers.size} 个服务商。只包含已在 pi 中配置好凭证的模型。`}
        </p>
        {modelsMessage && <p className="settings-note model-error">{modelsMessage}</p>}
        <div className="model-list">
          {rows.map((row) => {
            const isCurrent = current?.provider === row.provider && current?.id === row.id
            return (
              <div
                className={clsx('model-row', isCurrent && 'current')}
                key={`${row.provider}/${row.id}`}
              >
                <span className="model-row-id">{row.id}</span>
                <span className="model-row-provider">{row.provider}</span>
                <span className="model-badges">
                  <span className="model-badge">{row.context}</span>
                  {row.thinking && <span className="model-badge">{t("思维")}</span>}
                  {row.images && <span className="model-badge">{t("图片")}</span>}
                </span>
              </div>
            )
          })}
          {piModels && rows.length === 0 && (
            <div className="model-empty">{t("没有匹配的模型。")}</div>
          )}
        </div>
      </Block>

      <Block
        title={t("自定义服务商与模型")}
        query={query}
        terms={['添加模型', 'models.json', 'baseurl', 'api key', 'ollama', 'lmstudio', 'vllm', '端点']}
      >
        <div className="custom-provider-list">
          {customEntries.length === 0 && (
            <div className="model-empty">{t("还没有自定义服务商。pi 默认使用内置目录与登录凭证。")}</div>
          )}
          {customEntries.map(([id, provider]) => (
            <div className="custom-provider" key={id}>
              <div className="custom-provider-main">
                <div className="setting-title">
                  {provider.name ?? id}
                  {provider.name && <code className="custom-provider-id">{id}</code>}
                </div>
                <div className="setting-desc">
                  {provider.baseUrl ?? t("跟随内置端点")} · {provider.api ?? t("跟随内置协议")}
                  {provider.apiKey ? (state.settings.language === 'en' ? ' · API key configured' : ' · 已设置 API Key') : ''}
                </div>
                <div className="model-badges">
                  {(provider.models ?? []).map((model) => (
                    <span className="model-badge" key={model.id}>
                      {model.id}
                    </span>
                  ))}
                </div>
              </div>
              <button
                className="settings-button danger"
                onClick={() => void deleteProvider(id)}
                title={state.settings.language === 'en' ? `Remove ${id} from models.json` : `从 models.json 移除 ${id}`}
              >
                <Trash2 size={12} />{t("移除")}</button>
            </div>
          ))}
        </div>

        {!showAdd && (
          <div className="custom-provider-actions">
            <button className="settings-button primary" onClick={() => setShowAdd(true)}>
              <Plus size={12} />{t("添加服务商 / 模型")}</button>
            <span className="setting-desc">
              {state.settings.language === 'en' ? 'Writes to ' : '写入 '}<code>{customConfig?.file ?? '~/.pi/agent/models.json'}</code>{state.settings.language === 'en' ? ' in pi models.json format.' : '，格式即 pi 的 models.json'}
            </span>
          </div>
        )}

        {showAdd && (
          <div className="provider-form">
            <div className="preset-row">
              {PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  className={clsx('preset-chip', draft.preset === preset.key && 'active')}
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      preset: preset.key,
                      id: preset.provider || prev.id,
                      baseUrl: preset.baseUrl || prev.baseUrl,
                      api: preset.api,
                      apiKey: preset.apiKey || prev.apiKey
                    }))
                  }
                >
                        {t(preset.label)}
                </button>
              ))}
            </div>

            <div className="form-grid">
              <label className="form-field">
                <span>{t("服务商 ID *")}</span>
                <input
                  value={draft.id}
                  placeholder="ollama"
                  onChange={(event) => setDraft((prev) => ({ ...prev, id: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>{t("显示名")}</span>
                <input
                  value={draft.name}
                  placeholder={t("可选")}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                />
              </label>
              <label className="form-field wide">
                <span>Base URL</span>
                <input
                  value={draft.baseUrl}
                  placeholder="http://localhost:11434/v1"
                  onChange={(event) => setDraft((prev) => ({ ...prev, baseUrl: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>{t("API 协议")}</span>
                <Select
                  label={t("API 协议")}
                  value={draft.api}
                  onChange={(value) => setDraft((prev) => ({ ...prev, api: value }))}
                  options={API_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
                />
              </label>
              <label className="form-field wide">
                <span>API Key</span>
                <input
                  value={draft.apiKey}
                  placeholder={t("$MY_API_KEY 或直接填 key；本地服务可留空或填占位")}
                  onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
                />
              </label>
              <label className="form-field wide">
                <span>{t("模型 ID（每行一个，或用逗号分隔）*")}</span>
                <textarea
                  rows={2}
                  value={draft.modelIds}
                  placeholder="qwen2.5-coder:7b"
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, modelIds: event.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                <span>{t("上下文窗口")}</span>
                <input
                  value={draft.contextWindow}
                  placeholder="128000"
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, contextWindow: event.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                <span>{t("最大输出")}</span>
                <input
                  value={draft.maxTokens}
                  placeholder="16384"
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, maxTokens: event.target.value }))
                  }
                />
              </label>
            </div>

            <div className="form-switches">
              <Row title={t("支持推理 / 思维链")} query="">
                <Switch
                  label={t("支持推理")}
                  checked={draft.reasoning}
                  onChange={(value) => setDraft((prev) => ({ ...prev, reasoning: value }))}
                />
              </Row>
              <Row title={t("支持图片输入")} query="">
                <Switch
                  label={t("支持图片输入")}
                  checked={draft.images}
                  onChange={(value) => setDraft((prev) => ({ ...prev, images: value }))}
                />
              </Row>
            </div>

            <div className="form-actions">
              <button className="settings-button primary" disabled={saving} onClick={() => void saveProviderDraft()}>
                {saving ? t("保存中…") : t("保存到 models.json")}
              </button>
              <button
                className="settings-button"
                onClick={() => {
                  setShowAdd(false)
                  setDraft(EMPTY_DRAFT)
                }}
              >{t("取消")}</button>
              <span className="setting-desc">{t("保存后会重启当前会话，让 pi 重新加载模型。")}</span>
            </div>
          </div>
        )}
      </Block>
    </>
  )
  }

  const renderTools = (): ReactNode => (
    <>
      <Block
        title={t("内置工具")}
        query={query}
        terms={['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', '工具列表']}
      >
        {BUILTIN_TOOLS.map((tool) => (
          <Row
            key={tool.name}
            title={tool.name}
            desc={t(tool.desc)}
            query={query}
          >
            <Switch
              label={state.settings.language === 'en' ? `Enable ${tool.name}` : `启用 ${tool.name}`}
              checked={enabledTools.includes(tool.name)}
              onChange={(value) => void toggleTool(tool.name, value)}
            />
          </Row>
        ))}
      </Block>
      <p className="settings-note">
        {toolsExplicit
          ? t("已自定义工具列表，重启会话后按新列表加载。")
          : t("当前使用 pi 默认工具集；修改后会写入 pi 设置，重启会话生效。")}
      </p>

      <Block
        title={t("桌面显示")}
        query={query}
        terms={['工具卡', '展开', '跟随', '流式', '滚动']}
      >
        <Row title={t("工具调用默认展开")} desc={t("工具卡片显示完整输出，而不是折叠成一行。")} query={query}>
          <Switch
            label={t("工具调用默认展开")}
            checked={Boolean(state.settings.toolCardsExpanded)}
            onChange={(value) => void actions.updateSettings({ toolCardsExpanded: value })}
          />
        </Row>
        <Row
          title={t("流式输出自动跟随")}
          desc={t("新内容到达时保持滚动在底部；关闭后只在你发送消息时跳转。")}
          query={query}
        >
          <Switch
            label={t("流式输出自动跟随")}
            checked={state.settings.followStream !== false}
            onChange={(value) => void actions.updateSettings({ followStream: value })}
          />
        </Row>
      </Block>

      <Block
        title={t("对话显示")}
        query={query}
        terms={['折叠', '收起', '轮次', '思考', '摘要', 'turn', 'fold']}
      >
        <Row
          title={t("结论出现后收起过程")}
          desc={t("每一步工具调用仍可展开；收起状态会按会话记住。")}
          query={query}
        >
          <Switch
            label={t("结论出现后收起过程")}
            checked={state.settings.turnAutoFold !== false}
            onChange={(value) => void actions.updateSettings({ turnAutoFold: value })}
          />
        </Row>
        <Row
          title={t("更早的轮次聚合")}
          desc={t("主视图只保留最近几轮，更早的收成一行。")}
          query={query}
        >
          <Select
            label={t("更早的轮次聚合")}
            value={String(state.settings.turnAggregate ?? 5)}
            onChange={(value) => void actions.updateSettings({ turnAggregate: Number(value) })}
            options={[
              { value: '3', label: t('3 轮') },
              { value: '5', label: t('5 轮') },
              { value: '8', label: t('8 轮') },
              { value: '12', label: t('12 轮') },
              { value: '200', label: t('不聚合') }
            ]}
          />
        </Row>
        <Row
          title={t("完成时发系统通知")}
          desc={t("窗口在后台时，长任务结束会发一条系统通知。")}
          query={query}
        >
          <Switch
            label={t("完成时发系统通知")}
            checked={state.settings.notifyOnFinish !== false}
            onChange={(value) => void actions.updateSettings({ notifyOnFinish: value })}
          />
        </Row>
        <Row
          title={t("思考内容")}
          desc={t("summary 折叠成一行，full 直接展开，off 完全不显示。")}
          query={query}
        >
          <Select
            label={t("思考内容")}
            value={state.settings.thinkingDisplay ?? 'summary'}
            onChange={(value) =>
              void actions.updateSettings({
                thinkingDisplay: value as 'off' | 'summary' | 'full'
              })
            }
            options={[
              { value: 'summary', label: t('折叠显示') },
              { value: 'full', label: t('总是展开') },
              { value: 'off', label: t('完全隐藏') }
            ]}
          />
        </Row>
      </Block>
    </>
  )

  const renderAppearance = (): ReactNode => (
    <Block title={t("主题")} query={query} terms={['深色', '浅色', '外观']}>
      <div className="setting-row stack">
        <div className="setting-main">
          <div className="setting-title">{t("界面主题")}</div>
          <div className="setting-desc">{t("深色为暖调纸墨；浅色适合白天和投屏。")}</div>
        </div>
        <div className="theme-cards">
          <button
            className={clsx('theme-card', state.settings.theme === 'dark' && 'active')}
            onClick={() => void actions.setTheme('dark')}
          >
            <span className="theme-preview dark">
              <span />
              <span />
              <span />
            </span>
            <span className="theme-name">{t("深色")}{state.settings.theme === 'dark' && <Check size={13} />}
            </span>
          </button>
          <button
            className={clsx('theme-card', state.settings.theme === 'light' && 'active')}
            onClick={() => void actions.setTheme('light')}
          >
            <span className="theme-preview light">
              <span />
              <span />
              <span />
            </span>
            <span className="theme-name">{t("浅色")}{state.settings.theme === 'light' && <Check size={13} />}
            </span>
          </button>
        </div>
      </div>
    </Block>
  )

  const renderSessions = (): ReactNode => (
    <>
      <Block title={t("存储")} query={query} terms={['目录', '文件夹', '记录', '会话位置']}>
        <Row title={t("会话存储目录")} desc={t("每次对话都会写成一个 JSONL 会话文件。")} query={query}>
          <span className="setting-value" title={sessionsRoot}>
            {shortenPath(sessionsRoot, state.boot?.home)}
          </span>
          <button
            className="settings-button"
            onClick={() => sessionsRoot && actions.revealSession(sessionsRoot)}
          >
            <FolderSearch size={12} />{t("显示")}</button>
        </Row>
        <Row title={t("会话数量")} desc={t("已缓存的会话文件，由最近修改时间排序。")} query={query}>
          <span className="setting-value">{state.sessions.length}</span>
          <button className="settings-button" onClick={() => void actions.refreshSessions()}>
            <RotateCw size={12} />{t("刷新")}</button>
        </Row>
      </Block>

      <Block title={t("当前工作区")} query={query} terms={['项目', '目录', '工作区']}>
        <Row
          title={shortenPath(state.workspace, state.boot?.home) || t("未打开项目")}
          desc={t("新会话会在这个目录下运行 pi。")}
          query={query}
        >
          <button className="settings-button" onClick={() => void actions.pickFolder()}>{t("更改")}</button>
        </Row>
        <Row
          title={t("当前会话")}
          desc={state.sessionPath ? shortenPath(state.sessionPath, state.boot?.home) : t("尚未开始")}
          query={query}
        >
          {state.sessionPath && (
            <button
              className="settings-button"
              onClick={() => state.sessionPath && actions.revealSession(state.sessionPath)}
            >
              <FolderSearch size={12} />{t("显示")}</button>
          )}
        </Row>
      </Block>
    </>
  )

  const renderShortcuts = (): ReactNode => (
    <Block title={t("快捷键")} query={query} terms={SHORTCUTS.map((item) => item.label)}>
      {SHORTCUTS.map((shortcut) => (
        <Row key={shortcut.keys} title={t(shortcut.label)} query={query}>
          <kbd>{shortcut.keys}</kbd>
        </Row>
      ))}
    </Block>
  )

  const renderAbout = (): ReactNode => (
    <>
      <Block title={t("版本")} query={query} terms={['electron', '平台', 'pi']}>
        <Row title="Pi Desktop" query={query}>
          <span className="setting-value">{state.boot?.appVersion ?? '0.1.0'}</span>
        </Row>
        <Row title="pi" query={query}>
          <span className="setting-value">{state.boot?.piVersion ?? t("未检测到")}</span>
        </Row>
        <Row title="Electron" query={query}>
          <span className="setting-value">{state.boot?.electronVersion ?? '—'}</span>
        </Row>
        <Row title={t("平台")} query={query}>
          <span className="setting-value">{state.boot?.platform ?? '—'}</span>
        </Row>
      </Block>

      <Block title={t("配置文件")} query={query} terms={['settings.json', '设置文件', 'agent']}>
        <Row
          title={t("pi 设置文件")}
          desc={shortenPath(state.boot?.piSettingsFile, state.boot?.home)}
          query={query}
        >
          <button
            className="settings-button"
            onClick={() => state.boot?.piSettingsFile && actions.revealSession(state.boot.piSettingsFile)}
          >
            <FolderSearch size={12} />{t("显示")}</button>
        </Row>
      </Block>

      <Block title={t("链接")} query={query} terms={['pi.dev', '官网', '文档']}>
        <Row title={t("pi 官网与文档")} desc={t("协议、模型与扩展的完整说明。")} query={query}>
          <button
            className="settings-link"
            onClick={() => actions.openExternal('https://pi.dev')}
          >
            pi.dev <ArrowUpRight size={13} />
          </button>
        </Row>
      </Block>
    </>
  )

  const CONTENT: Record<CategoryId, { title: string; render: () => ReactNode }> = {
    general: { title: '常规', render: renderGeneral },
    models: { title: '模型', render: renderModels },
    tools: { title: '工具与技能', render: renderTools },
    appearance: { title: '外观', render: renderAppearance },
    sessions: { title: '会话', render: renderSessions },
    shortcuts: { title: '键盘快捷键', render: renderShortcuts },
    about: { title: '关于', render: renderAbout }
  }

  const current = CONTENT[active]
  const hasResults = visibleNav.length > 0

  return (
    <div className="settings-page" aria-label={t("Settings")}>
      <div className="settings-drag" />

      <aside className="settings-nav">
        <div className="settings-nav-header">
          <button className="settings-close" onClick={close} aria-label={t("返回对话")} title={t("返回对话")}>
            <ArrowLeft size={17} />
          </button>
          <h1>{t("设置")}</h1>
        </div>
        <div className="settings-search">
          <Search size={14} />
          <input
            value={query}
            placeholder={t("搜索设置")}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} aria-label={t("清空搜索")}>
              <X size={11} />
            </button>
          )}
        </div>

        <div className="settings-nav-scroll">
          {hasResults ? (
            visibleNav.map((group) => (
              <div className="settings-group" key={group.group}>
                <div className="settings-group-label">{t(group.group)}</div>
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      className={clsx('settings-nav-item', active === item.id && !query && 'active')}
                      onClick={() => selectCategory(item.id)}
                    >
                      <Icon size={15} />
                      <span>{t(item.label)}</span>
                    </button>
                  )
                })}
              </div>
            ))
          ) : (
            <div className="settings-empty">{t("没有匹配的设置")}</div>
          )}
        </div>

        <div className="settings-nav-footer">
          Pi Desktop {state.boot?.appVersion ?? '0.1.0'}
        </div>
      </aside>

      <main className="settings-content" ref={contentRef}>
        <div className="settings-content-inner">
          <h2 className="settings-page-title">{query ? t("搜索结果") : t(current.title)}</h2>
          {hasResults ? (
            current.render()
          ) : (
            <p className="settings-note">{t("换个关键词试试，比如「压缩」「工具」「模型」。")}</p>
          )}
        </div>
      </main>
    </div>
  )
}
