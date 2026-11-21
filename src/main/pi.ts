import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { PiRecord, PiResponse, SessionSecurity, SessionStats } from '@shared/types'
import { augmentedPath } from './pi-locate'
import { directPiSpawn } from './pi-exec'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { matchingContextBreakdown } from './context-usage'

interface Pending {
  resolve: (value: PiResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  command: string
}

export interface PiStartOptions {
  cwd: string
  piPath: string
  sessionPath?: string | null
  name?: string
  appendSystemPrompt?: string
  additionalArgs?: string[]
  desktopSettingsFile?: string
  desktopToolInfoFile?: string
  security: SessionSecurity
  extraEnv?: Record<string, string>
  sandbox?: { configPath: string; cliPath: string; nodePath: string }
}

/**
 * Owns one `pi --mode rpc` child process and speaks the JSONL protocol
 * over stdin/stdout. Records are re-emitted for the UI; responses are
 * correlated by request id.
 */
export class PiProcess extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private pending = new Map<string, Pending>()
  private sequence = 0
  private sandboxConfigPath?: string
  private stopping = false

  cwd = ''
  startedAt = 0
  desktopToolInfoFile?: string
  security: SessionSecurity = { permission: 'review', mode: 'dangerous', sandboxed: false }
  allowedNetworkHosts: string[] = []
  blockedNetworkHost?: string
  sessionPath: string | null = null

  get hasPendingWork(): boolean {
    return [...this.pending.values()].some(({ command }) => !command.startsWith('get_'))
  }

  get sandboxed(): boolean {
    return Boolean(this.sandboxConfigPath)
  }

  get alive(): boolean {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed)
  }

  start(options: PiStartOptions): Promise<void> {
    if (this.child) throw new Error('Pi process already started')

    const args = ['--mode', 'rpc']
    if (options.additionalArgs) args.push(...options.additionalArgs)
    if (options.sessionPath) args.push('--session', options.sessionPath)
    if (options.name) args.push('--name', options.name)
    if (options.appendSystemPrompt) args.push('--append-system-prompt', options.appendSystemPrompt)

    this.cwd = options.cwd
    this.security = options.security
    this.stopping = false
    this.sandboxConfigPath = options.sandbox?.configPath
    let executable: string
    let launchArgs: string[]
    const spawnEnv: Record<string, string> = {}
    if (options.sandbox) {
      executable = options.sandbox.nodePath
      launchArgs = [
        options.sandbox.cliPath,
        '--settings', options.sandbox.configPath,
        '/usr/bin/env', '-u', 'ELECTRON_RUN_AS_NODE',
        options.piPath,
        ...args
      ]
    } else {
      const direct = directPiSpawn(options.piPath, args)
      if (!direct) {
        const reason = existsSync(options.piPath)
          ? `找不到 Pi 的 cli.js（"${options.piPath}"），无法在 Windows 上安全启动。请重新安装 Pi 或更新 Pi Desktop。`
          : `ENOENT: spawn "${options.piPath}"`
        return Promise.reject(new Error(reason))
      }
      executable = direct.executable
      launchArgs = direct.args
      Object.assign(spawnEnv, direct.env)
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(
          executable,
          launchArgs,
          {
            cwd: options.cwd,
            env: {
              ...process.env,
              PATH: augmentedPath(),
              ...(options.desktopSettingsFile ? { PI_DESKTOP_SETTINGS_FILE: options.desktopSettingsFile } : {}),
              ...(options.desktopToolInfoFile ? { PI_DESKTOP_TOOL_INFO_FILE: options.desktopToolInfoFile } : {}),
              ...(options.desktopToolInfoFile ? { PI_DESKTOP_CONTEXT_FILE: `${options.desktopToolInfoFile}.context.json` } : {}),
              ...(options.sessionPath ? { PI_DESKTOP_SESSION_PATH: options.sessionPath } : {}),
              PI_DESKTOP_TOOL_APPROVAL: options.security.mode,
              ...(options.extraEnv ?? {}),
              ...spawnEnv,
              ...(options.sandbox ? { PI_DESKTOP_SANDBOX: '1', SRT_DEBUG: '1' } : {})
            },
            stdio: ['pipe', 'pipe', 'pipe']
          }
        )
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }

      this.child = child
      this.startedAt = Date.now()
      // EPIPE when pi dies mid-write; the exit handler rejects pending work.
      child.stdin.on('error', () => undefined)

      child.once('spawn', () => {
        settled = true
        resolve()
      })
      child.once('error', (error) => {
        if (!settled) {
          settled = true
          reject(error)
        }
        this.emit('exit', { code: null, signal: null, error: error.message })
      })

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => this.consume(chunk))

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => this.emit('stderr', chunk))

      child.on('exit', (code, signal) => {
        if (options.desktopToolInfoFile) {
          for (const suffix of ['.context.json', '.context.json.tmp']) {
            try { unlinkSync(`${options.desktopToolInfoFile}${suffix}`) } catch { /* already removed */ }
          }
        }
        if (options.desktopToolInfoFile) { try { unlinkSync(options.desktopToolInfoFile) } catch { /* already removed */ } }
        if (this.sandboxConfigPath) { try { unlinkSync(this.sandboxConfigPath) } catch { /* already removed */ } this.sandboxConfigPath = undefined }
        this.child = null
        this.rejectPending(new Error(`Pi 已停止（${signal ?? code ?? 'unknown'}）`))
        this.emit('exit', { code, signal, intentional: this.stopping })
        this.stopping = false
      })
    })
  }

  /** Send a command and wait for its correlated response. */
  send<T = unknown>(
    command: Record<string, unknown>,
    timeoutMs = 30_000
  ): Promise<PiResponse<T>> {
    const id = typeof command.id === 'string' && command.id ? command.id : `c${++this.sequence}`
    if (!this.child) {
      return Promise.reject(new Error('pi is not running'))
    }

    return new Promise<PiResponse<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s: ${String(command.type)}`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (value) => resolve(value as PiResponse<T>),
        reject,
        timer,
        command: String(command.type)
      })

      try {
        this.child?.stdin.write(`${JSON.stringify({ ...command, id })}\n`)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** Fire-and-forget record (used for extension UI responses). */
  write(record: Record<string, unknown>): void {
    if (!this.child) return
    try {
      this.child.stdin.write(`${JSON.stringify(record)}\n`)
    } catch {
      // pi exited between the alive check and the write; exit handler cleans up.
    }
  }

  stop(): void {
    if (!this.child) return
    this.stopping = true
    const child = this.child
    try {
      child.stdin.end()
    } catch {
      // ignore
    }
    const term = setTimeout(() => {
      if (this.child) this.child.kill('SIGTERM')
    }, 1200)
    const kill = setTimeout(() => {
      if (this.child) this.child.kill('SIGKILL')
    }, 4000)
    child.once('exit', () => {
      clearTimeout(term)
      clearTimeout(kill)
    })
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index !== -1) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '')
      this.buffer = this.buffer.slice(index + 1)
      if (line.trim()) this.handleLine(line)
      index = this.buffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    let record: PiRecord
    try {
      record = JSON.parse(line) as PiRecord
    } catch (error) {
      this.emit('protocol-error', line.slice(0, 500), error)
      return
    }

    if (record.type === 'response') {
      const id = typeof record.id === 'string' ? record.id : undefined
      const pending = id ? this.pending.get(id) : undefined
      if (pending && id) {
        clearTimeout(pending.timer)
        this.pending.delete(id)
        if (pending.command === 'get_session_stats' && record.success && this.desktopToolInfoFile) {
          const stats = (record as unknown as PiResponse<SessionStats>).data
          if (stats?.contextUsage) {
            try {
              const snapshot: unknown = JSON.parse(readFileSync(`${this.desktopToolInfoFile}.context.json`, 'utf8'))
              stats.contextUsage.breakdown = matchingContextBreakdown(stats, snapshot)
            } catch { /* Older runtimes still provide the total. */ }
          }
        }
        pending.resolve(record as unknown as PiResponse)
        return
      }
    }

    this.emit('record', record)
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
  }
}
