// The preview can reserve room for text, but the space below it must still accept a wheel.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const temp = await mkdtemp(join(tmpdir(), 'pi-chat-scroll-'))
const data = join(temp, 'data')
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'text/html')
  response.end('<meta name="viewport" content="width=device-width"><title>Orders</title><main style="height:3000px">Orders</main>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let app
try {
  await mkdir(data)
  await writeFile(join(data, 'settings.json'), JSON.stringify({lastWorkspace:temp, workspaces:[temp]}))
  const executablePath = process.env.PI_PREVIEW_APP
  app = await electron.launch({cwd:root, executablePath, args:[...(executablePath ? [] : ['.']), '--user-data-dir='+data],
    env:{...process.env, HOME:temp, PI_DESKTOP_PI_PATH:join(root,'scripts/mock-pi.mjs'), PI_CODING_AGENT_DIR:join(temp,'agent'), PI_CODING_AGENT_SESSION_DIR:join(temp,'sessions')}})
  const page = await app.firstWindow()
  await page.locator('.status-dot.is-ready').waitFor()
  const bridgeDir = join(data,'computer-use-bridges')
  const bridge = JSON.parse(await readFile(join(bridgeDir,(await readdir(bridgeDir))[0]),'utf8'))
  const post = async (path, body) => {
    const response = await fetch('http://127.0.0.1:'+bridge.port+path,{method:'POST',
      headers:{authorization:'Bearer '+bridge.token,'x-pi-controller':'scroll-test','x-pi-pid':String(process.pid)},body:JSON.stringify(body)})
    assert.equal(response.status,200)
    return response.json()
  }
  const url = 'http://127.0.0.1:'+server.address().port+'/'
  await post('/claim',{})
  await post('/viewport',{width:390,height:844})
  await post('/navigate',{url})
  await page.waitForFunction(async expected => (await window.pi.browserCurrent()).url === expected,url)
  const obs = await post('/observe',{})
  await app.evaluate(({BrowserWindow}, {obs,url}) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))
    win.setSize(1390,820)
    const emit = record => win.webContents.send('pi:record',record)
    for (let i=0;i<35;i++) {
      emit({type:'message_start',message:{role:'user', timestamp:Date.now()+i, content:[{type:'text',text:'检查订单 '+i}]}})
    }
    emit({type:'agent_start'})
    emit({type:'tool_execution_start',toolCallId:'observe',toolName:'computer_use_session_observe'})
    emit({type:'tool_execution_end',toolCallId:'observe',toolName:'computer_use_session_observe',result:{details:{backend:'inapp',documentId:obs.documentId,url,title:'Orders'}}})
  },{obs,url})
  await page.locator('.cu-surface img').first().waitFor()
  await page.locator('.cu-surface').click()
  await page.locator('.browser-follow button[aria-pressed="true"]').click()
  await page.locator('.cu-surface').waitFor()
  const chat = page.locator('.chat-scroll')
  await chat.evaluate(el=>{el.scrollTop=0})
  const bounds = await chat.boundingBox()
  const region = await page.locator('.conversation-region').boundingBox()
  assert.ok(Math.abs(bounds.x+bounds.width-region.x-region.width)<2,'chat scrollbar belongs at the conversation edge')
  const top = () => chat.evaluate(el=>el.scrollTop)
  const webScroll = () => app.evaluate(async ({webContents},url)=>webContents.getAllWebContents().find(w=>w.getURL()===url).executeJavaScript('scrollY'),url)
  const before = await webScroll()
  await page.mouse.move(region.x+region.width-20,region.y+region.height-45)
  await page.mouse.wheel(0,360)
  await page.waitForFunction(()=>document.querySelector('.chat-scroll').scrollTop>0)
  assert.equal(await webScroll(),before)
  const initialChat = await top()
  await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(w=>w.getURL()===url).sendInputEvent({type:'mouseWheel',x:40,y:50,deltaX:0,deltaY:-360,canScroll:true}),url)
  await assert.doesNotReject(async()=>{
    for(let i=0;i<30;i++){if(await webScroll()>before)return;await page.waitForTimeout(50)}
    throw new Error('the browser did not scroll')
  })
  assert.equal(await top(),initialChat,'browser wheel must not move the chat')
  await post('/release',{})
  console.log('PASS scrollbar at pane edge; wheel below preview moves chat; browser wheel moves only the webpage')
} finally {
  await app?.close()
  server.close()
  await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100})
}
