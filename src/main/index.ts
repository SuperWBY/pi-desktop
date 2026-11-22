import { sendCreatorControl } from './creator-control'
import { validCreatorAction, isCreatorState, decodeCreatorRecord, type CreatorState } from '@shared/creator'
import { installCreatorDraft, listCreatedPlugins } from './creator'
import { backgroundNodeExecutable, resolvePiCliJs } from './pi-exec'
import { chromePairingPath, prepareChromePairing } from '../../extensions/computer-use/src/chrome-bridge-pairing'
import { renderSvgPreview } from '../../extensions/computer-use/src/artifact-preview'
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  powerMonitor,
  screen,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { checkChromeBridge } from './chrome-bridge-check'
import { createDesktopPermissionService } from './desktop-permission-service'
import { SessionUiRequests } from './session-ui-requests'
import { InterruptedUiJournal } from './interrupted-ui-journal'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { constants as fsConstants, createWriteStream } from 'node:fs'
import { mkdtemp, open as openFileHandle, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { Readable, Transform } from 'node:stream'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type {
  AddProjectResult,
  AssistantMessage,
  Bootstrap,
  CustomProviderEntry,
  ModelsConfig,
  PiModelRow,
  OpenSessionResult,
  PiRecord,
  PiState,
  PiSettings,
  ScheduleInterpretationInput,
  SessionPermission,
  SessionPermissionChange,
  SessionSecurity,
  Settings
} from '@shared/types'
import { PiProcess } from './pi'
import { registerDictation } from './dictation'
import { MediaPreview, mediaScheme, registerMediaScheme } from './media-preview'
import { prepareComputerUseRuntime } from './computer-use-runtime'
import { findExistingComputerUse } from './existing-computer-use'
import {
  browserPreview, panelPage, revealPage, setPanelBounds, setPanelVisible,
  initBrowser
} from './browser'
import { importChromeCookies, listChromeProfiles, previewChromeProfile } from './chrome-import'
import { browserBridgePath, startBrowserBridge, stopBrowserBridge } from './browser-bridge'
import { externalBrowserFrame } from './external-browser-preview'
import { augmentedPath, piVersion } from './pi-locate'
import { resolvePiPath } from './pi-runtime'
import { projectTrustStatus, setProjectTrust } from './project-trust'
import { checkForUpdate, downloadUpdate, openReleasePage } from './update'
import { listAuthProviders, removeAuthProvider, saveApiKey, validateApiKey } from './auth-store'
import { cancelOAuth, listOAuthProviders, listRuntimeAuthProviders, respondOAuth, startOAuth } from './pi-auth'
import { deleteSession, listSessions, restoreSession, searchSessions, sessionExists, sessionsRoot } from './sessions'
import { listWorkspaceFiles } from './workspace-files'
import { inspectPackage } from './package-inspect'
import { allowedDomains, createSandbox, sandboxStatus, validNetworkHost } from './sandbox'
import { proxyEnv } from './network-env'
import { appendSandboxAudit, readSandboxAudit } from './sandbox-audit'
import { searchPackageCatalog } from './package-catalog'
import { getPackageDetails } from './package-details'
import { browserRouterStatus, startCdpBrowser } from './browser-router-status'
import { isTemporaryWorkspace, pathsEqual, projectReadOnly } from '@shared/paths'
import { desktopNotifyCopy } from '@shared/notification-copy'
import { loadSettings, saveSettings, settingsFile } from './settings'
import { jevEnv, jevStatus, saveJevSettings } from './jev-store'
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
import { listMcpConnectors, removeMcpConnector, saveMcpConnector, testMcpConnector } from './mcp-connectors'
import type { McpConnectorInput } from '@shared/types'
import { listPackagesAsync, runPiPackageCommand, validPackageSourceArg } from './packages'
import { scheduler } from './schedules'
import { createPackageTranslator } from './package-translation'
import { translatePackageTexts, stopPackageTranslations } from './package-translation-model'
import { interpretSchedule } from './schedule-interpret'
import { listSessionNotices } from './session-notices'
import { rememberActiveSession } from './active-sessions'
import { usageSummary } from './usage'
import {
  initPtyTerminal,
  createPtyTerminal,
  writePtyTerminal,
  resizePtyTerminal,
  killPtyTerminal,
  stopAllPtyTerminals
} from './pty-terminal'

// The bundled Pi seed uses Electron's embedded Node; child processes inherit
// this so the launcher can find the exact app executable.
if (!process.env.PI_DESKTOP_ELECTRON || process.env.PI_DESKTOP_ELECTRON === process.execPath) process.env.PI_DESKTOP_ELECTRON = backgroundNodeExecutable()

let mainWindow: BrowserWindow | null = null
let proc: PiProcess | null = null
registerMediaScheme()
const mediaPreview = new MediaPreview()
const MEDIA_IMAGE_LIMIT_BYTES = 32 * 1024 * 1024
const MEDIA_FILE_LIMIT_BYTES = 512 * 1024 * 1024
const MEDIA_TIMEOUT_MS = 120_000
const MEDIA_MAX_REDIRECTS = 4
let changingSessionPermission = false
const processes = new Map<string, PiProcess>()
const runningProcesses = new Set<PiProcess>()
let sessionCounter = 0
let permissionGuideWindow: BrowserWindow | null = null
type PiInstallResult = { ok: boolean; piPath?: string; piVersion?: string | null; output?: string; error?: string }
let piInstallTask: Promise<PiInstallResult> | null = null

/**
 * First-run installation of the official Pi runtime. The app intentionally
 * does not ship a private copy: pi manages its own signed releases, models and
 * credentials, and users expect `pi update` to keep working afterwards.
 */
function installPiRuntime(): Promise<PiInstallResult> {
  if (piInstallTask) return piInstallTask
  const windows = process.platform === 'win32'
  const task = new Promise<PiInstallResult>((resolve) => {
    const emit = (stage: string, message: string): void => send('pi:install-progress', { stage, message })
    emit('starting', '正在连接 pi.dev…')
    const child = windows
      ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://pi.dev/install.ps1 | iex'], {
          cwd: homedir(),
          env: { ...process.env, PATH: augmentedPath(), CI: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        })
      : spawn('/bin/sh', ['-lc', 'curl -fsSL https://pi.dev/install.sh | sh'], {
          cwd: homedir(),
          env: { ...process.env, PATH: augmentedPath(), CI: '1' },
          stdio: ['ignore', 'pipe', 'pipe']
        })
    let output = ''
    const append = (chunk: Buffer): void => {
      output = (output + chunk.toString()).slice(-12_000)
    }
    child.stdout.on('data', (chunk: Buffer) => { append(chunk); emit('installing', '正在安装 Pi 运行时…') })
    child.stderr.on('data', (chunk: Buffer) => { append(chunk); emit('installing', '正在安装 Pi 运行时…') })
    let settled = false
    const finish = (result: PiInstallResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2000)
      finish({ ok: false, error: 'Pi installation timed out. Check your network and try again.', output })
    }, 300_000)
    child.on('error', (error) => finish({ ok: false, error: error.message, output }))
    child.on('close', (code) => {
      if (code !== 0) {
        finish({ ok: false, error: `Pi installation failed (exit ${code ?? 'unknown'}).`, output })
        return
      }
      emit('verifying', '正在检查 Pi 安装…')
      const installed = resolvePiPath()
      const version = piVersion(installed)
      if (!version) {
        finish({ ok: false, error: 'Pi installation finished, but the executable could not be found. Restart Pi Desktop and check again.', output })
        return
      }
      emit('ready', `Pi ${version} 已就绪`)
      finish({ ok: true, piPath: installed, piVersion: version, output })
    })
  })
  piInstallTask = task
  void task.finally(() => { if (piInstallTask === task) piInstallTask = null })
  return task
}

let permissionGuideKind: 'accessibility' | 'screen' | null = null

function showPermissionGuide(kind: 'accessibility' | 'screen'): void {
  if (process.platform !== 'darwin') return
  permissionGuideKind = kind
  if (permissionGuideWindow && !permissionGuideWindow.isDestroyed()) { permissionGuideWindow.showInactive(); return }
  const area = screen.getDisplayMatching(mainWindow?.getBounds() ?? screen.getPrimaryDisplay().bounds).workArea
  const width = Math.min(400, area.width)
  const height = 118
  const guide = new BrowserWindow({
    width, height, x: Math.round(area.x + (area.width - width) / 2), y: area.y + area.height - height - 12,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
    backgroundColor: '#202328',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, nodeIntegration: false }
  })
  permissionGuideWindow = guide
  guide.on('closed', () => { if (permissionGuideWindow === guide) { permissionGuideWindow = null; permissionGuideKind = null } })
  guide.once('ready-to-show', () => guide.showInactive())
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) { const url = new URL(devUrl); url.searchParams.set('view', 'permission-guide'); void guide.loadURL(url.toString()) }
  else void guide.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'permission-guide' } })
}
let queue: Promise<unknown> = Promise.resolve()
const execFileAsync = promisify(execFile)

async function desktopPermissionService() {
  const current = proc
  const cwd = current?.cwd || loadSettings().lastWorkspace || homedir()
  let runningRoot: string | undefined
  let provisional = true
  if (current?.desktopToolInfoFile && !existsSync(current.desktopToolInfoFile)) {
    const state = await current.send<{ isStreaming?: boolean }>({ type: 'get_state' }, 5000)
    if (!state.success || state.data?.isStreaming) throw new Error('The current session is busy; try the permission check again after the task finishes.')
    const response = await current.send({ type: 'prompt', message: '/pi-desktop-access-status' }, 5000)
    if (!response.success) throw new Error(response.error || 'The current Computer Use component could not be identified.')
    const deadline = Date.now() + 2000
    while (!existsSync(current.desktopToolInfoFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (current?.desktopToolInfoFile) {
    try {
      const info = JSON.parse(readFileSync(current.desktopToolInfoFile, 'utf8')) as { helperRoot?: unknown; provisional?: unknown }
      if (typeof info.helperRoot !== 'string' || !info.helperRoot) throw new Error('The current Computer Use extension does not expose a recognizable permission helper.')
      runningRoot = info.helperRoot
      provisional = info.provisional !== false
    } catch (error) {
      if (error instanceof Error && error.message.includes('does not expose')) throw error
      throw new Error('The current Computer Use session is not ready for a permission check. Try again or start a new session.')
    }
  }
  const direct = runningRoot ? undefined : findExistingComputerUse(agentDir(), cwd)
  const existing = runningRoot || direct ? undefined : (await listPackagesAsync(cwd)).find((item) => item.name === 'pi-desktop-computer-use' && item.path)
  const root = runningRoot || direct || existing?.path || (app.isPackaged
    ? prepareComputerUseRuntime(join(app.getAppPath(), 'extensions', 'computer-use'), app.getPath('userData'))
    : join(app.getAppPath(), 'extensions', 'computer-use'))
  const helper = join(root, 'bin', process.platform === 'win32' ? 'computer-use-helper.ps1' : 'computer-use-helper')
  const service = createDesktopPermissionService({
    async run(command) {
      const executable = process.platform === 'win32' ? 'powershell.exe' : helper
      const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, command] : [command]
      const { stdout } = await execFileAsync(executable, args, { timeout: command.startsWith('request-') ? 120_000 : 30_000, windowsHide: true })
      const result = JSON.parse(stdout) as Record<string, unknown>
      if (result.ok !== true) throw new Error(String(result.error || 'Computer Use permission check failed.'))
      return result
    },
    async open(kind) {
      if (process.platform !== 'darwin') throw new Error('Open your operating system privacy settings to grant Computer Use permissions.')
      const pane = kind === 'accessibility' ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture'
      await execFileAsync('/usr/bin/open', [`x-apple.systempreferences:com.apple.preference.security?${pane}`], { timeout: 10_000 })
      showPermissionGuide(kind)
    }
  })
  return { service, provisional }
}

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

// Keep Notification instances alive until click/close so macOS delivers the click.
const liveNotifications = new Set<Notification>()

function showDesktopNotification(payload: {
  title?: string
  body?: string
  cwd?: string | null
  sessionPath?: string | null
}): boolean {
  if (!Notification.isSupported()) return false
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return false
  const notification = new Notification({
    title: payload?.title?.trim() || 'Pi',
    body: payload?.body ?? ''
  })
  liveNotifications.add(notification)
  const release = (): void => {
    liveNotifications.delete(notification)
  }
  notification.once('click', () => {
    release()
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    if (payload?.sessionPath) {
      mainWindow.webContents.send('notify:open-session', {
        cwd: payload.cwd ?? null,
        sessionPath: payload.sessionPath
      })
    }
  })
  notification.once('close', release)
  notification.once('failed', release)
  if (process.env.PI_DESKTOP_NOTIFY_LOG) {
    try {
      console.log(
        '[notify:desktop]',
        JSON.stringify({
          title: payload?.title,
          body: payload?.body,
          cwd: payload?.cwd ?? null,
          sessionPath: payload?.sessionPath ?? null
        })
      )
    } catch {
      /* ignore */
    }
  }
  notification.show()
  return true
}

const sessionUiRequests = new SessionUiRequests(
  (record) => send('pi:record', record),
  (owner, response) => (owner as PiProcess).write(response),
  () => publishPendingSessionRequests(),
  {
    begin: (owner, token) => {
      const process = owner as PiProcess
      const key = [...processes.entries()].find(([key, value]) => key.startsWith('session:') && value === process)?.[0]
      uiJournal().begin(token, { cwd: process.cwd, sessionPath: key ? key.slice('session:'.length) : null })
    },
    finish: (token) => uiJournal().finish(token),
    interrupt: (token) => { uiJournal().interrupt(token); publishInterruptedUi() },
    error: () => send('pi:record', { type: 'desktop_ui_journal_error' })
  }
)

let uiJournalInstance: InterruptedUiJournal | undefined
function uiJournal(): InterruptedUiJournal {
  return uiJournalInstance ??= new InterruptedUiJournal(join(app.getPath('userData'), 'interrupted-ui-requests.json'))
}
function publishInterruptedUi(): void { send('pi:record', { type: 'desktop_interrupted_ui', entries: uiJournal().interrupted() }) }

function publishPendingSessionRequests(): void {
  const owners = new Set(sessionUiRequests.pendingOwners())
  const sessions = [...processes.entries()].flatMap(([key, process]) =>
    key.startsWith('session:') && process !== proc && owners.has(process)
      ? [{ path: key.slice('session:'.length), cwd: process.cwd }]
      : []
  )
  send('pi:record', { type: 'desktop_background_ui_pending', sessions })
}

function sessionKey(sessionPath: string): string {
  return `session:${sessionPath}`
}

function runningSessionPaths(): string[] {
  return [...runningProcesses].flatMap((process) => {
    const path = process.sessionPath
    return path && processes.get(sessionKey(path)) === process ? [path] : []
  })
}

function publishRunningSessions(): void {
  send('pi:record', { type: 'desktop_running_sessions', paths: runningSessionPaths() })
}

function bindSessionPath(process: PiProcess, path: string | null): void {
  const changed = process.sessionPath !== path || Boolean(path && processes.get(sessionKey(path)) !== process)
  if (process.sessionPath && process.sessionPath !== path && processes.get(sessionKey(process.sessionPath)) === process) {
    processes.delete(sessionKey(process.sessionPath))
  }
  process.sessionPath = path
  if (path) processes.set(sessionKey(path), process)
  if (changed && runningProcesses.has(process)) publishRunningSessions()
}

const creatorStates = new WeakMap<PiProcess, CreatorState>()
const creatorOperations = new WeakSet<PiProcess>()

function wireProcess(process: PiProcess, key: string): void {
  let heldStderr = ''
  let lastAssistantFailed = false
  process.on('record', (rawRecord: PiRecord) => {
    const record = decodeCreatorRecord(rawRecord) as PiRecord
    if (record.type === 'agent_start') {
      process.blockedNetworkHost = undefined
      if (!runningProcesses.has(process)) {
        lastAssistantFailed = false
        runningProcesses.add(process)
        publishRunningSessions()
        if (!process.sessionPath) {
          // A fresh chat may only get a path when its first turn starts.
          void process.send<PiState>({ type: 'get_state' }).then((result) => {
            const path = result.data?.sessionFile
            if (result.success && path && !process.sessionPath && process.alive && processes.get(key) === process) {
              bindSessionPath(process, path)
            }
          }).catch(() => undefined)
        }
      }
    } else if (record.type === 'message_end') {
      const message = record.message as AssistantMessage | undefined
      if (message?.role === 'assistant') lastAssistantFailed = Boolean(message.errorMessage)
    } else if (record.type === 'agent_settled' && runningProcesses.delete(process)) {
      publishRunningSessions()
      const settings = loadSettings()
      if (settings.notifyOnFinish !== false) {
        showDesktopNotification({
          ...desktopNotifyCopy(lastAssistantFailed ? 'error' : 'done', settings.language),
          cwd: process.cwd,
          sessionPath: process.sessionPath ?? (key.startsWith('session:') ? key.slice('session:'.length) : null)
        })
      }
    }
    if (record.type === 'extension_ui_request' && record.method === 'creator_state') {
      const value = record.state as CreatorState | undefined
      if (isCreatorState(value)) creatorStates.set(process, value)
    }
    if (record.type === 'extension_ui_request' && record.method === 'creator_result') return
    if (sessionUiRequests.receive(process, record)) return
    if (proc === process) {
      send('pi:record', record)
      return
    }
  })
  process.on('stderr', (chunk: string) => {
    const visible: string[] = []
    for (const line of chunk.split('\n')) {
      if (!line) continue
      if (process.sandboxed && /No matching rule, denying:|Connection blocked to/i.test(line)) {
        const match = line.match(/(?:denying|blocked to):?\s*([^\s:]+)(?::(\d+))?/i)
        const host = match?.[1]
        const port = match?.[2] ? Number(match[2]) : undefined
        appendSandboxAudit({ type: 'network_denied', host, port, line: line.slice(0, 500) })
        if (host && validNetworkHost(host)) {
          process.blockedNetworkHost = host
          if (proc === process) send('sandbox:domain-denied', {
            host, port, sessionPath: process.sessionPath, offline: process.security.network === 'off'
          })
        }
      } else if (process.sandboxed && /Allowed by config rule:/i.test(line)) {
        const match = line.match(/Allowed by config rule:\s*([^\s:]+)(?::(\d+))?/i)
        appendSandboxAudit({ type: 'network_allowed', host: match?.[1], port: match?.[2] ? Number(match[2]) : undefined, line: line.slice(0, 500) })
      } else if (line.startsWith('[SandboxDebug]')) {
        if (process.sandboxed) appendSandboxAudit({ type: 'sandbox_debug', line: line.slice(0, 1000) })
      } else {
        visible.push(line)
      }
    }
    if (visible.length) {
      const text = `${visible.join('\n')}\n`
      if (proc === process) send('pi:stderr', text)
      else heldStderr += text
    }
  })
  const flushStderr = (): void => {
    if (!heldStderr || proc !== process) return
    send('pi:stderr', heldStderr)
    heldStderr = ''
  }
  ;(process as PiProcess & { flushStderr?: () => void }).flushStderr = flushStderr
  process.on('exit', (info: { code: number | null; signal: string | null; intentional?: boolean }) => {
    if (runningProcesses.delete(process)) publishRunningSessions()
    if (process.sandboxed) appendSandboxAudit({ type: 'exit', code: info.code, signal: info.signal })
    sessionUiRequests.drop(process)
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
  if (runningProcesses.delete(process)) publishRunningSessions()
  process.stop()
}

async function closeSession(): Promise<void> {
  const current = proc
  proc = null
  sessionUiRequests.activate(null)
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

function addProject(input: { cwd: string; name: string; trust?: boolean }): AddProjectResult {
  const settings = loadSettings()
  const english = settings.language === 'en'
  let cwd: string
  try {
    if (typeof input?.cwd !== 'string' || !input.cwd) throw new Error()
    cwd = realpathSync(input.cwd)
    if (!statSync(cwd).isDirectory() || isTemporaryWorkspace(cwd, scratchWorkspace())) throw new Error()
  } catch {
    throw new Error(english ? 'Choose an existing project folder.' : '请选择一个仍然存在的项目文件夹。')
  }
  if (settings.workspaces.includes(cwd)) return { status: 'added', cwd }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error(english ? 'Enter a project name of 1–80 characters.' : '请输入 1 到 80 个字符的项目名称。')
  }
  const trust = projectTrustStatus(cwd)
  const undecided = trust.decision === null
  if (undecided && (typeof input.trust !== 'boolean' || input.cwd !== cwd)) {
    return { status: 'needs-trust', cwd, trust }
  }
  if (undecided) setProjectTrust(cwd, input.trust!, 'project')
  try {
    const next = saveSettings({
      workspaces: [...settings.workspaces, cwd],
      workspaceNames: { ...settings.workspaceNames, [cwd]: name }
    })
    send('app:settings', next)
    return { status: 'added', cwd }
  } catch (error) {
    if (undecided) setProjectTrust(cwd, null, 'project')
    throw error
  }
}

async function doOpenSession(options: {
  cwd: string
  sessionPath?: string | null
  scratch?: boolean
  permission?: SessionPermission
  network?: 'model' | 'off'
  allowedNetworkHosts?: string[]
  replace?: PiProcess
  emptySession?: boolean
}): Promise<OpenSessionResult> {
  const english = loadSettings().language === 'en'
  if(options.replace&&creatorOperations.has(options.replace))return {ok:false,error:english?'Wait for the creator operation to finish.':'请等待创意模式操作结束后再重启会话。'}
  const requested = options.cwd?.trim()
  if (!options.scratch && (!requested || !existsSync(requested) || !statSync(requested).isDirectory())) {
    return { ok: false, error: english ? 'Please choose an existing folder.' : '请选择一个存在的文件夹。' }
  }
  const scratchRoot = scratchWorkspace()
  let cwd: string
  if (options.scratch) {
    const requestedScratch = requested && existsSync(requested) ? realpathSync(requested) : ''
    if (options.sessionPath && (!requestedScratch || !isTemporaryWorkspace(requestedScratch, scratchRoot))) {
      return { ok: false, error: english ? 'This conversation’s temporary folder is unavailable.' : '这个对话的临时文件夹不可用。' }
    }
    if (requestedScratch && isTemporaryWorkspace(requestedScratch, scratchRoot) && (options.sessionPath || !pathsEqual(requestedScratch, scratchRoot))) {
      cwd = requestedScratch
    } else {
      const parent = join(scratchRoot, 'conversations')
      mkdirSync(parent, { recursive: true, mode: 0o700 })
      if (!pathsEqual(realpathSync(parent), parent)) return { ok: false, error: english ? 'The temporary conversation directory is invalid.' : '临时对话目录不可用。' }
      const folder = join(parent, randomUUID())
      mkdirSync(folder, { mode: 0o700 })
      cwd = realpathSync(folder)
    }
  } else cwd = realpathSync(requested)
  const scratch = options.scratch === true || isTemporaryWorkspace(cwd, scratchRoot)

  const targetKey = options.sessionPath ? sessionKey(options.sessionPath) : null
  const openingArchived = Boolean(options.sessionPath && loadSettings().archivedSessionPaths?.includes(options.sessionPath))
  if (targetKey && !options.replace) {
    const existing = processes.get(targetKey)
    if (existing?.alive) {
      proc = existing
      sessionUiRequests.activate(existing)
      ;(existing as PiProcess & { flushStderr?: () => void }).flushStderr?.()
      try {
        const stateResponse = await existing.send<{ sessionFile?: string | null }>(
          { type: 'get_state' },
          20_000
        )
        const existingPath = stateResponse.data?.sessionFile ?? options.sessionPath ?? null
        const existingScratch = isTemporaryWorkspace(existing.cwd, scratchRoot)
        if (existingPath) rememberActiveSession(existing.cwd, existingPath)
        if (!existingScratch && !openingArchived && !isTemporaryWorkspace(existing.cwd, scratchRoot)) {
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
          scratch: existingScratch
        }
      } catch {
        processes.delete(targetKey)
      }
    }
  }

  if (options.sessionPath && !options.emptySession && !(await sessionExists(options.sessionPath))) {
    return { ok: false, error: english ? 'This session file no longer exists.' : '这个会话文件已经不存在了。' }
  }

  const settings = loadSettings()
  const permission = options.permission ?? (settings.toolApprovalMode === 'all' ? 'ask' : 'review')
  const network = options.network ?? settings.sandboxNetwork ?? 'model'
  const wantsSandbox = permission !== 'full'
  const readOnly = projectReadOnly(settings, cwd)
  const networkHosts = options.allowedNetworkHosts ?? []
  const sandboxSettings = {
    ...settings,
    sandboxNetwork: network,
    sandboxAllowedDomains: [...(settings.sandboxAllowedDomains ?? []), ...networkHosts]
  }
  const piPath = resolvePiPath(settings.piPath)
  const process = new PiProcess()
  const key = targetKey ?? `new:${cwd}:${++sessionCounter}`
  wireProcess(process, key)

  try {
    const runtime = app.isPackaged
      ? prepareComputerUseRuntime(join(app.getAppPath(), 'extensions', 'computer-use'), app.getPath('userData'))
      : join(app.getAppPath(), 'extensions', 'computer-use')
    const infoDir = join(app.getPath('userData'), 'computer-use-sessions')
    mkdirSync(infoDir, { recursive: true, mode: 0o700 })
    process.desktopToolInfoFile = join(infoDir, `${randomUUID()}.json`)
    const creatorRuntime = app.isPackaged ? prepareComputerUseRuntime(join(app.getAppPath(), 'extensions', 'creator'), app.getPath('userData'), 'creator') : join(app.getAppPath(), 'extensions', 'creator')
    const creatorCli = /\.[cm]?js$/.test(piPath) ? piPath : resolvePiCliJs(piPath)
    const additionalArgs = [
      '--extension', join(runtime, 'src', 'desktop-access-extension.ts'),
      '--extension', join(creatorRuntime, 'index.ts'),
      '--skill', join(runtime, 'desktop-guidance')
    ]
    if (globalThis.process.platform === 'darwin') additionalArgs.push('--extension', join(runtime, 'src', 'artifact-preview-extension.ts'))
    const sandbox = wantsSandbox ? createSandbox(cwd, sandboxSettings) : null
    if (wantsSandbox && !sandbox && (network === 'off' || readOnly)) {
      throw new Error(english ? 'File and network protection is unavailable on this device.' : '当前设备无法应用文件和网络保护。请检查连接与诊断设置。')
    }
    if (sandbox) {
      appendSandboxAudit({
        type: 'start',
        cwd,
        mode: readOnly ? 'read-only' : 'workspace-write',
        network,
        domains: sandboxSettings.sandboxAllowedDomains
      })
    }
    await process.start({
      cwd,
      piPath,
      sessionPath: options.sessionPath ?? undefined,
      additionalArgs,
      desktopSettingsFile: settingsFile(),
      desktopToolInfoFile: process.desktopToolInfoFile,
      security: {
        permission,
        mode: permission === 'full' ? 'never' : permission === 'ask' ? 'all' : 'dangerous',
        sandboxed: Boolean(sandbox),
        files: sandbox ? (readOnly ? 'read-only' : 'workspace-write') : undefined,
        network: sandbox ? network : 'unrestricted'
      },
      extraEnv: { ...jevEnv(), ...proxyEnv(settings), PI_DESKTOP_NETWORK: wantsSandbox ? network : 'unrestricted', PI_DESKTOP_CREATOR_CLI: creatorCli ?? '', PI_DESKTOP_CREATOR_FILES: readOnly ? 'read-only' : 'workspace-write' },
      sandbox: sandbox ?? undefined,
      appendSystemPrompt: `${scheduleGuidance()}\n\n${globalThis.process.platform === 'darwin' ? 'For a local SVG, use preview_svg to inspect the rendered image when visual verification is useful. It uses a private temporary file and leaves the original unchanged. If rendering reports invalid SVG or unsupported external resources, address that specific error; do not repeatedly try unrelated browsers or install packages just to preview it.' : ''}\n\n${sandbox ? 'This conversation runs with workspace file protection. Network access follows the user’s networking setting. If a request fails, report the actual error; do not bypass restrictions.' : ''}\n\nFor task-generated previews, use unique temporary paths; do not delete or overwrite an existing user file just to retry. If a tool or approach fails repeatedly for the same reason, stop repeating it, report the limitation, and use an available alternative only when appropriate.\n\nWhen your final answer delivers a working website or a specific web page the user needs to return to, link to it as [Page title](https://example.com "pi:website"). Use the actual URL, including an HTTP localhost URL for a running local preview. Use ordinary links for citations and pages visited only for research.`
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

  process.allowedNetworkHosts = networkHosts
  try {
    const response = await process.send<{ sessionFile?: string | null }>(
      { type: 'get_state' },
      25_000
    )
    if (!response.success) {
      throw new Error(response.error || 'get_state failed')
    }
    let sessionFile = response.data?.sessionFile ?? options.sessionPath ?? null
    if (!sessionFile && !options.replace) {
      // pi may not materialize a new session until the first prompt; create it
      // now so the sidebar can track the running session immediately.
      const created = await process.send<{ sessionFile?: string | null }>(
        { type: 'new_session' },
        20_000
      )
      if (created.success) sessionFile = created.data?.sessionFile ?? null
    }
    if (sessionFile) rememberActiveSession(cwd, sessionFile)

    saveSettings(
      scratch || openingArchived || isTemporaryWorkspace(cwd, scratchRoot)
        ? {}
        : {
            lastWorkspace: cwd,
            workspaces: [...settings.workspaces, cwd]
          }
    )
    processes.set(key, process)
    bindSessionPath(process, sessionFile)
    proc = process
    ;(process as PiProcess & { flushStderr?: () => void }).flushStderr?.()
    sessionUiRequests.activate(process)
    if (options.replace) stopProcess(options.replace)
    publishPendingSessionRequests()
    send('app:settings', loadSettings())
    return { ok: true, cwd, sessionPath: sessionFile, scratch }
  } catch (error) {
    stopProcess(process)
    sessionUiRequests.drop(process)
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: english ? `Pi is not ready: ${message}` : `Pi 没有就绪：${message}` }
  }
}

async function setSessionPermission(input: SessionPermissionChange): Promise<SessionSecurity> {
  const settings = loadSettings()
  const english = settings.language === 'en'
  const current = proc
  if (!current?.alive || typeof input?.cwd !== 'string' || current.cwd !== input.cwd || current.sessionPath !== input.sessionPath) {
    throw new Error(english ? 'The active conversation changed. Try again.' : '当前会话已切换，请重试。')
  }
  if (input.permission !== 'ask' && input.permission !== 'review' && input.permission !== 'full') throw new Error('Invalid permission mode.')
  if (input.network !== undefined && input.network !== 'model' && input.network !== 'off') throw new Error('Invalid network preference.')
  if (input.allowHost !== undefined && (input.allowHost !== current.blockedNetworkHost || !validNetworkHost(input.allowHost))) {
    throw new Error(english ? 'This destination is no longer awaiting permission.' : '该网站已不在此次拦截记录里。')
  }
  const network = input.network ?? (current.security.network === 'off' ? 'off'
    : current.security.network === 'model' ? 'model' : settings.sandboxNetwork)
  if (current.security.permission === input.permission && !input.allowHost &&
    (!input.network || current.security.network === network)) return current.security

  if (current.sandboxed && current.security.permission === input.permission && (input.allowHost || input.network)) {
    const hosts = input.allowHost ? [...new Set([...current.allowedNetworkHosts, input.allowHost])] : current.allowedNetworkHosts
    await current.updateNetworkDomains(allowedDomains({ ...settings, sandboxNetwork: network, sandboxAllowedDomains: [...(settings.sandboxAllowedDomains ?? []), ...hosts] }), network === 'off')
    current.setNetworkState(network ?? 'model')
    if (proc !== current || !current.alive) throw new Error(english ? 'The active conversation changed. Try again.' : '当前会话已切换，请重试。')
    current.allowedNetworkHosts = hosts
    if (current.blockedNetworkHost === input.allowHost) current.blockedNetworkHost = undefined
    current.security = { ...current.security, network }
    return current.security
  }

  const busy = english ? 'Wait for the current operation to finish before switching permissions.' : '请等待当前操作结束后再切换权限。'
  if (creatorOperations.has(current) || current.hasPendingWork || sessionUiRequests.pendingOwners().includes(current)) throw new Error(busy)
  changingSessionPermission = true
  try {
    const state = await current.send<PiState>({ type: 'get_state' }, 5000)
    const actualPath = state.data?.sessionFile ?? current.sessionPath
    if (!state.success || !state.data || state.data.isStreaming || state.data.isCompacting || state.data.pendingMessageCount ||
      sessionUiRequests.pendingOwners().includes(current) || (!actualPath && state.data.messageCount)) throw new Error(busy)
    if (actualPath !== input.sessionPath) throw new Error(english ? 'The active conversation changed. Try again.' : '当前会话已切换，请重试。')
    // Pi reserves a path before it writes the first message. Reopen that same
    // path in an empty conversation so the composer keeps its draft owner.
    const allowedNetworkHosts = input.allowHost
      ? [...new Set([...current.allowedNetworkHosts, input.allowHost])]
      : current.allowedNetworkHosts
    const opened = await doOpenSession({
      cwd: current.cwd, sessionPath: actualPath, permission: input.permission, network, allowedNetworkHosts,
      replace: current, emptySession: state.data.messageCount === 0
    })
    if (!opened.ok || !proc) throw new Error(opened.error ?? (english ? 'Could not change permissions.' : '无法切换权限。'))
    send('pi:record', { type: 'desktop_session_security', sessionPath: proc.sessionPath, security: proc.security })
    return proc.security
  } finally {
    changingSessionPermission = false
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
    // core.quotePath=false keeps non-ASCII filenames readable instead of
    // octal-escaped, so status paths and numstat keys stay real filenames.
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
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

function runGitCapture(cwd: string, args: string[]): { ok: boolean; output: string; error?: string } {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
  try {
    const output = execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { ok: true, output: output.trim() }
  } catch (error) {
    const value = error as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, output: String(value.stdout ?? '').trim(), error: String(value.stderr ?? value.message ?? 'git failed').trim() }
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

let cancelDictation: (() => void) | undefined

function registerIpc(): void {
  cancelDictation = registerDictation(() => mainWindow?.webContents)
  ipcMain.on('desktop:permission-guide-close', (event) => {
    if (permissionGuideWindow && (event.sender === permissionGuideWindow.webContents || event.sender === mainWindow?.webContents)) permissionGuideWindow.close()
  })
  ipcMain.on('desktop:permission-drag-app', (event) => {
    if (process.platform !== 'darwin' || !app.isPackaged) return
    const bundle = dirname(dirname(dirname(app.getPath('exe'))))
    if (!bundle.endsWith('.app') || !existsSync(join(bundle, 'Contents', 'Info.plist'))) return
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png')).resize({ width: 48, height: 48 })
    event.sender.startDrag({ file: bundle, icon })
  })
  ipcMain.handle('app:system-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  nativeTheme.on('updated', () => send('app:system-theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
  ipcMain.handle('desktop:permission-check', async () => {
    const value = await desktopPermissionService()
    const status = await value.service.check()
    if ((permissionGuideKind === 'accessibility' && status.accessibility) || (permissionGuideKind === 'screen' && status.screenRecording)) permissionGuideWindow?.close()
    return { ...status, provisional: value.provisional }
  })
  ipcMain.handle('desktop:permission-request', async (_event, kind: 'accessibility' | 'screen') => { const value = await desktopPermissionService(); return { ...await value.service.request(kind), provisional: value.provisional } })
  ipcMain.handle('pi:install', () => installPiRuntime())
  ipcMain.handle('project:trust-status', (_event, cwd: string) => projectTrustStatus(cwd))
  ipcMain.handle('project:add', (_event, input: Parameters<typeof addProject>[0]) => addProject(input))
  ipcMain.handle('project:remove', (event, input: unknown) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame || typeof input !== 'string' || !input.trim()) throw new Error('Invalid project removal request.')
    return enqueue(async () => {
      const settings = loadSettings()
      const folder = settings.workspaces.find(path => pathsEqual(path, input))
      if (!folder) throw new Error('项目不在项目列表中，请刷新后重试。')
      const owners = [...new Set(processes.values())].filter(owner => pathsEqual(owner.cwd, folder))
      if (owners.some(owner => runningProcesses.has(owner) || owner.hasPendingWork || creatorOperations.has(owner) || sessionUiRequests.pendingOwners().includes(owner))) throw new Error('该项目有对话正在执行或等待确认，请先处理完当前任务。')
      if (proc && pathsEqual(proc.cwd, folder)) throw new Error('请先切换到其他对话，再删除此项目。')
      const sessions = (await listSessions()).filter(session => pathsEqual(session.cwd, folder))
      const moved: NonNullable<Awaited<ReturnType<typeof deleteSession>>>[] = []
      try {
        for (const session of sessions) {
          const result = await deleteSession(session.path)
          if (!result) throw new Error('无法移动对话记录。')
          moved.push(result)
        }
        const removedPaths = new Set(sessions.map(session => session.path))
        const next = saveSettings({
          workspaces: settings.workspaces.filter(path => !pathsEqual(path, folder)),
          pinnedSessionPaths: (settings.pinnedSessionPaths ?? []).filter(path => !removedPaths.has(path)),
          archivedSessionPaths: (settings.archivedSessionPaths ?? []).filter(path => !removedPaths.has(path)),
          ...(settings.lastWorkspace && pathsEqual(settings.lastWorkspace, folder) ? { lastWorkspace: undefined } : {}),
          ...(settings.lastSessionPath && removedPaths.has(settings.lastSessionPath) ? { lastSessionPath: undefined } : {})
        })
        for (const owner of owners) stopProcess(owner)
        send('app:settings', next)
        return { removedSessions: moved.length }
      } catch (error) {
        const failures: string[] = []
        for (const item of moved.reverse()) {
          try {
            if (await sessionExists(item.path)) throw new Error('Session was recreated')
            await restoreSession(item.trashPath, item.path)
          } catch { failures.push(item.name) }
        }
        if (failures.length) throw new Error(`删除未完成，部分对话仍在回收站：${failures.join('、')}。请保留回收站并检查。`)
        throw error
      }
    })
  })
  ipcMain.handle('app:check-update', () => checkForUpdate())
  ipcMain.handle('jev:status', () => jevStatus())
  ipcMain.handle('sandbox:status', () => sandboxStatus())
  ipcMain.handle('sandbox:audit', () => readSandboxAudit())
  ipcMain.handle('jev:save', (_event, patch) => saveJevSettings(patch))
  ipcMain.handle('app:download-update', () => downloadUpdate((progress) => send('app:update-progress', progress)))
  ipcMain.handle('auth:list', () => listAuthProviders())
  ipcMain.handle('auth:save-api-key', (_event, provider: string, key: string) => saveApiKey(provider, key))
  ipcMain.handle('auth:validate-api-key', (_event, provider: string, key: string) => validateApiKey(provider, key))
  ipcMain.handle('auth:remove', (_event, provider: string) => removeAuthProvider(provider))
  ipcMain.handle('auth:oauth-providers', () => listOAuthProviders())
  ipcMain.handle('auth:runtime-providers', (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('not allowed')
    return listRuntimeAuthProviders()
  })
  ipcMain.handle('auth:oauth-start', (event, provider: string) => startOAuth(provider, event.sender))
  ipcMain.on('auth:oauth-respond', (_event, id: string, value: string, cancelled?: boolean) => respondOAuth(id, value, cancelled === true))
  ipcMain.on('auth:oauth-cancel', () => cancelOAuth())
  ipcMain.handle('app:open-release', (_event, url: string) => openReleasePage(url))
  ipcMain.handle('project:trust-set', (_event, cwd: string, decision: boolean | null, scope?: 'project' | 'parent') => setProjectTrust(cwd, decision, scope))
  ipcMain.handle('pi:recheck', () => {
    const piPath = resolvePiPath(loadSettings().piPath)
    return { piPath, piVersion: piVersion(piPath) }
  })
  ipcMain.handle('app:bootstrap', (): Bootstrap => {
    const settings = loadSettings()
    const piPath = resolvePiPath(settings.piPath)
    return {
      platform: process.platform,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      piPath,
      piVersion: piVersion(piPath),
      piBundled: piPath.includes('pi-seed'),
      autoInstallPi: process.env.PI_DESKTOP_SKIP_AUTO_INSTALL !== '1',
      home: homedir(),
      sessionsRoot: sessionsRoot(),
      scratchPath: scratchWorkspace(),
      settings,
      piSettings: loadPiSettings(),
      piSettingsFile: piSettingsFile(),
      agentDir: agentDir(),
      runningSessionPaths: runningSessionPaths(),
      interruptedUi: (() => { try { return uiJournal().interrupted() } catch { return null } })()
    }
  })

  ipcMain.handle('session:ack-interrupted-ui', (_event, id: string) => {
    uiJournal().acknowledge(id)
    publishInterruptedUi()
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

  ipcMain.handle('app:update-settings', (event, patch: Partial<Settings>): Promise<Settings> => enqueue(async () => {
    if ((patch?.pinnedSessionPaths !== undefined || patch?.archivedSessionPaths !== undefined) && (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame)) throw new Error('Invalid pinned session request.')
    if (patch?.sandboxNetwork !== undefined) {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame || !['model', 'off'].includes(patch.sandboxNetwork)) throw new Error('Invalid network settings request.')
      const previous = loadSettings()
      const targets = [...new Set(processes.values())].filter((item) => item.alive && item.sandboxed)
      const updated: Array<{ item: PiProcess; network: 'model' | 'off' }> = []
      try {
        for (const item of targets) {
          const oldNetwork = item.security.network === 'off' ? 'off' : 'model'
          const nextNetwork = patch.sandboxNetwork
          if (oldNetwork === nextNetwork) continue
          if (nextNetwork === 'off') item.setNetworkState('off')
          try {
            await item.updateNetworkDomains(allowedDomains({ ...previous, sandboxNetwork: nextNetwork }), nextNetwork === 'off')
            updated.push({ item, network: oldNetwork })
            item.setNetworkState(nextNetwork)
          } catch (error) {
            if (!updated.some((entry) => entry.item === item)) item.setNetworkState(oldNetwork)
            throw error
          }
        }
      } catch (error) {
        for (const { item, network } of updated.reverse()) {
          try { await item.updateNetworkDomains(allowedDomains({ ...previous, sandboxNetwork: network }), network === 'off'); item.setNetworkState(network) } catch { /* preserve the failure for the caller */ }
        }
        throw error
      }
      for (const { item } of updated) {
        item.security = { ...item.security, network: patch.sandboxNetwork }
        if (patch.sandboxNetwork === 'model') item.blockedNetworkHost = undefined
        send('pi:record', { type: 'desktop_session_security', sessionPath: item.sessionPath, security: item.security })
      }
    }
    const settings = saveSettings(patch)
    if (patch.language !== undefined) buildMenu()
    if (patch.launchAtLogin !== undefined && app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: patch.launchAtLogin,
        args: ['--background']
      })
    }
    return settings
  }))

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
    return realpathSync(result.filePaths[0])
  })

  ipcMain.handle('sessions:list', () => listSessions())
  ipcMain.handle('sessions:search', (_event, query: string) => searchSessions(query))
  ipcMain.handle('workspace:list-files', (_event, cwd: string, query: string) => listWorkspaceFiles(cwd, query))
  ipcMain.handle('sessions:delete', (_event, path: string) => deleteSession(path))
  ipcMain.handle('sessions:restore', (_event, trashPath: string, path: string) =>
    restoreSession(trashPath, path)
  )
  ipcMain.handle('session:close', () => enqueue(closeSession))
  ipcMain.handle('session:security', (_event, sessionPath: string | null) => {
    const current = proc
    return current?.alive && current.sessionPath === sessionPath ? current.security : null
  })
  ipcMain.handle('session:set-permission', (event, input: SessionPermissionChange) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Only the main window can change conversation permissions.')
    return enqueue(() => setSessionPermission(input))
  })

  ipcMain.handle(
    'session:open',
    (_event, { cwd, sessionPath, scratch }: { cwd: string; sessionPath?: string | null; scratch?: boolean }) =>
      enqueue(() => doOpenSession({ cwd, sessionPath, scratch }))
  )

  ipcMain.handle(
    'pi:command',
    async (_event, command: Record<string, unknown>, timeoutMs?: number) => {
      const process = proc
      if (changingSessionPermission && !String(command.type).startsWith('get_')) {
        return { type: 'response', command: String(command.type), success: false, error: 'Session permissions are changing.' }
      }
      if (!process) {
        return { type: 'response', command: String(command.type), success: false, error: 'Pi 没有在运行' }
      }
      try {
        const result = await process.send<PiState>(command, timeoutMs ?? commandTimeout(String(command.type)))
        if (result.success && command.type === 'get_state' && typeof result.data?.sessionFile === 'string' && proc === process) {
          bindSessionPath(process, result.data.sessionFile)
        }
        return result
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

  ipcMain.handle('creator:list', async (event) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid creator request.')
    const settings = loadSettings()
    const scratch = scratchWorkspace()
    const directory = join(scratch, 'conversations')
    let temporary: string[] = []
    try {
      if (existsSync(directory) && pathsEqual(realpathSync(directory), directory)) {
        temporary = readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && isTemporaryWorkspace(join(directory, entry.name), scratch))
          .map((entry) => join(directory, entry.name))
      }
    } catch { /* A missing or inaccessible scratch library must not hide project plugins. */ }
    return listCreatedPlugins([...settings.workspaces, ...(proc ? [proc.cwd] : []), scratch, ...temporary])
  })
  ipcMain.handle('creator:action', async (event, input: unknown, sessionPath: unknown) => {
    const process = proc
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame || !validCreatorAction(input) || (sessionPath !== null && typeof sessionPath !== 'string')) return {ok:false,error:'Invalid creator request.'}
    if (!process || sessionPath !== process.sessionPath) return {ok:false,error:'The conversation changed. Try again in the current conversation.'}
    if (input.action === 'status' && creatorStates.has(process) && (runningProcesses.has(process) || creatorOperations.has(process) || process.hasPendingWork)) {send('pi:record',{type:'extension_ui_request',id:'pi-creator-state',method:'creator_state',state:creatorStates.get(process)});return {ok:true}}
    if (creatorOperations.has(process) || changingSessionPermission || (input.action !== 'status' && (runningProcesses.has(process) || process.hasPendingWork))) return {ok:false,error:'Wait for the current task to finish.'}
    if (!['enable','disable','status'].includes(input.action) && (process.security.files === 'read-only' || projectReadOnly(loadSettings(),process.cwd))) return {ok:false,error:'This conversation is read-only.'}
    if (!['enable','disable','status'].includes(input.action) && !creatorStates.get(process)?.enabled) return {ok:false,error:'Enable Creator mode first.'}
    creatorOperations.add(process)
    const command = (value: import('@shared/creator').CreatorAction | {action:'reload'}) => sendCreatorControl(process,value)
    try {
      if (input.action === 'install') {
        const beforePackages=await listPackagesAsync(process.cwd)
        const installed=await installCreatorDraft({cwd:process.cwd,id:input.id,storage:join(app.getPath('userData'),'creator-plugins'),
          isConfigured:source=>beforePackages.some(entry=>pathsEqual(entry.path,source)),
          rollback:source=>runPiPackageCommand(['remove',source],process.cwd,progress=>send('packages:progress',progress)),
          install:source=>runPiPackageCommand(['install',source],process.cwd,progress=>send('packages:progress',progress)),
          verify:async(source,name)=>(await listPackagesAsync(process.cwd)).find(entry=>pathsEqual(entry.path,source)&&entry.name===name)?.source??null})
        if (proc === process) {
          let reload: import('@shared/creator').CreatorResult
          try{reload=await command({action:'reload'})}catch{return {ok:true,warning:'Plugin installed. Restart this conversation to load the updated commands.'}}
          if(!reload.ok)return {ok:true,warning:'Plugin installed. Restart this conversation to load the updated commands.'}
          const restored=await command({action:'enable'})
          if(!restored.ok)return {ok:true,warning:`Plugin installed. Re-enter Creator mode to continue editing. ${restored.error??''}`}
          await command({action:'status'})
        }
        return {ok:true,warning:proc===process?installed.warning:'Plugin installed. Open or restart the target conversation to load it.'}
      }
      const result=await command(input)
      return result
    }catch(error){return {ok:false,error:error instanceof Error?error.message:String(error)}}
    finally{creatorOperations.delete(process)}
  })

  ipcMain.on('pi:ui-response', (_event, response: Record<string, unknown>) => {
    sessionUiRequests.respond(response)
  })

  ipcMain.handle('models:read', (): ModelsConfig => readModelsConfig())

  ipcMain.handle('skills:list', (_event, cwd: string) => listSkills(cwd))
  ipcMain.handle('skills:count', (_event, cwd: string) => countSkills(cwd))
  ipcMain.handle('terminal:create', (event, workspace: string) => {
    if (event.sender !== mainWindow?.webContents) return { error: 'not allowed' }
    if (typeof workspace !== 'string') workspace = ''
    return createPtyTerminal(workspace)
  })
  ipcMain.handle('terminal:write', (_event, id: string, data: string) => writePtyTerminal(id, data))
  ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => resizePtyTerminal(id, cols, rows))
  ipcMain.handle('terminal:kill', (_event, id: string) => killPtyTerminal(id))
  ipcMain.handle('connectors:list', (_event, cwd: string) => listConnectors(cwd))
  ipcMain.handle('mcp-connectors:list', () => listMcpConnectors())
  ipcMain.handle('mcp-connectors:save', (_event, input: McpConnectorInput) => saveMcpConnector(input))
  ipcMain.handle('mcp-connectors:test', (_event, input: McpConnectorInput) => {
    const settings = loadSettings()
    return testMcpConnector(input, resolvePiPath(settings.piPath), proxyEnv(settings))
  })
  ipcMain.handle('mcp-connectors:remove', (_event, id: string) => removeMcpConnector(id))
  ipcMain.handle('skills:read', (_event, path: string) => readSkillFile(path))
  ipcMain.handle('packages:list', (_event, cwd: string) => listPackagesAsync(cwd || homedir()))
  ipcMain.handle('packages:inspect', (_event, source: string, cwd: string) => inspectPackage(source, cwd))
  ipcMain.handle('packages:catalog', (_event, query: string) => searchPackageCatalog(query))
  const translatePackages = createPackageTranslator(join(app.getPath('userData'), 'market-translations'), (texts, language) => translatePackageTexts(texts, language, scratchWorkspace()))
  ipcMain.handle('packages:translate', (event, input: import('@shared/types').PackageTranslationRequest) => {
    if (event.sender !== mainWindow?.webContents) return { ok: false, error: 'model' }
    const requestId = typeof input?.requestId === 'string' && input.requestId.length <= 100 ? input.requestId : null
    return translatePackages(input, requestId ? (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('packages:translation-progress', { requestId, ...progress })
    } : undefined)
  })
  ipcMain.handle('packages:details', (_event, input: import('@shared/types').PackageDetailsRequest) => getPackageDetails(input))

  ipcMain.handle(
    'packages:install',
    (_event, source: string, options: { cwd: string; local?: boolean }) => {
      if (!validPackageSourceArg(source)) return Promise.resolve({ ok: false, code: null, error: '插件来源不合法。' })
      const args = ['install', source]
      if (options?.local) args.push('--local')
      const cwd = typeof options?.cwd === 'string' && options.cwd ? options.cwd : homedir()
      return runPiPackageCommand(args, cwd, (progress) =>
        send('packages:progress', progress)
      )
    }
  )

  ipcMain.handle('packages:remove', async (_event, source: string, cwd: string) => {
    if (!validPackageSourceArg(source)) return Promise.resolve({ ok: false, code: null, error: '插件来源不合法。' })
    const workspace=typeof cwd==='string'&&cwd?cwd:homedir()
    const target=/^\.\.?[\\/]/.test(source)?(await listPackagesAsync(workspace)).find(entry=>entry.source===source&&entry.scope==='user')?.path??source:source
    return runPiPackageCommand(['remove', target], workspace, (progress) =>
      send('packages:progress', progress)
    )
  })

  ipcMain.handle('packages:update', async (_event, source: string, cwd: string) => {
    if (!validPackageSourceArg(source)) return Promise.resolve({ ok: false, code: null, error: '插件来源不合法。' })
    const workspace=typeof cwd==='string'&&cwd?cwd:homedir()
    const target=/^\.\.?[\\/]/.test(source)?(await listPackagesAsync(workspace)).find(entry=>entry.source===source&&entry.scope==='user')?.path??source:source
    return runPiPackageCommand(['update', target], workspace, (progress) =>
      send('packages:progress', progress)
    )
  })

  ipcMain.handle('schedules:list', () => scheduler.list())
  ipcMain.handle('usage:summary', (_event, range) => usageSummary(range))
  ipcMain.handle('session:notices', (_event, sessionPath: string) => listSessionNotices(sessionPath))
  ipcMain.handle('schedules:get', (_event, id: string) => scheduler.get(id))
  let scheduleRequest: { id: string; controller: AbortController } | null = null
  ipcMain.handle('schedules:interpret', async (event, id: string, input: ScheduleInterpretationInput) => {
    if (event.sender !== mainWindow?.webContents || typeof id !== 'string' || !input) return { error: 'invalid' }
    scheduleRequest?.controller.abort()
    const controller = new AbortController()
    scheduleRequest = { id, controller }
    try {
      const scratch = scratchWorkspace()
      const existing = typeof input.taskId === 'string' ? scheduler.get(input.taskId)?.task : undefined
      const workspace = existing?.projectPath ?? proc?.cwd
      const project = workspace && workspace !== scratch ? workspace : ''
      return await interpretSchedule(input, scratch, project, controller.signal, existing)
    } finally {
      if (scheduleRequest?.controller === controller) scheduleRequest = null
    }
  })
  ipcMain.handle('schedules:cancel-interpret', (event, id: string) => {
    if (event.sender === mainWindow?.webContents && scheduleRequest?.id === id) scheduleRequest.controller.abort()
  })
  ipcMain.handle('schedules:create', (_event, input, requireFuture?: boolean) =>
    scheduler.create(input, false, requireFuture === true))
  ipcMain.handle('schedules:update', (_event, id: string, patch, requireFuture?: boolean) =>
    scheduler.update(id, patch, requireFuture === true))
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
    (event, id: string, entry: CustomProviderEntry): ModelsConfig => {
      if (event.sender !== mainWindow?.webContents || typeof id !== 'string' || !entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid provider request')
      return saveProvider(id, entry)
    }
  )

  ipcMain.handle('models:remove-provider', (event, id: string): ModelsConfig => {
    if (event.sender !== mainWindow?.webContents || typeof id !== 'string') throw new Error('Invalid provider request')
    return removeProvider(id)
  })

  ipcMain.handle('models:list', (): Promise<{ models: PiModelRow[]; error?: string }> =>
    listPiModels(resolvePiPath(loadSettings().piPath))
  )

  ipcMain.handle('models:refresh-catalog', (): Promise<{ ok: boolean; output: string }> =>
    refreshModelCatalog(resolvePiPath(loadSettings().piPath))
  )

  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) return
    await shell.openExternal(url)
  })

  ipcMain.handle('browser:preview', (event, doc: string, url: string, candidate?: string) => event.sender === mainWindow?.webContents ? browserPreview(doc, url, candidate) : null)
  ipcMain.handle('browser:external-preview', (event, sessionId: string, backend: string, doc: string, url: string, generation: string) => event.sender === mainWindow?.webContents ? externalBrowserFrame(sessionId, backend, doc, url, generation) : null)
  ipcMain.handle('browser:reveal-page', (event, doc: string, openPanel = true) => event.sender === mainWindow?.webContents && revealPage(doc, openPanel))
  ipcMain.handle('browser:current', () => panelPage().getFallbackState())
  ipcMain.handle('browser:open', (_event, url: string, separate = false) => panelPage(separate).browserOpen(url))
  ipcMain.handle('browser:navigate', (_event, url: string, separate = false) => panelPage(separate).browserNavigate(url))
  ipcMain.handle('browser:back', () => panelPage().browserBack())
  ipcMain.handle('browser:forward', () => panelPage().browserForward())
  ipcMain.handle('browser:reload', () => panelPage().browserReload())
  ipcMain.handle('browser:stop', () => panelPage().browserStop())
  ipcMain.handle('browser:close', () => panelPage().browserClose())
  ipcMain.handle('browser:bounds', (_event, bounds) => setPanelBounds(bounds))
  ipcMain.handle('browser:visible', (_event, visible: boolean) => setPanelVisible(visible))
  ipcMain.handle('chrome:profiles', () => listChromeProfiles())
  ipcMain.handle('chrome:preview', (_event, profileId: string) => previewChromeProfile(profileId))
  ipcMain.handle('chrome:import', (_event, profileId: string, domains: string[]) =>
    importChromeCookies(profileId, domains)
  )

  ipcMain.handle('chrome:bridge-info', () => prepareChromeBridge())
  ipcMain.handle('chrome:bridge-copy-path', () => clipboard.writeText(prepareChromeBridge()))
  ipcMain.on('chrome:bridge-drag', (event) => {
    const folder = prepareChromeBridge()
    if (!existsSync(join(folder, 'manifest.json'))) return
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png')).resize({ width: 48, height: 48 })
    event.sender.startDrag({ file: folder, icon })
  })
  ipcMain.handle('browser:router-status', () => browserRouterStatus())
  ipcMain.handle('browser:start-cdp', () => startCdpBrowser())
  ipcMain.handle('chrome:bridge-check', () => {
    let expectedVersion: string | undefined
    try { expectedVersion = String(JSON.parse(readFileSync(join(app.getAppPath(), 'extensions', 'chrome-bridge', 'manifest.json'), 'utf8')).version ?? '') } catch { /* Unknown version must not be presented as current. */ }
    return checkChromeBridge({ expectedVersion })
  })
  ipcMain.handle('chrome:open-extensions', () => {
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Google Chrome', 'chrome://extensions'])
    else if (process.platform === 'win32') execFileSync('cmd', ['/c', 'start', 'chrome', 'chrome://extensions'])
    else execFileSync('google-chrome', ['chrome://extensions'])
  })
  ipcMain.handle('shell:show-item', (event, path: string) => {
    if (event.sender !== mainWindow?.webContents) return
    if (path) shell.showItemInFolder(path)
  })

  ipcMain.handle('media:preview', async (event, context: { path: string; workspace: string; sessionPath: string | null }) => {
    const owner = proc
    if (!owner?.alive || event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame ||
        typeof context?.workspace !== 'string' || !pathsEqual(context.workspace, owner.cwd) || context.sessionPath !== owner.sessionPath) return null
    const url = await mediaPreview.issue(owner, owner.cwd, context.path)
    return proc === owner ? url : null
  })

  const mediaSender = (event: Electron.IpcMainInvokeEvent): PiProcess => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame || !proc?.alive) throw new Error('当前会话不可用。')
    return proc
  }
  const mediaSavePath = async (name: string): Promise<string | null> => {
    const safeName = basename(name.replace(/[\\/\x00-\x1f]/g, '_')).slice(0, 180) || 'image.png'
    const testDir = process.env.PI_DESKTOP_EXPORT_DIR?.trim()
    if (testDir) return join(testDir, safeName)
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: safeName })
    return result.canceled ? null : result.filePath ?? null
  }
  const validMediaBytes = (value: unknown): Buffer => {
    if (!(value instanceof Uint8Array) || !value.byteLength || value.byteLength > MEDIA_IMAGE_LIMIT_BYTES) throw new Error('图片数据不可用或超过 32 MB。')
    return Buffer.from(value)
  }
  ipcMain.handle('media:copy-image', async (event, value: unknown) => {
    mediaSender(event)
    const image = nativeImage.createFromBuffer(validMediaBytes(value))
    if (image.isEmpty()) throw new Error('无法复制此图片。')
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
  })
  ipcMain.handle('media:copy-image-file', async (event, value: unknown) => {
    const owner = mediaSender(event)
    if (typeof value !== 'string') throw new Error('图片不可用。')
    const source = await mediaPreview.resolve(owner, value)
    if (!source || proc !== owner || !source.mime.startsWith('image/')) throw new Error('图片不可用或不属于当前会话。')
    const image = source.mime === 'image/svg+xml' && process.platform === 'darwin'
      ? nativeImage.createFromBuffer(await renderSvgPreview(source.path, owner.cwd))
      : nativeImage.createFromPath(source.path)
    if (image.isEmpty()) throw new Error('无法复制此格式的图片。')
    if (proc !== owner || !(await mediaPreview.resolve(owner, value))) throw new Error('会话或图片已变更，请重试。')
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
  })
  ipcMain.handle('media:save-bytes', async (event, name: unknown, value: unknown) => {
    const owner = mediaSender(event)
    if (typeof name !== 'string') throw new Error('文件名无效。')
    const bytes = validMediaBytes(value)
    const destination = await mediaSavePath(name)
    if (!destination) return false
    if (proc !== owner) throw new Error('会话已切换，请重试。')
    const temporary = await mkdtemp(join(dirname(destination), '.pi-save-'))
    try { const file = join(temporary, 'media'); await writeFile(file, bytes, { flag: 'wx' }); await rename(file, destination) }
    finally { await rm(temporary, { recursive: true, force: true }) }
    return true
  })
  ipcMain.handle('media:save-file', async (event, value: unknown) => {
    const owner = mediaSender(event)
    if (typeof value !== 'string') throw new Error('文件不可用。')
    const source = await mediaPreview.resolve(owner, value)
    if (!source || source.mime === 'text/html') throw new Error('文件不可用或不属于当前会话。')
    const destination = await mediaSavePath(basename(source.path))
    if (!destination) return false
    if (proc !== owner || !(await mediaPreview.resolve(owner, value))) throw new Error('会话或文件已变更，请重试。')
    if (resolve(destination) === source.path) return true
    const file = await openFileHandle(source.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    let temporary: string | undefined
    try {
      const info = await file.stat()
      const current = await realpath(source.path)
      const currentInfo = await stat(current)
      if (!info.isFile() || current !== source.path || currentInfo.ino !== info.ino || currentInfo.dev !== info.dev || !(await mediaPreview.resolve(owner, value))) throw new Error('文件已变更，请重试。')
      temporary = await mkdtemp(join(dirname(destination), '.pi-save-'))
      const output = join(temporary, 'media')
      await pipeline(file.createReadStream({ autoClose: false }), createWriteStream(output, { flags: 'wx' }))
      if (proc !== owner) throw new Error('会话已切换，请重试。')
      await rename(output, destination)
    } finally { await file.close(); if (temporary) await rm(temporary, { recursive: true, force: true }) }
    return true
  })
  ipcMain.handle('media:copy-file', async (event, value: unknown) => {
    const owner = mediaSender(event)
    if (typeof value !== 'string') throw new Error('文件不可用。')
    const source = await mediaPreview.resolve(owner, value)
    if (!source || proc !== owner || source.mime === 'text/html') throw new Error('文件不可用或不属于当前会话。')
    const uri = pathToFileURL(source.path).href
    const type = process.platform === 'darwin' ? 'electron application/osclipboard;format="public.file-url"' : process.platform === 'win32' ? 'electron application/osclipboard;format="FileNameW"' : 'text/uri-list'
    const valueBytes = process.platform === 'win32' ? Buffer.from(`${source.path}\0`, 'utf16le') : Buffer.from(process.platform === 'darwin' ? uri : `${uri}\r\n`)
    await clipboard.write([new ClipboardItem({ [type]: new Blob([new Uint8Array(valueBytes)]) })])
  })
  ipcMain.handle('media:remote', async (event, input: unknown, name: unknown, kind: unknown, action: unknown) => {
    const owner = mediaSender(event)
    if (typeof input !== 'string' || input.length > 8192 || typeof name !== 'string' || !['image', 'video', 'file'].includes(String(kind)) || !['save', 'copy'].includes(String(action))) throw new Error('附件地址无效。')
    const validateUrl = async (source: URL): Promise<void> => {
      const localTest = !app.isPackaged && process.env.PI_DESKTOP_TEST_MEDIA_LOCAL === '1' && source.hostname === '127.0.0.1'
      if ((!localTest && source.protocol !== 'https:') || source.username || source.password || (!localTest && (isIP(source.hostname) || /(^localhost$|\.local$|\.internal$)/i.test(source.hostname)))) throw new Error('附件地址不可用。')
      if (localTest) return
      const blocked = new BlockList()
      for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(address, prefix, 'ipv4')
      for (const [address, prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['::ffff:0:0',96]] as const) blocked.addSubnet(address, prefix, 'ipv6')
      const addresses = await lookup(source.hostname, { all: true })
      if (!addresses.length || addresses.some(({ address, family }) => blocked.check(address, family === 6 ? 'ipv6' : 'ipv4'))) throw new Error('附件地址不可用。')
    }
    let source = new URL(input)
    await validateUrl(source)
    const safeName = basename(name.replace(/[\\/\x00-\x1f]/g, '_')).slice(0, 180) || (kind === 'image' ? 'image.png' : 'video.mp4')
    const destination = action === 'save' ? await mediaSavePath(safeName) : null
    if (action === 'save' && !destination) return false
    if (proc !== owner) throw new Error('会话已切换，请重试。')
    const base = destination ? dirname(destination) : app.getPath('userData')
    const temporary = await mkdtemp(join(base, action === 'copy' && kind !== 'image' ? 'media-clipboard-' : '.pi-media-'))
    const file = join(temporary, safeName)
    let keep = false
    try {
      const requestOnce = (url: URL): Promise<{ redirect?: string }> => new Promise((resolveRequest, rejectRequest) => {
        const request = net.request({ url: url.href, redirect: 'manual' })
        const timer = setTimeout(() => { request.abort(); rejectRequest(new Error('附件下载超时。')) }, MEDIA_TIMEOUT_MS)
        request.once('redirect', (_status, _method, target) => { clearTimeout(timer); resolveRequest({ redirect: target }); request.abort() })
        request.once('response', () => { clearTimeout(timer); resolveRequest({}); request.abort() })
        request.once('error', (error) => { clearTimeout(timer); rejectRequest(error) })
        request.end()
      })
      let result = await requestOnce(source)
      for (let redirects = 0; result.redirect; redirects++) {
        if (redirects >= MEDIA_MAX_REDIRECTS) throw new Error('附件重定向次数过多。')
        source = new URL(result.redirect, source)
        await validateUrl(source)
        result = await requestOnce(source)
      }
      const response = await net.fetch(source.href, { redirect: 'error', signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) })
      if (!response.ok || !response.body) throw new Error(`附件下载失败（HTTP ${response.status}）。`)
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
      if (kind === 'file' && (mime === 'text/html' || mime === 'application/xhtml+xml')) throw new Error('附件地址返回了网页而不是文件。')
      if (mime && mime !== 'application/octet-stream' && (kind === 'image' || kind === 'video') && !mime.startsWith(`${kind}/`)) throw new Error('附件类型与预期不符。')
      const limit = kind === 'image' ? MEDIA_IMAGE_LIMIT_BYTES : MEDIA_FILE_LIMIT_BYTES
      let total = 0
      const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) { total += chunk.length; callback(total > limit ? new Error(`附件超过 ${limit / 1024 / 1024} MB 的大小限制。`) : null, chunk) } })
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), limiter, createWriteStream(file, { flags: 'wx' }), { signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) })
      if (!total || proc !== owner) throw new Error('会话已切换或附件为空。')
      if (destination) { await rename(file, destination); return true }
      if (kind === 'image') {
        const image = safeName.toLowerCase().endsWith('.svg') && process.platform === 'darwin' ? nativeImage.createFromBuffer(await renderSvgPreview(file, temporary)) : nativeImage.createFromPath(file)
        if (image.isEmpty()) throw new Error('无法复制此格式的图片。')
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
      } else {
        const type = process.platform === 'darwin' ? 'electron application/osclipboard;format="public.file-url"' : process.platform === 'win32' ? 'electron application/osclipboard;format="FileNameW"' : 'text/uri-list'
        const value = process.platform === 'win32' ? Buffer.from(`${file}\0`, 'utf16le') : Buffer.from(process.platform === 'darwin' ? pathToFileURL(file).href : `${pathToFileURL(file).href}\r\n`)
        await clipboard.write([new ClipboardItem({ [type]: new Blob([new Uint8Array(value)]) })])
        keep = true
      }
      return true
    } finally { if (!keep) await rm(temporary, { recursive: true, force: true }) }
  })

  ipcMain.handle(
    'fs:read-dir',
    (event, path: string, options?: { showHidden?: boolean }) => {
      if (event.sender !== mainWindow?.webContents) return []
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

  ipcMain.handle('fs:read-text', (event, path: string, maxBytes = 200_000) => {
    if (event.sender !== mainWindow?.webContents) return { ok: false, error: 'not allowed' }
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

  ipcMain.handle('git:branch', async (_event, cwd: string) => {
    if (typeof cwd !== 'string' || !cwd) return null
    try {
      const { stdout } = await execFileAsync('git', ['-c', 'core.quotePath=false', 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
        cwd: resolve(cwd), encoding: 'utf8', timeout: 2500, windowsHide: true
      })
      return stdout.trim() || null
    } catch {
      return null
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

  ipcMain.handle('git:commit', (_event, cwd: string, message: string, paths: string[]) => {
    const dir = resolve(cwd)
    const text = String(message ?? '').trim()
    if (!text) return { ok: false, output: '', error: '提交说明不能为空。' }
    if (text.length > 5000) return { ok: false, output: '', error: '提交说明过长。' }
    const list = Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string').slice(0, 500) : []
    if (!list.length) return { ok: false, output: '', error: '没有选择要提交的文件。' }
    for (const path of list) {
      const full = resolve(dir, path)
      if (full !== dir && !full.startsWith(`${dir}${sep}`)) return { ok: false, output: '', error: '提交路径越过了项目目录。' }
      if (path.startsWith('-') || path.includes('\0')) return { ok: false, output: '', error: '提交路径无效。' }
    }
    const add = runGitCapture(dir, ['add', '--', ...list])
    if (!add.ok) return add
    const commit = runGitCapture(dir, ['commit', '-m', text])
    return { ...commit, output: [add.output, commit.output].filter(Boolean).join('\n') }
  })

  ipcMain.handle('shell:open-path', async (event, path: string): Promise<boolean> => {
    if (event.sender !== mainWindow?.webContents || !path) return false
    const error = await shell.openPath(path)
    return error === ''
  })

  // Desktop notification, only when the window is not in front: a focused
  // window already shows the result. Click focuses the app and opens that session.
  ipcMain.handle(
    'notify:desktop',
    (
      _event,
      payload: { title?: string; body?: string; cwd?: string | null; sessionPath?: string | null }
    ): boolean => showDesktopNotification(payload ?? {})
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

  ipcMain.handle('fs:write-text', (event, path: string, content: string): boolean => {
    if (event.sender !== mainWindow?.webContents) return false
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
          label: english ? 'Pi documentation' : 'Pi 文档',
          click: () => shell.openExternal('https://pi.dev')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function prepareChromeBridge(): string {
  const source = join(app.getAppPath(), 'extensions', 'chrome-bridge')
  const destination = join(app.getPath('userData'), 'chrome-bridge')
  try {
    const sourceManifest = join(source, 'manifest.json')
    const targetManifest = join(destination, 'manifest.json')
    if (!existsSync(targetManifest)) {
      cpSync(source, destination, { recursive: true })
    } else {
      const sourceVersion = String(JSON.parse(readFileSync(sourceManifest, 'utf8')).version ?? '')
      const targetVersion = String(JSON.parse(readFileSync(targetManifest, 'utf8')).version ?? '')
      const parts = (version: string): number[] | null => /^\d+(\.\d+){0,3}$/.test(version) ? version.split('.').map(Number) : null
      const sourceParts = parts(sourceVersion)
      const targetParts = parts(targetVersion)
      const comparison = sourceParts && targetParts
        ? [0, 1, 2, 3].map((index) => (sourceParts[index] ?? 0) - (targetParts[index] ?? 0)).find((value) => value !== 0) ?? 0
        : 0
      if (comparison > 0) {
        const backupRoot = join(app.getPath('userData'), 'chrome-bridge-backups')
        mkdirSync(backupRoot, { recursive: true })
        const backup = mkdtempSync(join(backupRoot, 'previous-'))
        cpSync(destination, backup, { recursive: true, filter: (path) => basename(path) !== 'pairing.json' })
        // Copy the manifest last so an interrupted update is retried on startup.
        cpSync(source, destination, { recursive: true, filter: (path) => basename(path) !== 'manifest.json' })
        cpSync(sourceManifest, targetManifest)
      }
    }
    prepareChromePairing(chromePairingPath(), destination)
  } catch (error) {
    console.error('[chrome-bridge] unable to prepare extension:', error)
  }
  return destination
}

function createWindow(): void {
  const settings = loadSettings()
  const bounds = settings.windowBounds
  const initialTheme = settings.theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : settings.theme

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 860,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: initialTheme === 'light' ? '#f7f6f3' : '#0c0d0f',
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 18, y: 20 }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      additionalArguments: [`--pi-initial-theme=${initialTheme === 'light' ? 'light' : 'dark'}`],
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  const background = process.argv.includes('--background')
  let nativeScrollPhase = false
  if (process.platform === 'darwin' && process.env.PI_DISABLE_NATIVE_SCROLL_PHASE !== '1') {
    try {
      const bundledAddon = join(process.resourcesPath, 'scroll-phase.node')
      const addonPath = app.isPackaged && existsSync(bundledAddon)
        ? bundledAddon
        : join(app.getAppPath(), 'build', 'scroll-phase.node')
      const addon = require(addonPath) as { start: (callback: (phase: 'begin' | 'end' | 'cancel') => void) => boolean }
      nativeScrollPhase = addon.start((phase) => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) mainWindow.webContents.send('app:scroll-phase', phase)
      })
    } catch (error) { console.warn('[scroll-phase] native monitor unavailable:', error) }
  }
  if (process.platform === 'darwin') mainWindow.webContents.on('input-event', (_event, input) => {
    const phase = input.type === 'gestureScrollBegin' ? 'begin'
      : input.type === 'gestureScrollEnd' || input.type === 'gestureFlingStart' ? 'end'
      : input.type === 'gesturePinchBegin' ? 'cancel' : null
    if (phase && (!nativeScrollPhase || phase === 'cancel')) mainWindow?.webContents.send('app:scroll-phase', phase)
  })
  initBrowser(mainWindow)
  prepareChromeBridge()
  const bridgeReady = startBrowserBridge().catch((error) => {
    console.error('[browser-bridge] unable to start:', error)
  })
  mainWindow.on('ready-to-show', () => {
    if (!background) mainWindow?.show()
  })

  mainWindow.on('close', () => {
    if (!mainWindow) return
    const { x, y, width, height } = mainWindow.getBounds()
    saveSettings({ windowBounds: { x, y, width, height } })
  })

  mainWindow.on('closed', () => {
    permissionGuideWindow?.close()
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
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    const isArtifact = event.frame?.url.startsWith(`${mediaScheme}:`)
    const fromArtifact = event.initiator?.url.startsWith(`${mediaScheme}:`)
    if ((isArtifact || fromArtifact) && event.url !== event.frame?.url) event.preventDefault()
  })

  // A renderer can immediately start a Pi child. Publish its bridge before the
  // renderer loads so the first browser request cannot race bridge startup.
  const window = mainWindow
  void bridgeReady.then(() => {
    if (window.isDestroyed()) return
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void window.loadURL(devUrl)
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'))
    }
  })
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
    // Every Pi child, including headless scheduler children, is scoped to this
    // process. Headless runs have no browser bridge and must fail closed.
    process.env.PI_DESKTOP_BROWSER_BRIDGE_FILE = browserBridgePath()
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
    mediaPreview.register(() => proc)
    initPtyTerminal((channel, payload) => send(channel, payload))
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
    if (app.isPackaged && settings.autoCheckUpdates !== false) {
      setTimeout(() => {
        void checkForUpdate().then((info) => {
          if (info.hasUpdate && info.latest) send('app:update-available', info)
        })
      }, 4000)
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
    cancelDictation?.()
    stopPackageTranslations()
    void stopBrowserBridge()
    stopAllPtyTerminals()
    scheduler.shutdown()
    for (const process of new Set(processes.values())) process.stop()
    processes.clear()
    runningProcesses.clear()
    proc = null
    sessionUiRequests.dispose()
  })
}
