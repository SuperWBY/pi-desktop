import { createHash, randomUUID } from 'node:crypto'
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CreatorWorkspace } from '../../extensions/creator/workspace.ts'
import type { CreatedPluginsResult } from '../../extensions/creator/types.ts'
import { realpathSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { CREATOR_LIMITS } from '../../extensions/creator/config.ts'

function pluginDescription(path: string): string | undefined {
  let file: number | undefined
  try {
    file = openSync(join(path, 'package.json'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stat = fstatSync(file)
    if (!stat.isFile() || stat.size > CREATOR_LIMITS.fileBytes) return
    const content = Buffer.alloc(CREATOR_LIMITS.fileBytes + 1)
    let length = 0, count = 0
    do { count = readSync(file, content, length, content.length - length, null); length += count } while (count && length < content.length)
    if (length > CREATOR_LIMITS.fileBytes) return
    const manifest = JSON.parse(content.subarray(0, length).toString('utf8'))
    return typeof manifest.description === 'string' ? manifest.description.trim() : undefined
  } catch { return undefined } // An unfinished manifest must not hide a draft.
  finally { if (file !== undefined) closeSync(file) }
}

/** Read only known project roots; browsing the market never loads extension code. */
export async function listCreatedPlugins(workspaces: string[]): Promise<CreatedPluginsResult> {
  const result: CreatedPluginsResult = { plugins: [], warnings: [] }
  const seen = new Set<string>()
  for (const cwd of workspaces) {
    try {
      if (!existsSync(join(cwd, '.pi', 'creator'))) continue
      const workspace = realpathSync(cwd)
      if (seen.has(workspace)) continue
      seen.add(workspace)
      result.plugins.push(...new CreatorWorkspace(workspace).list().map(draft => ({ ...draft, workspace, description: pluginDescription(draft.path) })))
    } catch (error) {
      result.warnings.push({ workspace: cwd, error: error instanceof Error ? error.message : String(error) })
    }
    await setImmediate()
  }
  result.plugins.sort((a, b) => b.updatedAt - a.updatedAt)
  return result
}

/** Install only the exact tested bytes; keep the working draft separate from the active package. */
export async function installCreatorDraft(options: {
  cwd: string; id: string; storage: string;
  install: (source: string) => Promise<{ok:boolean;error?:string}>;
  verify: (source: string, name: string) => Promise<string | null>;
  isConfigured: (source: string) => boolean;
  rollback: (source: string) => Promise<{ok:boolean;error?:string}>;
}): Promise<{source:string;fingerprint:string;warning?:string}> {
  const workspace=new CreatorWorkspace(options.cwd)
  const {draft,files}=workspace.testedFiles(options.id)
  const scope=createHash('sha256').update(workspace.cwd).digest('hex').slice(0,16)
  const root=join(options.storage,`${scope}-${draft.id}`), active=join(root,'active'), backup=join(root,`.previous-${randomUUID()}`), stage=join(root,`.prepare-${randomUUID()}`)
  for (const directory of [options.storage,root,active]) if(existsSync(directory)&&lstatSync(directory).isSymbolicLink())throw new Error('Creator installation directories cannot be symbolic links.')
  mkdirSync(stage,{recursive:true,mode:0o700})
  const wasConfigured=options.isConfigured(active)
  let replaced=false, activated=false
  try {
    for(const file of files){const path=join(stage,file.relative);mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,file.content,{mode:0o600,flag:'wx'})}
    if(existsSync(active)){renameSync(active,backup);replaced=true}
    renameSync(stage,active);activated=true
    const result=await options.install(active)
    if(!result.ok)throw new Error(result.error||'Plugin installation failed.')
    const configuredSource=await options.verify(active,draft.name)
    if(!configuredSource)throw new Error('Pi did not report this plugin as installed. The previous plugin version has been restored.')
    let warning:string|undefined
    try{workspace.markInstalled(draft.id,draft.fingerprint,configuredSource)}catch(error){warning=error instanceof Error?error.message:String(error)}
    // Retain the preceding working version for recovery; overwrite it only after a successful install.
    if(replaced){const previous=join(root,'previous');rmSync(previous,{recursive:true,force:true});renameSync(backup,previous)}
    return {source:active,fingerprint:draft.fingerprint,warning}
  }catch(error){
    let rollbackError:string|undefined
    if(activated&&!wasConfigured){
      try{const result=await options.rollback(active);if(!result.ok)rollbackError=result.error||'Failed to remove the new package declaration.'}catch(failure){rollbackError=failure instanceof Error?failure.message:String(failure)}
    }
    // If configuration compensation fails, keep the tested snapshot so no package points at a deleted directory.
    if(rollbackError&&!replaced)throw new Error(`${error instanceof Error?error.message:String(error)} Configuration rollback failed: ${rollbackError}. The tested snapshot was retained at ${active}.`)
    if(activated)rmSync(active,{recursive:true,force:true})
    if(replaced&&existsSync(backup))renameSync(backup,active)
    throw error
  }finally{rmSync(stage,{recursive:true,force:true})}
}
