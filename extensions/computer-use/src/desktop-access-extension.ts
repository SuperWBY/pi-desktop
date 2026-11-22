import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from '@earendil-works/pi-coding-agent'
import { desktopToolBlockReason } from './desktop-access-policy.ts'
import { dangerousCommand } from './tool-guard.ts'
import computerUse from '../index.ts'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerContextReport } from './context-report.ts'

export default function desktopAccessExtension(pi: ExtensionAPI): void {
  registerContextReport(pi)
  let initialized = false
  const reportHelper = (provisional: boolean): void => {
    if (!process.env.PI_DESKTOP_TOOL_INFO_FILE) return
    const target = pi.getAllTools().find((tool) => ['computer_use_observe', 'computer_use_act', 'computer_use_batch'].includes(tool.name))
    const source = target?.sourceInfo?.path
    const ownSource = fileURLToPath(import.meta.url)
    const root = !target || source === ownSource ? fileURLToPath(new URL('../', import.meta.url)) : typeof source === 'string' && isAbsolute(source) ? dirname(source) : ''
    const helper = join(root, 'bin', process.platform === 'win32' ? 'computer-use-helper.ps1' : 'computer-use-helper')
    writeFileSync(process.env.PI_DESKTOP_TOOL_INFO_FILE, JSON.stringify({ helperRoot: root && existsSync(helper) ? root : null, provisional }), { mode: 0o600 })
  }
  pi.registerCommand('pi-desktop-access-status', { description: 'Check the active desktop access component.', handler: async () => { reportHelper(true) } })
  pi.on('agent_start', () => {
    const tools = pi.getAllTools()
    const existing = new Set(tools.map((tool) => tool.name))
    const groups = [
      ['computer_use_observe', 'computer_use_act', 'computer_use_batch', 'computer_use_desktop_reconcile'],
      ['computer_use_session_open', 'computer_use_session_observe', 'computer_use_session_act', 'computer_use_session_wait', 'computer_use_session_read', 'computer_use_session_verify_file', 'computer_use_session_cancel_file', 'computer_use_session_downloads', 'computer_use_session_takeover', 'computer_use_session_close'],
      ['computer_use_browser_observe', 'computer_use_browser_act'],
      ['computer_use_cdp_observe', 'computer_use_cdp_act', 'computer_use_cdp_close'],
      ['computer_use_chrome_observe', 'computer_use_chrome_act']
    ]
    const claimed = new Set(groups.filter((group) => group.some((name) => existing.has(name))).flat())
    const useBundledDesktop = !groups[0].some((name) => existing.has(name))
    if (!useBundledDesktop) { claimed.add('computer_use_apps'); claimed.add('computer_use_permissions') }
    if (groups[1].some((name) => existing.has(name))) claimed.add('computer_use_session_judge')
    const fallback = new Proxy(pi, {
      get(target, property, receiver) {
        if (property === 'registerTool') return (tool: Parameters<ExtensionAPI['registerTool']>[0]) => {
          if (!claimed.has(tool.name) && !existing.has(tool.name)) target.registerTool(tool)
        }
        return Reflect.get(target, property, receiver)
      }
    })
    if (!initialized) { computerUse(fallback); initialized = true }
    reportHelper(false)
  })
  pi.on('tool_call', async (event: ToolCallEvent, ctx: ExtensionContext) => {
    let network = process.env.PI_DESKTOP_NETWORK
    if (process.env.PI_DESKTOP_NETWORK_STATE_FILE) {
      try { network = JSON.parse(readFileSync(process.env.PI_DESKTOP_NETWORK_STATE_FILE, 'utf8')).network } catch { network = 'off' }
    }
    if (network === 'off' && event.toolName.startsWith('computer_use_')) {
      return { block: true, reason: 'Networking is off for this conversation. Enable networking to use browser and computer tools.' }
    }
    const mode = process.env.PI_DESKTOP_TOOL_APPROVAL ?? 'dangerous'
    const readOnly = ['read', 'grep', 'find', 'ls', 'computer_use_observe', 'computer_use_session_observe', 'computer_use_browser_observe', 'computer_use_cdp_observe', 'computer_use_chrome_observe'].includes(event.toolName)
    if (mode === 'all') {
      if (!ctx.hasUI && !readOnly) return { block: true, reason: 'This tool requires approval, but the task has no interactive UI.' }
      if (ctx.hasUI) {
        const input = JSON.stringify(event.input).slice(0, 1200)
        const approved = await ctx.ui.confirm(
          '确认执行工具',
          `工具：${event.toolName}\n\n${input}\n\n只在你确认这次调用安全时继续。`
        )
        if (!approved) return { block: true, reason: 'Blocked by user.' }
      }
    } else if (mode !== 'never' && event.toolName === 'bash') {
      const command = typeof event.input.command === 'string' ? event.input.command : ''
      const risk = dangerousCommand(command)
      if (risk) {
        if (!ctx.hasUI) return { block: true, reason: `Dangerous command blocked in a non-interactive task (${risk.label}).` }
        const preview = risk.command.length > 1200 ? `${risk.command.slice(0, 1200)}\n…` : risk.command
        const approved = await ctx.ui.confirm(
          '确认执行危险命令',
          `检测到${risk.label}。\n\n${preview}\n\n只在你确认这条命令安全时继续。`
        )
        if (!approved) return { block: true, reason: 'Blocked by user.' }
      }
    }
    const reason = desktopToolBlockReason(event.toolName)
    return reason ? { block: true, reason } : undefined
  })
}
