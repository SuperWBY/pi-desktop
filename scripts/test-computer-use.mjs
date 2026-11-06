#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const helper = join(root, 'extensions', 'computer-use', 'bin', 'computer-use-helper')
if (!existsSync(helper)) {
  console.error(`Missing helper: ${helper}`)
  process.exit(1)
}

function run(args) {
  const stdout = execFileSync(helper, args, { encoding: 'utf8', timeout: 20_000 })
  return JSON.parse(stdout)
}

function imageSize(path) {
  const output = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], {
    encoding: 'utf8'
  })
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1])
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1])
  return { width, height }
}

const dir = mkdtempSync(join(tmpdir(), 'pi-cua-test-'))
const screenshot = join(dir, 'window.png')
let created = false

try {
  const check = run(['check'])
  assert.equal(check.ok, true)
  assert.equal(check.accessibility, true, 'Accessibility permission is required')
  assert.equal(check.screenRecording, true, 'Screen Recording permission is required')

  const debug = run(['ax-debug', '--app', 'TextEdit'])
  assert.equal(debug.ok, true)
  assert.ok(debug.debug, 'ax-debug should return diagnostics')

  if (process.platform === 'darwin') {
    const createdName = execFileSync(
      'osascript',
      ['-e', 'tell application "TextEdit" to activate', '-e', 'tell application "TextEdit" to make new document'],
      { encoding: 'utf8', timeout: 10_000 }
    ).trim()
    created = true
    assert.ok(createdName.length > 0)
  }

  const observed = run(['observe', '--app', 'TextEdit', '--screenshot', screenshot])
  assert.equal(observed.ok, true)
  const snapshot = observed.snapshot
  assert.ok(snapshot.elements.length > 0, 'TextEdit should expose at least one accessible element')
  assert.ok(['region', 'window'].includes(snapshot.captureMode), `Unexpected capture mode: ${snapshot.captureMode}`)
  assert.ok(snapshot.windowBounds, 'Observation should return window bounds')

  const ocr = run(['ocr', '--image', screenshot])
  assert.ok(Array.isArray(ocr.lines), 'OCR should return a line array')

  const size = imageSize(screenshot)
  assert.ok(Math.abs(size.width - snapshot.windowBounds.width) <= 2, 'Screenshot width should match window bounds')
  assert.ok(Math.abs(size.height - snapshot.windowBounds.height) <= 2, 'Screenshot height should match window bounds')

  console.log(`PASS computer-use observation: ${snapshot.elements.length} elements, ${ocr.lines.length} OCR lines, ${snapshot.captureMode} ${size.width}x${size.height}`)
} finally {
  if (created) {
    spawnSync('osascript', ['-e', 'tell application "TextEdit" to close front window saving no'], {
      encoding: 'utf8',
      timeout: 10_000
    })
  }
  rmSync(dir, { recursive: true, force: true })
}
