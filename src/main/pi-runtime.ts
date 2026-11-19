import { app } from 'electron'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { locatePi } from './pi-locate'

/**
 * Directory containing the offline runtime shipped with the app. In
 * development it lives under build/; packaged builds receive it through
 * Contents/Resources/pi-seed.
 */
export function seedRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'pi-seed')
    : join(app.getAppPath(), 'build', 'pi-seed')
}

function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] => value.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** Newest versioned seed launcher, or null when this build has no seed. */
export function seedPiPath(): string | null {
  if (process.env.PI_DESKTOP_SKIP_SEED === '1') return null
  const base = seedRoot()
  if (!existsSync(base)) return null
  const launcherName = process.platform === 'win32' ? 'pi.cmd' : 'pi'
  const versions = readdirSync(base)
    .filter((name) => /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(name))
    .sort(compareVersions)
    .reverse()
  for (const version of versions) {
    const launcher = join(base, version, launcherName)
    try {
      if (statSync(launcher).isFile()) return launcher
    } catch {
      // Try the next seed.
    }
  }
  return null
}

/**
 * Prefer the user's managed install so `pi update` keeps working. The
 * bundled seed is only a fallback for a clean machine and never overwrites
 * an existing user runtime.
 */
export function resolvePiPath(configured?: string): string {
  const installed = locatePi(configured)
  if (installed !== 'pi') return installed
  return seedPiPath() ?? installed
}
