import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  Bootstrap,
  CustomProviderEntry,
  ModelsConfig,
  PiModelRow,
  OpenSessionResult,
  PiRecord,
  PiSettings,
  Settings
} from '@shared/types'
import { PiProcess } from './pi'
import { locatePi, piVersion } from './pi-locate'
import { deleteSession, listSessions, sessionExists, sessionsRoot } from './sessions'
import { loadSettings, saveSettings } from './settings'
import { agentDir, loadPiSettings, piSettingsFile, savePiSettings } from './pi-settings'
import {
  listPiModels,
  readModelsConfig,
  refreshModelCatalog,
  removeProvider,
  saveProvider
} from './models'

let mainWindow: BrowserWindow | null = null
let proc: PiProcess | null = null
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function wireProcess(process: PiProcess): void {
  process.on('record', (record: PiRecord) => {
    if (proc === process) send('pi:record', record)
  })
  process.on('stderr', (chunk: string) => {
    if (proc === process) send('pi:stderr', chunk)
  })
  process.on('exit', (info: { code: number | null; signal: string | null; intentional?: boolean }) => {
    if (proc === process) {
      proc = null
      send('pi:status', { status: 'exited', code: info.code, signal: info.signal })
    }
  })
  process.on('protocol-error', (line: string) => {
    console.error('[pi] failed to parse record:', line)
  })
}

async function closeSession(): Promise<void> {
  const current = proc
  proc = null
  if (current) {
    current.stop()
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

async function doOpenSession(options: {
  cwd: string
  sessionPath?: string | null
}): Promise<OpenSessionResult> {
  const requested = options.cwd?.trim()
  if (!requested || !existsSync(requested) || !statSync(requested).isDirectory()) {
    return { ok: false, error: 'Please choose an existing folder.' }
  }
  const cwd = realpathSync(requested)

  if (options.sessionPath && !(await sessionExists(options.sessionPath))) {
    return { ok: false, error: 'That session file no longer exists.' }
  }

  const active = proc
  if (active && active.alive && active.cwd === cwd) {
    try {
      // Stop any in-flight run, then swap sessions in-process. This is far
      // faster than respawning pi (no model/auth warm-up).
      await active.send({ type: 'abort' }, 5000).catch(() => undefined)
      const switched = await active.send<{ cancelled?: boolean }>(
        options.sessionPath
          ? { type: 'switch_session', sessionPath: options.sessionPath }
          : { type: 'new_session' },
        30_000
      )
      if (switched.success && !switched.data?.cancelled) {
        const stateResponse = await active.send<{ sessionFile?: string | null }>(
          { type: 'get_state' },
          20_000
        )
        return {
          ok: true,
          cwd,
          sessionPath: stateResponse.data?.sessionFile ?? options.sessionPath ?? null
        }
      }
    } catch {
      // fall through to a fresh process
    }
  }

  await closeSession()

  const settings = loadSettings()
  const piPath = locatePi(settings.piPath)
  const process = new PiProcess()
  wireProcess(process)

  try {
    await process.start({ cwd, piPath, sessionPath: options.sessionPath ?? undefined })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: /ENOENT/.test(message)
        ? `Could not find the pi executable at "${piPath}". Set its path in Settings.`
        : `Could not start pi: ${message}`
    }
  }

  proc = process

  try {
    const response = await process.send<{ sessionFile?: string | null }>(
      { type: 'get_state' },
      25_000
    )
    if (!response.success) {
      throw new Error(response.error || 'get_state failed')
    }
    const sessionFile = response.data?.sessionFile ?? options.sessionPath ?? null

    saveSettings({
      lastWorkspace: cwd,
      workspaces: [...settings.workspaces, cwd]
    })
    send('app:settings', loadSettings())
    return { ok: true, cwd, sessionPath: sessionFile }
  } catch (error) {
    process.stop()
    proc = null
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `pi did not become ready: ${message}` }
  }
}

function commandTimeout(type: string): number {
  if (type === 'compact' || type === 'export_html' || type === 'abort' || type === 'abort_bash') {
    return 600_000
  }
  if (type === 'prompt' || type === 'steer' || type === 'follow_up') return 120_000
  return 60_000
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', (): Bootstrap => {
    const settings = loadSettings()
    const piPath = locatePi(settings.piPath)
    return {
      platform: process.platform,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      piPath,
      piVersion: piVersion(piPath),
      home: homedir(),
      sessionsRoot: sessionsRoot(),
      settings,
      piSettings: loadPiSettings(),
      piSettingsFile: piSettingsFile(),
      agentDir: agentDir()
    }
  })

  ipcMain.handle('app:update-pi-settings', (_event, patch: PiSettings): PiSettings => {
    return savePiSettings(patch)
  })

  ipcMain.handle(
    'dialog:pick-file',
    async (_event, options?: { title?: string; defaultPath?: string }): Promise<string | null> => {
      const result = await dialog.showOpenDialog({
        title: options?.title ?? 'Select a file',
        defaultPath: options?.defaultPath,
        properties: ['openFile', 'showHiddenFiles'],
        buttonLabel: 'Select'
      })
      if (result.canceled || !result.filePaths[0]) return null
      return result.filePaths[0]
    }
  )

  ipcMain.handle('app:update-settings', (_event, patch: Partial<Settings>): Settings => {
    return saveSettings(patch)
  })

  ipcMain.handle('dialog:pick-folder', async (): Promise<string | null> => {
    const settings = loadSettings()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: 'Open a project',
          defaultPath: settings.lastWorkspace || homedir(),
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: 'Open'
        })
      : await dialog.showOpenDialog({
          title: 'Open a project',
          defaultPath: settings.lastWorkspace || homedir(),
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: 'Open'
        })

    if (result.canceled || !result.filePaths[0]) return null
    const folder = result.filePaths[0]
    saveSettings({ lastWorkspace: folder, workspaces: [...settings.workspaces, folder] })
    send('app:settings', loadSettings())
    return folder
  })

  ipcMain.handle('sessions:list', () => listSessions())
  ipcMain.handle('sessions:delete', (_event, path: string) => deleteSession(path))
  ipcMain.handle('session:close', () => closeSession())

  ipcMain.handle(
    'session:open',
    (_event, options: { cwd: string; sessionPath?: string | null }) =>
      enqueue(() => doOpenSession(options))
  )

  ipcMain.handle(
    'pi:command',
    async (_event, command: Record<string, unknown>, timeoutMs?: number) => {
      const process = proc
      if (!process) {
        return { type: 'response', command: String(command.type), success: false, error: 'pi is not running' }
      }
      try {
        return await process.send(command, timeoutMs ?? commandTimeout(String(command.type)))
      } catch (error) {
        return {
          type: 'response',
          command: String(command.type),
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.on('pi:ui-response', (_event, response: Record<string, unknown>) => {
    proc?.write(response)
  })

  ipcMain.handle('models:read', (): ModelsConfig => readModelsConfig())

  ipcMain.handle(
    'models:save-provider',
    (_event, id: string, entry: CustomProviderEntry): ModelsConfig => saveProvider(id, entry)
  )

  ipcMain.handle('models:remove-provider', (_event, id: string): ModelsConfig => removeProvider(id))

  ipcMain.handle('models:list', (): Promise<{ models: PiModelRow[]; error?: string }> =>
    listPiModels(locatePi(loadSettings().piPath))
  )

  ipcMain.handle('models:refresh-catalog', (): Promise<{ ok: boolean; output: string }> =>
    refreshModelCatalog(locatePi(loadSettings().piPath))
  )

  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) return
    await shell.openExternal(url)
  })

  ipcMain.handle('shell:show-item', (_event, path: string) => {
    if (path) shell.showItemInFolder(path)
  })
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                registerAccelerator: false,
                click: () => send('app:event', { name: 'settings' })
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          registerAccelerator: false,
          click: () => send('app:event', { name: 'new-session' })
        },
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          registerAccelerator: false,
          click: () => send('app:event', { name: 'open-folder' })
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          registerAccelerator: false,
          click: () => send('app:event', { name: 'toggle-sidebar' })
        },
        {
          label: 'Toggle Theme',
          accelerator: 'CmdOrCtrl+Shift+L',
          registerAccelerator: false,
          click: () => send('app:event', { name: 'toggle-theme' })
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'pi documentation',
          click: () => shell.openExternal('https://pi.dev')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const settings = loadSettings()
  const bounds = settings.windowBounds

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 860,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: settings.theme === 'light' ? '#f7f6f3' : '#0c0d0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', () => {
    if (!mainWindow) return
    const { x, y, width, height } = mainWindow.getBounds()
    saveSettings({ windowBounds: { x, y, width, height } })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    void closeSession()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL()
    if (current && !url.startsWith(current.split('#')[0])) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.setName('Pi Desktop')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && !app.isPackaged) {
      try {
        app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
      } catch {
        // icon is optional in development
      }
    }
    registerIpc()
    buildMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    proc?.stop()
  })
}
