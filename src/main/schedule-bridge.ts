import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const CLI_SCRIPT = String.raw`#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const home = homedir()
const candidates = [
  process.env.PI_DESKTOP_SCHEDULES_DIR,
  join(home, 'Library', 'Application Support', 'Pi Desktop', 'schedules'),
  join(process.env.APPDATA || '', 'Pi Desktop', 'schedules'),
  join(home, '.config', 'Pi Desktop', 'schedules')
].filter(Boolean)
const schedulesDir = process.env.PI_DESKTOP_SCHEDULES_DIR || candidates.find((dir) => existsSync(join(dir, 'tasks.json'))) || candidates[0]
const inboxDir = join(schedulesDir, 'inbox')

function fail(message) {
  console.error(message)
  process.exit(2)
}

function valueOf(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function has(name) {
  return process.argv.includes(name)
}

function parseDuration(text) {
  const match = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(text || '')
  if (!match) fail('--in needs a duration like 30s, 5m, 2h or 1d')
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]]
  return Math.round(Number(match[1]) * unit)
}

function activeSessionFor(cwd) {
  try {
    const map = JSON.parse(readFileSync(join(dirname(schedulesDir), 'active-sessions.json'), 'utf8'))
    return typeof map[cwd] === 'string' ? map[cwd] : undefined
  } catch {
    return undefined
  }
}

function firstPrompt() {
  const positional = process.argv.slice(3).filter((arg, index, all) => {
    if (arg.startsWith('--')) return false
    return !(index > 0 && all[index - 1].startsWith('--'))
  })
  return positional.join(' ').trim()
}

function cadence() {
  const expression = valueOf('--cron')
  if (expression) return { type: 'cron', expression }
  const daily = valueOf('--daily')
  if (daily) return { type: 'daily', time: daily }
  const weekly = valueOf('--weekly')
  if (weekly) {
    const [weekday, time] = weekly.split('/')
    return { type: 'weekly', weekday: Number(weekday), time: time || '09:00' }
  }
  const at = valueOf('--at')
  if (at) {
    const timestamp = Date.parse(at)
    if (!Number.isFinite(timestamp)) fail('--at needs an ISO date/time')
    return { type: 'once', at: timestamp }
  }
  const inText = valueOf('--in')
  if (inText) return { type: 'once', at: Date.now() + parseDuration(inText) }
  fail('when should it run? use --in 5m, --at <ISO>, --cron "<expr>" or --daily HH:MM')
}

function list(printJson) {
  const file = join(schedulesDir, 'tasks.json')
  let tasks = []
  try {
    tasks = JSON.parse(readFileSync(file, 'utf8')).tasks || []
  } catch {
    tasks = []
  }
  if (printJson) {
    console.log(JSON.stringify(tasks, null, 2))
    return
  }
  if (!tasks.length) {
    console.log('No scheduled tasks.')
    return
  }
  for (const task of tasks) {
    const when = task.nextRunAt ? new Date(task.nextRunAt).toISOString() : 'event / none'
    console.log('- ' + task.name + ' | ' + task.cadence.type + ' | ' + (task.enabled ? 'enabled' : 'paused') + ' | next ' + when)
  }
}

const command = process.argv[2] || 'add'
if (command === 'list' || command === 'ls') {
  list(has('--json'))
  process.exit(0)
}

if (command !== 'add' && command !== 'create') fail('Usage: pi-desktop-schedule add --prompt "..." --in 5m [options]')

const prompt = valueOf('--prompt') || firstPrompt()
if (!prompt) fail('--prompt is required')

const name = valueOf('--name') || (prompt.split('\n')[0].slice(0, 24).trim() || '定时任务')
const projectPath = valueOf('--project') || process.cwd()
const request = {
  name,
  prompt,
  projectPath,
  sourceSessionPath: valueOf('--session') || process.env.PI_DESKTOP_SESSION_PATH || activeSessionFor(projectPath),
  cadence: cadence(),
  timezone: valueOf('--timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  runMode: has('--continue') ? 'continue-session' : 'new-session',
  catchUp: !has('--no-catchup'),
  notifications: !has('--no-notify')
}

mkdirSync(inboxDir, { recursive: true })
const file = join(inboxDir, Date.now() + '-' + randomUUID() + '.json')
const temp = file + '.tmp'
writeFileSync(temp, JSON.stringify(request, null, 2))
renameSync(temp, file)
console.log('Created scheduled task "' + name + '". It will appear in Pi Desktop → 定时任务 within a few seconds.')

if (has('--json')) {
  console.log(JSON.stringify({ queued: true, file, task: request }, null, 2))
} else {
  console.log('Schedule: ' + request.cadence.type + ' · ' + request.timezone + ' · ' + request.projectPath)
}
`

export function scheduleBinDir(): string {
  return join(app.getPath('userData'), 'bin')
}

export function scheduleCliPath(): string {
  return join(scheduleBinDir(), process.platform === 'win32' ? 'pi-desktop-schedule.cmd' : 'pi-desktop-schedule')
}

export function ensureScheduleCli(): void {
  const bin = scheduleBinDir()
  mkdirSync(bin, { recursive: true })
  const script = join(bin, 'pi-desktop-schedule.mjs')
  writeFileSync(script, CLI_SCRIPT, { mode: 0o755 })
  const exec = process.execPath.replaceAll('"', '\\"')
  const quotedScript = script.replaceAll('"', '\\"')
  if (process.platform === 'win32') {
    writeFileSync(
      join(bin, 'pi-desktop-schedule.cmd'),
      `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exec}" "${quotedScript}" %*\r\n`
    )
  } else {
    const wrapper = join(bin, 'pi-desktop-schedule')
    writeFileSync(
      wrapper,
      `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exec}" "${quotedScript}" "$@"\n`,
      { mode: 0o755 }
    )
    chmodSync(wrapper, 0o755)
  }
  process.env.PI_DESKTOP_SCHEDULES_DIR = join(app.getPath('userData'), 'schedules')
  process.env.PI_DESKTOP_BIN = bin
}

export function scheduleGuidance(): string {
  const cli = scheduleCliPath()
  return [
    '## Pi Desktop scheduled tasks',
    'When the user asks you to do something later, after a delay, or on a recurring basis, create a real Pi Desktop scheduled task instead of nohup, sleep, at, cron, or a detached shell script.',
    `Use this command (also on PATH as \`pi-desktop-schedule\`):`,
    `- After a delay: "${cli}" add --prompt "<complete instruction>" --in 5m --name "<short name>"`,
    `- At a specific time: "${cli}" add --prompt "<complete instruction>" --at "<ISO date/time>"`,
    `- Recurring: "${cli}" add --prompt "<complete instruction>" --cron "0 9 * * 1-5" --timezone Asia/Shanghai`,
    `- Inspect: "${cli}" list`,
    'The task appears in Pi Desktop → 定时任务, survives app restarts, and runs as an independent pi session. Do not use nohup/sleep for user-requested delayed work.'
  ].join('\n')
}
