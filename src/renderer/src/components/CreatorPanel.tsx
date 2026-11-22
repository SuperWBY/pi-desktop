import { ArrowUpRight, Sparkles, X } from 'lucide-react'
import { useApp } from '../store'
import { useTranslation } from '../i18n'
import './creator.css'

/** Creation stays in chat; the market owns the user's plugin library. */
export function CreatorModeBar(): React.ReactNode {
  const { state, actions } = useApp()
  const t = useTranslation()
  const open = state.creator?.enabled === true
  return <div className="creator-mode-bar" data-open={open} inert={!open} aria-hidden={!open}><div>
    <span className="creator-mode-label"><Sparkles size={14} />{t('创意模式 · 已开启')}</span>
    <button className="creator-mode-library" onClick={actions.openCreator}>{t('我的插件')}<ArrowUpRight size={13} /></button>
    <button className="creator-mode-exit" disabled={state.streaming || state.creatorBusy} onClick={() => void actions.creatorAction({ action: 'disable' })} aria-label={t('退出创意模式')} title={t(state.streaming ? '当前任务结束后可切换模式' : '退出创意模式')}><X size={14} /></button>
  </div></div>
}
