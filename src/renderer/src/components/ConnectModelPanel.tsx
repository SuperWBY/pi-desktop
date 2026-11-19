import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import clsx from 'clsx'
import { userFacingError } from '@shared/errors'
import { useTranslation } from '../i18n'
import { useApp } from '../store'

type Choice = { id: string; label: string; model: string; url: string }

const QUICK: Choice[] = [
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o-mini', url: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic', model: 'claude-sonnet-4-5', url: 'https://console.anthropic.com/settings/keys' },
  { id: 'google', label: 'Google', model: 'gemini-2.0-flash', url: 'https://aistudio.google.com/apikey' },
  { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat', url: 'https://platform.deepseek.com/api_keys' }
]

const MORE: Choice[] = [
  { id: 'openrouter', label: 'OpenRouter', model: 'openai/gpt-4o-mini', url: 'https://openrouter.ai/keys' },
  { id: 'groq', label: 'Groq', model: 'llama-3.3-70b-versatile', url: 'https://console.groq.com/keys' },
  { id: 'xai', label: 'xAI', model: 'grok-2-latest', url: 'https://console.x.ai/' },
  { id: 'mistral', label: 'Mistral', model: 'mistral-small-latest', url: 'https://console.mistral.ai/api-keys' }
]

const ALL = [...QUICK, ...MORE]

function modelFor(id: string): string {
  return ALL.find((item) => item.id === id)?.model ?? ''
}

function quietError(message: string): string {
  const cleaned = userFacingError(message, '暂时无法登录')
  if (/服务商|models\.json|pi /i.test(cleaned)) return '请检查接口地址'
  return cleaned || '暂时无法登录'
}

export function ConnectModelPanel({ onClose }: { onClose: () => void }): ReactNode {
  const t = useTranslation()
  const { actions } = useApp()
  const [tab, setTab] = useState<'key' | 'account'>('key')
  const [more, setMore] = useState(false)
  const [choice, setChoice] = useState<Choice>(QUICK[0])
  const [key, setKey] = useState('')
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<'idle' | 'ok' | 'bad'>('idle')
  const [error, setError] = useState('')
  const [custom, setCustom] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [customKey, setCustomKey] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([])
  const [accountStatus, setAccountStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [accountError, setAccountError] = useState('')
  const [running, setRunning] = useState(false)
  const [prompt, setPrompt] = useState<{ id: string; message: string; secret: boolean } | null>(null)
  const [answer, setAnswer] = useState('')
  const entered = useRef(false)
  const providerRef = useRef(choice.id)
  const tabRef = useRef(tab)
  const keyRef = useRef(key)
  const keyCheck = useRef(0)
  providerRef.current = choice.id
  tabRef.current = tab
  keyRef.current = key

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const enter = async (provider: string, model: string): Promise<void> => {
    if (entered.current || !model) return
    entered.current = true
    try {
      await actions.updatePiSettings({ defaultProvider: provider, defaultModel: model })
      await actions.newScratchSession()
    } catch (error) {
      entered.current = false
      throw error
    }
  }

  useEffect(() => {
    if (tab !== 'key' || key.trim().length < 12) {
      setChecking(false)
      return
    }
    const secret = key.trim()
    const provider = choice.id
    const model = choice.model
    const token = ++keyCheck.current
    const stillCurrent = (): boolean =>
      token === keyCheck.current &&
      providerRef.current === provider &&
      tabRef.current === 'key' &&
      keyRef.current.trim() === secret
    setChecking(true)
    setError('')
    setStatus('idle')
    const timer = window.setTimeout(() => {
      void window.pi.validateApiKey(provider, secret).then(async (result) => {
        if (!stillCurrent()) return
        setChecking(false)
        if (!result.ok) {
          setStatus('bad')
          setError(t(result.error))
          return
        }
        setStatus('ok')
        try {
          if (!stillCurrent()) return
          await window.pi.saveApiKey(provider, secret)
          if (!stillCurrent()) return
          await enter(provider, model)
        } catch (reason) {
          if (!stillCurrent()) return
          entered.current = false
          setChecking(false)
          setStatus('bad')
          setError(t(quietError(reason instanceof Error ? reason.message : String(reason))))
        }
      }).catch(() => {
        if (!stillCurrent()) return
        setChecking(false)
        setStatus('bad')
        setError(t('无法连接，请检查网络'))
      })
    }, 400)
    return () => {
      window.clearTimeout(timer)
      keyCheck.current += 1
      setChecking(false)
    }
  }, [key, choice, tab])

  useEffect(() => {
    if (tab !== 'account') return
    setAccountStatus('loading')
    setAccountError('')
    void window.pi.listOAuthProviders()
      .then((list) => {
        const next = list.filter((item) => item.oauth).map((item) => ({ id: item.id, name: item.name }))
        setProviders(next)
        setAccountStatus(next.length ? 'ready' : 'unavailable')
      })
      .catch(() => {
        setProviders([])
        setAccountStatus('unavailable')
      })
  }, [tab])

  useEffect(() => {
    return window.pi.onOAuthEvent((event) => {
      const kind = String(event.type ?? '')
      if (kind === 'prompt') {
        const body = event.prompt as { message?: string; type?: string } | undefined
        setPrompt({ id: String(event.id ?? ''), message: String(body?.message ?? ''), secret: body?.type === 'secret' })
        setAnswer('')
      } else if (kind === 'done') {
        setRunning(false)
        const id = providerRef.current
        void enter(id, modelFor(id) || 'gpt-4o-mini').catch((reason) => {
          entered.current = false
          setAccountError(t(quietError(reason instanceof Error ? reason.message : String(reason))))
        })
      } else if (kind === 'error') {
        setRunning(false)
        setPrompt(null)
        entered.current = false
        setAccountError(t(quietError(String(event.message ?? ''))))
      }
    })
  }, [t])

  const saveCustom = async (): Promise<void> => {
    setError('')
    const url = baseUrl.trim()
    const secret = customKey.trim()
    const model = customModel.trim()
    if (!url || !secret || !model) {
      setError(t('请检查接口地址'))
      return
    }
    try {
      await window.pi.saveProvider('custom', {
        name: 'Custom',
        baseUrl: url,
        api: 'openai-completions',
        apiKey: secret,
        models: [{ id: model }]
      })
      await window.pi.saveApiKey('custom', secret)
      await enter('custom', model)
    } catch (reason) {
      entered.current = false
      setError(t(quietError(reason instanceof Error ? reason.message : String(reason))))
    }
  }

  const startAccount = async (id: string): Promise<void> => {
    providerRef.current = id
    setChoice(ALL.find((item) => item.id === id) ?? { id, label: id, model: modelFor(id), url: '' })
    setAccountError('')
    setRunning(true)
    try {
      const result = await window.pi.startOAuth(id)
      if (!result.ok) {
        setRunning(false)
        setAccountError(t(quietError(result.error || '')))
      }
    } catch (reason) {
      setRunning(false)
      setAccountError(t(quietError(reason instanceof Error ? reason.message : String(reason))))
    }
  }

  const shown = more ? ALL : QUICK

  return (
    <div className="connect-model" role="dialog" aria-label={t('连接模型')}>
      <button type="button" className="connect-close" aria-label={t('关闭')} onClick={onClose}><X size={14} /></button>
      <div className="connect-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'key'} className={clsx(tab === 'key' && 'active')} onClick={() => setTab('key')}>API Key</button>
        <button type="button" role="tab" aria-selected={tab === 'account'} className={clsx(tab === 'account' && 'active')} onClick={() => setTab('account')}>{t('用账号登录')}</button>
      </div>

      {tab === 'key' ? (
        <div className="connect-body" role="tabpanel">
          <div className="connect-providers">
            {shown.map((item) => (
              <button key={item.id} type="button" className={clsx('connect-provider', choice.id === item.id && 'active')} onClick={() => { setChoice(item); setStatus('idle'); setError('') }}>
                <span>{item.label.slice(0, 1)}</span>
                {item.label}
              </button>
            ))}
            {!more && <button type="button" className="connect-provider" onClick={() => setMore(true)}>{t('更多')}</button>}
          </div>
          <label className="connect-key">
            <input
              type="password"
              autoFocus
              value={key}
              placeholder="API Key"
              aria-label="API Key"
              onChange={(event) => { setKey(event.target.value); setStatus('idle') }}
            />
            <span className="connect-key-state" aria-hidden="true">
              {checking ? <Loader2 size={14} className="spin" /> : status === 'ok' ? <Check size={14} /> : status === 'bad' ? <X size={14} /> : null}
            </span>
          </label>
          <button type="button" className="connect-get" onClick={() => void window.pi.openExternal(choice.url)}>{t('获取')} ›</button>
          {error ? <p className="connect-error" role="alert">{error}</p> : null}
          <button type="button" className="connect-custom" onClick={() => setCustom((value) => !value)}>{t('自定义接口')} ›</button>
          {custom && (
            <div className="connect-custom-fields">
              <input value={baseUrl} placeholder={t('接口地址')} aria-label={t('接口地址')} onChange={(event) => setBaseUrl(event.target.value)} />
              <input type="password" value={customKey} placeholder="API Key" aria-label="API Key" onChange={(event) => setCustomKey(event.target.value)} />
              <input value={customModel} placeholder={t('模型 ID')} aria-label={t('模型 ID')} onChange={(event) => setCustomModel(event.target.value)} />
              <button type="button" className="button primary" onClick={() => void saveCustom()}>{t('使用')}</button>
            </div>
          )}
        </div>
      ) : (
        <div className="connect-body" role="tabpanel">
          {accountStatus === 'loading' || accountStatus === 'idle' ? (
            <p className="connect-wait"><Loader2 size={14} className="spin" /></p>
          ) : accountStatus === 'unavailable' ? (
            <div className="connect-oauth-unavailable">
              <p>{t('当前版本暂不支持账号登录，请用 API Key')}</p>
              <button type="button" className="button primary" onClick={() => setTab('key')}>{t('使用 API Key')}</button>
            </div>
          ) : (
            <>
              <div className="connect-providers">
                {providers.map((item) => (
                  <button key={item.id} type="button" className="connect-provider" disabled={running} onClick={() => void startAccount(item.id)}>
                    <span>{item.name.slice(0, 1)}</span>
                    {item.name}
                  </button>
                ))}
              </div>
              {prompt && (
                <label className="connect-key">
                  <input
                    type={prompt.secret ? 'password' : 'text'}
                    value={answer}
                    aria-label={prompt.message || t('继续')}
                    onChange={(event) => setAnswer(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && answer) {
                        window.pi.respondOAuth(prompt.id, answer)
                        setPrompt(null)
                      }
                    }}
                  />
                </label>
              )}
              {running && !prompt ? <p className="connect-wait"><Loader2 size={14} className="spin" /></p> : null}
              {accountError ? <p className="connect-error" role="alert">{accountError}</p> : null}
            </>
          )}
        </div>
      )}
    </div>
  )
}
