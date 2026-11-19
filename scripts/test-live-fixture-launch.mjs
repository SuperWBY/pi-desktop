#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
if (process.platform !== 'darwin') { console.log('SKIP native macOS fixture launch'); process.exit(0) }
const root = resolve(import.meta.dirname, '..')
const fixture = JSON.parse(execFileSync(process.execPath, ['scripts/prepare-computer-use-live-fixture.mjs'], { cwd: root, encoding: 'utf8' }))
let child
try {
  child = spawn(`${fixture.fixture}/Contents/MacOS/Pi CU Fixture`, [], { stdio: 'ignore' })
  await new Promise(resolve => setTimeout(resolve, 1200))
  assert.equal(child.exitCode, null, 'fixture should stay running without command-line arguments')
  assert.equal(child.signalCode, null, 'fixture should not crash without command-line arguments')
  console.log('PASS native fixture starts without command-line arguments')
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await new Promise(resolve => child.once('exit', resolve))
  }
  await rm(fixture.workspace, { recursive: true, force: true })
}
