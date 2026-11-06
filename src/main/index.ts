import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  powerMonitor,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
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
import {
  browserBack,
  browserBounds,
  browserClose,
  browserForward,
  browserNavigate,
  browserOpen,
  browserReload,
  browserSetVisible,
  browserStop,
  initBrowser
} from './browser'
import { importChromeCookies, listChromeProfiles, previewChromeProfile } from './chrome-import'
import { startBrowserBridge, stopBrowserBridge } from './browser-bridge'
import { locatePi, piVersion } from './pi-locate'
import { deleteSession, listSessions, restoreSession, sessionExists, sessionsRoot } from './sessions'
import { loadSettings, saveSettings } from './settings'
import { validateCron } from './schedule-cadence'
import { ensureScheduleCli, scheduleGuidance } from './schedule-bridge'
import {
  backgroundSchedulerStatus,
  installBackgroundScheduler,
  uninstallBackgroundScheduler
} from './platform-scheduler'
import { agentDir, loadPiSettings, piSettingsFile, savePiSettings } from './pi-settings'
import {
  listPiModels,
  readModelsConfig,
  refreshModelCatalog,
  removeProvider,
  saveProvider
} from './models'
import { countSkills, listConnectors, listSkills, readSkillFile } from './skills'
import { listPackages, runPiPackageCommand } from './packages'
import { scheduler } from './schedules'
import { listSessionNotices } from './session-notices'
import { rememberActiveSession } from './active-sessions'
import { usageSummary } from './usage'

let mainWindow: BrowserWindow | null = null
let proc: PiProcess | null = null
const processes = new Map<string, PiProcess>()
let sessionCounter = 0
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

function sessionKey(sessionPath: string): string {
  return `session:${sessionPath}`
}

function wireProcess(process: PiProcess, key: string): void {
  process.on('record', (record: PiRecord) => {
    if (proc === process) send('pi:record', record)
  })
  process.on('stderr', (chunk: string) => {
    if (proc === process) send('pi:stderr', chunk)
  })
  process.on('exit', (info: { code: number | null; signal: string | null; intentional?: boolean }) => {
    if (processes.get(key) === process) processes.delete(key)
    for (const [candidate, value] of processes) {
      if (value === process) processes.delete(candidate)
    }
    if (proc === process) {
      proc = null
      send('pi:status', { status: 'exited', code: info.code, signal: info.signal })
    }
  })
  process.on('protocol-error', (line: string) => {
    console.error('[pi] failed to parse record:', line)
  })
}

function stopProcess(process: PiProcess): void {
  for (const [candidate, value] of processes) {
    if (value === process) processes.delete(candidate)
  }
  process.stop()
}

async function closeSession(): Promise<void> {
  const current = proc
  proc = null
  if (current) {
    stopProcess(current)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

function scratchWorkspace(): string {
  const dir = join(app.getPath('userData'), 'scratch')
  mkdirSync(dir, { recursive: true })
  return realpathSync(dir)
}

async function doOpenSession(options: {
  cwd: string
  sessionPath?: string | null
  scratch?: boolean
}): Promise<OpenSessionResult> {
  const english = loadSettings().language === 'en'
  const requested = options.cwd?.trim()
  if (!options.scratch && (!requested || !existsSync(requested) || !statSync(requested).isDirectory())) {
    return { ok: false, error: english ? 'Please choose an existing folder.' : '请选择一个存在的文件夹。' }
  }
  const scratchRoot = scratchWorkspace()
  const cwd = options.scratch ? scratchRoot : realpathSync(requested)
  const scratch = options.scratch === true || cwd === scratchRoot

  if (options.sessionPath && !(await sessionExists(options.sessionPath))) {
    return { ok: false, error: english ? 'This session file no longer exists.' : '这个会话文件已经不存在了。' }
  }

  const targetKey = options.sessionPath ? sessionKey(options.sessionPath) : null
  if (targetKey) {
    const existing = processes.get(targetKey)
    if (existing?.alive) {
      proc = existing
      try {
        const stateResponse = await existing.send<{ sessionFile?: string | null }>(
          { type: 'get_state' },
          20_000
        )
        const existingPath = stateResponse.data?.sessionFile ?? options.sessionPath ?? null
        if (existingPath) rememberActiveSession(existing.cwd, existingPath)
        if (!scratch) {
          saveSettings({
            lastWorkspace: existing.cwd,
            workspaces: [...loadSettings().workspaces, existing.cwd]
          })
        } else {
          saveSettings({})
        }
        send('app:settings', loadSettings())
        return {
          ok: true,
          cwd: existing.cwd,
          sessionPath: existingPath,
          scratch
        }
      } catch {
        processes.delete(targetKey)
      }
    }
  }

  const settings = loadSettings()
  const piPath = locatePi(settings.piPath)
  const process = new PiProcess()
  const key = targetKey ?? `new:${cwd}:${++sessionCounter}`
  wireProcess(process, key)

  try {
    await process.start({
      cwd,
      piPath,
      sessionPath: options.sessionPath ?? undefined,
      appendSystemPrompt: scheduleGuidance()
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: /ENOENT/.test(message)
        ? english ? `Pi executable not found: "${piPath}". Set its path in Settings.` : `找不到 pi 可执行文件："${piPath}"。请在设置里指定路径。`
        : english ? `Could not start pi: ${message}` : `无法启动 pi：${message}`
    }
  }

  proc = process
  processes.set(key, process)

  try {
    const response = await process.send<{ sessionFile?: string | null }>(
      { type: 'get_state' },
      25_000
    )
    if (!response.success) {
      throw new Error(response.error || 'get_state failed')
    }
    let sessionFile = response.data?.sessionFile ?? options.sessionPath ?? null
    if (!sessionFile) {
      // pi may not materialize a new session until the first prompt; create it
      // now so the sidebar can track the running session immediately.
      const created = await process.send<{ sessionFile?: string | null }>(
        { type: 'new_session' },
        20_000
      )
      if (created.success) sessionFile = created.data?.sessionFile ?? null
    }
    if (sessionFile) processes.set(sessionKey(sessionFile), process)
    if (sessionFile) rememberActiveSession(cwd, sessionFile)

    saveSettings(
      scratch
        ? {}
        : {
            lastWorkspace: cwd,
            workspaces: [...settings.workspaces, cwd]
          }
    )
    send('app:settings', loadSettings())
    return { ok: true, cwd, sessionPath: sessionFile, scratch }
  } catch (error) {
    process.stop()
    processes.delete(key)
    proc = null
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: english ? `Pi is not ready: ${message}` : `pi 没有就绪：${message}` }
  }
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'release',
  'output',
  '.next',
  '.cache',
  'coverage',
  '.venv',
  '__pycache__'
])

function runGit(cwd: string, args: string[]): string {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout
    return typeof stdout === 'string' ? stdout : ''
  }
}

function parseNumstat(output: string): Record<string, { additions: number; deletions: number }> {
  const stats: Record<string, { additions: number; deletions: number }> = {}
  for (const line of output.split('\n')) {
    const [additions, deletions, path] = line.split('\t')
    if (!path) continue
    stats[path] = {
      additions: Number(additions) || 0,
      deletions: Number(deletions) || 0
    }
  }
  return stats
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
      scratchPath: scratchWorkspace(),
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
    const settings = saveSettings(patch)
    if (patch.language !== undefined) buildMenu()
    if (patch.launchAtLogin !== undefined && app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: patch.launchAtLogin,
        args: ['--background']
      })
    }
    return settings
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
  ipcMain.handle('sessions:restore', (_event, trashPath: string, path: string) =>
    restoreSession(trashPath, path)
  )
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
        return { type: 'response', command: String(command.type), success: false, error: 'pi 没有在运行' }
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

  ipcMain.handle('skills:list', (_event, cwd: string) => listSkills(cwd))
  ipcMain.handle('skills:count', (_event, cwd: string) => countSkills(cwd))
  ipcMain.handle('connectors:list', (_event, cwd: string) => listConnectors(cwd))
  ipcMain.handle('skills:read', (_event, path: string) => readSkillFile(path))
  ipcMain.handle('packages:list', (_event, cwd: string) => listPackages(cwd))

  ipcMain.handle(
    'packages:install',
    (_event, source: string, options: { cwd: string; local?: boolean }) => {
      const args = ['install', source]
      if (options?.local) args.push('--local')
      return runPiPackageCommand(args, options?.cwd || homedir(), (progress) =>
        send('packages:progress', progress)
      )
    }
  )

  ipcMain.handle('packages:remove', (_event, source: string, cwd: string) =>
    runPiPackageCommand(['remove', source], cwd || homedir(), (progress) =>
      send('packages:progress', progress)
    )
  )

  ipcMain.handle('packages:update', (_event, source: string, cwd: string) =>
    runPiPackageCommand(['update', source], cwd || homedir(), (progress) =>
      send('packages:progress', progress)
    )
  )

  ipcMain.handle('schedules:list', () => scheduler.list())
  ipcMain.handle('usage:summary', (_event, range) => usageSummary(range))
  ipcMain.handle('session:notices', (_event, sessionPath: string) => listSessionNotices(sessionPath))
  ipcMain.handle('schedules:get', (_event, id: string) => scheduler.get(id))
  ipcMain.handle('schedules:create', (_event, input) => scheduler.create(input))
  ipcMain.handle('schedules:update', (_event, id: string, patch) => scheduler.update(id, patch))
  ipcMain.handle('schedules:delete', (_event, id: string) => scheduler.remove(id))
  ipcMain.handle('schedules:set-enabled', (_event, id: string, enabled: boolean) =>
    scheduler.setEnabled(id, enabled)
  )
  ipcMain.handle('schedules:run-now', (_event, id: string) => scheduler.runNow(id))
  ipcMain.handle('schedules:preview', (_event, cadence, count?: number, timezone?: string) =>
    scheduler.preview(cadence, count, timezone)
  )
  ipcMain.handle('schedules:validate-cron', (_event, expression: string) =>
    validateCron(expression)
  )
  ipcMain.handle('scheduler:background-status', () => backgroundSchedulerStatus())
  ipcMain.handle('scheduler:set-background', async (_event, enabled: boolean) => {
    const status = enabled
      ? await installBackgroundScheduler()
      : await uninstallBackgroundScheduler()
    if (!enabled || status.installed === enabled) {
      saveSettings({ backgroundScheduler: enabled })
    }
    return status
  })

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

  ipcMain.handle('browser:open', (_event, url: string) => browserOpen(url))
  ipcMain.handle('browser:navigate', (_event, url: string) => browserNavigate(url))
  ipcMain.handle('browser:back', () => browserBack())
  ipcMain.handle('browser:forward', () => browserForward())
  ipcMain.handle('browser:reload', () => browserReload())
  ipcMain.handle('browser:stop', () => browserStop())
  ipcMain.handle('browser:close', () => browserClose())
  ipcMain.handle('browser:bounds', (_event, bounds) => browserBounds(bounds))
  ipcMain.handle('browser:visible', (_event, visible: boolean) => browserSetVisible(visible))
  ipcMain.handle('chrome:profiles', () => listChromeProfiles())
  ipcMain.handle('chrome:preview', (_event, profileId: string) => previewChromeProfile(profileId))
  ipcMain.handle('chrome:import', (_event, profileId: string, domains: string[]) =>
    importChromeCookies(profileId, domains)
  )

  ipcMain.handle('shell:show-item', (_event, path: string) => {
    if (path) shell.showItemInFolder(path)
  })

  ipcMain.handle(
    'fs:read-dir',
    (_event, path: string, options?: { showHidden?: boolean }) => {
      const dir = resolve(path)
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => options?.showHidden || !entry.name.startsWith('.'))
        .filter((entry) => !(entry.isDirectory() && IGNORED_DIRS.has(entry.name)))
        .map((entry) => {
          const full = join(dir, entry.name)
          let size = 0
          try {
            size = entry.isFile() ? statSync(full).size : 0
          } catch {
            size = 0
          }
          return { name: entry.name, path: full, isDir: entry.isDirectory(), size }
        })
        .sort((a, b) =>
          a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
        )
      return entries
    }
  )

  ipcMain.handle('fs:read-text', (_event, path: string, maxBytes = 200_000) => {
    try {
      const stat = statSync(path)
      if (!stat.isFile()) return { ok: false, error: 'not a file' }
      const size = Math.min(stat.size, maxBytes)
      const buffer = readFileSync(path)
      const slice = buffer.subarray(0, size)
      return {
        ok: true,
        content: slice.toString('utf8'),
        truncated: buffer.length > size,
        size: stat.size
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('git:status', (_event, cwd: string) => {
    const dir = resolve(cwd)
    const branch = runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
    const porcelain = runGit(dir, ['status', '--porcelain=v1'])
    const unstaged = parseNumstat(runGit(dir, ['diff', '--numstat']))
    const staged = parseNumstat(runGit(dir, ['diff', '--cached', '--numstat']))
    const files = porcelain
      .split('\n')
      .filter((line) => line.trim().length > 3)
      .map((line) => {
        const status = line.slice(0, 2).trim() || '?'
        const raw = line.slice(3).trim()
        const path = raw.includes(' -> ') ? raw.split(' -> ').pop() ?? raw : raw
        const stat = staged[path] ?? unstaged[path] ?? { additions: 0, deletions: 0 }
        return {
          path: resolve(dir, path),
          relative: path,
          status,
          staged: line[0] !== ' ' && line[0] !== '?',
          additions: stat.additions,
          deletions: stat.deletions
        }
      })
    return { ok: branch.length > 0, branch, files }
  })

  ipcMain.handle(
    'git:diff',
    (_event, cwd: string, path: string, staged?: boolean) => {
      const dir = resolve(cwd)
      const args = ['diff', '--no-color']
      if (staged) args.push('--cached')
      args.push('--', path)
      return runGit(dir, args)
    }
  )

  ipcMain.handle('shell:open-path', async (_event, path: string): Promise<boolean> => {
    if (!path) return false
    const error = await shell.openPath(path)
    return error === ''
  })

  // Desktop notification, only when the window is not in front: a focused
  // window already shows the result.
  ipcMain.handle(
    'notify:desktop',
    (_event, payload: { title?: string; body?: string }): boolean => {
      if (!Notification.isSupported()) return false
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return false
      const notification = new Notification({
        title: payload?.title ?? 'Pi Desktop',
        body: payload?.body ?? ''
      })
      notification.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show()
          mainWindow.focus()
        }
      })
      notification.show()
      return true
    }
  )

  ipcMain.handle(
    'dialog:pick-save',
    async (_event, options?: { defaultName?: string; filters?: { name: string; extensions: string[] }[] }) => {
      const exportDir = process.env.PI_DESKTOP_EXPORT_DIR?.trim()
      if (exportDir) {
        // Test hook: skip the native dialog and write into a known directory.
        return join(exportDir, options?.defaultName ?? 'export.txt')
      }
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, {
            defaultPath: options?.defaultName,
            filters: options?.filters
          })
        : await dialog.showSaveDialog({
            defaultPath: options?.defaultName,
            filters: options?.filters
          })
      if (result.canceled || !result.filePath) return null
      return result.filePath
    }
  )

  ipcMain.handle('fs:write-text', (_event, path: string, content: string): boolean => {
    try {
      writeFileSync(path, content, 'utf8')
      return true
    } catch {
      return false
    }
  })
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const english = loadSettings().language === 'en'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: english ? 'Settings…' : '设置…',
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
      label: english ? 'File' : '文件',
      submenu: [
        {
          label: english ? 'New session' : '新建会话',
          accelerator: 'CmdOrCtrl+N',
          registerAccelerator: false,
          click: () => send('app:event', { name: 'new-session' })
        },
        {
          label: english ? 'Open project…' : '打开项目…',
          accelerator: 'CmdOrCtrl+O',
          registerAccelerator: false,
          click: () => send('app:event', { name: 'open-folder' })
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: english ? 'Edit' : '编辑',
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
      label: english ? 'View' : '显示',
      submenu: [
        {
          label: english ? 'Toggle sidebar' : '收起/展开侧栏',
          accelerator: 'CmdOrCtrl+B',
          registerAccelerator: false,
          click: () => send('app:event', { name: 'toggle-sidebar' })
        },
        {
          label: english ? 'Toggle theme' : '切换主题',
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
      label: english ? 'Window' : '窗口',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'close' }]
    },
    {
      role: 'help',
      submenu: [
        {
          label: english ? 'Pi documentation' : 'pi 文档',
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
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 18, y: 20 }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  const background = process.argv.includes('--background')
  initBrowser(mainWindow)
  void startBrowserBridge().catch(() => undefined)
  mainWindow.on('ready-to-show', () => {
    if (!background) mainWindow?.show()
  })

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
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--scheduler-run-due')) return
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    ensureScheduleCli()
    if (process.argv.includes('--scheduler-run-due')) {
      app.dock?.hide()
      void scheduler
        .runHeadlessTick()
        .catch(() => undefined)
        .finally(() => app.quit())
      return
    }
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

    const settings = loadSettings()
    if (app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: settings.launchAtLogin === true,
        args: ['--background']
      })
    }
    if (settings.backgroundScheduler === true) {
      void backgroundSchedulerStatus().then((status) => {
        if (!status.installed) void installBackgroundScheduler()
      })
    }
    scheduler.init(
      () => send('schedules:changed', scheduler.list()),
      (event) => send('schedules:event', event),
      (taskId) => {
        send('schedules:open', taskId)
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
        }
      }
    )
    powerMonitor.on('resume', () => scheduler.recoverNow())

    app.on('activate', () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      } else {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    void stopBrowserBridge()
    scheduler.shutdown()
    for (const process of new Set(processes.values())) process.stop()
    processes.clear()
    proc = null
  })
}
