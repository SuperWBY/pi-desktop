import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { CREATOR_LIMITS, isolatedPiArgs } from './config.ts'
import { isCreatorId, type CreatorDraft, type CreatorKind } from './types.ts'
import { creatorTemplate } from './templates.ts'
import { runCreatorPi } from './process.ts'

export function atomicCreatorJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomUUID()}.tmp`
  try { writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); renameSync(temp, path) }
  finally { rmSync(temp, { force: true }) }
}
const inside = (root: string, target: string): boolean => { const path = relative(root, target); return path === '' || (!path.startsWith('..') && !isAbsolute(path)) }

function configured(source:unknown):boolean {
  if(typeof source!=='string')return false
  try{
    const path=join(process.env.PI_CODING_AGENT_DIR||join(homedir(),'.pi','agent'),'settings.json')
    if(statSync(path).size>CREATOR_LIMITS.fileBytes)return false
    const value=JSON.parse(readFileSync(path,'utf8')) as {packages?:unknown}
    return Array.isArray(value.packages)&&value.packages.some(item=>typeof item==='string'?item===source:Boolean(item&&typeof item==='object'&&item.source===source))
  }catch{return false}
}

function fingerprintFiles(files:{relative:string;content:Buffer}[]):string {
  const hash=createHash('sha256')
  for(const file of files)hash.update(file.relative).update('\0').update(file.content).update('\0')
  return hash.digest('hex')
}

export class CreatorWorkspace {
  readonly root: string
  readonly cwd: string
  constructor(cwd: string) { this.cwd = realpathSync(cwd); this.root = join(this.cwd, '.pi', 'creator') }
  private safeRoot(): void {
    let target = realpathSync(this.cwd)
    for (const part of ['.pi', 'creator', 'packages', 'drafts']) {
      target = part === 'drafts' ? join(this.root, part) : join(target, part)
      if (existsSync(target) && (!lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink() || !inside(realpathSync(this.cwd), realpathSync(target)))) throw new Error('Creator directories must be real directories inside the current workspace.')
    }
  }
  packagePath(id: string): string {
    if (!isCreatorId(id)) throw new Error('Use 2–64 lowercase letters, numbers or hyphens; start with a letter.')
    this.safeRoot()
    const path = join(this.root, 'packages', id)
    if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink() || !inside(this.root, realpathSync(path)))) throw new Error('Plugin path escapes the creator workspace.')
    return path
  }
  private metadataPath(id: string): string { this.packagePath(id); return join(this.root, 'drafts', `${id}.json`) }
  private files(id: string): { path: string; relative: string; content: Buffer }[] {
    const root = this.packagePath(id), files: {path: string; relative: string; content: Buffer}[] = []
    let bytes = 0, entries = 0
    const visit = (path: string): void => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.name === '.git') continue
        if (++entries > CREATOR_LIMITS.files) throw new Error('Plugin exceeds PI_CREATOR_FILE_COUNT.')
        const file = join(path, entry.name)
        if (lstatSync(file).isSymbolicLink() || !inside(root, realpathSync(file))) throw new Error('Plugin files cannot contain symbolic links or escape the package.')
        if (entry.isDirectory()) visit(file)
        else if (entry.isFile()) {
          const size = statSync(file).size
          if (size > CREATOR_LIMITS.fileBytes || bytes + size > CREATOR_LIMITS.packageBytes) throw new Error('Plugin exceeds PI_CREATOR_FILE_BYTES / PI_CREATOR_PACKAGE_BYTES.')
          const content = readFileSync(file); bytes += content.byteLength
          if (content.byteLength > CREATOR_LIMITS.fileBytes || bytes > CREATOR_LIMITS.packageBytes) throw new Error('Plugin changed beyond its read limit.')
          files.push({ path:file, relative:relative(root, file).replaceAll('\\', '/'), content })
        } else throw new Error('Unsupported plugin file type.')
      }
    }
    visit(root)
    return files.sort((a,b)=>a.relative.localeCompare(b.relative))
  }
  fingerprint(id: string): string {
    return fingerprintFiles(this.files(id))
  }
  get(id: string): CreatorDraft {
    const metadata = this.metadataPath(id)
    if (!existsSync(metadata) || lstatSync(metadata).isSymbolicLink() || statSync(metadata).size > CREATOR_LIMITS.fileBytes) throw new Error('Plugin draft metadata is unavailable.')
    const value = JSON.parse(readFileSync(metadata, 'utf8')) as CreatorDraft
    if (value.id !== id || !['mode','context','subagent'].includes(value.kind)) throw new Error('Invalid plugin draft metadata.')
    const fingerprint = this.fingerprint(id)
    const status = value.installedFingerprint === fingerprint && configured(value.installedSource) ? 'installed' : value.testedFingerprint === fingerprint ? 'tested' : value.checkedFingerprint === fingerprint ? 'checked' : 'draft'
    const hash=(value:unknown):string|undefined=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:undefined
    return { id, kind:value.kind, name:typeof value.name==='string'&&value.name.length<=214?value.name:`pi-created-${id}`, path:this.packagePath(id), fingerprint, status,
      checkedFingerprint:hash(value.checkedFingerprint), testedFingerprint:hash(value.testedFingerprint), installedFingerprint:hash(value.installedFingerprint), installedSource:typeof value.installedSource==='string'?value.installedSource:undefined,
      updatedAt:typeof value.updatedAt==='number'&&Number.isFinite(value.updatedAt)?value.updatedAt:0,
      commands:Array.isArray(value.commands)?value.commands.filter((name):name is string=>typeof name==='string'&&name.length<=256).slice(0,256):undefined,
      error:typeof value.error==='string'?value.error.slice(0,3000):undefined }
  }
  list(): CreatorDraft[] {
    this.safeRoot()
    const directory = join(this.root, 'drafts')
    if (!existsSync(directory)) return []
    return readdirSync(directory).filter(name=>name.endsWith('.json') && isCreatorId(name.slice(0,-5))).slice(0,CREATOR_LIMITS.files).map(name=>{
      try { return this.get(name.slice(0,-5)) } catch { return null }
    }).filter((value): value is CreatorDraft=>Boolean(value)).sort((a,b)=>b.updatedAt-a.updatedAt)
  }
  private save(draft: CreatorDraft): CreatorDraft { atomicCreatorJson(this.metadataPath(draft.id), { ...draft, updatedAt:Date.now() }); return this.get(draft.id) }
  create(kind: CreatorKind, id: string): CreatorDraft {
    if (!['mode','context','subagent'].includes(kind)) throw new Error('Unknown plugin template.')
    const path = this.packagePath(id)
    if (existsSync(path) || existsSync(this.metadataPath(id))) throw new Error('A draft with this name already exists. Choose another name.')
    mkdirSync(dirname(path), {recursive:true, mode:0o700})
    const temp = mkdtempSync(join(dirname(path), '.create-'))
    try {
      const files = creatorTemplate(kind,id)
      if (kind === 'subagent') for (const name of ['config.ts','process.ts','subagent.ts']) files[name] = readFileSync(new URL(`./${name}`, import.meta.url),'utf8')
      for (const [name,content] of Object.entries(files)) writeFileSync(join(temp,name), content, {encoding:'utf8',mode:0o600,flag:'wx'})
      renameSync(temp,path)
    } finally { rmSync(temp,{recursive:true,force:true}) }
    return this.save({id,name:`pi-created-${id}`,kind,path,status:'draft',fingerprint:this.fingerprint(id),updatedAt:Date.now()})
  }
  check(id: string): CreatorDraft {
    const draft = this.get(id), files = this.files(id)
    if(fingerprintFiles(files)!==draft.fingerprint)throw new Error('Plugin changed while reading its files. Check again.')
    const raw = files.find(file=>file.relative==='package.json')
    if (!raw) throw new Error('Plugin needs package.json.')
    const manifest = JSON.parse(raw.content.toString('utf8')) as {name?:unknown; version?:unknown; scripts?:unknown; pi?:{extensions?:unknown}}
    if (typeof manifest.name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(manifest.name) || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version)) throw new Error('Plugin needs a valid npm name and version.')
    if (manifest.scripts && Object.keys(manifest.scripts).some(name=>['preinstall','install','postinstall','prepare'].includes(name))) throw new Error('Creator drafts cannot run package installation scripts. Remove these scripts before installing.')
    const entries = manifest.pi?.extensions
    if (!Array.isArray(entries) || !entries.length || entries.length > 16) throw new Error('Declare explicit extension entry files in package.json pi.extensions.')
    for (const entry of entries) {
      if (typeof entry !== 'string' || isAbsolute(entry) || entry.includes('\\') || !/\.(?:[cm]?js|ts)$/.test(entry) || !inside(draft.path,resolve(draft.path,entry)) || !files.some(file=>file.path===resolve(draft.path,entry))) throw new Error('Every extension entry must be an existing file inside this plugin.')
    }
    const result=this.save({...draft,name:manifest.name,checkedFingerprint:draft.fingerprint,error:undefined})
    if(result.fingerprint!==draft.fingerprint)throw new Error('Plugin changed during checks. Check again.')
    return result
  }
  async test(id: string, signal?: AbortSignal): Promise<CreatorDraft> {
    const checked = this.check(id)
    const files=this.files(id)
    if(fingerprintFiles(files)!==checked.fingerprint)throw new Error('Plugin changed before the runtime test. Check again.')
    const testRoot = mkdtempSync(join(this.root,'.test-'))
    const marker = 'PI_CREATOR_PROBE:'
    // This observer reports actual registrations after the candidate loads; it never asks the model.
    const probe = `export default function(pi) { pi.on('session_start', (_event,ctx) => ctx.ui.notify('${marker}'+JSON.stringify({commands:pi.getCommands(),tools:pi.getAllTools().map(t=>({name:t.name,sourceInfo:t.sourceInfo}))}),'info')) }`
    try {
      const snapshot=join(testRoot,'package');mkdirSync(snapshot,{mode:0o700})
      for(const file of files){const path=join(snapshot,file.relative);mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,file.content,{mode:0o600,flag:'wx'})}
      const file=join(testRoot,'probe.mjs');writeFileSync(file,probe,{mode:0o600,flag:'wx'})
      const result=await runCreatorPi({cwd:this.cwd, signal, timeout:CREATOR_LIMITS.testMs,
        args:['--mode','rpc',...isolatedPiArgs,'--offline','--tools','read,grep,find,ls','--extension',snapshot,'--extension',file], input:[{id:'creator-state',type:'get_state'}],
        accept:record=>record.type==='extension_ui_request' && record.method==='notify' && String(record.message).startsWith(marker)})
      const notification=result.records.find(record=>String(record.message).startsWith(marker))
      const report=JSON.parse(String(notification?.message).slice(marker.length)) as {commands:{name:string;sourceInfo?:{path?:string}}[];tools:{name:string;sourceInfo?:{path?:string}}[]}
      const belongs = (item:{sourceInfo?:{path?:string}}): boolean => typeof item.sourceInfo?.path==='string' && inside(snapshot,resolve(item.sourceInfo.path))
      const commands=report.commands.filter(belongs).map(item=>item.name)
      const tools=report.tools.filter(belongs).map(item=>item.name)
      if (!commands.length && !tools.length) throw new Error('No plugin command or tool was registered. Fix extension loading, or add a diagnostic command for a hook-only plugin.')
      if (this.fingerprint(id)!==checked.fingerprint) throw new Error('Plugin changed during the runtime test. Run the test again.')
      return this.save({...checked,testedFingerprint:checked.fingerprint,commands:[...commands,...tools],error:undefined})
    } catch(error) {
      this.save({...checked,testedFingerprint:undefined,error:error instanceof Error?error.message:String(error)})
      throw error
    } finally { rmSync(testRoot,{recursive:true,force:true}) }
  }
  testedFiles(id:string): { draft:CreatorDraft; files:{relative:string;content:Buffer}[] } {
    const draft=this.check(id)
    if(draft.testedFingerprint!==draft.fingerprint)throw new Error('Run the current plugin version before installing it.')
    const files=this.files(id).map(({relative,content})=>({relative,content}))
    if(fingerprintFiles(files)!==draft.fingerprint)throw new Error('Plugin changed while preparing the installation snapshot. Test again.')
    return {draft,files}
  }
  markInstalled(id:string,fingerprint:string,source:string):CreatorDraft {
    const draft=this.get(id)
    if(draft.fingerprint!==fingerprint)throw new Error('Plugin changed during installation. Installed snapshot is preserved; test the new draft before updating.')
    return this.save({...draft,installedFingerprint:fingerprint,installedSource:source,error:undefined})
  }
}
