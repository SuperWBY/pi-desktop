export const CREATOR_COMMAND = 'pi-desktop-creator'
export const CREATOR_KINDS = ['mode', 'context', 'subagent'] as const
export type CreatorKind = typeof CREATOR_KINDS[number]
export type CreatorDraftStatus = 'draft' | 'checked' | 'tested' | 'installed'
export interface CreatorDraft {
  id: string
  name: string
  kind: CreatorKind
  path: string
  status: CreatorDraftStatus
  fingerprint: string
  checkedFingerprint?: string
  testedFingerprint?: string
  installedFingerprint?: string
  installedSource?: string
  updatedAt: number
  commands?: string[]
  error?: string
}
export interface CreatorState {
  enabled: boolean
  root: string
  docsRoot: string | null
  drafts: CreatorDraft[]
  busy: string | null
  error?: string
}
export interface CreatedPlugin extends CreatorDraft { workspace: string; description?: string }
export interface CreatedPluginsResult { plugins: CreatedPlugin[]; warnings: { workspace: string; error: string }[] }
export type CreatorAction = { action: 'status' } | { action: 'enable' } | { action: 'disable' } |
  { action: 'create'; kind: CreatorKind; name: string } |
  { action: 'check'; id: string } | { action: 'test'; id: string } | { action: 'install'; id: string }
export interface CreatorResult { ok: boolean; error?: string }
export const isCreatorId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(value)
export function validCreatorAction(value: unknown): value is CreatorAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if(typeof item.action!=='string')return false
  if (['status', 'enable', 'disable'].includes(item.action)) return Object.keys(item).every(key => key === 'action')
  if (item.action === 'create') return Object.keys(item).every(key => ['action', 'kind', 'name'].includes(key)) && CREATOR_KINDS.includes(item.kind as CreatorKind) && isCreatorId(item.name)
  return ['check', 'test', 'install'].includes(item.action) && isCreatorId(item.id) && Object.keys(item).every(key => ['action', 'id'].includes(key))
}

export function isCreatorState(value: unknown): value is CreatorState {
  if(!value||typeof value!=='object')return false
  const state=value as CreatorState
  const path=(value:unknown):boolean=>typeof value==='string'&&value.length<=4096
  const hash=(value:unknown):boolean=>value===undefined||(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))
  return typeof state.enabled==='boolean'&&path(state.root)&&(state.docsRoot===null||path(state.docsRoot))&&(state.busy===null||isCreatorId(state.busy))&&(state.error===undefined||typeof state.error==='string')&&Array.isArray(state.drafts)&&state.drafts.length<=256&&state.drafts.every(draft=>draft&&isCreatorId(draft.id)&&typeof draft.name==='string'&&draft.name.length<=214&&CREATOR_KINDS.includes(draft.kind)&&path(draft.path)&&['draft','checked','tested','installed'].includes(draft.status)&&typeof draft.fingerprint==='string'&&hash(draft.fingerprint)&&hash(draft.checkedFingerprint)&&hash(draft.testedFingerprint)&&hash(draft.installedFingerprint)&&typeof draft.updatedAt==='number'&&(draft.error===undefined||typeof draft.error==='string')&&(draft.commands===undefined||(Array.isArray(draft.commands)&&draft.commands.length<=256&&draft.commands.every(name=>typeof name==='string'&&name.length<=256))))
}

export const CREATOR_STATE_PREFIX = 'PI_DESKTOP_CREATOR_STATE:'
export const CREATOR_RESULT_PREFIX = 'PI_DESKTOP_CREATOR_RESULT:'
/** Use supported RPC notifications; Pi intentionally redirects direct extension stdout. */
export function decodeCreatorRecord(record: Record<string, unknown>): Record<string, unknown> {
  if(record.type!=='extension_ui_request'||record.method!=='notify'||typeof record.message!=='string'||record.message.length>2*1024*1024)return record
  try{
    if(record.message.startsWith(CREATOR_STATE_PREFIX)){
      const state:unknown=JSON.parse(record.message.slice(CREATOR_STATE_PREFIX.length))
      return isCreatorState(state)?{type:'extension_ui_request',method:'creator_state',id:'pi-creator-state',state}:record
    }
    if(record.message.startsWith(CREATOR_RESULT_PREFIX)){
      const value=JSON.parse(record.message.slice(CREATOR_RESULT_PREFIX.length)) as {requestId?:unknown;result?:CreatorResult}
      if(typeof value.requestId==='string'&&value.requestId.length<=100&&typeof value.result?.ok==='boolean')return {type:'extension_ui_request',method:'creator_result',id:value.requestId,result:value.result}
    }
  }catch{ /* Malformed notifications remain ordinary, inert notification data. */ }
  return record
}
