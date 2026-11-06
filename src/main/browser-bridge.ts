import { createServer, type Server } from 'node:http'
import { chmod, mkdir, writeFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { browserDomAct, browserDomObserve, browserNavigate, browserState } from './browser'

let server: Server | null = null
let bridgeFile = ''

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

async function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  if (!chunks.length) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  } catch {
    throw new Error('Invalid JSON body')
  }
}

function authorized(req: import('node:http').IncomingMessage, token: string): boolean {
  return req.headers.authorization === `Bearer ${token}`
}

export async function startBrowserBridge(): Promise<void> {
  if (server) return
  const token = randomBytes(24).toString('hex')
  const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
    if (!authorized(req, token)) {
      json(res, 401, { ok: false, error: 'Unauthorized' })
      return
    }
    try {
      if (req.method === 'GET' && req.url === '/state') {
        json(res, 200, { ok: true, state: browserState() })
        return
      }
      if (req.method === 'POST' && req.url === '/observe') {
        const candidates = await browserDomObserve()
        json(res, 200, { ok: true, candidates })
        return
      }
      if (req.method === 'POST' && req.url === '/act') {
        const body = await readBody(req)
        const result = await browserDomAct(body)
        json(res, 200, { ok: true, result })
        return
      }
      if (req.method === 'POST' && req.url === '/navigate') {
        const body = await readBody(req)
        const url = String(body.url ?? '')
        json(res, 200, { ok: true, state: browserNavigate(url) })
        return
      }
      json(res, 404, { ok: false, error: 'Not found' })
    } catch (error) {
      json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  server = createServer((req, res) => void handler(req, res))
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Browser bridge failed to bind')
  const dir = join(homedir(), '.pi', 'computer-use')
  await mkdir(dir, { recursive: true })
  bridgeFile = join(dir, 'browser-bridge.json')
  const payload = JSON.stringify({
    port: address.port,
    token,
    pid: process.pid,
    startedAt: new Date().toISOString()
  })
  await writeFile(bridgeFile, payload, { mode: 0o600 })
  await chmod(bridgeFile, 0o600)
}

export async function stopBrowserBridge(): Promise<void> {
  if (bridgeFile) await unlink(bridgeFile).catch(() => undefined)
  bridgeFile = ''
  if (!server) return
  await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = null
}

export function browserBridgePath(): string {
  return bridgeFile
}
