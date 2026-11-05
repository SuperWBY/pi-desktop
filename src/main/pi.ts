import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { PiRecord, PiResponse } from '@shared/types'
import { augmentedPath } from './pi-locate'

interface Pending {
  resolve: (value: PiResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface PiStartOptions {
  cwd: string
  piPath: string
  sessionPath?: string | null
  name?: string
  appendSystemPrompt?: string
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
  private stopping = false

  cwd = ''
  startedAt = 0

  get alive(): boolean {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed)
  }

  start(options: PiStartOptions): Promise<void> {
    if (this.child) throw new Error('Pi process already started')

    const args = ['--mode', 'rpc']
    if (options.sessionPath) args.push('--session', options.sessionPath)
    if (options.name) args.push('--name', options.name)
    if (options.appendSystemPrompt) args.push('--append-system-prompt', options.appendSystemPrompt)

    this.cwd = options.cwd
    this.stopping = false

    return new Promise<void>((resolve, reject) => {
      let settled = false
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(
          process.platform === 'win32' ? `"${options.piPath}"` : options.piPath,
          args,
          {
            cwd: options.cwd,
            env: {
              ...process.env,
              PATH: augmentedPath(),
              ...(options.sessionPath ? { PI_DESKTOP_SESSION_PATH: options.sessionPath } : {})
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: process.platform === 'win32'
          }
        )
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }

      this.child = child
      this.startedAt = Date.now()

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
        this.child = null
        this.rejectPending(new Error(`pi exited (${signal ?? code ?? 'unknown'})`))
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
        timer
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
    this.child.stdin.write(`${JSON.stringify(record)}\n`)
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
