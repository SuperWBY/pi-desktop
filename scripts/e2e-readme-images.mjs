import {writeFileSync} from 'node:fs'
import {join} from 'node:path'

export async function caseReadmeImages({freshDirs,launch,check}) {
 const dirs=freshDirs('readme-images')
 writeFileSync(join(dirs.userData,'settings.json'),JSON.stringify({theme:'dark',language:'zh-CN',workspaces:[dirs.base],lastWorkspace:dirs.base}))
 const {app,page,errors}=await launch(dirs)
 try {
  const actual=await page.evaluate(()=>window.pi.getPackageDetails({name:'billion-context',version:'0.1.216',fast:true}))
  check('真实billion-context说明包含固定发布提交的图片回退地址',actual.ok&&actual.details.readme?.imageFallbackBaseUrl?.includes('/6a641f378537e06e7430ec90c9abf035ffa12377/'))
  if(!actual.ok)throw Error(actual.error)
  await app.evaluate(({ipcMain},real)=>{
   const handle=(name,fn)=>{ipcMain.removeHandler(name);ipcMain.handle(name,fn)}
   const entry=name=>({name,version:name==='billion-context'?'0.1.216':'1.0.0',description:'图片测试',publisher:'Fixture',publishedAt:null,npmUrl:'https://www.npmjs.com/package/'+name,repositoryUrl:null})
   globalThis.readmeExternalOpens=0
   handle('shell:open-external',()=>{globalThis.readmeExternalOpens++})
   handle('packages:list',()=>[])
   handle('packages:catalog',(_,query)=>({entries:[entry(query==='billion'?'billion-context':'image-demo')]}))
   handle('packages:translate',(_,input)=>({ok:true,texts:input.texts}))
   handle('packages:details',(_,input)=>input.name==='billion-context'?real:{ok:true,details:{name:'image-demo',version:'1.0.0',latestVersion:'1.0.0',versions:['1.0.0'],description:'图片测试',author:'Fixture',publisher:'Fixture',license:'MIT',publishedAt:null,homepage:null,repositoryUrl:null,npmUrl:'https://www.npmjs.com/package/image-demo',catalogUrl:'https://pi.dev/packages/image-demo',installSource:'npm:image-demo@1.0.0',unpackedSize:100,dependencies:{},peerDependencies:{},engines:{},manifest:{extensions:['index.ts'],skills:[],themes:[],prompts:[],image:null,video:null},readme:{markdown:'# 图片示例\n\n[![How it works](docs/chart.svg)](https://example.test/docs)\n\n![Absolute image](https://images.example.test/valid.svg)\n\n[![Permanent failure](docs/missing.svg)](https://example.test/help)\n\n![Unsafe image](javascript:alert)\n\n[使用文档](docs/guide.md)',url:'https://cdn.jsdelivr.net/npm/image-demo@1.0.0/README.md',baseUrl:'https://cdn.jsdelivr.net/npm/image-demo@1.0.0/',imageFallbackBaseUrl:'https://raw.githubusercontent.com/example/image-demo/'+'a'.repeat(40)+'/',source:'npm-cdn',versionMatched:true},warnings:[],fetchedAt:Date.now()}})
  },actual)
  const requests=[]
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="400" height="100" fill="#303238"/><text x="20" y="55" fill="white">README image</text></svg>'
  await page.route('https://cdn.jsdelivr.net/npm/image-demo@1.0.0/**',route=>{requests.push(route.request().url());return route.fulfill({status:404,body:'Not published'})})
  await page.route('https://raw.githubusercontent.com/example/image-demo/**',route=>{requests.push(route.request().url());return route.fulfill({status:route.request().url().endsWith('/chart.svg')?200:404,contentType:route.request().url().endsWith('/chart.svg')?'image/svg+xml':'text/plain',body:route.request().url().endsWith('/chart.svg')?svg:'Missing image'})})
  await page.route('https://images.example.test/**',route=>{requests.push(route.request().url());return route.fulfill({status:200,contentType:'image/svg+xml',body:svg})})
  await page.locator('.plugins-page-entry').click()
  await page.locator('#market-image-demo').click()
  const diagram=page.getByAltText('How it works',{exact:true})
  await diagram.scrollIntoViewIfNeeded()
  await page.waitForFunction(()=>{const img=document.querySelector('.market-readme img[alt="How it works"]');return img?.naturalWidth>0&&img.currentSrc.startsWith('https://raw.githubusercontent.com/example/image-demo/')})
  check('包内图片404后自动加载同一提交的仓库SVG',await diagram.evaluate(el=>el.naturalWidth===400&&el.dataset.loaded==='true')&&requests.findIndex(url=>url.includes('cdn.jsdelivr.net/npm/image-demo@1.0.0/docs/chart.svg'))<requests.findIndex(url=>url.includes('raw.githubusercontent.com/example/image-demo/')&&url.endsWith('/chart.svg')))
  const imageHandle=await diagram.elementHandle()
  await page.keyboard.press('Meta+Shift+l')
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light')
  check('主题及应用状态更新不会重新创建图片或清空回退状态',await imageHandle.evaluate(el=>el.isConnected&&el.currentSrc.startsWith('https://raw.githubusercontent.com/example/image-demo/')))
  const absolute=page.getByAltText('Absolute image',{exact:true})
  await absolute.scrollIntoViewIfNeeded()
  await page.waitForFunction(()=>document.querySelector('img[alt="Absolute image"]')?.naturalWidth===400)
  check('作者提供的绝对图片地址保持原样',await absolute.getAttribute('src')==='https://images.example.test/valid.svg')
  await page.locator('.market-readme-image').nth(2).scrollIntoViewIfNeeded()
  const retry=page.getByRole('button',{name:'重新加载图片',exact:true})
  await retry.waitFor()
  const before=requests.filter(url=>url.endsWith('/missing.svg')).length
  await retry.click()
  await retry.waitFor()
  await page.waitForFunction(()=>document.querySelector('.market-readme-image-error'))
  check('两处来源都失败时显示重试，不保留浏览器破图标记',requests.filter(url=>url.endsWith('/missing.svg')).length>before&&await page.getByAltText('Permanent failure',{exact:true}).count()===0)
  check('链接中的图片重试不会打开外部页面',await app.evaluate(()=>globalThis.readmeExternalOpens===0))
  check('图片修复不执行HTML或危险协议，原文链接不变',await page.getByAltText('Unsafe image',{exact:true}).count()===0&&await page.getByRole('link',{name:'使用文档',exact:true}).getAttribute('href')==='https://cdn.jsdelivr.net/npm/image-demo@1.0.0/docs/guide.md')
  await page.getByRole('button',{name:'所有插件',exact:true}).click()
  await page.getByRole('textbox',{name:'搜索插件'}).fill('billion')
  await page.getByRole('button',{name:'搜索',exact:true}).click()
  await page.locator('#market-billion-context').click()
  const realDiagram=page.getByAltText('How it works',{exact:true})
  await realDiagram.scrollIntoViewIfNeeded()
  await page.waitForFunction(()=>{const img=document.querySelector('.market-readme img[alt="How it works"]');return img?.naturalWidth>0&&img.currentSrc.startsWith('https://raw.githubusercontent.com/ranxianglei/billion-context/')},null,{timeout:20000})
  const geometry=await realDiagram.evaluate(el=>({src:el.currentSrc,width:el.naturalWidth,height:el.naturalHeight}))
  check('真实billion-context流程图可在Electron详情中解码显示',geometry.width>0&&geometry.height>0,JSON.stringify(geometry))
  await page.screenshot({path:join(dirs.base,'billion-context-diagram.png')})
  await page.screenshot({path:join(dirs.base,'..','..','readme-image-verified.png')})
  check('README图片交互没有renderer异常',errors.length===0,errors.join('; '))
 } finally {await app.close()}
}
