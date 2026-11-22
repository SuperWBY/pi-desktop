import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const MAX_SVG_BYTES = 4 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const PREVIEW_SIZE = 1600
const RENDER_TIMEOUT_MS = 20_000

/** Render only self-contained SVGs; previews never write next to the user's file. */
export async function renderSvgPreview(path: string, cwd: string, signal?: AbortSignal): Promise<Buffer> {
  if (process.platform !== 'darwin') throw new Error('SVG preview is currently available on macOS only.')
  const source = resolve(cwd, path)
  if (extname(source).toLowerCase() !== '.svg') throw new Error('Choose a local SVG file.')
  const info = await stat(source)
  if (!info.isFile() || info.size > MAX_SVG_BYTES) throw new Error('SVG file is missing or too large to preview.')
  const svg = await readFile(source, 'utf8')
  const links = [...svg.matchAll(/\b(?:href|src)\s*=\s*(['"])(.*?)\1/gi)].map(match => match[2].trim())
  const cssUrls = [...svg.matchAll(/url\(\s*([^)]*)\)/gi)].map(match => match[1].trim().replace(/^(['"])(.*)\1$/, '$2').trim())
  if (/<!DOCTYPE|<!ENTITY|<\s*script\b|@import\b|\bon[a-z]+\s*=/i.test(svg) ||
      links.some(value => !value.startsWith('#')) || cssUrls.some(value => !value.startsWith('#'))) {
    throw new Error('SVG has external or active content; preview only supports self-contained SVG files.')
  }
  const dir = await mkdtemp(join(tmpdir(), 'pi-svg-preview-'))
  try {
    const input = join(dir, 'input.svg'), output = join(dir, 'preview.png')
    await writeFile(input, svg, { mode: 0o600, flag: 'wx' })
    await run(process.env.PI_DESKTOP_SIPS_PATH || '/usr/bin/sips', ['-s', 'format', 'png', '-Z', String(PREVIEW_SIZE), input, '--out', output], { timeout: RENDER_TIMEOUT_MS, signal, maxBuffer: 1024 * 1024 })
    const result = await stat(output)
    if (!result.isFile() || result.size === 0 || result.size > MAX_IMAGE_BYTES) throw new Error('Rendered image is empty or too large.')
    return await readFile(output)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

