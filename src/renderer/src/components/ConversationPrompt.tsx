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
    if (!block || !state.sessionSecurity || retrying || state.streaming) return
    setRetrying(true)
    try {
      await actions.changeSessionPermission({
        permission: state.sessionSecurity.permission,
        ...(block.offline ? { network: 'model' } : { allowHost: block.host })
      })
      await actions.sendMessage(t('请从上次中断的地方继续，先核对已经执行的操作，避免重复执行。'), [])
    } catch (error) {
      actions.notify('error', t('无法恢复联网'), userFacingError(error))
    } finally { setRetrying(false) }
  }

  return (
    <div className="conversation-prompt" hidden={!current} inert={!current} aria-live="polite">
      {view?.kind === 'request' ? <UiRequestDialog key={view.request.id} request={view.request} count={view.count} />
        : view?.kind === 'network' ? <section className="conversation-prompt-content conversation-network-block" role="region" aria-label={t(view.block.offline ? '本次对话已关闭联网' : '联网请求被拦截')}>
          <div className="conversation-prompt-head">
            <div><span className="conversation-prompt-kind"><Globe size={14} /> {t('需要处理')}</span><h2>{t(view.block.offline ? '本次对话已关闭联网' : '联网请求被拦截')}</h2></div>
            <button type="button" className="icon-button" aria-label={t('关闭')} onClick={actions.dismissNetworkBlock}><X size={15} /></button>
          </div>
          <p className="conversation-prompt-description">{t('Pi 无法连接 {host}。').replace('{host}', view.block.host)}</p>
          <div className="confirm-actions"><button type="button" className="button primary" disabled={retrying || state.streaming || !state.sessionSecurity} onClick={() => void retry()}>
            {t(retrying ? '正在重试…' : view.block.offline ? '开启本次联网并重试' : '允许此网站并重试')}
          </button></div>
        </section> : null}
    </div>
  )
}
