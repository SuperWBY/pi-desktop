import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { stopCreatorChildren } from './process.ts'
import { CreatorWorkspace } from './workspace.ts'
import { CREATOR_COMMAND, CREATOR_STATE_PREFIX, CREATOR_RESULT_PREFIX, validCreatorAction, type CreatorAction, type CreatorState } from './types.ts'

const CREATOR_TOOLS = ['creator_docs', 'creator_package']
const MODE_ENTRY = 'pi-desktop-creator-mode'
export default function creatorExtension(pi: ExtensionAPI): void {
  let enabled = false
  let busy: string | null = null
  let lastError: string | undefined
  let context: ExtensionContext | undefined
  const docsRoot = (): string | null => {
    const cli = process.env.PI_DESKTOP_CREATOR_CLI
    const path = cli ? join(dirname(cli),'..','..','docs') : ''
    return path && existsSync(join(path,'extensions.md')) ? path : null
  }
  const workspace = (ctx: ExtensionContext): CreatorWorkspace => new CreatorWorkspace(ctx.cwd)
  const emit = (ctx: ExtensionContext): void => {
    if (ctx.mode !== 'rpc') return
    let state: CreatorState
    try { const local=workspace(ctx); state={enabled,root:local.root,docsRoot:docsRoot(),drafts:local.list(),busy,error:lastError} }
    catch(error) { state={enabled,root:'',docsRoot:docsRoot(),drafts:[],busy,error:error instanceof Error?error.message:String(error)} }
    ctx.ui.notify(CREATOR_STATE_PREFIX+JSON.stringify(state),'info')
  }
  const tools = (): void => {
    const current=pi.getActiveTools().filter(name=>!CREATOR_TOOLS.includes(name))
    pi.setActiveTools(enabled?[...current,...CREATOR_TOOLS]:current)
  }
  const perform = async (input: CreatorAction, ctx: ExtensionContext, signal?: AbortSignal, fromTool=false): Promise<unknown> => {
    if (!validCreatorAction(input)) throw new Error('Invalid creator action.')
    context=ctx
    if (input.action==='status') { emit(ctx); return {enabled,drafts:workspace(ctx).list()} }
    if (input.action==='enable' || input.action==='disable') {
      if (!ctx.isIdle() || busy) throw new Error('Wait for the current task to finish before changing mode.')
      const next=input.action==='enable';lastError=undefined
      if(next===enabled){emit(ctx);return {enabled}}
      const previous=enabled,active=pi.getActiveTools()
      try{enabled=next;tools();pi.appendEntry(MODE_ENTRY,{enabled})}catch(error){enabled=previous;pi.setActiveTools(active);throw error}
      emit(ctx)
      return {enabled}
    }
    if (!enabled) throw new Error('Enable Creator mode first.')
    if (busy) throw new Error('A creator operation is already running.')
    if (input.action==='install') throw new Error('Use Install and use in the Pi plugin market → My plugins.')
    if (process.env.PI_DESKTOP_CREATOR_FILES==='read-only') throw new Error('This conversation is read-only. Enable workspace writes before creating or testing a plugin.')
    if (fromTool && input.action==='test' && !['never','all'].includes(process.env.PI_DESKTOP_TOOL_APPROVAL ?? 'dangerous')) {
      if (!ctx.hasUI || !await ctx.ui.confirm('试运行插件', '将执行此草稿中的扩展代码，并沿用当前会话的文件与网络权限。是否继续？')) throw new Error('Runtime test cancelled.')
    }
    busy=input.action==='create'?input.name:input.id;lastError=undefined;emit(ctx)
    try {
      const local=workspace(ctx)
      return input.action==='create'?local.create(input.kind,input.name):input.action==='check'?local.check(input.id):await local.test(input.id,signal)
    } catch(error) { lastError=error instanceof Error?error.message:String(error); throw error }
    finally { busy=null;emit(ctx) }
  }
  pi.registerCommand(CREATOR_COMMAND, {description:'Pi Desktop creator controller',handler:async(args,ctx)=>{
    const payload=JSON.parse(args||'{}') as {requestId?:unknown;input?:unknown}
    const requestId=typeof payload.requestId==='string'&&payload.requestId.length<=100?payload.requestId:null
    let result:{ok:boolean;error?:string}
    try {
      const value=payload.input
      if(value&&typeof value==='object'&&(value as {action?:unknown}).action==='reload'){
        if(!ctx.isIdle()||busy)throw new Error('Wait for the current task to finish.')
        // Reload replaces this command's UI context. The new runtime acknowledges from session_start.
        if(requestId)process.env.PI_DESKTOP_CREATOR_RELOAD_REQUEST=requestId
        try{await ctx.reload()}catch(error){if(process.env.PI_DESKTOP_CREATOR_RELOAD_REQUEST===requestId)delete process.env.PI_DESKTOP_CREATOR_RELOAD_REQUEST;throw error}
        return
      }else{
        if(!validCreatorAction(value))throw new Error('Invalid creator action.')
        await perform(value,ctx)
      }
      result={ok:true}
    }catch(error){lastError=error instanceof Error?error.message:String(error);result={ok:false,error:lastError};emit(ctx)}
    if(requestId&&ctx.mode==='rpc')ctx.ui.notify(CREATOR_RESULT_PREFIX+JSON.stringify({requestId,result}),'info')
  }})
  pi.registerTool({
    name:'creator_docs',label:'Pi 扩展开发文档',description:'Read the installed Pi development documentation for modes, context hooks, packages, RPC or sub-agent process primitives. Only available in Creator mode.',defaultActive:false,
    parameters:Type.Object({topic:Type.Union(['overview','extensions','context','packages','rpc','subagents'].map(value=>Type.Literal(value))) }),
    async execute(_id,input,_signal,_onUpdate,_ctx) {
      if(!enabled)throw new Error('Enable Creator mode first.')
      const root=docsRoot()
      const topic=input.topic
      const file=topic==='packages'?'packages.md':topic==='rpc'?'rpc-extension-ui.md':topic==='subagents'?'cli.md':'extensions.md'
      if(!root)throw new Error('Installed Pi documentation is unavailable. Check PI_DESKTOP_CREATOR_CLI.')
      const source=readFileSync(join(root,file),'utf8')
      const headings=source.split('\n').filter(line=>/^#{1,4} /.test(line)).join('\n')
      return {content:[{type:'text',text:JSON.stringify({topic,path:join(root,file),outline:headings,guidance:'Read the relevant sections with the normal read tool. Use real Pi hooks/tools, not prompt-only simulations. Creator package templates include executable mode, context and read-only sub-agent examples.'})}],details:{path:join(root,file)}}
    }
  })
  pi.registerTool({
    name:'creator_package',label:'创建与验证 Pi 插件',description:'Create a local Pi package from a working mode, context, or subagent template; inspect drafts; check its current files; run an actual no-model Pi load test. Users install tested drafts from the Pi plugin market → My plugins.',defaultActive:false,
    parameters:Type.Object({action:Type.Union(['list','inspect','create','check','test'].map(value=>Type.Literal(value))),id:Type.Optional(Type.String()),name:Type.Optional(Type.String()),kind:Type.Optional(Type.Union(['mode','context','subagent'].map(value=>Type.Literal(value))))}),
    async execute(_id,input,signal,_onUpdate,ctx) {
      if(!enabled)throw new Error('Enable Creator mode first.')
      const value=input.action==='list'?workspace(ctx).list():input.action==='inspect'?workspace(ctx).get(input.id??''):await perform(input.action==='create'?{action:'create',kind:input.kind!,name:input.name!}:{action:input.action,id:input.id!},ctx,signal,true)
      return {content:[{type:'text',text:JSON.stringify(value)}],details:{action:input.action}}
    }
  })
  pi.on('session_start',(_event,ctx)=>{
    context=ctx;enabled=false;busy=null;lastError=undefined
    const entries=ctx.sessionManager.getEntries()
    const entry=[...entries].reverse().find(entry=>entry.type==='custom' && entry.customType===MODE_ENTRY)
    if(entry?.type==='custom')enabled=(entry.data as {enabled?:boolean})?.enabled===true
    tools();emit(ctx)
    const reloadRequest=process.env.PI_DESKTOP_CREATOR_RELOAD_REQUEST
    if(reloadRequest&&reloadRequest.length<=100){delete process.env.PI_DESKTOP_CREATOR_RELOAD_REQUEST;if(ctx.mode==='rpc')ctx.ui.notify(CREATOR_RESULT_PREFIX+JSON.stringify({requestId:reloadRequest,result:{ok:true}}),'info')}
  })
  pi.on('before_agent_start',event=>enabled?{systemPrompt:event.systemPrompt+`\n\nCreator mode is active. Build reusable Pi capabilities: real tool/command modes, non-destructive context hooks, and independent sub-agents. Read creator_docs for the installed API before coding. Use creator_package to scaffold inside the current workspace, edit its actual source with normal tools, check and run its current revision. Give the package a useful description of the requested feature in the user’s language; replace generic template wording. Runtime loading is not behavioral verification: exercise the requested functionality and report remaining limits. Preserve other extensions, current model and permissions. A sub-agent must have bounded runtime/output, cancellation and a real executor; the starter is read-only. Never claim UI hooks unsupported by RPC work. Do not rewrite Pi Desktop core or global settings to simulate a plugin. Tested drafts are installed explicitly from the Pi plugin market → My plugins. Do not publish or upload packages without a request. Draft root: ${context?workspace(context).root:''}.`}:undefined)
  pi.on('tool_call',event=>CREATOR_TOOLS.includes(event.toolName)&&!enabled?{block:true,reason:'Creator mode is off.'}:undefined)
  pi.on('agent_settled',()=>{if(context&&enabled)emit(context)})
  pi.on('session_shutdown',()=>{stopCreatorChildren()})
}
