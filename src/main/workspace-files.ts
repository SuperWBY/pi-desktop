import { promises as fs } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const IGNORED = new Set([
  'node_modules', '.git', '.hg', '.svn', '.pi', '.agents', '.next', '.nuxt',
  'dist', 'build', 'out', 'release', 'coverage', '.cache', '.turbo', '.venv',
  'venv', '__pycache__', 'target', 'vendor', 'Pods', 'DerivedData'
])

const MAX_FILES = 4000
const MAX_DEPTH = 10

async function walk(root: string, dir: string, depth: number, files: string[]): Promise<void> {
  if (files.length >= MAX_FILES || depth > MAX_DEPTH) return
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (files.length >= MAX_FILES) return
    if (!entry.isDirectory() && !entry.isFile()) continue
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(root, full, depth + 1, files)
    else files.push(relative(root, full).split(sep).join('/'))
  }
}

export async function listWorkspaceFiles(cwd: string, query: string, limit = 30): Promise<string[]> {
  const root = resolve(cwd)
  const all: string[] = []
  await walk(root, root, 0, all)
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? all.filter((file) => file.toLowerCase().includes(needle))
    : all
  return matches
    .sort((a, b) => {
      const aBase = a.slice(a.lastIndexOf('/') + 1).toLowerCase()
      const bBase = b.slice(b.lastIndexOf('/') + 1).toLowerCase()
      const aStarts = aBase.startsWith(needle) || a.toLowerCase().startsWith(needle)
      const bStarts = bBase.startsWith(needle) || b.toLowerCase().startsWith(needle)
      if (aStarts !== bStarts) return aStarts ? -1 : 1
      return a.length - b.length || a.localeCompare(b)
    })
    .slice(0, limit)
}
