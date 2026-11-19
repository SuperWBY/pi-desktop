import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useApp } from '../store'
import { Modal } from './ui'

type Provider = { id: string; name: string; oauth: boolean; apiKey: boolean }
type Prompt = { id: string; prompt: { type: 'text' | 'secret' | 'select' | 'manual_code'; message: string; placeholder?: string; options?: { id: string; label: string; description?: string }[] } }

export function ProviderOAuthDialog({ open, onClose, onSaved }: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}): ReactNode {
  const t = useTranslation()
  const { actions } = useApp()
  const [providers, setProviders] = useState<Provider[]>([])
  const [provider, setProvider] = useState('')
  const [running, setRunning] = useState(false)
  const [messages, setMessages] = useState<string[]>([])
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [device, setDevice] = useState<{ code: string; url: string } | null>(null)

  useEffect(() => {
    if (!open) {
      setRunning(false); setMessages([]); setPrompt(null); setAnswer(''); setError(''); setDevice(null)
      return
    }
    window.pi.listOAuthProviders().then((next) => {
      setProviders(next)
      setProvider((current) => current || next[0]?.id || '')
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [open])

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
        setRunning(false)
        setPrompt(null)
        actions.notify('success', t('登录成功'), t('正在重新读取模型。'))
        onSaved()
        window.setTimeout(onClose, 800)
      } else if (kind === 'error') {
        setRunning(false)
        setPrompt(null)
        setError(String(event.message ?? t('登录失败，请重试。')))
      }
    })
    return unsubscribe
  }, [actions, onClose, onSaved, t])

  const start = async (): Promise<void> => {
    if (!provider || running) return
    setRunning(true); setMessages([]); setError(''); setDevice(null); setPrompt(null)
    try {
      const result = await window.pi.startOAuth(provider)
      if (!result.ok) {
        setRunning(false)
        setError(result.error || t('无法开始登录。'))
      }
    } catch (reason) {
      setRunning(false)
      setError(reason instanceof Error ? reason.message : String(reason))
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
    setRunning(false)
    onClose()
  }

  return (
    <Modal
      open={open}
      title={t('使用账号登录服务商')}
      subtitle={t('通过服务商的浏览器授权，不需要在终端里操作')}
      width={560}
      onClose={() => (running ? cancel() : onClose())}
      footer={
        <>
          <button className="button ghost" onClick={() => (running ? cancel() : onClose())}>{running ? t('取消登录') : t('关闭')}</button>
          {!running && <button className="button primary" disabled={!provider} onClick={() => void start()}>{t('开始登录')}</button>}
        </>
      }
    >
      <div className="provider-oauth-dialog">
        {!running ? (
          <>
            <label className="form-field">
              <span>{t('服务商')}</span>
              <select value={provider} onChange={(event) => setProvider(event.target.value)}>
                {providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <p className="settings-note">{t('只列出支持账号授权的服务商。API Key 配置请使用“使用 API Key 登录”。')}</p>
          </>
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
                    <select value={answer} onChange={(event) => setAnswer(event.target.value)}>
                      <option value="">{t('请选择')}</option>
                      {(prompt.prompt.options ?? []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
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
        {error && <p className="desktop-permissions-error" role="alert">{error}</p>}
        <div className="provider-oauth-note"><ShieldCheck size={15} /><span>{t('授权由服务商在浏览器中完成；Pi Desktop 不会读取你的密码。')}</span></div>
      </div>
    </Modal>
  )
}
