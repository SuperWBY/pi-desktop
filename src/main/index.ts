import { chromePairingPath, prepareChromePairing } from '../../extensions/computer-use/src/chrome-bridge-pairing'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
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
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type {
  AddProjectResult,
  Bootstrap,
  CustomProviderEntry,
  ModelsConfig,
  PiModelRow,
  OpenSessionResult,
  PiRecord,
  PiState,
  PiSettings,
  SessionPermission,
  SessionSecurity,
  Settings
} from '@shared/types'
import { PiProcess } from './pi'
import { prepareComputerUseRuntime } from './computer-use-runtime'
import { findExistingComputerUse } from './existing-computer-use'
import {
  browserPreview, panelPage, revealPage, setPanelBounds, setPanelVisible,
  initBrowser
} from './browser'
import { importChromeCookies, listChromeProfiles, previewChromeProfile } from './chrome-import'
import { browserBridgePath, startBrowserBridge, stopBrowserBridge } from './browser-bridge'
import { augmentedPath, piVersion } from './pi-locate'
import { resolvePiPath } from './pi-runtime'
import { projectTrustStatus, setProjectTrust } from './project-trust'
import { checkForUpdate, downloadUpdate, openReleasePage } from './update'
import { listAuthProviders, removeAuthProvider, saveApiKey, validateApiKey } from './auth-store'
import { cancelOAuth, listOAuthProviders, respondOAuth, startOAuth } from './pi-auth'
import { deleteSession, listSessions, restoreSession, searchSessions, sessionExists, sessionsRoot } from './sessions'
import { listWorkspaceFiles } from './workspace-files'
import { inspectPackage } from './package-inspect'
import { createSandbox, sandboxStatus } from './sandbox'
import { proxyEnv } from './network-env'
import { appendSandboxAudit, readSandboxAudit } from './sandbox-audit'
import { searchPackageCatalog } from './package-catalog'
import { browserRouterStatus, startCdpBrowser } from './browser-router-status'
import { isTemporaryWorkspace } from '@shared/paths'
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
import { listPackages, listPackagesAsync, runPiPackageCommand } from './packages'
import { scheduler } from './schedules'
import { listSessionNotices } from './session-notices'
import { rememberActiveSession } from './active-sessions'
import { usageSummary } from './usage'

// The bundled Pi seed uses Electron's embedded Node; child processes inherit
// this so the launcher can find the exact app executable.
process.env.PI_DESKTOP_ELECTRON ||= process.execPath

let mainWindow: BrowserWindow | null = null
let proc: PiProcess | null = null
let changingSessionPermission = false
const processes = new Map<string, PiProcess>()
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

function bindSessionPath(process: PiProcess, path: string | null): void {
  if (process.sessionPath && process.sessionPath !== path && processes.get(sessionKey(process.sessionPath)) === process) {
    processes.delete(sessionKey(process.sessionPath))
  }
  process.sessionPath = path
  if (path) processes.set(sessionKey(path), process)
}

function wireProcess(process: PiProcess, key: string): void {
  let heldStderr = ''
  process.on('record', (record: PiRecord) => {
    if (sessionUiRequests.receive(process, record)) return
    if (proc === process) send('pi:record', record)
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
        if (host && proc === process) send('sandbox:domain-denied', { host, port })
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
    if (!statSync(cwd).isDirectory() || cwd === scratchWorkspace()) throw new Error()
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
  files?: 'workspace-write' | 'read-only'
  replace?: PiProcess
  emptySession?: boolean
}): Promise<OpenSessionResult> {
  const english = loadSettings().language === 'en'
  const requested = options.cwd?.trim()
  if (!options.scratch && (!requested || !existsSync(requested) || !statSync(requested).isDirectory())) {
    return { ok: false, error: english ? 'Please choose an existing folder.' : '请选择一个存在的文件夹。' }
  }
  const scratchRoot = scratchWorkspace()
  const cwd = options.scratch ? scratchRoot : realpathSync(requested)
  const scratch = options.scratch === true || cwd === scratchRoot

  const targetKey = options.sessionPath ? sessionKey(options.sessionPath) : null
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
        const existingScratch = existing.cwd === scratchRoot
        if (existingPath) rememberActiveSession(existing.cwd, existingPath)
        if (!existingScratch && !isTemporaryWorkspace(existing.cwd)) {
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
  const readOnly = options.files === 'read-only'
  const wantsSandbox = permission !== 'full' && (settings.sandboxEnabled === true || readOnly)
  const sandboxSettings = readOnly ? { ...settings, sandboxMode: 'read-only' as const } : settings
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
    const additionalArgs = [
      '--extension', join(runtime, 'src', 'desktop-access-extension.ts'),
      '--skill', join(runtime, 'desktop-guidance')
    ]
    const sandbox = wantsSandbox ? createSandbox(cwd, sandboxSettings) : null
    if (wantsSandbox && !sandbox && settings.sandboxEnabled === true) {
      throw new Error('沙箱已启用，但当前环境没有可用的 sandbox runtime 或 Node.js。请在设置中关闭沙箱后重试。')
    }
    if (sandbox) {
      appendSandboxAudit({
        type: 'start',
        cwd,
        mode: sandboxSettings.sandboxMode ?? 'workspace-write',
        network: settings.sandboxNetwork ?? 'model',
        domains: settings.sandboxAllowedDomains ?? []
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
        ...(sandbox
          ? { files: readOnly ? 'read-only' as const : settings.sandboxMode ?? 'workspace-write', network: settings.sandboxNetwork ?? 'model' }
          : readOnly ? { files: 'read-only' as const } : {})
      },
      extraEnv: { ...jevEnv(), ...proxyEnv(settings) },
      sandbox: sandbox ?? undefined,
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
      scratch || isTemporaryWorkspace(cwd)
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

async function setSessionPermission(input: { cwd: string; sessionPath: string | null; permission: SessionPermission; files?: 'workspace-write' | 'read-only' }): Promise<SessionSecurity> {
  const settings = loadSettings()
  const english = settings.language === 'en'
  const current = proc
  if (!current?.alive || typeof input?.cwd !== 'string' || current.cwd !== input.cwd || current.sessionPath !== input.sessionPath) {
    throw new Error(english ? 'The active conversation changed. Try again.' : '当前会话已切换，请重试。')
  }
  if (input.permission !== 'ask' && input.permission !== 'review' && input.permission !== 'full') throw new Error('Invalid permission mode.')
  const files = input.permission === 'ask' && input.files === 'read-only' ? 'read-only' as const : undefined
  const sameFiles = input.permission !== 'ask' || (current.security.files === 'read-only') === (files === 'read-only')
  if (current.security.permission === input.permission && sameFiles) return current.security

  const busy = english ? 'Wait for the current operation to finish before switching permissions.' : '请等待当前操作结束后再切换权限。'
  if (current.hasPendingWork || sessionUiRequests.pendingOwners().includes(current)) throw new Error(busy)
  changingSessionPermission = true
  try {
    const state = await current.send<PiState>({ type: 'get_state' }, 5000)
    const actualPath = state.data?.sessionFile ?? current.sessionPath
    if (!state.success || !state.data || state.data.isStreaming || state.data.isCompacting || state.data.pendingMessageCount ||
      sessionUiRequests.pendingOwners().includes(current) || (!actualPath && state.data.messageCount)) throw new Error(busy)
    if (actualPath !== input.sessionPath) throw new Error(english ? 'The active conversation changed. Try again.' : '当前会话已切换，请重试。')
    // Pi reserves a path before it writes the first message. Reopen that same
    // path in an empty conversation so the composer keeps its draft owner.
    const opened = await doOpenSession({
      cwd: current.cwd, sessionPath: actualPath, permission: input.permission, files,
      replace: current, emptySession: state.data.messageCount === 0
    })
    if (!opened.ok || !proc) throw new Error(opened.error ?? (english ? 'Could not change permissions.' : '无法切换权限。'))
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

function runGitCapture(cwd: string, args: string[]): { ok: boolean; output: string; error?: string } {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
  try {
    const output = execFileSync('git', args, {
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

function registerIpc(): void {
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
  ipcMain.handle('session:set-permission', (_event, input: Parameters<typeof setSessionPermission>[0]) =>
    enqueue(() => setSessionPermission(input))
  )

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

  ipcMain.on('pi:ui-response', (_event, response: Record<string, unknown>) => {
    sessionUiRequests.respond(response)
  })

  ipcMain.handle('models:read', (): ModelsConfig => readModelsConfig())

  ipcMain.handle('skills:list', (_event, cwd: string) => listSkills(cwd))
  ipcMain.handle('skills:count', (_event, cwd: string) => countSkills(cwd))
  ipcMain.handle('connectors:list', (_event, cwd: string) => listConnectors(cwd))
  ipcMain.handle('mcp-connectors:list', () => listMcpConnectors())
  ipcMain.handle('mcp-connectors:save', (_event, input: McpConnectorInput) => saveMcpConnector(input))
  ipcMain.handle('mcp-connectors:test', (_event, input: McpConnectorInput) => {
    const settings = loadSettings()
    return testMcpConnector(input, resolvePiPath(settings.piPath), proxyEnv(settings))
  })
  ipcMain.handle('mcp-connectors:remove', (_event, id: string) => removeMcpConnector(id))
  ipcMain.handle('skills:read', (_event, path: string) => readSkillFile(path))
  ipcMain.handle('packages:list', (_event, cwd: string) => listPackages(cwd))
  ipcMain.handle('packages:inspect', (_event, source: string, cwd: string) => inspectPackage(source, cwd))
  ipcMain.handle('packages:catalog', (_event, query: string) => searchPackageCatalog(query))

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

  ipcMain.handle('shell:open-path', async (_event, path: string): Promise<boolean> => {
    if (!path) return false
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
    ): boolean => {
      if (!Notification.isSupported()) return false
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return false
      const notification = new Notification({
        title: payload?.title?.trim() || 'Pi',
        body: payload?.body ?? ''
      })
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
      notification.on('click', () => {
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
    void stopBrowserBridge()
    scheduler.shutdown()
    for (const process of new Set(processes.values())) process.stop()
    processes.clear()
    proc = null
    sessionUiRequests.dispose()
  })
}
