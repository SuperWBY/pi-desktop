import assert from 'node:assert/strict'
import { mkdtemp, rm, access } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Module from 'node:module'
import { stripTypeScriptTypes } from 'node:module'

const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'pi-bridge-lifecycle-'))
let releaseMkdir, enteredMkdir, failMkdir = false
const gate = new Promise(resolve => { releaseMkdir = resolve })
const entered = new Promise(resolve => { enteredMkdir = resolve })
const fsMock = { ...fs, async mkdir(...args) { enteredMkdir(); await gate; if (failMkdir) throw new Error("injected mkdir failure"); return fs.mkdir(...args) } }
const fakeBrowser = { browserState: () => ({}), browserDownloads: () => ({}), browserDomAct: async () => ({}), browserDomObserve: async () => ({}), browserDomReadText: async () => ({}), browserNavigate: () => ({}) }
const source = readFileSync(join(root, 'src/main/browser-bridge.ts'), 'utf8')
const code = stripTypeScriptTypes(source, { mode: 'strip' })
  .replace(/import \{([^}]+)\} from '([^']+)'/g, (_, names, path) => `const {${names}} = require('${path}')`)
  .replace(/export async function /g, 'async function ')
  .replace(/export function /g, 'function ') + '\nmodule.exports = { startBrowserBridge, stopBrowserBridge, browserBridgePath };'
const mod = new Module(join(root, 'src/main/bridge-test.cjs'))
mod.filename = join(root, 'src/main/bridge-test.cjs')
mod.paths = Module._nodeModulePaths(join(root, 'src/main'))
const originalRequire = mod.require.bind(mod)
mod.require = id => id === 'electron' ? { app: { getPath: () => dir } } : id === './browser' ? { taskPage: () => fakeBrowser } : id === 'node:fs/promises' ? fsMock : originalRequire(id)
mod._compile(code, mod.filename)
const bridge = mod.exports
let first
try {
  first = bridge.startBrowserBridge()
  await entered
  let secondResolved = false
  const second = bridge.startBrowserBridge().then(() => { secondResolved = true })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(secondResolved, false, 'concurrent start must wait for the bridge file to be published')
  const stopped = bridge.stopBrowserBridge()
  releaseMkdir()
  await Promise.all([first, second, stopped])
  await assert.rejects(access(bridge.browserBridgePath()), { code: 'ENOENT' }, 'shutdown during startup must remove the bridge file')
  failMkdir = true
  await assert.rejects(bridge.startBrowserBridge(), /injected mkdir failure/)
  failMkdir = false
  await bridge.startBrowserBridge()
  const data = JSON.parse(await fs.readFile(bridge.browserBridgePath(), 'utf8'))
  const response = await fetch(`http://127.0.0.1:${data.port}/state`, { headers: { authorization: `Bearer ${data.token}` } })
  assert.equal(response.status, 200, 'a failed startup must allow a later successful retry')
  await bridge.stopBrowserBridge()
  console.log('PASS bridge startup, shutdown, and failure retry')
} finally {
  releaseMkdir()
  await first?.catch(() => {})
  await bridge.stopBrowserBridge().catch(() => {})
  await rm(dir, { recursive: true, force: true })
}
