import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {stripTypeScriptTypes} from 'node:module'
import {runInNewContext} from 'node:vm'
const source=await readFile(new URL('../extensions/computer-use/index.ts',import.meta.url),'utf8')
const start=source.indexOf('async function browserAction('),end=source.indexOf('\nfunction describeSnapshot(',start)
assert.ok(start>=0 && end>start)
let calls=0
const action=runInNewContext(`class BrowserBridgeUnavailableBeforeDispatch extends Error {}\nclass LegacyBrowserActionBeforeDispatch extends Error {}\n${stripTypeScriptTypes(source.slice(start,end))}\nbrowserAction`,{
 process:{env:{}},readBrowserBridge:async()=>null,chromeJS:async()=>{calls++;return {ok:true,title:'changed target'}}
})
await assert.rejects(action({candidateId:'b1',type:'click'}),/computer_use_session_open/i)
assert.equal(calls,0,'unbound legacy action must not dispatch AppleScript into an arbitrary current tab')
console.log('PASS standalone legacy action cannot dispatch unbound AppleScript')
