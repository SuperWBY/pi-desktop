import type { ReactNode } from 'react'
import type { PackageEntry } from '@shared/types'
import { useTranslation } from '../i18n'
import { MarketDialog } from './MarketDialog'

export function MarketRemoveDialog({ entry, onClose, onConfirm }: {
  entry: PackageEntry
  onClose: () => void
  onConfirm: () => void
}): ReactNode {
  const t = useTranslation()
  return <MarketDialog title={t("卸载插件")} onClose={onClose}>{(close, run) => <>
    <p>{t('确定卸载 {name}？新会话将不再加载此插件。').replace('{name}', entry.name)}</p>
    <div className="market-modal-actions">
      <button onClick={close}>{t("取消")}</button>
      <button onClick={() => run(() => { onConfirm(); close() })}>{t("卸载")}</button>
    </div>
  </>}</MarketDialog>
}
