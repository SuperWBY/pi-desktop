import { useTranslation } from '../i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../store'
import { Check, ExternalLink, Monitor, ShieldCheck, X } from 'lucide-react'
import type { ExtensionUiRequest } from '@shared/types'

function signInHandoff(request: ExtensionUiRequest): { kind: 'login' | 'verification'; backend?: string; host?: string } | undefined {
  if (request.method !== 'confirm' || request.title !== 'Computer Use: Sign-in Handoff') return undefined
  try {
    const info = JSON.parse(request.message ?? '') as { kind?: unknown; backend?: unknown; host?: unknown }
    if (info.kind === 'login' || info.kind === 'verification') return {
      kind: info.kind,
      backend: typeof info.backend === 'string' ? info.backend : undefined,
      host: typeof info.host === 'string' && /^[\w.:\[\]-]{1,253}$/.test(info.host) ? info.host : undefined
    }
  } catch { /* Fall back to the standard request. */ }
}

export function UiRequestDialog({ request, count }: { request: ExtensionUiRequest; count: number }): ReactNode {
  const t = useTranslation()
  const { actions } = useApp()
  const [value, setValue] = useState('')
  const responded = useRef(false)

  useEffect(() => {
    if (request) setValue(String(request.prefill ?? request.text ?? ''))
  }, [request])

  const respond = (payload: Record<string, unknown>): void => {
    if (responded.current) return
    responded.current = true
    actions.respondUi({ type: 'extension_ui_response', id: request.id, ...payload })
  }

  const cancel = (): void => respond({ cancelled: true })

  const permissionGuide = request.method === 'select' && request.title === 'Computer Use: System Permissions'
  const desktopAction = request.method === 'confirm' && request.title === '确认桌面操作'
  const browserAction = request.method === 'confirm' && request.title === 'Computer Use: Browser'
  const handoff = signInHandoff(request)
  const fileSelection = request.method === 'confirm' && request.title === 'Computer Use: File Selection'
  const fileSelectionCancel = request.method === 'confirm' && request.title === 'Computer Use: Cancel File Selection'
  const desktopFields = desktopAction && typeof request.message === 'string'
    ? request.message.split('\n').flatMap((line) => {
        const index = line.indexOf('：')
        return index > 0 ? [{ label: line.slice(0, index), value: line.slice(index + 1) }] : []
      }) : []
  const structuredDesktopAction = desktopFields.length === 4 && ['应用', '窗口', '操作', '目标'].every((label, index) => desktopFields[index]?.label === label) && request.message?.split('\n').length === 4
  const browserFields = browserAction && typeof request.message === 'string'
    ? request.message.split('\n').flatMap((line) => {
        const index = line.indexOf('：')
        return index > 0 ? [{ label: line.slice(0, index), value: line.slice(index + 1) }] : []
      }) : []
  const browserLabels = browserFields.map((field) => field.label)
  const structuredBrowserAction = browserFields.length >= 4 && browserFields.length <= 7 && request.message?.split('\n').length === browserFields.length && ['操作', '目标', '浏览器', '页面'].every((label, index) => browserLabels[index] === label) && browserLabels.slice(4).every((label, index, rest) => ['输入内容', '输入预览', '按键', '已选文件', '提示'].includes(label) && rest.indexOf(label) === index)
  const title = handoff ? t(handoff.kind === 'verification' ? '请完成验证' : '请完成登录') : permissionGuide ? t('开启桌面操作权限') : desktopAction ? t('确认桌面操作') : browserAction ? t('确认网页操作') : fileSelection ? t('选择上传文件') : fileSelectionCancel ? t('取消文件选择') : String(request.title ?? request.message ?? t('Pi needs your input'))
  const subtitle =
    typeof request.message === 'string' && request.message !== title ? request.message : undefined
  const commandDescription = request.method === 'confirm' && request.title === '确认执行危险命令'
    ? subtitle?.match(/^(检测到[^\n]+。)\n\n([\s\S]+)\n\n(只在你确认这条命令安全时继续。)$/)
    : null

  const body = (): ReactNode => {
    switch (request.method) {
      case 'select':
        if (permissionGuide) {
          const options = request.options ?? []
          const accessibilityMissing = options.includes('Open Accessibility Settings')
          const screenMissing = options.includes('Open Screen Recording Settings')
          return (
            <div className="desktop-permissions">
              <p className="desktop-permissions-intro">{t('允许 Pi 观察和操作桌面应用')}</p>
              <p className="desktop-permissions-description">{t('仅在执行桌面任务时需要。请在系统设置中开启所需权限，然后返回这里重新检测。')}</p>
              <div className="desktop-permission-list">
                <div className="desktop-permission-row">
                  <span className="desktop-permission-icon"><ShieldCheck size={19} /></span>
                  <span className="desktop-permission-copy"><strong>{t('辅助功能')}</strong><small>{t('用于识别并操作应用中的按钮和输入框')}</small></span>
                  {accessibilityMissing ? <button className="button ghost desktop-permission-open" onClick={() => respond({ value:'Open Accessibility Settings' })}>{t('打开辅助功能设置')} <ExternalLink size={14} /></button> : <span className="desktop-permission-granted"><Check size={15} />{t('已开启')}</span>}
                </div>
                <div className="desktop-permission-row">
                  <span className="desktop-permission-icon"><Monitor size={19} /></span>
                  <span className="desktop-permission-copy"><strong>{t('屏幕录制')}</strong><small>{t('用于查看当前应用窗口，帮助确认操作结果')}</small></span>
                  {screenMissing ? <button className="button ghost desktop-permission-open" onClick={() => respond({ value:'Open Screen Recording Settings' })}>{t('打开屏幕录制设置')} <ExternalLink size={14} /></button> : <span className="desktop-permission-granted"><Check size={15} />{t('已开启')}</span>}
                </div>
              </div>
              <p className="desktop-permissions-note">{t('权限由 macOS 管理。如果开启后仍未生效，请重启 Pi Desktop 再试。')}</p>
              <div className="confirm-actions">
                <button className="button ghost" onClick={() => respond({ value:'Cancel' })}>{t('稍后再说')}</button>
                <button className="button primary" onClick={() => respond({ value:'Check Again' })}>{t('重新检测')}</button>
              </div>
            </div>
          )
        }
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
        if (handoff) {
          const destination = handoff.backend === 'inapp' ? '应用内浏览器' : handoff.backend === 'cdp' ? '独立 Chrome' : handoff.backend === 'extension' ? '日常 Chrome' : '当前应用'
          return <>
            <p className="conversation-prompt-description">
              {t('请在 {destination} 中完成这一步，完成后 Pi 会继续。').replace('{destination}', [t(destination), handoff.host].filter(Boolean).join(' · '))}
            </p>
            <div className="confirm-actions">
              {handoff.backend === 'inapp' && <button className="button ghost" onClick={() => window.dispatchEvent(new Event('pi:reveal-browser'))}>{t('打开工作面板')}</button>}
              <button className="button ghost" onClick={() => respond({ confirmed: false })}>{t('稍后再说')}</button>
              <button className="button primary" onClick={() => respond({ confirmed: true })}>{t('我已完成')}</button>
            </div>
          </>
        }
        return (
          <>
            {fileSelection && <div className="input-request">
              <p className="modal-text">{t('如果没有看到系统文件选择窗口，请在网页中点击文件选择按钮。使用应用内浏览器时，可先打开工作面板。')}</p>
              <button className="button ghost" onClick={() => window.dispatchEvent(new Event('pi:reveal-browser'))}>{t('打开工作面板')}</button>
            </div>}
            {browserAction && (structuredBrowserAction ? <dl className="desktop-action-summary browser-action-summary">{browserFields.map((field, index) => {
              const actions: Record<string, string> = { click: '点击', type: '输入文字', press: '按键' }
              const backends: Record<string, string> = { inapp: '应用内浏览器', cdp: '独立 Chrome', extension: '日常 Chrome' }
              const value = field.label === '操作' && actions[field.value] ? t(actions[field.value]) : field.label === '浏览器' && backends[field.value] ? t(backends[field.value]) : field.value.replace('（当前页面可见文件，不一定属于此操作）', t('（当前页面可见文件，不一定属于此操作）'))
              return <div key={index}><dt>{t(field.label)}</dt><dd className={['输入内容', '输入预览'].includes(field.label) ? 'browser-action-input-preview' : undefined}>{value}</dd></div>
            })}</dl> : <p className="browser-action-message">{request.message}</p>)}
            {desktopAction && structuredDesktopAction && <dl className="desktop-action-summary">{desktopFields.map((field, index) => {
              const actions: Record<string, string> = { click: '点击', double_click: '双击', right_click: '右键点击', hover: '悬停', press: '按下控件', set_value: '填写内容', type: '输入文字', key: '按键', scroll: '滚动' }
              const roles: Record<string, string> = { AXButton: '按钮', AXTextField: '输入框', AXCheckBox: '复选框' }
              const [role, ...target] = field.value.split(' ')
              const value = field.label === '操作' && actions[field.value] ? t(actions[field.value])
                : field.label === '目标' && roles[role] ? [t(roles[role]), ...target].join(' ') : field.value
              return <div key={index}><dt>{t(field.label)}</dt><dd>{value}</dd></div>
            })}</dl>}
            <div className="confirm-actions">
              <button className="button ghost" onClick={() => respond({ confirmed: false })}>{t(fileSelection || fileSelectionCancel ? '稍后再说' : desktopAction || browserAction ? '取消操作' : 'No')}</button>
              <button className="button primary" onClick={() => respond({ confirmed: true })}>{t(fileSelection ? '已完成选择' : fileSelectionCancel ? '已取消选择' : desktopAction || browserAction ? '确认执行' : 'Yes')}</button>
            </div>
          </>
        )
      case 'input':
        return (
          <div className="input-request">
            <input
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
    <section className="conversation-prompt-content" role="region" aria-label={title} data-request-id={request.id}>
      <div className="conversation-prompt-head">
        <div><span className="conversation-prompt-kind">{t(handoff ? '需要处理' : request.method === 'confirm' || permissionGuide ? '等待确认' : '等待回复')}</span><h2>{title}</h2></div>
        <div className="conversation-prompt-meta">
          {count > 1 && <span>{t('还有 {count} 项待处理').replace('{count}', String(count - 1))}</span>}
          <button type="button" className="icon-button" aria-label={t('取消请求')} onClick={cancel}><X size={15} /></button>
        </div>
      </div>
      {!(handoff || permissionGuide || structuredDesktopAction || browserAction) && subtitle && (commandDescription
        ? <div className="conversation-prompt-description conversation-command-description">
            <span>{commandDescription[1]}</span><span>{commandDescription[2]}</span><span>{commandDescription[3]}</span>
          </div>
        : <p className="conversation-prompt-description">{subtitle}</p>)}
      {body()}
    </section>
  )
}
