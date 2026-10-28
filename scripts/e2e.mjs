#!/usr/bin/env node
/**
 * Interaction checks against `scripts/mock-pi.mjs` (no real pi, no tokens).
 *
 *   npm run e2e
 *
 * Every case gets a throwaway user-data dir, agent dir and session dir so the
 * developer's real pi configuration is never touched.
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tmpRoot = join(root, 'output', 'e2e')
const mockPi = join(root, 'scripts', 'mock-pi.mjs')

let failures = 0
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

function freshDirs(name) {
  const base = join(tmpRoot, name)
  rmSync(base, { recursive: true, force: true })
  const dirs = {
    base,
    userData: join(base, 'userData'),
    agent: join(base, 'agent'),
    sessions: join(base, 'sessions')
  }
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true })
  return dirs
}

function seedSession(sessionsDir, id, name) {
  const project = join(sessionsDir, '--mock-project--')
  mkdirSync(project, { recursive: true })
  const file = join(project, `2026-01-01T00-00-00-000Z_${id}.jsonl`)
  const lines = [
    { type: 'session', id, cwd: root, timestamp: new Date().toISOString() },
    { type: 'session_info', name },
    {
      type: 'message',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: `${name} preview` }] }
    }
  ]
  writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return file
}

async function launch(dirs, scenario = 'default') {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dirs.userData}`],
    cwd: root,
    env: {
      ...process.env,
      PI_DESKTOP_PI_PATH: mockPi,
      PI_CODING_AGENT_DIR: dirs.agent,
      PI_CODING_AGENT_SESSION_DIR: dirs.sessions,
      MOCK_SCENARIO: scenario
    }
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('.composer-input, .welcome', { timeout: 45_000 })
  await page.waitForTimeout(1200)
  return { app, page, errors }
}

async function openModelMenu(page) {
  await page.locator('.chip').first().click()
  await page.waitForSelector('.popover .menu-list')
}

async function caseMenuScrollAndKeyboard() {
  const dirs = freshDirs('menu')
  seedSession(dirs.sessions, 'mock-session', 'Mock session')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page, errors } = await launch(dirs, 'catalog-huge')

  await openModelMenu(page)
  const scrollable = await page.evaluate(() => {
    const list = document.querySelector('.popover .menu-list')
    return { scroll: list.scrollHeight, client: list.clientHeight }
  })
  check('模型菜单可滚动', scrollable.scroll > scrollable.client + 40, JSON.stringify(scrollable))

  await page.locator('.popover .menu-list').hover()
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(350)
  const stillOpen = await page.locator('.popover').count()
  const scrolledTo = await page.evaluate(() => document.querySelector('.popover .menu-list').scrollTop)
  check('滚轮滚动列表不会关闭菜单', stillOpen === 1, `open=${stillOpen}`)
  check('滚轮确实滚动了列表', scrolledTo > 100, `scrollTop=${scrolledTo}`)

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  const focusedLabel = await page.evaluate(
    () => document.activeElement?.querySelector('.menu-item-title')?.textContent ?? ''
  )
  check('↓ ↓ 能移动高亮项', focusedLabel === 'Mock Deep', `focused=${focusedLabel}`)

  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const chip = await page.locator('.chip-label').first().innerText()
  check('Enter 选中并关闭菜单', (await page.locator('.popover').count()) === 0, `chip=${chip}`)
  check('选中的模型写回输入区', chip === 'Mock Deep', chip)

  await page.locator('.chip').first().click()
  await page.waitForSelector('.popover')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('Esc 关闭菜单', (await page.locator('.popover').count()) === 0)
  const focusBack = await page.evaluate(() => document.activeElement?.className ?? '')
  check('关闭后焦点回到触发器', focusBack.includes('chip'), focusBack)

  check('无 JS 异常', errors.length === 0, errors.join(' | '))
  await app.close()
}

async function caseSessionRestore() {
  const dirs = freshDirs('restore')
  seedSession(dirs.sessions, 'mock-session', 'Mock session')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )

  let { app, page } = await launch(dirs)
  await page.locator('.composer-input').fill('hello')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1600)
  const firstSession = JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8'))
    .lastSessionPath
  check('发送后记录了 lastSessionPath', Boolean(firstSession), String(firstSession))
  await app.close()

  ;({ app, page } = await launch(dirs))
  const after = JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8')).lastSessionPath
  check('重启后恢复到同一会话', after === firstSession, `${firstSession} → ${after}`)
  await app.close()
}

async function caseDiagnostics() {
  const dirs = freshDirs('diagnostics')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs, 'auth-error')
  await page.locator('.footer-meta').click()
  await page.waitForSelector('.drawer')
  const log = await page.locator('.diagnostics-log pre').innerText().catch(() => '')
  check('诊断抽屉展示 pi stderr', log.includes('no credentials'), log.split('\n')[0] ?? '')

  await page.locator('.composer-input').fill('hello')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  const toast = await page.locator('.toast').first().innerText().catch(() => '')
  check('失败时提示包含真实原因', /401|Unauthorized/.test(toast), toast.replace(/\n/g, ' / '))
  await app.close()
}

async function caseDeleteUndo() {
  const dirs = freshDirs('delete')
  const file = seedSession(dirs.sessions, 'mock-session', 'Mock session')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs)
  await page.locator('.session-item .session-menu-button').first().click({ force: true })
  await page.locator('.menu-item.danger').click()
  await page.locator('.modal .button.danger').click()
  await page.waitForTimeout(900)
  check('删除后会话文件离开原目录', !existsSync(file), file)
  const trashed = existsSync(join(dirs.sessions, '.trash'))
  check('删除进 .trash 而不是直接 unlink', trashed)

  await page.locator('.toast-action').click()
  await page.waitForTimeout(900)
  check('撤销后会话文件回来了', existsSync(file), file)
  check('还原后列表重新出现会话', (await page.locator('.session-item').count()) >= 1)
  await app.close()
}

async function caseSidebarAffordance() {
  const dirs = freshDirs('sidebar')
  seedSession(dirs.sessions, 'mock-session', 'Mock session')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs)
  const opacity = await page.evaluate(() => {
    const button = document.querySelector('.session-menu-button')
    return button ? getComputedStyle(button).opacity : 'missing'
  })
  check('会话菜单按钮不再完全透明', Number(opacity) > 0.2, `opacity=${opacity}`)

  await page.locator('.session-item').first().click({ button: 'right' })
  await page.waitForSelector('.context-menu')
  check('右键菜单可打开', (await page.locator('.context-menu .menu-item').count()) >= 2)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('Esc 关闭右键菜单', (await page.locator('.context-menu').count()) === 0)
  await app.close()
}

try {
  rmSync(tmpRoot, { recursive: true, force: true })
  console.log('\nmenu / keyboard')
  await caseMenuScrollAndKeyboard()
  console.log('\nsession restore')
  await caseSessionRestore()
  console.log('\ndiagnostics')
  await caseDiagnostics()
  console.log('\ndelete + undo')
  await caseDeleteUndo()
  console.log('\nsidebar affordances')
  await caseSidebarAffordance()
  try {
    execFileSync('true')
  } catch {
    // ignore
  }
} catch (error) {
  failures += 1
  console.error('\n crashed:', error instanceof Error ? error.stack : error)
}

const passed = results.filter((item) => item.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(failures ? 1 : 0)
