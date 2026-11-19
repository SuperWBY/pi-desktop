import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureDesktopPermissions } from '../extensions/computer-use/src/desktop-permissions.ts'

const source = await readFile(new URL('../extensions/computer-use/index.ts', import.meta.url), 'utf8')
const permission = source.slice(source.indexOf('async function requireDesktopPermissions'), source.indexOf('function actionsFor'))
const start = source.indexOf("  pi.registerTool({\n    name: 'computer_use_observe'")
const end = source.indexOf("  pi.registerTool({\n    name: 'computer_use_act'", start)
const registration = source.slice(start, end)
let granted = false
let cleaned = 0, failObserve = false
const events = []
const tools = new Map()
const Type = new Proxy({}, { get: () => (...args) => ({ args }) })
const runHelper = async (args) => {
  events.push(args[0])
  if (args[0] === 'check') return { accessibility:granted, screenRecording:true }
  if (args[0] === 'observe') { if (failObserve) throw Error('observation failed'); return { snapshot:{ app:'Fixture', elements:[] } } }
  return { ok:true }
}
runInNewContext(`${stripTypeScriptTypes(permission + '\n' + registration)}`, {
  ensureDesktopPermissions, assertDesktopUseEnabled:()=>{}, Type, pi:{ registerTool:(tool)=>tools.set(tool.name,tool) },
  process:{platform:'darwin'}, runHelper, execFileAsync:async(_cmd,args)=>{events.push('open-settings');assert.ok(args[0].includes('Privacy_Accessibility'));granted=true},
  join, tmpdir, mkdtemp:async()=>'/tmp/pi-test', rm:async()=>{cleaned++}, randomUUID:()=> 'test-id', desktopActionInProgress:false, desktopActionVersion:0, snapshots:new Map(), compileCandidates:()=>[], describeSnapshot:()=> 'observed', screenshotContent:async()=>[]
})
const observe = tools.get('computer_use_observe')
const ctx = { hasUI:true, ui:{ select:async()=> 'Open Accessibility Settings' } }
const result = await observe.execute('test', {includeScreenshot:false}, undefined, undefined, ctx)
assert.equal(result.content[0].text, 'observed')
assert.equal(cleaned, 1, 'temporary screenshot is removed even when image is omitted')
assert.deepEqual(events, ['check','open-settings','check','observe'])
events.length=0
failObserve=true
await assert.rejects(observe.execute('test', {includeScreenshot:false}, undefined, undefined, ctx), /observation failed/)
assert.equal(cleaned, 2, 'temporary screenshot is removed when observation fails')
failObserve=false
events.length = 0
granted = false
await assert.rejects(observe.execute('test', {includeScreenshot:false}, undefined, undefined, {hasUI:true,ui:{select:async()=>undefined}}), /cancel/i)
assert.deepEqual(events, ['check'], 'cancelling permission setup must prevent desktop observation')
console.log('PASS desktop permission integration: observe prompts before capture and resumes only after permission')
