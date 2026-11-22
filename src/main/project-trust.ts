import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { agentDir } from './pi-settings'
import type { ProjectTrustStatus } from '@shared/types'

const TRUST_KEYS = ['settings.json', 'mcp.json', 'extensions', 'skills', 'prompts', 'themes', 'SYSTEM.md', 'APPEND_SYSTEM.md'] as const

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function trustFile(): string {
  return join(agentDir(), 'trust.json')
}

function readTrust(): Record<string, boolean | null> {
  try {
    const parsed = JSON.parse(readFileSync(trustFile(), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, boolean | null> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value === true || value === false || value === null) result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

function writeTrust(data: Record<string, boolean | null>): void {
  const sorted: Record<string, boolean | null> = {}
  for (const key of Object.keys(data).sort()) {
    const value = data[key]
    if (value === true || value === false || value === null) sorted[key] = value
  }
  mkdirSync(dirname(trustFile()), { recursive: true, mode: 0o700 })
  writeFileSync(trustFile(), `${JSON.stringify(sorted, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  chmodSync(trustFile(), 0o600)
}

function findNearest(data: Record<string, boolean | null>, cwd: string): { path: string; decision: boolean } | null {
  let current = canonical(cwd)
  while (true) {
    if (data[current] === true || data[current] === false) return { path: current, decision: data[current] === true }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/** Mirrors pi's trust gate: only project-local resources need a decision. */
function trustRequiringResources(cwd: string): string[] {
  const root = canonical(cwd)
  const found = TRUST_KEYS.map((key) => join(root, '.pi', key)).filter(existsSync)
  let current = root
  while (true) {
    const skills = join(current, '.agents', 'skills')
    if (existsSync(skills) && skills !== join(canonical(homedir()), '.agents', 'skills')) found.push(skills)
    const parent = dirname(current)
    if (parent === current) return found
    current = parent
  }
}

export function projectTrustStatus(cwd: string): ProjectTrustStatus {
  const resources = trustRequiringResources(cwd)
  const entry = findNearest(readTrust(), cwd)
  return {
    required: resources.length > 0,
    resources,
    decision: entry?.decision ?? null,
    inheritedFrom: entry && entry.path !== canonical(cwd) ? entry.path : undefined
  }
}

export function setProjectTrust(cwd: string, decision: boolean | null, scope: 'project' | 'parent' = 'project'): ProjectTrustStatus {
  const path = canonical(cwd)
  const target = scope === 'parent' ? dirname(path) : path
  const data = readTrust()
  for (const key of Object.keys(data)) {
    if (canonical(key) === path || canonical(key) === target) delete data[key]
  }
  if (decision !== null) data[target] = decision
  if (scope === 'parent') data[path] = null
  writeTrust(data)
  return projectTrustStatus(cwd)
}
