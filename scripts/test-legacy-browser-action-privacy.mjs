import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {stripTypeScriptTypes} from 'node:module'
import {runInNewContext} from 'node:vm'
const source=await readFile(new URL('../extensions/computer-use/index.ts',import.meta.url),'utf8')
const name=source.indexOf("name: 'computer_use_browser_act'")
const start=source.lastIndexOf('  pi.registerTool({',name)
const end=source.indexOf('\n\n  pi.registerTool({',name)
assert.ok(start>=0 && end>start)
let tool,chromeReads=0
const Type=new Proxy({}, {get:()=>()=>({})})
runInNewContext(stripTypeScriptTypes(source.slice(start,end)),{
 pi:{registerTool:t=>tool=t},Type,approvalMode:'never',assertLegacyAvailable(){},
 runLegacyJournaled:async(_backend,action)=>action(),browserAction:async()=> 'in-app browser click b1',
 audit:async()=>{},chromeJS:async()=>{chromeReads++;return {title:'unrelated private tab',url:'https://private.invalid'}}
})
const result=await tool.execute('test',{candidateId:'b1',type:'click'},null,null,{})
assert.equal(chromeReads,0,'an in-app browser action must not read the unrelated everyday Chrome tab')
assert.doesNotMatch(JSON.stringify(result),/private tab|private\.invalid/)
assert.match(result.content[0].text,/observe|观察/i,'action result must request separate verification')
console.log('PASS legacy browser action does not read another browser for verification')
