import { useRef, useState, type ReactNode } from 'react'
import { Globe, X } from 'lucide-react'
import { userFacingError } from '@shared/errors'
import { useTranslation } from '../i18n'
import { useApp } from '../store'
import { UiRequestDialog } from './UiRequestDialog'

export function ConversationPrompt(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [retrying, setRetrying] = useState(false)
  const request = state.uiRequests[0]
  const current = request ? { kind: 'request' as const, request, count: state.uiRequests.length }
    : state.networkBlock ? { kind: 'network' as const, block: state.networkBlock } : null
  const last = useRef(current)
  if (current) last.current = current
  const view = current ?? last.current

  const retry = async (): Promise<void> => {
    const block = state.networkBlock
    if (!block || !state.sessionSecurity || retrying) return
    setRetrying(true)
    try {
      await actions.changeSessionPermission({
        permission: state.sessionSecurity.permission,
        ...(block.offline ? { network: 'model' } : { allowHost: block.host })
      })
      actions.dismissNetworkBlock(block)
      actions.notify('success', t('已允许访问'), t('新的联网请求将使用更新后的权限。之前失败的请求需要重新发起。'))
    } catch (error) {
      actions.notify('error', t('无法恢复联网'), userFacingError(error))
    } finally { setRetrying(false) }
  }

  return (
    <div className="conversation-prompt" hidden={!current} inert={!current} aria-live="polite">
      {view?.kind === 'request' ? <UiRequestDialog key={view.request.id} request={view.request} count={view.count} />
        : view?.kind === 'network' ? <section className="conversation-prompt-content conversation-network-block" role="region" aria-label={t(view.block.offline ? '本次对话已关闭联网' : '联网请求被拦截')}>
          <Globe size={16} aria-hidden="true" />
          <div className="conversation-network-copy">
            <strong>{t(view.block.offline ? '本次对话已关闭联网' : 'Pi 请求访问网站')}</strong>
            <span>{view.block.host}</span>
          </div>
          <button type="button" className="button primary small" disabled={retrying || !state.sessionSecurity} onClick={() => void retry()}>
            {t(retrying ? '正在更新…' : view.block.offline ? '开启本次联网' : '允许访问')}
          </button>
          <button type="button" className="icon-button" aria-label={t('关闭')} onClick={() => actions.dismissNetworkBlock()}><X size={15} /></button>
        </section> : null}
    </div>
  )
}
