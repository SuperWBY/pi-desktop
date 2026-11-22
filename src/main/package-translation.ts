import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Node, Parent } from 'unist'
import type { PackageTranslationRequest, PackageTranslationResult } from '@shared/types'

type Piece = { value: string; start: number; end: number }
export function translationPieces(text: string, markdown: boolean): Piece[] {
  if (!markdown) return text.trim() ? [{ value: text, start: 0, end: text.length }] : []
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text)
  const pieces: Piece[] = []
  const visit = (node: Node): void => {
    if (node.type === 'link' && 'url' in node && typeof node.url === 'string') {
      const children = 'children' in node && Array.isArray(node.children) ? node.children as Node[] : []
      const label = children.map((child) => 'value' in child ? child.value : '').join('')
      if (label === node.url || label === node.url.replace(/^(?:mailto:|https?:\/\/)/, '')) return
    }
    if (node.type === 'text' && 'value' in node && typeof node.value === 'string' && node.value.trim() && !/^https?:\/\/\S+$/.test(node.value)) {
      const start = node.position?.start.offset, end = node.position?.end.offset
      if (start !== undefined && end !== undefined) pieces.push({ value: node.value, start, end })
    }
    if ('children' in node) (node as Parent).children.forEach(visit)
  }
  visit(tree)
  return pieces
}
function needsTranslation(text: string, language: 'zh-CN' | 'en'): boolean {
  return language === 'en' ? /\p{Script=Han}/u.test(text) : /[A-Za-z]{3,}/.test(text)
}
function markdownText(text: string): string { return text.replace(/\r/g, '').replace(/\n\s*\n/g, '\n').replace(/([\\`*_[\]<>|])/g, '\\$1') }

/** Public package text only; tools are disabled in the injected model runner. */
export function createPackageTranslator(root: string, run: (texts: string[], language: 'zh-CN' | 'en') => Promise<string[]>): (input: PackageTranslationRequest, onProgress?: (progress: { text: string; completed: number; total: number }) => void) => Promise<PackageTranslationResult> {
  const memory = new Map<string, string>()
  type Progress = { text: string; completed: number; total: number }
  type Pending = { task: Promise<PackageTranslationResult>; listeners: Set<(progress: Progress) => void> }
  const pending = new Map<string, Pending>()
  const waiting: Array<{ priority: boolean; start: () => void }> = []
  let active = 0
  let backgroundActive = 0
  const drain = (): void => {
    while (active < 2) {
      const index = waiting.findIndex((job) => job.priority || backgroundActive === 0)
      if (index < 0) return
      const [{ priority, start }] = waiting.splice(index, 1)
      active++
      if (!priority) backgroundActive++
      start()
    }
  }
  const schedule = <T>(priority: boolean, work: () => Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const start = (): void => { void Promise.resolve().then(work).then(resolve, reject).finally(() => { active--; if (!priority) backgroundActive--; drain() }) }
    const job = { priority, start }
    if (priority) {
      const index = waiting.findIndex((item) => !item.priority)
      waiting.splice(index < 0 ? waiting.length : index, 0, job)
    } else waiting.push(job)
    drain()
  })
  const key = (text: string, input: PackageTranslationRequest): string => createHash('sha256').update(JSON.stringify([2, input.language, Boolean(input.markdown), text])).digest('hex')
  const cached = async (hash: string): Promise<string | undefined> => {
    if (memory.has(hash)) return memory.get(hash)
    try {
      const file = join(root, `${hash}.json`)
      if ((await stat(file)).size > 2 * 1024 * 1024) return undefined
      const value = JSON.parse(await readFile(file, 'utf8'))
      if (typeof value.text === 'string') { memory.set(hash, value.text); return value.text }
    } catch { /* No translation yet. */ }
    return undefined
  }
  const remember = async (hash: string, text: string): Promise<void> => {
    if (memory.size >= 128) memory.delete(memory.keys().next().value!)
    memory.set(hash, text)
    try {
      await mkdir(root, { recursive: true })
      await writeFile(join(root, `${hash}.json`), JSON.stringify({ text }), { mode: 0o600 })
      const files = (await readdir(root)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      if (files.length > 128) {
        const ranked = await Promise.all(files.map(async (name) => ({ name, time: (await stat(join(root, name))).mtimeMs })))
        await Promise.all(ranked.sort((a, b) => a.time - b.time).slice(0, files.length - 128).map(({ name }) => unlink(join(root, name))))
      }
    } catch { /* Translation remains usable when the disk cache is unavailable. */ }
  }
  const translate = async (input: PackageTranslationRequest, progress: (value: Progress) => void): Promise<PackageTranslationResult> => {
    try {
      const result: string[] = []
      const missing: Array<{ text: string; indices: number[]; hash: string; pieces: Piece[]; translated: string[] }> = []
      for (const [index, text] of input.texts.entries()) {
        const hash = key(text, input)
        const found = await cached(hash)
        if (found !== undefined) { result[index] = found; continue }
        const pieces = translationPieces(text, Boolean(input.markdown)).filter((piece) => needsTranslation(piece.value, input.language))
        if (!pieces.length) { result[index] = text; continue }
        const duplicate = missing.find((item) => item.hash === hash)
        if (duplicate) { duplicate.indices.push(index); continue }
        missing.push({ text, indices: [index], hash, pieces, translated: [] })
      }
      const work = missing.flatMap((item) => item.pieces.map((piece, index) => ({ item, piece, index })))
      const batches: Array<typeof work> = []
      for (let at = 0; at < work.length;) {
        const batch: typeof work = []
        let size = 0
        const firstReadmeBatch = Boolean(input.markdown && batches.length === 0)
        const sizeLimit = firstReadmeBatch ? 1000 : 7000
        const countLimit = firstReadmeBatch ? 8 : 48
        while (at < work.length && (size < sizeLimit || !batch.length) && batch.length < countLimit) {
          const value = work[at++]
          batch.push(value); size += value.piece.value.length
        }
        batches.push(batch)
      }
      let completed = 0
      let failed = false
      const render = (item: typeof missing[number]): string => {
        let value = item.text
        for (let i = item.pieces.length - 1; i >= 0; i--) {
          const piece = item.pieces[i], translated = item.translated[i]
          if (translated !== undefined) value = value.slice(0, piece.start) + (input.markdown ? markdownText(translated) : translated) + value.slice(piece.end)
        }
        return value
      }
      const outcomes = await Promise.allSettled(batches.map((batch) => schedule(Boolean(input.markdown), async () => {
        if (failed) return
        try {
          const translated = await run(batch.map(({ piece }) => piece.value), input.language)
          if (translated.length !== batch.length || translated.some((value) => typeof value !== 'string' || !value.trim() || value.length > 100_000)) throw new Error('Invalid translation')
          batch.forEach(({ item, index }, position) => { item.translated[index] = translated[position] })
          completed += batch.length
          if (input.markdown && missing.length === 1 && !failed) progress({ text: render(missing[0]), completed, total: work.length })
        } catch (error) { failed = true; throw error }
      })))
      if (outcomes.some((outcome) => outcome.status === 'rejected') || failed) throw new Error('Translation failed')
      for (const item of missing) {
        let value = item.text
        for (let i = item.pieces.length - 1; i >= 0; i--) {
          const piece = item.pieces[i]
          value = value.slice(0, piece.start) + (input.markdown ? markdownText(item.translated[i]) : item.translated[i]) + value.slice(piece.end)
        }
        item.indices.forEach((index) => { result[index] = value })
        await remember(item.hash, value)
      }
      return { ok: true, texts: result }
    } catch { return { ok: false, error: 'model' } }
  }
  return async (input, onProgress?: (progress: Progress) => void) => {
    if (!input || !['zh-CN', 'en'].includes(input.language) || !Array.isArray(input.texts) || input.texts.length > 128 || input.texts.some((text) => typeof text !== 'string') || input.texts.reduce((sum, text) => sum + text.length, 0) > 200_000) return { ok: false, error: 'too-large' }
    const identity = createHash('sha256').update(JSON.stringify([input.language, Boolean(input.markdown), input.texts])).digest('hex')
    // A cached translation must not wait behind an unrelated model request.
    const stored = await Promise.all(input.texts.map((text) => cached(key(text, input))))
    if (stored.every((text) => text !== undefined)) return { ok: true, texts: stored as string[] }
    const existing = pending.get(identity)
    if (existing) {
      if (onProgress) existing.listeners.add(onProgress)
      try { return await existing.task } finally { if (onProgress) existing.listeners.delete(onProgress) }
    }
    const listeners = new Set(onProgress ? [onProgress] : [])
    const task = translate(input, (value) => { for (const listener of listeners) { try { listener(value) } catch { /* A closed view must not interrupt translation. */ } } })
    pending.set(identity, { task, listeners })
    try { return await task } finally { pending.delete(identity) }
  }
}
