import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CreatorWorkspace } from '../extensions/creator/workspace.ts'
import { listCreatedPlugins } from '../src/main/creator.ts'
const root = mkdtempSync(join(tmpdir(), 'pi-my-plugins-'))
let checks = 0
async function test(name, run) { await run(); console.log('✓ ' + name); checks++ }
try {
 const first = join(root, 'first'), second = join(root, 'second'), empty = join(root, 'empty')
 for (const path of [first, second, empty]) mkdirSync(path)
 const a = new CreatorWorkspace(first).create('mode', 'own-mode')
 const b = new CreatorWorkspace(second).create('context', 'own-context')
 await test('Lists real authored plugins across known projects without duplication', async () => {
  const result = await listCreatedPlugins([first, second, first, empty])
  assert.equal(result.plugins.length, 2); assert.equal(result.warnings.length, 0)
  assert.ok(result.plugins.some(p => p.workspace === realpathSync(first) && p.id === a.id))
  assert.ok(result.plugins.some(p => p.workspace === realpathSync(second) && p.id === b.id))
 })
 await test('Does not execute plugin source while browsing the library', async () => {
  writeFileSync(join(a.path, 'extension.ts'), 'throw new Error("must not execute during listing")')
  const result = await listCreatedPlugins([first]); assert.equal(result.plugins.length, 1); assert.equal(result.plugins[0].status, 'draft')
 })
 await test('Rejects symbolic creator directories and preserves readable projects with a warning', async () => {
  mkdirSync(join(empty, '.pi')); symlinkSync(join(first, '.pi', 'creator'), join(empty, '.pi', 'creator'))
  const result = await listCreatedPlugins([empty, second]); assert.equal(result.plugins.length, 1); assert.equal(result.warnings.length, 1)
  assert.equal(result.warnings[0].workspace, empty)
 })
 await test('Recomputes verification after edits instead of serving a stale status', async () => {
  const local = new CreatorWorkspace(second); local.check(b.id)
  assert.equal((await listCreatedPlugins([second])).plugins[0].status, 'checked')
  writeFileSync(join(b.path, 'extra.txt'), 'edited')
  assert.equal((await listCreatedPlugins([second])).plugins[0].status, 'draft')
 })
 console.log(`${checks} authored plugin checks passed`)
} finally { rmSync(root, { recursive: true, force: true }) }
