import { app, ipcMain, shell, systemPreferences, type WebContents } from 'electron'
import { join } from 'node:path'
import type { DictationEvent, DictationLocale, DictationSettingsTarget } from '@shared/dictation'

interface DictationBackend {
  available(): boolean
  readLevel?(): number
  start(locale: DictationLocale, emit: (event: DictationEvent) => void): Promise<void>
  stop(): void
  cancel(): void
  openSettings(target: DictationSettingsTarget): Promise<void>
}

interface MacDictationAddon {
  available(): boolean
  supportsLocale(locale: DictationLocale): boolean
  readLevel?(): number
  start(locale: DictationLocale, callback: (type: string, detail: string) => void): void
  stop(): void
  cancel(): void
}

function platformBackend(): DictationBackend | null {
  if (process.platform !== 'darwin') return null
  try {
    const directory = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'build')
    const native = require(join(directory, 'dictation.node')) as MacDictationAddon
    let generation = 0
    return {
      available: () => native.available(),
      readLevel: native.readLevel,
      async start(locale, emit) {
        if (!native.supportsLocale(locale)) {
          emit({ type: 'error', error: 'language-unavailable' })
          return
        }
        const current = ++generation
        const allowed = await systemPreferences.askForMediaAccess('microphone')
        if (current !== generation) return
        if (!allowed) {
          emit({ type: 'error', error: 'microphone' })
          return
        }
        native.start(locale, (type, detail) => {
          if (current !== generation) return
          if (type === 'recording') emit({ type })
          else if (type === 'result') emit({ type, text: detail })
          else {
            const error = detail === 'speech' || detail === 'no-speech' || detail === 'unavailable' ? detail : 'failed'
            emit({ type: 'error', error })
          }
        })
      },
      stop: () => native.stop(),
      cancel() {
        generation++
        native.cancel()
      },
      openSettings: (target) => shell.openExternal({
        microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
        speech: 'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition',
        language: 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension'
      }[target])
    }
  } catch (error) {
    console.warn('[dictation] Could not load the macOS speech module:', error)
    return null
  }
}

const configuredMs = (value: string | undefined, fallback: number): number => {
  const duration = Number(value)
  return Number.isSafeInteger(duration) && duration > 0 && duration <= 2_147_483_647 ? duration : fallback
}
const RECORDING_MS = configuredMs(process.env.PI_DICTATION_RECORDING_MS, 55_000)
const FINALIZE_MS = configuredMs(process.env.PI_DICTATION_FINALIZE_MS, 8_000)
const METER_INTERVAL_MS = 50
const METER_FLOOR_DB = -54
const METER_CEILING_DB = -12

function displayLevel(amplitude: number): number {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return 0
  const decibels = 20 * Math.log10(amplitude)
  return Math.min(1, Math.max(0, (decibels - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB)))
}

interface Operation {
  sender: WebContents
  id: string
  phase: 'starting' | 'recording' | 'transcribing'
  timer?: ReturnType<typeof setTimeout>
  meter?: ReturnType<typeof setInterval>
  cleanup: () => void
}

export function registerDictation(getMainContents: () => WebContents | undefined): () => void {
  const backend = platformBackend()
  let active: Operation | null = null

  function cancel() {
    const operation = active
    active = null
    if (!operation) return
    clearTimeout(operation.timer)
    clearInterval(operation.meter)
    operation.cleanup()
    backend?.cancel()
  }

  function publish(operation: Operation, event: DictationEvent) {
    if (active !== operation) return
    if (event.type === 'error' || event.type === 'result') cancel()
    if (!operation.sender.isDestroyed()) operation.sender.send('dictation:event', { ...event, id: operation.id })
  }

  function stop(operation: Operation) {
    if (active !== operation || operation.phase !== 'recording') return
    operation.phase = 'transcribing'
    clearTimeout(operation.timer)
    clearInterval(operation.meter)
    publish(operation, { type: 'transcribing' })
    operation.timer = setTimeout(() => publish(operation, { type: 'error', error: 'timeout' }), FINALIZE_MS)
    backend?.stop()
  }

  function validateId(id: unknown): asserts id is string {
    if (typeof id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) {
      throw new Error('Invalid dictation request ID.')
    }
  }

  function authorize(event: Electron.IpcMainInvokeEvent) {
    if (event.sender !== getMainContents() || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Only the main window can use dictation.')
    }
  }

  ipcMain.handle('dictation:available', (event) => {
    authorize(event)
    return backend?.available() ?? false
  })
  ipcMain.handle('dictation:start', (event, id: unknown, locale: unknown) => {
    authorize(event)
    validateId(id)
    if (locale !== 'en-US' && locale !== 'zh-CN') throw new Error('Invalid dictation language.')
    const sender = event.sender
    const error = !backend?.available() ? 'unavailable' : active ? 'busy' : null
    if (error || !backend) {
      sender.send('dictation:event', { type: 'error', error, id })
      return
    }
    const operation: Operation = {
      sender, id, phase: 'starting',
      cleanup() {
        sender.removeListener('destroyed', cancel)
        sender.removeListener('render-process-gone', cancel)
        sender.removeListener('did-navigate', cancel)
      }
    }
    active = operation
    sender.once('did-navigate', cancel)
    sender.once('render-process-gone', cancel)
    sender.once('destroyed', cancel)
    void backend.start(locale, (message) => {
      if (active !== operation) return
      if (message.type === 'recording') {
        operation.phase = 'recording'
        operation.timer = setTimeout(() => stop(operation), RECORDING_MS)
        const readLevel = backend.readLevel
        if (readLevel) {
          operation.meter = setInterval(() => {
            if (operation.phase === 'recording') {
              publish(operation, { type: 'level', level: displayLevel(readLevel()) })
            }
          }, METER_INTERVAL_MS)
        }
      }
      publish(operation, message)
    }).catch(() => publish(operation, { type: 'error', error: 'failed' }))
  })
  ipcMain.handle('dictation:stop', (event, id: unknown) => {
    authorize(event)
    validateId(id)
    if (active?.id === id) stop(active)
  })
  ipcMain.handle('dictation:cancel', (event, id: unknown) => {
    authorize(event)
    validateId(id)
    if (active?.id === id) cancel()
  })
  ipcMain.handle('dictation:open-settings', async (event, target: unknown) => {
    authorize(event)
    if (target !== 'microphone' && target !== 'speech' && target !== 'language') throw new Error('Invalid dictation settings target.')
    await backend?.openSettings(target)
  })
  return cancel
}
