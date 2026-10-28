import { useTranslation } from '../i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../store'
import { Modal } from './ui'

export function UiRequestDialog(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const request = state.uiRequests[0]
  const [value, setValue] = useState('')

  useEffect(() => {
    if (request) setValue(String(request.prefill ?? request.text ?? ''))
  }, [request])

  if (!request) return null

  const respond = (payload: Record<string, unknown>): void => {
    actions.respondUi({ type: 'extension_ui_response', id: request.id, ...payload })
  }

  const cancel = (): void => respond({ cancelled: true })

  const title = String(request.title ?? request.message ?? t('pi needs your input'))
  const subtitle =
    typeof request.message === 'string' && request.message !== title ? request.message : undefined

  const body = (): ReactNode => {
    switch (request.method) {
      case 'select':
        return (
          <div className="option-list">
            {(request.options ?? []).map((option) => (
              <button key={option} className="option" onClick={() => respond({ value: option })}>
                {option}
              </button>
            ))}
          </div>
        )
      case 'confirm':
        return (
          <div className="confirm-actions">
            <button className="button ghost" onClick={() => respond({ value: false })}>{t("No")}</button>
            <button className="button primary" onClick={() => respond({ value: true })}>{t("Yes")}</button>
          </div>
        )
      case 'input':
        return (
          <div className="input-request">
            <input
              autoFocus
              className="text-input"
              value={value}
              placeholder={request.placeholder}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') respond({ value })
              }}
            />
            <div className="confirm-actions">
              <button className="button ghost" onClick={cancel}>{t("Cancel")}</button>
              <button className="button primary" onClick={() => respond({ value })}>{t("Submit")}</button>
            </div>
          </div>
        )
      case 'editor':
        return (
          <div className="input-request">
            <textarea
              autoFocus
              className="text-area"
              rows={8}
              value={value}
              placeholder={request.placeholder}
              onChange={(event) => setValue(event.target.value)}
            />
            <div className="confirm-actions">
              <button className="button ghost" onClick={cancel}>{t("Cancel")}</button>
              <button className="button primary" onClick={() => respond({ value })}>{t("Submit")}</button>
            </div>
          </div>
        )
      default:
        return (
          <div className="input-request">
            <p className="modal-text">{t("This extension uses an interface the desktop app cannot render yet.")}</p>
            <div className="confirm-actions">
              <button className="button ghost" onClick={cancel}>{t("Dismiss")}</button>
            </div>
          </div>
        )
    }
  }

  return (
    <Modal open title={title} subtitle={subtitle} onClose={cancel} width={480}>
      {body()}
    </Modal>
  )
}
