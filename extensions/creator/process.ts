import { spawn, execFileSync } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { CREATOR_LIMITS } from './config.ts'

const runningChildren = new Set<ChildProcessWithoutNullStreams>()
const processGroups = new Map<ChildProcessWithoutNullStreams,ReturnType<typeof setTimeout>|null>()
function killTree(child:ChildProcessWithoutNullStreams,signal:'SIGTERM'|'SIGKILL'):void {
  if(!child.pid)return
  try{
    if(process.platform==='win32')execFileSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true,timeout:CREATOR_LIMITS.killMs*2})
    else process.kill(-child.pid,signal)
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ESRCH')return
    if(child.exitCode===null&&child.signalCode===null)child.kill(signal)
  }
}
export function stopCreatorChildren():void {
  for(const[child,timer]of processGroups){if(timer)clearTimeout(timer);killTree(child,'SIGKILL')}
  processGroups.clear();runningChildren.clear();process.removeListener('exit',stopCreatorChildren)
}

/** One cross-platform launch path: Electron-as-Node + the selected Pi CLI. Never a shell. */
export function startCreatorPi(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  const cli = process.env.PI_DESKTOP_CREATOR_CLI ?? (/\.[cm]?js$/.test(process.argv[1] ?? '') ? process.argv[1] : undefined)
  if (!cli || !existsSync(cli)) throw new Error('Pi CLI unavailable. Restart Pi Desktop to configure PI_DESKTOP_CREATOR_CLI.')
  // Detached test groups must also die when their owner is forcibly killed (no exit hook can run then).
  const watchdog=`import {execFileSync} from 'node:child_process';const owner=${process.pid};setInterval(()=>{try{process.kill(owner,0)}catch{try{if(process.platform==='win32')execFileSync('taskkill',['/pid',String(process.pid),'/T','/F'],{stdio:'ignore'});else process.kill(-process.pid,'SIGKILL')}catch{process.exit(1)}}},${CREATOR_LIMITS.parentWatchMs}).unref()`
  return spawn(process.execPath, ['--import',`data:text/javascript,${encodeURIComponent(watchdog)}`,cli, ...args], { cwd, shell: false, detached:process.platform!=='win32',windowsHide:true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PI_DESKTOP_CREATOR_CHILD: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
}

export async function runCreatorPi(options: {
  args: string[]; cwd: string; timeout: number; signal?: AbortSignal;
  input?: unknown[]; accept?: (record: Record<string, unknown>) => boolean;
}): Promise<{ output: string; records: Record<string, unknown>[] }> {
  if (options.signal?.aborted) throw new Error('Cancelled')
  if (runningChildren.size >= CREATOR_LIMITS.children) throw new Error('Concurrent Pi operations exceed PI_CREATOR_CHILDREN.')
  return new Promise((resolve, reject) => {
    const child = startCreatorPi(options.args, options.cwd)
    if (!processGroups.size) process.once('exit',stopCreatorChildren)
    processGroups.set(child,null);runningChildren.add(child)
    child.once('close',()=>runningChildren.delete(child))
    let done = false, output = '', stderr = '', line = '', bytes = 0
    const records: Record<string, unknown>[] = []
    const finish = (error?: Error): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      killTree(child,'SIGTERM')
      // Kill the group even if its leader exits: startup helpers can ignore SIGTERM or keep stdio open.
      const killTimer=setTimeout(()=>{killTree(child,'SIGKILL');processGroups.delete(child);if(!processGroups.size)process.removeListener('exit',stopCreatorChildren)},CREATOR_LIMITS.killMs)
      processGroups.set(child,killTimer);killTimer.unref()
      if (error) reject(error)
      else resolve({ output, records })
    }
    const abort = (): void => finish(new Error('Cancelled'))
    const timer = setTimeout(() => finish(new Error(`Pi operation timed out (${options.timeout}ms; PI_CREATOR_TEST_MS / PI_CREATOR_SUBAGENT_MS).`)), options.timeout)
    child.on('error', finish)
    child.stdin.on('error', error => { if (!done) finish(error) })
    child.stdout.on('error', finish)
    child.stderr.on('error', finish)
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (done) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > CREATOR_LIMITS.outputBytes) { finish(new Error('Pi output exceeds PI_CREATOR_OUTPUT_BYTES.')); return }
      output += chunk; line += chunk
      while (line.includes('\n')) {
        const end = line.indexOf('\n'), raw = line.slice(0, end); line = line.slice(end + 1)
        try {
          const record = JSON.parse(raw) as Record<string, unknown>
          records.push(record)
          if (record.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(String(record.method))) {
            finish(new Error('This test requires interactive input. Move startup prompts into an explicit plugin command.')); return
          }
          if (options.accept?.(record)) { finish(); return }
        } catch (error) { if (error instanceof SyntaxError) continue; finish(error instanceof Error ? error : new Error(String(error))); return }
      }
    })
    child.stderr.on('data', (chunk: string) => {
      if (done) return
      bytes += Buffer.byteLength(chunk); stderr += chunk
      if (bytes > CREATOR_LIMITS.outputBytes) finish(new Error('Pi output exceeds PI_CREATOR_OUTPUT_BYTES.'))
    })
    child.on('close', code => {
      if (done) return
      if (code !== 0) finish(new Error(stderr.trim().slice(-3000) || `Pi exited (${code}).`))
      else if (options.accept) finish(new Error('Pi exited before completing the runtime check.'))
      else finish()
    })
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) { abort(); return }
    if (options.input) for (const command of options.input) child.stdin.write(`${JSON.stringify(command)}\n`)
    else child.stdin.end()
  })
}
