import { useEffect, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import clsx from 'clsx'
import { useApp, type Notice } from '../store'

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle
}

function Toast({ notice }: { notice: Notice }): ReactNode {
  const { actions } = useApp()
  const Icon = ICONS[notice.level]

  useEffect(() => {
    const timer = setTimeout(() => actions.dismissNotice(notice.id), 5200)
    return () => clearTimeout(timer)
  }, [actions, notice.id])

  return (
    <div className={clsx('toast', notice.level)}>
      <Icon size={15} className="toast-icon" />
      <div className="toast-content">
        <div className="toast-title">{notice.title}</div>
        {notice.detail && <div className="toast-detail">{notice.detail}</div>}
        {notice.action && (
          <button
            className="toast-action"
            onClick={() => {
              notice.action?.run()
              actions.dismissNotice(notice.id)
            }}
          >
            {notice.action.label}
          </button>
        )}
      </div>
      <button
        className="icon-button toast-close"
        onClick={() => actions.dismissNotice(notice.id)}
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  )
}

export function Toasts(): ReactNode {
  const { state } = useApp()
  if (state.notices.length === 0) return null
  return (
    <div className="toasts">
      {state.notices.map((notice) => (
        <Toast key={notice.id} notice={notice} />
      ))}
    </div>
  )
}
