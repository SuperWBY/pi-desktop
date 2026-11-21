import type { CreatorKind } from './types.ts'

export function creatorTemplate(kind: CreatorKind, id: string): Record<string, string> {
  const manifest = JSON.stringify({ name: `pi-created-${id}`, version: '0.1.0', description: `${kind} extension created with Pi`, type: 'module', keywords: ['pi-package'], pi: { extensions: ['./extension.ts'] }, peerDependencies: { '@earendil-works/pi-coding-agent': '*', typebox: '*' } }, null, 2)
  let extension = ''
  if (kind === 'mode') extension = `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
const READ_ONLY_TOOLS = ['read', 'grep', 'find', 'ls']
export default function(pi: ExtensionAPI) {
  let enabled = false
  let previous: string[] = []
  pi.registerCommand('${id}', {
    description: 'Toggle the ${id} read-only planning mode',
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) throw new Error('Wait for the current task to finish.')
      const next = args.trim() === 'off' ? false : args.trim() === 'on' ? true : !enabled
      if (next === enabled) return
      if (next) { previous = pi.getActiveTools(); pi.setActiveTools(READ_ONLY_TOOLS) }
      else pi.setActiveTools(previous)
      enabled = next
      ctx.ui.notify('${id}: ' + (enabled ? 'on' : 'off'), 'info')
    }
  })
  pi.on('before_agent_start', event => enabled ? { systemPrompt: event.systemPrompt + '\\nPlanning mode: inspect and explain the plan before making any changes. Only read-only tools are allowed.' } : undefined)
  pi.on('tool_call', event => enabled && !READ_ONLY_TOOLS.includes(event.toolName) ? { block: true, reason: '${id} allows read-only tools only.' } : undefined)
}
`
  if (kind === 'context') extension = `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
// This projects tool text for the next model request; the original session history is preserved.
const MAX_TOOL_TEXT = 4000
export default function(pi: ExtensionAPI) {
  let shortened = 0
  pi.on('context', event => ({ messages: event.messages.map(message => {
    if (message.role !== 'toolResult' || message.isError) return message
    const content = message.content.map(block => {
      if (block.type !== 'text' || block.text.length <= MAX_TOOL_TEXT) return block
      shortened++
      return { ...block, text: block.text.slice(0, MAX_TOOL_TEXT) + '\\n[Tool output shortened for this request; full output remains in session history. Read a targeted file range when needed.]' }
    })
    return { ...message, content }
  }) }))
  pi.registerCommand('${id}', { description: 'Show context projection statistics', handler: async (_args, ctx) => { ctx.ui.notify('Shortened tool text blocks: ' + shortened, 'info') } })
}
`
  if (kind === 'subagent') extension = `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { runReadOnlySubagent } from './subagent.ts'
import { stopCreatorChildren } from './process.ts'
export default function(pi: ExtensionAPI) {
  pi.on('session_shutdown', () => stopCreatorChildren())
  pi.registerTool({
    name: '${id.replaceAll('-', '_')}_delegate', label: '${id}',
    description: 'Delegate one bounded read-only research task to an independent Pi agent. No shell, writes, MCP, extensions, or further delegation.',
    parameters: Type.Object({ task: Type.String({ minLength: 1, maxLength: 12000 }) }),
    async execute(_callId, input, signal, onUpdate, ctx) {
      if (!ctx.model) throw new Error('Select a model before delegating a task.')
      onUpdate?.({ content: [{ type: 'text', text: 'Sub-agent running…' }], details: { status: 'running' } })
      const result = await runReadOnlySubagent({ task: input.task, cwd: ctx.cwd, provider: ctx.model.provider, model: ctx.model.id, signal })
      return { content: [{ type: 'text', text: result }], details: { status: 'done' } }
    }
  })
  pi.registerCommand('${id}', { description: 'Describe the read-only sub-agent', handler: async (_args, ctx) => { ctx.ui.notify('Use the ${id.replaceAll('-', '_')}_delegate tool to delegate a read-only task.', 'info') } })
}
`
  return {
    'package.json': `${manifest}\n`, 'extension.ts': extension,
    'README.md': `# ${id}\n\nA working Pi ${kind} extension.\n\n${kind === 'mode' ? `Use /${id} on or /${id} off. The mode changes actual active tools and blocks non-read-only calls.` : kind === 'context' ? `Long tool text is shortened only in the next provider request. Original session history, tool-call IDs, errors, and non-text content are preserved. /${id} shows statistics.` : `Ask Pi to delegate a read-only task using ${id.replaceAll('-', '_')}_delegate. It starts a separate Pi process with the current model, bounded runtime/output and cancellation. It does not inherit parent conversation history or write tools.`}\n\nEdit extension.ts, check it, run the runtime test, then install. A load test verifies registration, not the correctness of every possible behavior.\n`,
    'README.zh-CN.md': `# ${id}\n\n通过 Pi 创意模式创建的${kind === 'mode' ? '工作模式' : kind === 'context' ? '上下文处理' : '子 Agent'}扩展。\n\n${kind === 'mode' ? `使用 /${id} on 开启，/${id} off 关闭。开启后实际切换工具集合并阻止写入类工具。` : kind === 'context' ? `仅缩短下一次模型请求中的长工具文本，保留原始会话历史、调用关联、错误和非文本内容。/${id} 查看统计。` : `调用 ${id.replaceAll('-', '_')}_delegate 委派只读任务。子 Agent 使用独立 Pi 进程和当前模型，支持超时与取消；不继承父对话内容、写入工具、MCP 或扩展。`}\n\n修改后先检查、试运行，再安装。加载测试只证明插件能够注册，不代表所有行为已经验收。\n`
  }
}
