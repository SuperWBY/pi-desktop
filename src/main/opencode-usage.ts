import { net } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OpenCodeUsage } from '@shared/types'

interface OpenCodeWindow {
  status?: string
  percent?: number
  resetsAt?: string
}

interface OpenCodeResponse {
  usage?: {
    rolling?: OpenCodeWindow
    weekly?: OpenCodeWindow
    monthly?: OpenCodeWindow
  }
}

let cached: { at: number; value: OpenCodeUsage } | null = null

function authPaths(): string[] {
  const paths = [
    join(homedir(), '.pi', 'agent', 'auth.json'),
    join(homedir(), '.local', 'share', 'opencode', 'auth.json')
  ]
  if (process.env.XDG_DATA_HOME) {
    paths.push(join(process.env.XDG_DATA_HOME, 'opencode', 'auth.json'))
  }
  if (process.env.LOCALAPPDATA) {
    paths.push(join(process.env.LOCALAPPDATA, 'opencode', 'auth.json'))
  }
  return paths
}

function findKey(): string | null {
  if (process.env.OPENCODE_API_KEY?.trim()) return process.env.OPENCODE_API_KEY.trim()
  for (const path of authPaths()) {
    if (!existsSync(path)) continue
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      const entry = data['opencode-go'] as Record<string, unknown> | undefined
      const key = entry?.key
      if (typeof key === 'string' && key.trim()) return key.trim()
    } catch {
      // Try the next auth location.
    }
  }
  return null
}

function percent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, value))
}

function windowOf(value: OpenCodeWindow | undefined): OpenCodeUsage['rolling'] | null {
  if (!value) return null
  const p = percent(value.percent)
  if (p === null) return null
  return {
    percent: p,
    status: typeof value.status === 'string' ? value.status : 'unknown',
    resetsAt: typeof value.resetsAt === 'string' ? value.resetsAt : null
  }
}

export async function openCodeUsage(force = false): Promise<OpenCodeUsage> {
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.value
  const key = findKey()
  if (!key) {
    return {
      available: false,
      error: 'OpenCode Go API key is not available.',
      rolling: null,
      weekly: null,
      monthly: null,
      fetchedAt: Date.now()
    }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    let response: Response
    try {
      response = await net.fetch('https://opencode.ai/zen/go/v1/usage', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
          'User-Agent': 'pi-desktop'
        },
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok) {
      return {
        available: false,
        error: `OpenCode Go returned HTTP ${response.status}.`,
        rolling: null,
        weekly: null,
        monthly: null,
        fetchedAt: Date.now()
      }
    }
    const data = (await response.json()) as OpenCodeResponse
    const value: OpenCodeUsage = {
      available: true,
      rolling: windowOf(data.usage?.rolling),
      weekly: windowOf(data.usage?.weekly),
      monthly: windowOf(data.usage?.monthly),
      fetchedAt: Date.now()
    }
    cached = { at: Date.now(), value }
    return value
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Could not reach OpenCode Go.',
      rolling: null,
      weekly: null,
      monthly: null,
      fetchedAt: Date.now()
    }
  }
}