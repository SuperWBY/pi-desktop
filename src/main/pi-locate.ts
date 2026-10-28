import { execFileSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * GUI apps on macOS do not inherit the login shell PATH, so look in the
 * well-known install locations first and fall back to asking the user's shell.
 */
export function locatePi(configured?: string): string {
  const candidates = [
    configured?.trim(),
    process.env.PI_DESKTOP_PI_PATH?.trim(),
    join(homedir(), '.pi', 'agent', 'bin', 'pi'),
    '/opt/homebrew/bin/pi',
    '/usr/local/bin/pi',
    '/usr/bin/pi'
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate
  }

  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const output = execFileSync(shell, ['-lic', 'command -v pi'], {
      encoding: 'utf8',
      timeout: 6000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const found = output.trim().split('\n').filter(Boolean).pop()
    if (found && isExecutable(found)) return found
  } catch {
    // ignore and fall through
  }

  return 'pi'
}

export function piVersion(piPath: string): string | null {
  try {
    const extra = join(homedir(), '.local', 'share', 'pi-node', 'current', 'bin')
    const output = execFileSync(piPath, ['--version'], {
      encoding: 'utf8',
      timeout: 8000,
      env: {
        ...process.env,
        PATH: [extra, dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
          .filter(Boolean)
          .join(delimiter)
      }
    })
    return output.trim().split('\n').pop() ?? null
  } catch {
    return null
  }
}

export function augmentedPath(): string {
  const extra = [
    join(homedir(), '.local', 'share', 'pi-node', 'current', 'bin'),
    join(homedir(), '.pi', 'agent', 'bin'),
    dirname(process.execPath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ]
  const current = process.env.PATH ?? ''
  return Array.from(new Set([...extra, ...current.split(delimiter)])).filter(Boolean).join(delimiter)
}
