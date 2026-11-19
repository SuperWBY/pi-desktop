import { useEffect, useState, type ReactNode } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useApp } from '../store'
import { Modal } from './ui'

const PROVIDERS: { id: string; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google Gemini' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'groq', label: 'Groq' },
  { id: 'xai', label: 'xAI' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'opencode-go', label: 'OpenCode Go' }
]

export function ProviderAuthDialog({ open, onClose, onSaved }: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}): ReactNode {
  const t = useTranslation()
  const { actions } = useApp()
  const [provider, setProvider] = useState('openai')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setKey('')
      setBusy(false)
    }
  }, [open])

  const save = async (): Promise<void> => {
    if (busy || !key.trim()) return
    setBusy(true)
    try {
      await window.pi.saveApiKey(provider, key.trim())
      actions.notify('success', t('API Key 已保存'), t('重新读取模型后即可使用。'))
      setKey('')
      onSaved()
      onClose()
    } catch (error) {
      actions.notify('error', t('保存 API Key 失败'), error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={t('连接模型服务商')}
      subtitle={t('使用 API Key 登录；凭证只保存在本机')}
      width={520}
      onClose={() => (busy ? undefined : onClose())}
      footer={
        <>
          <button className="button ghost" disabled={busy} onClick={onClose}>{t('取消')}</button>
          <button className="button primary" disabled={busy || !key.trim()} onClick={() => void save()}>
            {busy ? t('保存中…') : t('保存 API Key')}
          </button>
        </>
      }
    >
      <div className="provider-auth-dialog">
        <label className="form-field">
          <span>{t('服务商')}</span>
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span>API Key</span>
          <div className="provider-auth-key">
            <KeyRound size={14} />
            <input
              autoFocus
              type="password"
              autoComplete="off"
              value={key}
              placeholder={t('粘贴服务商提供的 API Key')}
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void save() }}
            />
          </div>
        </label>
        <div className="provider-auth-note">
          <ShieldCheck size={15} />
          <span>{t('Key 会写入 pi 的 auth.json（权限 0600），不会显示在界面上，也不会发送到 Pi Desktop 的服务器。')}</span>
        </div>
      </div>
    </Modal>
  )
}
