import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const dir = await mkdtemp(join(tmpdir(), 'pi-preview-sandbox-'))
try {
  const settings = join(dir, 'settings.json')
  await writeFile(settings, JSON.stringify({ filesystem: { denyRead: [], allowRead: ['/'], allowWrite: [tmpdir()], denyWrite: [] }, network: { allowedDomains: [], deniedDomains: [], allowLocalBinding: true } }))
  const result = spawnSync(process.execPath, [resolve('build/srt-cli.cjs'), '--settings', settings, '/usr/bin/env', process.execPath, '--experimental-strip-types', resolve('scripts/test-svg-preview.mjs')], { encoding: 'utf8', timeout: 30000 })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.error || result.status !== 0) throw result.error || new Error(`Sandbox preview test failed: ${result.status}`)
} finally { await rm(dir, { recursive: true, force: true }) }
