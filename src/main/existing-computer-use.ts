import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

function isComputerUse(path: string): string | undefined {
  try {
    const stats = statSync(path)
    const root = stats.isDirectory() ? path : stats.isFile() ? dirname(path) : ''
    const manifest = join(root, 'package.json')
    return root && existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === 'pi-desktop-computer-use' ? root : undefined
  } catch { return undefined }
}

/** Detect the common direct and auto-discovered forms of this extension. */
export function findExistingComputerUse(agent: string, cwd: string): string | undefined {
  const rules: Array<{ base: string; value: string }> = []
  for (const base of [agent, join(cwd, '.pi')]) {
    try {
      const entries: unknown = JSON.parse(readFileSync(join(base, 'settings.json'), 'utf8')).extensions
      if (Array.isArray(entries)) for (const value of entries) if (typeof value === 'string' && /^[+!\-]/.test(value) && !value.slice(1).startsWith('builtin:')) rules.push({base,value})
    } catch { /* Settings may not exist. */ }
  }
  const enabled = (root: string): boolean => {
    let result = true
    const candidates = [root, join(root, 'index.ts'), join(root, 'index.js')].map((value) => resolve(value).replaceAll('\\', '/'))
    for (const rule of rules) {
      const raw = rule.value.slice(1)
      const absolute = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : isAbsolute(raw) ? raw : resolve(rule.base, raw)
      const escaped = absolute.replaceAll('\\', '/').split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
      if (candidates.some((candidate) => new RegExp(`^${escaped}$`).test(candidate))) result = rule.value[0] === '+'
    }
    return result
  }
  for (const base of [join(cwd, '.pi'), agent]) {
    try {
      const entries: unknown = JSON.parse(readFileSync(join(base, 'settings.json'), 'utf8')).extensions
      if (Array.isArray(entries)) for (const value of entries) {
        if (typeof value !== 'string' || !value || /^[-!]/.test(value) || value.startsWith('builtin:')) continue
        const source = value.startsWith('+') ? value.slice(1) : value
        const path = source.startsWith('~/') ? join(homedir(), source.slice(2)) : isAbsolute(source) ? source : resolve(base, source)
        const found = isComputerUse(path)
        if (found && enabled(found)) return found
      }
    } catch { /* Settings may not exist. */ }
  }
  for (const dir of [join(cwd, '.pi', 'extensions'), join(agent, 'extensions')]) {
    try {
      for (const entry of readdirSync(dir)) {
        const found = isComputerUse(join(dir, entry))
        if (found && enabled(found)) return found
      }
    } catch { /* Auto-discovery directory may not exist. */ }
  }
  return undefined
}

