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
import { createServer } from 'node:http'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { caseNavigationGestures } from './e2e-navigation-gestures.mjs'
import { caseReadmeImages } from './e2e-readme-images.mjs'
import { caseCreator } from './e2e-creator.mjs'
import { caseReadmeLocales } from './e2e-readme-locales.mjs'
import { BrowserRouter } from '../extensions/computer-use/src/browser-router.ts'
import { BrowserActionJournal } from '../extensions/computer-use/src/browser-action-journal.ts'
import { judgeWithJev } from '../extensions/computer-use/src/jev.ts'
import { CreatorWorkspace } from '../extensions/creator/workspace.ts'

const root = resolve(import.meta.dirname, '..')
const tmpRoot = join(root, 'output', 'e2e')
const mockPi = join(root, 'scripts', 'mock-pi.mjs')

// The suite drives the built app (`out/`), not the sources. Running it against
// a stale build silently tests yesterday's UI, so rebuild when sources moved.
function newestSourceMtime(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, newestSourceMtime(path))
    else newest = Math.max(newest, statSync(path).mtimeMs)
  }
  return newest
}

const outMain = join(root, 'out', 'main', 'index.js')
if (!process.env.PI_E2E_APP && (!existsSync(outMain) || Math.max(newestSourceMtime(join(root, 'src')), newestSourceMtime(join(root, 'extensions', 'computer-use', 'src'))) > statSync(outMain).mtimeMs)) {
  console.log('sources changed — building before e2e…')
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
}

let failures = 0
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

function freshDirs(name) {
  const base = join(tmpRoot, name)
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  const dirs = {
    base,
    userData: join(base, 'userData'),
    agent: join(base, 'agent'),
    sessions: join(base, 'sessions')
  }
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true })
  return dirs
}

function seedSession(sessionsDir, id, name, turns = 1, cwd = root) {
  const project = join(sessionsDir, '--mock-project--')
  mkdirSync(project, { recursive: true })
  const file = join(project, `2026-01-01T00-00-00-000Z_${id}.jsonl`)
  const now = new Date().toISOString()
  const lines = [
    { type: 'session', id, cwd, timestamp: now },
    { type: 'session_info', name }
  ]
  for (let i = 0; i < turns; i++) {
    lines.push({
      type: 'message',
      timestamp: now,
      message: { role: 'user', content: [{ type: 'text', text: `${name} question ${i}` }] }
    })
    lines.push({
      type: 'message',
      timestamp: now,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `${name} answer ${i} ${'lorem ipsum dolor sit amet '.repeat(30)}` }],
        usage: { input: 10, output: 20, totalTokens: 30, cost: { total: 0.0001 } }
      }
    })
  }
  writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return file
}

async function launch(dirs, scenario = 'default', extraEnv = {}) {
  // Mock chats expect a connected model so the sidebar shows 已就绪 (not 先连接模型).
  // Cases that exercise the welcome connect panel leave agent settings empty.
  const agentSettings = join(dirs.agent, 'settings.json')
  const piPath = extraEnv.PI_DESKTOP_PI_PATH ?? mockPi
  if (piPath === mockPi && !existsSync(agentSettings)) {
    writeFileSync(agentSettings, JSON.stringify({ defaultProvider: 'mock', defaultModel: 'test' }))
  }
  const executablePath = process.env.PI_E2E_APP
  const app = await electron.launch({
    executablePath,
    args: [...(executablePath ? [] : ['.']), `--user-data-dir=${dirs.userData}`],
    cwd: root,
    env: {
      ...process.env,
      HOME: dirs.base,
      PI_DESKTOP_PI_PATH: mockPi,
      PI_CODING_AGENT_DIR: dirs.agent,
      PI_CODING_AGENT_SESSION_DIR: dirs.sessions,
      MOCK_SCENARIO: scenario,
      PI_CHROME_BRIDGE_SECRET_FILE: join(dirs.base, 'chrome-bridge-secret.json'),
      PI_DESKTOP_SKIP_AUTO_INSTALL: '1',
      PI_DESKTOP_MOCK_AUTH: '1',
      ...extraEnv
    }
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('.composer-input, .welcome', { timeout: 45_000 })
  await page.waitForTimeout(1200)
  const close = app.close.bind(app)
  app.close = async () => {
    await Promise.race([
      close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 8000))
    ])
    try { execFileSync('pkill', ['-f', dirs.userData]) } catch { /* window already gone */ }
  }
  return { app, page, errors }
}

async function openModelMenu(page) {
  await page.locator('.model-chip, .composer-right .chip').first().click()
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
  // Moving the pointer away prevents a menu item appearing under it from
  // changing the highlight while this case exercises keyboard navigation.
  await page.mouse.move(0, 0)
  await page.locator('.menu-item.highlight .menu-item-title').filter({ hasText: 'Mock Fast' }).waitFor()
  const scrollable = await page.evaluate(() => {
    const list = document.querySelector('.popover .menu-list')
    return { scroll: list.scrollHeight, client: list.clientHeight }
  })
  check('模型菜单可滚动', scrollable.scroll > scrollable.client + 40, JSON.stringify(scrollable))

  const popoverBox = await page.evaluate(() => {
    const rect = document.querySelector('.popover').getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, height: rect.height, viewport: window.innerHeight }
  })
  check(
    '弹层完全在窗口内（不溢出底部/顶部）',
    popoverBox.top >= 0 && popoverBox.bottom <= popoverBox.viewport + 1,
    JSON.stringify(popoverBox)
  )

  // keyboard first (no hover, so highlight is driven by keys only)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  const highlightLabel = await page.evaluate(
    () => document.querySelector('.popover .menu-item.highlight .menu-item-title')?.textContent ?? ''
  )
  check('↓ ↓ 移动高亮项', highlightLabel === 'Mock Bulk 0', `highlight=${highlightLabel}`)
  const focusIsInput = await page.evaluate(() => document.activeElement?.tagName === 'INPUT')
  check('移动高亮时焦点仍在搜索框', focusIsInput)

  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const chip = await page.locator('.chip-label').first().innerText()
  check('Enter 选中并关闭菜单', (await page.locator('.popover').count()) === 0, `chip=${chip}`)
  check('选中的模型写回输入区', chip.startsWith('Mock Bulk 0'), chip)

  // scroll: menu list scrolls in place and the menu stays open
  await openModelMenu(page)
  await page.locator('.popover .menu-list').hover()
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(350)
  const stillOpen = await page.locator('.popover').count()
  const scrolledTo = await page.evaluate(() => document.querySelector('.popover .menu-list').scrollTop)
  check('滚轮滚动列表不会关闭菜单', stillOpen === 1, `open=${stillOpen}`)
  check('滚轮确实滚动了列表', scrolledTo > 100, `scrollTop=${scrolledTo}`)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('Esc 关闭菜单', (await page.locator('.popover').count()) === 0)
  const focusBack = await page.evaluate(() => document.activeElement?.className ?? '')
  check('关闭后焦点回到触发器', focusBack.includes('chip'), focusBack)
  check('无 JS 异常', errors.length === 0, errors.join(' | '))
  await app.close()
}

async function caseWorkPanel() {
  const dirs = freshDirs('panel')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root, workPanelTabs: ['changes', 'files', 'terminal', 'artifacts'] })
  )
  const { app, page } = await launch(dirs, 'default', {
    MOCK_TRANSCRIPT: '3',
    MOCK_TOOLS: '2',
    MOCK_EDIT: '1'
  })

  const closed = !(await page.locator('.work-panel').isVisible())
  await page.keyboard.press('Meta+Shift+E')
  await page.waitForSelector('.work-panel')
  check('⌘⇧E 打开右侧工作面板', closed)
  const panelMotion = await page.locator('.work-panel').evaluate((el) => getComputedStyle(el).transitionDuration)
  check('右侧工作面板有平滑过渡', panelMotion.includes('0.2s'), panelMotion)
  const toolChevron = page.locator('.tool-chevron').first()
  const toolChevronOpacity = (await toolChevron.count()) ? Number(await toolChevron.evaluate((el) => getComputedStyle(el).opacity)) : null
  check('工具展开箭头默认可见，不再只靠 hover', toolChevronOpacity !== null && toolChevronOpacity > 0, String(toolChevronOpacity))

  const changes = await page.evaluate(() => ({
    files: document.querySelectorAll('.work-file').length,
    summary: document.querySelector('.work-summary')?.textContent ?? ''
  }))
  check('变更 tab 列出本会话改动', changes.files >= 1 && /\+\d+/.test(changes.summary), JSON.stringify(changes))

  await page.locator('.work-file-head').first().click()
  await page.waitForTimeout(400)
  const diffLines = await page.locator('.work-file-body .diff-line').count()
  check('变更 tab 能展开 diff', diffLines > 0, `lines=${diffLines}`)

  await page.locator('.work-tab-button', { hasText: '文件' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.tree-row').length > 1, null, { timeout: 8000 })
  const tree = await page.locator('.tree-row').count()
  check('文件 tab 渲染目录树', tree > 1, `rows=${tree}`)

  await page.locator('.work-tab-button', { hasText: '终端' }).click()
  await page.locator('.terminal-input input').fill('echo panel')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  const terminal = await page.evaluate(() => ({
    output: document.querySelector('.terminal-output')?.textContent ?? '',
    exit: document.querySelector('.terminal-exit')?.textContent ?? ''
  }))
  check('终端 tab 通过 pi 执行命令', terminal.output.includes('mock-pi') && terminal.exit.includes('0'), JSON.stringify(terminal))

  await page.locator('.work-tab-button', { hasText: '产物' }).click()
  await page.waitForTimeout(300)
  const artifacts = await page.evaluate(
    () => document.querySelector('.work-tab-container:not([hidden]) .work-empty')?.textContent ?? ''
  )
  check('产物 tab 有空状态', artifacts.length > 0, artifacts.slice(0, 30))

  await page.keyboard.press('Meta+Shift+E')
  await page.waitForTimeout(400)
  check('⌘⇧E 再次关闭面板', !(await page.locator('.work-panel').isVisible()))

  // resize: drag wider then drag far right to collapse
  await page.keyboard.press('Meta+Shift+E')
  await page.waitForFunction(() => Boolean(document.querySelector('.work-panel')), null, {
    timeout: 5000
  })
  await page.waitForTimeout(300)
  const panelWidth = async () =>
    page.locator('.work-panel').evaluate((el) => Math.round(el.getBoundingClientRect().width))
  const dragHandle = async (dx) => {
    const box = await page.locator('.work-resize').boundingBox()
    await page.mouse.move(box.x + 5, box.y + 260)
    await page.mouse.down()
    await page.mouse.move(box.x + 5 + dx, box.y + 260, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(250)
  }
  const widthStart = await panelWidth()
  const handleBox = await page.locator('.work-resize').boundingBox()
  await page.mouse.move(handleBox.x + 5, handleBox.y + 260)
  await page.mouse.down()
  await page.mouse.move(handleBox.x - 75, handleBox.y + 260)
  await page.waitForTimeout(50)
  const duringDrag = await page.locator('.work-panel').evaluate((el) => ({ width: el.getBoundingClientRect().width, transition: getComputedStyle(el).transitionDuration }))
  check('拖动时面板及时跟随鼠标且不叠加宽度动画', Math.abs(duringDrag.width - (widthStart + 80)) < 3 && duringDrag.transition.split(',').every((value) => parseFloat(value) === 0), JSON.stringify(duringDrag))
  await page.mouse.up()
  await page.waitForTimeout(250)
  await dragHandle(80)
  await dragHandle(-110)
  const widthWide = await panelWidth()
  const composerAlignment = await page.evaluate(() => {
    const composer = document.querySelector('.composer').getBoundingClientRect()
    const project = document.querySelector('.composer-project-row').getBoundingClientRect()
    const slot = document.querySelector('.composer-project-slot').getBoundingClientRect()
    return { composer: [composer.left, composer.right], project: [project.left, project.right], slot: [slot.left, slot.right] }
  })
  check('窄对话区项目栏保持在输入框内', composerAlignment.project[0] >= composerAlignment.composer[0] - 1 && composerAlignment.project[1] <= composerAlignment.composer[1] + 1 && composerAlignment.slot[1] <= composerAlignment.composer[1] + 1, JSON.stringify(composerAlignment))
  await page.locator('.composer-wrap').evaluate((el) => { el.style.width = '340px' })
  const narrowAlignment = await page.evaluate(() => {
    const composer = document.querySelector('.composer').getBoundingClientRect()
    const project = document.querySelector('.composer-project-row').getBoundingClientRect()
    return { composer: [composer.left, composer.right], project: [project.left, project.right] }
  })
  check('更窄输入框中项目栏仍不会溢出', narrowAlignment.project[0] >= narrowAlignment.composer[0] - 1 && narrowAlignment.project[1] <= narrowAlignment.composer[1] + 1, JSON.stringify(narrowAlignment))
  await page.screenshot({ path: 'output/panel-resize.png' })
  await page.locator('.composer-wrap').evaluate((el) => { el.style.width = '' })
  await dragHandle(120)
  const widthNarrow = await panelWidth()
  check(
    '拖拽可以变宽 / 变窄（有最小宽度）',
    widthWide > widthStart && widthNarrow < widthWide && widthNarrow >= 280,
    `${widthStart} → ${widthWide} → ${widthNarrow}`
  )
  await dragHandle(600)
  check('拖到最窄再放手会收起面板', !(await page.locator('.work-panel').isVisible()))
  await app.close()
}

async function caseWorkPanelLanding() {
  const dirs = freshDirs('panel-landing')
  const settingsFile = join(dirs.userData, 'settings.json')
  const settings = { theme: 'dark', workspaces: [dirs.base], lastWorkspace: dirs.base, workPanelOpen: false, autoCheckUpdates: false }
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<title>Work panel test</title><p>Work panel test</p>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  try {
    const workspaceFile = join(dirs.base, 'panel-example.txt')
    writeFileSync(workspaceFile, 'An open file should stay active.')
    for (const saved of [
      { workPanelTabs: [], workPanelTab: 'files' },
      { workPanelTabs: ['files'], workPanelTab: 'files', workPanelOpen: true },
      { workPanelTabs: ['browser'], workPanelTab: 'browser' }
    ]) {
      let app
      try {
        writeFileSync(settingsFile, JSON.stringify({ ...settings, ...saved }))
        const launched = await launch(dirs)
        app = launched.app
        const { page } = launched
        const toggle = page.getByRole('button', { name: '工作面板', exact: true })
        const landing = page.getByRole('textbox', { name: '搜索文件或输入网址' })
        const selectedTab = () => page.locator('.work-tabs [aria-selected="true"]').innerText()
        const setPanel = async (open) => {
          const pressed = (await toggle.getAttribute('aria-pressed')) === 'true'
          if (pressed !== open) await toggle.click()
          await page.waitForFunction((want) => {
            const el = document.querySelector('.work-panel')
            const width = el?.getBoundingClientRect().width ?? 0
            return want ? width > 100 : width < 1
          }, open, { timeout: 6000 })
          await page.waitForTimeout(220)
        }
        await setPanel(true)
        await landing.waitFor({ timeout: 6000 })
        check('无页面时打开右栏进入新标签页', (await selectedTab()) === '新标签页', JSON.stringify(saved))
        await page.locator('.work-home').getByRole('button', { name: '文件', exact: true }).click()
        await page.getByText('panel-example.txt', { exact: true }).click()
        await page.getByRole('tab', { name: 'panel-example.txt', exact: true, selected: true }).waitFor()
        await setPanel(false)
        await setPanel(true)
        check('再次打开右栏保留正在查看的文件', (await selectedTab()) === 'panel-example.txt')
        await page.getByRole('button', { name: '关闭panel-example.txt标签', exact: true }).click()
        await setPanel(false)
        await setPanel(true)
        await landing.waitFor({ timeout: 6000 })
        check('仅剩目录树时再次打开右栏显示新标签页', (await selectedTab()) === '新标签页')
        await page.getByRole('button', { name: '关闭文件标签', exact: true }).click()
        await landing.waitFor({ timeout: 6000 })
        check('关闭最后一个文件页后显示新标签页', (await selectedTab()) === '新标签页')
        await page.locator('.work-home').getByRole('button', { name: '网页', exact: true }).click()
        const address = page.getByRole('textbox', { name: '网址', exact: true })
        await address.fill(url)
        await address.press('Enter')
        await page.waitForFunction(async (expected) => (await window.pi.browserCurrent()).url === expected, url, { timeout: 8000 })
        await setPanel(false)
        await setPanel(true)
        check('再次打开右栏保留已加载网页', (await selectedTab()) !== '新标签页' && (await address.inputValue()) === url)
        await page.getByRole('button', { name: '关闭浏览器', exact: true }).click()
        await landing.waitFor({ timeout: 6000 })
        check('关闭最后一个网页后显示新标签页', (await selectedTab()) === '新标签页')
      } finally {
        await app?.close()
      }
    }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

async function caseUsageTrend() {
  const dirs = freshDirs('usage')
  const project = join(dirs.sessions, '--mock-project--')
  mkdirSync(project, { recursive: true })
  const now = Date.now()
  const lines = [{ type: 'session', id: 'usage-session', cwd: root, timestamp: new Date(now).toISOString() }]
  for (let i = 0; i < 5; i += 1) {
    lines.push({
      type: 'message',
      timestamp: new Date(now - i * 86_400_000).toISOString(),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `answer ${i}` }],
        provider: 'mock',
        model: 'mock-fast',
        usage: { input: 100 + i * 10, output: 50, totalTokens: 150 + i * 10, cost: { total: 0.01 * (i + 1) } }
      }
    })
  }
  lines.push({
    type: 'message',
    timestamp: new Date(now).toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'skill-call', name: 'read', arguments: { path: '~/.pi/agent/skills/demo-skill/SKILL.md' } }],
      provider: 'mock',
      model: 'mock-fast',
      usage: { input: 50, output: 10, totalTokens: 60, cost: { total: 0.002 } }
    }
  })
  writeFileSync(
    join(project, 'usage.jsonl'),
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
  )
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs, 'default')
  await page.keyboard.press('Meta+,')
  await page.waitForSelector('.settings-page')
  await page.getByRole('button', { name: '使用情况与费用' }).click()
  await page.waitForSelector('.usage-trend')
  const trend = await page.evaluate(() => ({
    line: Boolean(document.querySelector('.usage-trend-line')),
    points: document.querySelectorAll('.usage-trend-point').length,
    labels: Array.from(document.querySelectorAll('.usage-trend-axis span')).map((item) => item.textContent),
    metric: document.querySelector('.usage-chart-tab.active')?.textContent ?? ''
  }))
  check('使用情况页渲染趋势图', trend.line && trend.points >= 5, JSON.stringify(trend))
  check('趋势图显示按天标签', trend.labels.some(Boolean), JSON.stringify(trend.labels))
  await page.locator('.usage-trend-hover').hover({ position: { x: 500, y: 80 } })
  await page.waitForSelector('.usage-trend-tooltip')
  const tooltip = await page.locator('.usage-trend-tooltip').innerText()
  check('趋势图悬停显示 Tokens 和调用次数', /tokens/i.test(tooltip) && tooltip.includes('次调用'), tooltip)
  await page.getByRole('button', { name: 'Tokens' }).click()
  await page.waitForTimeout(200)
  check('趋势图可切换 Tokens', (await page.locator('.usage-metric-tabs .usage-chart-tab.active').textContent()) === 'Tokens')
  await page.getByRole('button', { name: '柱状' }).click()
  await page.waitForTimeout(200)
  check('图表可以切换柱状', (await page.locator('.usage-trend-bar').count()) > 0)
  check('柱状图不显示圆点', (await page.locator('.usage-trend-point').count()) === 0)
  check('技能调用统计显示', (await page.locator('.usage-skill-table').innerText()).includes('demo-skill'))
  const planRows = await page.locator('.usage-table:not(.usage-skill-table) tbody tr').first().innerText()
  check('用量明细按套餐 + 模型拆分', planRows.includes('mock') && planRows.includes('mock-fast'), planRows)
  check('会话按 Tokens 排序', (await page.locator('.usage-tab').filter({ hasText: '按会话' }).count()) === 1)
  await app.close()
}

async function caseNetworkSettings() {
  const dirs = freshDirs('network-settings')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root }))
  const { app, page } = await launch(dirs, 'default')
  try {
    await page.keyboard.press('Meta+,')
    await page.waitForSelector('.settings-page')
    await page.getByRole('button', { name: '权限与安全', exact: true }).click()
    const networking = page.getByRole('switch', { name: '联网', exact: true })
    check('联网默认开启', await networking.getAttribute('aria-checked') === 'true')
    await networking.click()
    await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="联网"]')?.getAttribute('aria-checked') === 'false')
    check('关闭联网会保存新对话偏好', JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8')).sandboxNetwork === 'off')
    const pageText = await page.locator('.settings-content').innerText()
    check('主页面只显示审批与联网偏好', /新对话的执行方式/.test(pageText) && !/允许使用完全访问|域名|代理地址/.test(pageText))
    await page.getByText('连接与诊断', { exact: true }).click()
    check('诊断里保留代理地址和日志入口', await page.getByLabel('代理地址', { exact: true }).isVisible() &&
      await page.getByRole('button', { name: '查看日志' }).isVisible())
  } finally { await app.close() }
}

async function caseChromeImport() {
  const dirs = freshDirs('chrome-import')
  const chromeRoot = join(dirs.base, 'chrome')
  const profile = join(chromeRoot, 'Default')
  mkdirSync(profile, { recursive: true })
  writeFileSync(
    join(chromeRoot, 'Local State'),
    JSON.stringify({ profile: { info_cache: { Default: { name: 'Mock Chrome', user_name: 'tester@example.test' } } } })
  )
  const db = join(profile, 'Cookies')
  execFileSync('sqlite3', [
    db,
    `CREATE TABLE cookies (
      host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB,
      path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER
    );
    INSERT INTO cookies VALUES
      ('example.test', 'session', 'plain-value', X'', '/', 0, 0, 0, -1),
      ('.example.test', 'shared', 'shared-value', X'', '/', 0, 0, 0, -1);`
  ])
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs, 'default', {
    PI_CHROME_ROOT: chromeRoot,
    PI_CHROME_RUNNING: '0'
  })
  const profiles = await page.evaluate(() => window.pi.chromeProfiles())
  check('Chrome profile 被检测到', profiles.profiles.some((item) => item.id === 'Default'), JSON.stringify(profiles))
  const preview = await page.evaluate(() => window.pi.chromePreview('Default'))
  check('Chrome 站点预览只返回域名和数量', preview.domains.some((item) => item.domain === 'example.test' && item.count === 2), JSON.stringify(preview))
  const result = await page.evaluate(() => window.pi.chromeImport('Default', ['example.test']))
  check('Chrome Cookie 导入成功', result.ok && result.imported === 2, JSON.stringify(result))
  const blocked = await page.evaluate(() => window.pi.chromeImport('Default', ['javascript:alert(1)']))
  check('Chrome 导入拒绝非域名输入', !blocked.ok && blocked.error.length > 0, JSON.stringify(blocked))

  await page.keyboard.press('Meta+,')
  await page.waitForSelector('.settings-page')
  await page.getByRole('button', { name: '网页浏览', exact: true }).click()
  await page.getByRole('button', { name: '从 Chrome 导入…' }).click()
  await page.waitForSelector('.chrome-domain-row')
  check('设置里能打开 Chrome 导入弹窗', (await page.locator('.chrome-domain-row').count()) === 1)
  await page.locator('.chrome-domain-row input').first().check()
  await page.getByRole('button', { name: '导入所选站点' }).click()
  await page.waitForSelector('.chrome-import-result')
  check('导入弹窗显示导入结果', (await page.locator('.chrome-import-result').textContent()).includes('2'))
  await app.close()
}

async function caseBrowser() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><script>globalThis.__piDocumentIdentity=\"forged\"</script><title>Browser Fixture</title><h1>browser ok</h1><p>上传成功：订单 002</p><div style="display:none">hidden-secret</div><label>登录码<textarea hidden autocomplete="one-time-code">otp-secret</textarea></label><button id=go onclick="this.textContent=\'clicked\'">Go</button>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const dirs = freshDirs('browser')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      workspaces: [root],
      lastWorkspace: root,
      workPanelTabs: ['browser'],
      workPanelTab: 'browser'
    })
  )
  let app
  try {
    const launched = await launch(dirs, 'default', { HOME: dirs.base })
    app = launched.app
    const page = launched.page

    await page.keyboard.press('Meta+Shift+B')
    await page.waitForSelector('.browser-toolbar')
    check('⌘⇧B 打开右侧浏览器', await page.locator('.browser-toolbar').isVisible())
    check('空白浏览器显示空状态', (await page.locator('.browser-empty').count()) === 1)
    check('浏览器说明不承诺所有操作都需要确认', (await page.locator('.browser-guide').innerText()).includes('操作是否需要确认取决于审批设置'))

    await page.locator('.browser-address input').fill(`http://127.0.0.1:${port}/`)
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      () => (document.querySelector('.browser-address input')?.value ?? '').includes('127.0.0.1'),
      null,
      { timeout: 8000 }
    )
    await page.waitForTimeout(700)
    const state = await page.evaluate(() => ({
      url: document.querySelector('.browser-address input')?.value ?? '',
      error: document.querySelector('.browser-error')?.textContent ?? '',
      surface: Boolean(document.querySelector('.browser-surface'))
    }))
    check('浏览器加载 localhost 页面', state.url.includes('127.0.0.1') && !state.error, JSON.stringify(state))
    check('浏览器渲染页面容器', state.surface)

    const native = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const children = win?.contentView?.children ?? []
      const view = children.find((child) => child.constructor?.name?.includes('WebContentsView'))
      return { count: children.length, bounds: view?.getBounds?.() ?? null, visible: view?.getVisibility?.() ?? null }
    })
    check('浏览器原生视图有有效 bounds', Boolean(native.bounds && native.bounds.width > 100 && native.bounds.height > 100), JSON.stringify(native))

    const bridgePath = await app.evaluate(() => process.env.PI_DESKTOP_BROWSER_BRIDGE_FILE)
    const bridge = JSON.parse(readFileSync(bridgePath, 'utf8'))
    const controllerId = randomUUID()
    const bridgeHeaders = (body) => ({
      authorization: `Bearer ${bridge.token}`,
      'x-pi-controller': controllerId,
      'x-pi-page': 'main',
      'x-pi-pid': String(process.pid),
      ...(body ? { 'content-type': 'application/json' } : {})
    })
    const request = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${bridge.port}${path}`, { method: body ? 'POST' : 'GET', headers: bridgeHeaders(body), body: body ? JSON.stringify(body) : undefined })
      return { status: response.status, body: await response.json() }
    }
    await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find((child) => child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("const label=document.createElement('label');label.id='order-label';label.innerHTML='订单编号 <input>';document.body.append(label)")
    })
    const labeledObservation = (await request('/observe', {})).body
    const invalidRead = await request('/read-text',{snapshotId:labeledObservation.snapshotId,expectedUrl:'http://invalid.test/'})
    check('读取网页文本拒绝地址不一致', invalidRead.status === 400 && /changed/i.test(invalidRead.body.error))
    const labeled = labeledObservation.candidates.find((item) => item.name === '订单编号')
    check('应用内浏览器识别关联的输入框标签', Boolean(labeled))
    await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find((child) => child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("document.querySelector('#order-label').firstChild.textContent='其他编号 '")
    })
    const changedLabel = labeled && await request('/act', {candidateId:labeled.id,type:'type',text:'example',snapshotId:labeledObservation.snapshotId,expectedUrl:labeledObservation.state.url})
    check('应用内浏览器拒绝标签已改变的输入框', changedLabel?.status === 400)
    await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find((child) => child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("document.querySelector('#order-label').remove()")
    })
    await app.evaluate(async ({ BrowserWindow }) => {
      const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("const input=document.createElement('input');input.id='test-upload';input.type='file';document.body.append(input)")
    })
    await app.evaluate(async ({ BrowserWindow }) => {
      const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView'))
      view.webContents.debugger.attach('1.3')
      globalThis.__chooserEvents=[]
      view.webContents.debugger.on('message', (_event, method) => { if (method === 'Page.fileChooserOpened') globalThis.__chooserEvents.push(Date.now()) })
      await view.webContents.debugger.sendCommand('Page.enable')
      await view.webContents.debugger.sendCommand('Page.setInterceptFileChooserDialog',{enabled:true})
    })
    const chooserProbe=async visible=>{
      await app.evaluate(({BrowserWindow},value)=>{const v=BrowserWindow.getAllWindows()[0].contentView.children.find(c=>c.constructor?.name?.includes('WebContentsView'));v.setVisible(value);globalThis.__chooserEvents=[]},visible)
      const obs=(await request('/observe',{})).body
      const file=obs.candidates.find(item=>item.type==='file')
      const result=file && await request('/act',{candidateId:file.id,type:'click',snapshotId:obs.snapshotId,expectedUrl:obs.state.url})
      await page.waitForTimeout(400)
      const events=await app.evaluate(()=>globalThis.__chooserEvents.length)
      const actualVisible=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.find(c=>c.constructor?.name?.includes('WebContentsView')).getVisible())
      return {visible,file:!!file,status:result?.status,events,actualVisible}
    }
    const visibleProbe=await chooserProbe(true)
    await page.locator('[aria-label="工作面板"]').click()
    await page.waitForFunction(()=>document.querySelector('[aria-label="工作面板"]')?.getAttribute('aria-pressed')==='false')
    const hiddenProbe=await chooserProbe(false)
    console.log('  chooser diagnostic',JSON.stringify({visibleProbe,hiddenProbe}))
    check('隐藏面板的文件选择前自动展示浏览器',hiddenProbe.actualVisible && hiddenProbe.events===1)
    await page.keyboard.press('Meta+,')
    await page.getByRole('heading',{name:'设置',exact:true}).waitFor()
    const blockedProbe=await chooserProbe(false)
    check('浏览器不能显示时安全拒绝且不打开选择器',blockedProbe.status===400 && blockedProbe.events===0,JSON.stringify(blockedProbe))
    await page.getByRole('button',{name:'返回对话'}).click()
    await app.evaluate(async ({BrowserWindow})=>{const v=BrowserWindow.getAllWindows()[0].contentView.children.find(c=>c.constructor?.name?.includes('WebContentsView'));await v.webContents.debugger.sendCommand('Page.setInterceptFileChooserDialog',{enabled:false});v.webContents.debugger.detach();v.setVisible(true)})
    const beforeFile=(await request('/observe',{})).body
    await app.evaluate(async ({ BrowserWindow }) => {
      const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("const dt=new DataTransfer();dt.items.add(new File(['abc'],'fixture.csv',{type:'text/csv'}));document.querySelector('#test-upload').files=dt.files;void 0")
    })
    const staleFile=await request('/act',{candidateId:beforeFile.candidates.find(item=>item.name==='Go').id,type:'click',snapshotId:beforeFile.snapshotId,expectedUrl:beforeFile.state.url})
    check('文件选择变化后禁止使用旧观察执行按钮',staleFile.status===400 && /observe again/i.test(staleFile.body.error))
    const afterFile=(await request('/observe',{})).body
    const selectedFile=afterFile.candidates.find(item=>item.type==='file')
    check('文件候选返回文件名大小而非路径',selectedFile?.value==='' && selectedFile.files?.[0]?.name==='fixture.csv' && selectedFile.files[0].size===3)
    const fileReference = await request('/check-file', {snapshotId:afterFile.snapshotId,expectedUrl:afterFile.state.url,documentId:afterFile.documentId,candidateId:selectedFile.id})
    check('确认前保留的文件对象可核对',fileReference.status===200)
    const hashFile = await request('/hash-file', {snapshotId:afterFile.snapshotId,expectedUrl:afterFile.state.url,documentId:afterFile.documentId,candidateId:selectedFile.id})
    check('应用内浏览器对选中文件计算摘要',hashFile.status===200 && hashFile.body.sha256===createHash('sha256').update('abc').digest('hex') && hashFile.body.size===3,JSON.stringify(hashFile))
    const wrongDocument = await request('/hash-file', {snapshotId:afterFile.snapshotId,expectedUrl:afterFile.state.url,documentId:'wrong',candidateId:selectedFile.id})
    check('文件摘要拒绝错误文档',wrongDocument.status!==200)

    await app.evaluate(async ({ BrowserWindow }) => {
      const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("(() => {const input=document.querySelector('#test-upload');const previous=input.files[0];const dt=new DataTransfer();dt.items.add(new File(['xyz'],previous.name,{type:previous.type,lastModified:previous.lastModified}));input.files=dt.files})()")
    })
    const changedReference = await request('/check-file', {snapshotId:afterFile.snapshotId,expectedUrl:afterFile.state.url,documentId:afterFile.documentId,candidateId:selectedFile.id})
    check('同名同大小文件替换后拒绝确认',changedReference.status!==200)
    const staleHash = await request('/hash-file', {snapshotId:afterFile.snapshotId,expectedUrl:afterFile.state.url,documentId:afterFile.documentId,candidateId:selectedFile.id})
    check('文件变化后拒绝旧摘要观察',staleHash.status!==200)
    const sameMetadata=await request('/act',{candidateId:afterFile.candidates.find(item=>item.name==='Go').id,type:'click',snapshotId:afterFile.snapshotId,expectedUrl:afterFile.state.url})
    check('同名同大小的不同文件也要求重新观察',sameMetadata.status===400 && /observe again/i.test(sameMetadata.body.error))
    await app.evaluate(async ({ BrowserWindow }) => {
      const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("document.querySelector('#test-upload').remove()")
    })
    const observation = (await request('/observe', {})).body
    const button = observation.candidates.find((item) => item.name === 'Go')
    check('会话观察返回页面及候选绑定', Boolean(observation.snapshotId && observation.state.url.includes('127.0.0.1') && button))
    const unguarded = await request('/act', { candidateId: button.id, type: 'click' })
    const partialGuards = await Promise.all([
      request('/act', { candidateId: button.id, type: 'click', snapshotId: observation.snapshotId }),
      request('/act', { candidateId: button.id, type: 'click', expectedUrl: observation.state.url }),
      request('/act', { candidateId: button.id, type: 'click', snapshotId: '', expectedUrl: observation.state.url })
    ])
    check('应用内浏览器拒绝不完整的观察绑定', partialGuards.every((response) => response.status === 400))
    const afterUnguarded = await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find((child) => child.constructor?.name?.includes('WebContentsView'))
      return view.webContents.executeJavaScript("document.querySelector('#go').textContent")
    })
    check('应用内浏览器拒绝无观察绑定的动作', unguarded.status === 400 && afterUnguarded === 'Go', JSON.stringify({ status: unguarded.status, afterUnguarded }))
    if (afterUnguarded !== 'Go') await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find((child) => child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("document.querySelector('#go').textContent = 'Go'")
    })
    const action = { candidateId: button.id, type: 'click', snapshotId: observation.snapshotId, expectedUrl: observation.state.url }
    await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find((child) => child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("document.querySelector('#go').textContent = 'Delete'")
    })
    const staleTarget = await request('/act', action)
    check('应用内浏览器拒绝已变更的目标', staleTarget.status === 400 && /target changed|observe again/i.test(staleTarget.body.error), JSON.stringify(staleTarget))
    await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find((child) => child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("document.querySelector('#go').textContent = 'Go'")
    })
    const refreshed = (await request('/observe', {})).body
    action.snapshotId = refreshed.snapshotId
    const firstAction = await request('/act', action)
    check('应用内浏览器执行已绑定动作', firstAction.status === 200 && firstAction.body.result.ok === true)
    const replay = await request('/act', action)
    check('应用内浏览器拒绝重复使用观察', replay.status === 400 && /observe again/i.test(replay.body.error), JSON.stringify(replay))
    const again = (await request('/observe', {})).body
    const changed = await request('/act', { ...action, snapshotId: again.snapshotId, expectedUrl: 'http://invalid.test/' })
    check('应用内浏览器拒绝地址不一致的动作', changed.status === 400 && /changed/i.test(changed.body.error), JSON.stringify(changed))

    const extensionSource = readFileSync(join(root, 'extensions/computer-use/index.ts'), 'utf8')
    const registrationStart = extensionSource.indexOf('export default function computerUse(')
    const registrationEnd = extensionSource.indexOf("  pi.registerTool({\n    name: 'computer_use_apps'", registrationStart)
    const code = stripTypeScriptTypes(extensionSource.slice(registrationStart, registrationEnd).replace('export default function', 'function') + '\n}')
    const tools = new Map()
    const Type = new Proxy({}, { get: () => (...args) => ({ args }) })
    let dropGuardReply = false
    const bridgeRequest = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${bridge.port}${path}`, { method: body ? 'POST' : 'GET', headers: bridgeHeaders(body), body: body ? JSON.stringify(body) : undefined })
      const result = await response.json()
      if (dropGuardReply && path === '/act' && result.code === 'PI_GUARD_REJECTED') { dropGuardReply = false; throw new Error('simulated lost bridge response') }
      if (path === '/act' && result.code === 'PI_GUARD_REJECTED' && ['page_changed','human','target_changed'].includes(result.reason)) return { result: { __piGuardRejected: result.reason } }
      if (!response.ok || result.ok === false) throw new Error(result.error)
      return result
    }
    const journal = new BrowserActionJournal(join(dirs.base,'browser-test-journal.sqlite'))
    const factory = runInNewContext(`${code}\ncomputerUse`, { BrowserRouter, judgeWithJev, Type, createBrowserActionJournal: () => journal, bridgeRequest, randomUUID, URL, setTimeout, setInterval, clearInterval, process: { env: { PI_DESKTOP_BROWSER_BRIDGE_FILE: 'fixture' } }, approvalMode: 'always', manualBrowserApproval: false, allowRoutineActions: false, audit: async () => {} })
    const lifecycle = new Map()
    factory({ registerTool: (definition) => tools.set(definition.name, definition), on: (name, handler) => lifecycle.set(name, handler) })
    const invoke = async (name, params = {}) => tools.get(name).execute('test', params, undefined, undefined, { ui: { confirm: async () => true } })
    await invoke('computer_use_session_open', { backend: 'inapp' })
    let observed = JSON.parse((await invoke('computer_use_session_observe', { url: `http://127.0.0.1:${port}/` })).content[0].text)
    const marker = page.locator('.work-tabs [data-control]')
    await marker.waitFor()
    check('实际浏览器观察给对应标签加上鼠标状态', await marker.getAttribute('data-control') === 'active')
    const originalPage = (await page.evaluate(() => window.pi.browserCurrent())).documentId
    const personalPage = await page.evaluate(async url => {
      await window.pi.browserNavigate(url, true)
      return (await window.pi.browserCurrent()).documentId
    }, `http://127.0.0.1:${port}/?personal`)
    await page.waitForFunction(expected => window.pi.browserCurrent().then(current => current.documentId === expected && current.otherTab?.documentId === expected), personalPage)
    check('切到个人网页后，鼠标图标留在 Pi 的标签', await marker.getAttribute('aria-selected') === 'false' && personalPage !== originalPage)
    await marker.click()
    await page.waitForFunction(expected => window.pi.browserCurrent().then(current => current.documentId === expected), originalPage)
    const changeButton = async text => app.evaluate(async ({ BrowserWindow }, value) => { const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView')); await view.webContents.executeJavaScript(`document.querySelector('#go').textContent=${JSON.stringify(value)}`) }, text)
    await app.evaluate(async ({ BrowserWindow }) => { const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView')); await view.webContents.executeJavaScript("window.__testClicks=0;document.querySelector('#go').addEventListener('click',()=>window.__testClicks++)") })
    const clickCount = () => app.evaluate(async ({ BrowserWindow }) => { const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView')); return view.webContents.executeJavaScript('window.__testClicks') })
    const originalButton=observed.candidates.find(item=>item.name==='Go')
    await changeButton('Changed')
    let rejected=false
    try { await invoke('computer_use_session_act',{candidateId:originalButton.id,type:'click'}) } catch(error) { rejected=/target changed/i.test(String(error)) }
    check('应用内明确拒绝后无需人工解除记录',rejected && journal.pending('inapp')===null && await clickCount()===0)
    await changeButton('Go')
    observed=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
    await changeButton('Changed')
    dropGuardReply=true
    let unknown=false
    try { await invoke('computer_use_session_act',{candidateId:observed.candidates.find(item=>item.name==='Go').id,type:'click'}) } catch(error) { unknown=/result is unknown/i.test(String(error)) }
    check('应用内拒绝响应丢失时保留待核对记录',unknown && !dropGuardReply && !!journal.pending('inapp') && await clickCount()===0)
    await invoke('computer_use_session_takeover',{reason:'核对动作结果'})
    await changeButton('Go')
    observed=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
    await app.evaluate(async ({ BrowserWindow }) => { const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView')); await view.webContents.executeJavaScript("(() => {const frame=document.createElement('iframe');frame.id='guard-challenge';frame.title='reCAPTCHA challenge';document.body.append(frame)})()") })
    let challengeRejected=false
    try { await invoke('computer_use_session_act',{candidateId:observed.candidates.find(item=>item.name==='Go').id,type:'click'}) } catch(error) { challengeRejected=/human verification/i.test(String(error)) }
    check('应用内人机验证拒绝不保留未知动作记录',challengeRejected && journal.pending('inapp')===null && await clickCount()===0)
    await app.evaluate(async ({ BrowserWindow }) => { const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView')); await view.webContents.executeJavaScript("document.querySelector('#guard-challenge').remove()") })
    await invoke('computer_use_session_takeover',{reason:'完成人机验证'})
    observed=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
    const read = await invoke('computer_use_session_read')
    check('读取可见业务状态但不读取隐藏内容或输入值', read.content[0].text.includes('上传成功：订单 002') && !read.content[0].text.includes('hidden-secret') && !read.content[0].text.includes('otp-secret'))
    await app.evaluate(async ({ BrowserWindow }) => {
      const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("const p=document.createElement('p');p.id='long-page-text';p.textContent='x'.repeat(9000);document.body.append(p)")
    })
    const limited = await invoke('computer_use_session_read')
    check('长网页文本有上限并提示截断', limited.details.length <= 8000 && limited.details.truncated === true)
    await app.evaluate(async ({ BrowserWindow }) => {
      const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("document.querySelector('#long-page-text').remove()")
    })
    const unifiedButton = observed.candidates.find((item) => item.name === 'Go')
    const unifiedAction = await invoke('computer_use_session_act', { candidateId: unifiedButton.id, type: 'click' })
    check('统一会话可导航、观察并操作应用内浏览器', unifiedAction.details.result.result.ok === true)
    const afterActionRead = await invoke('computer_use_session_read')
    check('动作后可读取绑定页面但仍需观察才能再次操作', afterActionRead.content[0].text.includes('clicked') && await tools.get('computer_use_session_act').execute('test',{candidateId:unifiedButton.id,type:'click'},undefined,undefined,{ui:{confirm:async()=>true}}).then(()=>false,error=>/observe/i.test(String(error))))
    await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find((child) => child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("setTimeout(() => { const button = document.createElement('button'); button.textContent = '模拟后台已就绪'; document.body.append(button) }, 350)")
    })
    const ready = await invoke('computer_use_session_wait', {name:'模拟后台已就绪',role:'button',timeoutMs:4000})
    check('统一会话等待动态后台控件并获得新观察', ready.details.matched === true && ready.details.candidate?.name === '模拟后台已就绪', JSON.stringify(ready.details))
    const beforeChallenge = JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
    await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find((child) => child.constructor?.name?.includes('WebContentsView'))
      await view.webContents.executeJavaScript("const frame = document.createElement('iframe'); frame.title = 'reCAPTCHA challenge'; document.body.append(frame)")
    })
    let readBlocked=false
    try { await invoke('computer_use_session_read') } catch (error) { readBlocked=/human verification/i.test(String(error)) }
    check('读取页面时遇到验证立即暂停', readBlocked)
    let blocked = false
    try { await invoke('computer_use_session_act', { candidateId: beforeChallenge.candidates[0].id, type: 'click' }) } catch (error) { blocked = /human (?:verification|action)/i.test(String(error)) }
    check('应用内浏览器阻止验证出现后的动作', blocked)
    let paused = false
    try { await invoke('computer_use_session_observe') } catch (error) { paused = /human/i.test(String(error)) }
    check('验证出现后暂停并等待人工接管', paused)
    const handoff = tools.get('computer_use_session_takeover').execute('test', {reason:'完成人机验证'}, undefined, undefined, {
      ui: { confirm: async () => {
        await page.locator('.work-tabs [data-control="waiting"]').waitFor()
        return false
      } }
    })
    await handoff
    check('接管时标签显示等你操作', await marker.getAttribute('data-control') === 'waiting')
    await lifecycle.get('agent_end')()
    await marker.waitFor({ state: 'detached' })
    check('任务结束清除鼠标标记', await marker.count() === 0)
    await invoke('computer_use_session_close')
    journal.close()
    const beforeReloadIdentity=(await request('/observe',{})).body.documentId
    const sameDocumentIdentity=(await request('/observe',{})).body.documentId
    await app.evaluate(async ({BrowserWindow})=>{const view=BrowserWindow.getAllWindows()[0].contentView.children.find(c=>c.constructor?.name?.includes('WebContentsView'));await new Promise(resolve=>{view.webContents.once('did-finish-load',resolve);view.webContents.reload()})})
    const afterReloadIdentity=(await request('/observe',{})).body.documentId
    check('应用内文档标识在同页稳定且重载后改变',typeof beforeReloadIdentity==='string' && beforeReloadIdentity===sameDocumentIdentity && beforeReloadIdentity!==afterReloadIdentity)

    await page.locator('.browser-address input').fill('javascript:alert(1)')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.browser-error')
    check('拒绝 javascript: 地址', (await page.locator('.browser-error').textContent()).includes('http'))
    await page.locator('.browser-icon[aria-label="关闭浏览器"]').click()
    await page.waitForTimeout(300)
    check('关闭浏览器后回到空状态', (await page.locator('.browser-empty').count()) === 1)
  } finally {
    if (app) await app.close()
    await new Promise((resolve) => server.close(resolve))
  }
}

async function caseChatMedia() {
  const dirs = freshDirs('chat-media')
  const project = join(dirs.base, 'project')
  mkdirSync(project)
  const videoName = '演示 视频.mp4'
  writeFileSync(join(project, videoName), readFileSync(join(root, 'scripts/fixtures/chat-preview.mp4')))
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#315878"/></svg>'
  writeFileSync(join(project, 'cover.svg'), svg)
  writeFileSync(join(project, 'cover-2.svg'), svg.replace('#315878', '#a77049'))
  writeFileSync(join(project, 'report.pdf'), '%PDF-1.4\nfixture\n%%EOF')
  const outside = join(dirs.base, 'outside.svg')
  writeFileSync(outside, svg)
  if (process.platform !== 'win32') symlinkSync(outside, join(project, 'external.svg'), 'file')
  const session = seedSession(dirs.sessions, 'chat-media', '对话产物', 0, project)
  const rows = [
    { role: 'user', content: [{ type: 'text', text: '生成图片、流程图和视频' }, { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=' }] },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'cover-write', name: 'write', arguments: { path: 'cover-2.svg', content: svg } }] },
    { role: 'toolResult', toolCallId: 'cover-write', toolName: 'write', isError: false, content: [{ type: 'text', text: 'Wrote cover-2.svg' }] },
    { role: 'assistant', content: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=' }, { type: 'text', text: [
      '已完成。',
      '![封面](./cover.svg)',
      '[第二版](./cover-2.svg) · [视频](<./演示 视频.mp4>) · [文档](./report.pdf)',
      `\`\`\`svg\n${svg}\n\`\`\``,
      `\`\`\`xml\n<?xml version="1.0"?>\n${svg}\n\`\`\``,
      '```xml\n<settings><enabled>true</enabled></settings>\n```',
      '```mermaid\nflowchart LR\nA[提交] --> B[审核]\n```',
      '```mermaid\nnot a diagram\n```'
    ].join('\n\n') }] }
  ]
  appendFileSync(session, rows.map((message) => JSON.stringify({ type: 'message', timestamp: Date.now(), message })).join('\n') + '\n')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({
    theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project, lastSessionPath: session
  }))

  const exportDir = join(dirs.base, 'saved-media')
  mkdirSync(exportDir)
  const fixtureVideo = readFileSync(join(project, videoName))
  const mediaServer = createServer((req, response) => {
    if (req.url === '/redirect') { response.writeHead(302, { Location: '/clip.mp4' }); response.end(); return }
    if (req.url === '/blocked') { response.writeHead(302, { Location: 'http://localhost/private' }); response.end(); return }
    response.writeHead(200, { 'Content-Type': 'video/mp4' }); response.end(fixtureVideo)
  })
  await new Promise(resolve => mediaServer.listen(0, '127.0.0.1', resolve))
  const { app, page, errors } = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1', PI_DESKTOP_EXPORT_DIR: exportDir, PI_DESKTOP_TEST_MEDIA_LOCAL: '1' })
  try {
    const turn = page.locator('.turn').filter({ hasText: '生成图片、流程图和视频' })
    const video = turn.getByLabel(videoName, { exact: true })
    const gallery = turn.locator('.turn-image-gallery')
    await video.waitFor()
    await page.waitForFunction(() => document.querySelector('.turn-video video')?.readyState >= 2)
    check('对话中视频加载首帧，有播放器且默认暂停', await video.evaluate((element) => element.controls && element.paused && element.videoWidth === 240))
    await video.evaluate((element) => element.play())
    await page.waitForFunction(() => document.querySelector('.turn-video video')?.currentTime > 0.1)
    await video.evaluate((element) => { element.pause(); element.currentTime = 2.5 })
    await page.waitForFunction(() => {
      const element = document.querySelector('.turn-video video')
      return element?.paused && !element.seeking && Math.abs(element.currentTime - 2.5) < 0.08
    })
    check('真实 MP4 可以播放、暂停和跳转进度', await video.evaluate((element) => element.paused && element.duration >= 3.9))
    await gallery.getByRole('button', { name: 'cover-2.svg', exact: true }).click()
    const svgImage = gallery.locator('.turn-image-open img')
    await page.waitForFunction(() => document.querySelector('.turn-image-open img')?.naturalWidth === 240)
    check('SVG 图集去重并可切换缩略图', await gallery.locator('.turn-image-thumbnails button').count() === 2 &&
      await svgImage.getAttribute('alt') === 'cover-2.svg')
    await app.evaluate(async ({ clipboard }) => { globalThis.__oldClipboard = await clipboard.read() })
    await gallery.getByRole('button', { name: '下载', exact: true }).click()
    await page.getByText('已保存附件', { exact: true }).waitFor()
    check('图片下载保留原始 SVG 文件', readFileSync(join(exportDir, 'cover-2.svg'), 'utf8') === svg.replace('#315878', '#a77049'))
    await gallery.getByRole('button', { name: '复制图片', exact: true }).click()
    await page.getByText('已复制图片', { exact: true }).waitFor()
    check('图片复制写入系统图像剪贴板', await app.evaluate(async ({ clipboard }) => (await clipboard.read()).some(item => item.types.includes('image/png'))))
    const videoCard = turn.locator('.turn-video')
    await videoCard.getByRole('button', { name: '下载', exact: true }).click()
    await page.waitForFunction((path) => window.pi && Boolean(path), videoName)
    await page.waitForTimeout(300)
    check('视频下载保留原始内容', readFileSync(join(exportDir, videoName)).equals(readFileSync(join(project, videoName))))
    await videoCard.getByRole('button', { name: '复制视频文件', exact: true }).click()
    await page.getByText('已复制视频文件', { exact: true }).waitFor()
    check('视频复制写入文件剪贴板格式', await app.evaluate(async ({ clipboard }) => (await clipboard.read()).some(item => item.types.some(type => /public.file-url|FileNameW|text\/uri-list/i.test(type)))))
    const remoteUrl = `http://127.0.0.1:${mediaServer.address().port}/clip.mp4`
    if (!process.env.PI_E2E_APP) {
      const remoteSaved = await page.evaluate(url => window.pi.remoteMedia(url, 'remote.mp4', 'video', 'save'), remoteUrl)
      check('远程视频下载保存原始数据', remoteSaved && readFileSync(join(exportDir, 'remote.mp4')).equals(fixtureVideo))
      const remoteCopied = await page.evaluate(url => window.pi.remoteMedia(url, 'remote.mp4', 'video', 'copy'), remoteUrl)
      check('远程视频复制为文件', remoteCopied && await app.evaluate(async ({ clipboard }) => (await clipboard.read()).some(item => item.types.some(type => /public.file-url|FileNameW|text\/uri-list/i.test(type)))))
      const redirected = await page.evaluate(url => window.pi.remoteMedia(url, 'redirected.mp4', 'video', 'save'), remoteUrl.replace('/clip.mp4', '/redirect'))
      check('远程附件可跟随安全重定向', redirected && readFileSync(join(exportDir, 'redirected.mp4')).equals(fixtureVideo))
    }
    const rejected = await page.evaluate(() => window.pi.remoteMedia('http://localhost/private', 'private.mp4', 'video', 'save').then(() => false, () => true))
    const rejectedRedirect = process.env.PI_E2E_APP ? true : await page.evaluate(url => window.pi.remoteMedia(url, 'private.mp4', 'video', 'save').then(() => false, () => true), remoteUrl.replace('/clip.mp4', '/blocked'))
    check('远程附件及重定向拒绝不安全地址', rejected && rejectedRedirect)
    const fileCard = turn.locator('.turn-file-result', { hasText: 'report.pdf' })
    await fileCard.getByRole('button', { name: '下载', exact: true }).click()
    await page.waitForTimeout(200)
    check('文档附件可下载且内容不变', readFileSync(join(exportDir, 'report.pdf'), 'utf8') === '%PDF-1.4\nfixture\n%%EOF')
    await fileCard.getByRole('button', { name: '复制文件', exact: true }).click()
    await page.getByText('已复制文件', { exact: true }).waitFor()
    check('文档附件可作为文件复制', await app.evaluate(async ({ clipboard }) => (await clipboard.read()).some(item => item.types.some(type => /public.file-url|FileNameW|text\/uri-list/i.test(type)))))
    await svgImage.click()
    check('SVG 可在对话内放大', await page.locator('.lightbox img').isVisible())
    await page.keyboard.press('Escape')
    await turn.locator('.assistant-body > .inline-image').first().click()
    const lightbox = page.locator('.lightbox')
    await lightbox.getByRole('button', { name: '复制图片', exact: true }).click()
    let copiedInlineImage = false
    for (let attempt = 0; attempt < 30 && !copiedInlineImage; attempt++) {
      copiedInlineImage = await app.evaluate(async ({ clipboard }) => (await clipboard.read()).some(item => item.types.includes('image/png')))
      if (!copiedInlineImage) await page.waitForTimeout(100)
    }
    check('对话内嵌图片放大后可复制', copiedInlineImage)
    await lightbox.getByRole('button', { name: '下载', exact: true }).click()
    await page.waitForTimeout(250)
    check('对话内嵌图片放大后可下载', existsSync(join(exportDir, '图片.png')))
    await page.keyboard.press('Escape')
    await turn.locator('.user-images .inline-image').click()
    check('用户发出的图片也能打开复制下载操作', await page.locator('.lightbox').getByRole('button', { name: '下载', exact: true }).isVisible() && await page.locator('.lightbox').getByRole('button', { name: '复制图片', exact: true }).isVisible())
    await page.keyboard.press('Escape')

    await page.waitForFunction(() => document.querySelector('[data-diagram-type="mermaid"] img')?.naturalWidth > 0)
    const renderedDiagram = await turn.locator('[data-diagram-type="mermaid"] img').evaluate(async (element) => {
      const width = element.naturalWidth
      const height = element.naturalHeight
      const image = new OffscreenCanvas(width, height)
      const ctx = image.getContext('2d')
      ctx.drawImage(element, 0, 0)
      const pixels = ctx.getImageData(0, 0, width, height).data
      const colored = pixels.some((value, index) => index % 4 === 3 && value > 0)
      const bounds = element.getBoundingClientRect()
      return { width, height, colored, displayWidth: bounds.width, displayHeight: bounds.height }
    })
    check('Mermaid 渲染为流程图，非法语法保留源码', renderedDiagram.width > 40 && renderedDiagram.height > 28 && renderedDiagram.colored &&
      renderedDiagram.displayWidth > 60 && renderedDiagram.displayHeight > 40 &&
      await turn.locator('.diagram-fallback pre').getByText('not a diagram').isVisible(), JSON.stringify(renderedDiagram))
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-diagram-type="svg"] img')).filter(img => img.naturalWidth === 240).length === 2)
    check('SVG 与 XML 标记的 SVG 均可预览，普通 XML 保留源码', await turn.locator('[data-diagram-type="svg"] img').count() === 2 && await turn.locator('pre').filter({ hasText: 'enabled' }).count() === 1)
    await turn.locator('[data-diagram-type="svg"] img').last().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(dirs.base, 'xml-svg-preview.png') })
    await turn.locator('[data-diagram-type="svg"] img').last().click()
    await page.locator('.lightbox').getByRole('button', { name: '下载', exact: true }).click()
    await page.waitForTimeout(250)
    check('XML 中的 SVG 预览可下载为 SVG 文件', existsSync(join(exportDir, '图片.svg')))
    await page.keyboard.press('Escape')
    const unauthorized = await page.evaluate(async ({ outside, project, session }) => Promise.all([
      window.pi.previewMedia({ path: outside, workspace: project, sessionPath: session }),
      window.pi.previewMedia({ path: 'external.svg', workspace: project, sessionPath: session }),
      window.pi.previewMedia({ path: 'cover.svg', workspace: project, sessionPath: null })
    ]), { outside, project, session })
    check('预览拒绝越过项目目录、外部符号链接和其他会话', unauthorized.every((item) => item === null))
    await video.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(dirs.base, 'inline-media.png') })
    await page.reload()
    await page.waitForFunction(() => document.querySelector('.turn-video video')?.readyState >= 2)
    check('重开历史对话后视频仍能加载', await page.locator('.turn-video video').count() === 1)
    check('对话媒体无 renderer 异常', errors.length === 0, errors.join(' | '))
  } finally {
    await app.evaluate(async ({ clipboard }) => { if (Array.isArray(globalThis.__oldClipboard)) { if (globalThis.__oldClipboard.length) await clipboard.write(globalThis.__oldClipboard); else clipboard.clear() } }).catch(() => {})
    await app.close()
    mediaServer.closeAllConnections()
    await new Promise(resolve => mediaServer.close(resolve))
  }
}

async function caseHistoricalPage() {
  const dirs = freshDirs('historical-page')
  const project = join(dirs.base, 'project')
  mkdirSync(project)
  const localExample = process.env.PI_TEST_HISTORICAL_HTML
  const name = localExample ? 'pelican-film.html' : 'animation.html'
  const path = join(project, name)
  writeFileSync(path, localExample ? readFileSync(localExample) : `<!doctype html><meta charset="utf-8">
    <button id="play">播放</button><button id="navigation">尝试联网</button><output id="state">等待</output>
    <script>
      let isolated = false
      try { void parent.document } catch { isolated = true }
      document.querySelector('#state').dataset.isolated = String(isolated && typeof window.pi === 'undefined')
      document.querySelector('#play').onclick = () => { document.querySelector('#state').textContent = '动画已启动' }
      document.querySelector('#navigation').onclick = () => { location.href = 'https://preview-sentinel.invalid/' }
    </script>`)
  const session = seedSession(dirs.sessions, 'historical-page', '旧会话作品', 0, project)
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '修改动画' }] },
    { role: 'assistant', content: [{ type: 'toolCall', name: 'edit', id: 'history-edit', arguments: { path: name } }] },
    { role: 'toolResult', toolName: 'edit', toolCallId: 'history-edit', content: [{ type: 'text', text: 'Updated file' }] },
    { role: 'assistant', content: [{ type: 'text', text: '动画已修改。' }] }
  ]
  appendFileSync(session, messages.map((message) => JSON.stringify({ type: 'message', timestamp: Date.now(), message })).join('\n') + '\n')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({
    theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project, lastSessionPath: session
  }))
  const { app, page } = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1' })
  try {
    const output = page.getByRole('region', { name, exact: true })
    await output.waitFor()
    check('旧会话的文件变更自动出现预览入口，页面尚未启动', await output.getByRole('button', { name: '打开预览' }).isVisible() && !await output.locator('iframe').count())
    await output.getByRole('button', { name: '打开预览' }).click()
    const frame = output.frameLocator('iframe')
    if (localExample) {
      const clock = frame.locator('#time')
      await clock.waitFor()
      const before = await clock.innerText()
      await page.waitForTimeout(1200)
      check('截图里的原始 HTML 动画可以播放', await frame.locator('svg').count() > 0 && await clock.innerText() !== before)
      await frame.locator('body').press('Space')
      const paused = await clock.innerText()
      await page.waitForTimeout(700)
      check('原始页面的空格键可以暂停动画', await clock.innerText() === paused)
      await output.scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(dirs.base, 'historical-preview.png') })
    } else {
      await frame.getByRole('button', { name: '播放' }).click()
      check('交互脚本能运行，且预览无法读父页面或调用桌面接口', await frame.getByText('动画已启动').isVisible() &&
        await frame.locator('#state').getAttribute('data-isolated') === 'true')
      let externalRequests = 0
      await page.route('https://preview-sentinel.invalid/**', (route) => {
        externalRequests++
        return route.abort()
      })
      await frame.getByRole('button', { name: '尝试联网' }).click()
      await page.waitForTimeout(250)
      check('预览发起外部导航时不会发送请求', externalRequests === 0, `requests=${externalRequests}`)
    }
    await output.getByRole('button', { name: '关闭预览' }).click()
    check('关闭预览后卸载动画', !await output.locator('iframe').count())
  } finally {
    await app.close()
    if (localExample) rmSync(path, { force: true })
  }
}

async function caseProjectDeliverables() {
  const dirs = freshDirs('project-deliverables')
  const project = join(dirs.base, 'website')
  const notes = join(dirs.base, 'notes')
  mkdirSync(project)
  mkdirSync(notes)
  execFileSync('git', ['init', '-q', '-b', 'feature/demo'], { cwd: project })

  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<title>Pi Demo</title><h1>Local preview is running</h1>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/demo`
  const session = seedSession(dirs.sessions, 'project-deliverables', '网页交付记录', 0, project)
  const rows = [
    { role: 'user', content: [{ type: 'text', text: '先记录旧变更' }] },
    { role: 'assistant', content: [
      { type: 'toolCall', id: 'old-file', name: 'edit', arguments: { path: 'prior.txt', oldText: 'old', newText: 'previous' } },
      { type: 'toolCall', id: 'old-demo', name: 'edit', arguments: { path: 'demo.ts', oldText: 'first', newText: 'oldMarker' } }
    ] },
    ...['old-file', 'old-demo'].map((id) => ({ role: 'toolResult', toolCallId: id, toolName: 'edit', isError: false, content: [] })),
    { role: 'assistant', content: [{ type: 'text', text: '旧记录已保存。' }] },
    { role: 'user', content: [{ type: 'text', text: '交付本地网站' }] },
    { role: 'assistant', content: ['demo.ts', 'layout.ts', 'theme.css', 'readme.md'].map((path, index) => ({
      type: 'toolCall', id: `new-${index}`, name: 'edit', arguments: { path, oldText: 'old', newText: 'newMarker' }
    })) },
    ...[0, 1, 2, 3].map((index) => ({ role: 'toolResult', toolCallId: `new-${index}`, toolName: 'edit', isError: false, content: [] })),
    { role: 'assistant', content: [{ type: 'text', text: [
      `[演示网站](${url} "pi:website")`,
      `[第二个交付页][secondary]\n\n[secondary]: ${url}?view=secondary "pi:website"`,
      '[参考文档](https://example.com/reference)'
    ].join('\n\n') }] }
  ]
  appendFileSync(session, rows.map((message) => JSON.stringify({ type: 'message', timestamp: Date.now(), message })).join('\n') + '\n')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({
    theme: 'dark', language: 'zh-CN', workspaces: [project, notes], lastWorkspace: project, lastSessionPath: session
  }))

  let app
  try {
    const launched = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1' })
    app = launched.app
    const { page, errors } = launched
    const bar = page.locator('.composer-project-row')
    await bar.getByText('feature/demo', { exact: true }).waitFor()
    check('旧会话的项目栏显示项目与真实 Git 分支', await bar.getByRole('button', { name: 'website', exact: true }).isVisible())
    const turn = page.locator('.turn', { hasText: '交付本地网站' })
    const card = turn.getByRole('region', { name: '演示网站', exact: true })
    await card.getByRole('button', { name: '在右侧打开' }).waitFor()
    check('网页结果卡只展示明确交付的网页，其余在其他页面，引用链接保留',
      !await turn.getByRole('region', { name: '第二个交付页' }).isVisible() &&
      await turn.getByRole('link', { name: '参考文档' }).isVisible() &&
      await turn.locator('.turn-html').count() === 2)
    await turn.locator('.turn-other-pages summary').click()
    check('其他交付网页可以展开', await turn.getByRole('region', { name: '第二个交付页' }).isVisible())
    await turn.locator('.turn-other-pages summary').click()
    await page.screenshot({ path: join(dirs.base, 'project-deliverables.png') })
    await card.getByRole('button', { name: '在右侧打开' }).click()
    await page.waitForFunction(() => document.querySelector('.browser-address input')?.value.includes('/demo'))
    check('从旧对话卡片在右侧打开真实网页', await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      for (let attempt = 0; attempt < 40; attempt++) {
        const view = window.contentView.children.find((child) => child.webContents?.getTitle() === 'Pi Demo')
        if (view) return await view.webContents.executeJavaScript('document.querySelector("h1")?.textContent') === 'Local preview is running'
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return false
    }))
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })
    await card.getByRole('button', { name: '在右侧打开' }).click()
    await card.getByText('预览未运行', { exact: true }).waitFor({ timeout: 8000 })
    check('本地预览停止时，原卡片显示状态', true)

    const changes = turn.getByRole('region', { name: '本轮文件变更' })
    check('变更卡显示真实统计，默认仅展开三个文件',
      await changes.locator('.turn-changes-row').count() === 3 && await changes.getByText('+4', { exact: true }).isVisible())
    await changes.getByRole('button', { name: '再显示 1 个文件' }).click()
    check('可以在卡片内展开和收起文件', await changes.locator('.turn-changes-row').count() === 4)
    await changes.getByRole('button', { name: '查看变更' }).click()
    const panel = page.locator('.work-panel')
    await panel.getByRole('button', { name: '本轮', exact: true }).waitFor()
    check('右侧仅列出本轮文件', await panel.locator('.work-file:visible').count() === 4 &&
      !await panel.locator('[data-work-file$="prior.txt"]').count())
    await changes.getByRole('button', { name: /demo\.ts/ }).click()
    const diff = panel.locator('[data-work-file$="demo.ts"] .work-file-body')
    await diff.getByText('newMarker').waitFor()
    check('同一文件在旧轮次的编辑不会混入本轮 diff', !await diff.getByText('oldMarker').count())

    await page.locator('.composer-input').fill('项目原草稿')
    await bar.getByRole('button', { name: 'website', exact: true }).click()
    await page.getByRole('menuitem', { name: /^notes/ }).click()
    await bar.getByRole('button', { name: 'notes', exact: true }).waitFor()
    check('切到普通文件夹开启新对话，Git 分支和原消息不随新项目显示',
      !await bar.locator('.composer-branch').count() && !await turn.count())
    await page.getByText('网页交付记录', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value === '项目原草稿')
    check('返回原项目对话保留草稿', true)
    await bar.getByRole('button', { name: 'website', exact: true }).click()
    await page.getByRole('menuitem', { name: /^新建无项目对话/ }).click()
    await bar.getByRole('button', { name: '选择项目' }).waitFor()
    check('有草稿时仍可通过项目菜单另开无项目对话', await bar.getByText('本机', { exact: true }).isVisible() &&
      await page.locator('.composer-input').inputValue() === '')
    await bar.getByRole('button', { name: '选择项目' }).click()
    const search = page.getByPlaceholder('搜索项目')
    await search.fill('notes')
    await search.press('ArrowDown')
    await page.keyboard.press('Enter')
    await bar.getByRole('button', { name: 'notes', exact: true }).waitFor()
    check('在发送前可用键盘关联项目', true)
    check('项目栏和交付卡无 renderer 异常', errors.length === 0, errors.join(' | '))
  } finally {
    if (app) await app.close()
    if (server.listening) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })
  }
}

async function casePolish() {
  const dirs = freshDirs('polish')
  const exportDir = join(dirs.base, 'exports')
  mkdirSync(exportDir, { recursive: true })
  seedSession(dirs.sessions, 'mock-session', 'Mock session', 2)
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs, 'default', {
    MOCK_TRANSCRIPT: '4',
    MOCK_TOOLS: '2',
    MOCK_EDIT: '1',
    PI_DESKTOP_EXPORT_DIR: exportDir
  })

  // expand everything so tool cards and diffs are reachable
  await page.keyboard.press('Meta+Shift+Period')
  await page.waitForTimeout(400)
  await page.locator('.turn').last().locator('.tool-group .tool-head').first().click()
  await page.locator('.turn').last().locator('.tool-card .tool-head').first().click()
  await page.waitForTimeout(300)

  const fileActions = await page.locator('.tool-body .file-action').count()
  check('工具卡提供在 Finder 中显示 / 打开', fileActions >= 2, `count=${fileActions}`)

  // Do not launch the user's default editor during automated checks. Exercise
  // the real IPC handler while replacing only the OS handoff in this test app.
  await app.evaluate(({ shell }) => {
    globalThis.testOriginalOpenPath = shell.openPath
    globalThis.testOpenedPaths = []
    shell.openPath = async (path) => { globalThis.testOpenedPaths.push(path); return path.endsWith('missing.txt') ? 'test failure' : '' }
  })
  try {
    const fixturePath = join(dirs.base, 'test-open.txt')
    const opened = await page.evaluate((path) => window.pi.openPath(path), fixturePath)
    const failed = await page.evaluate((path) => window.pi.openPath(path), join(dirs.base, 'missing.txt'))
    const calls = await app.evaluate(() => globalThis.testOpenedPaths)
    check('打开文件 IPC 正确转交路径并处理失败', opened === true && failed === false && calls[0] === fixturePath && calls.length === 2)
  } finally {
    await app.evaluate(({ shell }) => { shell.openPath = globalThis.testOriginalOpenPath; delete globalThis.testOriginalOpenPath; delete globalThis.testOpenedPaths })
  }

  // notification IPC answers even when focused (false = suppressed).
  // Conversation notifications contain a single status line.
  const notified = await page.evaluate(() =>
    window.pi.notify({
      title: 'Pi',
      body: '对话已完成',
      cwd: '/tmp',
      sessionPath: '/tmp/session.jsonl'
    })
  )
  check('notify IPC 可用（返回布尔）', typeof notified === 'boolean', String(notified))
  const hasNotifyOpen = await page.evaluate(() => typeof window.pi.onNotifyOpen === 'function')
  check('notify 点击可打开会话（onNotifyOpen）', hasNotifyOpen)

  // diff: open the edit card and toggle the stored fragment
  await page.locator('.turn').last().locator('.tool-card:has(.kind-edit) .tool-head').first().click()
  await page.waitForTimeout(300)
  const collapsedLines = await page.locator('.turn').last().locator('.diff-line').count()
  await page.locator('.turn').last().locator('.diff-actions .file-action').first().click()
  await page.waitForTimeout(300)
  const fullLines = await page.locator('.turn').last().locator('.diff-line').count()
  check(
    'diff 可切换片段/上下文',
    collapsedLines > 0 && fullLines > collapsedLines,
    `${collapsedLines} → ${fullLines}`
  )

  // image lightbox via a synthetic data-URL image inside an assistant body
  const lightbox = await page.evaluate(async () => {
    const img = document.createElement('img')
    img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const host = document.querySelector('.assistant-body') ?? document.body
    host.appendChild(img)
    img.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 150))
    const open = Boolean(document.querySelector('.lightbox'))
    document.querySelector('.lightbox')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 150))
    return { open, closed: !document.querySelector('.lightbox') }
  })
  check('图片 lightbox 可打开并关闭', lightbox.open && lightbox.closed, JSON.stringify(lightbox))

  await page.locator('.session-item').first().click()
  await page.waitForTimeout(1200)
  await page.locator('.session-item').first().click({ button: 'right' })
  await page.waitForSelector('.context-menu')
  check('会话右键菜单不显示导出或历史提示分支', await page.locator('.context-menu .menu-item').filter({ hasText: /导出 Markdown|导出 HTML|从历史提示分支/ }).count() === 0)
  await page.keyboard.press('Escape')

  const virtual = await page.evaluate(() => document.querySelectorAll('.turn').length)
  check('轮次数量统计正常', virtual >= 1, `turns=${virtual}`)
  await app.close()
}

async function caseProcessSteps() {
  const dirs = freshDirs('steps')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', lastWorkspace: root, workspaces: [root], turnAggregate: 5 })
  )
  // One assistant message per bash call, exactly like real pi.
  const { app, page } = await launch(dirs, 'default', {
    MOCK_TRANSCRIPT: '1',
    MOCK_TOOLS: '6',
    MOCK_SPLIT_TOOLS: '1'
  })
  await page.keyboard.press('Meta+Shift+Period')
  await page.waitForTimeout(500)

  const collapsed = await page.evaluate(() => {
    const turn = document.querySelectorAll('.turn')[0]
    const groups = [...turn.querySelectorAll('.tool-group')]
    return {
      groups: groups.length,
      cards: turn.querySelectorAll('.tool-card').length,
      titles: groups.map((group) => group.querySelector('.tool-title')?.textContent ?? '')
    }
  })
  check(
    '6 条独立消息里的终端调用合成一行',
    collapsed.groups === 1 && collapsed.cards === 0,
    JSON.stringify(collapsed)
  )
  check(
    '分组标题是「运行了 6 条命令」',
    /运行了\s*6\s*条命令|Ran 6 commands/.test(collapsed.titles[0] ?? ''),
    collapsed.titles.join(' | ')
  )

  await page.locator('.turn').first().locator('.tool-group .tool-head').first().click()
  await page.waitForTimeout(200)
  const opened = await page.evaluate(() => {
    const turn = document.querySelectorAll('.turn')[0]
    return {
      cards: turn.querySelectorAll('.tool-card').length,
      subtitles: [...turn.querySelectorAll('.tool-group .tool-subtitle')].map(
        (node) => node.textContent ?? ''
      )
    }
  })
  check('展开分组后 6 张卡都在', opened.cards === 6, JSON.stringify(opened))
  check(
    '分组摘要带上命令提示',
    /git log|ls src/.test(opened.subtitles[0] ?? ''),
    opened.subtitles[0] ?? ''
  )
  await app.close()
}

async function caseOperationDetails() {
  const dirs = freshDirs('operation-details')
  const project = join(dirs.base, 'project')
  mkdirSync(project)
  writeFileSync(join(project, 'target.ts'), Array.from({ length: 70 }, (_, index) =>
    index === 41 ? 'newActual' : `line ${index + 1}`).join('\n'))
  const fullOutputPath = join(project, 'command-output.log')
  writeFileSync(fullOutputPath, '更早的命令输出\n报错原因\n')
  const patch = '--- target.ts\n+++ target.ts\n@@ -42,1 +42,2 @@\n-oldActual\n+newActual\n+anotherActual\n'
  const session = seedSession(dirs.sessions, 'operation-details', '操作明细', 0, project)
  const tool = (id, name, args) => ({ type: 'toolCall', id, name, arguments: args })
  const assistant = (...content) => ({ role: 'assistant', content })
  const text = (value) => ({ type: 'text', text: value })
  const result = (id, name, output, rest = {}) => ({
    role: 'toolResult', toolCallId: id, toolName: name, content: [text(output)], ...rest
  })
  const rows = [
    { role: 'user', content: [text('核对文件并修改')] },
    assistant(tool('read-one', 'read', { path: 'before.ts' })),
    result('read-one', 'read', 'Old content'),
    assistant(tool('search', 'bash', { command: "rg -n 'review-focus|openFile' src" })),
    result('search', 'bash', '找到相关代码', { structuredContent: { exit_code: 0 } }),
    assistant(tool('failed', 'bash', { command: 'npm run check && echo done' })),
    result('failed', 'bash', '报错原因\nCommand exited with code 7', { isError: true, structuredContent: { exit_code: 7, full_output_path: fullOutputPath } }),
    assistant(text('已经定位问题，继续检查。'),
      tool('files', 'bash', { command: "rg --files -g '*.tsx' src" }),
      tool('read-two', 'read', { path: 'after.ts' })),
    result('files', 'bash', 'src/after.ts'),
    result('read-two', 'read', 'New content'),
    assistant(tool('native', 'edit', { path: 'target.ts', oldText: 'wrongArgument', newText: 'wrongPreview' })),
    result('native', 'edit', 'Edited', { details: { patch, firstChangedLine: 42 } }),
    assistant(tool('legacy', 'edit', {
      path: 'legacy.ts',
      oldText: ['old', ...Array.from({ length: 20 }, (_, index) => `context ${index}`)].join('\n'),
      newText: ['new', ...Array.from({ length: 20 }, (_, index) => `context ${index}`)].join('\n')
    })),
    result('legacy', 'edit', 'Edited'),
    assistant(tool('fail-edit', 'edit', { path: 'failed.ts', oldText: 'old', newText: 'new' })),
    result('fail-edit', 'edit', '找不到匹配文字', { isError: true }),
    assistant(text('已完成修改。'))
  ]
  appendFileSync(session, rows.map((message) => JSON.stringify({ type: 'message', timestamp: Date.now(), message })).join('\n') + '\n')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({
    theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project, lastSessionPath: session
  }))
  const { app, page } = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1' })
  try {
    await page.keyboard.press('Meta+Shift+Period')
    const process = page.locator('.turn-process-details')
    const groups = process.locator('.tool-group')
    await groups.first().waitFor()
    check('进度说明在两个混合分组之间，单次编辑各自保留', await groups.count() === 2 &&
      await process.getByText('已经定位问题，继续检查。').isVisible() &&
      await process.locator('.tool-card .tool-file-link').count() === 3)
    await groups.first().locator('.tool-head').first().click()
    const cards = groups.first().locator('.tool-card')
    check('混合分组按读取、搜索、命令的原顺序展开',
      JSON.stringify(await cards.locator('.tool-subtitle').allTextContents()) ===
      JSON.stringify(['before.ts', '已在 src 中搜索 “review-focus|openFile”', 'npm run check && echo done']))
    await cards.nth(2).locator('.tool-head').click()
    check('复杂命令保留原文和输出，并单列真实退出码', await cards.nth(2).locator('.bash-command').innerText().then((value) => value.includes('npm run check && echo done')) &&
      await cards.nth(2).getByText('报错原因', { exact: true }).isVisible() &&
      await cards.nth(2).locator('.bash-exit-status').innerText() === '退出码 7')
    await groups.nth(1).locator('.tool-head').first().click()
    check('文件查找显示范围和 glob', await groups.nth(1).getByText('在 src 中查找文件 “*.tsx”').isVisible())

    const native = process.locator('.tool-card', { has: page.getByRole('button', { name: 'target.ts', exact: true }) })
    const legacy = process.locator('.tool-card', { has: page.getByRole('button', { name: 'legacy.ts', exact: true }) })
    check('成功的折叠编辑优先显示原生 patch 的实际增删数', await native.locator('.tool-line-stats').innerText() === '+2 −1')
    await native.locator('.tool-head').click()
    check('展开显示实际 diff 和行号，不采用调用参数的片段', await native.locator('.diff-hunk').getByText('@@ -42,1 +42,2 @@').isVisible() &&
      await native.getByText('newActual', { exact: true }).isVisible() &&
      !await native.getByText('wrongPreview', { exact: true }).count())
    await legacy.locator('.tool-head').click()
    await legacy.getByRole('button', { name: '展开片段' }).click()
    check('历史编辑可展开完整片段', await legacy.getByText('context 19', { exact: true }).isVisible())
    const failedEdit = process.locator('.tool-card', { has: page.getByRole('button', { name: 'failed.ts', exact: true }) })
    await failedEdit.locator('.tool-head').click()
    check('失败的编辑展示错误，不计入实际增删', await failedEdit.getByText('找不到匹配文字', { exact: true }).isVisible() &&
      !await failedEdit.locator('.tool-line-stats').count())
    await failedEdit.locator('.tool-head').click()
    await legacy.locator('.tool-head').click()
    await groups.first().evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await page.screenshot({ path: join(dirs.base, 'operation-details.png') })
    await cards.nth(2).getByRole('button', { name: '查看保存的输出' }).click()
    await page.locator('.file-preview-body:visible').getByText('更早的命令输出', { exact: false }).waitFor()
    check('工具保存在磁盘上的原始输出可在右侧查看', true)
    await native.getByRole('button', { name: 'target.ts', exact: true }).click()
    await page.locator('.file-preview-target[data-line="42"]').waitFor()
    check('点击文件名打开右侧文件并定位第一处变更', await page.locator('.file-preview-target').innerText() === 'newActual')
    const summary = page.locator('.turn-changes')
    await summary.getByRole('button', { name: /target\.ts/ }).click()
    check('本轮变更右栏也显示同一原生 diff', await page.locator('.work-panel .diff-hunk').getByText('@@ -42,1 +42,2 @@').isVisible())
  } finally {
    await app.close()
  }
}

async function caseStreamingScroll() {
  const dirs = freshDirs('streaming-scroll')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root }))
  const { app, page } = await launch(dirs, 'default', { MOCK_TRANSCRIPT: '8', MOCK_STREAM_INTERVAL: '100' })
  try {
    const input = page.locator('.composer-input')
    await input.fill('scroll test')
    await input.press('Enter')
    await page.waitForFunction(async () => (await window.pi.command({ type: 'get_state' })).data?.isStreaming === true)
    await page.getByText('mock reply', { exact: false }).first().waitFor()
    await page.waitForTimeout(150)
    const scroll = page.locator('.chat-scroll')
    await scroll.hover({ position: { x: 300, y: 100 } })
    await scroll.evaluate(el => { window.__scrollTrace = []; for (const name of ['wheel','scroll']) el.addEventListener(name, e => window.__scrollTrace.push([name, e.deltaY, el.scrollHeight - el.clientHeight - el.scrollTop])) })
    await page.mouse.wheel(0, -24)
    await page.waitForTimeout(700)
    const distance = await scroll.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)
    check('输出时轻微向上滚动不被自动拉回', distance >= 12, `distance=${distance} trace=${JSON.stringify(await page.evaluate(() => window.__scrollTrace))}`)
    const before = await scroll.evaluate(el => el.scrollTop)
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -30); await page.waitForTimeout(100) }
    const after = await scroll.evaluate(el => el.scrollTop)
    check('连续向上滚动时可继续浏览历史', before - after >= 90, `before=${before} after=${after}`)
    await page.mouse.wheel(0, 10000)
    await page.waitForTimeout(150)
    await scroll.evaluate(el => { const extra = document.createElement('div'); extra.style.height = '160px'; el.querySelector('.chat-inner').appendChild(extra) })
    await page.waitForTimeout(150)
    const bottom = await scroll.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)
    check('返回底部后内容变高仍跟随最新内容', bottom <= 2, `distance=${bottom}`)
  } finally { await app.close() }
}

async function caseVirtualization() {
  const dirs = freshDirs('virtual')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root, turnAggregate: 5 })
  )
  const { app, page } = await launch(dirs, 'default', { MOCK_TRANSCRIPT: '60', MOCK_TOOLS: '0' })
  const state = await page.evaluate(() => ({
    visibleTurns: document.querySelectorAll('.turn').length,
    total: document.querySelector('.chat-inner')?.dataset.totalTurns ?? '',
    virtual: document.querySelector('.chat-inner')?.classList.contains('is-virtual') ?? false,
    older: document.querySelector('.older-turns')?.textContent ?? ''
  }))
  check(
    '长会话启用按需渲染（更早轮次聚合）',
    state.virtual && state.visibleTurns <= 6 && /更早的 55 轮|55 earlier turns/.test(state.older),
    JSON.stringify(state)
  )
  const scrolls = await page.evaluate(() => {
    const scroller = document.querySelector('.chat-scroll')
    scroller.scrollTop = 2000
    return scroller.scrollTop
  })
  check('按需渲染下滚动仍然可用', scrolls > 500, `scrollTop=${scrolls}`)
  await app.close()
}

async function caseTurnsFold() {
  const dirs = freshDirs('turns')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root, turnAggregate: 5, turnAutoFold: true })
  )
  const { app, page, errors } = await launch(dirs, 'default', {
    MOCK_TRANSCRIPT: '8',
    MOCK_TOOLS: '3',
    MOCK_SCENARIO: 'default'
  })

  const before = await page.evaluate(() => ({
    turns: document.querySelectorAll('.turn').length,
    summaries: document.querySelectorAll('.turn-summary').length,
    cards: document.querySelectorAll('.tool-card').length,
    groups: document.querySelectorAll('.tool-group').length,
    older: document.querySelector('.older-turns')?.textContent ?? ''
  }))
  check('每轮都渲染折叠摘要', before.turns === 5 && before.summaries === 5, JSON.stringify(before))
  check('折叠后不再渲染工具卡/分组', before.cards === 0 && before.groups === 0, JSON.stringify(before))
  check('更早的轮次聚合成一行', /更早的 3 轮|3 earlier turns/.test(before.older), before.older)

  // expand one turn -> answer + summary collapse, tool cards appear
  await page.locator('.turn').last().locator('.turn-summary-main').click()
  await page.waitForTimeout(400)
  const expanded = await page.evaluate(() => {
    const turns = document.querySelectorAll('.turn')
    const last = turns[turns.length - 1]
    return {
      cards: last.querySelectorAll('.tool-card').length,
      groups: last.querySelectorAll('.tool-group').length
    }
  })
  check(
    '展开后出现分组（5 个连续 read 合成一组）',
    expanded.groups === 1 || expanded.cards >= 3,
    JSON.stringify(expanded)
  )

  // open the group, then one card, to reach the truncated output
  await page.locator('.turn').last().locator('.tool-group .tool-head').first().click()
  await page.locator('.turn').last().locator('.tool-card .tool-head').first().click()
  await page.waitForTimeout(300)
  const truncation = await page.evaluate(() => {
    const turns = document.querySelectorAll('.turn')
    const last = turns[turns.length - 1]
    const more = last.querySelector('.more-button')
    return {
      lines: last.querySelectorAll('.output-line').length,
      more: more?.textContent ?? ''
    }
  })
  check(
    '工具输出按行截断（默认 24 行 + 还有 N 行）',
    truncation.lines > 0 && truncation.lines <= 24 && /还有|more/.test(truncation.more),
    JSON.stringify(truncation)
  )

  // Toggle a middle turn: its own header must stay put while the detail opens/closes.
  const toggled = page.locator('.turn').nth(2).locator('.turn-summary-main')
  await toggled.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  const topOf = async () => page.evaluate(() => document.querySelectorAll('.turn')[2].getBoundingClientRect().top)
  const beforeToggle = await topOf()
  await toggled.click()
  await page.waitForTimeout(400)
  const afterExpand = await topOf()
  check(
    '展开时被点的轮次不跳动',
    Math.abs(beforeToggle - afterExpand) < 8,
    `${Math.round(beforeToggle)} → ${Math.round(afterExpand)}`
  )
  await toggled.click()
  await page.waitForTimeout(400)
  const afterCollapse = await topOf()
  check(
    '收起时被点的轮次不跳动',
    Math.abs(afterExpand - afterCollapse) < 8,
    `${Math.round(afterExpand)} → ${Math.round(afterCollapse)}`
  )

  // batch shortcuts
  await page.locator('.chat-scroll').click()
  await page.keyboard.press('Meta+Shift+Period')
  await page.waitForTimeout(300)
  const expandedAll = await page.evaluate(
    () => document.querySelectorAll('.tool-card, .tool-group').length
  )
  check('⇧⌘. 全部展开', expandedAll > 0, `cards/groups=${expandedAll}`)
  await page.keyboard.press('Meta+Period')
  await page.waitForTimeout(300)
  const collapsedAll = await page.evaluate(
    () => document.querySelectorAll('.tool-card, .tool-group').length
  )
  check('⌘. 全部收起', collapsedAll === 0, `cards/groups=${collapsedAll}`)

  // transcript overlay
  await page.keyboard.press('Meta+Shift+O')
  await page.waitForSelector('.transcript')
  const transcript = await page.evaluate(() => ({
    items: document.querySelectorAll('.transcript-item').length,
    cards: document.querySelectorAll('.transcript .tool-card').length
  }))
  check('⌘⇧O 打开完整记录（含全部消息）', transcript.items >= 20, JSON.stringify(transcript))

  await page.locator('.transcript-search input').fill('answer 7')
  await page.waitForTimeout(300)
  const matches = await page.locator('.transcript-count').innerText()
  check('完整记录里可以搜索', /[1-9]/.test(matches), matches)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('Esc 关闭完整记录', (await page.locator('.transcript').count()) === 0)

  check('无 JS 异常', errors.length === 0, errors.join(' | '))
  await app.close()
}

async function caseFoldPersistence() {
  const dirs = freshDirs('fold-persist')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root, turnAutoFold: true })
  )
  let { app, page } = await launch(dirs, 'default', { MOCK_TRANSCRIPT: '6', MOCK_TOOLS: '2' })
  await page.locator('.turn').last().locator('.turn-summary-main').click()
  await page.waitForTimeout(500)
  const cardsBefore = await page.evaluate(() => {
    const turns = document.querySelectorAll('.turn')
    const last = turns[turns.length - 1]
    return last.querySelectorAll('.tool-card, .tool-group').length
  })
  check('手动展开生效', cardsBefore > 0, `cards=${cardsBefore}`)
  await page.waitForTimeout(400)
  await app.close()

  ;({ app, page } = await launch(dirs, 'default', { MOCK_TRANSCRIPT: '6', MOCK_TOOLS: '2' }))
  const cardsAfter = await page.evaluate(() => {
    const turns = document.querySelectorAll('.turn')
    const last = turns[turns.length - 1]
    return last.querySelectorAll('.tool-card, .tool-group').length
  })
  check('折叠状态重启后保留', cardsAfter > 0, `cards=${cardsAfter}`)
  await app.close()
}

async function caseDefaultVisibility() {
  const dirs = freshDirs('visible')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root, turnAggregate: 5 })
  )
  const { app, page } = await launch(dirs, 'default', { MOCK_TRANSCRIPT: '3', MOCK_TOOLS: '3' })
  const state = await page.evaluate(() => {
    const turns = document.querySelectorAll('.turn')
    const last = turns[turns.length - 1]
    return {
      rows: last.querySelectorAll('.tool-card, .tool-group').length,
      folded: last.querySelectorAll('.folded-answer').length
    }
  })
  check(
    '默认直接显示过程，不折叠成摘要',
    state.rows > 0 && state.folded === 0,
    JSON.stringify(state)
  )
  await app.close()
}

async function caseTurnTiming() {
  const dirs = freshDirs('turn-timing')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs, 'default', {
    MOCK_TRANSCRIPT: '2',
    MOCK_THINKING_MS: '2400',
    MOCK_STREAM_INTERVAL: '80'
  })
  try {
    const turns = page.locator('.turn')
    const history = await turns.locator('.turn-elapsed').allTextContents()
    check('历史轮次各自显示实际耗时', history.length === 2 && history.every((label) => label === '耗时 6s'), JSON.stringify(history))

    const input = page.locator('.composer-input')
    await input.fill('timer check')
    await input.press('Enter')

    const latest = turns.last()
    const thought = latest.locator('.thinking-head span')
    const elapsed = latest.locator('.turn-elapsed')
    await thought.getByText(/^思考中 [1-2]s$/).waitFor({ state: 'visible' })
    check('思考和本轮耗时按整秒更新', /^执行中 [1-2]s$/.test(await elapsed.textContent()))

    await thought.getByText(/^思考了 2s$/).waitFor({ state: 'visible' })
    await elapsed.getByText(/^执行中 [3-9]s$/).waitFor({ state: 'visible' })
    check('思考完成后，总耗时在回答期间继续计时', await thought.textContent() === '思考了 2s')

    await elapsed.getByText(/^耗时 [5-9]s$/).waitFor({ state: 'visible' })
    const finished = await elapsed.textContent()
    await page.waitForTimeout(1100)
    check('回答完成后耗时固定，历史轮次独立', await elapsed.textContent() === finished &&
      await thought.textContent() === '思考了 2s' &&
      await turns.first().locator('.turn-elapsed').textContent() === '耗时 6s', finished)
  } finally {
    await app.close()
  }
}

async function caseAutoFoldOnAnswer() {
  const dirs = freshDirs('autofold')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root, turnAutoFold: true })
  )
  const { app, page } = await launch(dirs, 'default', { MOCK_TRANSCRIPT: '3', MOCK_TOOLS: '3' })
  const after = await page.evaluate(() => {
    const turns = document.querySelectorAll('.turn')
    const last = turns[turns.length - 1]
    return {
      summaries: last.querySelectorAll('.turn-summary').length,
      rows: last.querySelectorAll('.tool-card, .tool-group').length
    }
  })
  check(
    '开启自动收起后过程折成一行摘要',
    after.summaries === 1 && after.rows === 0,
    JSON.stringify(after)
  )
  await app.close()
}

async function caseSessionPins() {
  const dirs = freshDirs('session-pins')
  const sessionA = seedSession(dirs.sessions, 'pin-a', '置顶测试 A', 2)
  const sessionB = seedSession(dirs.sessions, 'pin-b', '置顶测试 B', 1, '/tmp/pin-loose-project')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [root], lastWorkspace: root, lastSessionPath: sessionA }))
  let { app, page } = await launch(dirs)
  try {
    const projectRow = page.locator('.project-tree-sessions .session-item').filter({ hasText: '置顶测试 A' })
    const recentRow = page.locator('.recent-sessions .session-item').filter({ hasText: '置顶测试 B' })
    await projectRow.waitFor()
    for (const row of [projectRow, recentRow]) {
      await row.getByRole('button', { name: '会话操作' }).click()
      const menu = page.locator('.popover:not(.popover-closing)')
      check('当前和其他对话的菜单都不含三个移除的入口', await menu.locator('.menu-item').filter({ hasText: /导出 Markdown|导出 HTML|从历史提示分支/ }).count() === 0 && await menu.locator('.menu-item').filter({ hasText: '归档对话' }).count() === 1)
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
    }
    await projectRow.hover()
    await projectRow.getByRole('button', { name: '置顶对话' }).click()
    await page.locator('.pinned-sessions .session-item').filter({ hasText: '置顶测试 A' }).waitFor()
    check('项目对话可以置顶且原项目入口保留', await projectRow.count() === 1)
    await recentRow.hover()
    await recentRow.getByRole('button', { name: '置顶对话' }).click()
    await page.locator('.pinned-sessions .session-item').filter({ hasText: '置顶测试 B' }).waitFor()
    const pinOrder = await page.locator('.pinned-sessions .session-title').allTextContents()
    check('无项目对话也可置顶，新置顶排在前面', pinOrder[0] === '置顶测试 B' && pinOrder[1] === '置顶测试 A', JSON.stringify(pinOrder))
    await page.locator('.search-box input').fill('测试 A')
    check('搜索时置顶列表只显示匹配对话', await page.locator('.pinned-sessions .session-item').count() === 1 &&
      await page.locator('.pinned-sessions').getByText('置顶测试 A', { exact: true }).count() === 1)
    await page.locator('.search-box input').fill('')
    await app.close()
    ;({ app, page } = await launch(dirs))
    await page.locator('.pinned-sessions .session-item').filter({ hasText: '置顶测试 B' }).waitFor()
    check('重启后置顶顺序和状态保持', JSON.stringify(await page.locator('.pinned-sessions .session-title').allTextContents()) === JSON.stringify(pinOrder))
    const pinnedB = page.locator('.pinned-sessions .session-item').filter({ hasText: '置顶测试 B' })
    await pinnedB.getByRole('button', { name: '取消置顶' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.pinned-sessions .session-item').length === 1)
    check('取消置顶不会删除原对话', await page.locator('.recent-sessions .session-item').filter({ hasText: '置顶测试 B' }).count() === 1)
    const settings = JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8'))
    check('置顶状态持久化且取消结果正确', settings.pinnedSessionPaths?.length === 1 && settings.pinnedSessionPaths[0] === sessionA && !settings.pinnedSessionPaths.includes(sessionB))
  } finally { await app.close() }
}

async function caseSessionArchive() {
  const dirs = freshDirs('session-archive')
  const sessionA = seedSession(dirs.sessions, 'archive-a', '归档项目 A', 2)
  const sessionB = seedSession(dirs.sessions, 'archive-b', '归档无项目 B', 1, dirs.base)
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [root], lastWorkspace: root, lastSessionPath: sessionA, pinnedSessionPaths: [sessionB] }))
  let { app, page } = await launch(dirs)
  const menuAction = async (row, label) => {
    await row.getByRole('button', { name: '会话操作' }).click()
    await page.locator('.popover:not(.popover-closing) .menu-item').filter({ hasText: label }).click()
  }
  try {
    const recent = page.locator('.recent-sessions .session-item').filter({ hasText: '归档无项目 B' })
    await recent.waitFor()
    await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', { type: 'desktop_running_sessions', paths: [path] }), sessionB)
    await recent.locator('.session-running').waitFor()
    await menuAction(recent, '归档对话')
    check('执行中的对话不能被静默归档', await page.getByText('该对话正在执行或等待确认，请先处理完当前任务。').isVisible() && await recent.count() === 1)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', { type: 'desktop_running_sessions', paths: [] }))
    await recent.locator('.session-running').waitFor({ state: 'detached' })
    await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', { type: 'desktop_background_ui_pending', sessions: [{ path, cwd: '/tmp/archive-loose-project' }] }), sessionB)
    await page.getByText('后台任务等待确认').waitFor()
    await menuAction(recent, '归档对话')
    check('等待确认的对话不能归档', await recent.count() === 1)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', { type: 'desktop_background_ui_pending', sessions: [] }))
    await page.getByText('后台任务等待确认').waitFor({ state: 'detached' })
    await menuAction(recent, '归档对话')
    await recent.waitFor({ state: 'detached' })
    check('归档后退出最近和置顶，但会话文件保留', await page.locator('.recent-sessions .session-item').filter({ hasText: '归档无项目 B' }).count() === 0 && await page.locator('.pinned-sessions .session-item').count() === 0 && existsSync(sessionB))
    check('聊天侧栏没有已归档入口', await page.locator('.archived-sessions').count() === 0)
    await page.locator('.search-box input').fill('归档无项目 B')
    await page.locator('.session-search-hit').filter({ hasText: '归档无项目 B' }).first().waitFor()
    check('侧栏搜索仍可找到并标识已归档对话', await page.locator('.session-search-hit').filter({ hasText: '归档无项目 B' }).first().innerText().then(text => text.includes('已归档')))
    await page.locator('.search-box input').fill('')
    await app.close()
    ;({ app, page } = await launch(dirs))
    check('重启后归档状态仍然保存', await page.locator('.recent-sessions .session-item').filter({ hasText: '归档无项目 B' }).count() === 0)
    await page.keyboard.press('Meta+,')
    await page.locator('.settings-nav').getByRole('button', { name: '已归档', exact: true }).click()
    const archived = page.locator('.settings-archive-row').filter({ hasText: '归档无项目 B' })
    await archived.waitFor()
    check('已归档对话在设置中展示', await archived.isVisible())
    await page.screenshot({ path: join(dirs.base, 'archived-settings.png') })
    await page.getByPlaceholder('搜索已归档对话').fill('no-match')
    check('设置中的归档列表支持搜索', await page.getByText('没有匹配的会话。').isVisible())
    await page.getByPlaceholder('搜索已归档对话').fill('')
    await archived.locator('.settings-archive-open').click()
    await page.locator('.settings-page').waitFor({ state: 'detached' })
    check('从设置中可以打开归档对话', await page.locator('.composer-input').isVisible())
    await app.close()
    ;({ app, page } = await launch(dirs))
    await page.keyboard.press('Meta+,')
    await page.locator('.settings-nav').getByRole('button', { name: '已归档', exact: true }).click()
    await page.locator('.settings-archive-row').filter({ hasText: '归档无项目 B' }).getByRole('button', { name: '取消归档' }).click()
    await page.locator('.settings-archive-row').filter({ hasText: '归档无项目 B' }).waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '返回对话' }).click()
    await page.locator('.recent-sessions .session-item').filter({ hasText: '归档无项目 B' }).waitFor()
    check('取消归档后回到原列表且不会重新置顶', await page.locator('.pinned-sessions .session-item').count() === 0)
    const project = page.locator('.project-tree-sessions .session-item').filter({ hasText: '归档项目 A' })
    await menuAction(project, '归档对话')
    await project.waitFor({ state: 'detached' })
    await page.keyboard.press('Meta+,')
    await page.locator('.settings-nav').getByRole('button', { name: '已归档', exact: true }).click()
    const archivedProject = page.locator('.settings-archive-row').filter({ hasText: '归档项目 A' })
    await archivedProject.waitFor()
    await archivedProject.getByRole('button', { name: '取消归档' }).click()
    await archivedProject.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '返回对话' }).click()
    await page.locator('.project-tree-sessions .session-item').filter({ hasText: '归档项目 A' }).waitFor()
    check('项目会话恢复后回到原项目', existsSync(sessionA))
  } finally { await app.close() }
}

async function caseSidebarLayout() {
  const dirs = freshDirs('sidebar-layout')
  const sessionA = seedSession(dirs.sessions, 'layout-a', '布局会话 A', 2)
  seedSession(dirs.sessions, 'layout-b', '布局会话 B', 1)
  seedSession(dirs.sessions, 'layout-loose', '无项目会话', 1, '/tmp/loose-project')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root, lastSessionPath: sessionA })
  )
  const { app, page } = await launch(dirs)
  await page.waitForSelector('.recent-sessions .session-item')

  const info = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.project-shortcuts-label')].map(
      (node) => node.textContent ?? ''
    )
    const rows = [...document.querySelectorAll('.recent-sessions .session-item')]
    return {
      labels,
      projectIndex: labels.findIndex((label) => /项目|Projects/.test(label)),
      recentIndex: labels.findIndex((label) => /最近对话|Recent/.test(label)),
      dates: document.querySelectorAll('.session-group-label').length,
      projectRows: document.querySelectorAll('.project-tree-sessions .session-item').length,
      projectMetas: document.querySelectorAll('.project-tree-sessions .session-meta').length,
      recent: rows.length,
      recentTitle: rows[0]?.querySelector('.session-title')?.textContent ?? '',
      height: rows[0]?.getBoundingClientRect().height ?? 0,
      meta: rows[0]?.querySelector('.session-meta')?.textContent ?? ''
    }
  })
  check(
    '侧栏分为「项目」和「最近对话」',
    info.projectIndex >= 0 && info.recentIndex > info.projectIndex,
    JSON.stringify(info.labels)
  )
  check('不再有日期分组', info.dates === 0, `dateLabels=${info.dates}`)
  check(
    '有项目的会话只显示在项目下（默认展开）',
    info.projectRows >= 2,
    `projectRows=${info.projectRows}`
  )
  check(
    '项目内会话不显示时间 / 条数',
    info.projectMetas === 0,
    `metas=${info.projectMetas}`
  )
  check(
    '最近对话只显示无项目的会话',
    info.recent === 1 && info.recentTitle === '无项目会话',
    JSON.stringify({ recent: info.recent, title: info.recentTitle })
  )
  check(
    '会话行更紧凑（单行）',
    info.height > 0 && info.height < 40,
    `height=${Math.round(info.height)}`
  )
  check(
    '最近对话只显示时间、不显示条数',
    /刚刚|分钟|小时|天|now|ago/.test(info.meta) && !/条|messages/.test(info.meta),
    info.meta
  )

  await page.locator('.project-row-main').first().click()
  await page.waitForTimeout(250)
  const collapsed = await page.evaluate(() => ({
    projectRows: document.querySelectorAll('.project-tree-sessions .session-item').length,
    recent: document.querySelectorAll('.recent-sessions .session-item').length,
    chevrons: document.querySelectorAll('.project-tree-toggle').length
  }))
  check(
    '点击项目行收起，无需箭头图标',
    collapsed.projectRows === 0 && collapsed.recent === 1 && collapsed.chevrons === 0,
    JSON.stringify(collapsed)
  )
  await page.locator('.project-row-main').first().click()
  await page.waitForTimeout(200)
  const expanded = await page.evaluate(
    () => document.querySelectorAll('.project-tree-sessions .session-item').length
  )
  check('项目下会话不按时间分组', expanded >= 2, `rows=${expanded}`)

  const sessionMain = page.locator('.project-tree-sessions .session-item .session-main').first()
  const sessionTitle = await sessionMain.locator('.session-title').innerText()
  await sessionMain.dblclick()
  await page.waitForSelector('.rename-input')
  const renameValue = await page.locator('.rename-input').inputValue()
  check('双击会话进入重命名', renameValue === sessionTitle, `${renameValue} / ${sessionTitle}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)

  const projectName = await page.locator('.project-row-main').first().innerText()
  await page.locator('.project-row-main').first().dblclick()
  await page.waitForTimeout(200)
  const projectAfter = await page.locator('.project-row-main').first().innerText()
  check(
    '双击项目文件夹不会重命名',
    (await page.locator('.rename-input').count()) === 0 && projectAfter === projectName,
    `${projectName} → ${projectAfter}`
  )

  const projectRow = page.locator('.project-tree').first()
  await projectRow.hover()
  await page.waitForTimeout(200)
  const newChat = projectRow.locator('.project-new-chat')
  const newChatVisible = await newChat.evaluate((el) => Number(getComputedStyle(el).opacity) > 0.5)
  check(
    '项目悬停出现「新建对话」',
    (await newChat.count()) === 1 && newChatVisible,
    `visible=${newChatVisible}`
  )
  await newChat.click()
  await page.waitForTimeout(400)
  const activeProject = await page.locator('.project-row.active .project-row-main').innerText()
  check('点击后在项目里新建对话', activeProject === 'pi-desktop', activeProject)

  await page.locator('.composer-input').fill('running check')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  const live = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.session-item')].find((item) =>
      item.querySelector('.session-running')
    )
    return {
      spinner: Boolean(row),
      title: row?.querySelector('.session-title')?.textContent ?? ''
    }
  })
  check('执行中的会话左侧显示 loading', live.spinner, JSON.stringify(live))
  await app.close()
}

async function caseBackgroundSessionStatus() {
  const dirs = freshDirs('background-session-status')
  const sessionA = seedSession(dirs.sessions, 'background-a', '后台任务')
  seedSession(dirs.sessions, 'background-b', '另一个对话')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({
    theme: 'dark', workspaces: [root], lastWorkspace: root, lastSessionPath: sessionA
  }))
  const { app, page } = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1', MOCK_STREAM_INTERVAL: '100' })
  try {
    const notificationsAvailable = await app.evaluate(({ Notification }) => {
      if (!Notification.isSupported()) return false
      globalThis.testNotifications = []
      Notification.prototype.show = function () { globalThis.testNotifications.push(this) }
      return true
    })
    const taskRow = page.locator('.session-item').filter({ hasText: '后台任务' })
    const otherRow = page.locator('.session-item').filter({ hasText: '另一个对话' })
    const running = taskRow.locator('.session-running')
    await taskRow.and(page.locator('.active')).waitFor()
    await page.getByText(/后台任务 answer 0/).waitFor()
    await page.locator('.composer-input').fill('background sidebar status')
    await page.keyboard.press('Enter')
    await page.getByText(/mock reply.*background sidebar status/).waitFor()
    await running.waitFor()

    await otherRow.locator('.session-main').click()
    await page.getByText(/另一个对话 answer 0/).waitFor()
    check('切换到其他对话后，原对话仍显示执行中', await running.isVisible() && await otherRow.locator('.session-running').count() === 0)
    if (notificationsAvailable) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())

    await running.waitFor({ state: 'hidden' })
    check('后台任务完成时，侧栏清除执行中状态', await otherRow.and(page.locator('.active')).isVisible())
    if (notificationsAvailable) {
      const notice = await app.evaluate(() => {
        const [notification] = globalThis.testNotifications
        return notification && { title: notification.title, body: notification.body }
      })
      check('后台完成通知只显示一行状态', notice?.title === 'Pi' && notice.body === '对话已完成')
      await app.evaluate(({ BrowserWindow }) => {
        const [notification] = globalThis.testNotifications
        if (notification) notification.emit('click')
        else BrowserWindow.getAllWindows()[0].show()
      })
    }
    if (!notificationsAvailable || !(await app.evaluate(() => globalThis.testNotifications?.length))) {
      await taskRow.locator('.session-main').click()
    }
    await page.getByText(/mock reply.*background sidebar status/).waitFor()
    check('切回原对话后可看到后台完成的回复', await taskRow.and(page.locator('.active')).isVisible())
    if (notificationsAvailable) {
      await page.locator('.composer-input').fill('finish in active window')
      await page.keyboard.press('Enter')
      await running.waitFor()
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
      await running.waitFor({ state: 'hidden' })
      const copy = await app.evaluate(async () => {
        for (let attempt = 0; attempt < 30; attempt++) {
          const notification = globalThis.testNotifications[1]
          if (notification) return notification.body
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        return null
      })
      check('当前对话在窗口后台完成也只显示一行状态', copy === '对话已完成')
    }
  } finally {
    await app.close()
  }
}

async function waitForScheduleRun(page, id, timeout = 20_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const detail = await page.evaluate((taskId) => window.pi.getSchedule(taskId), id)
    if (detail?.runs.some((run) => run.status === 'success')) return detail
    await page.waitForTimeout(250)
  }
  throw new Error(`scheduled run did not finish: ${id}`)
}

async function caseProjectRemoval() {
  const dirs = freshDirs('project-removal')
  const project = join(dirs.base, 'project')
  const other = join(dirs.base, 'other-project')
  mkdirSync(project, { recursive: true }); mkdirSync(other, { recursive: true })
  const file = join(project, 'keep.txt'); writeFileSync(file, 'important project file')
  const session = seedSession(dirs.sessions, 'removal', '项目当前对话', 2, project)
  const archived = seedSession(dirs.sessions, 'removal-archived', '项目归档对话', 1, project)
  const otherSession = seedSession(dirs.sessions, 'removal-other', '其他项目对话', 1, other)
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [project, other], lastWorkspace: project, lastSessionPath: session, pinnedSessionPaths: [session], archivedSessionPaths: [archived] }))
  let { app, page } = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1' })
  try {
    const projectRow = page.locator('.project-row').filter({ hasText: 'project' }).filter({ hasNotText: 'other-project' })
    await projectRow.waitFor()
    await projectRow.hover(); await projectRow.locator('.project-remove').click()
    await page.getByRole('menuitem', { name: '删除项目', exact: true }).click()
    check('删除项目明确说明对话进入回收站且保留文件', await page.getByText(/所有对话.*已归档对话.*回收站/).isVisible())
    await page.getByRole('button', { name: '删除项目', exact: true }).click()
    await projectRow.waitFor({ state: 'detached' })
    await page.waitForFunction(() => ![...document.querySelectorAll('.session-title')].some(node => node.textContent?.includes('项目当前对话')))
    check('项目的普通和已归档对话均已移出历史，其他项目保留', !existsSync(session) && !existsSync(archived) && existsSync(otherSession))
    check('项目目录和文件保留', existsSync(file) && readFileSync(file, 'utf8') === 'important project file')
    const settings = JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8'))
    check('项目与置顶、归档索引同步清理', !settings.workspaces.includes(project) && !settings.pinnedSessionPaths.includes(session) && !settings.archivedSessionPaths.includes(archived) && settings.workspaces.includes(other))
    const trash = readdirSync(join(dirs.sessions, '.trash'))
    check('项目对话完整移至回收站', trash.some(name => name.includes('removal.jsonl')) && trash.some(name => name.includes('removal-archived.jsonl')))
    await app.close(); ({ app, page } = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1' }))
    check('重启后项目和对话不会重新出现', await page.locator('.project-row').filter({ hasText: 'project' }).filter({ hasNotText: 'other-project' }).count() === 0 && await page.getByText('项目当前对话', { exact: true }).count() === 0)
    check('其他项目仍在', await page.locator('.project-row').filter({ hasText: 'other-project' }).count() === 1)
  } finally { await app.close() }
}

async function caseProjectRemovalBusy() {
  const dirs = freshDirs('project-removal-busy')
  const project = join(dirs.base, 'project'); mkdirSync(project, { recursive: true })
  const session = seedSession(dirs.sessions, 'busy-removal', '执行中的项目对话', 1, project)
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project, lastSessionPath: session }))
  const { app, page } = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1', MOCK_STREAM_INTERVAL: '300' })
  try {
    await page.locator('.composer-input').fill('running project removal')
    await page.keyboard.press('Enter')
    await page.locator('.session-running').first().waitFor()
    await page.locator('.project-row').first().hover(); await page.locator('.project-remove').first().click()
    await page.getByRole('menuitem', { name: '删除项目', exact: true }).click()
    check('项目运行中删除按钮不可操作且说明原因', await page.getByRole('button', { name: '删除项目', exact: true }).isDisabled() && await page.getByText('该项目有对话正在执行或等待确认，请先处理完当前任务。').isVisible())
    const result = await page.evaluate(async path => { try { await window.pi.removeProject(path); return 'unexpected success' } catch (error) { return String(error) } }, project)
    check('主进程拒绝删除运行中的项目', result.includes('正在执行或等待确认') && existsSync(session))
  } finally { await app.close() }
}

async function caseProjectRemovalRollback() {
  const dirs = freshDirs('project-removal-rollback')
  const project = join(dirs.base, 'project'); mkdirSync(project, { recursive: true })
  const first = seedSession(dirs.sessions, 'rollback-first', '可移动对话', 2, project)
  const second = seedSession(dirs.sessions, 'rollback-second', '只读目录对话', 1, project)
  const lockedDir = join(dirs.sessions, '--locked--'); mkdirSync(lockedDir, { recursive: true })
  const locked = join(lockedDir, 'locked.jsonl'); renameSync(second, locked)
  const newer = new Date(Date.now() + 10_000); utimesSync(first, newer, newer)
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project, lastSessionPath: first }))
  const { app, page } = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1' })
  try {
    await page.locator('.new-session').click()
    await page.waitForTimeout(400)
    chmodSync(lockedDir, 0o500)
    const result = await page.evaluate(async path => { try { await window.pi.removeProject(path); return 'unexpected success' } catch (error) { return String(error) } }, project)
    const settings = JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8'))
    check('部分对话无法移动时回滚且保留项目', /EACCES|EPERM|permission denied/i.test(result) && existsSync(first) && existsSync(locked) && settings.workspaces.includes(project) && readdirSync(join(dirs.sessions, '.trash')).length === 0, result)
  } finally { chmodSync(lockedDir, 0o700); await app.close() }
}

async function caseSchedules() {
  const dirs = freshDirs('schedules')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [dirs.base], lastWorkspace: dirs.base })
  )
  const { app, page } = await launch(dirs, 'default', { MOCK_SCHEDULE_DELAY: '200' })

  const task = await page.evaluate(
    (projectPath) =>
      window.pi.createSchedule({
        name: 'E2E 定时任务',
        prompt: 'say scheduled hello',
        projectPath,
        cadence: { type: 'daily', time: '09:00' },
        catchUp: true,
        notifications: false
      }),
    dirs.base
  )
  await page.evaluate((id) => window.pi.runScheduleNow(id), task.id)

  const detail = await waitForScheduleRun(page, task.id)
  const run = detail?.runs.find((item) => item.status === 'success')
  check('定时任务到点执行并成功', Boolean(run), JSON.stringify(detail?.task.lastStatus))
  check('运行生成独立会话文件', Boolean(run?.sessionPath?.endsWith('.jsonl')), run?.sessionPath ?? '')
  check('运行有日志文件', Boolean(run?.logPath && existsSync(run.logPath)), run?.logPath ?? '')

  await page.locator('.schedules-entry').click()
  await page.waitForSelector('.schedule-row')
  const listed = await page.locator('.schedule-row').first().innerText()
  check('侧栏入口打开定时任务列表', /E2E 定时任务/.test(listed), listed)

  await page.locator('.schedule-row').first().click()
  await page.waitForSelector('.schedule-detail')
  const history = await page.locator('.schedule-runs').innerText()
  check('详情页显示运行历史', /成功/.test(history), history)

  await page.locator('.skills-head .skills-back').click()
  await page.waitForSelector('.schedule-row')
  await page.getByRole('button', { name: '新建任务' }).first().click()
  await page.waitForSelector('.modal')
  const modal = page.locator('.modal')
  const description = modal.locator('.schedule-textarea')
  check('新建弹窗只有自然语言入口和识别按钮',
    await description.isVisible() && !await modal.locator('input[type=time], input[type=datetime-local]').count() &&
    await modal.getByRole('button', { name: '识别计划', exact: true }).isVisible())
  check('补跑放在更多选项中', !await modal.getByRole('switch', { name: '错过时间后补跑' }).count())
  await modal.getByRole('button', { name: '更多选项' }).click()
  check('更多选项保留运行方式、通知和补跑',
    await modal.locator('.schedule-advanced select').count() === 1 &&
    await modal.getByRole('switch', { name: '完成通知' }).getAttribute('aria-checked') === 'true' &&
    await modal.getByRole('switch', { name: '错过时间后补跑' }).getAttribute('aria-checked') === 'false')
  await modal.getByRole('button', { name: '更多选项' }).click()
  await description.fill('明天提醒我汇总订单')
  await modal.getByRole('button', { name: '识别计划' }).click()
  await modal.getByText('明天几点提醒你？').waitFor()
  check('时间缺失会追问，且未创建任务', (await page.evaluate(() => window.pi.listSchedules())).length === 1)
  await modal.getByPlaceholder('补充一句即可').fill('上午 9 点')
  await modal.getByRole('button', { name: '继续识别' }).click()
  await modal.getByRole('button', { name: '创建任务' }).waitFor()
  check('回答后给出一次性计划与下一次时间', await modal.locator('.schedule-preview time').count() === 1)
  await description.fill('昨天九点提醒我')
  await modal.getByRole('button', { name: '识别计划' }).click()
  await modal.getByRole('alert').getByText('这个时间已经过去了，请换一个时间。').waitFor()
  check('修改输入会清除旧预览，已经过去的计划无法创建', !await modal.getByRole('button', { name: '创建任务' }).count())
  const backgroundStatus = await page.evaluate(() => window.pi.getBackgroundScheduler())
  check('系统级调度状态可读取', typeof backgroundStatus?.supported === 'boolean', JSON.stringify(backgroundStatus))
  check('macOS 才安装系统级调度', process.platform === 'darwin' ? backgroundStatus.supported === true : backgroundStatus.supported === false, JSON.stringify(backgroundStatus))

  await description.fill('每个工作日上午 9 点完成 E2E 界面任务')
  await modal.getByRole('button', { name: '识别计划' }).click()
  const create = modal.getByRole('button', { name: '创建任务' })
  await create.waitFor()
  check('工作日计划显示三次运行时间和采用的时区',
    await modal.getByText('周一至周五 09:00', { exact: true }).isVisible() &&
    await modal.locator('.schedule-plan small').isVisible() &&
    await modal.locator('.schedule-preview time').count() === 3)
  check('预览仍未创建任务', (await page.evaluate(() => window.pi.listSchedules())).length === 1)
  await modal.screenshot({ path: join(dirs.base, 'natural-language-schedule.png') })
  await create.click()
  await page.waitForSelector('.modal', { state: 'detached' })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.schedule-row')].some((row) =>
      row.textContent?.includes('E2E 界面任务')
    )
  )
  const created = await page.evaluate(() => window.pi.listSchedules())
  const uiTask = created.find((item) => item.name === 'E2E 界面任务')
  check(
    '名称自动生成、目录与工具走默认值',
    Boolean(uiTask) && uiTask.projectPath.length > 0 && uiTask.tools === undefined &&
      uiTask.cadence.type === 'weekdays' && uiTask.cadence.time === '09:00' && uiTask.prompt === 'E2E 界面任务',
    JSON.stringify({ name: uiTask?.name, project: uiTask?.projectPath, tools: uiTask?.tools })
  )

  const uiRow = page.locator('.schedule-row', { hasText: 'E2E 界面任务' })
  await uiRow.locator('.switch').click()
  let paused = false
  for (let index = 0; index < 20 && !paused; index += 1) {
    const list = await page.evaluate(() => window.pi.listSchedules())
    paused = list.find((item) => item.name === 'E2E 界面任务')?.enabled === false
    if (!paused) await page.waitForTimeout(100)
  }
  check('列表开关可以暂停任务', paused, String(paused))
  await uiRow.locator('.switch').click()
  let resumed = false
  for (let index = 0; index < 20 && !resumed; index += 1) {
    const list = await page.evaluate(() => window.pi.listSchedules())
    resumed = list.find((item) => item.name === 'E2E 界面任务')?.enabled === true
    if (!resumed) await page.waitForTimeout(100)
  }
  check('列表开关可以恢复任务', resumed, String(resumed))

  await uiRow.click()
  await page.locator('.schedule-detail').getByRole('button', { name: '编辑', exact: true }).click()
  await description.fill('改成每周五下午 6 点')
  await modal.getByRole('button', { name: '识别计划' }).click()
  await modal.getByText('周五 18:00', { exact: true }).waitFor()
  await modal.getByRole('button', { name: '保存', exact: true }).click()
  await modal.waitFor({ state: 'detached' })
  const edited = await page.evaluate((id) => window.pi.getSchedule(id), uiTask.id)
  check('自然语言修改已有任务的时间，保留原任务内容和 ID',
    edited.task.prompt === uiTask.prompt && edited.task.cadence.type === 'weekly' &&
    edited.task.cadence.weekday === 5 && edited.task.cadence.time === '18:00')
  const blockedExpiredSave = await page.evaluate((projectPath) => window.pi.createSchedule({
    name: '过期草稿', prompt: 'hello', projectPath, cadence: { type: 'once', at: Date.now() - 1000 }
  }, true).then(() => false, (error) => String(error).includes('SCHEDULE_TIME_EXPIRED')), dirs.base)
  check('确认时已过期的草稿不会被保存或立即执行', blockedExpiredSave &&
    !(await page.evaluate(() => window.pi.listSchedules())).some((item) => item.name === '过期草稿'))
  await page.keyboard.press('Escape')

  await app.close()
}

async function caseScheduleRecovery() {
  const dirs = freshDirs('schedule-recovery')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [dirs.base], lastWorkspace: dirs.base })
  )
  const first = await launch(dirs, 'default', { MOCK_SCHEDULE_DELAY: '100' })
  const task = await first.page.evaluate(
    (projectPath) =>
      window.pi.createSchedule({
        name: 'E2E 恢复任务',
        prompt: 'recover me',
        projectPath,
        cadence: { type: 'daily', time: '09:00' },
        catchUp: true,
        notifications: false
      }),
    dirs.base
  )
  await first.app.close()

  const file = join(dirs.userData, 'schedules', 'tasks.json')
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const stored = data.tasks.find((item) => item.id === task.id)
  stored.nextRunAt = Date.now() - 5 * 60_000
  writeFileSync(file, JSON.stringify(data, null, 2))

  const { app, page } = await launch(dirs, 'default', { MOCK_SCHEDULE_DELAY: '100' })
  const detail = await waitForScheduleRun(page, task.id)
  const successes = detail?.runs.filter((item) => item.status === 'success') ?? []
  const catchUps = detail?.runs.filter((item) => item.trigger === 'catch-up') ?? []
  check('重启后补跑一次', successes.length === 1 && catchUps.length === 1, JSON.stringify(detail?.runs))
  check('补跑推进下一次运行', typeof detail?.task.nextRunAt === 'number' && detail.task.nextRunAt > Date.now(), String(detail?.task.nextRunAt))
  await app.close()
}

async function caseScheduleInterrupted() {
  const dirs = freshDirs('schedule-interrupted')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [dirs.base], lastWorkspace: dirs.base })
  )
  const first = await launch(dirs, 'default', { MOCK_SCHEDULE_DELAY: '8000' })
  const task = await first.page.evaluate(
    (projectPath) =>
      window.pi.createSchedule({
        name: 'E2E 中断任务',
        prompt: 'interrupt me',
        projectPath,
        cadence: { type: 'daily', time: '09:00' },
        catchUp: true,
        notifications: false
      }),
    dirs.base
  )
  await first.page.evaluate((id) => { void window.pi.runScheduleNow(id) }, task.id)

  const started = Date.now()
  while (Date.now() - started < 15_000) {
    const detail = await first.page.evaluate((id) => window.pi.getSchedule(id), task.id)
    if (detail?.runs.some((run) => run.status === 'running')) break
    await first.page.waitForTimeout(200)
  }
  await first.app.close()

  const { app, page } = await launch(dirs, 'default', { MOCK_SCHEDULE_DELAY: '100' })
  await page.waitForTimeout(2200)
  const detail = await page.evaluate((id) => window.pi.getSchedule(id), task.id)
  const interrupted = detail?.runs.filter((run) => run.status === 'interrupted') ?? []
  const success = detail?.runs.filter((run) => run.status === 'success') ?? []
  check(
    '运行中退出后暂停并等待核对，不自动补跑',
    interrupted.length === 1 && success.length === 0 && detail?.task.enabled === false,
    JSON.stringify({ runs: detail?.runs.map((run) => run.status), enabled: detail?.task.enabled })
  )
  await app.close()
}

async function caseSessionSecurity() {
  const dirs = freshDirs('session-security')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', toolApprovalMode: 'dangerous', workspaces: [dirs.base], lastWorkspace: dirs.base }))
  const { app, page } = await launch(dirs)
  try {
    const first = await page.evaluate((cwd) => window.pi.openSession({ cwd }), dirs.base)
    const firstMode = await page.evaluate((path) => window.pi.sessionSecurity(path), first.sessionPath)
    await page.evaluate(() => window.pi.updateSettings({ toolApprovalMode: 'all' }))
    const stillFirst = await page.evaluate((path) => window.pi.sessionSecurity(path), first.sessionPath)
    const second = await page.evaluate((cwd) => window.pi.openSession({ cwd }), dirs.base)
    const secondMode = await page.evaluate((path) => window.pi.sessionSecurity(path), second.sessionPath)
    const stale = await page.evaluate((path) => window.pi.sessionSecurity(path), first.sessionPath)
    check('当前会话使用启动时的审批方式，新会话采用新默认值', firstMode?.mode === 'dangerous' && stillFirst?.mode === 'dangerous' && secondMode?.mode === 'all' && stale === null, JSON.stringify({ firstMode, stillFirst, secondMode, stale }))
  } finally { await app.close() }
}

async function caseScheduleMissingProject() {
  const dirs = freshDirs('schedule-missing-project')
  const project = join(dirs.base, 'project')
  mkdirSync(project, { recursive: true })
  const { app, page } = await launch(dirs, 'default', { MOCK_SCHEDULE_DELAY: '30' })
  const task = await page.evaluate((projectPath) => window.pi.createSchedule({
    name: 'Missing project', prompt: 'must not run', projectPath,
    cadence: { type: 'daily', time: '09:00' }, notifications: false
  }), project)
  rmSync(project, { recursive: true })
  const run = await page.evaluate((id) => window.pi.runScheduleNow(id), task.id)
  const detail = await page.evaluate((id) => window.pi.getSchedule(id), task.id)
  check('项目目录不存在时暂停且不执行', run?.status === 'failed' && /项目/.test(run?.error || '') && detail?.task.enabled === false, JSON.stringify({ run, task: detail?.task }))
  await app.close()
}

async function caseScheduleSandbox() {
  const dirs = freshDirs('schedule-sandbox')
  const project = join(dirs.base, 'project')
  const outside = join(dirs.base, 'outside.txt')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', sandboxEnabled: true, sandboxNetwork: 'off', workspaces: [project], lastWorkspace: project }))
  const { app, page } = await launch(dirs, 'default', { MOCK_SCHEDULE_PROBE_OUTSIDE: outside })
  try {
    const task = await page.evaluate((projectPath) => window.pi.createSchedule({ name: 'sandbox', prompt: 'test', projectPath, cadence: { type: 'daily', time: '09:00' }, notifications: false }), project)
    const sandbox = await page.evaluate(() => window.pi.sandboxStatus())
    const run = await page.evaluate((id) => window.pi.runScheduleNow(id), task.id)
    if (!sandbox.available) {
      check('没有 sandbox runtime 时定时任务不会在沙箱外运行', run?.status === 'failed' && /沙箱/.test(run?.error || '') && !existsSync(outside), JSON.stringify({ status: run?.status, error: run?.error }))
      return
    }
    check('启用沙箱的定时任务阻止项目外写入', run?.status === 'success' && !existsSync(outside) && (run.summary || '').includes('outside-write-denied'), JSON.stringify({status:run?.status, error:run?.error, summary:run?.summary}))
  } finally { await app.close() }
}

async function caseScheduleHeadlessTick() {
  const dirs = freshDirs('schedule-headless')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [dirs.base], lastWorkspace: dirs.base })
  )
  const first = await launch(dirs, 'default', { MOCK_SCHEDULE_DELAY: '100' })
  const task = await first.page.evaluate(
    (projectPath) =>
      window.pi.createSchedule({
        name: 'E2E 系统级任务',
        prompt: 'run without the app',
        projectPath,
        cadence: { type: 'daily', time: '09:00' },
        catchUp: true,
        notifications: false
      }),
    dirs.base
  )
  await first.app.close()

  const file = join(dirs.userData, 'schedules', 'tasks.json')
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const stored = data.tasks.find((item) => item.id === task.id)
  stored.nextRunAt = Date.now() - 60_000
  writeFileSync(file, JSON.stringify(data, null, 2))

  const headless = await electron.launch({
    args: ['.', '--scheduler-run-due', `--user-data-dir=${dirs.userData}`],
    cwd: root,
    env: {
      ...process.env,
      PI_DESKTOP_PI_PATH: mockPi,
      PI_CODING_AGENT_DIR: dirs.agent,
      PI_CODING_AGENT_SESSION_DIR: dirs.sessions,
      MOCK_SCHEDULE_DELAY: '100'
    }
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('headless tick did not exit')), 25_000)
    headless.on('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })

  const runs = JSON.parse(readFileSync(join(dirs.userData, 'schedules', 'runs', `${task.id}.json`), 'utf8'))
  check(
    '无窗口 tick 也能执行到期任务',
    runs.some((run) => run.status === 'success' && run.trigger === 'catch-up'),
    JSON.stringify(runs.map((run) => `${run.trigger}:${run.status}`))
  )
}

async function caseScheduleAdvanced() {
  const dirs = freshDirs('schedule-advanced')
  const argsFile = join(dirs.base, 'last-args.json')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [dirs.base], lastWorkspace: dirs.base })
  )
  const { app, page } = await launch(dirs, 'default', {
    MOCK_SCHEDULE_DELAY: '100',
    MOCK_ARGS_FILE: argsFile
  })

  const task = await page.evaluate(
    (projectPath) =>
      window.pi.createSchedule({
        name: 'E2E 高级任务',
        prompt: 'continue this thread',
        projectPath,
        cadence: { type: 'cron', expression: '0 9 * * *' },
        timezone: 'Asia/Shanghai',
        runMode: 'continue-session',
        tools: ['read'],
        catchUp: true,
        notifications: false
      }),
    dirs.base
  )

  const localTime = await page.evaluate(
    (timestamp) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).format(new Date(timestamp)),
    task.nextRunAt
  )
  check('cron + 时区计算下一次运行', localTime === '09:00', localTime)

  const first = await page.evaluate((id) => window.pi.runScheduleNow(id), task.id)
  await page.waitForTimeout(300)
  const second = await page.evaluate((id) => window.pi.runScheduleNow(id), task.id)
  check('继续同一会话复用 sessionPath', Boolean(first?.sessionPath) && first?.sessionPath === second?.sessionPath, `${first?.sessionPath} / ${second?.sessionPath}`)
  const sessionLines = readFileSync(first.sessionPath, 'utf8').trim().split('\n').length
  check('继续会话追加消息', sessionLines >= 6, String(sessionLines))

  const argv = JSON.parse(readFileSync(argsFile, 'utf8'))
  check('工具白名单传给 pi', argv.includes('--tools') && argv.includes('read'), argv.join(' '))
  check('继续会话使用 --session', argv.includes('--session'), argv.join(' '))
  await app.close()
}

async function caseScheduleFailures() {
  const dirs = freshDirs('schedule-failures')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [dirs.base], lastWorkspace: dirs.base })
  )
  const { app, page } = await launch(dirs, 'default', {
    MOCK_SCHEDULE_DELAY: '50',
    MOCK_SCHEDULE_FAIL: '1'
  })
  const task = await page.evaluate(
    (projectPath) =>
      window.pi.createSchedule({
        name: 'E2E 失败任务',
        prompt: 'fail',
        projectPath,
        cadence: { type: 'daily', time: '09:00' },
        catchUp: true,
        notifications: false
      }),
    dirs.base
  )
  for (let index = 0; index < 3; index += 1) {
    await page.evaluate((id) => window.pi.runScheduleNow(id), task.id)
  }
  const detail = await page.evaluate((id) => window.pi.getSchedule(id), task.id)
  check(
    '连续 3 次失败后自动暂停',
    detail?.task.enabled === false && detail?.task.consecutiveFailures >= 3,
    JSON.stringify({ enabled: detail?.task.enabled, failures: detail?.task.consecutiveFailures })
  )
  await app.close()
}

async function caseScheduleEvent() {
  const dirs = freshDirs('schedule-event')
  const watched = join(dirs.base, 'watched')
  mkdirSync(watched, { recursive: true })
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [dirs.base], lastWorkspace: dirs.base })
  )
  const { app, page } = await launch(dirs, 'default', { MOCK_SCHEDULE_DELAY: '100' })
  const task = await page.evaluate(
    ({ projectPath, watchPath }) =>
      window.pi.createSchedule({
        name: 'E2E 事件任务',
        prompt: 'file changed',
        projectPath,
        cadence: { type: 'event', event: 'file-change', path: watchPath, debounceMs: 300 },
        catchUp: false,
        notifications: false
      }),
    { projectPath: dirs.base, watchPath: watched }
  )
  check('事件任务没有下次运行时间', task.nextRunAt == null, String(task.nextRunAt))
  await page.waitForTimeout(500)
  writeFileSync(join(watched, 'test.txt'), 'changed')
  const detail = await waitForScheduleRun(page, task.id)
  check(
    '文件变化触发任务',
    detail?.runs.some((run) => run.trigger === 'event' && run.status === 'success'),
    JSON.stringify(detail?.runs.map((run) => `${run.trigger}:${run.status}`))
  )
  await app.close()
}

async function caseScheduleSlash() {
  const dirs = freshDirs('schedule-slash')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [dirs.base], lastWorkspace: dirs.base })
  )
  const { app, page } = await launch(dirs)
  await page.locator('.composer-input').fill('/schedule 0 9 * * * 每日总结')
  await page.locator('.composer-input').press('Enter')
  await page.waitForSelector('.skills-page')
  await page.waitForSelector('.modal')
  const draft = await page.evaluate(() => ({
    prompt: document.querySelector('.schedule-textarea')?.value,
    plan: document.querySelector('.schedule-plan')?.textContent,
    title: document.querySelector('.skills-title')?.textContent
  }))
  check(
    '/schedule 打开预填的创建弹窗',
    draft.prompt === '每日总结' && draft.plan?.includes('每天 09:00') && draft.title?.includes('定时任务'),
    JSON.stringify(draft)
  )
  await app.close()
}

async function caseScheduleBridge() {
  const dirs = freshDirs('schedule-bridge')
  const rpcArgsFile = join(dirs.base, 'rpc-args.json')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [dirs.base], lastWorkspace: dirs.base })
  )
  const { app, page } = await launch(dirs, 'default', { MOCK_RPC_ARGS_FILE: rpcArgsFile })
  const rpcArgs = JSON.parse(readFileSync(rpcArgsFile, 'utf8'))
  check(
    '每个会话注入定时任务系统提示',
    rpcArgs.includes('--append-system-prompt') &&
      rpcArgs.some((arg) => arg.includes('pi-desktop-schedule')),
    rpcArgs.join(' ').slice(0, 180)
  )

  const cli = join(dirs.userData, 'bin', process.platform === 'win32' ? 'pi-desktop-schedule.cmd' : 'pi-desktop-schedule')
  check('生成调度 CLI', existsSync(cli), cli)
  const output = execFileSync(
    cli,
    ['add', '--prompt', '五分钟后的测试提醒', '--in', '1m', '--name', 'CLI 测试任务', '--project', dirs.base],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PI_DESKTOP_SCHEDULES_DIR: join(dirs.userData, 'schedules')
      }
    }
  )
  check('CLI 输出创建结果', output.includes('CLI 测试任务'), output.trim().split('\n')[0])
  await page.waitForSelector('.toast', { timeout: 8000 })
  const toast = await page.locator('.toast').first().innerText()
  check('创建任务后出现应用内提示', /已创建定时任务/.test(toast) && /CLI 测试任务/.test(toast), toast)

  let task
  for (let index = 0; index < 30 && !task; index += 1) {
    const list = await page.evaluate(() => window.pi.listSchedules())
    task = list.find((item) => item.name === 'CLI 测试任务')
    if (!task) await page.waitForTimeout(200)
  }
  check(
    'CLI 创建的任务出现在定时任务列表',
    Boolean(task) && task.cadence.type === 'once' && task.projectPath.length > 0 && task.tools === undefined && Boolean(task.sourceSessionPath),
    JSON.stringify(task)
  )

  const finishedName = 'CLI 完成测试'
  execFileSync(cli, ['add', '--prompt', '完成后通知我', '--in', '1s', '--name', finishedName, '--project', dirs.base], {
    encoding: 'utf8',
    env: { ...process.env, PI_DESKTOP_SCHEDULES_DIR: join(dirs.userData, 'schedules') }
  })
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('.toast')].some(
        (toast) => toast.textContent?.includes('定时任务运行完成') && toast.textContent?.includes(name)
      ),
    finishedName,
    { timeout: 20_000 }
  )
  const finishedToast = page
    .locator('.toast', { hasText: '定时任务运行完成' })
    .filter({ hasText: finishedName })
    .first()
  check('任务完成后出现结果提示', (await finishedToast.innerText()).includes('定时任务运行完成'))
  check('一次性任务完成后自动移除', !(await page.evaluate(
    (name) => window.pi.listSchedules().then((list) => list.some((item) => item.name === name)),
    finishedName
  )))
  await page.waitForFunction(
    (name) => [...document.querySelectorAll('.custom-message')].some((node) =>
      (node.textContent ?? '').includes(name)
    ),
    finishedName,
    { timeout: 8000 }
  )
  check('CLI 创建的一次性任务在原对话留下完成消息', (await page.locator('.custom-message').filter({ hasText: finishedName }).count()) >= 1)
  check('一次性任务结果提示不再提供查看结果', (await finishedToast.getByRole('button', { name: '查看结果' }).count()) === 0)
  await app.close()
}

async function caseScheduleNotice() {
  const dirs = freshDirs('schedule-notice')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [dirs.base], lastWorkspace: dirs.base })
  )
  const { app, page } = await launch(dirs)
  const sessionPath = await page.evaluate(async () => {
    const response = await window.pi.command({ type: 'get_state' })
    return response?.data?.sessionFile ?? null
  })
  check('当前会话有路径', Boolean(sessionPath), String(sessionPath))
  await page.evaluate(
    async ({ sessionPath, cwd }) => {
      await window.pi.createSchedule({
        name: '一次性完成通知',
        prompt: '检查完成通知',
        projectPath: cwd,
        sourceSessionPath: sessionPath,
        cadence: { type: 'once', at: Date.now() + 1200 },
        notifications: true,
        enabled: true
      })
    },
    { sessionPath, cwd: dirs.base }
  )
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.custom-message')].some((node) =>
        (node.textContent ?? '').includes('定时任务「一次性完成通知」已完成')
      ),
    { timeout: 20_000 }
  )
  check(
    '一次性任务完成后在原先对话收到消息',
    (await page.locator('.custom-message').filter({ hasText: '一次性完成通知' }).count()) >= 1
  )
  check(
    '一次性任务完成后从列表移除',
    !(await page.evaluate(() => window.pi.listSchedules())).some((item) => item.name === '一次性完成通知')
  )
  const notices = await page.evaluate((path) => window.pi.getSessionNotices(path), sessionPath)
  check('完成通知持久化到会话', notices.some((notice) => notice.text.includes('一次性完成通知')), JSON.stringify(notices))
  await app.close()
}

async function caseScratchChat() {
  const dirs = freshDirs('scratch-chat')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs)
  await page.locator('.new-session').click()
  await page.waitForFunction(() => document.querySelector('.topbar-path')?.textContent?.includes('新对话'))
  const projectRows = await page.locator('.project-row').count()
  check('新对话不进入项目列表', projectRows === 1, String(projectRows))
  await page.locator('.composer-input').fill('新对话消息')
  await page.locator('.composer-input').press('Enter')
  await page.waitForTimeout(2500)
  const recent = await page.locator('.recent-sessions .session-item').count()
  check('新对话出现在最近对话', recent >= 1, String(recent))
  await app.close()
}

async function caseScratchIsolation() {
  const dirs = freshDirs('scratch-isolation')
  const { app, page } = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1' })
  let first
  try {
    first = await page.evaluate(() => window.pi.openSession({ cwd: '', scratch: true }))
    const second = await page.evaluate(() => window.pi.openSession({ cwd: '', scratch: true }))
    check('两个新对话获得不同的临时目录', first.ok && second.ok && first.scratch && second.scratch && first.cwd !== second.cwd && first.cwd.includes('/scratch/conversations/') && second.cwd.includes('/scratch/conversations/'), JSON.stringify({ first: first.cwd, second: second.cwd }))
    writeFileSync(join(first.cwd, 'result.txt'), 'first')
    writeFileSync(join(second.cwd, 'result.txt'), 'second')
    check('同名产物各自保留', readFileSync(join(first.cwd, 'result.txt'), 'utf8') === 'first' && readFileSync(join(second.cwd, 'result.txt'), 'utf8') === 'second')
    const draft = new CreatorWorkspace(first.cwd).create('mode', 'scratch-discovery')
    const authored = await page.evaluate(() => window.pi.listCreatedPlugins())
    check('其他临时对话中的插件草稿仍可发现', authored.plugins.some(plugin => plugin.id === draft.id && plugin.workspace === first.cwd))
    const restored = await page.evaluate(({ cwd, sessionPath }) => window.pi.openSession({ cwd, sessionPath, scratch: true }), first)
    check('切回对话仍使用原来的临时目录', restored.ok && restored.cwd === first.cwd && restored.sessionPath === first.sessionPath && restored.scratch)
    const settings = await page.evaluate(async () => (await window.pi.bootstrap()).settings)
    check('临时目录不会加入项目列表', !settings.workspaces.some(path => path === first.cwd || path === second.cwd))
  } finally { await app.close() }
  const settingsPath = join(dirs.userData, 'settings.json')
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  writeFileSync(settingsPath, JSON.stringify({ ...settings, lastSessionPath: first.sessionPath }))
  const restarted = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1' })
  try {
    await restarted.page.locator('.topbar-path').getByText('新对话', { exact: true }).waitFor()
    const restored = await restarted.page.evaluate(async () => (await window.pi.command({ type: 'get_state' })).data?.sessionFile)
    check('重启后恢复同一对话与原临时目录', restored === first.sessionPath && readFileSync(join(first.cwd, 'result.txt'), 'utf8') === 'first')
  } finally { await restarted.app.close() }
}

async function caseCreatorInline() {
  const dirs = freshDirs('creator-inline')
  const pi = process.env.PI_TEST_PI || join(root, 'build/pi-seed/1.5.2/pi')
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    requests.push(JSON.parse(body))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const [delta, finish] of [[{ role: 'assistant', content: 'fixture complete' }, null], [{}, 'stop']]) res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise(resolveDone => server.listen(0, '127.0.0.1', resolveDone))
  writeFileSync(join(dirs.agent, 'models.json'), JSON.stringify({ providers: { local: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'test', models: [{ id: 'test', contextWindow: 200000, maxTokens: 8192 }] } } }))
  writeFileSync(join(dirs.agent, 'settings.json'), JSON.stringify({ defaultProvider: 'local', defaultModel: 'test' }))
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [dirs.base], lastWorkspace: dirs.base, sandboxEnabled: true, sandboxMode: 'workspace-write', sandboxNetwork: 'model' }))
  const { app, page } = await launch(dirs, 'default', { PI_DESKTOP_PI_PATH: pi })
  try {
    await page.locator('.composer-input').fill('/create 做一个测试插件')
    await page.locator('.composer-input').press('Enter')
    await page.getByText('fixture complete', { exact: false }).waitFor({ timeout: 60000 })
    const tools = (requests[0]?.tools ?? []).map(tool => tool.function?.name)
    check('一行创作请求先启用创意模式并传入创作工具', tools.includes('creator_docs') && tools.includes('creator_package'), JSON.stringify(tools))
    check('只发送创作想法而不发送模式切换命令', requests[0]?.messages?.some(message => message.role === 'user' && JSON.stringify(message.content).includes('做一个测试插件') && !JSON.stringify(message.content).includes('/create')))
    check('创意草稿没有写入全局扩展目录', !existsSync(join(dirs.agent, 'extensions')))
  } finally { await app.close(); server.closeAllConnections(); await new Promise(resolveDone => server.close(resolveDone)) }
}

async function caseSandboxRealBrowser() {
  const dirs = freshDirs('sandbox-real-browser')
  const pi = process.env.PI_TEST_PI || join(root, 'build/pi-seed/1.5.2/pi')
  let calls = []
  const server = createServer(async (req, res) => {
    if (req.url === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Fixture</title><main>Sandbox browser fixture</main>'); return }
    let body = ''; for await (const chunk of req) body += chunk
    const request = JSON.parse(body), results = (request.messages || []).filter(message => message.role === 'tool')
    const name = results.length === 0 ? 'computer_use_session_open' : results.length === 1 ? 'computer_use_session_observe' : null
    if (name) calls.push(name)
    const args = name === 'computer_use_session_open' ? { backend: 'inapp' } : { url: `http://127.0.0.1:${server.address().port}/page` }
    const delta = name ? { role: 'assistant', tool_calls: [{ index: 0, id: `fixture-${results.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { content: 'sandbox browser finished' }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const [part, finish] of [[delta, null], [{}, name ? 'tool_calls' : 'stop']]) res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: part, finish_reason: finish }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise(resolveDone => server.listen(0, '127.0.0.1', resolveDone))
  writeFileSync(join(dirs.agent, 'models.json'), JSON.stringify({ providers: { local: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'test', models: [{ id: 'test', contextWindow: 200000, maxTokens: 8192 }] } } }))
  writeFileSync(join(dirs.agent, 'settings.json'), JSON.stringify({ defaultProvider: 'local', defaultModel: 'test' }))
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [dirs.base], lastWorkspace: dirs.base, sandboxEnabled: true, sandboxMode: 'workspace-write', sandboxNetwork: 'model' }))
  const { app, page } = await launch(dirs, 'default', { PI_DESKTOP_PI_PATH: pi })
  try {
    await page.evaluate(() => { window.__browserResults = []; window.pi.onRecord(record => { if (record.type === 'tool_execution_end') window.__browserResults.push({ name: record.toolName, error: record.isError, details: record.result?.details }) }) })
    await page.locator('.composer-input').fill('Open the local fixture page')
    await page.locator('.composer-input').press('Enter')
    await page.getByText('sandbox browser finished', { exact: false }).waitFor({ timeout: 60000 })
    const results = await page.evaluate(() => window.__browserResults)
    check('真实 Pi 在沙箱中打开并观察应用内浏览器', calls.includes('computer_use_session_open') && calls.includes('computer_use_session_observe') && results.some(row => row.name === 'computer_use_session_open' && !row.error) && results.some(row => row.name === 'computer_use_session_observe' && !row.error), JSON.stringify(results))
    check('真实浏览器流程保留操作记录数据库', existsSync(join(dirs.base, '.pi', 'computer-use', 'browser-actions.sqlite')))
  } finally {
    await app.close(); server.closeAllConnections(); await new Promise(resolveDone => server.close(resolveDone))
  }
}

async function caseScratchStartup() {
  const dirs = freshDirs('scratch-startup')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({
    theme: 'dark', language: 'zh-CN', workspaces: [dirs.base], lastWorkspace: dirs.base, autoCheckUpdates: false
  }))
  const { app, page } = await launch(dirs, 'default', { MOCK_SCRATCH_START_DELAY: '1600' })
  try {
    await page.locator('.new-session').click()
    await page.locator('.status-dot.is-starting').waitFor()
    const input = page.locator('.composer-input')
    const focused = await page.evaluate(() => document.activeElement?.classList.contains('composer-input'))
    check('新建对话直接打开输入页，不经过欢迎页', !await page.locator('.welcome').count() && await input.isVisible() && await page.locator('.main.new-chat .empty-title').isVisible() && focused)
    if (!await input.isVisible()) return
    await input.fill('启动期间输入的草稿')
    check('启动期间可以输入，发送按钮等待会话就绪', await page.locator('.send-button').isDisabled())
    await input.press('Enter')
    await page.locator('.status-dot.is-ready').waitFor()
    check('启动完成后草稿保持原样', await input.inputValue() === '启动期间输入的草稿')
    await input.press('Enter')
    await page.locator('.user-message').getByText('启动期间输入的草稿', { exact: true }).waitFor()
    check('启动后可以发送原草稿', true)
  } finally {
    await app.close()
  }
}

async function caseScratchRestoreTrust() {
  const dirs = freshDirs('scratch-restore-trust')
  const project = join(dirs.base, 'project')
  const scratch = join(dirs.userData, 'scratch')
  mkdirSync(scratch, { recursive: true })
  mkdirSync(join(project, '.pi'), { recursive: true })
  writeFileSync(join(project, '.pi', 'settings.json'), '{}')
  const last = seedSession(dirs.sessions, 'saved-scratch', '已保存的新对话', 1, scratch)
  const settingsPath = join(dirs.userData, 'settings.json')
  for (const lastWorkspace of [project, undefined]) {
    writeFileSync(settingsPath, JSON.stringify({
      theme: 'dark', language: 'zh-CN', autoCheckUpdates: false,
      workspaces: lastWorkspace ? [lastWorkspace] : [],
      lastWorkspace, lastSessionPath: last
    }))
    const { app, page } = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1' })
    try {
      const title = await page.locator('.topbar-path').innerText()
      const banner = await page.locator('.project-trust-banner, .project-trust-collapsed').count()
      const restored = await page.evaluate(async () => (await window.pi.command({ type: 'get_state' })).data?.sessionFile)
      const messagesRestored = await page.locator('.user-message').getByText('已保存的新对话 question 0', { exact: true }).count() === 1
      check('新对话按自身目录恢复，无项目横幅', title === '新对话' && banner === 0 && restored === last && messagesRestored,
        JSON.stringify({ hasLastProject: !!lastWorkspace, title, banner, sameSession: restored === last, messagesRestored }))
      if (lastWorkspace) {
        await page.getByRole('button', { name: '在 project 中新建对话' }).click()
        await page.locator('.topbar-path').getByText('project', { exact: true }).waitFor()
        await page.locator('.new-session').click()
        await page.locator('.topbar-path').getByText('新对话', { exact: true }).waitFor()
        check('从项目切换到新对话时无信任提醒', !await page.locator('.project-trust-banner, .project-trust-collapsed').count())
      }
    } finally {
      await app.close()
    }
  }
}

async function caseSkillsPage() {
  const dirs = freshDirs('skills')
  const writeSkill = (name, description, bins) => {
    const dir = join(dirs.agent, 'skills', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\nversion: 1.0.0\nmetadata:\n  requires:\n    bins: [${bins}]\n---\n\n# ${name}\n\n示例正文 ${name}。\n`
    )
  }
  writeSkill('alpha', '读取测试数据', 'node')
  writeSkill('beta', '生成测试报告', 'definitely-missing-bin')
  for (let index = 1; index <= 24; index += 1) {
    writeSkill(`filler-${String(index).padStart(2, '0')}`, `填充技能 ${index}`, 'node')
  }
  writeSkill('gamma', '依赖 npm-global 里的命令', 'lark-cli')
  const fakeBin = join(dirs.base, '.npm-global', 'bin')
  mkdirSync(fakeBin, { recursive: true })
  writeFileSync(join(fakeBin, 'lark-cli'), '#!/bin/sh\necho fake\n')
  chmodSync(join(fakeBin, 'lark-cli'), 0o755)
  const pkg = join(dirs.agent, 'npm', 'node_modules', 'fake-plugin')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: 'fake-plugin', version: '2.3.4', description: '测试插件', main: 'index.js' })
  )
  writeFileSync(join(dirs.agent, 'settings.json'), JSON.stringify({ packages: ['npm:fake-plugin'] }))
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )

  const { app, page } = await launch(dirs, 'default', { HOME: dirs.base, MOCK_COMMANDS_JSON: JSON.stringify([{ name: 'skill:alpha', source: 'skill', description: '读取测试数据' }]) })
  await page.locator('.composer-input').fill('保留原有草稿')
  const entryStyles = await page.evaluate(() => {
    const pick = (selector) => {
      const style = getComputedStyle(document.querySelector(selector))
      return ['height', 'borderTopWidth', 'borderTopColor', 'backgroundColor', 'borderRadius', 'fontSize', 'paddingLeft', 'paddingRight'].map((key) => `${key}:${style[key]}`).join('|')
    }
    return { create: pick('.new-session'), skills: pick('.skills-page-entry') }
  })
  check('新建会话与技能入口样式一致', entryStyles.create === entryStyles.skills, JSON.stringify(entryStyles))
  await page.locator('.skills-page-entry').click()
  await page.waitForSelector('.skill-card')
  const gallery = await page.evaluate(() => ({
    cards: document.querySelectorAll('.skill-card').length,
    missing: document.querySelectorAll('.skill-card .missing').length,
    names: [...document.querySelectorAll('.skill-card-name')].map((node) => node.textContent ?? '')
  }))
  check('侧栏入口打开技能页并列出技能', gallery.cards === 27, JSON.stringify(gallery))
  check('缺少依赖的技能有标记', gallery.missing === 1, JSON.stringify(gallery))
  const scroller = await page.evaluate(() => {
    const el = document.querySelector('.skills-scroll')
    return { height: el?.scrollHeight ?? 0, client: el?.clientHeight ?? 0 }
  })
  check('技能列表内容超过视口', scroller.height > scroller.client, JSON.stringify(scroller))
  await page.locator('.skills-scroll').hover()
  await page.mouse.wheel(0, 500)
  await page.waitForTimeout(250)
  const scrollTop = await page.evaluate(() => document.querySelector('.skills-scroll')?.scrollTop ?? 0)
  check('技能列表可以滚动', scrollTop > 0, String(scrollTop))
  await page.evaluate(() => {
    const el = document.querySelector('.skills-scroll')
    if (el) el.scrollTop = 0
  })
  await page.waitForTimeout(150)

  const backFirst = await page.evaluate(() =>
    document.querySelector('.skills-head')?.firstElementChild?.classList.contains('skills-back') ?? false
  )
  check(
    '返回键位于左侧且不是叉号',
    backFirst && (await page.locator('.skills-close').count()) === 0,
    String(backFirst)
  )

  await page.locator('.skill-card', { hasText: '读取表格' }).click()
  await page.waitForSelector('.skill-detail, .detail-page')
  const detailBack = await page.locator('.skills-head .skills-back').boundingBox()
  check('详情页返回键避开红绿灯', Boolean(detailBack && detailBack.y >= 44), JSON.stringify(detailBack))
  const detail = await page.evaluate(() => ({
    name: document.querySelector('.detail-heading h1')?.textContent ?? '',
    body: document.querySelector('.skill-readme')?.textContent ?? ''
  }))
  check(
    '详情页显示 SKILL.md 正文且隐藏 frontmatter',
    detail.name === '读取表格' &&
      detail.body.includes('示例正文 alpha') &&
      !detail.body.includes('description:'),
    detail.body.slice(0, 80)
  )

  await page.getByRole('button', { name: '在对话中使用' }).click()
  await page.waitForTimeout(200)
  const composer = await page.locator('.composer-input').inputValue()
  check('技能详情使用真实 Pi 命令并保留草稿', await page.locator('.composer-skill-chip').getByText('/alpha', { exact: true }).isVisible() && composer === '保留原有草稿', composer)

  await page.locator('.skills-page-entry').click()
  await page.waitForSelector('.skills-tab')
  await page.locator('.plugins-page-entry').click()
  const market = page.getByRole('dialog', { name: 'Pi 插件', exact: true })
  await market.getByRole('tab', { name: /已安装/ }).click()
  await market.locator('.market-installed article').waitFor()
  const plugin = await market.locator('.market-installed article').innerText()
  check('独立 Pi 插件页面列出已安装名称与版本', /fake-plugin/.test(plugin) && /2\.3\.4/.test(plugin), plugin)
  check('已安装插件显示介绍', /测试插件/.test(plugin), plugin)
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('packages:details')
    ipcMain.handle('packages:details', () => ({ ok: false, error: '此插件未在 npm 发布。' }))
  })
  await market.locator('.market-installed .market-card-title').click()
  await market.getByRole('alert').waitFor()
  check('未发布的已安装插件显示真实详情错误，可返回列表', (await market.getByRole('alert').innerText()).includes('此插件未在 npm 发布。'))
  await market.getByRole('button', { name: '所有插件', exact: true }).click()
  await market.locator('.market-installed article').waitFor()
  check('详情可返回原来的已安装列表', await market.locator('.market-info').count() === 0)

  await page.locator('.skills-page-entry').click()
  await page.locator('.skills-tab', { hasText: '应用连接' }).click()
  await page.locator('.connection-row', { hasText: '飞书' }).waitFor()
  const connectorSummary = await page.evaluate(() => ({
    feishu: [...document.querySelectorAll('.connection-row')].find((row) => row.textContent?.includes('飞书'))?.textContent ?? '',
    missing: [...document.querySelectorAll('.connection-row')].find((row) => row.textContent?.includes('definitely-missing-bin'))?.textContent ?? ''
  }))
  check(
    '应用连接区分已安装和未安装的命令',
    connectorSummary.feishu.includes('飞书') && connectorSummary.feishu.includes('已安装') && connectorSummary.missing.includes('未安装'),
    JSON.stringify(connectorSummary)
  )

  await page.locator('.connection-row', { hasText: '飞书' }).click()
  await page.waitForSelector('.connector-detail')
  const connector = await page.evaluate(() => ({
    name: document.querySelector('.connector-detail .detail-heading h1')?.textContent ?? '',
    body: document.querySelector('.connector-detail')?.textContent ?? ''
  }))
  check(
    '连接器详情显示全局路径与使用它的技能',
    connector.name === '飞书' &&
      connector.body.includes('lark-cli') &&
      connector.body.includes('.npm-global') &&
      connector.body.includes('gamma'),
    connector.body.slice(0, 180)
  )

  await page.locator('.skills-head .skills-back').click()
  await page.waitForSelector('.skills-tab')
  await page.locator('.plugins-page-entry').click()
  await market.getByRole('tab', { name: /已安装/ }).click()
  await market.locator('.market-installed article').waitFor()
  await market.getByRole('button', { name: '卸载 fake-plugin', exact: true }).click()
  await page.getByRole('heading', { name: '卸载插件', exact: true }).waitFor()
  check('已安装插件支持卸载确认', await page.locator('.modal').isVisible())
  await page.keyboard.press('Escape')
  await page.locator('.modal').waitFor({ state: 'detached' })
  check('Esc 关闭卸载对话框并保留市场', await market.isVisible())

  await app.close()
}

async function caseUpdateDownload() {
  const dirs = freshDirs('update-download')
  const { app, page } = await launch(dirs)
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('app:check-update')
      ipcMain.handle('app:check-update', () => ({
        current: '0.7.7',
        latest: '0.8.0',
        hasUpdate: true,
        url: 'https://github.com/SuperWBY/pi-desktop/releases/tag/v0.8.0',
        notes: 'test release',
        publishedAt: null,
        asset: { name: 'Pi-Desktop-0.8.0-arm64.dmg', url: 'https://example.invalid/app.dmg', size: 1000 }
      }))
      ipcMain.removeHandler('app:download-update')
      ipcMain.handle('app:download-update', () => ({ ok: true, path: '/tmp/Pi-Desktop-0.8.0-arm64.dmg' }))
    })
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: '关于', exact: true }).click()
    await page.getByRole('button', { name: '检查更新', exact: true }).click()
    await page.getByText('发现新版本 0.8.0').waitFor({ timeout: 5000 })
    await page.getByRole('button', { name: '下载并安装', exact: true }).click()
    await page.waitForTimeout(500)
    check('有安装包时提供下载并安装入口', await page.getByRole('button', { name: '下载并安装', exact: true }).isVisible())
    await page.getByRole('switch', { name: '启动时检查更新' }).click()
    await page.waitForTimeout(200)
    const saved = JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8'))
    check('可以关闭启动时自动检查更新', saved.autoCheckUpdates === false, JSON.stringify(saved))
  } finally { await app.close() }
}

async function caseUpdateDownloadReal() {
  const dirs = freshDirs('update-download-real')
  const payload = Buffer.from('mock dmg payload')
  const digest = createHash('sha256').update(payload).digest('hex')
  const server = createServer((req, res) => {
    if (req.url === '/release') {
      const body = JSON.stringify({
        tag_name: 'v9.9.9',
        html_url: 'https://github.com/SuperWBY/pi-desktop/releases/tag/v9.9.9',
        body: 'local update fixture',
        published_at: null,
        assets: [{ name: 'Pi-Desktop-9.9.9-arm64.dmg', browser_download_url: `http://127.0.0.1:${server.address().port}/app.dmg`, size: payload.length, digest: `sha256:${digest}` }]
      })
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
      res.end(body)
      return
    }
    if (req.url === '/app.dmg') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': payload.length })
      res.end(payload)
      return
    }
    res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { app, page } = await launch(dirs, 'default', {
      PI_UPDATE_API_URL: `http://127.0.0.1:${server.address().port}/release`,
      PI_DESKTOP_SKIP_UPDATE_OPEN: '1'
    })
    try {
      const result = await page.evaluate(() => window.pi.downloadUpdate())
      if (!result.ok && /当前平台/.test(result.error ?? '')) {
        check('当前平台没有对应安装包，跳过真实下载校验', true, result.error)
        return
      }
      check('真实下载链路可以完成并校验摘要', result.ok === true && typeof result.path === 'string', JSON.stringify(result))
      const saved = readFileSync(result.path)
      check('下载内容与 Release 一致', createHash('sha256').update(saved).digest('hex') === digest)
      check('下载文件权限不会放宽', (statSync(result.path).mode & 0o777) === 0o600)
    } finally { await app.close() }
  } finally { server.close() }
}

async function caseJevSettings() {
  const dirs = freshDirs('jev-settings')
  const { app, page } = await launch(dirs)
  try {
    const status = await page.evaluate(() => window.pi.saveJevSettings({ enabled: true, provider: 'typesafe', model: 'jev-latest', key: 'jev-test-key' }))
    check('Jev 状态不回传密钥', status.enabled === true && status.keyConfigured === true && !JSON.stringify(status).includes('jev-test-key'), JSON.stringify(status))
    const file = join(dirs.agent, 'jev.json')
    const stored = JSON.parse(readFileSync(file, 'utf8'))
    check('Jev 设置写入本地文件', stored.key === 'jev-test-key' && stored.enabled === true && stored.model === 'jev-latest', JSON.stringify(stored))
    check('Jev 配置文件权限为 0600', (statSync(file).mode & 0o777) === 0o600)
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: '工具与技能', exact: true }).click()
    await page.getByText('开发者设置', { exact: true }).click()
    await page.getByText('Jev 判断层', { exact: true }).waitFor({ timeout: 5000 })
    check('设置页显示 Jev 判断层', await page.getByText('Jev 判断层', { exact: true }).isVisible())
  } finally { await app.close() }
}

async function caseJevEnv() {
  const dirs = freshDirs('jev-env')
  writeFileSync(join(dirs.agent, 'jev.json'), JSON.stringify({ enabled: true, provider: 'typesafe', model: 'jev-latest', key: 'jev-env-key' }))
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [dirs.base], lastWorkspace: dirs.base }))
  const envFile = join(dirs.base, 'jev-child-env.json')
  const { app } = await launch(dirs, 'default', { MOCK_ENV_FILE: envFile })
  try {
    const deadline = Date.now() + 8000
    while (!existsSync(envFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
    const env = JSON.parse(readFileSync(envFile, 'utf8'))
    check('Jev 开关和密钥传递给 pi 子进程', env.jev === '1' && env.provider === 'typesafe' && env.key === 'jev-env-key' && env.model === 'jev-latest', JSON.stringify(env))
  } finally { await app.close() }
}

async function casePluginNavigation() {
  const dirs = freshDirs('plugin-navigation')
  const pluginPath = join(dirs.agent, 'npm', 'node_modules', 'pi-demo-plugin')
  mkdirSync(pluginPath, { recursive: true })
  writeFileSync(join(pluginPath, 'package.json'), JSON.stringify({ name: 'pi-demo-plugin', version: '1.2.0', description: '测试插件', pi: { extensions: ['./index.js'] } }))
  writeFileSync(join(dirs.agent, 'settings.json'), JSON.stringify({ packages: ['npm:pi-demo-plugin'], defaultProvider: 'mock', defaultModel: 'test' }))
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [root], lastWorkspace: root }))
  const scopeProject = join(dirs.base, 'scope-project')
  const projectPluginPath = join(scopeProject, '.pi', 'npm', 'node_modules', 'pi-demo-plugin')
  mkdirSync(projectPluginPath, { recursive: true })
  writeFileSync(join(scopeProject, '.pi', 'settings.json'), JSON.stringify({ packages: ['npm:pi-demo-plugin@0.9.0'] }))
  writeFileSync(join(projectPluginPath, 'package.json'), JSON.stringify({ name: 'pi-demo-plugin', version: '0.9.0' }))
  const { app, page } = await launch(dirs, 'default', { MOCK_LIST_OUTPUT: `Project packages:\n  npm:pi-demo-plugin@0.9.0\n    ${projectPluginPath}\n` })
  try {
    const scopedPackages = await page.evaluate((cwd) => window.pi.listPackages(cwd), scopeProject)
    check('同名插件的项目版本与全局版本按实际路径读取', scopedPackages.find((item) => item.scope === 'project')?.version === '0.9.0' && scopedPackages.find((item) => item.scope === 'project')?.path === projectPluginPath && scopedPackages.find((item) => item.scope === 'user')?.version === '1.2.0', JSON.stringify(scopedPackages.map(({ scope, version }) => ({ scope, version }))))
    const pluginEntry = page.getByRole('button', { name: 'Pi 插件', exact: true })
    const skillsEntry = page.getByRole('button', { name: '技能与工具', exact: true })
    const schedulesEntry = page.locator('.schedules-entry')
    check('Pi 插件与技能、定时任务并列为侧栏入口', await pluginEntry.count() === 1 && await skillsEntry.count() === 1 && await schedulesEntry.count() === 1)
    await pluginEntry.click()
    const plugins = page.getByRole('dialog', { name: 'Pi 插件', exact: true })
    await plugins.getByRole('tab', { name: /已安装/ }).click()
    await plugins.locator('.market-installed article').waitFor()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.navigation-page[data-open="true"]')).opacity === '1')
    check('独立插件页展示原有插件管理，且侧栏保持可见', await plugins.getByText('pi-demo-plugin', { exact: false }).count() > 0 && await skillsEntry.isVisible())
    check('只有 Pi 插件入口显示当前页面状态', await pluginEntry.getAttribute('aria-current') === 'page' && await page.locator('.skills-entry[aria-current="page"]').count() === 1)
    const geometry = await page.evaluate(() => ({ sidebar: document.querySelector('.sidebar').getBoundingClientRect().right, page: document.querySelector('.navigation-page').getBoundingClientRect().left }))
    check('插件页不覆盖左侧导航', Math.abs(geometry.sidebar - geometry.page) < 1, JSON.stringify(geometry))
    const catalogBack = plugins.getByRole('button', { name: '返回', exact: true })
    const catalogBackLayout = await catalogBack.evaluate(button => {
      const rect = button.getBoundingClientRect(), title = button.closest('.market-content').querySelector('h1').getBoundingClientRect()
      const arrow = button.querySelector('svg').getBoundingClientRect(), style = getComputedStyle(button)
      return { arrow: arrow.left, title: title.left, bottom: rect.bottom, titleTop: title.top, width:rect.width, height:rect.height, background:style.backgroundColor, border:style.borderTopWidth, text:button.textContent }
    })
    check('市场返回位于标题左上方，44px可点且无边框底色', Math.abs(catalogBackLayout.arrow - catalogBackLayout.title) < 1 && catalogBackLayout.bottom <= catalogBackLayout.titleTop && catalogBackLayout.width >= 44 && catalogBackLayout.height >= 44 && catalogBackLayout.border === '0px' && catalogBackLayout.background === 'rgba(0, 0, 0, 0)' && catalogBackLayout.text === '返回', JSON.stringify(catalogBackLayout))

    await catalogBack.hover()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.market-catalog-back svg')).transform !== 'none')
    const hovered = await catalogBack.evaluate(button => ({ background:getComputedStyle(button).backgroundColor, border:getComputedStyle(button).borderTopWidth, color:getComputedStyle(button).color, text:getComputedStyle(button.closest('.market-content')).color }))
    check('返回悬停有箭头位移，保持透明无边框和正文色', hovered.background === 'rgba(0, 0, 0, 0)' && hovered.border === '0px' && hovered.color === hovered.text)
    await catalogBack.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    check('返回支持键盘焦点下划线', await catalogBack.locator('span').evaluate(span => getComputedStyle(span).textDecorationLine.includes('underline')))
    await page.mouse.move(10, 10)
    await page.screenshot({ path: join(dirs.base, 'plugins-dark.png') })
    await page.locator('.sidebar-actions').screenshot({ path: join(dirs.base, 'sidebar.png') })
    await plugins.getByRole('button', { name: '卸载 pi-demo-plugin', exact: true }).click()
    await page.getByRole('heading', { name: '卸载插件', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.modal').waitFor({ state: 'detached' })
    check('卸载对话框关闭后仍停留在独立插件页', await plugins.isVisible())
    await skillsEntry.click()
    const skills = page.getByRole('dialog', { name: '技能与工具', exact: true })
    await skills.locator('.skills-tabs').waitFor()
    check('技能与工具保留技能和应用连接，移除内部插件标签', JSON.stringify(await skills.locator('.skills-tab').allTextContents()) === JSON.stringify(['技能', '应用连接']))
    await schedulesEntry.click()
    await page.getByRole('dialog', { name: '定时任务', exact: true }).waitFor()
    check('一级页面切换互斥，定时任务选中状态正确', await skills.isVisible() === false && await schedulesEntry.getAttribute('aria-current') === 'page')
    await pluginEntry.click()
    await plugins.waitFor()
    await plugins.getByRole('tab', { name: /已安装/ }).click()
    await plugins.locator('.market-installed article').waitFor()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b')
    await page.waitForFunction(() => document.querySelector('.navigation-page[aria-hidden="false"]').getBoundingClientRect().left === 0)
    check('收起侧栏后独立页面填满窗口', true)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b')
    await page.setViewportSize({ width: 860, height: 720 })
    await page.waitForFunction(() => Math.abs(document.querySelector('.navigation-page[aria-hidden="false"]').getBoundingClientRect().left - document.querySelector('.sidebar').getBoundingClientRect().right) < 1)
    const narrow = await plugins.evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth, right: el.getBoundingClientRect().right,
      left: el.getBoundingClientRect().left, sidebar: document.querySelector('.sidebar').getBoundingClientRect().right }))
    check('窄窗口插件管理不横向溢出且与侧栏对齐', narrow.scroll <= narrow.width + 1 && narrow.right <= 860 && Math.abs(narrow.left - narrow.sidebar) < 1, JSON.stringify(narrow))
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+l' : 'Control+Shift+l')
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    await page.screenshot({ path: join(dirs.base, 'plugins-light-narrow.png') })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    check('页面动画支持减少动态效果', await plugins.locator('..').evaluate((el) => getComputedStyle(el).transitionDuration) === '0s')
    const narrowBack = plugins.getByRole('button', { name: '返回', exact: true })
    const narrowBackLayout = await narrowBack.evaluate(button => ({ arrow:button.querySelector('svg').getBoundingClientRect().left, title:button.closest('.market-content').querySelector('h1').getBoundingClientRect().left, height:button.getBoundingClientRect().height }))
    check('浅色窄窗口返回仍在左上且保留44px区域', Math.abs(narrowBackLayout.arrow-narrowBackLayout.title)<1 && narrowBackLayout.height>=44)
    await page.screenshot({ path: join(dirs.base, '..', '..', 'market-back-top-left-verified.png') })
    await narrowBack.click({ position:{x:115,y:22} })
    await page.waitForFunction(() => document.querySelectorAll('.navigation-page').length === 0)
    check('返回关闭插件页并恢复侧栏焦点', await pluginEntry.evaluate((el) => el === document.activeElement))
    await pluginEntry.click()
    await plugins.waitFor()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.locator('.settings-page').waitFor()
    await page.waitForFunction(() => document.querySelectorAll('.navigation-page').length === 0)
    check('插件页可以直接切换到设置', await page.locator('.settings-page').isVisible())
    await page.keyboard.press('Escape')
    await page.locator('.settings-page').waitFor({ state: 'detached' })
    await schedulesEntry.click()
    await page.getByRole('dialog', { name: '定时任务', exact: true }).waitFor()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
    await page.locator('.settings-page').waitFor()
    await page.waitForFunction(() => document.querySelectorAll('.navigation-page').length === 0)
    check('定时任务页可以通过快捷键切换到设置', await page.locator('.settings-page').isVisible())
    await page.keyboard.press('Escape')
    await page.locator('.settings-page').waitFor({ state: 'detached' })
    await pluginEntry.click()
    await plugins.waitFor()
    await page.getByRole('button', { name: '新建会话', exact: false }).first().click()
    await plugins.waitFor({ state: 'hidden' })
    check('从侧栏新建会话会退出插件页', true)
  } finally { await app.close() }
}

async function casePackageDetails() {
  const dirs = freshDirs('package-details')
  const { app, page } = await launch(dirs)
  try {
    const invalid = await page.evaluate(() => window.pi.getPackageDetails({ name: '../invalid' }))
    check('详情 API 通过 preload/IPC 校验包名', invalid.ok === false && /包名/.test(invalid.error ?? ''))
    const result = await page.evaluate(async () => {
      const response = await window.pi.getPackageDetails({ name: 'pi-mcp-extension' })
      if (!response.ok) return response
      const d = response.details
      return { ok: true, name: d.name, version: d.version, installSource: d.installSource,
        repositoryUrl: d.repositoryUrl, readmeSource: d.readme?.source,
        readmeLength: d.readme?.markdown.length ?? 0, versionMatched: d.readme?.versionMatched }
    })
    check('真实插件详情可经桌面接口返回，安装标识绑定版本',
      result.ok && result.name === 'pi-mcp-extension' && result.installSource === `npm:pi-mcp-extension@${result.version}`,
      JSON.stringify(result))
    check('桌面接口返回完整且匹配版本的 README', result.ok && result.readmeLength > 1000 && result.versionMatched === true)
  } finally { await app.close() }
}

async function casePackageCatalog() {
  const dirs = freshDirs('package-catalog')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [root], lastWorkspace: root }))
  const { app, page, errors } = await launch(dirs)
  try {
    await app.evaluate(({ ipcMain }) => {
      const entries = ['pi-mcp-extension', 'pi-web-access', 'pi-subagents', 'pi-theme'].map((name, index) => ({
        name, version: '1.15.3', description: name === 'pi-mcp-extension' ? '为 Pi 接入 MCP 服务，支持本地进程和远程 HTTP 连接。' : '社区扩展，为 Pi 增加更多功能。',
        publishedAt: '2026-11-13T00:00:00Z', publisher: 'irahardianto', keywords: ['pi-package'],
        npmUrl: `https://www.npmjs.com/package/${name}`, repositoryUrl: `https://github.com/irahardianto/${name}`, source: `npm:${name}`, index
      }))
      const st = { entries, installed: [], calls: [], finish: null, failCatalog: false, latestVersion: '1.15.3', updateCalls: 0 }
      globalThis.__market = st
      for (const method of ['catalog', 'details', 'install', 'list', 'remove', 'update', 'translate']) ipcMain.removeHandler(`packages:${method}`)
      ipcMain.handle('packages:catalog', (_, query) => {
        (st.searchCalls ??= []).push(query)
        const result = () => st.failCatalog ? { entries: [], error: '网络暂时不可用' } : ({ entries: entries.filter((entry) => !query || entry.name.includes(query)) })
        if (query === 'mcp' && st.holdSearch) return new Promise((resolve) => { st.finishSearch = () => resolve(result()) })
        return result()
      })
      ipcMain.handle('packages:list', () => st.installed)
      ipcMain.handle('packages:translate', (_, input) => { (st.translationBatches ??= []).push(input.texts.length); return ({ ok: true, texts: input.texts.map((text) => input.language === 'en' ? text.replace(/[\p{Script=Han}\u3000-\u303F\uFF00-\uFFEF]+/gu, 'Documentation') : text.replace('Connect Pi to any MCP server.', '让 Pi 连接任意 MCP 服务器。').replace('## Features', '## 功能')) }) })
      ipcMain.handle('packages:details', (_, { name, version, fast, language }) => {
        if (st.failDetailsFor === name) return new Promise((resolve) => { st.finishDetails = () => resolve({ ok: false, error: '读取来源失败' }) })
        const result = { ok: true, details: {
        name, version: version ?? st.latestVersion, latestVersion: st.latestVersion, versions: [st.latestVersion], description: entries.find((entry) => entry.name === name)?.description,
        author: 'irahardianto', publisher: 'irahardianto', license: 'MIT', publishedAt: '2026-11-13T00:00:00Z', homepage: null,
        npmUrl: `https://www.npmjs.com/package/${name}`, catalogUrl: `https://pi.dev/packages/${name}`, repositoryUrl: `https://github.com/irahardianto/${name}`,
        installSource: `npm:${name}@${version ?? st.latestVersion}`, unpackedSize: 548557, dependencies: { a: '*', b: '*' }, peerDependencies: { a: '*', b: '*', c: '*' }, engines: {},
        manifest: { extensions: ['./index.ts'], skills: [], prompts: [], themes: [], image: name === 'pi-mcp-extension' ? 'https://raw.githubusercontent.com/irahardianto/pi-mcp-extension/main/docs/icon-preview.png' : name === 'pi-theme' ? 'https://example.invalid/missing-package-cover.png' : null, video: null },
        readme: { markdown: '# pi-mcp-extension\n\n**Connect Pi to any MCP server.**\n\n将 MCP 服务的工具接入 Pi，并管理连接、工具发现与调用。\n\n## Installation\n\n```bash\npi install npm:pi-mcp-extension\n```\n\n## Features\n\n- 多种传输方式：支持 stdio、SSE 和 Streamable HTTP。\n- 按需连接与工具发现：按需建立连接并自动发现可用工具。\n- 连接状态与错误提示：提供清晰的连接状态与错误信息。\n\n## 使用说明\n\n安装后，可在 Pi 中添加并配置 MCP 服务器。\n\n```json\n{ "mcpServers": {} }\n```\n\n[配置文档](docs/config.md)\n', source: 'npm-cdn', url: 'https://cdn.jsdelivr.net/npm/pi-mcp-extension@1.15.3/README.md', baseUrl: 'https://cdn.jsdelivr.net/npm/pi-mcp-extension@1.15.3/', versionMatched: true }, warnings: [], fetchedAt: Date.now()
      } }
        result.details.readme.localizationStatus = language ? 'not-found' : undefined
        if (fast && st.holdReadme) return new Promise((resolve) => { st.finishReadme = () => { st.holdReadme = false; resolve(result) } })
        return result
      })
      ipcMain.handle('packages:install', (_, source, options) => {
        st.calls.push({ source, options })
        return new Promise((resolve) => { st.finish = (ok) => {
          if (ok) st.installed = [{ source, name: source.replace(/^npm:/, '').replace(/@[^@]+$/, ''), version: source.slice(source.lastIndexOf('@') + 1), scope: 'user', enabled: true, resources: { extensions: 1, skills: 0, prompts: 0, themes: 0 } }]
          resolve({ ok, code: ok ? 0 : 1, error: ok ? undefined : '下载失败，请检查网络。' })
        } })
      })
      ipcMain.handle('packages:remove', () => { st.installed = st.installed.filter((item) => item.scope !== 'user'); return { ok: true, code: 0 } })
      ipcMain.handle('packages:update', () => { st.updateCalls++; return { ok: true, code: 0 } })
    })
    await page.route('https://example.invalid/**', (route) => route.fulfill({ status: 404, body: '' }))
    await page.setViewportSize({ width: 1487, height: 1058 })
    await page.locator('.plugins-page-entry').click()
    const market = page.getByRole('dialog', { name: 'Pi 插件', exact: true })
    await market.locator('.market-card').first().waitFor()
    check('市场默认展示双列目录、最近发布与已安装入口', await market.locator('.market-card').count() === 4 && await market.locator('.market-recent').count() === 1)
    const searchInput = market.getByRole('textbox', {name:'搜索插件'})
    await searchInput.click()
    const searchStyle = await market.locator('.market-search').evaluate(el => {
      const input = getComputedStyle(el.querySelector('input'))
      const button = getComputedStyle(el.querySelector('button'))
      const parent = getComputedStyle(el)
      const root = getComputedStyle(document.documentElement)
      return { inputOutline:input.outlineStyle, buttonBorder:button.borderTopWidth, buttonBackground:button.backgroundColor, border:parent.borderTopColor, neutral:root.getPropertyValue('--border-strong').trim() }
    })
    check('搜索图标、输入框和按钮合为一体，点击输入没有黄色内框', searchStyle.inputOutline === 'none' && searchStyle.buttonBorder === '0px' && searchStyle.buttonBackground === 'rgba(0, 0, 0, 0)' && searchStyle.border === 'rgb(74, 77, 85)', JSON.stringify(searchStyle))
    await page.screenshot({ path: join(dirs.base, 'search-focused.png') })
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    const lightFocus = await market.locator('.market-search').evaluate(el => ({ outline:getComputedStyle(el.querySelector('input')).outlineStyle, border:getComputedStyle(el).borderTopColor }))
    check('浅色主题点击输入也没有黄色内框', lightFocus.outline === 'none' && lightFocus.border === 'rgb(206, 199, 187)', JSON.stringify(lightFocus))
    await page.screenshot({ path: join(dirs.base, 'search-focused-light.png') })
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    await searchInput.press('Tab')
    const searchButton = market.locator('.market-search button')
    check('键盘焦点仍清晰可见', await searchButton.evaluate(el => document.activeElement === el && getComputedStyle(el).outlineStyle !== 'none'))
    await searchInput.fill('web')
    await market.getByRole('button', {name:'pi-web-access', exact:false}).first().waitFor()
    check('输入后自动搜索，无需点击按钮', await market.locator('.market-card').count() === 1 && (await app.evaluate(() => globalThis.__market.searchCalls)).includes('web'))
    await searchInput.fill('')
    await page.waitForFunction(() => document.querySelectorAll('.market-card').length === 4)
    check('清空关键词恢复完整目录', await market.locator('.market-recent').isVisible())
    await app.evaluate(() => { globalThis.__market.holdSearch = true })
    await searchInput.fill('mcp')
    await page.waitForFunction(() => window.pi && document.querySelector('.market-grid[aria-busy="true"]'))
    await page.waitForTimeout(400)
    await searchInput.fill('web')
    await market.getByRole('button', {name:'pi-web-access', exact:false}).first().waitFor()
    await app.evaluate(() => globalThis.__market.finishSearch())
    await page.waitForTimeout(100)
    check('较早的搜索结果不会覆盖后输入的关键词', await market.locator('.market-card').count() === 1 && await market.locator('.market-card-title').first().innerText() === 'pi-web-access')
    await searchInput.fill('')
    await page.waitForFunction(() => document.querySelectorAll('.market-card').length === 4)
    const callsBeforeIme = (await app.evaluate(() => globalThis.__market.searchCalls)).length
    await searchInput.dispatchEvent('compositionstart', { data:'' })
    await searchInput.fill('zhong')
    await page.waitForTimeout(400)
    check('中文拼音组合期间不提前发送搜索', (await app.evaluate(() => globalThis.__market.searchCalls)).length === callsBeforeIme)
    await searchInput.fill('中文')
    await searchInput.dispatchEvent('compositionend', { data:'中文' })
    await page.waitForFunction(() => document.querySelector('.market-empty')?.textContent?.includes('没有找到匹配'))
    check('中文输入完成后自动搜索', (await app.evaluate(() => globalThis.__market.searchCalls)).includes('中文'))
    await searchInput.fill('')
    await page.waitForFunction(() => document.querySelectorAll('.market-card').length === 4)

    check('目录卡片没有安装命令与安装预览步骤', !/pi install|检查并安装|manifest JSON|安装范围/.test(await market.innerText()))
    check('卡片与图片位均移除边框', await market.locator('.market-card').first().evaluate((el) => getComputedStyle(el).borderTopWidth === '0px') && await market.locator('.market-art').first().evaluate((el) => getComputedStyle(el).borderTopWidth === '0px'))
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.navigation-page')).opacity === '1')
    await market.locator('.market-card .market-art img').first().waitFor()
    await market.locator('.market-card .market-art img').evaluateAll(async (imgs) => { await Promise.all(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve }))) })
    await market.getByRole('img', { name: 'pi-web-access 默认封面', exact: true }).waitFor()
    await market.getByRole('img', { name: 'pi-theme 默认封面', exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('.market-card:has(#market-pi-theme) .market-art img') === null)
    check('有图片显示原图；无图片或图片失败使用统一网格封面', await market.locator('.market-card .market-art[data-artwork="image"]').count() === 1 && await market.locator('.market-card .market-art-placeholder').count() === 3)
    await page.screenshot({ path: join(dirs.base, 'catalog-dark.png') })
    const controls = await market.locator('.market-filters').evaluate(el => {
      const rects = [el.querySelector('.market-search'), ...el.querySelectorAll('.market-select .settings-select-button')].map(item => item.getBoundingClientRect())
      return rects.map(r => ({ top:r.top, height:r.height, width:r.width }))
    })
    check('搜索、类型和排序控件等高并对齐', controls.length === 3 && controls.every(r => Math.abs(r.height - controls[0].height) < 1 && Math.abs(r.top - controls[0].top) < 1) && Math.abs(controls[1].width - controls[2].width) < 1, JSON.stringify(controls))
    await market.getByRole('button', { name: '插件类型', exact: true }).click()
    await page.getByRole('menuitemradio', { name: '全部类型', exact: true }).waitFor()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.popover')).opacity === '1')
    const alignment = await page.evaluate(() => {
      const button = document.querySelector('[aria-label="插件类型"]').getBoundingClientRect()
      const menu = document.querySelector('.popover:not(.popover-closing):has([role="menuitemradio"])').getBoundingClientRect()
      return { dx:menu.left-button.left, dw:menu.width-button.width, gap:menu.top-button.bottom }
    })
    check('类型菜单与按钮等宽对齐并贴近触发位置', Math.abs(alignment.dx) < 1 && Math.abs(alignment.dw) < 1 && alignment.gap >= 0 && alignment.gap <= 3, JSON.stringify(alignment))
    await page.screenshot({ path: join(dirs.base, 'filters-dark.png') })
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 860, height: 720 })
    const sortTrigger = market.getByRole('button', { name:'插件排序', exact:true })
    await sortTrigger.scrollIntoViewIfNeeded()
    await sortTrigger.focus()
    await page.keyboard.press('Enter')
    const sortOption = page.getByRole('menuitemradio', { name:'名称排序', exact:true })
    await sortOption.waitFor()
    const narrowAlignment = await page.evaluate(() => {
      const button = document.querySelector('[aria-label="插件排序"]').getBoundingClientRect()
      const menu = document.querySelector('.popover:not(.popover-closing):has([role="menuitemradio"])').getBoundingClientRect()
      return { dx:menu.left-button.left, dw:menu.width-button.width, within:menu.left >= 0 && menu.right <= innerWidth, gap:Math.min(Math.abs(menu.top-button.bottom), Math.abs(button.top-menu.bottom)) }
    })
    check('窄窗口排序菜单键盘打开并跟随按钮宽度', Math.abs(narrowAlignment.dx) < 1 && Math.abs(narrowAlignment.dw) < 1 && narrowAlignment.within && narrowAlignment.gap <= 3, JSON.stringify(narrowAlignment))
    await page.keyboard.press('Escape')
    check('关闭排序菜单后键盘焦点返回按钮', await sortTrigger.evaluate(el => document.activeElement === el))
    await page.setViewportSize({ width: 1487, height: 1058 })
    await market.getByRole('button', { name: '从链接安装', exact: true }).click()
    const cancelledInstall = page.getByRole('dialog', { name: '从链接安装', exact: true })
    await cancelledInstall.getByRole('textbox', { name: '插件名称或链接' }).fill('pi-mcp-extension')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Enter')
    await cancelledInstall.waitFor({ state: 'detached' })
    check('安装弹窗 Esc 后快速 Enter 不会在退场动画中触发安装', await app.evaluate(() => globalThis.__market.calls.length === 0))
    await app.evaluate(() => { globalThis.__market.holdReadme = true })
    await market.locator('.market-card').filter({ hasText: 'pi-mcp-extension' }).click({ position: { x: 18, y: 70 } })
    await market.locator('.market-info').waitFor()
    check('整张卡片可打开详情，README读取不阻塞信息和安装按钮', await market.getByRole('button', { name: '安装', exact: true }).isEnabled() && await market.getByText('正在读取说明文档…', { exact: true }).isVisible())
    await app.evaluate(() => globalThis.__market.finishReadme())
    await market.locator('.market-readme pre').waitFor()
    await market.locator('.market-info .market-art img').evaluate(async (img) => { if (!img.complete) await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve }) })
    check('详情显示版本、作者、依赖、README 与单个安装按钮', await market.getByRole('heading', { name: 'README', exact: true }).count() === 1 && await market.getByRole('button', { name: '安装', exact: true }).count() === 1)
    check('详情去掉范围、命令、版本下拉和 manifest，保留配置说明', !/pi install|Installation|安装范围|manifest JSON/.test(await market.innerText()) && await market.locator('select').count() === 0 && (await market.locator('.market-readme pre').innerText()).trim() === '{ "mcpServers": {} }')
    check('README 相对链接指向发布版本，外部内容不注入 HTML', await market.getByRole('link', { name: '配置文档' }).getAttribute('href') === 'https://cdn.jsdelivr.net/npm/pi-mcp-extension@1.15.3/docs/config.md')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.market-content')).opacity === '1')
    await page.screenshot({ path: join(dirs.base, 'detail-dark.png') })
    const detailReturn = market.getByRole('button', { name: '所有插件', exact: true })
    await page.mouse.move(1, 1)
    await page.waitForTimeout(150)
    const backAlignment = await market.evaluate(el => ({ arrow:el.querySelector('.market-back svg').getBoundingClientRect().left, title:el.querySelector('h1').getBoundingClientRect().left }))
    check('详情返回箭头与插件标题左侧对齐', Math.abs(backAlignment.arrow - backAlignment.title) < 1, JSON.stringify(backAlignment))
    const returnBox = await detailReturn.boundingBox()
    check('详情返回按钮有完整的大点击区域', returnBox.height >= 44 && returnBox.width >= 120, JSON.stringify(returnBox))
    const returnRest = await detailReturn.evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }))
    await detailReturn.hover()
    await page.waitForTimeout(180)
    const returnHover = await detailReturn.evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopWidth, arrow: getComputedStyle(el.querySelector('svg')).transform }))
    check('返回按钮保持无边框无底色及原文字色，悬停箭头有位移反馈', returnHover.background === returnRest.background && returnHover.background === 'rgba(0, 0, 0, 0)' && returnHover.color === returnRest.color && returnHover.border === '0px' && returnHover.arrow !== 'none', JSON.stringify(returnHover))
    await page.mouse.move(returnBox.x + 6, returnBox.y + 6)
    await page.mouse.down()
    await page.waitForTimeout(80)
    check('返回按钮按下有缩放反馈并保持无底色', await detailReturn.evaluate((el) => el.matches(':active') && getComputedStyle(el).transform !== 'none' && getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)'))
    await page.screenshot({ path: join(dirs.base, 'return-pressed.png') })
    await page.mouse.up()
    const returnMotion = await market.locator('.market-content').evaluate((el) => ({ inert: el.inert, motion: getComputedStyle(el).animationName }))
    check('点击按钮边缘即可返回，详情先退出且阻止重复操作', returnMotion.inert && returnMotion.motion === 'market-detail-out', JSON.stringify(returnMotion))
    await page.keyboard.press('Escape')
    await page.keyboard.press('Enter')
    await market.locator('.market-card').first().waitFor()
    check('快速重复按键不关闭市场或触发安装，焦点回到原卡片', await market.isVisible() && await page.locator('#market-pi-mcp-extension').evaluate((el) => document.activeElement === el) && await app.evaluate(() => globalThis.__market.calls.length === 0))
    await page.setViewportSize({ width: 1487, height: 800 })
    await market.locator('.market-scroll').evaluate((el) => { el.scrollTop = 80 })
    await page.locator('#market-pi-mcp-extension').scrollIntoViewIfNeeded()
    const catalogScrollBefore = await market.locator('.market-scroll').evaluate((el) => el.scrollTop)
    await page.locator('#market-pi-mcp-extension').click()
    await market.locator('.market-info').waitFor()
    await market.getByRole('button', { name: '所有插件', exact: true }).click()
    await market.locator('.market-card').first().waitFor()
    const catalogScrollAfter = await market.locator('.market-scroll').evaluate((el) => el.scrollTop)
    check('详情返回后恢复目录滚动位置', catalogScrollBefore > 0 && catalogScrollAfter === catalogScrollBefore, JSON.stringify({ before: catalogScrollBefore, after: catalogScrollAfter }))
    await page.setViewportSize({ width: 1487, height: 1058 })
    await page.locator('#market-pi-mcp-extension').click()
    await market.locator('.market-info').waitFor()
    await market.getByRole('button', { name: '安装', exact: true }).click()
    await market.getByRole('button', { name: '正在安装', exact: true }).waitFor()
    check('点击直接安装，按钮禁用且有不编造百分比的动画', await market.locator('.market-install-button').isDisabled() && await market.getByRole('progressbar').getAttribute('aria-valuenow') === null && await market.locator('.market-install-button .market-spin').evaluate((el) => getComputedStyle(el).animationName) === 'market-spin')
    await page.screenshot({ path: join(dirs.base, 'installing.png') })
    await page.locator('.skills-page-entry').click()
    await page.locator('.skills-tabs').waitFor()
    await page.locator('.plugins-page-entry').click()
    await market.locator('.market-card').first().waitFor()
    const card = market.locator('.market-card').filter({ hasText: 'pi-mcp-extension' })
    check('切换一级页面后安装状态持续，阻止重复安装', await card.getByRole('button', { name: '正在安装', exact: true }).isDisabled())
    const calls = await app.evaluate(() => globalThis.__market.calls)
    check('一次点击只调用一次默认安装且绑定所选版本', calls.length === 1 && calls[0].source === 'npm:pi-mcp-extension@1.15.3' && calls[0].options.local === undefined, JSON.stringify(calls))
    await app.evaluate(() => globalThis.__market.finish(false))
    await card.getByRole('button', { name: '重试安装', exact: true }).waitFor()
    await card.getByRole('button', { name: '查看详情', exact: true }).click()
    await market.locator('.market-info').waitFor()
    check('安装失败显示错误与重试，不错误标记已安装', await market.getByRole('alert').innerText() === '下载失败，请检查网络。')
    await page.screenshot({ path: join(dirs.base, 'install-error.png') })
    await market.getByRole('button', { name: '重试安装', exact: true }).click()
    await market.getByRole('progressbar').waitFor()
    await app.evaluate(() => globalThis.__market.finish(true))
    await market.getByRole('button', { name: '已安装', exact: true }).waitFor()
    check('成功转为已安装且自动刷新已安装列表', await market.getByRole('button', { name: '已安装', exact: true }).isDisabled())
    await page.screenshot({ path: join(dirs.base, 'installed.png') })
    await page.keyboard.press('Escape')
    await market.getByRole('tab', { name: /已安装/ }).click()
    await market.locator('.market-installed article').waitFor()
    await app.evaluate(() => { globalThis.__market.latestVersion = '1.16.0' })
    await market.getByRole('button', { name: '更新', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.market-installed article span')?.textContent === '正在处理…')
    await app.evaluate(() => globalThis.__market.finish(true))
    await page.waitForFunction(() => document.querySelector('.market-installed article small')?.textContent === 'v1.16.0')
    check('固定版本更新重新读取最新版本并安装，实际列表版本改变', await app.evaluate(() => globalThis.__market.calls.at(-1).source === 'npm:pi-mcp-extension@1.16.0' && globalThis.__market.updateCalls === 0))
    await market.locator('.market-installed .market-card-title').click()
    await market.locator('.market-info').waitFor()

    await page.setViewportSize({ width: 860, height: 720 })
    await page.keyboard.press('Meta+Shift+l')
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    const geometry = await market.evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth, inner: el.querySelector('.market-info').getBoundingClientRect().right, right: el.getBoundingClientRect().right }))
    check('详情适配浅色窄窗口，没有横向溢出', geometry.scroll <= geometry.width + 1 && geometry.inner <= geometry.right, JSON.stringify(geometry))
    await page.screenshot({ path: join(dirs.base, 'detail-light-narrow.png') })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    check('减少动态效果时返回按钮仍有44px点击区域', (await market.getByRole('button', { name: '所有插件', exact: true }).boundingBox()).height >= 44)
    await page.keyboard.press('Escape')
    await market.locator('.market-installed article').waitFor()
    check('减少动态效果时直接返回且恢复焦点', await market.locator('[data-view="detail"] .market-back').count() === 0 && await market.locator('.market-content').evaluate((el) => !el.inert && getComputedStyle(el).animationName === 'none') && await market.locator('.market-installed .market-card-title').evaluate((el) => document.activeElement === el))
    await market.getByRole('tab', { name: /已安装/ }).click()
    await market.locator('.market-installed article').waitFor()
    await market.getByRole('button', { name: /卸载 pi-mcp-extension/ }).click()
    await page.getByRole('heading', { name: '卸载插件', exact: true }).waitFor()
    await page.locator('.modal').getByRole('button', { name: '卸载', exact: true }).focus()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Enter')
    await page.locator('.modal').waitFor({ state: 'detached' })
    check('取消卸载保留插件，Escape 不穿透关闭市场且焦点回到原按钮', await market.isVisible() && await market.locator('.market-installed article').count() === 1 && await market.getByRole('button', { name: /卸载 pi-mcp-extension/ }).evaluate((el) => el === document.activeElement))
    await app.evaluate(() => { const st = globalThis.__market; st.installed.push({ ...st.installed[0], scope: 'project' }) })
    await market.getByRole('button', { name: '刷新', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.market-installed article').length === 2)
    await market.getByRole('button', { name: /卸载 pi-mcp-extension/ }).click()
    await page.locator('.modal').getByRole('button', { name: '卸载', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.market-installed article').length === 1)
    await market.getByRole('tab', { name: '发现插件', exact: true }).click()
    check('卸载个人副本仍保留项目副本，目录以实际安装状态为准', await market.locator('.market-card').filter({ hasText: 'pi-mcp-extension' }).getByRole('button', { name: '已安装', exact: true }).isDisabled())
    await market.getByRole('tab', { name: /已安装/ }).click()
    await app.evaluate(() => { globalThis.__market.installed = [] })
    await market.getByRole('button', { name: '刷新', exact: true }).click()
    await market.getByText('还没有安装插件', { exact: true }).waitFor()
    check('外部安装状态变化后刷新列表，没有永久缓存假状态', true)
    await market.getByRole('tab', { name: '发现插件', exact: true }).click()
    await market.getByRole('textbox', { name: '搜索插件' }).fill('web')
    await market.getByRole('button', { name: '搜索', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.market-card').length === 1)
    check('搜索读取目录结果，排序与键盘焦点可用', await market.locator('.market-card-title').innerText() === 'pi-web-access')
    await market.getByRole('textbox', { name: '搜索插件' }).fill('missing')
    await market.getByRole('button', { name: '搜索', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.market-card').length === 0)
    check('空结果不显示虚假插件', true)
    await app.evaluate(() => { globalThis.__market.failCatalog = true })
    await market.getByRole('textbox', { name: '搜索插件' }).fill('')
    await market.getByRole('button', { name: '搜索', exact: true }).click()
    await market.getByText('网络暂时不可用', { exact: true }).waitFor()
    await app.evaluate(() => { globalThis.__market.failCatalog = false })
    await market.getByRole('button', { name: '重新加载', exact: true }).click()
    await market.locator('.market-card').first().waitFor()
    check('目录断网后可重试恢复，减少动态效果关闭页面动画', await market.locator('.market-content').evaluate((el) => getComputedStyle(el).animationName) === 'none')
    await market.getByRole('button', { name: '插件类型', exact: true }).click()
    await page.getByRole('menuitemradio', { name: '技能', exact: true }).click()
    await market.getByText('没有找到匹配的插件，换个关键词或类型试试。', { exact: true }).waitFor()
    check('类型按实际 manifest 过滤，不把扩展误当技能', await market.locator('.market-card').count() === 0)
    await market.getByRole('button', { name: '插件类型', exact: true }).click()
    await page.getByRole('menuitemradio', { name: '扩展', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.market-card').length === 4)
    await market.getByRole('button', { name: '插件类型', exact: true }).click()
    await page.getByRole('menuitemradio', { name: '全部类型', exact: true }).click()
    await app.evaluate(() => { const st = globalThis.__market; for (let i = 0; i < 13; i++) st.entries.push({ ...st.entries[0], name: `pi-extra-${i}`, source: `npm:pi-extra-${i}` }) })
    await market.getByRole('button', { name: '搜索', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.market-card').length === 12)
    await market.getByRole('button', { name: '下一页', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.market-card').length === 5)
    check('分页显示真实条目，上一页与下一页边界正确', await market.getByRole('button', { name: '下一页', exact: true }).isDisabled())
    await market.getByRole('button', { name: '上一页', exact: true }).click()
    await market.getByRole('button', { name: '从链接安装', exact: true }).click()
    const sourceDialog = page.getByRole('dialog', { name: '从链接安装', exact: true })
    await sourceDialog.getByRole('textbox', { name: '插件名称或链接' }).fill('https://www.npmjs.com/package/pi-mcp-extension')
    await sourceDialog.getByRole('button', { name: '安装', exact: true }).click()
    await sourceDialog.getByRole('button', { name: '正在安装', exact: true }).waitFor()
    check('从 npm 页面直接解析并安装绑定版本，不展示指令或范围', await app.evaluate(() => globalThis.__market.calls.at(-1).source === 'npm:pi-mcp-extension@1.16.0') && !/pi install|安装范围|检查并安装/.test(await sourceDialog.innerText()))
    await app.evaluate(() => globalThis.__market.finish(true))
    await sourceDialog.getByRole('button', { name: '已安装', exact: true }).waitFor()
    await sourceDialog.getByRole('button', { name: '完成', exact: true }).click()
    await sourceDialog.waitFor({ state: 'detached' })
    check('从链接安装完成有成功反馈且关闭恢复焦点', await market.getByRole('button', { name: '从链接安装', exact: true }).evaluate((el) => el === document.activeElement))
    await app.evaluate(() => { globalThis.__market.failDetailsFor = 'pi-missing' })
    await market.getByRole('button', { name: '从链接安装', exact: true }).click()
    const pendingDialog = page.getByRole('dialog', { name: '从链接安装', exact: true })
    await pendingDialog.getByRole('textbox', { name: '插件名称或链接' }).fill('pi-missing')
    await pendingDialog.getByRole('button', { name: '安装', exact: true }).click()
    await pendingDialog.getByRole('button', { name: '后台继续', exact: true }).click()
    await pendingDialog.waitFor({ state: 'detached' })
    await app.evaluate(() => globalThis.__market.finishDetails())
    const job = market.locator('.market-job').filter({ hasText: 'pi-missing' })
    await job.getByText(/读取来源失败/).waitFor()
    check('来源解析期间关闭弹窗，后续失败仍保留错误与重试入口', await job.getByRole('button', { name: '重试', exact: true }).isVisible())
    await app.evaluate(() => { globalThis.__market.failDetailsFor = null })
    await job.getByRole('button', { name: '重试', exact: true }).click()
    await job.getByText(/正在安装/).waitFor()
    await app.evaluate(() => globalThis.__market.finish(true))
    await job.waitFor({ state: 'detached' })
    check('后台失败可继续重试并回读安装结果', true)
    await market.getByRole('button', { name: '插件排序', exact: true }).click()
    await page.getByRole('menuitemradio', { name: '名称排序', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    check('筛选使用Pi菜单风格，Esc关闭菜单保留市场', await market.isVisible() && await market.locator('select').count() === 0)
    await market.getByRole('textbox', { name: '搜索插件' }).fill('pi-mcp-extension')
    await market.getByRole('button', { name: '搜索', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.market-card').length === 1)
    const englishSettings = await page.evaluate(() => window.pi.updateSettings({ language: 'en' }))
    await app.evaluate(({ BrowserWindow }, settings) => BrowserWindow.getAllWindows()[0].webContents.send('app:settings', settings), englishSettings)
    const englishMarket = page.getByRole('dialog', { name: 'Pi plugins', exact: true })
    await englishMarket.getByRole('button', { name: 'Plugin type', exact: true }).waitFor()
    check('市场按钮、筛选与计数跟随英文语言设置', await englishMarket.getByRole('heading', { name: 'All plugins', exact: true }).count() === 1 && (await englishMarket.innerText()).includes('1 loaded'))
    await englishMarket.locator('.market-card').click({ position: { x: 15, y: 55 } })
    await englishMarket.getByRole('heading', { name: 'Plugin information', exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('.market-readme-translation [role="status"]')?.textContent.includes('No author-provided README found'))
    await englishMarket.getByRole('button', { name: 'Translate to English with AI', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.market-readme')?.textContent.includes('Documentation') && !/[\p{Script=Han}]/u.test(document.querySelector('.market-readme').textContent))
    check('主动请求英文AI译文，代码与来源链接保持不变', (await englishMarket.locator('.market-readme pre').innerText()).trim() === '{ "mcpServers": {} }')
    await page.screenshot({ path: join(dirs.base, 'detail-english.png') })
    const chineseSettings = await page.evaluate(() => window.pi.updateSettings({ language: 'zh-CN' }))
    await app.evaluate(({ BrowserWindow }, settings) => BrowserWindow.getAllWindows()[0].webContents.send('app:settings', settings), chineseSettings)
    await market.getByRole('heading', { name: '插件信息', exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('.market-readme-translation [role="status"]')?.textContent.includes('未找到作者对应语言的文档'))
    await market.getByRole('button', { name: 'AI 翻译成中文', exact: true }).click()
    await market.getByRole('heading', { name: '功能', exact: true }).waitFor()
    check('切回中文后主动请求译文，原文锚点仍有效', await market.locator('#market-readme-features').count() === 1)
    await page.keyboard.press('Escape')
    await market.getByRole('tab', { name: /已安装/ }).click()
    await app.evaluate(() => { const st = globalThis.__market; const base = st.installed[0]; st.installed = Array.from({ length: 25 }, (_, index) => ({ ...base, name: `pi-installed-${index}`, source: `npm:pi-installed-${index}`, description: `插件中文简介 ${index}` })) })
    await market.getByRole('button', { name: '刷新', exact: true }).click()
    const installedEnglish = await page.evaluate(() => window.pi.updateSettings({ language: 'en' }))
    await app.evaluate(({ BrowserWindow }, settings) => BrowserWindow.getAllWindows()[0].webContents.send('app:settings', settings), installedEnglish)
    await page.waitForFunction(() => document.querySelectorAll('.market-installed p').length === 25 && Array.from(document.querySelectorAll('.market-installed p')).every((el) => el.textContent.startsWith('Documentation')))
    check('已安装页的简介同样随中英文设置翻译', await englishMarket.getByRole('button', { name: 'Update', exact: true }).count() === 25 && await app.evaluate(() => Math.max(...globalThis.__market.translationBatches) <= 24))
    check('市场交互没有 renderer 异常', errors.length === 0, errors.join('; '))
  } finally { await app.close() }
}

async function caseSandbox() {
  const dirs = freshDirs('sandbox')
  const project = join(dirs.base, 'sandbox-project')
  mkdirSync(project, { recursive: true })
  const envFile = join(project, 'sandbox-child-env.json')
  const outside = join(dirs.base, 'outside.txt')
  const inside = join(project, 'inside.txt')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({
    theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project,
    sandboxEnabled: true, sandboxMode: 'workspace-write', sandboxNetwork: 'off'
  }))
  const { app, page } = await launch(dirs, 'default', { MOCK_ENV_FILE: envFile, MOCK_SANDBOX_PROBE: '1' })
  try {
    const sandbox = await page.evaluate(() => window.pi.sandboxStatus())
    if (!sandbox.available) {
      check('当前环境没有 sandbox runtime，跳过文件系统隔离', true, sandbox.reason ?? '')
      return
    }
    await page.waitForTimeout(3000)
    const env = JSON.parse(readFileSync(envFile, 'utf8'))
    check('sandbox 子进程标记已传递', env.sandbox === '1', JSON.stringify(env))
    const audit = await page.evaluate(() => window.pi.sandboxAudit())
    check('沙箱启动会写入审计日志', audit.some((line) => line.includes('"type":"start"')), JSON.stringify(audit.slice(-2)))
    const result = await page.evaluate(([outsidePath, insidePath]) => window.pi.command({ type: 'bash', command: `echo allowed > ${insidePath}; echo blocked > ${outsidePath}` }), [outside, inside])
    check('sandbox 内命令可以启动', result.success === true, JSON.stringify(result))
    check('sandbox 允许写入项目目录', existsSync(inside))
    check('sandbox 阻止写入项目外路径', !existsSync(outside))
    const journal = join(dirs.base, '.pi', 'computer-use', 'browser-actions.sqlite')
    const unrelated = join(dirs.base, '.pi', 'computer-use', 'unrelated.txt')
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
    const journalModule = join(root, 'extensions/computer-use/src/browser-action-journal.ts')
    const journalCode = `import { BrowserActionJournal } from ${JSON.stringify(journalModule)}; const j = new BrowserActionJournal(process.argv[1]); j.claim('cdp'); if (!j.pending('cdp')) throw new Error('missing journal'); j.close()`
    const journalResult = await page.evaluate(command => window.pi.command({ type: 'bash', command }), `node --experimental-strip-types --input-type=module -e ${quote(journalCode)} ${quote(journal)}`)
    check('沙箱中真实 SQLite 操作记录可写入', existsSync(journal), JSON.stringify(journalResult.data ?? journalResult.error))
    await page.evaluate(command => window.pi.command({ type: 'bash', command }), `printf x > ${quote(unrelated)}`)
    check('记录目录中的其他文件仍受沙箱保护', !existsSync(unrelated))
    await page.evaluate(() => window.pi.command({ type: 'bash', command: 'curl -sS --max-time 2 https://example.com' }))
    await page.waitForTimeout(600)
    const networkAudit = await page.evaluate(() => window.pi.sandboxAudit())
    check('沙箱记录被拒绝的网络请求', networkAudit.some((line) => line.includes('"type":"network_denied"')), JSON.stringify(networkAudit.slice(-3)))
    const beforeNetworkPid = await page.evaluate(() => window.pi.command({ type: 'bash', command: 'printf %s "$PPID"' }))
    await page.evaluate(() => window.pi.updateSettings({ sandboxNetwork: 'model' }))
    const networkOn = await page.evaluate(() => window.pi.command({ type: 'bash', command: 'curl -sS -I --max-time 12 https://example.com' }))
    const afterNetworkPid = await page.evaluate(() => window.pi.command({ type: 'bash', command: 'printf %s "$PPID"' }))
    check('打开联网后当前会话无需逐站确认即可访问网站', /HTTP\/(?:1\.[01]|2) 200/.test(networkOn.data?.output ?? ''), JSON.stringify(networkOn))
    check('联网切换不重启当前会话', beforeNetworkPid.data?.output === afterNetworkPid.data?.output && Boolean(beforeNetworkPid.data?.output))
    await page.evaluate(() => window.pi.updateSettings({ sandboxNetwork: 'off' }))
    const networkOff = await page.evaluate(() => window.pi.command({ type: 'bash', command: 'curl -sS -I --max-time 5 https://example.com' }))
    check('再次关闭联网后阻止新的网络请求', !/HTTP\/(?:1\.[01]|2) 200/.test(networkOff.data?.output ?? ''), JSON.stringify(networkOff))
  } finally { await app.close() }
}

async function caseConversationPermissions() {
  const dirs = freshDirs('conversation-permissions')
  const project = join(dirs.base, 'project')
  mkdirSync(project)
  const transcript = seedSession(dirs.sessions, 'permissions', 'Saved conversation', 1, project)
  const settingsPath = join(dirs.userData, 'settings.json')
  writeFileSync(settingsPath, JSON.stringify({
    theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project,
    lastSessionPath: transcript, sandboxEnabled: false, sandboxNetwork: 'off', allowFullAccess: false
  }))
  const { app, page } = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1', MOCK_SANDBOX_PROBE: '1', MOCK_THINKING_MS: '8000' })
  try {
    const sandbox = await page.evaluate(() => window.pi.sandboxStatus())
    if (!sandbox.available) {
      console.log('Skipping OS-enforced permissions test:', sandbox.reason)
      return
    }
    const security = () => page.evaluate(async () => {
      const { data } = await window.pi.command({ type: 'get_state' })
      return { path: data.sessionFile, ...await window.pi.sessionSecurity(data.sessionFile) }
    })
    const chip = page.locator('.approval-mode-chip')
    const choose = async (name) => {
      await chip.click()
      await page.getByRole('menuitemradio', { name: new RegExp(name) }).click()
    }
    await chip.getByText('自动模式', { exact: true }).waitFor()
    const initial = await security()
    check('自动模式实际开启保护并应用离线偏好', initial.sandboxed && initial.network === 'off' && initial.files === 'workspace-write')
    await page.locator('.composer-input').fill('权限验证')
    await page.locator('.composer-input').press('Enter')
    await page.locator('.composer .send-button.stop').waitFor()
    await chip.click()
    check('运行中说明切换时机，选项禁用', await page.getByText('本轮结束后可切换权限。').isVisible() &&
      await page.getByRole('menuitemradio', { name: /完全访问/ }).isDisabled())
    await page.keyboard.press('Escape')
    await page.locator('.composer .send-button.stop').waitFor({ state: 'hidden' })
    const composer = page.locator('.composer-input')
    await composer.fill('切换时保留这个草稿')
    await choose('完全访问')
    const confirm = page.getByRole('dialog', { name: '为本次对话开启完全访问？' })
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    check('取消后保持原权限', (await security()).permission === 'review')
    await choose('完全访问')
    await confirm.getByRole('button', { name: '开启完全访问', exact: true }).click()
    await chip.getByText('完全访问', { exact: true }).waitFor()
    const full = await security()
    check('一次确认开启本次对话的完全访问', full.permission === 'full' && !full.sandboxed && full.network === 'unrestricted' && full.mode === 'never')
    check('切换后会话、历史和草稿仍在', full.path === transcript &&
      await page.locator('.user-message').getByText('Saved conversation question 0', { exact: true }).isVisible() &&
      await composer.inputValue() === '切换时保留这个草稿')
    await choose('手动确认')
    await chip.getByText('手动确认', { exact: true }).waitFor()
    const manual = await security()
    check('手动确认恢复文件保护与原离线偏好', manual.mode === 'all' && manual.sandboxed &&
      manual.files === 'workspace-write' && manual.network === 'off')

    await page.evaluate(() => window.pi.command({ type: 'bash', command: 'curl -sS --max-time 2 https://example.invalid' }))
    const block = page.locator('.conversation-network-block')
    await block.getByText('本次对话已关闭联网').waitFor()
    check('拒绝联网后指出具体地址', await block.getByText('example.invalid', { exact: true }).isVisible())
    check('联网提示出现时项目栏收起', await page.locator('.composer-project-slot').getAttribute('data-covered') === 'true')
    const pidBefore = await page.evaluate(() => window.pi.command({ type: 'bash', command: 'printf %s "$PPID"' }))
    await block.getByRole('button', { name: '开启本次联网', exact: true }).click()
    await block.waitFor({ state: 'hidden' })
    const pidAfter = await page.evaluate(() => window.pi.command({ type: 'bash', command: 'printf %s "$PPID"' }))
    check('联网授权不会重启当前 Pi 进程', pidBefore.data?.output === pidAfter.data?.output && Boolean(pidBefore.data?.output))
    const restored = await security()
    check('联网恢复后项目栏重新显示', await page.locator('.composer-project-slot').getAttribute('data-covered') === 'false')
    check('本次联网重试保留手动确认和同一会话', restored.network === 'model' && restored.sandboxed &&
      restored.permission === 'ask' && restored.path === transcript)
    check('联网和模式的全局偏好保持原值', JSON.parse(readFileSync(settingsPath, 'utf8')).sandboxNetwork === 'off' &&
      JSON.parse(readFileSync(settingsPath, 'utf8')).toolApprovalMode === 'dangerous')
    await composer.fill('正在处理时测试联网授权')
    await composer.press('Enter')
    await page.locator('.composer .send-button.stop').waitFor()
    await page.waitForFunction(async () => (await window.pi.command({ type: 'get_state' })).data?.isStreaming === true)
    await page.evaluate(() => window.pi.command({ type: 'bash', command: 'curl -sS --max-time 2 https://example.invalid' }))
    await block.getByText('Pi 请求访问网站').waitFor()
    check('任务运行中允许访问按钮可点击', await block.getByRole('button', { name: '允许访问', exact: true }).isEnabled())
    if (process.env.PI_NETWORK_SCREENSHOT) await page.screenshot({ path: process.env.PI_NETWORK_SCREENSHOT })
    await block.getByRole('button', { name: '允许访问', exact: true }).click()
    await block.waitFor({ state: 'hidden' })
    check('授权后任务仍在运行', await page.locator('.composer .send-button.stop').isVisible())
    await page.evaluate(() => window.pi.command({ type: 'bash', command: 'curl -sS --max-time 2 https://example.invalid' }))
    const auditAfter = await page.evaluate(() => window.pi.sandboxAudit())
    check('网站例外即时生效且不写入全局偏好', auditAfter.some(line => line.includes('network_allowed') && line.includes('example.invalid')) &&
      !JSON.parse(readFileSync(settingsPath, 'utf8')).sandboxAllowedDomains?.includes('example.invalid'))
    await page.locator('.composer .send-button.stop').waitFor({ state: 'hidden' })
    await composer.fill('')
    const projectRow = page.locator('.project-tree').filter({ hasText: 'project' })
    await projectRow.hover()
    await projectRow.getByRole('button', { name: '项目操作' }).click()
    await page.getByRole('menuitem', { name: '设为项目只读' }).click()
    await page.getByText('项目已设为只读', { exact: true }).waitFor()
    await projectRow.getByRole('button', { name: '在 project 中新建对话' }).click()
    await chip.getByText('自动模式', { exact: true }).waitFor()
    const readOnly = await security()
    check('新对话采用默认模式和项目只读权限', readOnly.permission === 'review' && readOnly.files === 'read-only' && readOnly.network === 'off')
    const file = join(project, 'blocked.txt')
    await page.evaluate((path) => window.pi.command({ type: 'bash', command: `echo blocked > '${path}'` }), file)
    check('只读项目实际禁止写入', !existsSync(file))
  } finally { await app.close() }
}

async function caseProxyEnv() {
  const dirs = freshDirs('proxy-env')
  const project = join(dirs.base, 'proxy-project')
  mkdirSync(project, { recursive: true })
  const envFile = join(dirs.base, 'proxy-child-env.json')
  let destination = ''
  const proxy = createServer()
  proxy.on('connect', (request, socket) => {
    destination = request.url
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
  })
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  const proxyAddress = `http://127.0.0.1:${proxy.address().port}`
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({
    theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project,
    networkProxy: proxyAddress, networkNoProxy: 'localhost,127.0.0.1'
  }))
  try {
    const rpcExecutable = join(project, 'rpc-executable.txt')
    const rpcPid = join(project, 'rpc-pid.txt')
    const { app, page } = await launch(dirs, 'default', { MOCK_ENV_FILE: envFile, MOCK_SANDBOX_PROBE: '1', MOCK_RPC_EXEC_PATH_FILE: rpcExecutable, MOCK_RPC_PID_FILE: rpcPid })
    try {
      const sandbox = await page.evaluate(() => window.pi.sandboxStatus())
      if (sandbox.available) {
        await page.evaluate(() => window.pi.command({ type: 'bash', command: 'curl -sS --max-time 3 https://opencode.ai' }))
        check('保护模式仍通过已配置的代理连接模型服务', destination === 'opencode.ai:443', destination)
      }
      await page.getByRole('button', { name: '自动模式', exact: true }).click()
      await page.getByRole('menuitemradio', { name: /完全访问/ }).click()
      await page.getByRole('button', { name: '开启完全访问' }).click()
      await page.getByRole('button', { name: '完全访问', exact: true }).waitFor()
      const env = JSON.parse(readFileSync(envFile, 'utf8'))
      check('完全访问仍使用已设置的代理', env.proxy === proxyAddress && env.noProxy === 'localhost,127.0.0.1')
      if (process.platform === 'darwin' && process.env.PI_E2E_APP) {
        const actual = readFileSync(rpcExecutable, 'utf8')
        check('完全访问的会话进程使用后台 Helper', /\/Frameworks\/Pi Desktop Helper\.app\/Contents\/MacOS\/Pi Desktop Helper$/.test(actual), actual)
        const pid = Number(readFileSync(rpcPid, 'utf8'))
        const policy = execFileSync('/usr/bin/swift', ['-e', `import AppKit; if let a = NSRunningApplication(processIdentifier: ${pid}) { print(a.activationPolicy.rawValue) } else { print("unregistered") }`], { encoding: 'utf8', timeout: 20000 }).trim()
        check('会话进程未注册为普通 Dock 应用', policy !== '0', `macOS activation policy: ${policy}`)
      }
    } finally { await app.close() }
  } finally { proxy.close() }
}

async function casePackageInspection() {
  const dirs = freshDirs('package-inspection')
  const plugin = join(dirs.base, 'inspect-plugin')
  mkdirSync(join(plugin, 'skills', 'local'), { recursive: true })
  mkdirSync(join(plugin, 'extensions'), { recursive: true })
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({
    name: 'inspect-plugin',
    version: '1.2.3',
    description: 'inspection fixture',
    main: 'index.js',
    scripts: { postinstall: 'node install.js' },
    pi: { extensions: ['index.js'] }
  }))
  writeFileSync(join(plugin, 'skills', 'local', 'SKILL.md'), '---\nname: local\n---\n')
  writeFileSync(join(plugin, 'extensions', 'index.js'), 'export default 1\n')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [dirs.base], lastWorkspace: dirs.base }))
  const { app, page } = await launch(dirs)
  try {
    const inspection = await page.evaluate((source) => window.pi.inspectPackage(source, source), plugin)
    check('检查本地插件识别为本地来源', inspection.kind === 'local', JSON.stringify(inspection))
    check('检查本地插件识别安装脚本', inspection.scripts.some((script) => script.name === 'postinstall'))
    check('包含扩展和技能时标记高风险', inspection.risk === 'high' && inspection.resources.extensions === 1 && inspection.resources.skills === 1, JSON.stringify(inspection.resources))
    await page.locator('.skills-page-entry').click()
    await page.waitForSelector('.skills-tab')
    await page.locator('.plugins-page-entry').click()
    await page.locator('.market-content').waitFor()
    check('市场直接安装流程不再暴露检查来源与确认安装步骤', await page.getByRole('button', { name: '检查来源', exact: true }).count() === 0 && await page.getByRole('button', { name: '确认安装', exact: true }).count() === 0)

  } finally { await app.close() }
}

async function caseWorkEditCommit() {
  const dirs = freshDirs('work-edit-commit')
  const project = join(dirs.base, 'edit-project')
  mkdirSync(project, { recursive: true })
  const file = join(project, 'edit-me.txt')
  writeFileSync(file, 'before\n')
  const doc = join(project, 'guide.md')
  writeFileSync(doc, '# Guide\n\nOriginal text\n')
  execFileSync('git', ['init'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: project })
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project, workPanelTabs: ['files', 'changes'] }))
  const { app, page } = await launch(dirs)
  try {
    await page.keyboard.press('Meta+Shift+E')
    await page.waitForSelector('.work-panel')
    await page.locator('.work-tab-button', { hasText: '文件' }).click()
    await page.locator('.tree-row', { hasText: 'guide.md' }).click()
    await page.locator('.file-preview-document h1').waitFor()
    check('Markdown 默认显示排版预览', await page.locator('.file-preview-document h1').innerText() === 'Guide')
    await page.locator('.file-preview:visible [aria-label="编辑"]').click()
    await page.locator('.file-preview-editor').fill('# Guide\n\nUpdated text\n')
    await page.getByRole('button', { name: '查看修改', exact: true }).click()
    check('编辑时可以对照修改', (await page.locator('.file-preview-diff .added').innerText()).includes('Updated text') && (await page.locator('.file-preview-diff .removed').innerText()).includes('Original text'))
    await page.getByRole('button', { name: '预览', exact: true }).click()
    check('编辑时可以预览修改', (await page.locator('.file-preview-document').innerText()).includes('Updated text'))
    await page.locator('.file-preview:visible [aria-label="保存"]').click()
    await page.waitForTimeout(200)
    check('预览修改后可以保存', readFileSync(doc, 'utf8').includes('Updated text'))
    await page.locator('.work-tab-button', { hasText: '文件' }).click()
    await page.locator('.tree-row', { hasText: 'edit-me.txt' }).click()
    await page.locator('.file-preview-editor').waitFor({ timeout: 5000 }).catch(() => undefined)
    await page.locator('.file-preview:visible [aria-label="编辑"]').click()
    await page.locator('.file-preview-editor').fill('after edit\nsecond line\n')
    await page.locator('.file-preview:visible [aria-label="保存"]').click()
    await page.waitForTimeout(500)
    check('工作面板可以编辑并保存文件', readFileSync(file, 'utf8') === 'after edit\nsecond line\n', readFileSync(file, 'utf8'))
    execFileSync('git', ['add', '--', 'guide.md'], { cwd: project })
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: project })
    await page.locator('.work-tab-button', { hasText: '变更' }).click()
    await page.getByRole('button', { name: '工作区', exact: true }).click()
    await page.locator('.work-file').first().waitFor({ timeout: 5000 })
    check('工作区模式列出 git 改动', await page.locator('.work-file').count() >= 1)
    await page.locator('.git-commit-bar input').fill('e2e edit commit')
    await page.getByRole('button', { name: '提交 1', exact: true }).click()
    await page.waitForTimeout(1000)
    const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: project, encoding: 'utf8' })
    check('可以从工作面板提交 git commit', log.includes('e2e edit commit'), log)
  } finally { await app.close() }
}

async function caseConversationGestures() {
  const dirs = freshDirs('conversation-gestures')
  const first = seedSession(dirs.sessions, 'gesture-a', '滑动会话甲')
  seedSession(dirs.sessions, 'gesture-b', '滑动会话乙')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({theme:'dark',language:'zh-CN',workspaces:[root],lastWorkspace:root,lastSessionPath:first}))
  const {app,page} = await launch(dirs,'default',{MOCK_LOAD_SESSION:'1',MOCK_LAZY_NEW_SESSION:'1',MOCK_STREAM_INTERVAL:'80',PI_DISABLE_NATIVE_SCROLL_PHASE:'1'})
  try {
    const input = page.locator('.composer-input')
    const phase = type => app.evaluate(({BrowserWindow}, value) => BrowserWindow.getAllWindows()[0].webContents.emit('input-event',{}, {type:value}), type)
    const swipe = async delta => {
      await phase('gestureScrollBegin')
      for (let i=0; i<4; i++) await page.locator('.chat-scroll').first().evaluate((el, x) => el.dispatchEvent(new WheelEvent('wheel',{deltaX:x,bubbles:true,cancelable:true})), delta/4)
      await phase('gestureScrollEnd')
    }
    await page.locator('.chat-inner').getByText('滑动会话甲 question 0',{exact:true}).waitFor()
    await input.fill('甲的草稿')
    await page.locator('.session-title').getByText('滑动会话乙',{exact:true}).click()
    await page.locator('.chat-inner').getByText('滑动会话乙 question 0',{exact:true}).waitFor()
    await input.fill('乙的草稿')
    await swipe(-160)
    await page.locator('.chat-inner').getByText('滑动会话甲 question 0',{exact:true}).waitFor()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value === '甲的草稿')
    check('对话间左滑返回并恢复原草稿', true)
    await swipe(160)
    await page.locator('.chat-inner').getByText('滑动会话乙 question 0',{exact:true}).waitFor()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value === '乙的草稿')
    check('对话间右滑前进并恢复原草稿', true)
    await page.locator('.new-session').click()
    await input.fill('尚未发送的新对话草稿')
    await page.waitForFunction(() => !document.querySelector('.send-button')?.disabled)
    await swipe(-160)
    await page.locator('.chat-inner').getByText('滑动会话乙 question 0',{exact:true}).waitFor()
    await swipe(160)
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value === '尚未发送的新对话草稿')
    check('未发送的新对话也可前进恢复草稿', true)
    await page.waitForFunction(() => !document.querySelector('.send-button')?.disabled)
    await swipe(-160)
    await page.locator('.chat-inner').getByText('滑动会话乙 question 0',{exact:true}).waitFor()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value === '乙的草稿')
    await input.fill('正在后台运行的任务')
    await input.press('Enter')
    await page.locator('.send-button.stop').waitFor()
    await swipe(-160)
    await page.locator('.chat-inner').getByText('滑动会话甲 question 0',{exact:true}).waitFor()
    const running = page.locator('.session-item').filter({ hasText: '滑动会话乙' }).locator('.session-running')
    await running.waitFor({ timeout: 3000 })
    check('手势切走正在运行的对话后任务继续执行', await running.isVisible())
    await swipe(160)
    await page.getByText('正在后台运行的任务',{exact:true}).first().waitFor()
    check('手势返回后恢复运行中的对话', true)
  } finally { await app.close() }
}

async function caseNativeScrollMonitor() {
  if (process.platform !== 'darwin') return
  const dirs = freshDirs('native-scroll-monitor')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root }))
  const { app } = await launch(dirs)
  try {
    const loaded = await app.evaluate(() => process.report.getReport().sharedObjects.some(path => path.endsWith('/scroll-phase.node')))
    check('macOS 应用成功加载手指松开事件监测', loaded)
  } finally { await app.close() }
}

async function caseSystemTheme() {
  const dirs = freshDirs('system-theme')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'system', workspaces: [root], lastWorkspace: root }))
  const { app, page } = await launch(dirs)
  try {
    await page.waitForSelector('.composer-bar')
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light' })
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5000 }).catch(async (error) => { throw Error(`light theme: ${JSON.stringify(await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, dark: matchMedia('(prefers-color-scheme: dark)').matches })))} ${error.message}`) })
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark' })
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 5000 }).catch(async (error) => { throw Error(`dark theme: ${JSON.stringify(await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, dark: matchMedia('(prefers-color-scheme: dark)').matches })))} ${error.message}`) })
    check('Electron 跟随系统外观实时切换', true)
  } finally {
    await app.close()
  }
}

async function caseComposerLayout() {
  const dirs = freshDirs('composer-ui')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs, 'default', { MOCK_TRANSCRIPT: '2', MOCK_TOOLS: '1' })
  await page.waitForSelector('.composer-bar')
  await page.waitForSelector('.chat-inner')
  await page.locator('.turn').first().waitFor()

  const input = page.locator('.composer-input')
  await page.waitForTimeout(250)
  const initialHeight = await input.evaluate((el) => el.getBoundingClientRect().height)
  await input.fill(Array(16).fill('这是一行较长的内容').join('\n'))
  await page.waitForTimeout(250)
  const expandedHeight = await input.evaluate((el) => el.getBoundingClientRect().height)
  await input.fill('')
  await page.waitForTimeout(250)
  const clearedHeight = await input.evaluate((el) => el.getBoundingClientRect().height)
  const minimumHeight = await input.evaluate((el) => parseFloat(getComputedStyle(el).minHeight))
  check('长内容清空后输入框恢复最小高度', expandedHeight > initialHeight + 40 && Math.abs(clearedHeight - minimumHeight) < 2, `${initialHeight} → ${expandedHeight} → ${clearedHeight}`)
  await input.fill(Array(12).fill('较长内容').join('\n'))
  await page.waitForTimeout(200)
  await input.fill('第一行\n第二行')
  await page.waitForTimeout(200)
  const shortHeight = await input.evaluate((el) => el.getBoundingClientRect().height)
  check('内容减少时输入框随之收缩', shortHeight > initialHeight && shortHeight < expandedHeight, String(shortHeight))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await input.fill('')
  check('减少动态效果时立即恢复高度', Math.abs(await input.evaluate((el) => el.getBoundingClientRect().height) - minimumHeight) < 2)
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  const layout = await page.evaluate(() => {
    const left = document.querySelector('.composer-left')
    const right = document.querySelector('.composer-right')
    const chips = [...right.querySelectorAll('.chip')]
    const modelLabel = right.querySelector('.model-chip .chip-label')?.textContent ?? ''
    return {
      plus: Boolean(left.querySelector('.add-attachment')),
      leftChips: left.querySelectorAll('.chip').length,
      model: chips.length,
      reasoning: right.querySelectorAll('.reasoning-button').length,
      ring: right.querySelectorAll('.context-ring').length,
      modelLabel
    }
  })
  check('左侧是 + 号附件按钮', layout.plus && layout.leftChips === 0, JSON.stringify(layout))
  const ringText = await page.locator('.context-ring').innerText()
  const ringTitle = await page.locator('.context-ring').getAttribute('title')
  check(
    '模型芯片合并思考程度文案，无独立推理条，始终显示上下文环百分比',
    layout.model >= 1 &&
      layout.reasoning === 0 &&
      layout.ring === 1 &&
      /^\d+%$/.test(ringText.trim()) &&
      /上下文\s+\d+(?:\.\d+)?%/.test(ringTitle ?? '') &&
      /tokens/.test(ringTitle ?? '') &&
      /·\s*(关闭|最低|低|中|高|极高|最高)/.test(layout.modelLabel),
    JSON.stringify({ ...layout, ringText, ringTitle })
  )
  await page.locator('.context-ring').click()
  const contextUsage = page.getByRole('dialog', { name: '上下文用量', exact: true })
  await contextUsage.waitFor()
  check('上下文按钮展开用量浮层，旧运行时保留总量和缺失分类说明',
    (await contextUsage.getByRole('progressbar').count()) === 1 &&
      (await contextUsage.getByText('分类明细暂不可用，总用量仍可参考。', { exact: true }).count()) === 1 &&
      (await contextUsage.getByRole('button', { name: '压缩上下文', exact: true }).count()) === 1)
  await page.keyboard.press('Escape')
  await page.locator('.context-usage-panel').waitFor({ state: 'detached' })
  await page.locator('.model-chip').click()
  await page.waitForSelector('.thinking-effort')
  const effortLabels = await page.locator('.thinking-slider-labels button').allTextContents()
  check(
    '模型菜单按当前模型报告的思考程度展示',
    effortLabels.length >= 3 && effortLabels.includes('高') && effortLabels.includes('最高') && effortLabels.includes('关闭'),
    JSON.stringify(effortLabels)
  )
  const effortSlider = page.getByRole('slider', { name: '思考程度' })
  await effortSlider.press('ArrowRight')
  await page.waitForFunction(() => /·\s*高/.test(document.querySelector('.model-chip .chip-label')?.textContent ?? ''))
  check('切换思考程度更新芯片文案', /·\s*高/.test(await page.locator('.model-chip .chip-label').innerText()))
  await page.keyboard.press('Escape')

  const column = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect()
    const chat = rect('.chat-inner')
    const composer = rect('.composer-wrap')
    return chat && composer
      ? {
          left: Math.round(chat.left) - Math.round(composer.left),
          right: Math.round(chat.right) - Math.round(composer.right),
          width: Math.round(chat.width)
        }
      : null
  })
  check(
    '对话列与输入框对齐且加宽到 900',
    Boolean(column && Math.abs(column.left) <= 1 && Math.abs(column.right) <= 1 && column.width === 900),
    JSON.stringify(column)
  )

  await page.locator('.add-attachment').click()
  await page.waitForSelector('.composer-add-menu')
  const addItems = await page.locator('.composer-add-menu .menu-item').allTextContents()
  check(
    '+ 菜单最多四项且含附件/文件夹/技能/连接器',
    addItems.length === 4 &&
      addItems.some((text) => text.includes('添加文件或图片')) &&
      addItems.some((text) => text.includes('选择文件夹')) &&
      addItems.some((text) => text.includes('技能')) &&
      addItems.some((text) => text.includes('连接器')),
    JSON.stringify(addItems)
  )
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  const focusedAdd = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
  check('+ 菜单键盘可导航', focusedAdd.includes('技能') || focusedAdd.includes('选择文件夹'), focusedAdd)
  await page.keyboard.press('Escape')
  await page.waitForSelector('.composer-add-menu', { state: 'detached' })

  const chooser = page.waitForEvent('filechooser')
  await page.locator('.add-attachment').click()
  await page.locator('.composer-add-menu .menu-item').filter({ hasText: '添加文件或图片' }).click()
  const file = await chooser
  await file.setFiles([])
  check('+ 号打开附件选择', Boolean(file), '')

  // Work panel resizing changes the composer width independently of the window.
  for (const width of [430, 300]) {
    await page.locator('.composer').evaluate((element, value) => { element.style.width = `${value}px` }, width)
    await page.waitForTimeout(300)
    const compact = await page.evaluate(() => {
      const controls = [...document.querySelectorAll('.composer-left > .popover-root, .composer-right > .popover-root, .context-usage-root, .send-button')]
        .map((element) => element.getBoundingClientRect())
      const bar = document.querySelector('.composer-bar').getBoundingClientRect()
      return {
        fits: controls.every((rect, i) => rect.left >= bar.left - 1 && rect.right <= bar.right + 1 && (!i || rect.left >= controls[i - 1].right - 1)),
        permissionWidth: document.querySelector('.approval-mode-label').getBoundingClientRect().width,
        modelWidth: document.querySelector('.model-chip .chip-label').getBoundingClientRect().width,
        modelIcon: getComputedStyle(document.querySelector('.model-compact-icon')).display,
        modelName: document.querySelector('.model-chip').getAttribute('aria-label')
      }
    })
    check(`输入框 ${width}px 时控件不重叠且保留可访问名称`, compact.fits && compact.permissionWidth < 1 &&
      (width > 340 ? compact.modelWidth > 0 : compact.modelWidth < 1 && compact.modelIcon !== 'none') && Boolean(compact.modelName), JSON.stringify(compact))
    await page.locator('.model-chip').click()
    await page.waitForSelector('.thinking-effort')
    await page.keyboard.press('Escape')
    if (width === 300) await page.screenshot({ path: 'output/composer-compact.png' })
  }
  await page.locator('.composer').evaluate((element) => { element.style.width = '' })
  await app.close()
}

async function caseModelProviderMenu() {
  const dirs = freshDirs('model-providers')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({
    theme: 'dark', language: 'zh-CN', workspaces: [root], lastWorkspace: root
  }))
  writeFileSync(join(dirs.agent, 'models.json'), JSON.stringify({
    providers: { mock: { name: 'OpenCode Go (Responses)' }, 'volcengine-ark': { name: '火山引擎方舟' } }
  }))
  const { app, page } = await launch(dirs, 'multi-providers')
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const trigger = page.locator('.model-provider-trigger')
    const providers = page.locator('.model-provider-menu')
    const slider = page.getByRole('slider', { name: '思考程度' })
    const current = () => page.evaluate(async () => (await window.pi.command({ type: 'get_state' })).data)
    await openModelMenu(page)
    await trigger.getByText('OpenCode Go (Responses)', { exact: true }).waitFor()
    check('主菜单默认只展示当前供应商的模型', await page.getByRole('option').count() === 2 && !await providers.count())
    const visionModel = page.getByRole('option', { name: /Mock Fast/ })
    const imageModel = page.getByRole('option', { name: /Mock Deep/ })
    check('识图用视觉文字，只有声明图片输出的模型显示生图图标',
      await visionModel.getByText('视觉', { exact: true }).isVisible() &&
      !await visionModel.getByRole('img', { name: '支持生成图片' }).count() &&
      await imageModel.getByRole('img', { name: '支持生成图片' }).isVisible() &&
      !await imageModel.getByText('视觉', { exact: true }).count())

    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const motion = await page.locator('.thinking-slider-track').evaluate(async (element) => {
      const read = () => ({
        thumb: parseFloat(getComputedStyle(element, '::after').left),
        fill: parseFloat(getComputedStyle(element, '::before').width)
      })
      const start = read()
      const frames = []
      const stop = performance.now() + 350
      element.parentElement.querySelector('.thinking-slider-labels button:nth-child(2)').click()
      await new Promise((resolve) => {
        const frame = (time) => {
          frames.push(read())
          if (time >= stop) resolve()
          else requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      })
      const end = frames.at(-1)
      return {
        animates: frames.some(({ thumb, fill }) => thumb > end.thumb + 1 && thumb < start.thumb - 1 &&
          Math.abs(thumb - fill) < 1),
        start, end
      }
    })
    check('切换思考档位时滑块和进度同步滑动', motion.animates && motion.end.thumb < motion.start.thumb, JSON.stringify(motion))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
    const reducedTransitions = await page.locator('.thinking-slider-track').evaluate((element) =>
      ['::before', '::after'].map((part) => getComputedStyle(element, part).transitionProperty))
    check('减少动态效果时立即切换档位', reducedTransitions.every((property) => property === 'none'), JSON.stringify(reducedTransitions))
    await page.locator('.thinking-slider-labels').getByRole('button', { name: '中', exact: true }).click()
    await page.waitForFunction(async () => (await window.pi.command({ type: 'get_state' })).data?.thinkingLevel === 'medium')
    const tickAlignment = await page.locator('.thinking-slider-track').evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const thumbSize = parseFloat(getComputedStyle(element).getPropertyValue('--thinking-thumb'))
      const labels = [...element.parentElement.querySelectorAll('.thinking-slider-labels button')]
      return labels.slice(1, -1).map((label, index) => {
        const rect = label.getBoundingClientRect()
        return Math.abs(rect.left + rect.width / 2 - (bounds.left + thumbSize / 2 + (bounds.width - thumbSize) * (index + 1) / (labels.length - 1)))
      })
    })
    check('思考程度文字与对应滑块位置对齐', tickAlignment.length > 0 && tickAlignment.every(offset => offset < 1), JSON.stringify(tickAlignment))
    const thumb = await page.locator('.thinking-slider-track').evaluate((el) => ({ circle: parseFloat(getComputedStyle(el, '::after').height), track: el.getBoundingClientRect().height }))
    check('圆点比轨道稍大并覆盖上下边缘', thumb.circle === 24 && thumb.track === 20, JSON.stringify(thumb))
    const track = await slider.boundingBox()
    await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2)
    await page.mouse.down()
    await page.mouse.move(track.x + track.width * 0.75, track.y + track.height / 2, { steps: 4 })
    await page.mouse.up()
    await page.waitForFunction(() => document.querySelector('.thinking-slider')?.getAttribute('aria-valuetext') === '高')
    check('拖动滑杆提交离散档位', (await current()).thinkingLevel === 'high')
    await trigger.click()
    const isLeft = await providers.evaluate((element) => {
      const menu = element.closest('.popover').getBoundingClientRect()
      const bounds = element.getBoundingClientRect()
      return bounds.left >= 7 && bounds.right < menu.left && Math.abs(bounds.top - menu.top) < 2
    })
    check('供应商菜单对齐主菜单顶边并向左打开', isLeft)
    await page.screenshot({ path: join(dirs.base, 'model-providers.png') })
    await page.keyboard.press('Escape')
    check('Esc 先关闭供应商菜单，焦点回到供应商按钮', !await providers.count() && await trigger.evaluate((element) => element === document.activeElement))
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.thinking-slider')?.getAttribute('aria-valuetext') === '关闭')
    check('支持关闭的模型可关闭思考，Pi 实际收到 off', (await current()).thinkingLevel === 'off')

    await trigger.click()
    await providers.getByRole('button', { name: '火山引擎方舟' }).click()
    check('浏览供应商不立即改变会话模型', (await current()).model.provider === 'mock' && await page.getByRole('option').count() === 1)
    await page.getByRole('option', { name: /Mock Fast/ }).click()
    await page.locator('.popover').waitFor({ state: 'hidden' })
    await openModelMenu(page)
    await trigger.getByText('火山引擎方舟', { exact: true }).waitFor()
    check('选择同名模型会切换到正确供应商', (await current()).model.provider === 'volcengine-ark')
    await slider.waitFor()
    check('不支持关闭的模型没有关闭档位', (await current()).thinkingLevel !== 'off' &&
      !await page.locator('.thinking-slider-labels').getByText('关闭', { exact: true }).count())
    await page.locator('.menu-search input').fill('Mock Fast')
    check('全局搜索会标明同名模型的供应商', await page.getByRole('option', { name: /Mock Fast/ }).count() === 2 &&
      await page.locator('.model-option-source').getByText('OpenCode Go (Responses)', { exact: true }).count() === 1 &&
      await page.locator('.model-option-source').getByText('火山引擎方舟', { exact: true }).count() === 1)
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setMinimumSize(600, 560)
      window.setSize(600, 620)
    })
    await page.waitForFunction(() => innerWidth <= 600)
    await trigger.click()
    check('侧边空间不足时，供应商列表在主菜单内部打开', !await providers.evaluate((el) => el.classList.contains('side')) &&
      !await page.getByRole('option').count())
    await providers.getByRole('button', { name: '管理模型' }).click()
    await page.locator('.settings-page').waitFor()
    check('管理模型打开模型设置', await page.getByRole('heading', { name: '模型', exact: true }).isVisible())
  } finally {
    await app.close()
  }
}

async function caseNewChatLayout() {
  const dirs = freshDirs('new-chat-layout')
  const project = join(dirs.base, 'project')
  mkdirSync(project)
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({
    language: 'zh-CN', theme: 'dark', workspaces: [project], lastWorkspace: project
  }))
  const { app, page } = await launch(dirs, 'catalog-huge')
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator('.main.new-chat .empty-session').waitFor()
    await page.locator('.approval-mode-chip').getByText('自动模式', { exact: true }).waitFor()

    const offset = await page.evaluate(() => {
      const main = document.querySelector('.main.new-chat')
      const spaceAbove = parseFloat(getComputedStyle(main.querySelector('.conversation-region')).marginTop)
      const spaceBelow = main.getBoundingClientRect().bottom - main.querySelector('.composer-wrap').getBoundingClientRect().bottom
      return Math.round((spaceBelow - spaceAbove) / 2)
    })
    check('新对话标题和输入框整体略高于居中位置', offset >= 12 && offset <= 32, `${offset}px`)

    const menu = page.locator('.popover')
    const menuPosition = () => menu.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const input = document.querySelector('.composer').getBoundingClientRect()
      return {
        top: Math.round(bounds.top), bottom: Math.round(bounds.bottom), inputTop: Math.round(input.top),
        fits: bounds.top >= 7 && bounds.bottom <= input.top - 7 && bounds.left >= 7 && bounds.right <= innerWidth - 7
      }
    })
    for (const [label, selector] of [
      ['附件', '.add-attachment'],
      ['权限', '.approval-mode-chip'],
      ['模型', '.model-chip']
    ]) {
      await page.locator(selector).click()
      await menu.waitFor()
      const position = await menuPosition()
      check(`${label}菜单位于输入框上方`, position.fits, JSON.stringify(position))
      if (label === '权限') {
        check('权限菜单保留三种模式并移除设置入口', await menu.getByRole('menuitemradio').count() === 3 &&
          await menu.getByText('权限设置', { exact: true }).count() === 0)
        await page.screenshot({ path: join(dirs.base, 'permission-menu.png') })
      }
      if (label !== '模型') {
        await page.keyboard.press('Escape')
        await menu.waitFor({ state: 'detached' })
      }
    }

    const modelLayout = () => menu.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const search = element.querySelector('.menu-search').getBoundingClientRect()
      const list = element.querySelector('.menu-list')
      const footer = element.querySelector('.thinking-effort').getBoundingClientRect()
      return {
        height: Math.round(bounds.height),
        listHeight: list.clientHeight,
        scrolls: list.scrollHeight > list.clientHeight + 40,
        controlsFit: search.top >= bounds.top && footer.bottom <= bounds.bottom + 1,
        outerScrolls: element.scrollHeight > element.clientHeight + 1
      }
    })
    const tall = await modelLayout()
    check('模型菜单按参考高度展开，能同时看到多项和思考程度', tall.height >= 420 && tall.listHeight >= 280 &&
      tall.controlsFit && tall.scrolls && !tall.outerScrolls, JSON.stringify(tall))
    await page.screenshot({ path: join(dirs.base, 'model-menu.png') })

    const height = await page.evaluate(() => innerHeight)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(860, 560))
    await page.waitForFunction((original) => innerHeight < original, height)
    await page.waitForFunction(() => {
      const input = document.querySelector('.composer').getBoundingClientRect()
      const bounds = document.querySelector('.popover').getBoundingClientRect()
      return Math.abs(input.top - bounds.bottom - 8) < 1
    })
    const position = await menuPosition()
    check('缩小窗口后模型菜单仍在上方并留在屏幕内', position.fits, JSON.stringify(position))
    const short = await modelLayout()
    check('缩小窗口时只收缩列表，搜索和思考程度都可见', short.listHeight < tall.listHeight &&
      short.controlsFit && short.scrolls && !short.outerScrolls, JSON.stringify(short))
    await page.screenshot({ path: join(dirs.base, 'model-menu-compact.png') })
  } finally { await app.close() }
}

async function caseSlashMenu() {
  const dirs = freshDirs('slash-menu')
  const session = seedSession(dirs.sessions, 'slash-menu-session', '斜杠菜单示例')
  writeFileSync(join(dirs.agent, 'mcp.json'), JSON.stringify({ mcpServers: { example: { url: 'https://example.com/mcp', desktopDisplayName: '测试连接器' }, paused: { command: 'example', enabled: false } } }))
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [root], lastWorkspace: root, lastSessionPath: session })
  )
  const commands = Array.from({ length: 18 }, (_, index) => ({
    name: `skill:report-${index}`,
    source: 'skill',
    description: index === 16 ? '汇总每周运营数据' : '整理项目资料，并提取主要结论与待办事项',
    sourceInfo: index === 16
      ? { scope: 'project', origin: 'package', source: 'npm:@example/reports' }
      : { scope: 'user', origin: 'top-level' }
  }))
  commands.push({ name: 'review-report', source: 'extension', description: '审阅报告' })
  commands.push({ name: 'summary-template', source: 'prompt', description: '复用摘要模板' })
  const { app, page } = await launch(dirs, 'default', {
    MOCK_LOAD_SESSION: '1',
    MOCK_COMMANDS_JSON: JSON.stringify(commands)
  })
  try {
    const input = page.locator('.composer-input')
    const menu = page.getByRole('listbox', { name: '斜杠命令' })
    const active = menu.locator('.command-item.active')
    const open = async (query) => {
      await input.fill(query)
      await menu.waitFor()
    }
    await open('/')
    await menu.getByRole('option', { name: /summary-template/ }).waitFor({ state: 'attached' })
    check('三类入口与全部运行时条目进入同一个列表',
      JSON.stringify(await menu.locator('.menu-group-label').allTextContents()) ===
        JSON.stringify(['会话操作', '技能', '扩展命令与提示词']) &&
      await menu.getByRole('option').count() >= 22)
    const menuLayout = () => menu.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const composer = document.querySelector('.composer').getBoundingClientRect()
      const anchor = document.querySelector('.composer-wrap').getBoundingClientRect()
      return {
        aligned: Math.abs(rect.width - composer.width) < 1 && Math.abs(rect.left - composer.left) < 1,
        above: rect.bottom <= anchor.top && rect.top >= 0,
        scrolls: element.scrollHeight > element.clientHeight && element.scrollWidth <= element.clientWidth + 1,
        transition: getComputedStyle(element).transitionDuration
      }
    })
    const wide = await menuLayout()
    check('斜杠菜单与输入框等宽，向上展示且列表内纵向滚动', wide.aligned && wide.above && wide.scrolls, JSON.stringify(wide))
    check('压缩入口和上下文圆环显示同一百分比',
      (await menu.getByRole('option', { name: /^压缩上下文/ }).innerText()).includes(await page.locator('.context-ring').innerText()))
    await page.screenshot({ path: join(dirs.base, 'slash-menu-dark.png'), animations: 'disabled' })

    const beforeNav = await active.innerText()
    await input.press('ArrowDown')
    const afterDown = await active.innerText()
    await input.press('ArrowUp')
    check('键盘可切换当前选中项，焦点留在输入框',
      afterDown !== beforeNav && await active.innerText() === beforeNav &&
      await input.getAttribute('aria-activedescendant') === await active.getAttribute('id'))

    await open('/运营数据')
    check('支持中文用途搜索并显示包来源', await active.getByText('@example/reports', { exact: true }).isVisible() &&
      await active.locator('.slash-match').innerText() === '运营数据')
    await input.press('Enter')
    check('选择技能后输入框显示技能标签', await page.locator('.composer-skill-chip').getByText('/report-16', { exact: true }).isVisible() && await input.inputValue() === '')
    await input.fill('整理运营数据')
    await input.press('Backspace')
    check('删除任务中的文字不会移除所选技能', await input.inputValue() === '整理运营数' && await page.locator('.composer-skill-chip').getByText('/report-16', { exact: true }).isVisible())
    await input.type('据')
    const inlineLayout = () => page.evaluate(() => {
      const chip = document.querySelector('.composer-skill-chip').getBoundingClientRect()
      const input = document.querySelector('.composer-input').getBoundingClientRect()
      const box = document.querySelector('.composer').getBoundingClientRect()
      return { sameRow: Math.abs(chip.top - input.top) < 8, fits: chip.left >= box.left && input.right <= box.right && chip.right <= input.left + 1, background: getComputedStyle(document.querySelector('.composer-skill-chip')).backgroundColor }
    })
    const inlineWide = await inlineLayout()
    check('技能命令与输入文字同行且没有背景框', inlineWide.sameRow && inlineWide.fits && inlineWide.background === 'rgba(0, 0, 0, 0)', JSON.stringify(inlineWide))
    const originalSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
    const originalMinimum = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize())
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(600, 560); win.setSize(700, 720) })
    await page.waitForFunction(() => window.innerWidth <= 700)
    const inlineNarrow = await inlineLayout()
    check('窄窗口中技能命令不遮挡输入', inlineNarrow.sameRow && inlineNarrow.fits, JSON.stringify(inlineNarrow))
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), originalSize)
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setMinimumSize(...size), originalMinimum)
    await page.waitForFunction(width => window.innerWidth >= width - 2, originalSize[0])
    if (process.env.PI_SLASH_SELECTION_SCREENSHOT) await page.screenshot({ path: process.env.PI_SLASH_SELECTION_SCREENSHOT, animations: 'disabled' })
    await page.getByRole('textbox', { name: /编辑命令显示名称/ }).fill('repor-16')
    check('修改显示名称后标明实际调用', await page.locator('.composer-command-original').getByText('实际调用 /report-16', { exact: true }).isVisible())
    if (process.env.PI_SLASH_EDITED_SCREENSHOT) await page.screenshot({ path: process.env.PI_SLASH_EDITED_SCREENSHOT, animations: 'disabled' })
    await page.waitForFunction(() => Object.keys(localStorage).filter(key => key.startsWith('pi.composer.commandDisplay.')).some(key => {
      try { const value = JSON.parse(localStorage.getItem(key)); return value?.name === 'skill:report-16' && value.label === 'repor-16' } catch { return false }
    }))
    check('编辑后的名称与实际调用标识一起保存在草稿中', true)
    await page.reload()
    try { await page.locator('.composer-skill-chip').getByText('/repor-16', { exact: true }).waitFor({ timeout: 10000 }) }
    catch (error) {
      console.log('draft restore diagnostic', await page.evaluate(() => ({ chip: document.querySelector('.composer-skill-chip')?.textContent, input: document.querySelector('.composer-input')?.value, drafts: Object.keys(localStorage).filter(key => key.startsWith('pi.composer.draft.') || key.startsWith('pi.composer.commandDisplay.')).map(key => [key, localStorage.getItem(key)]) })))
      throw error
    }
    check('重新打开后恢复显示名称、实际技能和任务草稿', await page.locator('.composer-command-original').getByText('实际调用 /report-16', { exact: true }).isVisible() && await input.inputValue() === '整理运营数据')
    await input.press('Enter')
    await page.locator('.user-message').getByText('已选择技能 · report-16', { exact: true }).waitFor()
    check('发送时保留技能命令并在对话里显示选择', await page.locator('.user-message').getByText('整理运营数据', { exact: true }).isVisible())
    await page.locator('.composer .send-button.stop').waitFor({ state: 'hidden' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {
      type: 'message_start', message: { role: 'user', timestamp: Date.now(), content: [{ type: 'text', text: '<skill name="report-16" location="/tmp/report-16/SKILL.md">\nfixture skill instructions\n</skill>\n\n真实任务' }] }
    }))
    await page.getByText('已加载技能 · report-16', { exact: true }).waitFor()
    check('只有收到 Pi 展开的技能内容才显示已加载，隐藏内部指令', await page.getByText('真实任务', { exact: true }).isVisible() && await page.getByText('fixture skill instructions', { exact: true }).count() === 0)
    await open('/review-report')
    await input.press('Enter')
    check('扩展命令也显示选中标签', await page.locator('.composer-skill-chip').getByText('/review-report', { exact: true }).isVisible() && await input.inputValue() === '')
    await input.fill('审核这份材料')
    await page.getByRole('button', { name: '移除已选命令' }).click()
    check('移除命令保留用户输入', await input.inputValue() === '审核这份材料')

    for (const removed of ['schedule', 'rename', 'usage', 'thinking']) {
      await open(`/${removed}`)
      check(`斜杠菜单不再显示 ${removed}`, await menu.getByRole('option').count() === 0)
    }

    await open('/mcp')
    await input.press('Enter')
    const connections = page.getByRole('region', { name: '连接器' })
    await connections.waitFor()
    await connections.getByText('加载中…').waitFor({ state: 'hidden' })
    check('连接器在原菜单内展示并保留输入焦点', await connections.isVisible() && await input.inputValue() === '/' && await input.evaluate((element) => document.activeElement === element))
    check('连接器展示配置名称与真实已知状态', await connections.getByText('测试连接器').isVisible() && await connections.getByText('已安装').first().isVisible() && await connections.getByText('已停用').isVisible())
    await page.screenshot({ path: join(dirs.base, 'slash-connectors.png'), animations: 'disabled' })
    await input.fill('/测试')
    check('连接器可在输入框中筛选', await connections.getByText('测试连接器').isVisible() && await connections.getByText('paused').count() === 0)
    await input.press('Escape')
    check('Esc 从连接器返回斜杠菜单', await menu.isVisible() && await input.inputValue() === '/')

    await open('/fork')
    await input.press('Enter')
    const fork = page.getByRole('dialog', { name: '从历史提示分支' })
    await fork.getByText('first prompt', { exact: true }).waitFor()
    check('创建对话分支打开真实的历史提示选择', await fork.isVisible())
    await fork.getByRole('button', { name: '取消', exact: true }).click()

    await open('/compact')
    await input.press('Enter')
    await page.getByText('上下文已压缩', { exact: true }).waitFor()
    check('压缩直接执行 RPC 并反馈成功', await input.inputValue() === '')

    await open('/zzzz-no-match')
    check('无匹配时有说明', await menu.getByText('没有匹配的命令').isVisible())
    await input.press('Escape')
    await menu.waitFor({ state: 'hidden' })
    check('Esc 关闭并保留查询', await input.inputValue() === '/zzzz-no-match')
    await input.press('ArrowDown')
    await menu.waitFor()
    await page.mouse.click(16, 70)
    await menu.waitFor({ state: 'hidden' })
    check('再次打开后点击外面，草稿仍在', await input.inputValue() === '/zzzz-no-match')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    const desktopWidth = await page.evaluate(() => innerWidth)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 550))
    await page.waitForFunction((width) => innerWidth < width, desktopWidth)
    await page.keyboard.press('Meta+Shift+L')
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    await open('/')
    await page.waitForFunction(() => {
      const menu = document.querySelector('.slash-menu:not([hidden])')?.getBoundingClientRect()
      const composer = document.querySelector('.composer').getBoundingClientRect()
      return menu && Math.abs(menu.width - composer.width) < 1 && Math.abs(menu.left - composer.left) < 1
    })
    const narrow = await menuLayout()
    check('浅色窄窗口仍对齐且尊重减少动态效果',
      narrow.aligned && narrow.above && narrow.scrolls &&
      narrow.transition.split(',').every((duration) => Number.parseFloat(duration) < 0.01), JSON.stringify(narrow))
    await page.screenshot({ path: join(dirs.base, 'slash-menu-narrow.png'), animations: 'disabled' })
    await input.fill('/Users/example/Documents')
    await menu.waitFor({ state: 'hidden' })
    check('绝对文件路径不会误打开命令菜单', await input.inputValue() === '/Users/example/Documents')
  } finally {
    await app.close()
  }
}

async function caseDraftNavigation() {
  const dirs = freshDirs('draft-navigation')
  const session = seedSession(dirs.sessions, 'draft-origin', '草稿原会话')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [root], lastWorkspace: root, lastSessionPath: session })
  )
  const env = { MOCK_LOAD_SESSION: '1', MOCK_LAZY_NEW_SESSION: '1' }
  let { app, page } = await launch(dirs, 'default', env)
  try {
    const input = page.locator('.composer-input')
    const origin = page.locator('.session-title').getByText('草稿原会话', { exact: true })
    const warning = page.getByText('当前有未发送的草稿', { exact: true })
    const waitDraft = (value) => page.waitForFunction((draft) => document.querySelector('.composer-input')?.value === draft, value)
    await page.locator('.assistant-message').waitFor()
    await input.fill('/')
    await page.getByRole('listbox', { name: '斜杠命令' }).waitFor()
    await input.press('Escape')
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('packages:catalog')
      ipcMain.handle('packages:catalog', () => ({ entries: [] }))
    })
    await page.locator('.plugins-page-entry').click()
    await page.getByRole('heading', { name: 'Pi 插件', exact: true }).waitFor()
    await page.locator('.new-session').click()
    await waitDraft('')
    check('在插件页也能新建空白对话，无草稿拦截', !await warning.count())
    await origin.click()
    await waitDraft('/')
    check('原会话保留斜杠草稿', (await input.inputValue()) === '/')

    await input.fill('项目原会话的草稿')
    await page.locator('input[type=file]').setInputFiles({
      name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Draft attachment')
    })
    await page.locator('.composer .attachment').waitFor()
    await page.locator('.project-new-chat').first().click()
    await waitDraft('')
    check('同一项目新建时附件不带入新对话', !await page.locator('.composer .attachment').count())
    await origin.click()
    await waitDraft('项目原会话的草稿')
    check('切回原项目会话时恢复文字和附件', await page.locator('.composer .attachment').count() === 1)

    await input.press('Meta+n')
    await waitDraft('')
    await input.fill('还没发过消息的独立草稿')
    await page.waitForFunction(() => !document.querySelector('.send-button')?.disabled)
    await page.locator('.new-session').click()
    await waitDraft('')
    check('未发送的新对话不会生成草稿入口', await page.locator('.draft-session').count() === 0 &&
      !await page.locator('.sidebar').getByText('还没发过消息的独立草稿', { exact: true }).count())
    await origin.click()
    await waitDraft('项目原会话的草稿')
    check('已有对话的未发送内容仍保留在原对话', await page.locator('.composer .attachment').count() === 1)

    await app.close()
    ;({ app, page } = await launch(dirs, 'default', env))
    check('重启后侧栏仍不显示草稿分组', await page.locator('.draft-session').count() === 0 &&
      !await page.locator('.sidebar').getByText('草稿', { exact: true }).count())
    await page.locator('.session-title').getByText('草稿原会话', { exact: true }).click()
    await waitDraft('项目原会话的草稿')
    check('重启后已有对话的未发送文字仍可恢复', await page.locator('.composer-input').inputValue() === '项目原会话的草稿')
  } finally {
    await app.close()
  }
}

async function caseTurnRailPreview() {
  const dirs = freshDirs('rail')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root, turnAggregate: 0 })
  )
  const { app, page } = await launch(dirs, 'default', { MOCK_TRANSCRIPT: '8', MOCK_TOOLS: '2' })
  const ticks = page.locator('.turn-rail-tick')
  const wrap = await page.locator('.chat-wrap').boundingBox()
  await page.mouse.move((wrap?.x ?? 0) + 8, (wrap?.y ?? 0) + 220)
  await ticks.first().waitFor({ timeout: 15000 })
  const count = await ticks.count()
  check('轮次导轨每轮一根', count === 8, `ticks=${count}`)
  const idleWidths = await page.evaluate(() =>
    [...document.querySelectorAll('.turn-rail-tick')].map((el) => el.getBoundingClientRect().width)
  )
  const spread = Math.max(...idleWidths) - Math.min(...idleWidths)
  check('未悬停时刻度等长', spread <= 1.5, idleWidths.map((value) => value.toFixed(1)).join(','))

  const hoverTick = async (index) => {
    const box = await ticks.nth(index).boundingBox()
    if (!box) throw new Error(`tick ${index} has no box`)
    await page.mouse.move(box.x + 2, box.y + box.height / 2)
  }

  await hoverTick(3)
  await page.waitForSelector('.turn-preview')
  await page.waitForTimeout(260)
  const question = await page.locator('.turn-preview-question').innerText()
  check('悬停显示该轮聊天记录', /seeded question 3/.test(question), question)
  check(
    '预览里的回答按 Markdown 渲染',
    (await page.locator('.turn-preview-answer .markdown').count()) === 1,
    ''
  )

  const previewBox = await page.locator('.turn-preview').boundingBox()
  const maxHeight = await page
    .locator('.turn-preview')
    .evaluate((el) => parseFloat(getComputedStyle(el).maxHeight))
  check(
    '预览卡上限更高、随内容增高',
    maxHeight >= 400 && (previewBox?.height ?? 0) > 200,
    `max=${maxHeight} h=${Math.round(previewBox?.height ?? 0)}`
  )

  const widths = await page.evaluate(() =>
    [...document.querySelectorAll('.turn-rail-tick')]
      .slice(0, 6)
      .map((el) => el.getBoundingClientRect().width)
  )
  check(
    '悬停处最高、向两侧衰减（坡度）',
    widths[3] > widths[0] + 2 && widths[3] > widths[2] + 1,
    widths.map((value) => value.toFixed(1)).join(',')
  )

  await hoverTick(6)
  await page.waitForTimeout(260)
  const moved = await page.locator('.turn-preview-question').innerText()
  const movedWidths = await page.evaluate(() =>
    [...document.querySelectorAll('.turn-rail-tick')]
      .slice(3, 8)
      .map((el) => el.getBoundingClientRect().width)
  )
  check('预览跟随指针换到该轮', /seeded question 6/.test(moved), moved)
  check(
    '坡度跟着指针移动',
    movedWidths[3] > movedWidths[0] + 2,
    movedWidths.map((value) => value.toFixed(1)).join(',')
  )

  await page.mouse.move(980, 220)
  await page.waitForTimeout(420)
  check('移开后预览消失', (await page.locator('.turn-preview').count()) === 0)

  const again = await page.locator('.chat-wrap').boundingBox()
  await page.mouse.move((again?.x ?? 0) + 8, (again?.y ?? 0) + 220)
  await ticks.nth(5).click()
  await page.waitForTimeout(350)
  check(
    '点击导轨跳到该轮',
    (await page.locator('.turn-rail-tick.is-active').count()) === 1
  )
  await app.close()
}

async function caseWheelIsolation() {
  const dirs = freshDirs('wheel')
  seedSession(dirs.sessions, 'mock-session', 'Mock session', 30)
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs, 'catalog-huge', { MOCK_TRANSCRIPT: '25' })

  const geometry = await page.evaluate(() => {
    const scroller = document.querySelector('.chat-scroll')
    return { scroll: scroller.scrollHeight, client: scroller.clientHeight }
  })
  check(
    '对话区可滚动（前置条件）',
    geometry.scroll > geometry.client + 200,
    JSON.stringify(geometry)
  )
  // Unpin from the bottom the way a user would, then remember the offset.
  await page.locator('.chat-scroll').hover()
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(350)
  const chatBefore = await page.evaluate(() => document.querySelector('.chat-scroll').scrollTop)
  check('对话区滚动到位', chatBefore > 0, `scrollTop=${chatBefore}`)

  await openModelMenu(page)
  await page.locator('.popover .menu-list').hover()
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(400)
  const chatAfter = await page.evaluate(() => document.querySelector('.chat-scroll').scrollTop)
  const listAfter = await page.evaluate(() => document.querySelector('.popover .menu-list').scrollTop)
  check('在模型列表上滚动不会带动对话区', chatAfter === chatBefore, `${chatBefore} → ${chatAfter}`)
  check('滚动落在模型列表本身', listAfter > 100, `listScrollTop=${listAfter}`)

  // Thinking segment lives in the same popover; wheel over it must not move the chat.
  await page.keyboard.press('Escape')
  await openModelMenu(page)
  await page.locator('.thinking-effort').hover()
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(300)
  const chatAfter2 = await page.evaluate(() => document.querySelector('.chat-scroll').scrollTop)
  check('在思考程度区域滚动也不会带动对话区', chatAfter2 === chatBefore, `${chatBefore} → ${chatAfter2}`)
  await app.close()
}

async function caseMenuTyping() {
  const dirs = freshDirs('typing')
  seedSession(dirs.sessions, 'mock-session', 'Mock session')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs)
  await openModelMenu(page)
  await page.keyboard.press('ArrowDown')
  const inputFocused = await page.evaluate(() => document.activeElement?.tagName === 'INPUT')
  check('↓ 之后焦点仍在搜索框', inputFocused, await page.evaluate(() => document.activeElement?.tagName ?? ''))
  await page.keyboard.type('deep')
  await page.waitForTimeout(250)
  const items = await page.locator('.popover').getByRole('option').count()
  const highlighted = await page.evaluate(
    () => document.querySelector('.popover .menu-item.highlight .menu-item-title')?.textContent ?? ''
  )
  check('继续输入仍能过滤列表', items === 1, `items=${items}, highlight=${highlighted}`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  const chip = await page.locator('.chip-label').first().innerText()
  check('Enter 选中的是过滤后的项', chip.startsWith('Mock Deep'), chip)
  await app.close()
}

async function caseStreamingGuard() {
  const dirs = freshDirs('streaming')
  seedSession(dirs.sessions, 'mock-session', 'Mock session')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root, dirs.base], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs)
  await page.locator('.composer-input').fill('hello')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  const disabled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.chip')).map((chip) => chip.disabled)
  )
  check('流式输出中模型 / 强度不可切换', disabled.every(Boolean), JSON.stringify(disabled))
  await page.locator('.new-session').click()
  await page.locator('.topbar-path').getByText('新对话', { exact: true }).waitFor()
  check('新建会话先落在新对话', true)
  check('新对话显示可选的项目入口', await page.locator('.composer-project-row').getByRole('button', { name: '选择项目' }).isVisible())
  const streamingProject = page.locator('.project-tree', { hasText: 'streaming' })
  await streamingProject.hover()
  await streamingProject.getByRole('button', { name: '在 streaming 中新建对话' }).click()
  await page.waitForFunction(() => document.querySelector('.project-row.active')?.textContent?.includes('streaming'))
  check('运行中也可以从侧栏切到其他项目', (await page.locator('.project-row.active').innerText()).includes('streaming'))
  check('运行中切换项目不再弹阻止提示', (await page.getByText('任务正在运行', { exact: true }).count()) === 0)
  await page.waitForTimeout(2500)
  const after = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.chip')).map((chip) => chip.disabled)
  )
  check('切换后的新会话可正常操作', after.every((value) => value === false), JSON.stringify(after))
  const desktopProject = page.locator('.project-tree', { hasText: 'pi-desktop' })
  await desktopProject.hover()
  await desktopProject.getByRole('button', { name: '在 pi-desktop 中新建对话' }).click()
  await page.waitForFunction(() => document.querySelector('.project-row.active')?.textContent?.includes('pi-desktop'))
  const activeProject = await page.locator('.project-row.active').innerText()
  check('可以切回原来的项目', activeProject.includes('pi-desktop'), activeProject)
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
  check('发送失败后等待提示消失并保留草稿', await page.locator('.activity').count() === 0 && await page.locator('.composer-input').inputValue() === 'hello')
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
  await page.locator('.session-item', { hasText: 'Mock session' }).locator('.session-menu-button').click({ force: true })
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

async function caseProjectStability() {
  const dirs = freshDirs('project-stability')
  seedSession(dirs.sessions, 'project-session', '项目里的会话', 1, dirs.base)
  seedSession(dirs.sessions, 'loose-session', '无项目会话', 1, '/tmp/loose-project')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: dirs.base })
  )
  const { app, page } = await launch(dirs)
  await page.waitForFunction(() => [...document.querySelectorAll('.project-row')].some((row) => row.textContent?.includes('project-stability')))
  await page.locator('.new-session').click()
  await page.waitForFunction(() => document.querySelector('.topbar-path')?.textContent?.includes('新对话'))
  await page.waitForTimeout(1200)
  check(
    '切到新对话后原项目仍在项目列表',
    (await page.locator('.project-row').filter({ hasText: 'project-stability' }).count()) === 1
  )
  check(
    '项目会话仍在项目下、不进入最近对话',
    (await page.locator('.project-tree-sessions .session-item').filter({ hasText: '项目里的会话' }).count()) === 1 &&
      (await page.locator('.recent-sessions .session-item').filter({ hasText: '项目里的会话' }).count()) === 0
  )
  await app.close()
}

async function caseSidebarAffordance() {
  const dirs = freshDirs('sidebar')
  seedSession(dirs.sessions, 'mock-session', 'Mock session')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root, dirs.base], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs)
  check('侧栏直接显示最近项目', (await page.locator('.project-row').count()) === 2)
  const sidebarProject = page.locator('.project-row').filter({ hasText: 'sidebar' }).first()
  await sidebarProject.hover()
  await sidebarProject.locator('.project-new-chat').click()
  await page.waitForTimeout(700)
  check('项目 + 新建切换到该项目', (await page.locator('.project-row.active').innerText()).includes('sidebar'))
  const rootProject = page.locator('.project-row').filter({ hasText: 'pi-desktop' }).first()
  await rootProject.hover()
  await rootProject.locator('.project-new-chat').click()
  await page.waitForTimeout(700)
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

async function caseComposerSafety() {
  const dirs = freshDirs('composer-safety')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root }))
  const { app, page } = await launch(dirs, 'default', { MOCK_PROMPT_DELAY: '1000' })
  const input = page.locator('.composer-input')
  await input.fill('/missing-command')
  await input.press('Enter')
  await page.getByText('命令未找到').waitFor({timeout:5000})
  check('未加载的单独斜杠命令不会发送给模型', await input.inputValue() === '/missing-command' && await page.locator('.user-message').count() === 0)
  await page.getByRole('button',{name:'查看排查步骤'}).click({timeout:2000})
  await page.getByRole('dialog').getByText('在终端进入项目目录，运行 pi，然后输入 /trust 并自行决定是否信任。').waitFor()
  check('未加载命令提供信任排查步骤',true)
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{writeText:async(value)=>{window.__copiedProject=value}} }) })
  await page.getByRole('dialog').getByRole('button',{name:'复制项目路径'}).click()
  await page.getByRole('dialog').getByText('路径已复制').waitFor()
  check('排查时可复制当前项目路径',await page.evaluate(()=>window.__copiedProject)===root)
  await page.waitForTimeout(350)
  await page.screenshot({path:join(dirs.base,'command-help.png')})
  await page.getByRole('dialog').locator('button.button.primary').click()
  await input.fill('中文输入')
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })
  await page.waitForTimeout(100)
  check('输入法组合期间 Enter 不发送', await input.inputValue() === '中文输入' && await page.locator('.user-message').count() === 0)
  await input.press('Enter')
  await input.fill('新的草稿')
  await page.waitForTimeout(1300)
  check('发送等待期间的新草稿不会被清空', await input.inputValue() === '新的草稿', await input.inputValue())
  await app.close()
}

async function caseCommandRegistryUnavailable() {
  const dirs = freshDirs('command-registry-unavailable')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme:'dark', workspaces:[root], lastWorkspace:root }))
  const {app,page} = await launch(dirs,'default',{MOCK_COMMANDS_FAIL:'1'})
  try {
    const input=page.locator('.composer-input')
    await input.fill('/example')
    await input.press('Enter')
    await page.getByText('无法检查命令').waitFor({timeout:5000})
    check('命令列表不可用时不误报命令缺失并保留草稿', await page.getByText('命令未找到').count()===0 && await input.inputValue()==='/example')
  } finally { await app.close() }
}

async function caseLanguage() {
  const dirs = freshDirs('language')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root }))
  let { app, page } = await launch(dirs)
  try {
  await page.keyboard.press('Meta+,')
  await page.getByRole('button', { name: '界面语言', exact: true }).click()
  check('语言选择使用应用内菜单', await page.locator('.popover .menu-item').count() === 2)
  const languageMenuWidth = (await page.locator('.popover').boundingBox())?.width ?? 0
  check('短选项菜单宽度适中', languageMenuWidth <= 190, `width=${languageMenuWidth}`)
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
  check('语言切换后设置页显示英语', await page.getByRole('heading', { name: 'Settings', exact: true }).count() === 1)
  for (const category of ['General', 'Models', 'Tools & skills', 'Appearance', 'Sessions', 'Computer Use', 'Web browsing', 'Keyboard shortcuts', 'About']) {
    await page.getByRole('button', { name: category, exact: true }).click()
    const heading = await page.locator('.settings-page-title').innerText()
    check(`英语设置分类：${category}`, heading === category, heading)
  }
  await page.getByRole('button', { name: 'Back to chat' }).click()
  check('语言切换后侧栏显示英语', await page.getByPlaceholder('Search sessions').count() === 1)
  const settingsButton = await page.locator('.sidebar-footer button').first().boundingBox()
  check('侧栏设置按钮点击区域足够大', Boolean(settingsButton && settingsButton.width >= 36 && settingsButton.height >= 36), JSON.stringify(settingsButton))
  await page.locator('.sidebar-footer .settings-entry').click({ position: { x: 2, y: 2 } })
  check('侧栏设置按钮边缘可点击', await page.locator('.settings-page').count() === 1)
  await page.getByRole('button', { name: 'Back to chat' }).click()
  const topbarEntry = page.locator('.topbar .settings-entry')
  if (await topbarEntry.count()) {
    await topbarEntry.click({ position: { x: 2, y: 2 } })
    check('顶栏设置按钮边缘可点击', await page.locator('.settings-page').count() === 1)
    await page.getByRole('button', { name: 'Back to chat' }).click()
  }
  await page.locator('.composer-input').fill('设置')
  await page.locator('.composer-input').press('Enter')
  await page.waitForSelector('.user-message')
  check('用户输入不会被翻译', (await page.locator('.user-message').last().innerText()).includes('设置'))
  await page.waitForTimeout(2000)
  await app.close()
  ;({ app, page } = await launch(dirs))
  check('重启后保留语言选择', await page.getByPlaceholder('Search sessions').count() === 1)
  await page.keyboard.press('Meta+,')
  await page.getByRole('button', { name: 'Interface language', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '简体中文' }).click()
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor()
  check('可切换回中文', await page.getByRole('heading', { name: '设置', exact: true }).count() === 1)
  await page.getByRole('button', { name: 'Steering 模式', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelectorAll('.popover').length === 0)
  check('Esc 只关闭下拉菜单并保留设置页', await page.locator('.popover').count() === 0 && await page.locator('.settings-page').count() === 1)
  await page.getByRole('button', { name: 'Steering 模式', exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('.popover').length === 0)
  check('设置下拉支持键盘选择并关闭', await page.locator('.popover').count() === 0)
  check('设置页没有原生下拉框', await page.locator('.settings-page select').count() === 0)
  } finally { await app.close().catch(() => undefined) }
}

async function caseProviderConnectionFlow() {
  const dirs = freshDirs('provider-connection-flow')
  const table = 'provider  model  context  max-out  thinking  images\nopencode-go  glm-5.3  1M  32K  yes  no\nopencode-go  deepseek-v4.1-flash  1M  384K  yes  yes'
  const { app, page } = await launch(dirs, 'default', { MOCK_EXEC_PATH_FILE: join(dirs.base, 'runtime.txt'), MOCK_MODEL_TABLE: table })
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: '模型', exact: true }).click()
    await page.getByRole('button', { name: '添加服务商', exact: true }).click()
    await page.getByRole('tab', { name: 'API Key' }).click()
    await page.locator('.preset-chip').filter({ hasText: 'OpenCode Go' }).click()
    await page.getByPlaceholder('输入新的 API Key').fill('test-fixture-key')
    await page.locator('.provider-inline-key').getByRole('button', { name: '保存 API Key' }).click()
    await page.locator('.model-service-item').filter({ hasText: 'opencode-go' }).waitFor()
    await page.locator('.provider-model-list').getByText('glm-5.3', { exact: true }).waitFor()
    check('连接套餐后直接展示 Pi 模型目录', await page.locator('.provider-model-list').getByText('deepseek-v4.1-flash', { exact: true }).isVisible())
    check('连接后不暴露密钥且不要求逐个添加', !await page.getByText('test-fixture-key').count() && await page.locator('.model-service-content').getByRole('button', { name: '添加模型', exact: true }).count() === 0)
    const stored = JSON.parse(readFileSync(join(dirs.agent, 'auth.json'), 'utf8'))
    check('连接结果保存到正确服务商', stored['opencode-go']?.key === 'test-fixture-key')
  } finally { await app.close() }
}

async function caseBackgroundModelProcess() {
  const dirs = freshDirs('background-model-process')
  const probe = join(dirs.base, 'runtime.txt')
  const { app, page } = await launch(dirs, 'default', { MOCK_EXEC_PATH_FILE: probe })
  try {
    const list = await page.evaluate(() => window.pi.listPiModels())
    const listRuntime = readFileSync(probe, 'utf8')
    check('读取模型列表通过后台 Helper 运行', process.platform !== 'darwin' || /Helper\.app\/Contents\/MacOS\//.test(listRuntime), listRuntime)
    check('后台模型列表返回真实运行结果', list.models.some((model) => model.provider === 'mock' && model.id === 'test'))
    const refresh = await page.evaluate(() => window.pi.refreshModelCatalog())
    const refreshRuntime = readFileSync(probe, 'utf8')
    check('刷新模型目录通过后台 Helper 运行', refresh.ok && (process.platform !== 'darwin' || /Helper\.app\/Contents\/MacOS\//.test(refreshRuntime)), refreshRuntime)
  } finally { await app.close() }
}

async function caseDesktopSelects() {
  const dirs = freshDirs('desktop-selects')
  writeFileSync(join(dirs.agent, 'auth.json'), JSON.stringify({ openai: { type: 'api_key', key: 'sk-test-private' }, 'opencode-go': { type: 'api_key', key: 'sk-test-private' } }))
  writeFileSync(join(dirs.agent, 'models.json'), JSON.stringify({ providers: { 'fixture-provider': { name: 'Fixture Service', baseUrl: 'http://127.0.0.1:12345/v1', api: 'openai-completions', models: [{ id: 'fixture-model', contextWindow: 128000 }] } } }))
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [root], lastWorkspace: root }))
  const { app, page } = await launch(dirs, 'default', { MOCK_EXEC_PATH_FILE: join(dirs.base, 'runtime.txt'), MOCK_MODEL_TABLE: 'provider  model  context  max-out  thinking  images\nopencode-go  deepseek-v4.1-flash  1M  384K  yes  yes\nopencode-go  glm-5.3  1M  32K  yes  no' })
  const checkAligned = async (button) => {
    const trigger = await button.boundingBox()
    const menu = await page.locator('.popover:not(.popover-closing)').last().boundingBox()
    return Boolean(trigger && menu && Math.abs(trigger.width - menu.width) < 1 && Math.abs(trigger.x - menu.x) < 1)
  }
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: '模型', exact: true }).click()
    check('模型设置说明服务商的用途', await page.getByText('管理模型服务商，配置后可在对话中选择使用。').isVisible())
    const modelsWidth = (await page.locator('.settings-content-inner').boundingBox()).width
    await page.getByRole('button', { name: '常规', exact: true }).click()
    const generalWidth = (await page.locator('.settings-content-inner').boundingBox()).width
    check('其他设置页与模型页等宽', Math.abs(modelsWidth - generalWidth) < 1, `model=${modelsWidth}, general=${generalWidth}`)
    await page.getByRole('button', { name: '模型', exact: true }).click()
    const sidebar = page.locator('.model-service-sidebar')
    check('服务商列表位于配置区域左侧', await sidebar.isVisible() && await page.locator('.model-service-content').isVisible())
    const customRow = sidebar.locator('.model-service-item').filter({ hasText: 'Fixture Service' })
    await customRow.waitFor()
    await customRow.click()
    check('选择自定义服务商可查看已有模型', (await page.locator('.model-service-content').innerText()).includes('fixture-model'))
    await page.locator('.model-service-content').getByRole('button', { name: '编辑', exact: true }).click()
    check('编辑保留原有模型及服务地址', (await page.getByPlaceholder('http://localhost:11434/v1').inputValue()) === 'http://127.0.0.1:12345/v1' && (await page.getByPlaceholder('qwen2.5-coder:7b').inputValue()) === 'fixture-model')
    await page.locator('.model-service-content').getByRole('button', { name: '取消', exact: true }).click()
    await page.locator('.model-service-content').getByRole('button', { name: '添加模型', exact: true }).click()
    await page.getByPlaceholder('例如：qwen3').fill('fixture-new')
    await page.locator('.provider-model-add').getByRole('button', { name: '添加', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.model-service-content')?.textContent?.includes('fixture-new'))
    const stored = JSON.parse(readFileSync(join(dirs.agent, 'models.json'), 'utf8'))
    check('自定义服务商可添加模型并保留原模型参数', stored.providers['fixture-provider'].models.some((m) => m.id === 'fixture-new') && stored.providers['fixture-provider'].models.find((m) => m.id === 'fixture-model')?.contextWindow === 128000)
    const goRow = sidebar.locator('.model-service-item').filter({ hasText: 'opencode-go' })
    await goRow.click()
    check('OpenCode Go 直接展示 Pi 返回的模型，无需手动添加', (await page.locator('.provider-model-list').innerText()).includes('deepseek-v4.1-flash') && (await page.locator('.provider-model-list').innerText()).includes('glm-5.3') && await page.locator('.model-service-content').getByRole('button', { name: '添加模型', exact: true }).count() === 0)
    await page.screenshot({ path: join(dirs.base, 'provider-models.png') })
    await page.locator('.provider-model-row').filter({ hasText: 'glm-5.3' }).click()
    await page.waitForFunction(() => document.querySelector('.provider-model-row[aria-pressed=true]')?.textContent?.includes('glm-5.3'))
    const newDefaults = JSON.parse(readFileSync(join(dirs.agent, 'settings.json'), 'utf8'))
    check('自动列出的模型可以设为新会话默认', newDefaults.defaultProvider === 'opencode-go' && newDefaults.defaultModel === 'glm-5.3')
    const providerRow = sidebar.locator('.model-service-item').filter({ hasText: 'openai' })
    await providerRow.waitFor()
    check('已保存的服务商按凭据类型展示，密钥不会显示', (await providerRow.innerText()).includes('凭据已保存') && !await page.getByText('sk-test-private').count())
    await providerRow.click()
    check('服务商详情直接显示密钥输入框', await page.getByPlaceholder('输入新的 API Key').isVisible() && await page.getByRole('button', { name: '管理 API Key' }).count() === 0)
    await page.getByRole('button', { name: '添加服务商', exact: true }).click()
    check('添加入口显示横向接入分类', await page.getByRole('tab', { name: '账号授权' }).isVisible() && await page.getByRole('tab', { name: 'API Key' }).isVisible() && await page.getByRole('tab', { name: '本地模型' }).isVisible() && await page.getByRole('tab', { name: '自定义供应商' }).isVisible())
    await page.getByRole('tab', { name: '账号授权' }).press('ArrowRight')
    check('接入分类支持方向键切换', await page.getByRole('tab', { name: 'API Key' }).getAttribute('aria-selected') === 'true')
    await page.locator('.preset-chip').filter({ hasText: 'DeepSeek' }).waitFor()
    check('API Key 分类展示 Pi 支持的套餐', await page.locator('.preset-chip').filter({ hasText: 'OpenCode Go' }).isVisible() && await page.locator('.preset-chip').filter({ hasText: 'MiniMax CN' }).isVisible())
    await page.getByPlaceholder('搜索服务商', { exact: true }).fill('no-such-provider-xyz')
    check('服务商搜索无结果时显示说明', await page.getByText('没有匹配的服务商。').isVisible())
    await page.getByPlaceholder('搜索服务商', { exact: true }).fill('')
    check('常用服务商显示真实品牌标识', await page.locator('.preset-chip').filter({ hasText: 'DeepSeek' }).locator('img.provider-brand-logo').count() === 1)
    await page.screenshot({ path: join(dirs.base, 'provider-presets.png') })
    await page.locator('.preset-chip').filter({ hasText: 'DeepSeek' }).click()
    check('选择服务商直接进入密钥配置', await page.getByPlaceholder('输入新的 API Key').isVisible() && await page.getByRole('dialog').count() === 0)
    check('模型页移除重复默认模型选择', await page.getByRole('button', { name: '默认模型', exact: true }).count() === 0 && await page.getByRole('button', { name: '默认思考程度', exact: true }).count() === 0)
    await page.getByRole('button', { name: '常规', exact: true }).click()
    const thinking = page.getByRole('button', { name: '默认思考程度', exact: true })
    await thinking.click()
    check('常规页的思考程度菜单与按钮等宽对齐', await checkAligned(thinking))
    await page.getByRole('menuitemradio', { name: '高', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[aria-label="默认思考程度"]')?.textContent?.includes('高'))
    const savedThinking = JSON.parse(readFileSync(join(dirs.agent, 'settings.json'), 'utf8'))
    check('常规页思考程度保存到 Pi 设置', savedThinking.defaultThinkingLevel === 'high')
    await page.getByRole('button', { name: '模型', exact: true }).click()
    await page.getByRole('button', { name: '常规', exact: true }).click()
    check('切换设置页后思考程度保持', (await thinking.innerText()).includes('高'))
    await page.keyboard.press('Escape')
    await page.locator('.skills-page-entry').click()
    const source = page.getByRole('button', { name: '来源' })
    await source.click()
    check('技能来源使用应用选择菜单且等宽', await checkAligned(source) && await page.locator('.skills-page select').count() === 0)
    await page.getByRole('menuitemradio', { name: '个人', exact: true }).click()
    check('技能来源可以切换', (await source.innerText()).includes('个人'))
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(600, 560); window.setSize(600, 620) })
    await page.waitForFunction(() => innerWidth <= 600)
    await source.click()
    check('窄窗口选择菜单仍等宽且处于屏幕内', await checkAligned(source) && await page.locator('.popover:not(.popover-closing)').last().evaluate(el => {
      const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
    }))
    await page.keyboard.press('Escape')
  } finally { await app.close() }
}

async function caseChromeBridgeGuide() {
  const dirs = freshDirs('chrome-bridge-guide')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root }))
  const { app, page } = await launch(dirs)
  try {
    await page.keyboard.press('Meta+,')
    check('常规设置不显示浏览器设置', await page.getByRole('button', { name: '安装指引' }).count() === 0)
    const search = page.getByPlaceholder('搜索设置')
    await search.fill('computer-use')
    await page.getByText('macOS 权限', { exact: true }).waitFor({ timeout: 3000 })
    check('搜索 Computer Use 显示桌面设置', await page.getByText('macOS 权限', { exact: true }).count() === 1)
    await search.fill('网页浏览')
    await page.getByRole('button', { name: '安装指引' }).waitFor({ timeout: 3000 })
    check('搜索网页浏览显示浏览器设置', await page.getByRole('button', { name: '安装指引' }).count() === 1)
    await search.fill('')
    await page.getByRole('button', { name: '电脑操作', exact: true }).click()
    check('Computer Use 有独立设置页', await page.getByRole('heading', { name: '电脑操作', exact: true }).count() === 1)
    check('Computer Use 不混入网页浏览设置', await page.getByRole('button', { name: '安装指引' }).count() === 0)
    await page.getByRole('button', { name: '网页浏览', exact: true }).click()
    check('网页浏览有独立设置页', await page.getByRole('heading', { name: '网页浏览', exact: true }).count() === 1)
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('chrome:bridge-check');ipcMain.handle('chrome:bridge-check',()=>({connected:true,busy:false,versionStatus:'unknown'}))})
    await page.getByRole('button', { name: '安装指引' }).click()
    const modal = page.getByRole('dialog')
    await modal.getByText('已连接，但无法确认扩展版本。请在 Chrome 扩展页刷新 Pi Desktop Chrome Bridge，然后重新检测。').waitFor()
    check('打开指引时自动检测旧版或未知版本',true)
    await page.waitForTimeout(350)
    await page.screenshot({path:join(dirs.base,'guide-refresh.png')})
    await modal.getByRole('button',{name:'稍后再说'}).click()
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('chrome:bridge-check');ipcMain.handle('chrome:bridge-check',()=>({connected:false,busy:false}))})
    await page.getByRole('button', { name: '安装指引' }).click()
    await modal.locator('[draggable="true"][data-chrome-bridge-drag]').waitFor({ timeout: 3000 })
    check('安装指引提供可拖拽的扩展文件夹', await modal.locator('[draggable="true"][data-chrome-bridge-drag]').count() === 1)
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.startDrag = ({ file, icon }) => {
        globalThis.__bridgeDragResult = { file, size: typeof icon === 'string' ? null : icon.getSize() }
      }
    })
    await modal.locator('[data-chrome-bridge-drag]').dispatchEvent('dragstart')
    await page.waitForTimeout(150)
    const dragResult = await app.evaluate(() => globalThis.__bridgeDragResult)
    check('拖动预览大小适中且指向扩展目录', Boolean(dragResult && dragResult.file === join(dirs.userData, 'chrome-bridge') && dragResult.size?.width <= 64 && dragResult.size?.height <= 64), JSON.stringify(dragResult))
    await page.waitForTimeout(350)
    await page.screenshot({ path: join(dirs.base, 'guide.png') })
    await modal.locator('summary').click()
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('clipboard unavailable') } } })
    })
    await modal.getByRole('button', { name: '复制路径' }).click()
    await page.waitForTimeout(300)
    const copied = await modal.getByText('已复制', { exact: true }).count()
    const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
    check('扩展路径可复制', copied === 1 && clipboard === join(dirs.userData, 'chrome-bridge'))
    await modal.getByRole('button',{name:'检测连接'}).waitFor({timeout:6000})
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('chrome:bridge-check');ipcMain.handle('chrome:bridge-check',()=>({connected:true,busy:false,versionStatus:'outdated'}))})
    await modal.getByRole('button',{name:'检测连接'}).click()
    await modal.getByText('Chrome 正在使用旧版扩展。请打开扩展页，找到 Pi Desktop Chrome Bridge，点击卡片上的刷新按钮，然后重新检测。').waitFor()
    check('旧扩展提示刷新而不要求重新拖入', await modal.locator('[data-chrome-bridge-drag]').count()===0)
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('chrome:bridge-check');ipcMain.handle('chrome:bridge-check',()=>({connected:true,busy:false,versionStatus:'unknown'}))})
    await modal.getByRole('button',{name:'检测连接'}).click()
    await modal.getByText('已连接，但无法确认扩展版本。请在 Chrome 扩展页刷新 Pi Desktop Chrome Bridge，然后重新检测。').waitFor()
    check('版本未知时不声称扩展已就绪',true)
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('chrome:bridge-check');ipcMain.handle('chrome:bridge-check',()=>({connected:true,busy:false,versionStatus:'current'}))})
    await modal.getByRole('button',{name:'检测连接'}).click()
    await modal.getByText('已连接并验证本机配对。').waitFor()
    check('版本匹配时显示连接成功',true)
    await modal.getByRole('button', { name: '稍后再说' }).click()
    check('安装指引可以关闭', await page.getByRole('dialog').count() === 0)
  } finally {
    await app.close()
  }
}

async function caseBrowserRouter() {
  const dirs = freshDirs('browser-router')
  const { app, page } = await launch(dirs)
  try {
    const status = await page.evaluate(() => window.pi.browserRouterStatus())
    check('统一状态包含三个浏览器后端', status.backends.map((item) => item.backend).join(',') === 'inapp,cdp,extension', JSON.stringify(status))
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('browser:router-status')
      ipcMain.handle('browser:router-status', () => ({
        cdpPort: 9223,
        backends: [
          { backend: 'inapp', connected: true, detail: 'https://example.com' },
          { backend: 'cdp', connected: false, detail: '未连接' },
          { backend: 'extension', connected: true, detail: '已连接当前 Chrome 标签页' }
        ]
      }))
    })
    await page.keyboard.press('Meta+,')
    await page.getByPlaceholder('搜索设置').fill('网页浏览')
    await page.getByText('浏览器连接状态', { exact: true }).waitFor({ timeout: 5000 })
    check('设置页显示浏览器连接状态', await page.getByText('浏览器连接状态', { exact: true }).isVisible())
    await page.locator('.browser-router-refresh').click()
    await page.getByText('已打开', { exact: true }).waitFor({ timeout: 5000 })
    check('应用内浏览器显示已打开', await page.getByText('已打开', { exact: true }).isVisible())
    check('CDP 显示未连接', await page.getByText('未连接', { exact: true }).first().isVisible())
    await page.getByText('浏览器连接状态', { exact: true }).waitFor()
    check('可以重新检测浏览器状态', true)
  } finally { await app.close() }
}

async function caseChromeBridgeUpgrade() {
  const dirs = freshDirs('chrome-bridge-upgrade')
  const target = join(dirs.userData, 'chrome-bridge')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'manifest.json'), JSON.stringify({ version: '0.0.1' }))
  writeFileSync(join(target, 'background.js'), 'old extension content')
  writeFileSync(join(target, 'pairing.json'), JSON.stringify({key:'sensitive-old-key'}), {mode:0o600})
  const { app } = await launch(dirs)
  try {
    const installed = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8'))
    const original = JSON.parse(readFileSync(join(root, 'extensions/chrome-bridge/manifest.json'), 'utf8'))
    check('旧扩展文件更新到随应用提供的版本', installed.version === original.version)
    const backupRoot = join(dirs.userData, 'chrome-bridge-backups')
    const backups = existsSync(backupRoot) ? readdirSync(backupRoot) : []
    check('更新扩展文件前保留旧目录备份', backups.some((name) => readFileSync(join(backupRoot, name, 'background.js'), 'utf8') === 'old extension content'))
    const pairing = JSON.parse(readFileSync(join(target, 'pairing.json'), 'utf8'))
    const secret = JSON.parse(readFileSync(join(dirs.base, 'chrome-bridge-secret.json'), 'utf8'))
    check('扩展使用本机私有配对密钥', pairing.key === secret.key && pairing.port === 9317 && (statSync(join(target, 'pairing.json')).mode & 0o777) === 0o600)
    check('扩展备份不包含配对密钥', backups.every((name) => !existsSync(join(backupRoot, name, 'pairing.json'))))

  } finally { await app.close() }
  writeFileSync(join(target, 'manifest.json'), JSON.stringify({ version: '999.0.0' }))
  writeFileSync(join(target, 'background.js'), 'newer extension content')
  const reopened = await launch(dirs)
  try {
    check('旧应用不会覆盖更新的扩展版本', readFileSync(join(target, 'background.js'), 'utf8') === 'newer extension content')
  } finally { await reopened.app.close() }
}

const only = (process.env.E2E_ONLY ?? '').trim().toLowerCase()
const wants = only ? only.split(/[,\s]+/).filter(Boolean) : []

// Every scenario is addressable by tag, so a change can be checked against the
// affected area without booting all twenty Electron instances.
async function caseComputerUsePermissions() {
  const dirs = freshDirs('computer-use-permissions')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [root], lastWorkspace: root }))
  const { app, page } = await launch(dirs)
  try {
    await page.locator('.composer-input').fill('保留的草稿')
    check('没有请求时显示项目栏', await page.locator('.composer-project-slot').getAttribute('data-covered') === 'false' && await page.locator('.project-picker-trigger').isVisible())
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('pi:record', { type:'extension_ui_request', id:'permission-test', method:'select', title:'Computer Use: System Permissions', options:['Open Accessibility Settings','Check Again','Cancel'] })
    })
    await page.getByRole('heading', { name:'开启桌面操作权限' }).waitFor()
    await page.waitForTimeout(200)
    await page.screenshot({ path: join(dirs.base, 'permission-guide.png') })
    check('确认卡片位于输入框上方且保留草稿', await page.locator('.conversation-prompt').evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector('.composer').getBoundingClientRect().top) && await page.locator('.composer-input').inputValue() === '保留的草稿' && await page.locator('.modal-overlay').count() === 0)
    check('提示出现时项目栏收起且无法操作', await page.locator('.composer-project-slot').getAttribute('data-covered') === 'true' && await page.locator('.composer-project-slot').evaluate(el => el.inert))
    check('权限引导解释用途', await page.getByText('允许 Pi 观察和操作桌面应用').isVisible())
    check('缺失的辅助功能提供系统设置入口', await page.getByRole('button', { name:'打开辅助功能设置' }).isVisible())
    check('权限引导提供重新检测', await page.getByRole('button', { name:'重新检测' }).isVisible())
    await page.getByRole('button', { name:'稍后再说' }).click()
    await page.locator('.conversation-prompt').waitFor({ state: 'hidden' })
    check('可取消权限引导', await page.locator('.conversation-prompt').isHidden())
    await page.waitForFunction(() => document.querySelector('.composer-project-slot')?.getAttribute('data-covered') === 'false')
    check('提示关闭后项目栏恢复', await page.locator('.project-picker-trigger').isVisible() && !(await page.locator('.composer-project-slot').evaluate(el => el.inert)))
    await app.evaluate(({ipcMain}) => { globalThis.__confirmResponses = []; ipcMain.on('pi:ui-response', (_event, response) => globalThis.__confirmResponses.push(response)) })
    const commandMessage = '检测到递归删除。\n\ncd /tmp/example && rm -rf output/probe\n\n只在你确认这条命令安全时继续。'
    await app.evaluate(({BrowserWindow}, message) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'regular-confirm',method:'confirm',title:'确认操作',message}), commandMessage)
    const regular = page.locator('.conversation-prompt-content[data-request-id="regular-confirm"]')
    await regular.getByRole('button', { name: '否', exact: true }).waitFor()
    const regularHeight = await regular.evaluate(el => el.getBoundingClientRect().height)
    await regular.getByRole('button', { name: '否', exact: true }).click()
    await app.evaluate(({BrowserWindow}, message) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'danger-confirm',method:'confirm',title:'确认执行危险命令',message}), commandMessage)
    const danger = page.locator('.conversation-prompt-content[data-request-id="danger-confirm"]')
    await danger.getByRole('button', { name: '否', exact: true }).waitFor()
    const commandParts = await danger.locator('.conversation-command-description > span').allTextContents()
    const dangerHeight = await danger.evaluate(el => el.getBoundingClientRect().height)
    check('危险命令确认卡片更紧凑且命令完整', dangerHeight < regularHeight - 10 && commandParts[1] === 'cd /tmp/example && rm -rf output/probe', JSON.stringify({ regularHeight, dangerHeight, commandParts }))
    await page.screenshot({path:join(dirs.base,'danger-confirm-compact.png')})
    await danger.getByRole('button', { name: '否', exact: true }).click()
    check('紧凑确认卡片仍遵循拒绝协议', (await app.evaluate(() => globalThis.__confirmResponses.find(item => item.id === 'danger-confirm')))?.confirmed === false)
    await app.evaluate(({BrowserWindow}) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents
      wc.send('pi:record', {type:'extension_ui_request',id:'queue-first',method:'select',title:'选择一个选项',options:['选项一','选项二']})
      wc.send('pi:record', {type:'extension_ui_request',id:'queue-second',method:'input',title:'填写答案',placeholder:'请输入'})
    })
    const card = page.locator('.conversation-prompt-content')
    await card.getByText('还有 1 项待处理').waitFor()
    check('多个请求按顺序展示并提示余量', await card.getByText('还有 1 项待处理').isVisible() && await card.getByText('选项一').isVisible())
    await card.getByRole('button', {name:'选项一'}).click()
    await card.getByRole('heading', {name:'填写答案'}).waitFor()
    check('选择后展示下一项并保留草稿', await page.locator('.composer-input').inputValue() === '保留的草稿')
    await card.getByRole('button', {name:'取消请求'}).click()
    const queueResponses = await app.evaluate(() => globalThis.__confirmResponses.filter(item => item.id?.startsWith('queue-')))
    check('选择与关闭分别传递原协议，关闭不会同意', queueResponses.find(item => item.id === 'queue-first')?.value === '选项一' && queueResponses.find(item => item.id === 'queue-second')?.cancelled === true)

    for (const [kind, label, expected] of [['login', '我已完成', true], ['verification', '稍后再说', false]]) {
      const id = 'handoff-' + kind
      await app.evaluate(({BrowserWindow}, {id, kind}) => {
        BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {
          type:'extension_ui_request', id, method:'confirm', title:'Computer Use: Sign-in Handoff',
          message:JSON.stringify({ kind, backend:'inapp', host:'login.example.test' })
        })
      }, {id, kind})
      await card.getByRole('heading', {name:kind === 'login' ? '请完成登录' : '请完成验证'}).waitFor()
      check('登录或验证在当前对话提示，并指明正在使用的网站', (await card.innerText()).includes('login.example.test') && await card.locator('input').count() === 0)
      if (kind === 'login') {
        await card.getByRole('button', {name:'打开工作面板'}).click()
        await page.locator('.browser-toolbar').waitFor()
      }
      await card.getByRole('button', {name:label}).click()
      const response = await app.evaluate((_electron, id) => globalThis.__confirmResponses.find(item => item.id === id), id)
      check('登录接管按用户选择恢复或保持暂停', response?.confirmed === expected)
    }

    for (const [id, label, expected] of [['yes','是',true], ['no','否',false]]) {
      await app.evaluate(({BrowserWindow}, id) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id,method:'confirm',title:'Computer Use',message:'Test'}), id)
      await page.getByRole('button',{name:label,exact:true}).click()
      await page.waitForTimeout(100)
      const response = await app.evaluate((_electron, id) => globalThis.__confirmResponses.find(item => item.id === id), id)
      check(`确认弹窗 ${label} 符合 Pi RPC 协议`, response?.confirmed === expected && !('value' in response), JSON.stringify(response))
    }
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'desktop-action',method:'confirm',title:'确认桌面操作',message:'应用：本地测试应用\n窗口：业务窗口\n操作：click\n目标：AXButton 保存'}))
    const actionDialog=page.locator('.conversation-prompt-content[data-request-id=\"desktop-action\"]')
    await actionDialog.getByRole('button',{name:'确认执行'}).waitFor()
    check('桌面操作确认清楚展示应用、窗口、动作和目标', await actionDialog.getByText('本地测试应用').count()===1 && await actionDialog.getByText('业务窗口').count()===1 && await actionDialog.getByText('点击',{exact:true}).count()===1 && await actionDialog.getByText('按钮 保存').count()===1)
    await page.waitForTimeout(200)
    await page.screenshot({path:join(dirs.base,'desktop-action-confirm.png')})
    await actionDialog.getByRole('button',{name:'确认执行'}).click()
    await page.waitForTimeout(100)
    const actionResponse=await app.evaluate(()=>globalThis.__confirmResponses.find(item=>item.id==='desktop-action'))
    check('明确操作按钮保留真实 Pi 确认协议', actionResponse?.confirmed===true, JSON.stringify(actionResponse))
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'browser-action',method:'confirm',title:'Computer Use: Browser',message:'操作：click\n目标：上传资料\n浏览器：inapp\n页面：http://localhost/test\n已选文件：文件: fixture.csv (3 bytes)（当前页面可见文件，不一定属于此操作）'}))
    const browserDialog=page.locator('.conversation-prompt-content[data-request-id=\"browser-action\"]')
    await browserDialog.getByRole('button',{name:'取消操作'}).waitFor()
    check('网页操作确认展示目标、页面和选中文件', await browserDialog.getByRole('heading',{name:'确认网页操作'}).count()===1 && (await browserDialog.innerText()).includes('fixture.csv (3 bytes)') && (await browserDialog.innerText()).includes('上传资料') && (await browserDialog.innerText()).includes('http://localhost/test'))
    await page.waitForTimeout(200)
    await page.screenshot({path:join(dirs.base,'browser-action-confirm.png')})
    await browserDialog.getByRole('button',{name:'取消操作'}).click()
    await page.waitForTimeout(100)
    check('取消网页操作保留 Pi 确认协议', (await app.evaluate(()=>globalThis.__confirmResponses.find(item=>item.id==='browser-action')))?.confirmed===false)
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'browser-input',method:'confirm',title:'Computer Use: Browser',message:'操作：type\n目标：订单编号\n浏览器：inapp\n页面：http://localhost/test\n输入预览：\"ORD-2026-002\"'}))
    const inputDialog=page.locator('.conversation-prompt-content[data-request-id=\"browser-input\"]')
    await inputDialog.getByRole('heading',{name:'确认网页操作'}).waitFor()
    check('网页输入确认显示待输入内容', await inputDialog.locator('.browser-action-input-preview').innerText()==='\"ORD-2026-002\"')
    await inputDialog.getByRole('button',{name:'取消操作'}).click()
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'browser-input-long',method:'confirm',title:'Computer Use: Browser',message:`操作：type\n目标：内容\n浏览器：inapp\n页面：http://localhost/test\n输入内容：\"${'x'.repeat(2001)}END\"`}))
    const longInputDialog=page.locator('.conversation-prompt-content[data-request-id=\"browser-input-long\"]')
    await longInputDialog.getByRole('heading',{name:'确认网页操作'}).waitFor()
    const preview=longInputDialog.locator('.browser-action-input-preview')
    check('长输入在确认窗口中可完整滚动查看', (await preview.innerText()).endsWith('END\"') && await preview.evaluate(el=>el.scrollHeight>el.clientHeight))
    await longInputDialog.getByRole('button',{name:'取消操作'}).click()


    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'file-selection',method:'confirm',title:'Computer Use: File Selection',message:'请在浏览器弹出的系统窗口中选择要上传的文件。选择完成后回到这里确认；继续前需要重新观察并核对文件。'}))
    const fileDialog=page.locator('.conversation-prompt-content[data-request-id=\"file-selection\"]')
    await fileDialog.getByRole('heading',{name:'选择上传文件'}).waitFor()
    check('文件选择窗口未出现时提供明确替代步骤', (await fileDialog.innerText()).includes('如果没有看到系统文件选择窗口') && (await fileDialog.innerText()).includes('在网页中点击文件选择按钮'))
    await fileDialog.getByRole('button',{name:'打开工作面板'}).click()
    await page.waitForFunction(() => document.querySelector('[aria-label="工作面板"]')?.getAttribute('aria-pressed') === 'true')
    check('文件选择引导能展开工作面板', await page.locator('[aria-label="工作面板"]').getAttribute('aria-pressed') === 'true')
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].some(el => el.textContent?.includes('浏览器')))
    check('文件选择引导切换到浏览器标签', await page.locator('[role="tab"][aria-selected="true"]').filter({hasText:'浏览器'}).count()===1)
    check('打开工作面板不会提前确认文件已选择', await fileDialog.getByRole('button',{name:'已完成选择'}).count()===1 && !(await app.evaluate(()=>globalThis.__confirmResponses.find(item=>item.id==='file-selection'))))
    check('文件选择引导明确说明接下来要做什么', (await fileDialog.innerText()).includes('系统窗口') && await fileDialog.getByRole('button',{name:'已完成选择'}).count()===1)
    await fileDialog.getByRole('button',{name:'稍后再说'}).click()
    await page.waitForTimeout(100)
    check('暂不选择保持 Pi 取消确认协议', (await app.evaluate(()=>globalThis.__confirmResponses.find(item=>item.id==='file-selection')))?.confirmed===false)
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'file-cancel',method:'confirm',title:'Computer Use: Cancel File Selection',message:'请先关闭或取消系统文件选择窗口，再确认取消本次选择。'}))
    const cancelFileDialog=page.locator('.conversation-prompt-content[data-request-id=\"file-cancel\"]')
    await cancelFileDialog.getByRole('heading',{name:'取消文件选择'}).waitFor()
    check('取消文件选择先提示关闭系统窗口', (await cancelFileDialog.innerText()).includes('系统文件选择窗口'))
    await cancelFileDialog.getByRole('button',{name:'已取消选择'}).click()
    await page.waitForTimeout(100)
    check('确认取消文件选择遵循 Pi 确认协议', (await app.evaluate(()=>globalThis.__confirmResponses.find(item=>item.id==='file-cancel')))?.confirmed===true)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 550))
    await page.keyboard.press('Meta+Shift+L')
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'narrow',method:'select',title:'请选择下一步',options:Array.from({length: 12}, (_, i) => `选项 ${i + 1}`)}))
    const narrowCard = page.locator('.conversation-prompt:not([hidden])')
    await narrowCard.getByRole('heading', {name:'请选择下一步'}).waitFor()
    const layout = await narrowCard.evaluate(el => {
      const card = el.getBoundingClientRect(), input = document.querySelector('.composer').getBoundingClientRect()
      return { cardTop:card.top, cardBottom:card.bottom, inputBottom:input.bottom, viewport:innerHeight, scrolls:el.scrollHeight > el.clientHeight, transition:getComputedStyle(el).transitionDuration, animation:getComputedStyle(el.firstElementChild).animationDuration }
    })
    check('浅色窄窗口中长卡片可滚动且输入框可见', layout.cardTop >= 0 && layout.inputBottom <= layout.viewport && layout.scrolls, JSON.stringify(layout))
    check('减少动态效果时关闭卡片动画', parseFloat(layout.transition) < 0.001 && parseFloat(layout.animation) < 0.001, JSON.stringify(layout))
    await page.screenshot({path:join(dirs.base,'prompt-narrow-light.png'),animations:'disabled'})
    await narrowCard.getByRole('button',{name:'取消请求'}).focus()
    await page.keyboard.press('Enter')
    await narrowCard.waitFor({state:'hidden'})
    check('键盘可以取消请求并保留草稿', await page.locator('.composer-input').inputValue() === '保留的草稿')

  } finally { await app.close() }
}

async function caseComputerUseSettings() {
  const dirs = freshDirs('computer-use-settings')
  let { app, page } = await launch(dirs)
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', {name:'电脑操作', exact:true}).click()
    const toggle = page.getByRole('switch', {name:'启用 Computer Use'})
    await toggle.waitFor({timeout:4000})
    await page.screenshot({ path:join(dirs.base, 'settings.png') })
    check('Computer Use 默认关闭', await toggle.getAttribute('aria-checked') === 'false')
    await toggle.click()
    if (process.platform !== 'darwin') {
      await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="启用 Computer Use"]')?.getAttribute('aria-checked') === 'true')
      check('非 macOS 可以开启电脑操作，不要求辅助功能权限行', await page.locator('.settings-permission-list .desktop-permission-row').count() === 0)
      return
    }
    await page.locator('.settings-permission-list .desktop-permission-row').first().waitFor({timeout:10000})
    const permissionStatus = await page.evaluate(() => window.pi.desktopPermissionCheck())
    check('设置中显示执行组件的权限状态', await page.locator('.settings-permission-list .desktop-permission-row').first().getByText(permissionStatus.accessibility ? (permissionStatus.provisional ? '初步已开启' : '已开启') : '打开辅助功能设置').count() === 1)
    await page.waitForTimeout(200)
    await page.screenshot({ path:join(dirs.base, 'guide.png') })
    check('开启时权限状态直接显示在设置页', await toggle.getAttribute('aria-checked') === 'true' && await page.getByRole('heading',{name:'开启桌面操作权限'}).count() === 0)
    await app.close()
    ;({ app, page } = await launch(dirs))
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', {name:'电脑操作', exact:true}).click()
    const restoredToggle = page.getByRole('switch', {name:'启用 Computer Use'})
    check('重启后保留开关状态', await restoredToggle.getAttribute('aria-checked') === 'true')
    await page.locator('.settings-permission-block').getByRole('button', {name:'重新检测'}).click()
    check('设置中可主动检查权限', await page.locator('.settings-permission-list .desktop-permission-row').count() === 2)
    await restoredToggle.click()
    await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="启用 Computer Use"]')?.getAttribute('aria-checked') === 'false')
    check('可以立即关闭 Computer Use', await restoredToggle.getAttribute('aria-checked') === 'false')
    const guideUrl = new URL(page.url())
    guideUrl.searchParams.set('view', 'permission-guide')
    await page.goto(guideUrl.toString())
    check('权限悬浮提示提供拖动入口和系统添加备用方案', await page.locator('[data-desktop-permission-drag][draggable="true"]').count() === 1 && await page.getByText(/列表下方的「＋」/).count() === 1)
  } finally { await app.close() }
}

async function caseComputerUsePackagePath() {
  if (process.platform !== 'darwin') return
  const dirs = freshDirs('computer-use-package-path')
  const source = join(dirs.base, 'My Project', 'computer-use')
  const marker = join(dirs.base, 'helper-used')
  mkdirSync(join(source, 'bin'), {recursive:true})
  writeFileSync(join(source, 'package.json'), JSON.stringify({name:'pi-desktop-computer-use'}))
  const helper = join(source, 'bin', 'computer-use-helper')
  writeFileSync(helper, '#!/bin/sh\nprintf used > "$PERMISSION_HELPER_MARKER"\nprintf \'{"ok":true,"accessibility":false,"screenRecording":true}\\n\'\n')
  chmodSync(helper, 0o755)
  writeFileSync(join(dirs.agent, 'settings.json'), JSON.stringify({packages:[source]}))
  const { app, page } = await launch(dirs, 'default', { MOCK_LIST_SOURCE:source, MOCK_LIST_DELAY_MS:'1500', PERMISSION_HELPER_MARKER:marker, MOCK_COMPUTER_USE_ROOT:source })
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', {name:'电脑操作',exact:true}).click()
    const start = Date.now()
    await page.getByRole('button', {name:'重新检测'}).waitFor({timeout:1000})
    check('权限检查时界面保持可操作', Date.now()-start < 1000)
    const deadline = Date.now()+10000
    while (!existsSync(marker) && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,100))
    check('带空格的已有扩展使用正确的权限检查组件', existsSync(marker))
    const starting = page.evaluate((cwd) => window.pi.openSession({cwd, scratch:true}), dirs.base)
    const refresh = page.getByRole('button', {name:'重新检测'})
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('重新检测') && !button.disabled), null, {timeout:10000})
    check('启动会话检查扩展时界面保持可操作', await refresh.isVisible())
    const opened = await starting
    check('带空格扩展配置下会话正常启动', opened.ok === true, JSON.stringify(opened))
  } finally { await app.close() }
}

async function caseComputerUsePermissionCompletion() {
  if (process.platform !== 'darwin') return
  const dirs = freshDirs('computer-use-permission-completion')
  const source = join(dirs.base, 'permission-extension')
  const stateFile = join(dirs.base, 'permissions.json')
  mkdirSync(join(source, 'bin'), {recursive:true})
  writeFileSync(join(source, 'package.json'), JSON.stringify({name:'pi-desktop-computer-use'}))
  const helper = join(source, 'bin', 'computer-use-helper')
  writeFileSync(helper, '#!/bin/sh\ncat "$PERMISSION_STATE_FILE"\n')
  chmodSync(helper, 0o755)
  writeFileSync(stateFile, JSON.stringify({ok:true,accessibility:false,screenRecording:false}))
  writeFileSync(join(dirs.agent, 'settings.json'), JSON.stringify({packages:[source]}))
  const {app,page} = await launch(dirs, 'default', {MOCK_LIST_SOURCE:source, MOCK_COMPUTER_USE_ROOT:source, PERMISSION_STATE_FILE:stateFile})
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', {name:'电脑操作',exact:true}).click()
    const toggle = page.getByRole('switch', {name:'启用 Computer Use'})
    const permissionPanel = page.locator('.settings-permission-block')
    const provisionalPermissions = permissionPanel.getByText('初步已开启', {exact:true})
    await toggle.click()
    await permissionPanel.getByRole('button', {name:'打开辅助功能设置'}).waitFor({timeout:10000})
    await permissionPanel.getByRole('button', {name:'打开屏幕录制设置'}).waitFor({timeout:10000})
    writeFileSync(stateFile, JSON.stringify({ok:true,accessibility:true,screenRecording:true}))
    await provisionalPermissions.nth(1).waitFor({timeout:10000})
    check('系统授权后设置页自动更新两项初步权限',
      await provisionalPermissions.count() === 2 && !await permissionPanel.getByRole('button', {name:/^打开.*设置$/}).count())
    await toggle.click()
    await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="启用 Computer Use"]')?.getAttribute('aria-checked') === 'false')
    await toggle.click()
    await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="启用 Computer Use"]')?.getAttribute('aria-checked') === 'true')
    check('已授权再次启用时保留权限状态与当前页面',
      await provisionalPermissions.count() === 2 && !await page.getByRole('heading',{name:'开启桌面操作权限'}).count())

    writeFileSync(stateFile, JSON.stringify({ok:true,accessibility:true,screenRecording:false}))
    await permissionPanel.getByRole('button',{name:'重新检测'}).click()
    await permissionPanel.getByRole('button',{name:'打开屏幕录制设置'}).waitFor({timeout:10000})
    check('主动检查显示变化的单项权限', await provisionalPermissions.count() === 1)
  } finally { await app.close() }
}

async function caseComputerUseProgressUi() {
  const dirs=freshDirs('computer-use-progress-ui')
  const session = seedSession(dirs.sessions, 'mock-session', 'Computer Use fixture', 0)
  const now = Date.now()
  const messages = [
    {role:'user',timestamp:now,content:[{type:'text',text:'测试桌面执行过程'}]},
    {role:'assistant',timestamp:now+1,content:[
      {type:'toolCall',id:'cua-observe',name:'computer_use_observe',arguments:{app:'测试应用'}},
      {type:'toolCall',id:'cua-act',name:'computer_use_act',arguments:{type:'click',elementId:'e1'}},
      {type:'toolCall',id:'cua-file',name:'computer_use_session_act',arguments:{type:'click',candidateId:'b1'}},
      {type:'toolCall',id:'cua-hash',name:'computer_use_session_verify_file',arguments:{expectedName:'data.csv'}},
      {type:'toolCall',id:'cua-wait',name:'computer_use_session_wait',arguments:{name:'完成按钮'}},
      {type:'toolCall',id:'cua-metadata',name:'computer_use_session_verify_file',arguments:{expectedName:'other.csv'}},
      {type:'toolCall',id:'cua-browser-1',name:'computer_use_session_act',arguments:{type:'click',candidateId:'c1'}},
      {type:'toolCall',id:'cua-browser-2',name:'computer_use_session_act',arguments:{type:'click',candidateId:'c1'}}
    ]},
    {role:'toolResult',toolCallId:'cua-observe',toolName:'computer_use_observe',content:[{type:'text',text:'观察结果'}],details:{},timestamp:now+2},
    {role:'toolResult',toolCallId:'cua-act',toolName:'computer_use_act',content:[{type:'text',text:'操作已发出'}],details:{verification:{status:'confirmed'}},timestamp:now+3},
    {role:'toolResult',toolCallId:'cua-file',toolName:'computer_use_session_act',content:[{type:'text',text:'等待文件选择'}],details:{verification:{status:'unavailable',requiresHuman:true,reason:'file_selection'}},timestamp:now+3},
    {role:'toolResult',toolCallId:'cua-hash',toolName:'computer_use_session_verify_file',content:[{type:'text',text:'文件摘要已核对'}],details:{file:{name:'data.csv',size:4,type:'text/csv'},contentVerified:true},timestamp:now+4},
    {role:'toolResult',toolCallId:'cua-wait',toolName:'computer_use_session_wait',content:[{type:'text',text:'等待结束'}],details:{matched:false},timestamp:now+4},
    {role:'toolResult',toolCallId:'cua-metadata',toolName:'computer_use_session_verify_file',content:[{type:'text',text:'文件信息已读取'}],details:{file:{name:'other.csv',size:4,type:'text/csv'}},timestamp:now+4},
    {role:'toolResult',toolCallId:'cua-browser-1',toolName:'computer_use_session_act',isError:true,content:[{type:'text',text:'The action result is unknown because the connection failed.'}],timestamp:now+4},
    {role:'toolResult',toolCallId:'cua-browser-2',toolName:'computer_use_session_act',isError:true,content:[{type:'text',text:'The previous action result is unknown. Inspect the result.'}],timestamp:now+4},
    {role:'assistant',timestamp:now+5,content:[{type:'text',text:'请核对实际业务结果。'}]}
  ]
  writeFileSync(session, messages.map(message => JSON.stringify({type:'message',message})).join('\n')+'\n', {flag:'a'})
  writeFileSync(join(dirs.userData,'settings.json'),JSON.stringify({theme:'dark',workspaces:[root],lastWorkspace:root,turnAutoFold:false}))
  const {app,page}=await launch(dirs,'default',{MOCK_LOAD_SESSION:'1'})
  try {
    await page.getByText('Computer Use fixture', {exact:true}).click()
    await page.getByText('请核对实际业务结果。',{exact:true}).waitFor()
    check('桌面观察显示用户可理解的动作', await page.getByText('已查看桌面',{exact:true}).count()===1)
    check('桌面操作展示变化证据且不声称业务成功', await page.getByText('界面有变化，结果待核对',{exact:true}).count()===1)
    check('文件选择显示等待状态', await page.getByText('等待选择文件',{exact:true}).count()===1)
    check('文件摘要和仅文件信息状态清楚区分', await page.getByText('文件内容摘要已匹配',{exact:true}).count()===1 && await page.getByText('仅核对文件信息',{exact:true}).count()===1)
    check('等待超时显示未等到目标', await page.getByText('未等到目标',{exact:true}).count()===1)
    const unknown = page.getByText('操作结果未知，请核对',{exact:true})
    check('折叠的网页操作分组显示结果未知', await unknown.count()===1)
    await unknown.click()
    check('展开分组后每个未知结果不显示成操作失败', await unknown.count()===3 && await page.getByText('网页操作失败',{exact:true}).count()===0)
    await page.screenshot({path:join(dirs.base,'computer-use-progress.png')})
  } finally {await app.close()}
}

async function caseBrowserDownloads() {
  const server = createServer((req,res) => {
    if (req.url === '/report') return res.writeHead(200, {'content-type':'text/csv','content-disposition':'attachment; filename="report.csv"'}).end('id,value\n1,verified\n')
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'}).end('<title>Downloads</title><a href="/report" download>下载报表</a>')
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const dirs = freshDirs('browser-downloads')
  writeFileSync(join(dirs.userData,'settings.json'),JSON.stringify({theme:'dark',workspaces:[root],lastWorkspace:root,workPanelTabs:['browser'],workPanelTab:'browser'}))
  let app
  try {
    const launched = await launch(dirs,'default',{HOME:dirs.base}); app=launched.app
    const page=launched.page
    await page.keyboard.press('Meta+Shift+B')
    await page.waitForSelector('.browser-toolbar')
    await page.evaluate(url => window.pi.browserOpen(url),url)
    const listeners = () => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].contentView.children.find(child => child.constructor?.name?.includes('WebContentsView')).webContents.session.listenerCount('will-download'))
    const before = await listeners()
    await page.evaluate(() => window.pi.browserClose())
    await page.evaluate(url => window.pi.browserOpen(url),url)
    const after = await listeners()
    check('重开浏览器不会重复注册下载监听', before === after, `${before} → ${after}`)
    const bridgePath=await app.evaluate(()=>process.env.PI_DESKTOP_BROWSER_BRIDGE_FILE)
    const bridge=JSON.parse(readFileSync(bridgePath,'utf8'))
    const endpoint=`http://127.0.0.1:${bridge.port}/downloads`
    const downloadController = randomUUID()
    const query=async()=>{const response=await fetch(endpoint,{headers:{authorization:`Bearer ${bridge.token}`,'x-pi-controller':downloadController,'x-pi-page':'main','x-pi-pid':String(process.pid)}});return {status:response.status,body:await response.json()}}
    const initial=await query()
    check('下载记录只允许认证的本地会话读取', (await fetch(endpoint)).status === 401 && initial.status === 200)
    const extensionSource=readFileSync(join(root,'extensions/computer-use/index.ts'),'utf8')
    const start=extensionSource.indexOf('export default function computerUse(')
    const end=extensionSource.indexOf("  pi.registerTool({\n    name: 'computer_use_apps'",start)
    const registration=stripTypeScriptTypes(extensionSource.slice(start,end).replace('export default function','function')+'\n}')
    const tools=new Map()
    const Type=new Proxy({}, {get:()=> (...args)=>({args})})
    let simulateRestart=false
    const bridgeRequest=async (path, data) => {
      const response=await fetch(`http://127.0.0.1:${bridge.port}${path}`,{method:data?'POST':'GET',headers:{authorization:`Bearer ${bridge.token}`,'x-pi-controller':downloadController,'x-pi-page':'main','x-pi-pid':String(process.pid),...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined})
      const body=await response.json(); if (!response.ok) throw new Error(body.error); if (simulateRestart) body.epoch='restarted'; return body
    }
    const factory=runInNewContext(`${registration}\ncomputerUse`,{BrowserRouter,judgeWithJev,Type,createBrowserActionJournal:()=>undefined,bridgeRequest,randomUUID,URL,setTimeout,process:{env:{}},approvalMode:'always',audit:async()=>{}})
    factory({registerTool:tool=>tools.set(tool.name,tool),on:()=>{}})
    const invoke=async(name,params={})=>tools.get(name).execute('test',params,undefined,undefined,{ui:{confirm:async()=>true}})
    for (let index=1; index<=2; index++) {
      const destination=join(dirs.base,`report-${index}.csv`)
      const result=await app.evaluate(({BrowserWindow},{downloadUrl,destination}) => new Promise((resolve,reject) => {
        const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView'))
        const timeout=setTimeout(()=>reject(new Error('download timed out')),10000)
        view.webContents.session.once('will-download',(_event,item) => {
          item.setSavePath(destination)
          item.once('done',(_event,state)=>{clearTimeout(timeout);resolve(state)})
        })
        view.webContents.downloadURL(downloadUrl)
      }),{downloadUrl:`${url}/report`,destination})
      check(`第 ${index} 次下载真实落盘`,result === 'completed' && readFileSync(destination,'utf8') === 'id,value\n1,verified\n')
      await page.waitForTimeout(200)
      if (index === 1) await invoke('computer_use_session_open',{backend:'inapp'})
    }
    check('两次同名下载各有完成提示',await page.locator('.toast-title').filter({hasText:'下载完成'}).count() === 2)
    const completed=await query()
    check('下载记录包含每次完成状态和用户选定的路径', completed.status === 200 && completed.body.downloads?.length === 2 && completed.body.downloads.every((item,index) => item.state === 'completed' && item.path === join(dirs.base,`report-${index+1}.csv`) && item.bytes === Buffer.byteLength('id,value\n1,verified\n')))
    const scoped=await invoke('computer_use_session_downloads')
    check('Agent 只看到会话开始后的下载并提示核验', scoped.details.downloads.length === 1 && scoped.details.downloads[0].path === join(dirs.base,'report-2.csv') && scoped.content[0].text.includes('not necessarily by Pi'))
    const cancelled=await app.evaluate(({BrowserWindow},downloadUrl)=>new Promise((resolve,reject)=>{
      const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView'))
      const timeout=setTimeout(()=>reject(new Error('cancelled download timed out')),10000)
      view.webContents.session.once('will-download',(_event,item)=>{
        item.once('done',(_event,state)=>{clearTimeout(timeout);resolve(state)})
        item.cancel()
      })
      view.webContents.downloadURL(downloadUrl)
    }),`${url}/report`)
    const afterCancel=await invoke('computer_use_session_downloads')
    const last=afterCancel.details.downloads.at(-1)
    check('取消下载不会报告保存路径', cancelled === 'cancelled' && last?.state === 'cancelled' && !('path' in last))
    await page.waitForTimeout(200)
    check('用户取消下载时显示取消而非故障', await page.locator('.toast-title').filter({hasText:'下载已取消'}).count() === 1)
    await invoke('computer_use_session_close')
    await invoke('computer_use_session_open',{backend:'inapp'})
    check('新会话不会继承旧下载', (await invoke('computer_use_session_downloads')).details.downloads.length === 0)
    const observation=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
    const downloadLink=observation.candidates.find(candidate=>candidate.name==='下载报表')
    if (!downloadLink) throw new Error(`Download link missing: ${JSON.stringify(observation)}`)
    const routedPath=join(dirs.base,'router-report.csv')
    await app.evaluate(({BrowserWindow},destination)=>{
      const view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.constructor?.name?.includes('WebContentsView'))
      view.webContents.session.once('will-download',(_event,item)=>item.setSavePath(destination))
    },routedPath)
    await invoke('computer_use_session_act',{candidateId:downloadLink.id,type:'click'})
    let routed
    for(let attempt=0;attempt<40;attempt++){
      routed=(await invoke('computer_use_session_downloads')).details.downloads.find(item=>item.path===routedPath && item.state==='completed')
      if(routed)break
      await page.waitForTimeout(100)
    }
    check('Pi 浏览器动作触发下载并可独立读取文件', Boolean(routed) && existsSync(routedPath) && readFileSync(routedPath,'utf8') === 'id,value\n1,verified\n')
    simulateRestart=true
    let restartRejected=false
    try { await invoke('computer_use_session_downloads') } catch (error) { restartRejected=/restarted/.test(String(error)) }
    check('桥接重启后不会混淆下载记录', restartRejected)
    await invoke('computer_use_session_close')
  } finally { if(app) await app.close(); await new Promise(resolve=>server.close(resolve)) }
}

async function caseMotionPolish() {
  const dirs = freshDirs('motion-polish')
  const session = seedSession(dirs.sessions, 'motion-session', 'Motion session', 2)
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({
    theme: 'dark', language: 'zh-CN', workspaces: [root], lastWorkspace: root, lastSessionPath: session
  }))
  const { app, page } = await launch(dirs, 'default', { MOCK_LOAD_SESSION: '1' })
  try {
    await page.locator('.message').first().waitFor()
    const historyAnimation = await page.locator('.message').first().evaluate((el) => getComputedStyle(el).animationName)
    check('历史消息不会重新播放入场动画', historyAnimation === 'none', historyAnimation)
  } finally { await app.close() }
}

async function casePromptFeedback() {
  const dirs = freshDirs('prompt-feedback')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [root], lastWorkspace: root }))
  const { app, page } = await launch(dirs, 'default', { MOCK_PROMPT_START_DELAY: '800', MOCK_PROMPT_DELAY: '1400', MOCK_FIRST_RESPONSE_DELAY: '1000' })
  try {
    await page.locator('.composer-input').fill('等待反馈测试')
    await page.locator('.composer-input').press('Enter')
    await page.getByRole('status').filter({ hasText: '正在发送…' }).waitFor({ timeout: 500 })
    check('发送后立即显示发送中', true)
    await page.getByRole('status').filter({ hasText: '等待模型响应…' }).waitFor({ timeout: 3000 })
    check('请求开始后显示等待模型响应', true)
    await page.screenshot({ path: 'output/prompt-feedback.png' })
    await page.getByText(/mock reply/).first().waitFor({ timeout: 6000 })
    await page.waitForFunction(() => !document.querySelector('.activity'))
    check('回复完成后等待提示消失', true)
  } finally { await app.close() }
}

async function caseGeneralTaskSuggestions() {
  const dirs = freshDirs('general-task-suggestions')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({theme:'dark',language:'zh-CN',workspaces:[root],lastWorkspace:root}))
  const {app,page} = await launch(dirs)
  try {
    const input = page.locator('.composer-input')
    await input.fill(Array(15).fill('示例内容').join('\n'))
    await page.waitForTimeout(200)
    await input.fill('')
    await page.waitForTimeout(200)
    const height = await input.evaluate((el) => ({ current: el.getBoundingClientRect().height, minimum: parseFloat(getComputedStyle(el).minHeight) }))
    check('新会话中清空长内容恢复输入框高度', Math.abs(height.current - height.minimum) < 2, JSON.stringify(height))
    await page.screenshot({ path: 'output/composer-restored.png' })
    const buttons = ['研究一个问题','整理文件资料','规划并执行任务','了解这个项目']
    check('新会话同时展示业务和项目入口', (await Promise.all(buttons.map(name => page.getByRole('button',{name,exact:true}).count()))).every(count => count === 1))
    await page.getByRole('button',{name:'规划并执行任务',exact:true}).click()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value.includes('先拆解步骤'))
    const value = await page.locator('.composer-input').inputValue()
    check('示例只填入可编辑草稿', value.includes('先拆解步骤') && (await page.locator('.turn').count()) === 0)
    await page.getByRole('button',{name:'了解这个项目',exact:true}).click()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value.includes('请介绍当前项目'))
    const switched = await page.locator('.composer-input').inputValue()
    check('切换示例替换前一个示例，重复点击不累加', !switched.includes('先拆解步骤') && switched.split('请介绍当前项目').length === 2, switched)
    await page.getByRole('button',{name:'了解这个项目',exact:true}).click()
    check('重复点击示例不增加内容', await page.locator('.composer-input').inputValue() === switched)
    await page.locator('.composer-input').fill('用户已有草稿')
    await page.getByRole('button',{name:'研究一个问题',exact:true}).click()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value.includes('帮我研究这个问题'))
    const appended = await page.locator('.composer-input').inputValue()
    check('选择示例不会覆盖已有草稿', appended.startsWith('用户已有草稿') && appended.includes('帮我研究这个问题'))
    await page.getByRole('button',{name:'整理文件资料',exact:true}).click()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value.includes('帮我整理这些文件'))
    const preserved = await page.locator('.composer-input').inputValue()
    check('保留用户草稿并切换示例', preserved.startsWith('用户已有草稿') && !preserved.includes('帮我研究这个问题'), preserved)
    await page.locator('.composer-input').fill(`${preserved} 用户补充`)
    await page.getByRole('button',{name:'规划并执行任务',exact:true}).click()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value.includes('先拆解步骤'))
    check('切换时保留示例外的补充文字', (await page.locator('.composer-input').inputValue()).includes('用户补充'))
    await page.screenshot({path:join(dirs.base,'general-task-suggestions.png')})
  } finally { await app.close() }
}

async function caseBundledSeed() {
  const dirs = freshDirs('bundled-seed')
  // Disposable seed root: tests must not write into the real build/pi-seed.
  const tempSeedRoot = join(dirs.base, 'seed-root')
  const seedDir = join(tempSeedRoot, '0.0.0-e2e')
  mkdirSync(seedDir, { recursive: true })
  const seedLauncher = join(seedDir, 'pi')
  writeFileSync(seedLauncher, '#!/bin/sh\necho 0.0.0-e2e\n')
  chmodSync(seedLauncher, 0o755)
  const { app, page } = await launch(dirs, 'default', {
    PI_DESKTOP_PI_PATH: join(dirs.base, 'missing-pi'),
    PI_DESKTOP_SEED_ROOT: tempSeedRoot,
    PATH: '/usr/bin:/bin',
    SHELL: '/bin/sh',
    PI_DESKTOP_SKIP_AUTO_INSTALL: '1'
  })
  try {
    await page.locator('.welcome').waitFor({ timeout: 10000 })
    check('有内置 seed 时不会要求联网安装', await page.locator('.welcome-setup').count() === 0)
    await page.getByRole('button', { name: '连接模型', exact: true }).click()
    await page.locator('.connect-model').waitFor({ timeout: 5000 })
    check('连接面板留在当前页', await page.locator('.settings-page').count() === 0)
    check('连接面板提供 API Key 与账号登录', await page.getByRole('tab', { name: '通过 API Key 连接' }).count() === 1 && await page.getByRole('tab', { name: '通过账号连接' }).count() === 1)
  } finally {
    await app.close()
    rmSync(tempSeedRoot, { recursive: true, force: true })
  }
}

async function caseProviderAuth() {
  const dirs = freshDirs('provider-auth')
  const { app, page } = await launch(dirs)
  try {
    const providers = await page.evaluate(async () => {
      await window.pi.saveApiKey('openai', 'sk-test-123')
      return window.pi.listAuthProviders()
    })
    const auth = JSON.parse(readFileSync(join(dirs.agent, 'auth.json'), 'utf8'))
    check('API Key 写入 pi auth.json', auth.openai?.type === 'api_key' && auth.openai?.key === 'sk-test-123', JSON.stringify(auth))
    check('auth.json 权限为 0600', (statSync(join(dirs.agent, 'auth.json')).mode & 0o777) === 0o600)
    check('auth 列表不返回密钥', providers.some((item) => item.provider === 'openai' && item.type === 'api_key') && !JSON.stringify(providers).includes('sk-test-123'))
  } finally { await app.close() }
}

async function caseProviderOAuth() {
  const dirs = freshDirs('provider-oauth')
  const { app, page } = await launch(dirs)
  try {
    let providers
    try {
      providers = await page.evaluate(() => window.pi.listOAuthProviders())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      check('IPC 错误不带 Electron 前缀', !/Error invoking remote method/.test(message), message.split('\n')[0])
      if (/认证模块|内置 Pi runtime|暂不支持账号登录/.test(message)) {
        check('当前环境没有内置 Pi 认证模块，跳过 OAuth 发现', true, message.split('\n')[0])
        await page.getByRole('button', { name: '设置', exact: true }).click().catch(() => undefined)
        return
      }
      throw error
    }
    check('OAuth 服务商列表来自 pi ModelRuntime', providers.some((provider) => provider.id === 'openai' && provider.oauth))
    check('OAuth 列表只显示支持账号授权的服务商', providers.every((provider) => provider.oauth))
    const runtimeProviders = await page.evaluate(() => window.pi.listRuntimeAuthProviders())
    check('服务商分类来自 Pi 运行时，包括 API Key 服务', runtimeProviders.some((provider) => provider.id === 'opencode-go' && provider.apiKey) && runtimeProviders.some((provider) => provider.oauth))
    const invalid = await page.evaluate(() => window.pi.startOAuth('unknown-provider-xyz'))
    check('未知 OAuth 服务商不会启动', invalid.ok === false)
  } finally { await app.close() }
}

async function caseOAuthUnavailableUi() {
  const dirs = freshDirs('oauth-unavailable-ui')
  // Seed launcher without auth module, in a disposable seed root (never touch
  // the real build/pi-seed: a hard-killed test must not misplant the repo).
  const seedRootDir = join(dirs.base, 'seed-root')
  const seedDir = join(seedRootDir, '0.0.0-oauth-ui')
  const seedLauncher = join(seedDir, 'pi')
  mkdirSync(seedDir, { recursive: true })
  writeFileSync(seedLauncher, '#!/bin/sh\necho 0.0.0-oauth-ui\n')
  chmodSync(seedLauncher, 0o755)
  let app
  try {
    const launched = await launch(dirs, 'default', {
      PI_DESKTOP_PI_PATH: join(dirs.base, 'missing-pi'),
      PI_DESKTOP_SEED_ROOT: seedRootDir,
      PATH: '/usr/bin:/bin',
      SHELL: '/bin/sh'
    })
    app = launched.app
    const page = launched.page
    await page.getByRole('button', { name: '连接模型', exact: true }).click()
    await page.locator('.connect-model').waitFor()
    await page.getByRole('tab', { name: '通过账号连接' }).click()
    await page.getByText('当前版本暂不支持账号登录，请用 API Key').waitFor({ timeout: 8000 })
    check('连接面板账号页无空下拉', await page.locator('.connect-model select').count() === 0)
    const message = await page.evaluate(async () => {
      try {
        await window.pi.listOAuthProviders()
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })
    check('账号登录不可用时错误为中文短句', /暂不支持账号登录/.test(message) && !/Error invoking remote method/.test(message), message)
  } finally {
    if (app) await app.close().catch(() => undefined)
    rmSync(seedRootDir, { recursive: true, force: true })
  }
}

async function caseSessionSearch() {
  const dirs = freshDirs('session-search')
  seedSession(dirs.sessions, 'search-source', 'Search needle', 1, dirs.base)
  const { app, page } = await launch(dirs)
  try {
    await page.waitForTimeout(2500)
    await page.locator('.search-box input').fill('needle')
    await page.locator('.session-search-hit').first().waitFor({ timeout: 10000 })
    check('侧栏可以搜索会话消息内容', await page.locator('.session-search-snippet').first().innerText().then((text) => text.toLowerCase().includes('needle')))
    await page.locator('.session-search-hit').first().click()
    await page.waitForTimeout(600)
    check('搜索结果可以点击打开', await page.locator('.session-search-hit').count() === 1)
  } finally { await app.close() }
}

async function caseSessionBranching() {
  const dirs = freshDirs('session-branching')
  const session = seedSession(dirs.sessions, 'branch-source', 'Branch source', 1, dirs.base)
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [dirs.base], lastWorkspace: dirs.base, lastSessionPath: session }))
  const { app, page } = await launch(dirs)
  try {
    await page.locator('.session-menu-button').first().click()
    await page.getByText('复制会话', { exact: true }).click()
    await page.waitForTimeout(800)
    const cloned = readdirSync(dirs.sessions, { recursive: true }).filter((name) => String(name).includes('clone'))
    check('侧栏菜单可以复制当前会话', cloned.length > 0, JSON.stringify(cloned))
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('pi:fork-current-session')))
    await page.getByRole('heading', { name: '从历史提示分支' }).waitFor()
    check('分支弹窗列出历史提示', await page.getByText('first prompt', { exact: true }).isVisible())
    await page.locator('.fork-message-item').first().click()
    check('分支前可以编辑要重新发送的提示', await page.locator('.fork-edit-field textarea').isVisible())
    await page.getByRole('button', { name: '分支并编辑' }).click()
    await page.waitForTimeout(800)
    const forked = readdirSync(dirs.sessions, { recursive: true }).filter((name) => String(name).includes('fork'))
    check('从历史提示可以创建分支会话', forked.length > 0, JSON.stringify(forked))
  } finally { await app.close() }
}

async function caseSessionTree() {
  const dirs = freshDirs('session-tree')
  const session = seedSession(dirs.sessions, 'tree-source', 'Tree source', 1, dirs.base)
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [dirs.base], lastWorkspace: dirs.base, lastSessionPath: session }))
  const { app, page } = await launch(dirs)
  try {
    await page.locator('.session-menu-button').first().click()
    await page.getByText('查看分支树', { exact: true }).click()
    await page.getByRole('heading', { name: '分支树' }).waitFor()
    check('分支树显示用户提示', await page.getByText('first prompt', { exact: true }).isVisible())
    check('分支树显示后续分支', await page.getByText('second prompt', { exact: true }).isVisible())
    check('分支树标记当前叶子', await page.locator('.tree-current').count() === 1)
    await page.locator('.tree-row.clickable').first().click()
    await page.waitForTimeout(800)
    const forked = readdirSync(dirs.sessions, { recursive: true }).filter((name) => String(name).includes('fork'))
    check('分支树节点可以创建分支', forked.length > 0, JSON.stringify(forked))
  } finally { await app.close() }
}

async function caseFileAttachment() {
  const dirs = freshDirs('file-attachment')
  const project = join(dirs.base, 'attachment-project')
  mkdirSync(project, { recursive: true })
  const attached = join(project, 'notes.txt')
  writeFileSync(attached, 'ATTACHMENT_CONTENT_42\nsecond line\n')
  const longFile = join(project, 'long.txt')
  writeFileSync(longFile, 'a'.repeat(70000))
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project }))
  const { app, page } = await launch(dirs)
  try {
    await page.locator('input[type=file]').setInputFiles([attached, longFile])
    await page.locator('.attachment.file').first().waitFor({ timeout: 5000 })
    check('非图片文件显示为附件卡片', await page.locator('.attachment.file').getByText('notes.txt').isVisible())
    check('长附件标明只内嵌部分内容', await page.locator('.attachment.file').filter({ hasText: 'long.txt' }).getByText('部分内容，需读取文件').isVisible())
    await page.locator('.composer-input').fill('请阅读这个附件')
    await page.locator('.send-button').click()
    await page.waitForTimeout(800)
    const body = await page.locator('body').innerText()
    check('文件附件内容随提示发送', body.includes('ATTACHMENT_CONTENT_42'))
    check('文件附件显示路径', body.includes(attached))
    check('发送内容明确标识长附件未完整内嵌', body.includes('附件内容未完整内嵌'))
  } finally { await app.close() }
}

async function caseFileMention() {
  const dirs = freshDirs('file-mention')
  const project = join(dirs.base, 'mention-project')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'notes.txt'), 'mention test\n')
  writeFileSync(join(project, 'app.ts'), 'export const app = true\n')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project }))
  const { app, page } = await launch(dirs)
  try {
    await page.locator('.composer-input').fill('@notes')
    await page.locator('.mention-menu').waitFor({ timeout: 10000 })
    check('输入 @ 会列出项目文件', await page.locator('.mention-path').first().innerText().then((text) => text.includes('notes.txt')))
    await page.locator('.mention-menu .command-item').first().click()
    const value = await page.locator('.composer-input').inputValue()
    check('选择文件会插入 @ 路径', value.includes('@notes.txt'), value)
  } finally { await app.close() }
}

async function caseProjectTrust() {
  const dirs = freshDirs('project-trust')
  const project = join(dirs.base, 'trusted-project')
  mkdirSync(join(project, '.pi', 'skills', 'local-skill'), { recursive: true })
  writeFileSync(join(project, '.pi', 'skills', 'local-skill', 'SKILL.md'), '---\nname: local\ndescription: local test\n---\n')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project }))
  const { app, page } = await launch(dirs)
  try {
    const activeProject = page.locator('.project-row.active')
    const manage = page.getByRole('dialog', { name: '项目信任' })
    await activeProject.waitFor()
    check('未信任项目的对话中不显示横幅或弹窗', !await page.locator('.project-trust-banner, .project-trust-collapsed').count() && !await manage.count())
    await activeProject.hover()
    await activeProject.getByRole('button', { name: '项目操作' }).click()
    await page.getByRole('menuitem', { name: '项目信任', exact: true }).click()
    await manage.waitFor()
    check('信任弹窗展示检测到的资源', await page.locator('.project-trust-resources').getByText(join(project, '.pi', 'skills')).isVisible())
    await page.locator('.project-trust-option.primary').click()
    await manage.waitFor({ state: 'hidden' })
    const trust = JSON.parse(readFileSync(join(dirs.agent, 'trust.json'), 'utf8'))
    check('桌面端可写入项目信任文件', trust[project] === true, JSON.stringify(trust))
  } finally { await app.close() }
}

async function caseAddProject() {
  const dirs = freshDirs('add-project')
  const settingsPath = join(dirs.userData, 'settings.json')
  const trustPath = join(dirs.agent, 'trust.json')
  const plain = join(dirs.base, 'plain-folder')
  const trusted = join(dirs.base, 'trusted-folder')
  const restricted = join(dirs.base, 'restricted-folder')
  mkdirSync(plain)
  for (const folder of [trusted, restricted]) {
    mkdirSync(join(folder, '.pi', 'extensions'), { recursive: true })
    writeFileSync(join(folder, '.pi', 'extensions', 'fixture.ts'),
      "export default pi => pi.registerCommand('project-add-fixture', { description: 'isolated test', handler: async () => {} })\n")
  }
  writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [], autoCheckUpdates: false }))
  const realPi = process.env.PI_TEST_PI
  const { app, page } = await launch(dirs, 'default', realPi ? { PI_DESKTOP_PI_PATH: realPi, PI_OFFLINE: '1' } : {})
  try {
    const settings = () => JSON.parse(readFileSync(settingsPath, 'utf8'))
    const trust = () => JSON.parse(readFileSync(trustPath, 'utf8'))
    const modal = (title) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    const setup = modal('添加项目')
    const confirmation = modal('信任此项目？')
    const choose = async (folder) => {
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, folder)
      await page.locator('.project-add').click()
      await setup.getByRole('button', { name: '选择文件夹', exact: true }).click()
      await setup.getByRole('button', { name: '更换文件夹', exact: true }).waitFor()
    }
    const showTrust = async (name) => {
      await setup.getByRole('textbox', { name: '项目名称' }).fill(name)
      await setup.getByRole('button', { name: '添加项目', exact: true }).click()
      await confirmation.waitFor()
    }
    const hasFixtureCommand = async () => page.evaluate(async () => {
      const { data } = await window.pi.command({ type: 'get_commands' })
      return data?.commands.some((command) => command.name === 'project-add-fixture')
    })
    await choose(plain)
    check('选择文件夹后预填目录名，尚未创建项目', await setup.getByRole('textbox', { name: '项目名称' }).inputValue() === 'plain-folder' && settings().workspaces.length === 0)
    await showTrust('待取消项目')
    check('首次添加普通文件夹也会确认信任', await confirmation.isVisible() && !existsSync(trustPath))
    await confirmation.getByRole('button', { name: '返回', exact: true }).click()
    check('从信任确认返回时保留项目名称', await setup.getByRole('textbox', { name: '项目名称' }).inputValue() === '待取消项目')
    await setup.getByRole('button', { name: '取消', exact: true }).click()
    check('取消添加不写入项目或信任', settings().workspaces.length === 0 && !existsSync(trustPath))

    await choose(trusted)
    await showTrust('经营分析')
    check('信任弹窗显示项目资源，确认前未启动项目', await confirmation.getByText('.pi/extensions', { exact: true }).isVisible() && settings().workspaces.length === 0)
    await confirmation.getByRole('button', { name: '信任并加载', exact: true }).click()
    await confirmation.waitFor({ state: 'hidden' })
    await page.locator('.project-row.active').getByText('经营分析', { exact: true }).waitFor()
    check('保存名称与信任并进入项目', settings().workspaceNames[trusted] === '经营分析' && trust()[trusted] === true &&
      await page.locator('.topbar-path').innerText() === '经营分析' && !await page.locator('.project-trust-banner').count())
    if (realPi) check('真实 Pi 在信任后加载项目扩展', await hasFixtureCommand())

    await choose(restricted)
    await showTrust('只查看文件')
    await confirmation.getByRole('button', { name: '继续，不加载', exact: true }).click()
    await confirmation.waitFor({ state: 'hidden' })
    await page.locator('.project-row.active').getByText('只查看文件', { exact: true }).waitFor()
    check('拒绝加载后进入项目且不再显示信任横幅', trust()[restricted] === false && !await page.locator('.project-trust-banner').count())
    if (realPi) check('真实 Pi 在拒绝后跳过项目扩展', !await hasFixtureCommand())
    await page.locator('.project-row.active').hover()
    await page.locator('.project-row.active .project-remove').click()
    await page.getByRole('menuitem', { name: '项目信任', exact: true }).click()
    const manage = modal('项目信任')
    await manage.getByText('项目扩展未启用', { exact: true }).waitFor()
    await manage.getByRole('button', { name: '关闭', exact: true }).last().click()

    await choose(trusted)
    await setup.getByRole('button', { name: '打开项目', exact: true }).click()
    await setup.waitFor({ state: 'hidden' })
    check('重复打开保留名称和已有信任决定', !await confirmation.count() && settings().workspaces.length === 2 && settings().workspaceNames[trusted] === '经营分析')
    await page.reload()
    await page.locator('.project-row').getByText('经营分析', { exact: true }).waitFor()
    check('重开界面后自定义项目名称仍存在', await page.locator('.project-row').getByText('只查看文件', { exact: true }).isVisible())
  } finally {
    await app.close()
  }
}

async function caseFirstRunSetup() {
  const dirs = freshDirs('first-run-setup')
  const { app, page } = await launch(dirs, 'default', {
    PI_DESKTOP_PI_PATH: join(dirs.base, 'missing-pi'),
    PATH: '/usr/bin:/bin',
    SHELL: '/bin/sh',
    PI_DESKTOP_SKIP_AUTO_INSTALL: '1',
    PI_DESKTOP_SKIP_SEED: '1'
  })
  try {
    await page.locator('.welcome-setup').waitFor({ timeout: 10000 })
    const setup = await page.locator('.welcome-setup').innerText()
    check('缺少运行时时显示准备引导', /约 1 分钟/.test(setup))
    check('首次准备提供准备与重新检测', await page.getByRole('button', {name:'开始准备', exact: true}).isVisible() && await page.getByRole('button', {name:'重新检测', exact: true}).isVisible())
    check('缺少运行时时不展示打开项目主操作', await page.getByRole('button', {name:'打开项目'}).count() === 0)
    await page.locator('.welcome-setup').getByRole('button', {name:'重新检测', exact: true}).click()
    await page.getByText('还没准备好').waitFor({ timeout: 5000 })
    check('重新检测会给出明确错误', true)
    await page.screenshot({ path: join(dirs.base, 'first-run.png') })
  } finally { await app.close() }
}

const CASES = [
  { tags: ['browser-downloads'], label: 'Browser downloads', run: caseBrowserDownloads },
  { tags: ['first-run'], label: 'first-run Pi installation', run: caseFirstRunSetup },
  { tags: ['motion-polish'], label: 'message motion polish', run: caseMotionPolish },
  { tags: ['project-trust'], label: 'project trust flow', run: caseProjectTrust },
  { tags: ['add-project'], label: 'project onboarding and trust', run: caseAddProject },
  { tags: ['file-attachment'], label: 'file attachment composer', run: caseFileAttachment },
  { tags: ['file-mention'], label: '@file workspace mention', run: caseFileMention },
  { tags: ['session-branching'], label: 'clone and fork sessions', run: caseSessionBranching },
  { tags: ['session-search'], label: 'full text session search', run: caseSessionSearch },
  { tags: ['session-tree'], label: 'session tree view', run: caseSessionTree },
  { tags: ['provider-oauth'], label: 'provider OAuth provider discovery', run: caseProviderOAuth },
  { tags: ['provider-oauth', 'oauth-unavailable'], label: 'OAuth unavailable UI', run: caseOAuthUnavailableUi },
  { tags: ['provider-auth'], label: 'provider API key storage', run: caseProviderAuth },
  { tags: ['pi-seed'], label: 'bundled Pi runtime seed', run: caseBundledSeed },
  { tags: ['prompt-feedback'], label: 'prompt feedback', run: casePromptFeedback },
  { tags: ['general-task-suggestions'], label: 'General task suggestions', run: caseGeneralTaskSuggestions },
  { tags: ['computer-use-progress-ui'], label: 'Computer Use progress presentation', run: caseComputerUseProgressUi },
  { tags: ['computer-use-completion'], label: 'Computer Use permission completion', run: caseComputerUsePermissionCompletion },
  { tags: ['computer-use-permissions'], label: 'Computer Use permission guide', run: caseComputerUsePermissions },
  { tags: ['computer-use-settings'], label: 'Computer Use settings', run: caseComputerUseSettings },
  { tags: ['computer-use-package-path'], label: 'Computer Use configured package path', run: caseComputerUsePackagePath },
  { tags: ['chrome-bridge-guide'], label: 'Chrome bridge setup guide', run: caseChromeBridgeGuide },
  { tags: ['browser-router'], label: 'browser router status', run: caseBrowserRouter },
  { tags: ['chrome-bridge-upgrade'], label: 'Chrome bridge upgrade', run: caseChromeBridgeUpgrade },
  { tags: ['desktop-selects'], label: 'desktop select controls', run: caseDesktopSelects },
  { tags: ['background-model-process'], label: 'background model process', run: caseBackgroundModelProcess },
  { tags: ['provider-connection-flow'], label: 'provider connection flow', run: caseProviderConnectionFlow },
  { tags: ['language', 'settings'], label: 'language / settings menu', run: caseLanguage },
  { tags: ['composer'], label: 'composer safety (IME, draft)', run: caseComposerSafety },
  { tags: ['command-registry'], label: 'command registry unavailable', run: caseCommandRegistryUnavailable },
  { tags: ['menu', 'keyboard'], label: 'model menu: scroll + keyboard', run: caseMenuScrollAndKeyboard },
  { tags: ['panel'], label: 'work panel', run: caseWorkPanel },
  { tags: ['panel-landing'], label: 'empty work panel landing', run: caseWorkPanelLanding },
  { tags: ['browser'], label: 'in-app browser', run: caseBrowser },
  { tags: ['chrome-import', 'browser'], label: 'Chrome cookie import', run: caseChromeImport },
  { tags: ['usage'], label: 'usage trend chart', run: caseUsageTrend },
  { tags: ['polish', 'files', 'export'], label: 'polish: files / export / lightbox', run: casePolish },
  { tags: ['chat-media'], label: 'chat: inline video, SVG images and diagrams', run: caseChatMedia },
  { tags: ['historical-page'], label: 'chat: inline preview for historical HTML artifacts', run: caseHistoricalPage },
  { tags: ['project-deliverables'], label: 'chat: project selection and turn deliverables', run: caseProjectDeliverables },
  { tags: ['streaming-scroll'], label: 'streaming scroll', run: caseStreamingScroll },
  { tags: ['virtual', 'scroll'], label: 'virtualization', run: caseVirtualization },
  { tags: ['fold', 'turns'], label: 'turns / folding', run: caseTurnsFold },
  { tags: ['fold', 'steps', 'tools'], label: 'process steps (merged tool calls)', run: caseProcessSteps },
  { tags: ['operation-details'], label: 'chat operation timeline and native edit patch', run: caseOperationDetails },
  { tags: ['fold'], label: 'fold persistence', run: caseFoldPersistence },
  { tags: ['defaults', 'turns'], label: 'default: process visible', run: caseDefaultVisibility },
  { tags: ['turn-timing'], label: 'turn and thinking timers', run: caseTurnTiming },
  { tags: ['rail', 'hover'], label: 'turn rail: slope + preview', run: caseTurnRailPreview },
  { tags: ['conversation-gestures'], label: 'conversation navigation gestures', run: caseConversationGestures },
  { tags: ['native-scroll-monitor'], label: 'macOS scroll phase monitor', run: caseNativeScrollMonitor },
  { tags: ['system-theme'], label: 'system theme', run: caseSystemTheme },
  { tags: ['composer', 'composer-ui'], label: 'composer: plus + chip order', run: caseComposerLayout },
  { tags: ['composer', 'model-providers'], label: 'composer: model provider menu and thinking control', run: caseModelProviderMenu },
  { tags: ['composer', 'new-chat-layout'], label: 'new chat layout and upward composer menus', run: caseNewChatLayout },
  { tags: ['composer', 'slash-menu'], label: 'composer: slash menu keyboard + no-match', run: caseSlashMenu },
  { tags: ['draft-navigation'], label: 'composer: save drafts across chat navigation', run: caseDraftNavigation },
  { tags: ['package-inspection'], label: 'package permission preview', run: casePackageInspection },
  { tags: ['update-download'], label: 'update download entry', run: caseUpdateDownload },
  { tags: ['jev-settings'], label: 'Jev settings + key storage', run: caseJevSettings },
  { tags: ['creator-inline'], label: 'inline creator activation with real Pi', run: caseCreatorInline },
  { tags: ['creator'], label:'Pi creator mode and real package lifecycle', run:()=>caseCreator({freshDirs,launch,check}) },
  { tags: ['package-catalog'], label: 'npm plugin catalog', run: casePackageCatalog },
  { tags: ['navigation-gestures'], label: 'Mac trackpad navigation', run: () => caseNavigationGestures({ freshDirs, launch, check }) },
  { tags: ['readme-locales'], label: 'Author README language and opt-in AI', run: () => caseReadmeLocales({ freshDirs, launch, check }) },
  { tags: ['readme-images'], label: 'README image fallbacks', run: () => caseReadmeImages({ freshDirs, launch, check }) },
  { tags: ['package-details'], label: 'npm plugin details API (live read-only)', run: casePackageDetails },
  { tags: ['plugin-navigation'], label: 'top-level Pi plugins navigation', run: casePluginNavigation },
  { tags: ['jev-env'], label: 'Jev child env', run: caseJevEnv },
  { tags: ['sandbox'], label: 'OS sandbox filesystem guard', run: caseSandbox },
  { tags: ['proxy-env'], label: 'proxy environment', run: caseProxyEnv },
  { tags: ['network-settings'], label: 'permissions and networking settings', run: caseNetworkSettings },
  { tags: ['conversation-permissions'], label: 'conversation permissions and recovery', run: caseConversationPermissions },
  { tags: ['update-download-real'], label: 'real update download checksum', run: caseUpdateDownloadReal },
  { tags: ['work-edit-commit'], label: 'work panel edit + git commit', run: caseWorkEditCommit },
  { tags: ['skills', 'plugins'], label: 'skills & plugins page', run: caseSkillsPage },
  { tags: ['schedules'], label: 'scheduled tasks', run: caseSchedules },
  { tags: ['schedules', 'schedules-recovery'], label: 'scheduled task restart recovery', run: caseScheduleRecovery },
  { tags: ['schedules', 'schedules-interrupted'], label: 'scheduled run interrupted by quit', run: caseScheduleInterrupted },
  { tags: ['session-security'], label: 'per-session security status', run: caseSessionSecurity },
  { tags: ['schedules', 'schedules-missing-project'], label: 'scheduled task missing project', run: caseScheduleMissingProject },
  { tags: ['schedules', 'schedules-sandbox'], label: 'scheduled task sandbox', run: caseScheduleSandbox },
  { tags: ['schedules', 'schedules-phase3'], label: 'headless scheduler tick', run: caseScheduleHeadlessTick },
  { tags: ['schedules', 'schedules-phase2'], label: 'cron, timezone, continue session, tools', run: caseScheduleAdvanced },
  { tags: ['schedules', 'schedules-failures'], label: 'consecutive failures pause', run: caseScheduleFailures },
  { tags: ['schedules', 'schedules-event'], label: 'file-change trigger', run: caseScheduleEvent },
  { tags: ['sidebar', 'scratch'], label: 'new chat without project', run: caseScratchChat },
  { tags: ['scratch-isolation'], label: 'independent temporary workspaces', run: caseScratchIsolation },
  { tags: ['sandbox-real-browser'], label: 'real Pi in-app browser under sandbox', run: caseSandboxRealBrowser },
  { tags: ['scratch-startup'], label: 'new chat startup surface', run: caseScratchStartup },
  { tags: ['scratch-trust'], label: 'new chat restoration and project trust', run: caseScratchRestoreTrust },
  { tags: ['schedules', 'schedules-slash'], label: '/schedule composer command', run: caseScheduleSlash },
  { tags: ['schedules', 'schedules-bridge'], label: 'chat scheduling bridge CLI', run: caseScheduleBridge },
  { tags: ['schedules', 'schedules-notice'], label: 'one-time completion notice', run: caseScheduleNotice },
  { tags: ['session-pins'], label: 'sidebar: pinned conversations', run: caseSessionPins },
  { tags: ['session-archive'], label: 'sidebar: archived conversations', run: caseSessionArchive },
  { tags: ['sidebar', 'sidebar-layout'], label: 'sidebar: projects + recent', run: caseSidebarLayout },
  { tags: ['sidebar', 'background-session-status'], label: 'sidebar: background session status', run: caseBackgroundSessionStatus },
  { tags: ['sidebar', 'project-removal'], label: 'remove project from sidebar', run: caseProjectRemoval },
  { tags: ['project-removal'], label: 'prevent removing running projects', run: caseProjectRemovalBusy },
  { tags: ['project-removal'], label: 'project removal rollback', run: caseProjectRemovalRollback },
  { tags: ['fold', 'autofold'], label: 'auto fold on answer', run: caseAutoFoldOnAnswer },
  { tags: ['menu', 'wheel', 'scroll'], label: 'wheel isolation', run: caseWheelIsolation },
  { tags: ['menu', 'typing'], label: 'menu typing', run: caseMenuTyping },
  { tags: ['streaming'], label: 'streaming guard', run: caseStreamingGuard },
  { tags: ['restore', 'session'], label: 'session restore', run: caseSessionRestore },
  { tags: ['diagnostics'], label: 'diagnostics', run: caseDiagnostics },
  { tags: ['delete', 'session'], label: 'delete + undo', run: caseDeleteUndo },
  { tags: ['sidebar', 'project-stability'], label: 'project stays in sidebar', run: caseProjectStability },
  { tags: ['sidebar'], label: 'sidebar affordances', run: caseSidebarAffordance }
]

if (process.argv.includes('--list')) {
  for (const item of CASES) console.log(`${item.tags.join(',').padEnd(22)} ${item.label}`)
  process.exit(0)
}

try {
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
} catch (error) {
  console.error('could not reset e2e tmp:', error)
}
for (const item of CASES) {
  if (wants.length && !item.tags.some((tag) => wants.includes(tag))) continue
  console.log(`\n${item.tags[0]}: ${item.label}`)
  try {
    await Promise.race([
      item.run(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('case timed out')), 240000))
    ])
  } catch (error) {
    const lines = error instanceof Error ? error.message.split('\n') : [String(error)]
    const waiting = lines.find((line) => line.includes('waiting for'))
    check(`${item.tags[0]} crashed`, false, waiting ? `${lines[0]} — ${waiting.trim()}` : lines[0])
    try { execFileSync('pkill', ['-f', 'node_modules/electron/dist/electron']) } catch { /* no leftover window */ }
  }
}
if (wants.length) console.log(`\n(e2e filter: ${wants.join(',')})`)

const passed = results.filter((item) => item.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(failures ? 1 : 0)
