import {mkdtempSync,readFileSync,readdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {creatorTemplate} from '../extensions/creator/templates.ts'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'pi-creator-types-'))
try{
 const versions=readdirSync(join(root,'build/pi-seed')).filter(name=>/^\d+\.\d+\.\d+$/.test(name)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))
 if(!versions.length)throw Error('Prepare the bundled Pi seed before checking extension types.')
 const modules=join(root,'build/pi-seed',versions[0],'node_modules')
 const pkg=join(modules,'@earendil-works/pi-coding-agent')
 const manifest=JSON.parse(readFileSync(join(pkg,'package.json')))
 const typebox=join(modules,'typebox'),boxManifest=JSON.parse(readFileSync(join(typebox,'package.json')))
 for(const kind of ['mode','context','subagent'])writeFileSync(join(temp,`template-${kind}.ts`),creatorTemplate(kind,'typecheck-example')['extension.ts'].replace("'./subagent.ts'",JSON.stringify(join(root,'extensions/creator/subagent.ts'))).replace("'./process.ts'",JSON.stringify(join(root,'extensions/creator/process.ts'))))
 const config={extends:join(root,'tsconfig.node.json'),compilerOptions:{types:['node'],paths:{'@earendil-works/pi-coding-agent':[join(pkg,manifest.types)],typebox:[join(typebox,boxManifest.types)]},typeRoots:[join(root,'node_modules/@types')]},include:[join(root,'extensions/creator/**/*.ts'),join(temp,'template-*.ts')]}
 writeFileSync(join(temp,'tsconfig.json'),JSON.stringify(config))
 execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','-p',join(temp,'tsconfig.json')],{stdio:'inherit'})
 console.log(`✓ Creator controller and all three templates match installed Pi ${manifest.version} types`)
}finally{rmSync(temp,{recursive:true,force:true})}
