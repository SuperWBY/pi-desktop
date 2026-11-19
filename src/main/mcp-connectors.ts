import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpConnectionTest, McpConnector, McpConnectorInput } from '@shared/types'
import { augmentedPath } from './pi-locate'
import { agentDir } from './pi-settings'

type Config = Record<string, unknown>
const protocolHeaders = new Set(['accept', 'connection', 'content-length', 'content-type', 'host', 'mcp-protocol-version', 'mcp-session-id', 'transfer-encoding', 'upgrade'])

function record(value: unknown): value is Config {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readConfig(): { root: Config; servers: Config } {
  let contents: string
  try {
    contents = readFileSync(join(agentDir(), 'mcp.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { root: {}, servers: {} }
    throw error
  }
  let root: unknown
  try { root = JSON.parse(contents.replace(/^\uFEFF/, '')) }
  catch { throw new Error('Pi 的 MCP 配置格式有误，请检查 mcp.json。') }
  if (!record(root) || (root.mcpServers !== undefined && !record(root.mcpServers))) {
    throw new Error('Pi 的 MCP 配置格式有误，请检查 mcp.json。')
  }
  return { root, servers: record(root.mcpServers) ? root.mcpServers : {} }
}

function writeConfig(root: Config, servers: Config): void {
  const directory = agentDir()
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.mcp-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ ...root, mcpServers: servers }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    renameSync(temporary, join(directory, 'mcp.json'))
  } finally {
    rmSync(temporary, { force: true })
  }
}

function summary(id: string, entry: Config): McpConnector | null {
  const name = typeof entry.desktopDisplayName === 'string' ? entry.desktopDisplayName : id
  const enabled = entry.enabled !== false
  if (typeof entry.url === 'string') {
    return { id, name, enabled, transport: 'http', url: entry.url, headerNames: record(entry.headers) ? Object.keys(entry.headers) : [] }
  }
  return typeof entry.command === 'string' ? { id, name, enabled, transport: 'stdio', headerNames: [] } : null
}

export function listMcpConnectors(): McpConnector[] {
  return Object.entries(readConfig().servers).flatMap(([id, entry]) => {
    const connector = record(entry) ? summary(id, entry) : null
    return connector ? [connector] : []
  }).sort((a, b) => a.name.localeCompare(b.name))
}

function parseInput(input: McpConnectorInput, previous?: Config): Config {
  if (!input || typeof input.name !== 'string' || typeof input.url !== 'string' || !Array.isArray(input.headers)) {
    throw new Error('请填写连接名称和有效的服务器地址。')
  }
  const name = input.name.trim()
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('连接名称需要 1–80 个字符。')
  let url: URL
  try { url = new URL(input.url.trim()) } catch { throw new Error('请输入包含 https:// 或 http:// 的完整服务器地址。') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.hash) {
    throw new Error('远程地址请使用 HTTPS，本机地址可使用 HTTP。请将认证信息填写在请求头里。')
  }
  const retained = record(previous?.headers) ? previous.headers : {}
  const names = new Set<string>()
  const headers: Array<[string, string]> = []
  for (const header of input.headers) {
    if (!record(header) || typeof header.name !== 'string' || typeof header.value !== 'string') throw new Error('请填写有效的请求头名称和值。')
    const key = header.name.trim()
    const lower = key.toLowerCase()
    if (!key && !header.value) continue
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || protocolHeaders.has(lower) || names.has(lower)) {
      throw new Error('请求头名称需有效、互不重复，协议保留的请求头由 Pi 设置。')
    }
    names.add(lower)
    if (header.keep === true) {
      if (previous?.url !== url.href && previous?.url !== input.url.trim()) throw new Error('服务器地址已变更，请重新填写请求头。')
      const saved = Object.entries(retained).find(([original]) => original.toLowerCase() === lower)?.[1]
      if (typeof saved !== 'string') throw new Error('保存过的请求头已变更，请重新打开编辑器。')
      headers.push([key, saved])
      continue
    }
    if (!header.value.trim() || header.value.trimStart().startsWith('!') || /[^\t\x20-\x7e\x80-\xff]/.test(header.value)) {
      throw new Error('请填写单行请求头值。命令表达式只能在 Pi 的配置文件里设置。')
    }
    headers.push([key, header.value])
  }
  return { exposure: 'direct', ...previous, type: 'http', url: url.href, headers: Object.fromEntries(headers), desktopDisplayName: name }
}

function currentHttp(servers: Config, id?: string): Config | undefined {
  if (!id) return undefined
  const entry = Object.hasOwn(servers, id) ? servers[id] : undefined
  if (!record(entry) || typeof entry.url !== 'string') throw new Error('找不到这个 HTTP 连接。')
  return entry
}

export function saveMcpConnector(input: McpConnectorInput): McpConnector {
  const { root, servers } = readConfig()
  const entry = parseInput(input, currentHttp(servers, input?.id))
  const uniqueId = String(entry.desktopDisplayName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
  const conflict = Object.keys(servers).some((id) => id.replace(/-/g, '_') === uniqueId.replace(/-/g, '_'))
  const id = input.id || (uniqueId && !conflict ? uniqueId : `connection-${randomUUID().slice(0, 12)}`)
  writeConfig(root, { ...servers, [id]: entry })
  return summary(id, entry)!
}

export function removeMcpConnector(id: string): void {
  const { root, servers } = readConfig()
  if (!id) throw new Error('请选择要移除的连接。')
  currentHttp(servers, id)
  delete servers[id]
  writeConfig(root, servers)
}

export async function testMcpConnector(input: McpConnectorInput, piPath: string, proxy: Record<string, string>): Promise<McpConnectionTest> {
  const entry = parseInput(input, currentHttp(readConfig().servers, input?.id))
  const directory = await mkdtemp(join(tmpdir(), 'pi-mcp-test-'))
  try {
    await writeFile(join(directory, 'mcp.json'), JSON.stringify({ mcpServers: { probe: { ...entry, enabled: true, timeout: 5 } } }), { mode: 0o600 })
    const output = await new Promise<string>((resolve) => {
      const windows = process.platform === 'win32'
      execFile(windows ? `"${piPath}"` : piPath, ['mcp', 'list', '--json'], {
        cwd: directory,
        env: { ...process.env, ...proxy, PATH: augmentedPath(), PI_CODING_AGENT_DIR: directory },
        shell: windows,
        timeout: 12_000,
        maxBuffer: 1_048_576
      }, (_error, stdout) => resolve(stdout))
    })
    try {
      const { servers } = JSON.parse(output)
      const report = Array.isArray(servers) ? servers.find((server) => server?.name === 'probe') : undefined
      if (!report) return { status: 'unsupported' }
      if (report.state === 'connected') return { status: 'connected', toolCount: Array.isArray(report.tools) ? report.tools.length : 0 }
      return { status: /auth|\b401\b|\b403\b/i.test(`${report.state} ${report.error ?? ''}`) ? 'unauthorized' : 'unreachable' }
    } catch {
      return { status: output ? 'unsupported' : 'unreachable' }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
