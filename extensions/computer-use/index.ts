import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile, unlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const isWindows = process.platform === 'win32'
const helperPath = fileURLToPath(new URL(isWindows ? './bin/computer-use-helper.ps1' : './bin/computer-use-helper', import.meta.url))
const helperCommand = isWindows ? 'powershell.exe' : helperPath

interface UiElement {
  id: string
  role: string
  title: string | null
  description: string | null
  value: string | null
  identifier: string | null
  enabled: boolean
  focused: boolean
  secure: boolean
  bounds: { x: number; y: number; width: number; height: number } | null
  depth: number
}

interface Snapshot {
  app: string
  bundleId: string | null
  windowTitle: string | null
  windowBounds: { x: number; y: number; width: number; height: number } | null
  windowId: number | null
  captureMode: 'window' | 'region' | 'display'
  screenshot: string | null
  screenWidth: number
  screenHeight: number
  accessibility: boolean
  screenRecording: boolean
  elements: UiElement[]
}

interface SnapshotState {
  id: string
  snapshot: Snapshot
  stale: boolean
}

const snapshots = new Map<string, SnapshotState>()
const auditDir = join(homedir(), '.pi', 'computer-use')
const auditFile = join(auditDir, 'audit.jsonl')
const approvalMode = process.env.PI_COMPUTER_USE_APPROVAL ?? 'always'

async function audit(entry: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(auditDir, { recursive: true })
    await appendFile(auditFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8')
  } catch {
    // audit failure must not break a UI action
  }
}

async function runHelper(args: string[]): Promise<Record<string, unknown>> {
  try {
    const commandArgs = isWindows
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath, ...args]
      : args
    const { stdout } = await execFileAsync(helperCommand, commandArgs, {
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    })
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    if (parsed.ok === false) throw new Error(String(parsed.error ?? 'Computer Use helper failed'))
    return parsed
  } catch (error) {
    const value = error as { stderr?: string; message?: string }
    throw new Error(value.stderr?.trim() || value.message || String(error))
  }
}

function describeSnapshot(snapshot: Snapshot, id: string): string {
  const lines = [
    `App: ${snapshot.app}${snapshot.bundleId ? ` (${snapshot.bundleId})` : ''}`,
    `Window: ${snapshot.windowTitle ?? '(untitled)'}`,
    `Snapshot: ${id}`,
    `Capture: ${snapshot.captureMode}${snapshot.windowBounds ? ` @ ${Math.round(snapshot.windowBounds.x)},${Math.round(snapshot.windowBounds.y)} ${Math.round(snapshot.windowBounds.width)}×${Math.round(snapshot.windowBounds.height)}` : ''}`,
    `Screen: ${snapshot.screenWidth}×${snapshot.screenHeight}`,
    `Accessibility: ${snapshot.accessibility ? 'granted' : 'missing'}`,
    `Screen recording: ${snapshot.screenRecording ? 'granted' : 'missing'}`,
    '',
    'Elements:'
  ]
  for (const element of snapshot.elements) {
    const label = element.title || element.description || element.value || ''
    const bounds = element.bounds
      ? ` @ ${Math.round(element.bounds.x)},${Math.round(element.bounds.y)} ${Math.round(element.bounds.width)}×${Math.round(element.bounds.height)}`
      : ''
    lines.push(
      `${element.id} ${element.role}${label ? ` “${label.slice(0, 120)}”` : ''}${element.secure ? ' [secure]' : ''}${element.enabled ? '' : ' [disabled]'}${bounds}`
    )
  }
  if (!snapshot.elements.length) lines.push('(no accessible elements; use the screenshot and x/y coordinates)')
  return lines.join('\n')
}

function findElement(snapshot: Snapshot | undefined, id: string): UiElement {
  if (!snapshot) throw new Error('Snapshot not found. Call computer_use_observe again.')
  const element = snapshot.elements.find((item) => item.id === id)
  if (!element) throw new Error(`Element ${id} is no longer in the snapshot. Observe again.`)
  if (!element.bounds) throw new Error(`Element ${id} has no bounds; observe again.`)
  return element
}

function point(element: UiElement): { x: number; y: number } {
  if (!element.bounds) throw new Error('Element has no bounds')
  return {
    x: element.bounds.x + element.bounds.width / 2,
    y: element.bounds.y + element.bounds.height / 2
  }
}

async function screenshotContent(path: string | null): Promise<Array<Record<string, unknown>>> {
  if (!path) return []
  try {
    const bytes = await readFile(path)
    if (bytes.length > 3 * 1024 * 1024) return []
    return [{ type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' }]
  } catch {
    return []
  } finally {
    await unlink(path).catch(() => undefined)
  }
}

async function verify(state: SnapshotState): Promise<Record<string, unknown>> {
  try {
    const result = await runHelper(['observe', '--app', state.snapshot.app])
    return result.snapshot as Record<string, unknown>
  } catch {
    return {}
  }
}

async function doAction(action: Record<string, unknown>, state: SnapshotState | undefined): Promise<string> {
  const type = String(action.type ?? '')
  const snapshot = state?.snapshot
  const target = typeof action.elementId === 'string' ? findElement(snapshot, action.elementId) : null
  const xy = target ? point(target) : null

  if (type === 'click' || type === 'double_click' || type === 'right_click') {
    const x = xy?.x ?? Number(action.x)
    const y = xy?.y ?? Number(action.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('click requires elementId or x/y')
    const button = type === 'right_click' ? 'right' : 'left'
    const count = type === 'double_click' ? 2 : 1
    await runHelper(['click', '--x', String(x), '--y', String(y), '--button', button, '--count', String(count)])
    return `${type} ${Math.round(x)},${Math.round(y)}`
  }

  if (type === 'hover') {
    const x = xy?.x ?? Number(action.x)
    const y = xy?.y ?? Number(action.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('hover requires elementId or x/y')
    await runHelper(['scroll', '--x', String(x), '--y', String(y), '--delta', '0'])
    return `hover ${Math.round(x)},${Math.round(y)}`
  }

  if (type === 'type') {
    if (target?.secure) throw new Error('Refusing to type into a secure text field.')
    if (target) {
      const p = point(target)
      await runHelper(['click', '--x', String(p.x), '--y', String(p.y)])
    }
    const text = String(action.text ?? '')
    if (!text) throw new Error('type requires text')
    await runHelper(['type', '--text', text])
    return `typed ${text.length} characters`
  }

  if (type === 'key') {
    const key = String(action.key ?? '')
    if (!key) throw new Error('key requires key')
    await runHelper(['key', '--key', key, '--modifiers', String(action.modifiers ?? '')])
    return `key ${key}${action.modifiers ? ` + ${String(action.modifiers)}` : ''}`
  }

  if (type === 'scroll') {
    const x = xy?.x ?? Number(action.x ?? (snapshot?.screenWidth ?? 0) / 2)
    const y = xy?.y ?? Number(action.y ?? (snapshot?.screenHeight ?? 0) / 2)
    const delta = Number(action.delta ?? 0)
    await runHelper(['scroll', '--x', String(x), '--y', String(y), '--delta', String(delta)])
    return `scrolled ${delta}`
  }

  if (type === 'wait') {
    const ms = Math.max(0, Math.min(30_000, Number(action.ms ?? 500)))
    await new Promise((resolve) => setTimeout(resolve, ms))
    return `waited ${ms}ms`
  }

  throw new Error(`Unknown action type: ${type}`)
}

export default function computerUse(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'computer_use_apps',
    label: 'Computer Use: Apps',
    description: 'List running desktop applications. Use this before observing an app.',
    promptSnippet: 'List desktop apps and windows for computer use.',
    parameters: Type.Object({}),
    async execute() {
      const result = await runHelper(['apps'])
      const apps = (result.apps ?? []) as Array<Record<string, unknown>>
      return {
        content: [{ type: 'text', text: apps.map((app) => `${app.name} (${app.bundleId})`).join('\n') || 'No apps' }],
        details: { result }
      }
    }
  })

  pi.registerTool({
    name: 'computer_use_observe',
    label: 'Computer Use: Observe',
    description:
      'Capture a screenshot and accessibility tree for an application window. Always observe before acting, and observe again after a state change.',
    promptSnippet: 'Observe an app window (screenshot + accessibility elements) before computer_use_act.',
    promptGuidelines: [
      'Use computer_use_observe before computer_use_act, and again after any action that changes the window.',
      'Prefer elementId from the latest snapshot over x/y coordinates.',
      'Do not read or repeat values from secure text fields.'
    ],
    parameters: Type.Object({
      app: Type.Optional(Type.String({ description: 'Application name or bundle id. Defaults to the frontmost app.' })),
      includeScreenshot: Type.Optional(Type.Boolean({ description: 'Include a screenshot in the result. Default true.' }))
    }),
    async execute(_toolCallId, params) {
      const screenshotPath = join(tmpdir(), `pi-cua-${Date.now()}.png`)
      const result = await runHelper(['observe', '--app', params.app ?? '', '--screenshot', screenshotPath])
      const snapshot = result.snapshot as Snapshot
      const id = `s${Date.now()}`
      snapshots.set(id, { id, snapshot, stale: false })
      const text = describeSnapshot(snapshot, id)
      const content: Array<Record<string, unknown>> = [{ type: 'text', text }]
      if (params.includeScreenshot !== false) content.push(...(await screenshotContent(screenshotPath)))
      return { content, details: { snapshotId: id, app: snapshot.app, elements: snapshot.elements.length } }
    }
  })

  pi.registerTool({
    name: 'computer_use_act',
    label: 'Computer Use: Act',
    description:
      'Perform one desktop action against the latest computer_use_observe snapshot. Prefer elementId; use x/y only when no element exists.',
    promptSnippet: 'Click, type, press keys, or scroll in a desktop app after computer_use_observe.',
    promptGuidelines: [
      'Use computer_use_act only with a snapshotId from the latest computer_use_observe.',
      'Do not click buttons that delete data, pay, send messages, or change security settings without explicit user approval.',
      'After an action, call computer_use_observe again to verify the result.'
    ],
    parameters: Type.Object({
      snapshotId: Type.Optional(Type.String({ description: 'Snapshot from computer_use_observe.' })),
      type: Type.Union([
        Type.Literal('click'),
        Type.Literal('double_click'),
        Type.Literal('right_click'),
        Type.Literal('hover'),
        Type.Literal('type'),
        Type.Literal('key'),
        Type.Literal('scroll'),
        Type.Literal('wait')
      ]),
      elementId: Type.Optional(Type.String()),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      text: Type.Optional(Type.String()),
      key: Type.Optional(Type.String()),
      modifiers: Type.Optional(Type.String()),
      delta: Type.Optional(Type.Number()),
      ms: Type.Optional(Type.Number())
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.type !== 'wait' && approvalMode !== 'never') {
        const ok = await ctx.ui.confirm(
          'Computer Use',
          `Run ${params.type}${params.elementId ? ` on ${params.elementId}` : ''} in the current desktop?`
        )
        if (!ok) {
          await audit({ type: params.type, target: params.elementId ?? '', ok: false, cancelled: true })
          return { content: [{ type: 'text', text: 'Action cancelled by user.' }], details: { cancelled: true } }
        }
      }
      const state = params.snapshotId ? snapshots.get(params.snapshotId) : undefined
      if (!state && params.type !== 'wait') throw new Error('Call computer_use_observe before acting.')
      if (state?.stale) throw new Error('This snapshot is stale. Call computer_use_observe again.')
      const text = await doAction(params as Record<string, unknown>, state)
      if (state && params.type !== 'wait') state.stale = true
      const after = state && params.type !== 'wait' ? await verify(state) : null
      await audit({ type: params.type, target: params.elementId ?? `${params.x},${params.y}`, app: state?.snapshot.app, ok: true })
      return {
        content: [{ type: 'text', text: after ? `${text}\nAfter: ${after.elements ? (after.elements as unknown[]).length : 0} elements, window ${String(after.windowTitle ?? '')}` : text }],
        details: { action: text, snapshotId: params.snapshotId, after: after ? { elements: Array.isArray(after.elements) ? after.elements.length : 0, windowTitle: after.windowTitle } : null }
      }
    }
  })

  pi.registerTool({
    name: 'computer_use_batch',
    label: 'Computer Use: Batch',
    description: 'Run a short sequence of desktop actions against one observed snapshot. Stops at the first failure.',
    promptSnippet: 'Run a short sequence of desktop actions after computer_use_observe.',
    promptGuidelines: [
      'Use computer_use_batch only for closely related steps that do not need a new observation between each action.',
      'Use computer_use_observe after the batch to verify the final state.'
    ],
    parameters: Type.Object({
      snapshotId: Type.Optional(Type.String()),
      actions: Type.Array(Type.Record(Type.String(), Type.Any()))
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (approvalMode !== 'never') {
        const ok = await ctx.ui.confirm('Computer Use', `Run ${params.actions.length} desktop actions?`)
        if (!ok) return { content: [{ type: 'text', text: 'Batch cancelled by user.' }], details: { cancelled: true } }
      }
      const state = params.snapshotId ? snapshots.get(params.snapshotId) : undefined
      if (!state) throw new Error('Call computer_use_observe before running a batch.')
      if (state.stale) throw new Error('This snapshot is stale. Call computer_use_observe again.')
      const completed: string[] = []
      for (const action of params.actions) {
        try {
          completed.push(await doAction(action, state))
        } catch (error) {
          if (state) state.stale = true
          await audit({ type: 'batch', target: completed.length, app: state?.snapshot.app, ok: false, error: String(error) })
          return {
            content: [{ type: 'text', text: `Stopped after ${completed.length}/${params.actions.length}: ${String(error)}` }],
            details: { completed, error: String(error) }
          }
        }
      }
      if (state) state.stale = true
      await audit({ type: 'batch', target: completed.length, app: state?.snapshot.app, ok: true })
      const after = state ? await verify(state) : null
      return {
        content: [{ type: 'text', text: `${completed.join('\n')}${after ? `\nAfter: ${Array.isArray(after.elements) ? after.elements.length : 0} elements` : ''}` }],
        details: { completed, after }
      }
    }
  })

  pi.registerTool({
    name: 'computer_use_permissions',
    label: 'Computer Use: Permissions',
    description: 'Check macOS Accessibility and Screen Recording permissions for computer use.',
    parameters: Type.Object({}),
    async execute() {
      const result = await runHelper(['check'])
      return {
        content: [{
          type: 'text',
          text: `Accessibility: ${result.accessibility ? 'granted' : 'missing'}\nScreen Recording: ${result.screenRecording ? 'granted' : 'missing'}`
        }],
        details: result
      }
    }
  })
}
