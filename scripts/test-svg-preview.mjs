import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderSvgPreview } from '../extensions/computer-use/src/artifact-preview.ts'
import { dangerousCommand } from '../extensions/computer-use/src/tool-guard.ts'

const dir = await mkdtemp(join(tmpdir(), 'pi-svg-test-'))
try {
  const path = join(dir, 'drawing.svg')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="red"/></svg>'
  await writeFile(path, svg)
  const before = await readdir(dir)
  const png = await renderSvgPreview(path, dir)
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(await readFile(path, 'utf8'), svg)
  assert.deepEqual(await readdir(dir), before, 'preview must not create or delete project files')
  await writeFile(path, `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="8" height="8" style="fill:url( '#g' )"/></svg>`)
  assert.ok((await renderSvgPreview(path, dir)).length > 8, 'internal gradient references remain supported')
  await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>')
  await assert.rejects(renderSvgPreview(path, dir), /external or active/)
  await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg"><!-- -- invalid --></svg>')
  await assert.rejects(renderSvgPreview(path, dir))
  assert.ok(dangerousCommand('rm old.png'))
  assert.ok(dangerousCommand('rm -f old.png'))
  assert.equal(dangerousCommand('echo rm is text'), null)
  console.log('PASS SVG rendering, original preservation, external resource rejection, malformed input and deletion guard')
} finally { await rm(dir, { recursive: true, force: true }) }
