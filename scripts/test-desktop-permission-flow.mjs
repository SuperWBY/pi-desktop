import assert from 'node:assert/strict'
import { ensureDesktopPermissions } from '../extensions/computer-use/src/desktop-permissions.ts'

let granted = false
let prompts = 0
const calls = []
const ui = { select: async (_title, options) => {
  prompts++
  assert.ok(options.includes('Open Accessibility Settings'))
  return prompts === 1 ? 'Open Accessibility Settings' : 'Check Again'
} }
await ensureDesktopPermissions({ hasUI:true, ui }, {
  check: async () => ({ accessibility:granted, screenRecording:true }),
  request: async (kind) => { calls.push(kind) },
  openSettings: async (kind) => { calls.push(`settings:${kind}`); granted = true }
})
assert.deepEqual(calls, ['settings:accessibility'])
assert.equal(prompts, 1, 'after returning from settings, recheck and continue if granted')
let screenGranted = false
const screenCalls = []
await ensureDesktopPermissions({hasUI:true,ui:{select:async(_title,options)=>{ assert.ok(options.includes('Open Screen Recording Settings')); return 'Open Screen Recording Settings' }}}, {
  check:async()=>({accessibility:true,screenRecording:screenGranted}),
  request:async(kind)=>{screenCalls.push(kind)},
  openSettings:async(kind)=>{screenCalls.push(`settings:${kind}`);screenGranted=true}
})
assert.deepEqual(screenCalls,['settings:screen'])
await assert.rejects(ensureDesktopPermissions({hasUI:false,ui}, {check:async()=>({accessibility:false,screenRecording:true}),request:async()=>{},openSettings:async()=>{}}), /permission/i)
await assert.rejects(ensureDesktopPermissions({hasUI:true,ui:{select:async()=>undefined}}, {check:async()=>({accessibility:false,screenRecording:true}),request:async()=>{},openSettings:async()=>{}}), /cancel/i)
let requested = false
await assert.rejects(ensureDesktopPermissions({hasUI:true,ui:{select:async()=> 'Cancel'}}, {check:async()=>({accessibility:true,screenRecording:false}),request:async()=>{requested=true},openSettings:async()=>{}}), /cancel/i)
assert.equal(requested, false, 'cancelling must not request permissions')
console.log('PASS desktop permissions: check, user-directed settings, resume, cancellation and headless failure')
