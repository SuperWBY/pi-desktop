import { spawn } from 'node:child_process'

export class DesktopGuardRejected extends Error {
  readonly reason: 'window_changed' | 'target_obscured'
  constructor(reason: 'window_changed' | 'target_obscured') {
    super(reason === 'window_changed' ? 'Desktop window changed. Observe again.' : 'Desktop target is obscured or cannot be verified. Reveal it and observe again.')
    this.reason = reason
  }
}

/** The shell waits for authorization, then replaces itself with the helper (same PID). */
export function runGuardedHelper(command: string, args: string[], attach: (pid: number) => void, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', 'IFS= read -r gate || exit 2; [ "$gate" = go ] || exit 2; exec "$@"', 'pi-action-gate', command, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error); else resolve(stdout)
    }
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('Guarded helper timed out; the action result may be unknown.')) }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { child.kill('SIGTERM'); finish(new Error('Guarded helper output exceeded its limit; the action result may be unknown.')) }
    })
    child.stderr.resume()
    child.stdin.on('error', () => { child.kill('SIGTERM'); finish(new Error('Guarded helper could not be started safely.')) })
    child.once('error', () => finish(new Error('Guarded helper could not be started safely.')))
    child.once('spawn', () => {
      try {
        if (!child.pid) throw new Error('Missing helper PID')
        attach(child.pid)
        child.stdin.end('go\n')
      } catch {
        child.stdin.destroy(); child.kill('SIGTERM')
        finish(new Error('Desktop action was not authorized because its helper could not be recorded.'))
      }
    })
    child.once('close', (code) => {
      if (code === 0) { finish(); return }
      const guardedMouse = ['click', 'scroll'].includes(args[0]) && args.includes('--expected-window')
      const guardedKeyboard = ['type', 'key'].includes(args[0]) && args.includes('--target-window')
      if (code === 73 && (guardedMouse || guardedKeyboard)) {
        try {
          const value = JSON.parse(stdout) as { ok?: unknown; code?: unknown; reason?: unknown }
          if (value.ok === false && value.code === 'PI_COORDINATE_GUARD' && (value.reason === 'window_changed' || value.reason === 'target_obscured')) {
            finish(new DesktopGuardRejected(value.reason)); return
          }
        } catch { /* An invalid response is always an unknown outcome. */ }
      }
      finish(new Error('Guarded helper failed; the action result may be unknown.'))
    })
  })
}
