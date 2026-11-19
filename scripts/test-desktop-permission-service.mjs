import assert from 'node:assert/strict'
import { createDesktopPermissionService } from '../src/main/desktop-permission-service.ts'
let accessibility = false
const calls = []
const service = createDesktopPermissionService({
  run:async (command)=>{ calls.push(command); return { accessibility, screenRecording:true } },
  open:async (kind)=>{calls.push(`open:${kind}`)}
})
assert.deepEqual(await service.check(), {accessibility:false,screenRecording:true})
await service.request('accessibility')
assert.deepEqual(calls, ['check','check','open:accessibility','check'])
accessibility = true
calls.length = 0
await service.request('accessibility')
assert.deepEqual(calls, ['check'], 'already granted access does not open settings')
await assert.rejects(service.request('other'), /invalid/i)
console.log('PASS settings permission service: explicit requests, status and fixed settings destinations')
