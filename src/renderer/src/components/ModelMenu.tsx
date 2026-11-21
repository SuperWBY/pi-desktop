import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { Cable, Check, ChevronDown, ChevronLeft, Image, Settings2 } from 'lucide-react'
import clsx from 'clsx'
import type { ModelInfo } from '@shared/types'
import { useTranslation } from '../i18n'
import { formatTokens } from '../lib/format'
import { thinkingOptionsFor } from '../lib/thinking'
import { useApp } from '../store'

export const MODEL_PROVIDERS_WIDTH = 298

const PROVIDER_LABELS = new Map([
  ['anthropic', 'Anthropic'],
  ['deepseek', 'DeepSeek'],
  ['google', 'Google'],
  ['openai', 'OpenAI'],
  ['opencode', 'OpenCode'],
  ['opencode-go', 'OpenCode Go'],
  ['openrouter', 'OpenRouter'],
  ['volcengine', 'Volcengine Ark'],
  ['volcengine-ark', 'Volcengine Ark']
])

export function ModelMenu({ close, sideMenu }: { close: () => void; sideMenu: boolean }): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const current = state.piState?.model
  const [names, setNames] = useState<Map<string, string>>(() => new Map())
  const [browsedProvider, setBrowsedProvider] = useState<string | null>(null)
  const [providersOpen, setProvidersOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [changing, setChanging] = useState(false)
  const providerTrigger = useRef<HTMLButtonElement>(null)
  const providerList = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const modelList = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    void window.pi.readModelsConfig().then(({ providers }) => {
      if (!live) return
      setNames(new Map(Object.entries(providers).flatMap(([id, { name }]) => name?.trim() ? [[id, name.trim()]] : [])))
    }).catch(() => undefined)
    return () => { live = false }
  }, [])

  const providers = useMemo(() => [...new Set(state.models.map((model) => model.provider))].sort(
    (a, b) => displayName(a).localeCompare(displayName(b))
  ), [state.models, names])

  function displayName(provider: string): string {
    return names.get(provider) ?? PROVIDER_LABELS.get(provider) ?? provider
  }

  const provider = browsedProvider && providers.includes(browsedProvider) ? browsedProvider : current?.provider ?? providers[0]
  const filter = query.trim().toLowerCase()
  const models = useMemo(() => state.models.filter((model) => filter
    ? `${model.name} ${model.id} ${model.provider} ${displayName(model.provider)}`.toLowerCase().includes(filter)
    : model.provider === provider), [state.models, filter, provider, names])

  const activeIndex = models.findIndex((model) => model.provider === current?.provider && model.id === current?.id)
  useEffect(() => { setHighlight(Math.max(0, activeIndex)) }, [filter, provider, activeIndex])

  useEffect(() => {
    modelList.current?.querySelector<HTMLElement>('.highlight')?.scrollIntoView({ block: 'nearest' })
  }, [highlight, models])

  useEffect(() => {
    if (!providersOpen) return
    const list = providerList.current
    const target = list?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? list?.querySelector<HTMLElement>('.menu-item')
    target?.focus()
  }, [providersOpen])

  const closeProviders = (): void => {
    setProvidersOpen(false)
    providerTrigger.current?.focus()
  }

  const openSettings = (): void => {
    close()
    actions.openSettings(true)
    window.dispatchEvent(new CustomEvent('pi:settings-section', { detail: 'models' }))
  }

  const selectModel = async (model: ModelInfo): Promise<void> => {
    if (changing || state.streaming) return
    if (model.provider === current?.provider && model.id === current?.id) {
      close()
      return
    }
    setChanging(true)
    try {
      if (await actions.setModel(model)) close()
    } finally {
      setChanging(false)
    }
  }

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!models.length || changing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      const model = models[highlight] ?? models[0]
      if (model) void selectModel(model)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlight((index) => (index + step + models.length) % models.length)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setHighlight(event.key === 'Home' ? 0 : models.length - 1)
    }
  }

  const inlineProviders = providersOpen && !sideMenu
  const providerChoices = providersOpen && (
    <div id="model-provider-menu" ref={providerList}
      className={clsx('model-provider-menu', sideMenu && 'side')}
      style={{ width: sideMenu ? MODEL_PROVIDERS_WIDTH : undefined }}
      role="group" aria-label={t('模型供应商')}>
      <div className="model-provider-list">
        {providers.map((id) => (
          <button type="button" className={clsx('menu-item', id === provider && 'highlight')}
            key={id} title={id} aria-pressed={id === provider}
            disabled={changing}
            onClick={() => {
              setBrowsedProvider(id)
              setQuery('')
              closeProviders()
              search.current?.focus()
            }}>
            <Cable size={15} />
            <span className="menu-item-title">{displayName(id)}</span>
            {id === current?.provider && <Check className="model-selection-check" size={15} aria-label={t('当前使用')} />}
          </button>
        ))}
      </div>
      <button type="button" className="menu-item model-manage" onClick={openSettings}>
        <Settings2 size={15} />
        <span className="menu-item-title">{t('管理模型')}</span>
      </button>
    </div>
  )

  return (
    <div className="menu model-menu" onKeyDown={(event) => {
      if (event.key === 'Escape' && providersOpen) {
        event.preventDefault()
        event.stopPropagation()
        closeProviders()
      }
    }}>
      <button type="button" ref={providerTrigger} className="menu-item model-provider-trigger"
        onClick={() => setProvidersOpen((open) => !open)}
        aria-label={`${t('切换供应商')} · ${provider ? displayName(provider) : ''}`}
        aria-expanded={providersOpen} aria-controls="model-provider-menu"
        disabled={changing}>
        <Cable size={15} />
        <span className="menu-item-title">{provider ? displayName(provider) : t('模型供应商')}</span>
        {sideMenu ? <ChevronLeft size={14} /> : <ChevronDown size={14} />}
      </button>
      {providerChoices}
      {!inlineProviders && <>
        <div className="menu-search model-search">
          <input
            ref={search}
            value={query}
            placeholder={t('搜索模型或供应商…')}
            role="combobox"
            aria-expanded="true"
            aria-controls="model-menu-list"
            aria-activedescendant={models[highlight] ? `model-opt-${highlight}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlight(0)
            }}
            onKeyDown={onSearchKey}
          />
        </div>
        <div className="menu-list" id="model-menu-list" role="listbox" aria-label={t('模型')} ref={modelList}>
          {models.length === 0 && (
            <div className="menu-empty">
              {state.models.length
                ? t('没有匹配的模型')
                : <button type="button" className="menu-empty-action" onClick={openSettings}>{t('配置模型')}</button>}
            </div>
          )}
          {models.map((model, index) => {
            const selected = index === activeIndex
            const detail = [model.name, displayName(model.provider), model.contextWindow && `${formatTokens(model.contextWindow)} ${t('上下文')}`].filter(Boolean).join(' · ')
            return (
              <button key={`${model.provider}/${model.id}`} id={`model-opt-${index}`} type="button"
                role="option" aria-selected={selected}
                className={clsx('menu-item model-option', selected && 'current', index === highlight && 'highlight')}
                title={detail} disabled={changing || state.streaming}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => void selectModel(model)}>
                <span className="model-option-name">
                  <span className="menu-item-title">{model.name}</span>
                  {model.input?.includes('image') && <span className="model-option-vision" title={t('支持图片输入')}>{t('视觉')}</span>}
                  {model.output?.includes('image') && (
                    <span className="model-image-capability" role="img" aria-label={t('支持生成图片')} title={t('支持生成图片')}>
                      <Image size={14} aria-hidden="true" />
                    </span>
                  )}
                </span>
                {filter && <span className="model-option-source">{displayName(model.provider)}</span>}
                {selected && <Check className="model-selection-check" size={15} />}
              </button>
            )
          })}
        </div>
        {current?.provider === provider && !changing && <ThinkingSlider />}
      </>}
    </div>
  )
}

function ThinkingSlider(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const current = state.piState?.model
  const options = thinkingOptionsFor(state.levels, state.settings.language)
  const active = options.findIndex((option) => option.value === state.piState?.thinkingLevel)
  const [preview, setPreview] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const pointerStart = useRef<number | null>(null)
  const pending = useRef<object | null>(null)
  if (!current?.reasoning || active < 0) return null

  const position = preview ?? active
  const apply = async (index: number): Promise<void> => {
    const value = options[index]?.value
    if (!value || (!pending.current && index === active)) {
      setPreview(null)
      return
    }
    const request = {}
    pending.current = request
    setPreview(index)
    try {
      await actions.setThinking(value)
    } finally {
      if (pending.current === request) {
        pending.current = null
        if (pointerStart.current === null) setPreview(null)
      }
    }
  }

  return (
    <div className="thinking-effort">
      <div className="thinking-effort-label">
        <span>{t('思考程度')}</span>
        <strong>{options[position]?.label ?? options[active].label}</strong>
      </div>
      {options.length > 1 && <>
        <div className={clsx('thinking-slider-track', dragging && 'dragging')}
          style={{ '--thinking-progress': position / (options.length - 1) } as CSSProperties}>
          <input type="range" className="thinking-slider"
            min={0} max={options.length - 1} step={1} value={position}
            aria-label={t('思考程度')} aria-valuetext={options[position]?.label}
            disabled={state.streaming}
            onPointerDown={(event) => { pointerStart.current = event.clientX }}
            onPointerMove={(event) => {
              if (pointerStart.current !== null && Math.abs(event.clientX - pointerStart.current) > 3) setDragging(true)
            }}
            onPointerUp={(event) => {
              pointerStart.current = null
              setDragging(false)
              void apply(event.currentTarget.valueAsNumber)
            }}
            onPointerCancel={() => {
              pointerStart.current = null
              setDragging(false)
              setPreview(null)
            }}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber
              if (pointerStart.current !== null) setPreview(value)
              else void apply(value)
            }}
          />
        </div>
        <div className="thinking-slider-labels">
          {options.map(({ value, label }, index) => (
            <button key={value} type="button" tabIndex={-1} aria-pressed={index === active}
              style={{ '--thinking-tick': index / (options.length - 1) } as CSSProperties}
              className={index === position ? 'selected' : undefined} disabled={state.streaming}
              onClick={() => void apply(index)}>{label}</button>
          ))}
        </div>
      </>}
    </div>
  )
}
