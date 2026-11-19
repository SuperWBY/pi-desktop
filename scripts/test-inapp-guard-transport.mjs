import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'

const source=await readFile(new URL('../extensions/computer-use/index.ts',import.meta.url),'utf8')
const readStart=source.indexOf('async function readBrowserBridge('),readEnd=source.indexOf('\nasync function bridgeRequest<',readStart)
const paths=[];const scopedEnv={PI_DESKTOP_BROWSER_BRIDGE_FILE:'/private/instance/bridge.json'}
const readBridge=runInNewContext(`${stripTypeScriptTypes(source.slice(readStart,readEnd))}\nreadBrowserBridge`,{
  process:{env:scopedEnv},auditDir:'/legacy',join:(...parts)=>parts.join('/'),
  readFile:async(path)=>{paths.push(path);if(path==='/private/missing')throw Error('not found');return JSON.stringify({port:1234,token:'test'})}
})
assert.equal((await readBridge()).port,1234);assert.equal(paths.pop(),'/private/instance/bridge.json')
scopedEnv.PI_DESKTOP_BROWSER_BRIDGE_FILE='/private/missing'
assert.equal(await readBridge(),null,'a missing scoped bridge must not fall back to another instance')
assert.equal(paths.pop(),'/private/missing');assert.equal(paths.length,0)
delete scopedEnv.PI_DESKTOP_BROWSER_BRIDGE_FILE
assert.equal((await readBridge()).port,1234);assert.equal(paths.pop(),'/legacy/browser-bridge.json','standalone Pi retains legacy lookup')
// A desktop-scoped bridge that is unavailable must never route legacy actions
// into a different, user-owned Chrome window.
const legacyStart=source.indexOf('async function browserObserve('), legacyEnd=source.indexOf('\nasync function ',source.indexOf('async function browserAction(',legacyStart)+1)
let fallbackCalls=0
const legacy=runInNewContext(`class BrowserBridgeUnavailableBeforeDispatch extends Error {}\nclass LegacyBrowserActionBeforeDispatch extends Error {}\n${stripTypeScriptTypes(source.slice(legacyStart,legacyEnd))}\n({browserObserve,browserAction})`,{
  process:{env:{PI_DESKTOP_BROWSER_BRIDGE_FILE:'/missing'}},readBrowserBridge:async()=>null,
  chromeJS:async()=>{fallbackCalls++;return []},browserObserveCode:''
})
await assert.rejects(legacy.browserObserve(),/bridge.*not available/i)
await assert.rejects(legacy.browserAction({candidateId:'b1',type:'click'}),/bridge.*not available/i)
assert.equal(fallbackCalls,0,'missing desktop bridge must not fall back to Chrome')
const start=source.indexOf('async function bridgeRequest<')
const end=source.indexOf('async function chromeJS<',start)
assert.ok(start>=0 && end>start)
let reply={ok:false,error:'Target changed',code:'PI_GUARD_REJECTED',reason:'target_changed'}, httpOk=false
const bridgeRequest=runInNewContext(`${stripTypeScriptTypes(source.slice(start,end))}\nbridgeRequest`,{
  browserControllerId:'fixture', process:{pid:123}, readBrowserBridge:async()=>({port:1234,token:'test'}),
  fetch:async()=>({ok:httpOk,status:httpOk?200:400,json:async()=>reply}),AbortSignal
})
const action={snapshotId:'test-snapshot',expectedUrl:'https://example.test/',candidateId:'b1'}
const safe=await bridgeRequest('/act',action)
assert.equal(safe.result.__piGuardRejected,'target_changed')
reply={...reply,reason:'view_hidden'}
assert.equal((await bridgeRequest('/act',action)).result.__piGuardRejected,'view_hidden')
reply={...reply,reason:'target_changed'}
for(const invalid of [
  {path:'/act',body:{candidateId:'b1'},response:{...reply}},
  {path:'/other',body:action,response:{...reply}},
  {path:'/act',body:action,response:{...reply,reason:'unexpected'}},
  {path:'/act',body:action,response:{...reply,code:'OTHER'}}
]) {
  reply=invalid.response
  await assert.rejects(bridgeRequest(invalid.path,invalid.body),/Target changed/)
}
httpOk=true;reply={ok:true,result:{ok:true}}
assert.equal((await bridgeRequest('/act',action)).result.ok,true)
console.log('PASS in-app transport: only scoped guard responses get structured recovery')
