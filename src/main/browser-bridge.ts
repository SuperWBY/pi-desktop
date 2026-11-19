import { createServer, type Server } from 'node:http'
import { chmod, mkdir, writeFile, unlink } from 'node:fs/promises'
import { app } from 'electron'
import { dirname, join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { taskPage, browserDownloads, releaseTaskPages } from './browser'

let server: Server | null = null
let bridgeFile = ''
let starting: Promise<void> | null = null
let stopping: Promise<void> | null = null
const bridgeInstanceId = randomUUID()

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

export function startBrowserBridge(): Promise<void> {
  if (stopping) return stopping.then(() => startBrowserBridge())
  if (starting) return starting
  if (server) return Promise.resolve()
  const operation = openBrowserBridge().catch(async (error) => {
    if (bridgeFile) await unlink(bridgeFile).catch(() => undefined)
    bridgeFile = ''
    const failedServer = server
    server = null
    if (failedServer?.listening) await new Promise<void>((resolve) => failedServer.close(() => resolve()))
    throw error
  })
  starting = operation
  void operation.then(() => { if (starting === operation) starting = null }, () => { if (starting === operation) starting = null })
  return operation
}

async function openBrowserBridge(): Promise<void> {
  const token = randomBytes(24).toString('hex')
  let controller: { id: string; pid: number } | null = null
  const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
    if (!authorized(req, token)) {
      json(res, 401, { ok: false, error: 'Unauthorized' })
      return
    }
    try {
      const owner = req.headers['x-pi-controller']
      if (controller) {
        try { process.kill(controller.pid, 0) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') { controller = null; releaseTaskPages() } }
      }
      if (controller && owner !== controller.id) {
        json(res, 409, { ok: false, error: '另一个任务正在使用内置网页，请在该任务关闭网页会话后重试。' })
        return
      }
      if (req.method === 'POST' && req.url === '/claim') {
        const pid = Number(req.headers['x-pi-pid'])
        if (typeof owner !== 'string' || !owner || !Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid browser controller')
        controller = { id: owner, pid }
        json(res, 200, { ok: true }); return
      }
      if (req.method === 'POST' && req.url === '/release') {
        releaseTaskPages()
        controller = null
        json(res, 200, { ok: true }); return
      }
      if (req.method === 'GET' && (req.url === '/downloads' || req.url?.startsWith('/downloads?'))) {
        const raw = new URL(req.url, 'http://localhost').searchParams.get('after') ?? '0'
        const after = Number(raw)
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(after)) throw new Error('Invalid download cursor')
        json(res, 200, { ok: true, ...browserDownloads(after) })
        return
      }
      const key = req.headers['x-pi-page'] ?? 'main'
      if (typeof key !== 'string' || (key !== 'main' && !controller)) throw new Error('Claim the in-app browser first.')
      const page = taskPage(key)
      if (req.method === 'GET' && req.url === '/state') {
        json(res, 200, { ok: true, state: page.browserState() })
        return
      }
      if (req.method === 'POST' && req.url === '/viewport') {
        const body = await readBody(req)
        if (!controller || owner !== controller.id) throw new Error('Claim the browser before resizing a page.')
        page.setTaskViewport(body.width, body.height)
        json(res, 200, { ok: true })
        return
      }
      if (req.method === 'POST' && req.url === '/observe') {
        const snapshotId = randomUUID()
        const observation = await page.browserDomObserve(snapshotId)
        json(res, 200, { ok: true, ...observation, snapshotId, openedPages: page.openedPages(), state: page.browserState() })
        return
      }
      if (req.method === 'POST' && req.url === '/check-file') {
        const body = await readBody(req)
        await page.browserDomCheckFile(String(body.snapshotId ?? ''), String(body.expectedUrl ?? ''), String(body.documentId ?? ''), String(body.candidateId ?? ''))
        json(res, 200, { ok: true })
        return
      }
      if (req.method === 'POST' && req.url === '/hash-file') {
        const body = await readBody(req)
        const result = await page.browserDomHashFile(String(body.snapshotId ?? ''), String(body.expectedUrl ?? ''), String(body.documentId ?? ''), String(body.candidateId ?? ''))
        json(res, 200, { ok: true, ...result })
        return
      }
      if (req.method === 'POST' && req.url === '/act') {
        const body = await readBody(req)
        const result = await page.browserDomAct(body)
        const guardErrors: Record<string, string> = { page_changed: 'Browser page changed; observe again.', human: 'Human verification required.', target_changed: 'Target changed; observe again.', view_hidden: 'Open the in-app browser panel and observe again before choosing a file.' }
        const reason = typeof result.__piGuardRejected === 'string' ? result.__piGuardRejected : ''
        if (Object.hasOwn(guardErrors, reason)) {
          json(res, 400, { ok: false, code: 'PI_GUARD_REJECTED', reason, error: guardErrors[reason] })
          return
        }
        json(res, 200, { ok: true, result })
        return
      }
      if (req.method === 'POST' && req.url === '/read-text') {
        const body = await readBody(req)
        const result = await page.browserDomReadText(String(body.snapshotId ?? ''), String(body.expectedUrl ?? ''))
        json(res, 200, { ok: true, ...result })
        return
      }
      if (req.method === 'POST' && req.url === '/navigate') {
        const body = await readBody(req)
        const url = String(body.url ?? '')
        json(res, 200, { ok: true, state: page.browserNavigate(url, true) })
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
  bridgeFile = browserBridgePath()
  await mkdir(dirname(bridgeFile), { recursive: true, mode: 0o700 })
  const payload = JSON.stringify({
    port: address.port,
    token,
    pid: process.pid,
    startedAt: new Date().toISOString()
  })
  await writeFile(bridgeFile, payload, { mode: 0o600 })
  await chmod(bridgeFile, 0o600)
}

export function stopBrowserBridge(): Promise<void> {
  if (stopping) return stopping
  const operation = (async () => {
    if (starting) await starting.catch(() => undefined)
    if (bridgeFile) await unlink(bridgeFile).catch(() => undefined)
    bridgeFile = ''
    const current = server
    server = null
    if (current?.listening) await new Promise<void>((resolve) => current.close(() => resolve()))
  })()
  stopping = operation
  void operation.then(() => { if (stopping === operation) stopping = null }, () => { if (stopping === operation) stopping = null })
  return operation
}

export function browserBridgePath(): string {
  return join(app.getPath('userData'), 'computer-use-bridges', `${bridgeInstanceId}.json`)
}
