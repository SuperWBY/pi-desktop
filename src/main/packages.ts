import { execFile, execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { PackageEntry, PackageProgress, PackageResources } from '@shared/types'
import { loadSettings } from './settings'
import { augmentedPath } from './pi-locate'
import { directPiSpawn } from './pi-exec'
import { resolvePiPath } from './pi-runtime'
import { agentDir, loadPiSettings } from './pi-settings'
import { parsePiListPaths } from './pi-list-parser'

interface ConfiguredPackage {
  source: string
  scope: 'user' | 'project'
}

function sourcesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (entry && typeof entry === 'object') {
        const source = (entry as { source?: unknown }).source
        return typeof source === 'string' ? source : ''
      }
      return ''
    })
    .filter(Boolean)
}

function projectSettingsPackages(cwd: string): string[] {
  try {
    const raw = readFileSync(join(cwd, '.pi', 'settings.json'), 'utf8')
    return sourcesFrom(JSON.parse(raw)?.packages)
  } catch {
    return []
  }
}

/** `pi list` is the only source that knows where git/local packages landed. */
function installedPaths(cwd: string): Map<string, string> {
  const paths = new Map<string, string>()
  const pi = resolvePiPath(loadSettings().piPath)
  try {
    const command = process.platform === 'win32' ? `"${pi}"` : pi
    const output = execFileSync(command, ['list'], {
      cwd,
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, PATH: augmentedPath() },
      shell: process.platform === 'win32'
    })
    for (const [source, path] of parsePiListPaths(output)) paths.set(source, path)
  } catch {
    // pi missing or offline: fall back to the npm layout below
  }
  return paths
}

function installedPathsAsync(cwd: string): Promise<Map<string, string>> {
  const pi = resolvePiPath(loadSettings().piPath)
  const command = process.platform === 'win32' ? `"${pi}"` : pi
  return new Promise((resolve, reject) => {
    execFile(command, ['list'], { cwd, encoding: 'utf8', timeout: 8000, env: { ...process.env, PATH: augmentedPath() }, shell: process.platform === 'win32' }, (error, output) => {
      if (error) reject(new Error('Unable to determine the installed Pi packages. Check the Pi installation and try again.'))
      else resolve(parsePiListPaths(output))
    })
  })
}

function npmPath(source: string): string {
  if (!source.startsWith('npm:')) return ''
  const name = source.slice(4).replace(/@[^/]+$/, '')
  return join(agentDir(), 'npm', 'node_modules', name)
}

function countResources(dir: string): PackageResources {
  const countDirs = (child: string): number => {
    try {
      return readdirSync(join(dir, child)).filter((entry) => {
        try {
          return statSync(join(dir, child, entry)).isDirectory()
        } catch {
          return false
        }
      }).length
    } catch {
      return 0
    }
  }
  let manifest: Record<string, unknown> = {}
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    // no manifest
  }
  const declared = (key: string): number => {
    const value = (manifest as { pi?: Record<string, unknown> }).pi?.[key]
    return Array.isArray(value) ? value.length : 0
  }
  const extensions = declared('extensions') || (manifest.main ? 1 : 0)
  return {
    extensions,
    skills: countDirs('skills') || declared('skills'),
    prompts: countDirs('prompts') || declared('prompts'),
    themes: countDirs('themes') || declared('themes')
  }
}

function describe(source: string, scope: 'user' | 'project', path: string): PackageEntry {
  let version: string | undefined
  let description: string | undefined
  let name = source.replace(/^npm:/, '')
  if (path) {
    try {
      const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as {
        name?: string
        version?: string
        description?: string
      }
      if (manifest.name) name = manifest.name
      version = manifest.version
      description = manifest.description
    } catch {
      // keep the source-derived name
    }
  }
  return {
    source,
    name,
    version,
    description,
    scope,
    path: path || undefined,
    resources: path ? countResources(path) : { extensions: 0, skills: 0, prompts: 0, themes: 0 },
    enabled: true
  }
}

export function listPackages(cwd: string): PackageEntry[] {
  const settings = loadPiSettings() as { packages?: unknown }
  const configured: ConfiguredPackage[] = [
    ...sourcesFrom(settings.packages).map((source) => ({ source, scope: 'user' as const })),
    ...projectSettingsPackages(cwd).map((source) => ({ source, scope: 'project' as const }))
  ]
  const paths = { current: null as Map<string, string> | null }
  const resolve = (source: string, scope: 'user' | 'project'): string => {
    const direct = npmPath(source)
    if (scope === 'user' && direct && existsSync(direct)) return direct
    paths.current ??= installedPaths(cwd)
    return paths.current.get(source) ?? ''
  }
  const seen = new Set<string>()
  const result: PackageEntry[] = []
  for (const item of configured) {
    const key = `${item.scope}:${item.source}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(describe(item.source, item.scope, resolve(item.source, item.scope)))
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/** Permission checks must not block Electron's main thread while Pi resolves packages. */
export async function listPackagesAsync(cwd: string): Promise<PackageEntry[]> {
  const settings = loadPiSettings() as { packages?: unknown }
  const configured: ConfiguredPackage[] = [
    ...sourcesFrom(settings.packages).map((source) => ({ source, scope: 'user' as const })),
    ...projectSettingsPackages(cwd).map((source) => ({ source, scope: 'project' as const }))
  ]
  let paths: Map<string, string> | undefined
  const seen = new Set<string>()
  const result: PackageEntry[] = []
  for (const item of configured) {
    const key = `${item.scope}:${item.source}`
    if (seen.has(key)) continue
    seen.add(key)
    const direct = npmPath(item.source)
    if (item.scope === 'user' && direct && existsSync(direct)) result.push(describe(item.source, item.scope, direct))
    else {
      paths ??= await installedPathsAsync(cwd)
      result.push(describe(item.source, item.scope, paths.get(item.source) ?? ''))
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/** Source strings reach a pi CLI argument; reject flag injection and control characters. */
export function validPackageSourceArg(source: unknown): source is string {
  return typeof source === 'string' && source.length > 0 && source.length <= 1000
    && !source.startsWith('-') && !/[\u0000-\u001f\u007f]/.test(source)
}

export function runPiPackageCommand(
  args: string[],
  cwd: string,
  onProgress: (progress: PackageProgress) => void
): Promise<{ ok: boolean; code: number | null; error?: string }> {
  const pi = resolvePiPath(loadSettings().piPath)
  const direct = directPiSpawn(pi, args)
  if (!direct) {
    return Promise.resolve({ ok: false, code: null, error: `找不到 Pi 的 cli.js（"${pi}"），无法在 Windows 上执行包操作。请重新安装 Pi。` })
  }
  return new Promise((resolve) => {
    const child = spawn(direct.executable, direct.args, {
      cwd,
      env: { ...process.env, PATH: augmentedPath(), ...direct.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    onProgress({ phase: 'start', line: `${basename(pi)} ${args.join(' ')}` })

    const push = (chunk: Buffer | string): void => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) onProgress({ phase: 'log', line })
      }
    }
    child.stdout?.on('data', push)
    child.stderr?.on('data', push)

    child.on('error', (error) => {
      onProgress({ phase: 'error', line: error.message })
      resolve({ ok: false, code: null, error: error.message })
    })
    child.on('close', (code) => {
      const ok = code === 0
      onProgress({ phase: ok ? 'done' : 'error', code })
      resolve({
        ok,
        code,
        error: ok ? undefined : `Pi 意外停止了（代码 ${code ?? 'unknown'}）`
      })
    })
  })
}
