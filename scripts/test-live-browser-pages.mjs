// Opt-in: runs a paid/configured model against two public, read-only pages.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, symlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { _electron as electron } from 'playwright'
const model = process.env.PI_LIVE_MODEL
if (!model) throw new Error('Choose a configured model using PI_LIVE_MODEL.')
const root = resolve(import.meta.dirname, '..'), tmp = await mkdtemp(join(tmpdir(),'pi-pages-live-'))
const data = join(tmp,'userData'), agent = join(tmp,'agent')
let app, child
try {
  await mkdir(agent)
  await symlink(join(homedir(),'.pi','agent','auth.json'),join(agent,'auth.json'))
  app = await electron.launch({cwd:root,args:['.', '--user-data-dir='+data],env:{...process.env,HOME:tmp,PI_DESKTOP_PI_PATH:join(root,'scripts/mock-pi.mjs'),PI_CODING_AGENT_DIR:join(tmp,'mock-agent')}})
  const page = await app.firstWindow()
  await page.waitForSelector('.composer-input, .welcome')
  const dir = join(data,'computer-use-bridges'), bridge = join(dir,(await readdir(dir))[0])
  const form = process.env.PI_LIVE_CASE === 'form'
  const marker = 'pi-preview-' + Date.now().toString(36)
  const prompt = form ? `Use only inapp computer_use tools. Open https://www.selenium.dev/selenium/web/web-form.html as page form. Use the type action to enter ${marker} in the ordinary Text input (not the password). Do not submit. Open https://example.com in a different named page reference. Then switch back using page form only without a URL. Observe and report the current value of the text input. Do not submit or store anything on a server.` : 'Use only the inapp computer_use session tools. Open https://example.com in a page named example, read its visible text. Open https://www.iana.org/help/example-domains in a second page named iana and read it. Switch back to example by name alone and read again. Report both page titles and one factual difference. Do not close the session until finished.'
  child = spawn('pi',['-p','--mode','json','--no-session','--no-extensions','--no-skills','--no-mcp','--no-context-files','-e',join(root,'extensions/computer-use/index.ts'),'--tools','computer_use_session_open,computer_use_session_observe,computer_use_session_read,computer_use_session_close'+(form?',computer_use_session_act':''),'--model',model,prompt],{cwd:tmp,env:{...process.env,HOME:tmp,PI_CODING_AGENT_DIR:agent,PI_COMPUTER_USE_APPROVAL:form ? 'never' : 'always',PI_DESKTOP_BROWSER_BRIDGE_FILE:bridge},stdio:['ignore','pipe','ignore']})
  const result = new Promise(resolveDone=>child.once('exit',resolveDone))
  const timer = setTimeout(()=>child.kill(),150000)
  const observations=[], reads=[]
  try {
    for await (const line of createInterface({input:child.stdout})) {
      let e; try { e=JSON.parse(line) } catch {continue}
      if(e.type==='message_end' && e.message?.errorMessage) console.log(String(e.message.errorMessage).slice(0,200))
      if(e.type!=='tool_execution_end') continue
      const details=e.result?.details || {}
      console.log(e.toolName,e.isError ? String(e.result?.content?.[0]?.text).slice(0,180) : [details.page,details.title].filter(Boolean).join(' '))
      if(e.toolName==='computer_use_session_observe' && !e.isError) observations.push({...details,content:JSON.stringify(e.result?.content)})
      if(e.toolName==='computer_use_session_read' && !e.isError) reads.push(JSON.stringify(e.result.content))
    }
    assert.equal(await result,0)
    if (form) {
      const forms = observations.filter(o=>o.page==='form')
      assert.ok(observations.some(o=>new URL(o.url).hostname==='example.com' && o.documentId!==forms[0]?.documentId) && forms.length>=2 && forms[0].documentId===forms.at(-1).documentId && JSON.parse(forms.at(-1).content).some(block=>JSON.parse(block.text).candidates.some(c=>c.value===marker)))
      console.log('PASS live model entered a unique value in a public test form, switched pages and verified its value on return')
    } else {
    const first=observations.find(o=>o.page==='example'), second=observations.find(o=>o.page==='iana')
    assert.ok(first && second && first.documentId!==second.documentId)
    assert.ok(observations.slice(observations.indexOf(second)+1).some(o=>o.documentId===first.documentId))
    assert.ok(reads.some(s=>/documentation/i.test(s)) && reads.some(s=>/RFC 2606/i.test(s)))
    console.log('PASS live model, two public pages, verified content and return to original document')
    }
  } finally {clearTimeout(timer)}
} finally {child?.kill();await app?.close();await rm(tmp,{recursive:true,force:true,maxRetries:8,retryDelay:100})}
