import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'
import type { ConnectorEntry, SkillEntry } from '@shared/types'
import { augmentedPath } from './pi-locate'
import { agentDir } from './pi-settings'

interface ParsedSkill {
  name?: string
  description?: string
  version?: string
  bins: string[]
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** Minimal YAML frontmatter reader: the fields skills actually use. */
function parseFrontmatter(raw: string): ParsedSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  if (!match) return { bins: [] }
  const lines = match[1].split(/\r?\n/)
  const result: ParsedSkill = { bins: [] }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const key = /^([A-Za-z_]+):\s*(.*)$/.exec(line)
    if (!key) continue
    const [, name, value] = key
    const trimmed = value.trim()
    if (name === 'name' && trimmed) result.name = stripQuotes(trimmed)
    else if (name === 'description' && (trimmed === '>' || trimmed === '|')) {
      // Folded/literal YAML block: description spans the indented lines below.
      const block: string[] = []
      let cursor = index + 1
      for (; cursor < lines.length; cursor += 1) {
        const current = lines[cursor]
        if (current.trim() && !/^\s/.test(current)) break
        if (current.trim()) block.push(current.trim())
      }
      result.description = block.join(trimmed === '|' ? '\n' : ' ')
      index = cursor - 1
    } else if (name === 'description' && trimmed) result.description = stripQuotes(trimmed)
    else if (name === 'version' && trimmed) result.version = stripQuotes(trimmed)
  }

  if (!result.version) {
    const nested = /^[ \t]+version:\s*(.+)$/m.exec(match[1])
    if (nested) result.version = stripQuotes(nested[1])
  }

  // metadata.requires.bins may be nested under "metadata:", so find the
  // "requires:" line at any indent and read the bins beneath it.
  let requiresIndent = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (requiresIndent < 0) {
      const header = /^(\s*)requires:\s*$/.exec(line)
      if (header) requiresIndent = header[1].length
      continue
    }
    const indent = /^\s*/.exec(line)?.[0].length ?? 0
    if (line.trim() && indent <= requiresIndent) {
      requiresIndent = -1
      continue
    }
    const inline = /^\s*bins:\s*\[(.*)\]\s*$/.exec(line)
    if (inline) {
      result.bins = inline[1]
        .split(',')
        .map((item) => stripQuotes(item))
        .filter(Boolean)
      break
    }
    if (/^\s*bins:\s*$/.test(line)) {
      for (let item = index + 1; item < lines.length; item += 1) {
        const next = /^\s*-\s*(.+)$/.exec(lines[item])
        if (!next) break
        result.bins.push(stripQuotes(next[1]))
      }
      break
    }
  }
  return result
}

function resolveBin(bin: string): string | undefined {
  try {
    const output = execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
      env: { ...process.env, PATH: augmentedPath() },
      encoding: 'utf8',
      timeout: 3000
    })
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
  } catch {
    return undefined
  }
}

function binExists(bin: string): boolean {
  return Boolean(resolveBin(bin))
}

/** Aggregate external CLIs required by skills, with their machine-wide path. */
export function listConnectors(cwd: string): ConnectorEntry[] {
  const connectors = new Map<string, ConnectorEntry>()
  for (const skill of listSkills(cwd)) {
    for (const bin of skill.requires.bins) {
      const entry = connectors.get(bin) ?? { name: bin, installed: false, usedBy: [] }
      entry.usedBy.push({ name: skill.name, path: skill.path })
      connectors.set(bin, entry)
    }
  }
  for (const entry of connectors.values()) {
    const path = resolveBin(entry.name)
    entry.installed = Boolean(path)
    entry.path = path
  }
  return Array.from(connectors.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function readSkill(dir: string, source: SkillEntry['source']): SkillEntry | null {
  const file = join(dir, 'SKILL.md')
  try {
    if (!statSync(file).isFile()) return null
    const raw = readFileSync(file, 'utf8')
    const parsed = parseFrontmatter(raw)
    let realPath = dir
    try {
      realPath = realpathSync(dir)
    } catch {
      // keep the given path
    }
    let symlink = false
    try {
      symlink = lstatSync(dir).isSymbolicLink()
    } catch {
      // ignore
    }
    const bins = parsed.bins
    return {
      name: parsed.name || basename(dir),
      description: parsed.description || '',
      version: parsed.version,
      path: dir,
      realPath,
      source,
      symlink,
      requires: { bins, missing: bins.filter((bin) => !binExists(bin)) }
    }
  } catch {
    return null
  }
}

function skillsIn(dir: string, source: SkillEntry['source']): SkillEntry[] {
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((entry) => !entry.startsWith('.'))
    .map((entry) => readSkill(join(dir, entry), source))
    .filter((entry): entry is SkillEntry => Boolean(entry))
}

function skillDirs(cwd: string): Array<{ dir: string; source: SkillEntry['source'] }> {
  const home = homedir()
  const project = cwd?.trim()
  return [
    ...(project ? [{ dir: join(project, '.pi', 'skills'), source: 'project' as const }] : []),
    ...(project ? [{ dir: join(project, '.agents', 'skills'), source: 'project' as const }] : []),
    { dir: join(agentDir(), 'skills'), source: 'user' as const },
    { dir: join(home, '.agents', 'skills'), source: 'agents' as const }
  ]
}

/**
 * Skills come from pi's own directory, the shared ~/.agents directory, and the
 * current project. The same real path is shown once, preferring project scope.
 */
export function listSkills(cwd: string): SkillEntry[] {
  const seen = new Map<string, SkillEntry>()
  for (const { dir, source } of skillDirs(cwd)) {
    if (!existsSync(dir)) continue
    for (const skill of skillsIn(dir, source)) {
      const existing = seen.get(skill.realPath)
      if (existing) {
        existing.shadowedBy = skill.path
        continue
      }
      seen.set(skill.realPath, skill)
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/** Same discovery as listSkills without reading frontmatter or probing bins. */
export function countSkills(cwd: string): number {
  const seen = new Set<string>()
  for (const { dir } of skillDirs(cwd)) {
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const path = join(dir, entry)
      if (!existsSync(join(path, 'SKILL.md'))) continue
      try {
        seen.add(realpathSync(path))
      } catch {
        seen.add(path)
      }
    }
  }
  return seen.size
}

export function readSkillFile(path: string): { ok: boolean; content?: string; error?: string } {
  try {
    const resolved = realpathSync(path)
    const roots = [join(agentDir(), 'skills'), join(homedir(), '.agents', 'skills')]
    const inRoot = roots.some((root) => resolved === root || resolved.startsWith(root + sep))
    const inProjectSkill = /(^|[/\\])(\.pi|\.agents)[/\\]skills[/\\]/.test(resolved)
    if (!inRoot && !inProjectSkill) return { ok: false, error: 'path outside skill directories' }
    const file = join(resolved, 'SKILL.md')
    const stat = statSync(file)
    if (!stat.isFile()) return { ok: false, error: 'not a file' }
    const buffer = readFileSync(file)
    const limit = 400_000
    const raw = buffer.subarray(0, limit).toString('utf8')
    // Frontmatter is shown as structured meta in the UI, not as body text.
    const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    return {
      ok: true,
      content,
      ...(buffer.length > limit ? { error: 'truncated' } : {})
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
