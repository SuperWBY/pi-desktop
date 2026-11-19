import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {stripTypeScriptTypes} from 'node:module'
import {runInNewContext} from 'node:vm'
const source=await readFile(new URL('../extensions/computer-use/index.ts',import.meta.url),'utf8')
const jstart=source.indexOf('  const runLegacyJournaled ='),jend=source.indexOf('\n\n  pi.registerTool(',jstart)
const start=source.lastIndexOf('  pi.registerTool({',source.indexOf("name: 'computer_use_chrome_observe'")),end=source.indexOf("  pi.registerTool({\n    name: 'computer_use_permissions'",start)
assert.ok(jstart>=0&&jend>jstart&&start>=0&&end>start)
let pending=null, response='target_changed', protocol, ackFails=false
const actionJournal={claim(){return pending={id:'a'}},acknowledge(_b,id){assert.equal(id,pending.id);if(ackFails)throw Error('disk unavailable');pending=null}}
const definitions=new Map(),Type=new Proxy({}, {get:()=>()=>({})})
const bridge=async task=>{if(task.type==='observe')return {tabId:1,documentId:'doc',snapshotId:'snap',url:'https://test.invalid/',candidates:[{id:'h1',name:'Go',role:'button'}]};protocol=task.guardProtocol;if(response==='lost')throw Error('connection lost');if(task.guardProtocol!==1)throw Error('Target changed; observe again.');return {__piGuardRejected:response}}
const code=`class BrowserBridgeUnavailableBeforeDispatch extends Error {}\nclass LegacyBrowserActionBeforeDispatch extends Error {}\nclass LegacyChromeGuardBeforeDispatch extends Error {}\nlet chromeObservation=null;\n${source.slice(jstart,jend)}\n${source.slice(start,end)}`
runInNewContext(stripTypeScriptTypes(code),{pi:{registerTool:t=>definitions.set(t.name,t)},Type,actionJournal,router:{hasAnyPendingAction:()=>!!pending},assertLegacyAvailable(){},chromeBridgeTask:bridge,approvalMode:'always',audit:async()=>{}})
const invoke=async(name,params={})=>definitions.get(name).execute('test',params,undefined,undefined,{ui:{confirm:async()=>true}})
await invoke('computer_use_chrome_observe')
await assert.rejects(invoke('computer_use_chrome_act',{candidateId:'h1',type:'click'}),/target changed|observe again/i)
assert.equal(protocol,1);assert.equal(pending,null,'authenticated pre-action rejection must release record')
await invoke('computer_use_chrome_observe');ackFails=true
await assert.rejects(invoke('computer_use_chrome_act',{candidateId:'h1',type:'click'}),/result is unknown/i)
assert.ok(pending,'failed cleanup must retain uncertain record')
pending=null;ackFails=false;response='lost';await invoke('computer_use_chrome_observe')
await assert.rejects(invoke('computer_use_chrome_act',{candidateId:'h1',type:'click'}),/result is unknown/i)
assert.ok(pending,'lost response must retain uncertain record')
console.log('PASS legacy Chrome structured guard, cleanup failure, and response loss')
