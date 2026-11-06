import { useTranslation } from './i18n'
import { useEffect, type ReactNode } from 'react'
import clsx from 'clsx'
import { AlertTriangle } from 'lucide-react'
import { AppProvider, useApp } from './store'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { ChatView } from './components/ChatView'
import { Composer } from './components/Composer'
import { Welcome } from './components/Welcome'
import { SettingsPage } from './components/SettingsPage'
import { SkillsPage } from './components/SkillsPage'
import { SchedulesPage } from './components/SchedulesPage'
import { Diagnostics } from './components/Diagnostics'
import { WorkPanel } from './components/WorkPanel'
import { ImageLightbox, openImage } from './components/ImageLightbox'
import { UiRequestDialog } from './components/UiRequestDialog'
import { Toasts } from './components/Toasts'
import { formatDuration } from './lib/format'

function Shell(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const showWelcome = !state.workspace
  const failed = state.status === 'error' && Boolean(state.workspace)

  useEffect(() => {
    const when = (timestamp: number | null): string =>
      timestamp
        ? new Intl.DateTimeFormat('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }).format(new Date(timestamp))
        : ''

    const unsubscribeEvent = window.pi.onScheduleEvent((event) => {
      if (event.type === 'created') {
        actions.notify(
          'success',
          t('已创建定时任务'),
          event.nextRunAt ? `${event.name} · ${when(event.nextRunAt)}` : event.name,
          { label: t('查看'), run: () => actions.openScheduleTask(event.taskId) }
        )
      } else if (event.type === 'finished') {
        const failed = event.status !== 'success' && event.status !== 'skipped'
        actions.notify(
          failed ? 'error' : 'success',
          failed ? t('定时任务运行失败') : t('定时任务运行完成'),
          [event.name, event.durationMs ? formatDuration(event.durationMs) : '', event.error]
            .filter(Boolean)
            .join(' · '),
          event.removed ? undefined : { label: t('查看结果'), run: () => actions.openScheduleTask(event.taskId) }
        )
      }
    })
    const unsubscribeOpen = window.pi.onScheduleOpen((taskId) => actions.openScheduleTask(taskId))
    return () => {
      unsubscribeEvent()
      unsubscribeOpen()
    }
  }, [actions, t])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey
      if (!meta || event.altKey) return
      const key = event.key.toLowerCase()

      if (key === 'b' && !event.shiftKey) {
        event.preventDefault()
        actions.toggleSidebar()
      } else if (key === 'b' && event.shiftKey) {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('pi:toggle-browser'))
      } else if (key === 'e' && event.shiftKey) {
        event.preventDefault()
        actions.toggleWorkPanel()
      } else if (key === 'n' && !event.shiftKey) {
        event.preventDefault()
        void actions.newSession()
      } else if (key === 'o' && !event.shiftKey) {
        event.preventDefault()
        void actions.pickFolder()
      } else if (key === ',') {
        event.preventDefault()
        actions.openSettings(true)
      } else if (key === 'l' && event.shiftKey) {
        event.preventDefault()
        void actions.setTheme(state.settings.theme === 'dark' ? 'light' : 'dark')
      }
    }

    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && state.settingsOpen) {
        if (document.querySelector('.popover')) return
        event.stopPropagation()
        actions.openSettings(false)
      }
    }

    const onImageClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof HTMLImageElement)) return
      if (!target.closest('.assistant-body, .user-message, .tool-body')) return
      if (!/^data:image\//.test(target.src)) return
      openImage(target.src)
    }

    document.addEventListener('click', onImageClick)
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('keydown', onEscape, true)
    return () => {
      document.removeEventListener('click', onImageClick)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keydown', onEscape, true)
    }
  }, [actions, state.settings.theme, state.settingsOpen])

  return (
    <div
      className={clsx(
        'app',
        !state.sidebarOpen && 'sidebar-collapsed',
        state.diagnosticsOpen && 'drawer-open'
      )}
    >
      <Sidebar />

      <main className="main">
        <TopBar />

        {failed && (
          <div className="error-banner">
            <AlertTriangle size={15} />
            <div className="error-text">
              <strong>Could not start pi</strong>
              <span>{state.error}</span>
            </div>
            <button className="button ghost small" onClick={() => actions.openSettings(true)}>{t("Settings")}</button>
            <button
              className="button ghost small"
              onClick={() => void actions.openSession(state.workspace ?? '', null)}
            >
              Retry
            </button>
          </div>
        )}

        {showWelcome ? <Welcome /> : <ChatView />}
        {state.workspace && <Composer />}
      </main>

      <WorkPanel />

      {state.skillsOpen && <SkillsPage />}
      {state.schedulesOpen && <SchedulesPage />}
      <SettingsPage />
      <Diagnostics />
      <ImageLightbox />
      <UiRequestDialog />
      <Toasts />
    </div>
  )
}

export default function App(): ReactNode {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
