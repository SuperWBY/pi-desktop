import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
const root=mkdtempSync(join(tmpdir(),'creator-owner-')),pidFile=join(root,'pids.json'),fixture=join(root,'fixture.mjs'),owner=join(root,'owner.mjs')
let child,pids
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}}
async function until(predicate){const end=Date.now()+5000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,25));assert.ok(predicate())}
try{
 const helper="process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"
 writeFileSync(fixture,`import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const helper=spawn(process.execPath,['-e',${JSON.stringify(helper)}],{stdio:'inherit'});writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({leader:process.pid,helper:helper.pid}));setInterval(()=>{},1000)`)
 writeFileSync(owner,`import{runCreatorPi}from${JSON.stringify(pathToFileURL(resolve('extensions/creator/process.ts')).href)};process.env.PI_DESKTOP_CREATOR_CLI=${JSON.stringify(fixture)};await runCreatorPi({args:[],cwd:${JSON.stringify(root)},timeout:10000})`)
 child=spawn(process.execPath,['--experimental-strip-types',owner],{stdio:'ignore',shell:false})
 child.on('error',error=>{throw error})
 await until(()=>existsSync(pidFile));pids=JSON.parse(readFileSync(pidFile,'utf8'))
 child.kill('SIGKILL')
 await until(()=>!alive(pids.leader)&&!alive(pids.helper))
 console.log('✓ Killing the owner forcibly still reaps the detached Pi group and its startup helper')
}finally{
 if(child&&alive(child.pid))child.kill('SIGKILL')
 if(pids&&alive(pids.leader)){
  try{if(process.platform==='win32')execFileSync('taskkill',['/pid',String(pids.leader),'/T','/F'],{stdio:'ignore'});else process.kill(-pids.leader,'SIGKILL')}catch{}
 }
 rmSync(root,{recursive:true,force:true})
}
