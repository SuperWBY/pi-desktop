import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { augmentedPath, locatePi } from './pi-locate'
import { seedPiPath, seedRoot } from './pi-runtime'

const run = promisify(execFile)

export type PiExecResult = { stdout: string; stderr: string }

/**
 * Single exit for spawning pi child processes without a shell. Prefers the
 * coding-agent cli.js under ELECTRON_RUN_AS_NODE so no shell wrapper sits
 * between us and pi: `shell:true` concatenates args unescaped, which breaks
 * any argument containing spaces and lets user- or model-controlled strings
 * run as commands on Windows. Returns null when only an unresolvable launcher
 * exists (Windows without cli.js) — callers must fail closed with an
 * actionable message instead of falling back to a shell.
 */
/** Run non-interactive Electron-as-Node tasks using the accessory helper on macOS. */
export function backgroundNodeExecutable(): string {
  if (process.platform !== 'darwin') return process.execPath
  const name = basename(process.execPath)
  const helper = join(dirname(dirname(process.execPath)), 'Frameworks', `${name} Helper.app`, 'Contents', 'MacOS', `${name} Helper`)
  return existsSync(helper) ? helper : process.execPath
}

export function directPiSpawn(
  piPath: string,
  args: string[],
  _options: { background?: boolean } = {}
): { executable: string; args: string[]; env: Record<string, string> } | null {
  const cli = resolvePiCliJs(piPath)
  if (cli) {
    // A macOS app executable can register each short-lived Node process as a
    // regular application. Its Electron Helper is an accessory process and
    // runs the same embedded Node runtime without a separate Dock presence.
    const executable = backgroundNodeExecutable()
    return { executable, args: [cli, ...args], env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  if (process.platform === 'win32') return null
  return { executable: piPath, args, env: { PI_DESKTOP_ELECTRON: backgroundNodeExecutable() } }
}

/** Resolve the bundled/managed CLI entry that seed launchers invoke via ELECTRON_RUN_AS_NODE. */
export function resolvePiCliJs(piPath?: string): string | null {
  const candidates: string[] = []
  if (piPath && piPath !== 'pi') {
    // An explicitly selected runtime must never be replaced by the bundled seed.
    // Resolve npm symlinks and the official managed launcher's version pointer.
    let selected = piPath
    try { selected = realpathSync(piPath) } catch { return null }
    if (/\.[cm]?js$/i.test(selected)) return statSync(selected).isFile() ? selected : null
    candidates.push(join(dirname(selected), 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js'))
    const managed = join(dirname(dirname(selected)), 'install')
    try {
      const version = readFileSync(join(managed, 'current-version'), 'utf8').trim()
      if (version !== '.' && version !== '..' && /^[a-z0-9._+-]+$/i.test(version)) {
        candidates.push(join(managed, 'releases', version, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js'))
      }
    } catch { /* Custom launchers can still run directly on Unix. */ }
    return candidates.find(file => {
      try { return statSync(file).isFile() && statSync(file).size > 64 } catch { return false }
    }) ?? null
  }
  const seed = seedPiPath()
  if (seed) {
    candidates.push(
      join(dirname(seed), 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')
    )
  }
  try {
    if (existsSync(seedRoot())) {
      for (const version of readdirSync(seedRoot())) {
        if (!/^\d+\.\d+\.\d+/.test(version)) continue
        candidates.push(
          join(seedRoot(), version, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')
        )
      }
    }
  } catch {
    // ignore unreadable seed root
  }
  const releases = join(homedir(), '.pi', 'agent', 'install', 'releases')
  try {
    if (existsSync(releases)) {
      for (const version of readdirSync(releases)) {
        if (!/^\d+\.\d+\.\d+/.test(version)) continue
        candidates.push(
          join(releases, version, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')
        )
      }
    }
  } catch {
    // ignore
  }

  for (const file of candidates) {
    try {
      if (existsSync(file) && statSync(file).isFile() && statSync(file).size > 64) return file
    } catch {
      // try next
    }
  }
  return null
}

function isWindowsBatch(file: string): boolean {
  return /\.(cmd|bat)$/i.test(file)
}

/**
 * Run a Pi CLI command. Prefer the coding-agent cli.js under ELECTRON_RUN_AS_NODE
 * so packaged apps never spawn shell/.cmd wrappers (those hit spawn EINVAL on
 * Windows and break when the .app path contains spaces). Fall back to the
 * launcher script / user CLI with platform-appropriate options.
 */
export async function execPi(
  piPath: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; cwd?: string } = {}
): Promise<PiExecResult> {
  const cwd = options.cwd ?? homedir()
  const timeout = options.timeout ?? 30_000
  const maxBuffer = options.maxBuffer ?? 8 * 1024 * 1024
  const baseEnv = {
    ...process.env,
    PATH: augmentedPath(),
    PI_DESKTOP_ELECTRON: backgroundNodeExecutable()
  }

  const errors: string[] = []
  const cli = resolvePiCliJs(piPath)
  if (cli) {
    try {
      return await run(backgroundNodeExecutable(), [cli, ...args], {
        cwd,
        timeout,
        maxBuffer,
        env: { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' }
      })
    } catch (error) {
      errors.push(formatExecError(error))
    }
  }

  const launchers = [piPath, locatePi(), seedPiPath()].filter((value, index, list): value is string => {
    return Boolean(value) && value !== 'pi' && list.indexOf(value) === index
  })

  for (const launcher of launchers) {
    if (!existsSync(launcher)) continue
    try {
      if (process.platform === 'win32' || isWindowsBatch(launcher)) {
        return await run(launcher, args, {
          cwd,
          timeout,
          maxBuffer,
          env: baseEnv,
          shell: true,
          windowsHide: true
        })
      }
      return await run(launcher, args, { cwd, timeout, maxBuffer, env: baseEnv })
    } catch (error) {
      const message = formatExecError(error)
      errors.push(message)
      // Unix: retry through /bin/sh when direct spawn rejects the script (EINVAL / EACCES).
      if (process.platform !== 'win32' && /EINVAL|EACCES|EPERM/i.test(message)) {
        try {
          return await run('/bin/sh', [launcher, ...args], { cwd, timeout, maxBuffer, env: baseEnv })
        } catch (retryError) {
          errors.push(formatExecError(retryError))
        }
      }
    }
  }

  // Last resort: bare `pi` on PATH (login-shell PATH already in augmentedPath).
  try {
    if (process.platform === 'win32') {
      return await run('pi.cmd', args, {
        cwd,
        timeout,
        maxBuffer,
        env: baseEnv,
        shell: true,
        windowsHide: true
      })
    }
    return await run('pi', args, { cwd, timeout, maxBuffer, env: baseEnv })
  } catch (error) {
    errors.push(formatExecError(error))
  }

  throw new Error(errors.filter(Boolean).pop() || '无法启动 Pi 运行时')
}

function formatExecError(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error ?? '')
  const err = error as NodeJS.ErrnoException & { stderr?: string | Buffer; stdout?: string | Buffer }
  const parts = [err.message, err.stderr?.toString(), err.stdout?.toString()]
    .filter(Boolean)
    .join('\n')
    .trim()
  return parts || String(err.code ?? 'unknown')
}

/** Map spawn/runtime failures to a short Chinese line for Settings UI. */
export function piExecUserError(error: unknown): string {
  const raw = formatExecError(error)
  if (/EINVAL|spawn\s+EINVAL/i.test(raw)) {
    return '无法启动内置运行时，请重试或改用 API Key'
  }
  if (/ENOENT|not found|找不到/i.test(raw)) {
    return '找不到 Pi 运行时，请重试或改用 API Key'
  }
  if (/EACCES|EPERM|permission denied/i.test(raw)) {
    return '没有权限启动运行时，请重试'
  }
  if (/Pi runtime is managed by Pi Desktop/i.test(raw)) {
    return '无法启动内置运行时，请重试或改用 API Key'
  }
  if (/Command failed/i.test(raw) && /spawn\s+\w+/i.test(raw)) {
    return '无法启动内置运行时，请重试或改用 API Key'
  }
  // Strip noisy Command failed prefixes; keep a short line.
  const cleaned = raw
    .replace(/^Command failed:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('/') && !/^pi(\.cmd)?\s/i.test(line))
  if (cleaned && !/^(spawn\s+)?[A-Z]{3,}$/i.test(cleaned) && cleaned.length < 120) {
    return cleaned
  }
  return '读取模型列表失败，请重试'
}
