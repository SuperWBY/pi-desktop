import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, readdirSync, statSync, writeFileSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-runtime-selection-')))
const cli = directory => join(directory, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')
const write = (file, content = '// fixture cli\n'.repeat(12)) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); return file }
const seed = join(root, 'seed', '9.9.9', 'pi'); write(seed); write(cli(dirname(seed)))
const source = stripTypeScriptTypes(readFileSync(resolve('src/main/pi-exec.ts'), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const api = runInNewContext(source + '\n;({ resolvePiCliJs, directPiSpawn })', {
 execFile, promisify, existsSync, readFileSync, readdirSync, realpathSync, statSync, dirname, join,
 homedir: () => root, seedPiPath: () => seed, seedRoot: () => join(root, 'seed'), locatePi: () => seed, augmentedPath: () => '',
 process: { platform: 'darwin', execPath: '/fixture/electron', env: {} }
})
let checks = 0
function test(name, run) { run(); checks++; console.log('✓ ' + name) }
try {
 test('An explicit JavaScript runtime is not replaced by the bundled Pi', () => {
  const selected = write(join(root, 'custom', 'agent.mjs'))
  assert.equal(api.resolvePiCliJs(selected), realpathSync(selected))
  const args = ['--mode', 'rpc', '--session', 'spaces and $(literal); session.jsonl']
  const direct = api.directPiSpawn(selected, args)
  assert.equal(direct.executable, '/fixture/electron'); assert.deepEqual(Array.from(direct.args), [realpathSync(selected), ...args])
 })
 test('A custom native or shell launcher remains selected', () => {
  const selected = write(join(root, 'custom', 'pi'), '#!/bin/sh\nexit 0\n')
  assert.equal(api.resolvePiCliJs(selected), null)
  assert.equal(api.directPiSpawn(selected, ['--version']).executable, selected)
 })
 test('Official managed installs follow current-version rather than newest bundled version', () => {
  const selected = write(join(root, 'managed', 'bin', 'pi'))
  write(join(root, 'managed', 'install', 'current-version'), '1.0.0\n')
  const active = write(cli(join(root, 'managed', 'install', 'releases', '1.0.0')))
  write(cli(join(root, 'managed', 'install', 'releases', '2.0.0')))
  assert.equal(api.resolvePiCliJs(selected), active)
 })
 test('npm CLI symbolic links resolve to their actual JavaScript entry', () => {
  const selected = write(join(root, 'npm', 'cli.js')), link = join(root, 'npm', 'pi')
  symlinkSync(selected, link); assert.equal(api.resolvePiCliJs(link), realpathSync(selected))
 })
 test('An invalid selected path or managed version cannot silently fall back to the seed', () => {
  assert.equal(api.resolvePiCliJs(join(root, 'absent-pi')), null)
  const selected = write(join(root, 'bad', 'bin', 'pi'))
  write(join(root, 'bad', 'install', 'current-version'), '../../outside')
  assert.equal(api.resolvePiCliJs(selected), null)
 })
 test('Automatic runtime discovery still uses a valid bundled seed', () => assert.equal(api.resolvePiCliJs(), cli(dirname(seed))))
 console.log(`${checks} runtime selection checks passed`)
} finally { rmSync(root, { recursive: true, force: true }) }
