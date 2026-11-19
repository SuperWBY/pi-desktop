import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findExistingComputerUse } from '../src/main/existing-computer-use.ts'
const root=await mkdtemp(join(tmpdir(),'pi-existing-extension-'))
const agent=join(root,'agent'), project=join(root,'project'), custom=join(root,'My Extension')
try {
 await mkdir(join(agent,'extensions'),{recursive:true})
 await mkdir(join(project,'.pi','extensions'),{recursive:true})
 await mkdir(join(custom,'bin'),{recursive:true})
 await writeFile(join(custom,'package.json'),JSON.stringify({name:'pi-desktop-computer-use'}))
 await writeFile(join(custom,'index.ts'),"registerTool({ name: 'computer_use_observe' })")
 assert.equal(findExistingComputerUse(agent,project),undefined)
 await writeFile(join(agent,'settings.json'),JSON.stringify({extensions:[custom]}))
 assert.equal(findExistingComputerUse(agent,project),custom,'direct settings extension is preserved')
 await writeFile(join(agent,'settings.json'),'{}')
 const automatic=join(agent,'extensions','computer-use.ts')
 await writeFile(automatic,'export default function(pi) { /* name: "computer_use_observe" */ }')
 assert.equal(findExistingComputerUse(agent,project),undefined,'comments in unrelated files must not be mistaken for a configured package')
 await rm(automatic)
 const projectExt=join(project,'.pi','extensions','desktop')
 await mkdir(projectExt,{recursive:true})
 await writeFile(join(projectExt,'package.json'),JSON.stringify({name:'pi-desktop-computer-use'}))
 await writeFile(join(projectExt,'index.ts'),'export default function() {}')
 assert.equal(findExistingComputerUse(agent,project),projectExt,'project auto-discovery is preserved')
 await writeFile(join(project,'.pi','settings.json'),JSON.stringify({extensions:['-extensions/desktop/index.ts']}))
 assert.equal(findExistingComputerUse(agent,project),undefined,'excluded auto-discovered extensions must not supply the helper')
 console.log('PASS configured desktop packages: explicit paths, discovery and unrelated comments')
} finally { await rm(root,{recursive:true,force:true}) }
