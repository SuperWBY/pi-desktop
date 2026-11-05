import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { BackgroundSchedulerStatus } from '@shared/types'
import { buildLaunchAgentPlist as buildPlist, MAC_LABEL } from './launch-agent'

const WIN_TASK = 'Pi Desktop Scheduler'

function launchAgentPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${MAC_LABEL}.plist`)
}

function schedulerLogPath(): string {
  return join(homedir(), 'Library', 'Logs', 'Pi Desktop', 'scheduler.log')
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 20_000 }, (error, stdout, stderr) => {
      resolve({
        code: error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? '')
      })
    })
  })
}

function programArguments(): string[] {
  return app.isPackaged
    ? [process.execPath, '--scheduler-run-due']
    : [process.execPath, app.getAppPath(), '--scheduler-run-due']
}

export function buildLaunchAgentPlist(): string {
  return buildPlist(programArguments(), schedulerLogPath())
}

export function windowsTaskCommand(): string {
  return programArguments()
    .map((value) => `"${value}"`)
    .join(' ')
}

export async function backgroundSchedulerStatus(): Promise<BackgroundSchedulerStatus> {
  if (process.platform === 'darwin') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501
    const loaded = existsSync(launchAgentPath())
      ? await run('launchctl', ['print', `gui/${uid}/${MAC_LABEL}`])
      : { code: 1, stderr: '' }
    return {
      supported: true,
      installed: loaded.code === 0,
      path: launchAgentPath(),
      detail: app.isPackaged ? (loaded.stderr.trim() || undefined) : '开发模式下不注册 LaunchAgent'
    }
  }
  if (process.platform === 'win32') {
    const result = await run('schtasks', ['/Query', '/TN', WIN_TASK])
    return {
      supported: true,
      installed: result.code === 0,
      detail: result.code === 0 ? undefined : result.stderr.trim() || undefined
    }
  }
  return { supported: false, installed: false, detail: '当前平台仅支持应用运行时调度' }
}

export async function installBackgroundScheduler(): Promise<BackgroundSchedulerStatus> {
  if (!app.isPackaged) {
    return { supported: true, installed: false, detail: '开发模式下不注册系统级调度' }
  }
  if (process.platform === 'darwin') {
    const path = launchAgentPath()
    mkdirSync(dirname(path), { recursive: true })
    mkdirSync(dirname(schedulerLogPath()), { recursive: true })
    writeFileSync(path, buildLaunchAgentPlist())
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501
    await run('launchctl', ['bootout', `gui/${uid}/${MAC_LABEL}`])
    const loaded = await run('launchctl', ['bootstrap', `gui/${uid}`, path])
    if (loaded.code !== 0) {
      await run('launchctl', ['load', '-w', path])
    }
    const status = await backgroundSchedulerStatus()
    if (!status.installed) {
      return { ...status, detail: loaded.stderr.trim() || 'LaunchAgent 注册失败' }
    }
    return status
  }
  if (process.platform === 'win32') {
    const result = await run('schtasks', [
      '/Create',
      '/TN',
      WIN_TASK,
      '/TR',
      windowsTaskCommand(),
      '/SC',
      'MINUTE',
      '/MO',
      '1',
      '/F'
    ])
    const status = await backgroundSchedulerStatus()
    if (result.code !== 0) {
      return { ...status, detail: result.stderr.trim() || result.stdout.trim() || '计划任务注册失败' }
    }
    return status
  }
  return { supported: false, installed: false, detail: '当前平台不支持' }
}

export async function uninstallBackgroundScheduler(): Promise<BackgroundSchedulerStatus> {
  if (process.platform === 'darwin') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501
    await run('launchctl', ['bootout', `gui/${uid}/${MAC_LABEL}`])
    rmSync(launchAgentPath(), { force: true })
    return backgroundSchedulerStatus()
  }
  if (process.platform === 'win32') {
    await run('schtasks', ['/Delete', '/TN', WIN_TASK, '/F'])
    return backgroundSchedulerStatus()
  }
  return { supported: false, installed: false, detail: '当前平台不支持' }
}
