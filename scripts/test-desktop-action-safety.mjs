import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserActionJournal } from '../extensions/computer-use/src/browser-action-journal.ts'
import { DesktopGuardRejected } from '../extensions/computer-use/src/guarded-helper.ts'

const source = await readFile(new URL('../extensions/computer-use/index.ts', import.meta.url), 'utf8')
const start = source.indexOf("  pi.registerTool({\n    name: 'computer_use_act'")
const end = source.indexOf("  pi.registerTool({\n    name: 'computer_use_browser_observe'", start)
const tools = new Map(), snapshots = new Map()
const Type = new Proxy({}, {get: () => (...args) => ({args})})
let finish, calls = 0
const doAction = () => { calls++; return new Promise((resolve, reject) => { finish = {resolve,reject} }) }
const gate=source.slice(source.indexOf('let desktopActionInProgress'),source.indexOf('const auditDir'))
const temp=mkdtempSync(join(tmpdir(),'pi-desktop-guard-')), journal=new BrowserActionJournal(join(temp,'journal.sqlite'))
const claimDurableDesktopAction=()=>journal.claim('desktop'), getDesktopJournal=()=>journal
runInNewContext(stripTypeScriptTypes(gate+'\n'+source.slice(start,end)), {pi:{registerTool:t=>tools.set(t.name,t)},Type,snapshots,assertDesktopUseEnabled:()=>{},requireDesktopPermissions:async()=>{},approvalMode:'never',doAction,audit:async()=>{},verify:async()=>({}),claimDurableDesktopAction,getDesktopJournal,DesktopGuardRejected})
const ctx={ui:{confirm:async()=>true}}
const act=tools.get('computer_use_act'), batch=tools.get('computer_use_batch')
snapshots.set('rejected',{snapshot:{app:'Fixture'},stale:false})
const rejection=act.execute('rejected',{snapshotId:'rejected',type:'click'},null,null,ctx)
await new Promise(resolve=>setImmediate(resolve))
finish.reject(new DesktopGuardRejected('window_changed'))
const rejected=await rejection
assert.equal(rejected.details.rejected,true,'pre-action rejection should be actionable, not unknown')
assert.equal(journal.pending('desktop'),null,'safe rejection must release the pending record')
calls=0
snapshots.set('one',{snapshot:{app:'Fixture'},stale:false})
snapshots.set('other',{snapshot:{app:'Fixture'},stale:false})
const first=act.execute('1',{snapshotId:'one',type:'click'},null,null,ctx)
await new Promise(resolve=>setImmediate(resolve))
await assert.rejects(Promise.race([act.execute('2',{snapshotId:'one',type:'click'},null,null,ctx),new Promise((_,reject)=>setTimeout(()=>reject(Error('concurrent action started')),100))]),/stale|in progress/i)
assert.equal(calls,1,'a concurrent call must not repeat an action')
await assert.rejects(act.execute('different',{snapshotId:'other',type:'click'},null,null,ctx),/stale|in progress/i)
finish.reject(new Error('unknown action outcome'))
await assert.rejects(first,/result is unknown/i)
await assert.rejects(act.execute('3',{snapshotId:'one',type:'click'},null,null,ctx),/stale/i)
await assert.rejects(act.execute('old',{snapshotId:'other',type:'click'},null,null,ctx),/stale/i)
snapshots.set('two',{snapshot:{app:'Fixture'},stale:false})
await assert.rejects(batch.execute('blocked',{snapshotId:'two',actions:[{type:'click'}]},null,null,ctx),/pending/i)
assert.equal(calls,1,'a fresh observation cannot bypass an unresolved desktop action')
let warning=''
const denied=await tools.get('computer_use_desktop_reconcile').execute('deny',{},null,null,{ui:{confirm:async(_title,message)=>{warning=message;return false}}})
assert.equal(denied.details.pending,true)
assert.match(warning,/辅助进程也可能仍在运行/)
await tools.get('computer_use_desktop_reconcile').execute('clear',{},null,null,ctx)
snapshots.set('two',{snapshot:{app:'Fixture'},stale:false})
const pending=batch.execute('4',{snapshotId:'two',actions:[{type:'click'}]},null,null,ctx)
await new Promise(resolve=>setImmediate(resolve))
await assert.rejects(act.execute('5',{snapshotId:'two',type:'click'},null,null,ctx),/stale|in progress/i)
finish.resolve('done'); const completedBatch=await pending
assert.match(completedBatch.content[0].text,/observation unavailable/i,'an acknowledged action without a follow-up read must not look verified')
assert.equal(journal.pending('desktop'),null,'successful batch must release its durable record')
snapshots.set('single-unverified',{snapshot:{app:'Fixture'},stale:false})
const single=act.execute('single-unverified',{snapshotId:'single-unverified',type:'click'},null,null,ctx)
await new Promise(resolve=>setImmediate(resolve))
finish.resolve('done'); const completedSingle=await single
assert.match(completedSingle.content[0].text,/observation unavailable/i)
assert.match(completedSingle.content[0].text,/do not repeat/i)
snapshots.set('batch-fail',{snapshot:{app:'Fixture'},stale:false})
const failingBatch=batch.execute('batch-fail',{snapshotId:'batch-fail',actions:[{type:'click'}]},null,null,ctx)
await new Promise(resolve=>setImmediate(resolve))
finish.reject(new Error('helper disconnected'))
await assert.rejects(failingBatch,/result is unknown/i)
assert.ok(journal.pending('desktop'),'failed batch must retain its record')
await tools.get('computer_use_desktop_reconcile').execute('clear-batch',{},null,null,ctx)
snapshots.set('partial-batch',{snapshot:{app:'Fixture'},stale:false})
const partial=batch.execute('partial-batch',{snapshotId:'partial-batch',actions:[{type:'click'},{type:'click'}]},null,null,ctx)
await new Promise(resolve=>setImmediate(resolve)); finish.resolve('first done')
await new Promise(resolve=>setImmediate(resolve)); finish.reject(new DesktopGuardRejected('target_obscured'))
await assert.rejects(partial,/result is unknown after 1\/2/i)
assert.ok(journal.pending('desktop'),'a partial batch must retain its record even if a later step was rejected')
await tools.get('computer_use_desktop_reconcile').execute('clear-partial',{},null,null,ctx)
const body=source.slice(source.indexOf('async function doAction('),source.indexOf('export default function computerUse('))
let helperCalls=[]
const action=runInNewContext(`${stripTypeScriptTypes(body)}\ndoAction`,{isWindows:false,findElement:()=>({id:'e1',role:'AXButton',enabled:true,secure:false,bounds:{x:1,y:1,width:10,height:10}}),point:()=>({x:5,y:5}),runHelper:async(args)=>{helperCalls.push(args);throw Error('timed out')},setTimeout})
await assert.rejects(action({type:'click',elementId:'e1'},{snapshot:{app:'Fixture'}}),/timed out/)
assert.deepEqual(helperCalls.map(args=>args[0]),['ax-action'],'uncertain AX result must never trigger a second click')
const expected=JSON.parse(helperCalls[0][helperCalls[0].indexOf('--expected')+1])
assert.equal(expected.role,'AXButton'); assert.equal(expected.enabled,true); assert.equal(expected.windowId,null); assert.equal(expected.identifier,null)
const approvalTools=new Map(), approvalSnapshots=new Map([['a',{snapshot:{app:'Test App',windowTitle:'Test Window',elements:[{id:'e1',role:'AXButton',title:'Save'}]},stale:false}]])
runInNewContext(stripTypeScriptTypes(gate+'\n'+source.slice(start,end)),{pi:{registerTool:t=>approvalTools.set(t.name,t)},Type,snapshots:approvalSnapshots,assertDesktopUseEnabled:()=>{},requireDesktopPermissions:async()=>{},approvalMode:'always',findElement:(s,id)=>s.elements.find(e=>e.id===id),doAction:async()=> 'done',audit:async()=>{},verify:async()=>({}),claimDurableDesktopAction,getDesktopJournal})
let shown=''
await approvalTools.get('computer_use_act').execute('approval',{snapshotId:'a',type:'type',elementId:'e1',text:'private-value'},null,null,{ui:{confirm:async(_title,message)=>{shown=message;return false}}})
assert.match(shown,/Test App/); assert.match(shown,/Test Window/); assert.match(shown,/Save/); assert.doesNotMatch(shown,/private-value/)
assert.equal(approvalSnapshots.get('a').stale,false,'cancelling before action leaves snapshot unchanged')
const helperBody=source.slice(source.indexOf('async function runHelper('),source.indexOf('async function requireDesktopPermissions('))
const safeHelper=runInNewContext(`${stripTypeScriptTypes(helperBody)}\nrunHelper`,{isWindows:false,helperCommand:'helper',helperPath:'helper',execFileAsync:async()=>{throw Object.assign(new Error('Command failed --text sensitive-password'),{stderr:'sensitive-password'})}})
await assert.rejects(safeHelper(['type','--text','sensitive-password']), error=>!String(error).includes('sensitive-password') && /unknown/i.test(String(error)))
const explicitHelper=runInNewContext(`${stripTypeScriptTypes(helperBody)}\nrunHelper`,{isWindows:false,helperCommand:'helper',helperPath:'helper',execFileAsync:async()=>{throw Object.assign(new Error('failed'),{stdout:JSON.stringify({ok:false,error:'Desktop target or window changed. Observe again.'})})}})
await assert.rejects(explicitHelper(['ax-action']), /target or window changed/i)
console.log('PASS desktop action safety: concurrent use, uncertain failure and no automatic duplicate click')
journal.close(); rmSync(temp,{recursive:true,force:true})
