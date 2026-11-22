import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn as ptySpawn, type IPty } from 'node-pty'

export type PtyCreateResult = { id: string; buffer: string } | { error: string }

interface PtySession {
  pty: IPty
  id: string
  workspace: string
  /** Recent output so a renderer that subscribes late can replay it. */
  buffer: string
}

const sessions = new Map<string, PtySession>()
let sequence = 0
let publish: ((channel: string, payload: unknown) => void) | null = null

/** The user's own shell — deliberately outside pi's sandbox and approval
 * system: this terminal is the user typing, not the agent. */
export function initPtyTerminal(sender: (channel: string, payload: unknown) => void): void {
  publish = sender
}

function shellCommand(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: [] }
  return { file: process.env.SHELL || '/bin/zsh', args: ['-l'] }
}

/** GUI processes inherit a sparse PATH; strip the app's own PI_DESKTOP_*
 * markers so tools inside the terminal see the user's normal environment. */
function terminalEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith('PI_DESKTOP_')) continue
    env[key] = value
  }
  return env
}

export function createPtyTerminal(workspace: string): PtyCreateResult {
  if (!publish) return { error: 'terminal unavailable' }
  const { file, args } = shellCommand()
  try {
    const pty = ptySpawn(file, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: workspace || homedir(),
      env: terminalEnv()
    })
    const id = `pty-${++sequence}-${randomUUID().slice(0, 8)}`
    const session: PtySession = { pty, id, workspace, buffer: '' }
    sessions.set(id, session)
    pty.onData((data) => {
      session.buffer = (session.buffer + data).slice(-100_000)
      publish?.('terminal:data', { id, data })
    })
    pty.onExit(({ exitCode }) => {
      sessions.delete(id)
      publish?.('terminal:exit', { id, exitCode })
    })
    return { id, buffer: '' }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function writePtyTerminal(id: string, data: string): void {
  if (typeof data !== 'string' || data.length > 10_000) return
  sessions.get(id)?.pty.write(data)
}

export function resizePtyTerminal(id: string, cols: number, rows: number): void {
  const session = sessions.get(id)
  if (!session) return
  const safeCols = Math.max(2, Math.min(Math.round(cols) || 0, 500))
  const safeRows = Math.max(2, Math.min(Math.round(rows) || 0, 300))
  try { session.pty.resize(safeCols, safeRows) } catch { /* session already gone */ }
}

export function killPtyTerminal(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  try { session.pty.kill() } catch { /* already exited */ }
}

export function stopAllPtyTerminals(): void {
  for (const session of sessions.values()) {
    try { session.pty.kill() } catch { /* already exited */ }
  }
  sessions.clear()
}
