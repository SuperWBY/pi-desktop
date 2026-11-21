import { browserInteractionCode } from '../extensions/computer-use/src/browser-interaction.ts'
#!/usr/bin/env node
// Deterministic local tool-chain comparison. This is not an autonomous-agent benchmark.
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, unlink } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { performance } from 'node:perf_hooks'
import { chromium } from 'playwright'
import { BrowserRouter } from '../extensions/computer-use/src/browser-router.ts'
import { BrowserActionJournal } from '../extensions/computer-use/src/browser-action-journal.ts'
import { browserChallengeCode } from '../extensions/computer-use/src/browser-challenge.ts'
import { browserTargetGuardCode } from '../extensions/computer-use/src/browser-target.ts'
import { browserFileSnapshotCode, browserFileHashCode } from '../extensions/computer-use/src/browser-file-context.ts'
import { browserPageTextCode } from '../extensions/computer-use/src/browser-page-text.ts'
import { judgeWithJev } from '../extensions/computer-use/src/jev.ts'
import { startBackoffice } from './fixtures/business-backoffice/server.mjs'
import { evaluateBusinessState } from './fixtures/business-backoffice/evaluator.mjs'

const iterations = Number(process.env.PI_BENCH_RUNS || 3)
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) throw new Error('PI_BENCH_RUNS must be an integer between 1 and 20')
const executable = process.env.PI_TEST_CHROME || chromium.executablePath()
const payload = '订单编号,结果\nORD-2026-002,已核对\n'
const payloadHash = createHash('sha256').update(payload).digest('hex')
const sourceFiles = ['scripts/benchmark-business-workflow.mjs','scripts/fixtures/business-backoffice/server.mjs','scripts/fixtures/business-backoffice/evaluator.mjs','scripts/fixtures/business-backoffice/index.html','extensions/computer-use/index.ts','extensions/computer-use/src/browser-router.ts','extensions/computer-use/src/browser-action-journal.ts','extensions/computer-use/src/browser-challenge.ts','extensions/computer-use/src/browser-file-context.ts','extensions/computer-use/src/browser-page-text.ts','extensions/computer-use/src/browser-target.ts','extensions/computer-use/src/jev.ts','package-lock.json']
const sourceHash = createHash('sha256')
for (const path of sourceFiles) {sourceHash.update(path+'\0'); sourceHash.update(await readFile(path))}
let chromeVersion='unknown', revision='unknown'
try { chromeVersion=execFileSync(executable,['--version'],{encoding:'utf8'}).trim() } catch {}
try { revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim() } catch {}
const source = await readFile(new URL('../extensions/computer-use/index.ts',import.meta.url),'utf8')
const cdpSource = source.slice(source.indexOf('const cdpProfileDir ='),source.indexOf('const chromeBridgePort =')) + source.slice(source.indexOf('async function ensureCdpPage'),source.indexOf('async function audit('))
const start = source.indexOf('export default function computerUse(')
const end = source.indexOf("  pi.registerTool({\n    name: 'computer_use_apps'",start)
if (start < 0 || end < 0) throw new Error('Cannot locate Pi tool registration')
const registration=stripTypeScriptTypes(source.slice(start,end).replace('export default function','function')+'\n}')
const payloadFile = { name:'fixture.csv', mimeType:'text/csv', buffer:Buffer.from(payload) }

async function run(kind, iteration, order) {
  const fixture=await startBackoffice()
  const dir=await mkdtemp(join(tmpdir(),'pi-business-bench-'))
  const record={kind,iteration,order,success:false,elapsedMs:null,steps:[],toolCalls:0,approvalCount:0,uploads:null,submissions:null,duplicateSideEffects:null,uploadAttempts:null,submitAttempts:null,duplicateAttempts:null,downloadVerified:false,selectedContentVerified:false,error:null}
  let context, sessionClose, started, state, journal
  try {
    let port
    if (kind === 'pi_cdp_scripted_tools') {
      const reserve=createServer(); await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve)); port=reserve.address().port; await new Promise(resolve=>reserve.close(resolve))
    }
    context=await chromium.launchPersistentContext(join(dir,'profile'),{headless:true,executablePath:executable,args:port?[`--remote-debugging-port=${port}`]:[]})
    const page=context.pages()[0] || await context.newPage()
    started=performance.now()
    if (kind === 'playwright_script') {
      await page.goto(fixture.url)
      await page.getByLabel('订单编号').fill('ORD-2026-002')
      await page.getByRole('button',{name:'查询订单'}).click()
      await page.getByRole('button',{name:'ORD-2026-002 青木测试商品 待处理'}).click()
      if (await page.locator('#selected').innerText() !== '已选择订单：ORD-2026-002') throw new Error('Wrong selected record')
      record.steps.push('selected_record')
      const downloadPromise=page.waitForEvent('download',{timeout:5000})
      await page.getByRole('link',{name:'下载订单报表'}).click()
      const download=await downloadPromise
      const downloaded=await readFile(await download.path())
      record.downloadVerified=download.suggestedFilename()==='report.csv' && createHash('sha256').update(downloaded).digest('hex')===createHash('sha256').update(fixture.csv).digest('hex')
      if(!record.downloadVerified) throw new Error('Downloaded report content mismatch')
      record.steps.push('download_verified')
      const chooserPromise=page.waitForEvent('filechooser',{timeout:5000})
      await page.locator('#file').click()
      await (await chooserPromise).setFiles(payloadFile)
      const files=await page.locator('#file').evaluate(el=>Array.from(el.files,file=>({name:file.name,size:file.size})))
      if(files.length!==1 || files[0].name!=='fixture.csv' || files[0].size!==Buffer.byteLength(payload)) throw new Error('Selected file metadata mismatch')
      const selectedHash=await page.locator('#file').evaluate(async el=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await el.files[0].arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join(''))
      record.selectedContentVerified=selectedHash===payloadHash
      if(!record.selectedContentVerified)throw new Error('Selected file content mismatch')
      await page.getByRole('button',{name:'上传资料'}).click()
      await page.getByText('上传成功：fixture.csv · ORD-2026-002').waitFor({timeout:5000})
      record.steps.push('upload_status')
      await page.getByRole('button',{name:'提交订单'}).click()
      await page.getByText('已提交：ORD-2026-002').waitFor({timeout:5000})
      record.steps.push('submit_status')
    } else {
      const cdp=runInNewContext(`${stripTypeScriptTypes(cdpSource)}\n({ensureCdpPage,releaseCdpSocket,cdpSend,cdpEval,cdpAction,closeCdp,cdpObserveCode})`,{browserChallengeCode,browserTargetGuardCode,browserInteractionCode,browserFileSnapshotCode,homedir,join,spawn,mkdir,unlink,fetch,WebSocket,AbortSignal,setTimeout,clearTimeout,process:{env:{PI_CDP_PORT:String(port)}}})
      const definitions=new Map()
      const Type=new Proxy({}, {get:()=> (...args)=>({args})})
      journal=new BrowserActionJournal(join(dir,'actions.sqlite'))
      const factory=runInNewContext(`${registration}\ncomputerUse`,{...cdp,BrowserRouter,browserChallengeCode,browserInteractionCode,browserTargetGuardCode,browserPageTextCode,browserFileHashCode,judgeWithJev,Type,createBrowserActionJournal:()=>journal,approvalMode:'always',manualBrowserApproval:false,allowRoutineActions:false,audit:async()=>{},process:{env:{}},randomUUID,URL,setTimeout})
      factory({registerTool:tool=>definitions.set(tool.name,tool),on:()=>{}})
      const invoke=async(name,params={})=>{record.toolCalls++;return definitions.get(name).execute('benchmark',params,undefined,undefined,{ui:{confirm:async()=>{record.approvalCount++;return true}}})}
      const observe=async(url)=>JSON.parse((await invoke('computer_use_session_observe',url?{url}:{})).content[0].text)
      const action=async(name,type='click',text)=>{const observation=await observe();const matches=observation.candidates.filter(item=>item.name===name);if(matches.length!==1)throw new Error(`Expected one candidate: ${name}; found ${matches.length}`);await invoke('computer_use_session_act',{candidateId:matches[0].id,type,...(text?{text}:{})})}
      const waitText=async(expected)=>{for(let i=0;i<50;i++){await observe();const result=await invoke('computer_use_session_read');if(result.content[0].text.includes(expected))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(`Expected status missing: ${expected}`)}
      await invoke('computer_use_session_open',{backend:'cdp'})
      sessionClose=()=>invoke('computer_use_session_close')
      let observation=await observe(fixture.url)
      const input=observation.candidates.filter(item=>item.name==='订单编号' && item.role==='input')
      if (input.length!==1) throw new Error('Order input is not unique')
      await invoke('computer_use_session_act',{candidateId:input[0].id,type:'type',text:'ORD-2026-002'})
      await action('查询订单')
      const match=await invoke('computer_use_session_wait',{name:'ORD-2026-002 青木测试商品 待处理',timeoutMs:5000})
      if(!match.details.matched)throw new Error('Order did not appear')
      await invoke('computer_use_session_act',{candidateId:match.details.candidate.id,type:'click'})
      await waitText('已选择订单：ORD-2026-002')
      record.steps.push('selected_record')
      const downloadPromise=page.waitForEvent('download',{timeout:5000})
      await action('下载订单报表')
      const download=await downloadPromise
      const downloaded=await readFile(await download.path())
      record.downloadVerified=download.suggestedFilename()==='report.csv' && createHash('sha256').update(downloaded).digest('hex')===createHash('sha256').update(fixture.csv).digest('hex')
      if(!record.downloadVerified) throw new Error('Downloaded report content mismatch')
      record.steps.push('download_verified')
      observation=await observe()
      const fileCandidate=observation.candidates.find(item=>item.type==='file' && item.name==='选择 CSV 文件')
      if(!fileCandidate) throw new Error('File chooser not found')
      const chooserPromise=page.waitForEvent('filechooser',{timeout:5000})
      const chooserAction=invoke('computer_use_session_act',{candidateId:fileCandidate.id,type:'click'})
      const chooser=await chooserPromise
      const chosen=await chooserAction
      if(chosen.details?.verification?.reason!=='file_selection')throw new Error('File selection was not paused for verification')
      await chooser.setFiles(payloadFile)
      const verified=await invoke('computer_use_session_verify_file',{expectedName:'fixture.csv',expectedSha256:payloadHash})
      record.selectedContentVerified=verified.details?.contentVerified===true
      if(verified.details?.file?.name!=='fixture.csv' || !record.selectedContentVerified)throw new Error('File content verification failed')
      observation=await observe()
      const inputFile=observation.candidates.find(item=>item.type==='file')
      if(inputFile?.fileCount!==1 || inputFile.files?.[0]?.name!=='fixture.csv' || inputFile.files?.[0]?.size!==Buffer.byteLength(payload)) throw new Error('Selected file metadata mismatch')
      await action('上传资料')
      await waitText('上传成功：fixture.csv · ORD-2026-002')
      record.steps.push('upload_status')
      await action('提交订单')
      await waitText('已提交：ORD-2026-002')
      record.steps.push('submit_status')
    }
  } catch(error) { record.error=String(error?.message || error) }
  finally {
    if(started!==undefined) record.elapsedMs=Math.round(performance.now()-started)
    try {
      state=await (await fetch(fixture.url+'/api/state')).json()
      const metricsResponse=await fetch(fixture.url+'/api/metrics')
      if(!metricsResponse.ok) throw new Error('Attempt metrics unavailable')
      const metrics=await metricsResponse.json()
      const verdict=evaluateBusinessState(state,{recordId:'ORD-2026-002',name:'fixture.csv',sha256:payloadHash,size:Buffer.byteLength(payload)},metrics)
      record.uploads=verdict.uploads;record.submissions=verdict.submissions;record.duplicateSideEffects=verdict.duplicateSideEffects;record.uploadAttempts=verdict.uploadAttempts;record.submitAttempts=verdict.submitAttempts;record.duplicateAttempts=verdict.duplicateAttempts
      record.success=!record.error && record.steps.length===4 && record.downloadVerified && record.selectedContentVerified && verdict.matched
      if(!record.success && !record.error) record.error='Independent evaluator did not match expected state'
    } catch(error) {record.error=record.error || `Evaluator: ${String(error?.message || error)}`}
    try { await sessionClose?.() } catch {}
    await context?.close(); journal?.close(); await fixture.close(); await rm(dir,{recursive:true,force:true})
  }
  return record
}
const results=[]
for(let i=1;i<=iterations;i++) {
  const order=i%2?['pi_cdp_scripted_tools','playwright_script']:['playwright_script','pi_cdp_scripted_tools']
  for(let j=0;j<order.length;j++) results.push(await run(order[j],i,j+1))
}
const summary=Object.fromEntries(['pi_cdp_scripted_tools','playwright_script'].map(kind=>{
  const runs=results.filter(item=>item.kind===kind), times=runs.filter(item=>item.success && item.elapsedMs!==null).map(item=>item.elapsedMs).sort((a,b)=>a-b)
  return [kind,{runs:runs.length,successes:runs.filter(item=>item.success).length,failures:runs.filter(item=>!item.success).length,duplicateSideEffects:runs.filter(item=>item.duplicateSideEffects===true).length,duplicateAttempts:runs.filter(item=>item.duplicateAttempts===true).length,unknownAttempts:runs.filter(item=>item.duplicateAttempts===null).length,successfulElapsedMs:times}]
}))
console.log(JSON.stringify({schemaVersion:1,recordedAt:new Date().toISOString(),task:'local-backoffice-lookup-download-upload-submit-v4',environment:{node:process.version,platform:process.platform,arch:process.arch,chromeVersion,playwright:JSON.parse(await readFile('node_modules/playwright/package.json','utf8')).version,revision,sourceHash:sourceHash.digest('hex')},method:{automation:'scripted',model:'none',humanApprovals:'simulated; Pi approvals always accepted',fileSelection:'Playwright supplies a test file through each file chooser; both paths check selected content SHA-256 before upload',downloadCapture:'Playwright observes the download event and reads the temporary downloaded file for both paths',browser:'isolated headless persistent profile per run',timer:'after browser launch through final page status; excludes server readback and startup',evaluator:'selected-file SHA-256, fresh local server state, expected record, upload SHA-256, exact download SHA-256, exactly one upload and submission, and exactly one request for each',limits:'not autonomous agents, no real site, no native chooser UI or human confirmation latency, no speed conclusion from small sample; Pi script includes tool setup and different observation steps'},results,summary},null,2))
if(results.some(item=>!item.success))process.exitCode=1
