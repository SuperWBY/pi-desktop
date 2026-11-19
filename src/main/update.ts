import { app, shell } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdateAsset, UpdateInfo, UpdateProgress } from '@shared/types'

const RELEASE_API = process.env.PI_UPDATE_API_URL || 'https://api.github.com/repos/SuperWBY/pi-desktop/releases/latest'

function compare(a: string, b: string): number {
  const parse = (value: string): number[] => value.replace(/^v/, '').split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function chooseAsset(assets: unknown): UpdateAsset | null {
  if (!Array.isArray(assets)) return null
  const platform = process.platform === 'darwin' ? ['.dmg', '.zip'] : process.platform === 'win32' ? ['.exe', '.zip'] : ['.AppImage', '.zip']
  const candidates = assets
    .filter((asset): asset is Record<string, unknown> => Boolean(asset && typeof asset === 'object'))
    .map((asset) => ({
      name: typeof asset.name === 'string' ? asset.name : '',
      url: typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '',
      size: typeof asset.size === 'number' ? asset.size : 0,
      digest: typeof asset.digest === 'string' ? asset.digest : undefined
    }))
    .filter((asset) => asset.name && asset.url && asset.size > 0 && asset.size < 1024 * 1024 * 1024)
  for (const extension of platform) {
    const match = candidates.find((asset) => asset.name.toLowerCase().endsWith(extension.toLowerCase()))
    if (match) return match
  }
  return null
}

async function latestRelease(): Promise<{ data: Record<string, unknown>; error?: string }> {
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Pi-Desktop' },
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) return { data: {}, error: `GitHub returned ${response.status}.` }
    return { data: await response.json() as Record<string, unknown> }
  } catch (error) {
    return { data: {}, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Check the public release feed; downloading/installing stays an explicit user action. */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const release = await latestRelease()
  if (release.error) return { current, latest: null, hasUpdate: false, url: null, notes: null, publishedAt: null, error: release.error }
  const data = release.data
  const latest = typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/, '') : null
  return {
    current,
    latest,
    hasUpdate: Boolean(latest && compare(latest, current) > 0),
    url: typeof data.html_url === 'string' ? data.html_url : null,
    notes: typeof data.body === 'string' ? data.body.slice(0, 2000) : null,
    publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
    asset: chooseAsset(data.assets)
  }
}

export async function downloadUpdate(onProgress?: (progress: UpdateProgress) => void): Promise<{ ok: boolean; path?: string; error?: string }> {
  const sendProgress = (progress: UpdateProgress): void => { try { onProgress?.(progress) } catch { /* ignore listener errors */ } }
  const release = await latestRelease()
  if (release.error) return { ok: false, error: release.error }
  const data = release.data
  const tag = typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/, '') : ''
  const current = app.getVersion()
  if (!tag || compare(tag, current) <= 0) return { ok: false, error: '当前已经是最新版本。' }
  const asset = chooseAsset(data.assets)
  if (!asset) return { ok: false, error: '这个 Release 没有当前平台的安装包。' }
  const safeName = basename(asset.name)
  const directory = join(app.getPath('userData'), 'updates')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const destination = join(directory, safeName)
  const temporary = `${destination}.part`
  await rm(temporary, { force: true }).catch(() => undefined)
  sendProgress({ phase: 'downloading', received: 0, total: asset.size, message: '开始下载…' })
  try {
    const response = await fetch(asset.url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) })
    if (!response.ok || !response.body) return { ok: false, error: `下载失败：HTTP ${response.status}` }
    const total = Number(response.headers.get('content-length')) || asset.size
    let received = 0
    const hash = createHash('sha256')
    const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>)
    source.on('data', (chunk: Buffer) => {
      received += chunk.length
      hash.update(chunk)
      if (received % (256 * 1024) < chunk.length) sendProgress({ phase: 'downloading', received, total, message: `下载中 ${Math.round((received / total) * 100)}%` })
    })
    await pipeline(source, createWriteStream(temporary, { mode: 0o600 }))
    const expected = asset.digest?.replace(/^sha256:/i, '').toLowerCase()
    const actual = hash.digest('hex')
    if (expected && expected !== actual) {
      await rm(temporary, { force: true }).catch(() => undefined)
      return { ok: false, error: '安装包校验失败，下载内容与 Release 摘要不一致。' }
    }
    await rename(temporary, destination)
    sendProgress({ phase: 'ready', received, total, message: expected ? '下载并校验完成，正在打开安装包…' : '下载完成（Release 未提供摘要），正在打开安装包…', path: destination })
    if (process.env.PI_DESKTOP_SKIP_UPDATE_OPEN === '1') return { ok: true, path: destination }
    const error = await shell.openPath(destination)
    if (error) return { ok: false, path: destination, error: `安装包已下载，但无法打开：${error}` }
    return { ok: true, path: destination }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    sendProgress({ phase: 'error', message })
    return { ok: false, error: message }
  }
}

export async function openReleasePage(url: string): Promise<void> {
  if (/^https:\/\/github\.com\/SuperWBY\/pi-desktop\/releases\//.test(url)) await shell.openExternal(url)
}

