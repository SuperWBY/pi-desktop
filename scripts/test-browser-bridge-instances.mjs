import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root=resolve(import.meta.dirname,'..'), temp=mkdtempSync(join(tmpdir(),'pi-bridge-instances-'))
const home=join(temp,'home'), legacy=join(home,'.pi','computer-use','browser-bridge.json')
mkdirSync(join(home,'.pi','computer-use'),{recursive:true});writeFileSync(legacy,'legacy sentinel')
const apps=[]
try {
 for(const name of ['a','b']){
  const data=join(temp,name), agent=join(data,'agent'), workspace=join(data,'workspace'), envFile=join(data,'rpc-env.json')
  for(const path of [data,agent,workspace])mkdirSync(path,{recursive:true})
  const app=await electron.launch({args:['.',`--user-data-dir=${join(data,'userData')}`],cwd:root,env:{...process.env,HOME:home,PI_DESKTOP_PI_PATH:join(root,'scripts/mock-pi.mjs'),PI_CODING_AGENT_DIR:agent,PI_CODING_AGENT_SESSION_DIR:join(data,'sessions'),PI_CHROME_BRIDGE_SECRET_FILE:join(data,'secret.json'),MOCK_RPC_ENV_FILE:envFile}})
  apps.push(app);const page=await app.firstWindow();await page.waitForSelector('.composer-input, .welcome',{timeout:45000})
  const opened=await page.evaluate(cwd=>window.pi.openSession({cwd,scratch:true}),workspace);assert.equal(opened.ok,true,JSON.stringify(opened))
  await page.waitForTimeout(300)
  const env=JSON.parse(readFileSync(envFile,'utf8'));assert.ok(env.desktopBrowserBridgeFile,'each Pi child must get its own bridge path')
  let bridge
  for(let i=0;i<60;i++){try{bridge=JSON.parse(readFileSync(env.desktopBrowserBridgeFile,'utf8'));break}catch{await new Promise(r=>setTimeout(r,50))}}
  assert.ok(bridge,'instance bridge must exist')
  const response=await fetch(`http://127.0.0.1:${bridge.port}/state`,{headers:{authorization:`Bearer ${bridge.token}`}});assert.equal(response.status,200)
  apps[apps.length-1].bridgeFile=env.desktopBrowserBridgeFile;apps[apps.length-1].bridge=bridge
 }
 assert.notEqual(apps[0].bridgeFile,apps[1].bridgeFile)
 assert.equal(readFileSync(legacy,'utf8'),'legacy sentinel','desktop instances must not modify legacy global bridge')
 await apps[0].close();apps[0]=null
 assert.ok(existsSync(apps[1].bridgeFile),'closing another instance must not delete this instance bridge')
 const bridge=apps[1].bridge;assert.equal((await fetch(`http://127.0.0.1:${bridge.port}/state`,{headers:{authorization:`Bearer ${bridge.token}`}})).status,200)
 console.log('PASS same-HOME Pi Desktop instances use separate authenticated browser bridges')
}finally{for(const app of apps)await app?.close().catch(()=>{});rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
