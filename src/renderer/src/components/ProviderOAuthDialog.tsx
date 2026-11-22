import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react'
import clsx from 'clsx'
import { userFacingError } from '@shared/errors'
import { useTranslation } from '../i18n'
import { useApp } from '../store'
import { Modal } from './ui'
import { DesktopSelect } from './DesktopSelect'

type Provider = { id: string; name: string; oauth: boolean; apiKey: boolean }
type Prompt = { id: string; prompt: { type: 'text' | 'secret' | 'select' | 'manual_code'; message: string; placeholder?: string; options?: { id: string; label: string; description?: string }[] } }
type Phase = 'loading' | 'ready' | 'unavailable' | 'error' | 'running'

function isUnavailableMessage(message: string): boolean {
  return /暂不支持账号登录|内置 Pi runtime|认证模块|OAUTH_UNAVAILABLE/i.test(message)
}

export function ProviderOAuthDialog({ open, onClose, onSaved, onUseApiKey, initialProvider }: {
  open: boolean
  onClose: () => void
  onSaved: (provider: string) => void
  initialProvider?: string
  onUseApiKey?: () => void
}): ReactNode {
  const t = useTranslation()
  const { actions } = useApp()
  const [phase, setPhase] = useState<Phase>('loading')
  const [providers, setProviders] = useState<Provider[]>([])
  const [provider, setProvider] = useState('')
  const [messages, setMessages] = useState<string[]>([])
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [device, setDevice] = useState<{ code: string; url: string } | null>(null)

  useEffect(() => {
    if (!open) {
      setPhase('loading')
      setProviders([])
      setProvider('')
      setMessages([])
      setPrompt(null)
      setAnswer('')
      setError('')
      setDevice(null)
      return
    }
    setPhase('loading')
    setError('')
    window.pi.listOAuthProviders().then((next) => {
      const oauth = next.filter((item) => item.oauth)
      if (!oauth.length) {
        setProviders([])
        setProvider('')
        setPhase('unavailable')
        return
      }
      setProviders(oauth)
      setProvider((current) => initialProvider && oauth.some((item) => item.id === initialProvider) ? initialProvider : (oauth.some((item) => item.id === current) ? current : oauth[0]?.id ?? ''))
      setPhase('ready')
    }).catch((reason: unknown) => {
      setProviders([])
      setProvider('')
      const message = userFacingError(reason, t('读取服务商失败，请重试'))
      if (isUnavailableMessage(message)) {
        setPhase('unavailable')
        setError('')
        return
      }
      setPhase('error')
      setError(message)
    })
  }, [open, t, initialProvider])

  useEffect(() => {
    const unsubscribe = window.pi.onOAuthEvent((event) => {
      const kind = String(event.type ?? '')
      if (kind === 'event') {
        const payload = event.event as Record<string, unknown> | undefined
        if (!payload) return
        if (payload.type === 'info' && typeof payload.message === 'string') setMessages((current) => [...current, payload.message as string])
        if (payload.type === 'progress' && typeof payload.message === 'string') setMessages((current) => [...current, payload.message as string])
        if (payload.type === 'device_code' && typeof payload.userCode === 'string' && typeof payload.verificationUri === 'string') {
          setDevice({ code: payload.userCode, url: payload.verificationUri })
          setMessages((current) => [...current, t('请在浏览器中完成验证；验证码已显示在下方。')])
        }
        if (payload.type === 'auth_url' && typeof payload.url === 'string') {
          setMessages((current) => [...current, t('已打开浏览器，请在浏览器中完成登录。')])
        }
      } else if (kind === 'prompt') {
        setPrompt({ id: String(event.id), prompt: event.prompt as Prompt['prompt'] })
        setAnswer('')
      } else if (kind === 'done') {
        setPhase('ready')
        setPrompt(null)
        actions.notify('success', t('登录成功'), t('正在重新读取模型。'))
        onSaved(provider)
        window.setTimeout(onClose, 800)
      } else if (kind === 'error') {
        setPhase('ready')
        setPrompt(null)
        setError(userFacingError(event.message, t('登录失败，请重试。')))
      }
    })
    return unsubscribe
  }, [actions, onClose, onSaved, provider, t])

  const start = async (): Promise<void> => {
    if (!provider || phase === 'running') return
    setPhase('running')
    setMessages([])
    setError('')
    setDevice(null)
    setPrompt(null)
    try {
      const result = await window.pi.startOAuth(provider)
      if (!result.ok) {
        setPhase('ready')
        setError(userFacingError(result.error, t('无法开始登录。')))
      }
    } catch (reason) {
      setPhase('ready')
      setError(userFacingError(reason, t('无法开始登录。')))
    }
  }

  const respond = (value: string): void => {
    if (!prompt || !value) return
    window.pi.respondOAuth(prompt.id, value)
    setPrompt(null)
    setAnswer('')
  }

  const cancel = (): void => {
    window.pi.cancelOAuth()
    setPhase('ready')
    onClose()
  }

  const useApiKey = (): void => {
    onClose()
    onUseApiKey?.()
  }

  const running = phase === 'running'

  return (
    <Modal
      open={open}
      title={t('使用账号登录服务商')}
      width={520}
      onClose={() => (running ? cancel() : onClose())}
      footer={
        phase === 'unavailable' ? (
          <>
            <button className="button ghost" onClick={onClose}>{t('关闭')}</button>
            <button className="button primary" onClick={useApiKey}>{t('使用 API Key')}</button>
          </>
        ) : phase === 'error' ? (
          <>
            <button className="button ghost" onClick={onClose}>{t('关闭')}</button>
            <button className="button" onClick={useApiKey}>{t('使用 API Key')}</button>
            <button className="button primary" onClick={() => {
              setPhase('loading')
              setError('')
              window.pi.listOAuthProviders().then((next) => {
                const oauth = next.filter((item) => item.oauth)
                if (!oauth.length) {
                  setProviders([])
                  setProvider('')
                  setPhase('unavailable')
                  return
                }
                setProviders(oauth)
                setProvider(oauth[0]?.id ?? '')
                setPhase('ready')
              }).catch((reason: unknown) => {
                const message = userFacingError(reason, t('读取服务商失败，请重试'))
                if (isUnavailableMessage(message)) {
                  setPhase('unavailable')
                  setError('')
                  return
                }
                setPhase('error')
                setError(message)
              })
            }}>{t('重试')}</button>
          </>
        ) : (
          <>
            <button className="button ghost" onClick={() => (running ? cancel() : onClose())}>{running ? t('取消登录') : t('关闭')}</button>
            {!running && phase === 'ready' && (
              <button className="button primary" disabled={!provider} onClick={() => void start()}>{t('开始登录')}</button>
            )}
          </>
        )
      }
    >
      <div className="provider-oauth-dialog">
        {phase === 'loading' ? (
          <p className="settings-note"><Loader2 size={14} className="spin" /> {t('正在读取服务商…')}</p>
        ) : phase === 'unavailable' ? (
          <p className="provider-oauth-unavailable" role="status">{t('当前版本暂不支持账号登录，请用 API Key')}</p>
        ) : phase === 'error' ? (
          <p className="provider-oauth-unavailable" role="alert">{error || t('读取服务商失败，请重试')}</p>
        ) : !running ? (
          <div className="provider-oauth-providers" role="listbox" aria-label={t('服务商')}>
            {providers.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={provider === item.id}
                className={clsx('connect-provider', provider === item.id && 'active')}
                onClick={() => setProvider(item.id)}
              >
                <span aria-hidden="true">{item.name.slice(0, 1)}</span>
                {item.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="provider-oauth-progress">
            <div className="provider-oauth-title"><Loader2 size={15} className="spin" />{t('等待浏览器授权…')}</div>
            {messages.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}
            {device && (
              <div className="provider-oauth-code">
                <span>{t('验证码')}</span>
                <strong>{device.code}</strong>
                <button className="settings-button" onClick={() => { void navigator.clipboard.writeText(device.code); actions.notify('info', t('已复制验证码')) }}>{t('复制')}</button>
                <button className="settings-link" onClick={() => void window.pi.openExternal(device.url)}>{t('打开验证页面')} <ExternalLink size={12} /></button>
              </div>
            )}
            {prompt && (
              <div className="provider-oauth-prompt">
                <label className="form-field">
                  <span>{prompt.prompt.message}</span>
                  {prompt.prompt.type === 'select' ? (
                    <DesktopSelect label={prompt.prompt.message} value={answer} onChange={setAnswer}
                      options={[{ value: '', label: t('请选择') }, ...(prompt.prompt.options ?? []).map((option) => ({ value: option.id, label: option.label }))]} />
                  ) : (
                    <input
                      autoFocus
                      type={prompt.prompt.type === 'secret' ? 'password' : 'text'}
                      value={answer}
                      placeholder={prompt.prompt.placeholder}
                      onChange={(event) => setAnswer(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') respond(answer) }}
                    />
                  )}
                </label>
                <button className="button primary" disabled={!answer} onClick={() => respond(answer)}>{t('继续')}</button>
              </div>
            )}
          </div>
        )}
        {error && phase !== 'error' && <p className="desktop-permissions-error" role="alert">{error}</p>}
        {phase !== 'unavailable' && phase !== 'loading' && phase !== 'error' && (
          <div className="provider-oauth-note"><ShieldCheck size={15} /><span>{t('授权在浏览器中完成，Pi Desktop 不会读取你的密码。')}</span></div>
        )}
      </div>
    </Modal>
  )
}
