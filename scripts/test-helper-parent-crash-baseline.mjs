// Demonstrates process semantics with test-only Node processes, no desktop actions.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temp=mkdtempSync(join(tmpdir(),'pi-helper-parent-')), helper=join(temp,'helper.mjs'), parent=join(temp,'parent.mjs'), marker=join(temp,'finished')
writeFileSync(helper, `import {writeFileSync} from 'node:fs'; process.stdout.write('ready'); setTimeout(()=>{writeFileSync(process.argv[2],'finished');process.exit(0)},600);`)
writeFileSync(parent, `import {spawn} from 'node:child_process'; const c=spawn(process.execPath,[process.argv[2],process.argv[3]],{stdio:['ignore','pipe','ignore']}); c.stdout.once('data',()=>{process.stdout.write(String(c.pid)+'\\n')}); setInterval(()=>{},1000);`)
let child, helperPid
try {
  child=spawn(process.execPath,[parent,helper,marker],{stdio:['ignore','pipe','pipe']})
  helperPid=Number(await new Promise((resolve,reject)=>{child.stdout.once('data',data=>resolve(String(data).trim())); child.once('error',reject); child.once('exit',code=>reject(Error(`parent exited ${code}`))) }))
  assert.ok(Number.isSafeInteger(helperPid)&&helperPid>1)
  const exited=new Promise(resolve=>child.once('exit',resolve)); child.kill('SIGKILL'); await exited; child=null
  for(let i=0;i<30&&!existsSync(marker);i++) await new Promise(resolve=>setTimeout(resolve,100))
  assert.equal(existsSync(marker),true,'helper can finish even after its parent was killed')
  helperPid=undefined
  console.log('BASELINE: a spawned helper can outlive a killed parent and complete its action')
} finally {
  child?.kill('SIGKILL')
  if(helperPid) {try {process.kill(helperPid,'SIGTERM')} catch {}}
  rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
