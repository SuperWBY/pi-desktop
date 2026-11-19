import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { PackageInspection, PackageResources } from '@shared/types'
import { augmentedPath } from './pi-locate'

const LIFECYCLE = new Set(['preinstall', 'install', 'postinstall', 'prepare'])

function resourcesOf(manifest: Record<string, unknown>, counts?: { skills: number; prompts: number; themes: number }): PackageResources {
  const pi = (manifest.pi ?? {}) as Record<string, unknown>
  const declared = (key: string): number => Array.isArray(pi[key]) ? (pi[key] as unknown[]).length : 0
  return {
    extensions: declared('extensions') || (typeof manifest.main === 'string' ? 1 : 0),
    skills: counts?.skills ?? declared('skills'),
    prompts: counts?.prompts ?? declared('prompts'),
    themes: counts?.themes ?? declared('themes')
  }
}

async function countDirectory(dir: string): Promise<{ files: number; bytes: number; skills: number; prompts: number; themes: number }> {
  const result = { files: 0, bytes: 0, skills: 0, prompts: 0, themes: 0 }
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > 8 || result.files > 5000) return
    let entries
    try { entries = await fs.readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.cache') continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (current === dir && entry.name === 'skills') result.skills = (await fs.readdir(full).catch(() => [])).length
        if (current === dir && entry.name === 'prompts') result.prompts = (await fs.readdir(full).catch(() => [])).length
        if (current === dir && entry.name === 'themes') result.themes = (await fs.readdir(full).catch(() => [])).length
        await walk(full, depth + 1)
      } else if (entry.isFile()) {
        result.files += 1
        try { result.bytes += (await fs.stat(full)).size } catch { /* ignore */ }
      }
    }
  }
  await walk(dir, 0)
  return result
}

function parseScripts(manifest: Record<string, unknown>): { name: string; command: string }[] {
  const scripts = manifest.scripts
  if (!scripts || typeof scripts !== 'object') return []
  return Object.entries(scripts as Record<string, unknown>)
    .filter(([name, command]) => LIFECYCLE.has(name) && typeof command === 'string' && command.trim())
    .map(([name, command]) => ({ name, command: String(command).slice(0, 500) }))
}

function riskOf(manifestFound: boolean, scripts: { name: string; command: string }[], resources: PackageResources): PackageInspection['risk'] {
  if (!manifestFound) return 'unknown'
  if (scripts.length || resources.extensions > 0) return 'high'
  if (resources.skills > 0) return 'medium'
  return 'low'
}

function warningsOf(kind: PackageInspection['kind'], manifestFound: boolean, scripts: { name: string; command: string }[], resources: PackageResources): string[] {
  const warnings: string[] = []
  if (!manifestFound) warnings.push('无法读取 package.json，安装内容和权限未知。')
  if (scripts.length) warnings.push(`安装时会执行 ${scripts.map((item) => item.name).join(' / ')} 脚本。`)
  if (resources.extensions > 0) warnings.push('包含 pi 扩展代码，会在会话中运行并拥有工具权限。')
  if (resources.skills > 0) warnings.push('包含技能提示词，可能影响模型行为，存在提示注入风险。')
  if (kind !== 'local') warnings.push('远程来源会在安装时下载代码；安装前请确认仓库和维护者可信。')
  return warnings
}

async function inspectLocal(source: string, cwd: string): Promise<PackageInspection> {
  const path = resolve(isAbsolute(source) ? source : join(cwd, source))
  const counts = await countDirectory(path)
  let manifest: Record<string, unknown> = {}
  let manifestFound = false
  try {
    const parsed = JSON.parse(await fs.readFile(join(path, 'package.json'), 'utf8')) as unknown
    if (parsed && typeof parsed === 'object') { manifest = parsed as Record<string, unknown>; manifestFound = true }
  } catch { /* no manifest */ }
  const resources = resourcesOf(manifest, counts)
  const scripts = parseScripts(manifest)
  return {
    source,
    kind: 'local',
    path,
    name: typeof manifest.name === 'string' ? manifest.name : source.replace(/^\.\//, ''),
    version: typeof manifest.version === 'string' ? manifest.version : undefined,
    description: typeof manifest.description === 'string' ? manifest.description : undefined,
    manifestFound,
    scripts,
    resources,
    files: counts.files,
    bytes: counts.bytes,
    risk: riskOf(manifestFound, scripts, resources),
    warnings: warningsOf('local', manifestFound, scripts, resources)
  }
}

function npmPackageName(spec: string): string {
  const clean = spec.replace(/^npm:/, '')
  const at = clean.lastIndexOf('@')
  return at > 0 ? clean.slice(0, at) : clean
}

async function npmManifest(spec: string): Promise<Record<string, unknown> | null> {
  const clean = spec.replace(/^npm:/, '')
  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile('npm', ['view', clean, '--json'], {
        timeout: 12000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, PATH: augmentedPath() }
      }, (error, stdout) => error ? reject(error) : resolve(stdout))
    })
    const start = output.indexOf('{')
    if (start >= 0) {
      const parsed = JSON.parse(output.slice(start)) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    }
  } catch { /* registry fallback */ }
  try {
    const name = npmPackageName(clean)
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return null
    const body = await response.json() as { 'dist-tags'?: { latest?: string }; versions?: Record<string, Record<string, unknown>> }
    const latest = body['dist-tags']?.latest
    return latest && body.versions?.[latest] ? body.versions[latest] : null
  } catch { return null }
}

async function inspectNpm(source: string): Promise<PackageInspection> {
  const manifest = await npmManifest(source)
  const resources = resourcesOf(manifest ?? {})
  const scripts = parseScripts(manifest ?? {})
  return {
    source,
    kind: 'npm',
    name: manifest && typeof manifest.name === 'string' ? manifest.name : source.replace(/^npm:/, ''),
    version: manifest && typeof manifest.version === 'string' ? manifest.version : undefined,
    description: manifest && typeof manifest.description === 'string' ? manifest.description : undefined,
    manifestFound: Boolean(manifest),
    scripts,
    resources,
    risk: riskOf(Boolean(manifest), scripts, resources),
    warnings: warningsOf('npm', Boolean(manifest), scripts, resources)
  }
}

function githubRaw(source: string): string | null {
  const match = source.match(/github\.com[/:]([^/]+)\/([^/#]+)(?:#([^/]+))?/i) ?? source.match(/^github:([^/]+)\/([^/#]+)/i)
  if (!match) return null
  const branch = match[3] || 'HEAD'
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${branch}/package.json`
}

async function inspectGit(source: string): Promise<PackageInspection> {
  const raw = githubRaw(source)
  let manifest: Record<string, unknown> | null = null
  if (raw) {
    try {
      const response = await fetch(raw, { signal: AbortSignal.timeout(8000) })
      if (response.ok) manifest = await response.json() as Record<string, unknown>
    } catch { /* unknown */ }
  }
  const resources = resourcesOf(manifest ?? {})
  const scripts = parseScripts(manifest ?? {})
  return {
    source,
    kind: 'git',
    name: manifest && typeof manifest.name === 'string' ? manifest.name : source,
    version: manifest && typeof manifest.version === 'string' ? manifest.version : undefined,
    description: manifest && typeof manifest.description === 'string' ? manifest.description : undefined,
    manifestFound: Boolean(manifest),
    scripts,
    resources,
    risk: riskOf(Boolean(manifest), scripts, resources),
    warnings: warningsOf('git', Boolean(manifest), scripts, resources)
  }
}

export async function inspectPackage(source: string, cwd: string): Promise<PackageInspection> {
  const value = source.trim()
  if (!value) throw new Error('请输入插件来源。')
  if (value.length > 500) throw new Error('插件来源过长。')
  if (/^(npm:|[a-z0-9@][a-z0-9._@/-]*$)/i.test(value) && !/^https?:|^git|^ssh:|^file:/i.test(value)) {
    const localPath = resolve(isAbsolute(value) ? value : join(cwd, value))
    try {
      const stat = await fs.stat(localPath)
      if (stat.isDirectory()) return inspectLocal(value, cwd)
    } catch { /* not local */ }
    return inspectNpm(value)
  }
  if (/^https?:\/\/github\.com|^git\+|^git@|^github:/i.test(value)) return inspectGit(value)
  return inspectLocal(value, cwd)
}
