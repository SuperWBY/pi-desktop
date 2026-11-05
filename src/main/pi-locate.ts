import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

const isWindows = process.platform === 'win32'

let cachedShellPath: string[] | null = null

/**
 * GUI processes inherit a minimal PATH. Ask the user's login shell once so
 * npm-global, nvm, volta, asdf and similar locations are visible.
 */
function loginShellPath(): string[] {
  if (cachedShellPath) return cachedShellPath
  if (isWindows) {
    cachedShellPath = []
    return cachedShellPath
  }
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const output = execFileSync(shell, ['-lic', 'printf "%s" "$PATH"'], {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const line = output
      .split(/\r?\n/)
      .filter((entry) => entry.includes(delimiter))
      .pop()
    cachedShellPath = line ? line.split(delimiter).filter(Boolean) : []
  } catch {
    cachedShellPath = []
  }
  return cachedShellPath
}

function isExecutable(file: string): boolean {
  try {
    // Windows has no POSIX execute bit; existence is the useful check there.
    if (isWindows) return existsSync(file)
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function piName(): string {
  return isWindows ? 'pi.cmd' : 'pi'
}

/**
 * GUI apps do not inherit the login shell PATH on macOS, and on Windows the
 * npm shim lives outside the default PATH. Look in known install locations
 * first, then fall back to the platform's lookup tool.
 */
export function locatePi(configured?: string): string {
  const appData = process.env.APPDATA
  const candidates = [
    configured?.trim(),
    process.env.PI_DESKTOP_PI_PATH?.trim(),
    join(homedir(), '.pi', 'agent', 'bin', piName()),
    appData ? join(appData, 'npm', piName()) : '',
    ...(isWindows
      ? []
      : ['/opt/homebrew/bin/pi', '/usr/local/bin/pi', '/usr/bin/pi'])
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate
  }

  try {
    if (isWindows) {
      const output = execFileSync('where', ['pi'], {
        encoding: 'utf8',
        timeout: 6000,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      const found = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && isExecutable(line))
      if (found) return found
    } else {
      const shell = process.env.SHELL || '/bin/zsh'
      const output = execFileSync(shell, ['-lic', 'command -v pi'], {
        encoding: 'utf8',
        timeout: 6000,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      const found = output.trim().split('\n').filter(Boolean).pop()
      if (found && isExecutable(found)) return found
    }
  } catch {
    // ignore and fall through
  }

  return 'pi'
}

export function piVersion(piPath: string): string | null {
  try {
    const command = isWindows ? `"${piPath}"` : piPath
    const output = execFileSync(command, ['--version'], {
      encoding: 'utf8',
      timeout: 8000,
      env: { ...process.env, PATH: augmentedPath() },
      shell: isWindows
    })
    return output.trim().split(/\r?\n/).pop() ?? null
  } catch {
    return null
  }
}

export function augmentedPath(): string {
  const appData = process.env.APPDATA
  const extra = [
    ...(process.env.PI_DESKTOP_BIN ? [process.env.PI_DESKTOP_BIN] : []),
    join(homedir(), '.local', 'share', 'pi-node', 'current', 'bin'),
    join(homedir(), '.pi', 'agent', 'bin'),
    join(homedir(), '.npm-global', 'bin'),
    join(homedir(), '.local', 'bin'),
    dirname(process.execPath),
    ...(appData ? [join(appData, 'npm')] : []),
    ...loginShellPath(),
    ...(isWindows
      ? []
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])
  ]
  const current = process.env.PATH ?? ''
  return Array.from(new Set([...extra, ...current.split(delimiter)])).filter(Boolean).join(delimiter)
}
