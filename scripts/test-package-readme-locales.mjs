import assert from 'node:assert/strict'
import { localizePackageReadme, readmeLanguage } from '../src/main/package-readme-locales.ts'
const sha='a'.repeat(40)
const original={markdown:'# Original',fileName:'README.md',source:'npm-cdn',url:'https://cdn.jsdelivr.net/npm/demo@1.0.0/README.md',baseUrl:'https://cdn.jsdelivr.net/npm/demo@1.0.0/',versionMatched:true}
let checks=0
async function test(label,run){await run();checks++;console.log('✓ '+label)}
function harness(handler,extra={}){const calls=[];return {calls,load:language=>localizePackageReadme({name:'demo',version:'1.0.0',language,original,github:'owner/demo',directory:'',gitHead:sha,read:async url=>{calls.push(url);return handler(url)},...extra})}}
await test('Recognizes author filename conventions without claiming default README language',()=>{
 for(const p of ['README.zh-CN.md','README_CN.md','README_zh.md','README.zh_Hans.md','docs/zh-CN/README.md'])assert.equal(readmeLanguage(p),'zh-CN',p)
 for(const p of ['README.en.md','README_EN.md','README.en-US.md'])assert.equal(readmeLanguage(p),'en',p)
 assert.equal(readmeLanguage('README.md'),undefined)
 assert.equal(readmeLanguage('README.zh-TW.md'),undefined)
})
await test('Uses actual published author Chinese file, pinned version and correct image base',async()=>{
 const h=harness(url=>url.includes('/flat')?JSON.stringify({files:[{name:'/README_CN.md'},{name:'/node_modules/a/README.zh-CN.md'}]}):url.endsWith('/README_CN.md')?'# 作者中文文档':null)
 const r=await h.load('zh-CN');assert.equal(r.markdown,'# 作者中文文档');assert.equal(r.fileName,'README_CN.md');assert.equal(r.language,'zh-CN');assert.equal(r.localizationStatus,'matched');assert.equal(r.baseUrl,original.baseUrl);assert.equal(r.versionMatched,true);assert.equal(h.calls.length,2)
})
await test('Keeps original when no author translation exists',async()=>{
 const h=harness(url=>url.includes('/flat')?JSON.stringify({files:[{name:'/README.md'}]}):'[]')
 const r=await h.load('zh-CN');assert.equal(r.markdown,original.markdown);assert.equal(r.localizationStatus,'not-found');assert.equal(r.language,undefined)
})
await test('Network failure is distinguishable from missing author language',async()=>{
 const h=harness(()=>{throw Error('offline')});const r=await h.load('zh-CN');assert.equal(r.markdown,original.markdown);assert.equal(r.localizationStatus,'unavailable')
})
await test('Repository-only author file stays pinned to release commit',async()=>{
 const url=`https://raw.githubusercontent.com/owner/demo/${sha}/README.zh-CN.md`
 const h=harness(u=>u.includes('/flat')?JSON.stringify({files:[]}):u.includes('/contents')?JSON.stringify([{type:'file',path:'README.zh-CN.md',download_url:url}]):u===url?'# 中文':null)
 const r=await h.load('zh-CN');assert.equal(r.source,'github');assert.equal(r.versionMatched,true);assert.ok(h.calls.some(u=>u.endsWith('?ref='+sha)))
})
await test('Rejects directory traversal, dependencies and a different repository/commit',async()=>{
 const h=harness(u=>u.includes('/flat')?JSON.stringify({files:[{name:'/../README_CN.md'},{name:'/node_modules/a/README_CN.md'}]}):JSON.stringify([{type:'file',path:'README_CN.md',download_url:'https://raw.githubusercontent.com/other/repo/main/README_CN.md'}]))
 const r=await h.load('zh-CN');assert.equal(r.markdown,original.markdown);assert.equal(h.calls.length,2)
})
await test('Preserves nested README directory and prefers sibling over unrelated docs',async()=>{
 const h=harness(u=>u.includes('/flat')?JSON.stringify({files:[{name:'/docs/en/README.md'},{name:'/guides/README_EN.md'}]}):u.endsWith('/guides/README_EN.md')?'# English':null,{original:{...original,fileName:'guides/README.md'}})
 const r=await h.load('en');assert.equal(r.fileName,'guides/README_EN.md');assert.equal(r.baseUrl,original.baseUrl+'guides/')
})
await test('GitHub monorepo original uses package-relative discovery, with encoded directory names',async()=>{
 const directory='packages/my plugin'
 const path=directory+'/docs/README.zh-CN.md'
 const url=`https://raw.githubusercontent.com/owner/demo/${sha}/packages/my%20plugin/docs/README.zh-CN.md`
 const h=harness(u=>u.includes('/flat')?JSON.stringify({files:[]}):u.includes('/contents/packages/my%20plugin/docs?')?JSON.stringify([{type:'file',path,download_url:url}]):u.includes('/contents')?'[]':u===url?'# 作者中文':null,{directory:'packages/my%20plugin',original:{...original,source:'github',fileName:directory+'/docs/README.md'}})
 const r=await h.load('zh-CN');assert.equal(r.fileName,path);assert.equal(r.markdown,'# 作者中文');assert.ok(h.calls.every(u=>!u.includes('/packages/my%20plugin/packages/')))
})
await test('An explicit author language link is loaded before the package file index',async()=>{
 const h=harness(u=>u.endsWith('/docs/README.zh-CN.md')?'# 作者文档':null,{original:{...original,markdown:'[中文][zh]\n\n[zh]: docs/README.zh-CN.md'}})
 const r=await h.load('zh-CN');assert.equal(r.fileName,'docs/README.zh-CN.md');assert.equal(h.calls.length,1)
})
await test('Finds repository-only docs language folders without scanning other packages',async()=>{
 const path='docs/zh-CN/README.md',url=`https://raw.githubusercontent.com/owner/demo/${sha}/${path}`
 const h=harness(u=>u.includes('/flat')?JSON.stringify({files:[]}):u.includes('/contents?')?JSON.stringify([{type:'dir',path:'docs'},{type:'dir',path:'packages'}]):u.includes('/contents/docs?')?JSON.stringify([{type:'dir',path:'docs/zh-CN'}]):u.includes('/contents/docs/zh-CN?')?JSON.stringify([{type:'file',path,download_url:url}]):u===url?'# 仓库中文':null)
 const r=await h.load('zh-CN');assert.equal(r.markdown,'# 仓库中文');assert.equal(r.fileName,path);assert.ok(h.calls.every(u=>!u.includes('/contents/packages')))
})
await test('HTML language selector wins over an unrelated benchmark translation link',async()=>{
 const h=harness(u=>u.endsWith('/README.zh-CN.md')?'# 正文中文':null,{original:{...original,markdown:'<p><a href="./README.md">English</a> | <a href="./README.zh-CN.md">中文</a></p>\n\n[中文版](benchmarks/third-party/README.zh-CN.md)'}})
 const r=await h.load('zh-CN');assert.equal(r.fileName,'README.zh-CN.md');assert.equal(h.calls.length,1)
 const en=await h.load('en');assert.equal(en.markdown.includes('<p>'),true);assert.equal(en.language,'en');assert.equal(en.fileName,'README.md');assert.equal(h.calls.length,1)
})
await test('Supports language folders at the package root',async()=>{
 const h=harness(u=>u.includes('/flat')?JSON.stringify({files:[{name:'/zh-CN/README.md'}]}):u.endsWith('/zh-CN/README.md')?'# 根目录中文':null)
 const r=await h.load('zh-CN');assert.equal(r.fileName,'zh-CN/README.md')
})
console.log(`${checks} author README localization checks passed`)
