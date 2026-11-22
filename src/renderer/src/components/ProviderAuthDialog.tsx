import { useEffect, useState, type ReactNode } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useApp } from '../store'
import { Modal } from './ui'
import { DesktopSelect } from './DesktopSelect'

export const API_KEY_PROVIDERS: { id: string; label: string; help: string }[] = [
  { id: 'openai', label: 'OpenAI', help: '在 platform.openai.com 的 API keys 页面创建。' },
  { id: 'anthropic', label: 'Anthropic', help: '在 console.anthropic.com 的 API keys 页面创建。' },
  { id: 'google', label: 'Google Gemini', help: '在 aistudio.google.com 的 API key 页面创建。' },
  { id: 'openrouter', label: 'OpenRouter', help: '在 openrouter.ai 的 Keys 页面创建。' },
  { id: 'deepseek', label: 'DeepSeek', help: '在 platform.deepseek.com 的 API keys 页面创建。' },
  { id: 'groq', label: 'Groq', help: '在 console.groq.com 的 API keys 页面创建。' },
  { id: 'xai', label: 'xAI', help: '在 console.x.ai 的 API keys 页面创建。' },
  { id: 'mistral', label: 'Mistral', help: '在 console.mistral.ai 的 API keys 页面创建。' },
  { id: 'opencode-go', label: 'OpenCode Go', help: '在 OpenCode 账号的 API keys 页面创建。' }
]

export function ProviderAuthDialog({ open, onClose, onSaved, initialProvider, runtimeProviders }: {
  open: boolean
  onClose: () => void
  onSaved: (provider: string) => void
  initialProvider?: string
  runtimeProviders?: { id: string; name: string; apiKey: boolean }[]
}): ReactNode {
  const t = useTranslation()
  const { actions } = useApp()
  const choices = runtimeProviders?.filter((item) => item.apiKey).map((item) => ({ id: item.id, label: item.name, help: API_KEY_PROVIDERS.find((entry) => entry.id === item.id)?.help ?? '到服务商网站的 API keys 页面创建，然后粘贴到这里。' })) ?? API_KEY_PROVIDERS
  const [provider, setProvider] = useState('openai')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && initialProvider && choices.some((item) => item.id === initialProvider)) setProvider(initialProvider)
    if (!open) {
      setKey('')
      setBusy(false)
    }
  }, [open, initialProvider, runtimeProviders])

  const save = async (): Promise<void> => {
    if (busy || !key.trim()) return
    setBusy(true)
    try {
      await window.pi.saveApiKey(provider, key.trim())
      actions.notify('success', t('API Key 已保存'), t('重新读取模型后即可使用。'))
      setKey('')
      onSaved(provider)
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
          <DesktopSelect label={t('服务商')} value={provider} onChange={setProvider} disabled={busy}
            options={choices.map((item) => ({ value: item.id, label: item.label }))} />
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
        <p className="provider-auth-help">{t(choices.find((item) => item.id === provider)?.help ?? '到服务商网站的 API keys 页面创建，然后粘贴到这里。')}</p>
        <div className="provider-auth-note">
          <ShieldCheck size={15} />
          <span>{t('密钥只保存在这台电脑上，不会上传，界面里也不会再次显示。')}</span>
        </div>
        <details className="provider-auth-advanced">
          <summary>{t('技术详情')}</summary>
          <p>{t('写入本机的凭证文件，只有当前用户可以读取。')}</p>
        </details>
      </div>
    </Modal>
  )
}
