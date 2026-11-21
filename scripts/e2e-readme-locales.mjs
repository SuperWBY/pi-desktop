import {writeFileSync} from 'node:fs'
import {join} from 'node:path'

export async function caseReadmeLocales({freshDirs,launch,check}) {
 const dirs=freshDirs('readme-locales')
 writeFileSync(join(dirs.userData,'settings.json'),JSON.stringify({theme:'dark',language:'zh-CN',workspaces:[dirs.base],lastWorkspace:dirs.base}))
 const {app,page,errors}=await launch(dirs)
 try {
  const real=await page.evaluate(()=>window.pi.getPackageDetails({name:'billion-context',version:'0.1.216',fast:true,language:'zh-CN'}))
  check('真实billion-context优先读取作者README.zh-CN.md，未请求AI',real.ok&&real.details.readme?.fileName==='README.zh-CN.md'&&real.details.readme?.language==='zh-CN'&&real.details.readme?.versionMatched===true,JSON.stringify(real.ok?{file:real.details.readme?.fileName,source:real.details.readme?.source,status:real.details.readme?.localizationStatus}:real))
  if(!real.ok)throw Error(real.error)
  await app.evaluate(({ipcMain},real)=>{
   const handle=(name,fn)=>{ipcMain.removeHandler(name);ipcMain.handle(name,fn)}
   globalThis.__readmeLocale={translations:[],fail:false,details:[]}
   const entry=name=>({name,version:'1.0.0',description:'',publisher:'Author',publishedAt:null,npmUrl:'https://www.npmjs.com/package/'+name,repositoryUrl:null})
   handle('packages:list',()=>[])
   handle('packages:catalog',()=>({entries:[entry('native-demo'),entry('original-demo'),entry('billion-context')]}))
   handle('packages:translate',async(event,input)=>{
    globalThis.__readmeLocale.translations.push(input)
    if(globalThis.__readmeLocale.fail)return {ok:false,error:'Translation unavailable'}
    if(input.markdown&&input.language==='zh-CN'&&input.requestId){
     event.sender.send('packages:translation-progress',{requestId:input.requestId,text:input.texts[0].replace('Author original','AI 中文内容'),completed:1,total:2})
     await new Promise(resolve=>setTimeout(resolve,500))
    }
    return {ok:true,texts:input.texts.map(text=>input.markdown?input.language==='en'?text.replace('作者原文说明。','Author notes.'):text.replace('Author original','AI 中文内容'):text)}
   })
   handle('packages:details',(_,input)=>{
    globalThis.__readmeLocale.details.push(input)
    if(input.name==='billion-context')return real
    const authored=input.name==='native-demo'&&input.language
    const fileName=authored?(input.language==='zh-CN'?'README_CN.md':'README.en.md'):'README.md'
    const markdown=authored?(input.language==='zh-CN'?'# 作者提供的中文\n\n中文使用指南。':'# Author English\n\nEnglish usage guide.'):'# Author original\n\n作者原文说明。\n\n[Guide](docs/guide.md)\n\n```json\n{"keep":"unchanged"}\n```'
    return {ok:true,details:{...real.details,name:input.name,version:'1.0.0',description:'',readme:input.metadataOnly?null:{markdown,fileName,language:authored?input.language:undefined,localizationStatus:authored?'matched':'not-found',source:'npm-cdn',url:`https://cdn.jsdelivr.net/npm/${input.name}@1.0.0/${fileName}`,baseUrl:`https://cdn.jsdelivr.net/npm/${input.name}@1.0.0/`,versionMatched:true}}}
   })
  },real)
  const changeLanguage=async language=>{
   const settings=await page.evaluate(language=>window.pi.updateSettings({language}),language)
   await app.evaluate(({BrowserWindow},settings)=>BrowserWindow.getAllWindows()[0].webContents.send('app:settings',settings),settings)
  }
  const aiCount=()=>app.evaluate(()=>globalThis.__readmeLocale.translations.filter(input=>input.markdown).length)
  await page.locator('.plugins-page-entry').click()
  await page.locator('#market-native-demo').click()
  await page.getByRole('heading',{name:'作者提供的中文',exact:true}).waitFor()
  check('作者中文文档和实际文件来源可见',await page.locator('.market-readme-translation').innerText().then(text=>text.includes('作者中文文档')&&text.includes('README_CN.md · npm')))
  check('打开作者中文文档不自动AI翻译，也不展示AI按钮',await aiCount()===0&&await page.getByRole('button',{name:'AI 翻译成中文',exact:true}).count()===0)
  await changeLanguage('en')
  await page.getByRole('heading',{name:'Author English',exact:true}).waitFor()
  check('切换英文使用作者英文README并标注来源',await aiCount()===0&&(await page.locator('.market-readme-translation').innerText()).includes('README.en.md'))
  await page.getByRole('button',{name:'All plugins',exact:true}).click()
  await changeLanguage('zh-CN')
  await page.locator('#market-original-demo').click()
  await page.getByRole('button',{name:'AI 翻译成中文',exact:true}).waitFor()
  check('没有作者中文时先显示原文，未自动请求AI',await page.getByRole('heading',{name:'Author original',exact:true}).isVisible()&&await aiCount()===0)
  await page.getByRole('button',{name:'AI 翻译成中文',exact:true}).click()
  await page.getByRole('heading',{name:'AI 中文内容',exact:true}).waitFor()
  check('翻译未完成时先显示部分译文和真实进度', (await page.locator('.market-readme-translation').innerText()).includes('1/2'))
  await page.screenshot({path:join(dirs.base,'..','..','readme-translation-progress.png')})
  await page.waitForFunction(()=>!document.querySelector('.market-readme-translation [role="status"]')?.textContent?.includes('翻译中'))
  check('点击后才请求AI且明确标注AI译文',await aiCount()===1&&(await page.locator('.market-readme-translation').innerText()).includes('AI 译文'))
  check('AI译文保留代码和来源链接',await page.locator('.market-readme pre').innerText().then(text=>text.trim()==='{"keep":"unchanged"}')&&await page.getByRole('link',{name:'Guide',exact:true}).getAttribute('href')==='https://cdn.jsdelivr.net/npm/original-demo@1.0.0/docs/guide.md')
  await page.getByRole('button',{name:'查看作者原文',exact:true}).click()
  await page.getByRole('heading',{name:'Author original',exact:true}).waitFor()
  await page.getByRole('button',{name:'查看 AI 译文',exact:true}).click()
  await page.getByRole('heading',{name:'AI 中文内容',exact:true}).waitFor()
  check('作者原文和AI译文可来回切换且不重复请求',await aiCount()===1)
  await changeLanguage('en')
  await page.getByRole('button',{name:'Translate to English with AI',exact:true}).waitFor()
  await changeLanguage('zh-CN')
  await page.getByRole('button',{name:'AI 翻译成中文',exact:true}).waitFor()
  await page.getByRole('heading',{name:'Author original',exact:true}).waitFor()
  check('切换语言后恢复原文，不自动展示已缓存的AI译文',await aiCount()===1,JSON.stringify(await app.evaluate(()=>globalThis.__readmeLocale.translations.map(input=>({markdown:input.markdown,language:input.language})))) )
  await page.getByRole('button',{name:'所有插件',exact:true}).click()
  await page.locator('#market-original-demo').click()
  await page.getByRole('button',{name:'AI 翻译成中文',exact:true}).waitFor()
  check('重新打开详情也不会自动使用旧AI缓存',await page.getByRole('heading',{name:'Author original',exact:true}).isVisible()&&await aiCount()===1)
  await changeLanguage('en')
  await page.getByRole('button',{name:'Translate to English with AI',exact:true}).waitFor()
  await app.evaluate(()=>{globalThis.__readmeLocale.fail=true})
  await page.getByRole('button',{name:'Translate to English with AI',exact:true}).click()
  await page.getByRole('button',{name:'Retry AI translation',exact:true}).waitFor()
  check('AI失败保留作者原文并明确提供重试',await page.getByRole('heading',{name:'Author original',exact:true}).isVisible()&&(await page.locator('.market-readme-translation').innerText()).includes('AI translation failed.'))
  await app.evaluate(()=>{globalThis.__readmeLocale.fail=false})
  await page.getByRole('button',{name:'Retry AI translation',exact:true}).click()
  await page.getByRole('button',{name:'View author’s original',exact:true}).waitFor()
  check('AI失败后可手动重试，完成仍标注AI译文',await aiCount()===3&&(await page.locator('.market-readme-translation').innerText()).includes('AI translation'))
  await page.getByRole('button',{name:'All plugins',exact:true}).click()
  await changeLanguage('zh-CN')
  await page.locator('#market-billion-context').click()
  await page.locator('.market-readme-translation').getByText('作者中文文档',{exact:true}).waitFor()
  check('真实中文作者README显示准确文件来源且不触发AI',await page.locator('.market-readme-translation a').innerText().then(text=>text==='README.zh-CN.md · npm')&&await aiCount()===3)
  await page.screenshot({path:join(dirs.base,'..','..','readme-author-chinese-verified.png')})
  await page.getByAltText('工作原理',{exact:true}).scrollIntoViewIfNeeded()
  await page.waitForFunction(()=>document.querySelector('img[alt="工作原理"]')?.naturalWidth>0,null,{timeout:20000})
  check('作者中文README图片仍可从同版本仓库加载',await page.getByAltText('工作原理',{exact:true}).evaluate(img=>img.naturalWidth>0&&img.currentSrc.includes('/6a641f378537e06e7430ec90c9abf035ffa12377/docs/how-it-works.zh-CN.svg')))
  await page.screenshot({path:join(dirs.base,'..','..','readme-author-chinese-image-verified.png')})
  check('作者文档和手动AI切换没有renderer异常',errors.length===0,errors.join('; '))
 }finally{await app.close()}
}
