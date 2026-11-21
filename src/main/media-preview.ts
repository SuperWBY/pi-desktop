import { protocol } from 'electron'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { mediaMimeType } from '@shared/media'

export const mediaScheme = 'pi-media'
const maxEntries = 512
const mediaPolicy = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
const htmlPolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'; sandbox allow-scripts"

function within(root: string, path: string): boolean {
  const name = relative(root, path)
  return Boolean(name && name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name))
}

function byteRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2]) || size <= 0) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null
  return { start, end }
}

type Entry = { owner: object; root: string; path: string; mime: string }

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: mediaScheme, privileges: { standard: true, secure: true, stream: true } }])
}

export class MediaPreview {
  private readonly entries = new Map<string, Entry>()

  async issue(owner: object, workspace: string, requested: string): Promise<{ url: string; path: string } | null> {
    if (typeof requested !== 'string' || !requested || requested.length > 8192) return null
    try {
      const root = await realpath(workspace)
      const path = await realpath(resolve(root, requested))
      const mime = mediaMimeType(path)
      if (!mime || !within(root, path) || !(await stat(path)).isFile()) return null
      const existing = [...this.entries].find(([, entry]) => entry.owner === owner && entry.path === path)
      const token = existing?.[0] ?? randomUUID()
      this.entries.delete(token)
      this.entries.set(token, { owner, root, path, mime })
      if (this.entries.size > maxEntries) this.entries.delete(this.entries.keys().next().value!)
      return { url: `${mediaScheme}://file/${token}`, path }
    } catch {
      return null
    }
  }

  register(activeOwner: () => object | null): void {
    protocol.handle(mediaScheme, async (request) => {
      const url = new URL(request.url)
      const entry = url.hostname === 'file' ? this.entries.get(url.pathname.slice(1)) : undefined
      if (!entry || entry.owner !== activeOwner()) return new Response(null, { status: 404 })
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })

      try {
        const path = await realpath(entry.path)
        if (path !== entry.path || !within(entry.root, path)) return new Response(null, { status: 404 })
        const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
        let streaming = false
        try {
          const info = await file.stat()
          // Ensure an output path swapped for a symlink or directory cannot serve another file.
          const checked = await realpath(path)
          const current = await stat(checked)
          if (!info.isFile() || checked !== path || current.ino !== info.ino || current.dev !== info.dev || entry.owner !== activeOwner()) {
            return new Response(null, { status: 404 })
          }
          const html = entry.mime === 'text/html'
          const headers = new Headers({
            'Content-Type': html ? 'text/html; charset=utf-8' : entry.mime,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': html ? htmlPolicy : mediaPolicy
          })
          const requestedRange = request.headers.get('range')
          const range = requestedRange ? byteRange(requestedRange, info.size) : null
          if (requestedRange && !range) {
            headers.set('Content-Range', `bytes */${info.size}`)
            return new Response(null, { status: 416, headers })
          }
          if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`)
          headers.set('Content-Length', String(range ? range.end - range.start + 1 : info.size))
          const status = range ? 206 : 200
          if (request.method === 'HEAD' || !info.size) return new Response(null, { status, headers })
          const stream = file.createReadStream(range ?? {})
          const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>
          const response = new Response(body, { status, headers })
          streaming = true
          // The stream now owns the handle and closes it when consumed or cancelled.
          return response
        } finally {
          // A streaming handle must stay open until Electron finishes the response.
          if (!streaming) await file.close()
        }
      } catch {
        return new Response(null, { status: 404 })
      }
    })
  }
}
