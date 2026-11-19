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
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { BrowserRouter } from '../extensions/computer-use/src/browser-router.ts'
import { BrowserActionJournal } from '../extensions/computer-use/src/browser-action-journal.ts'
import { judgeWithJev } from '../extensions/computer-use/src/jev.ts'

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
if (!existsSync(outMain) || Math.max(newestSourceMtime(join(root, 'src')), newestSourceMtime(join(root, 'extensions', 'computer-use', 'src'))) > statSync(outMain).mtimeMs) {
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
  check('选中的模型写回输入区', chip === 'Mock Bulk 0', chip)

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
  await dragHandle(-110)
  const widthWide = await panelWidth()
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
    await page.getByRole('button', { name: '网络与沙箱', exact: true }).click()
    await page.waitForSelector('.settings-section-lead')
    const pageText = await page.locator('.settings-content').innerText()
    check('网络与沙箱是独立设置页', /打开保护/.test(pageText) && !/启用沙箱/.test(pageText))
    check('安全设置显示当前保护状态摘要', (await page.locator('.settings-status-summary').count()) === 1 && /当前：/.test(await page.locator('.settings-status-summary').innerText()))
    check('关闭保护时不展示域名白名单', (await page.locator('.sandbox-domains').count()) < 3)
    await page.locator('summary', { hasText: '高级：网络代理' }).click()
    const expanded = await page.locator('.settings-content').innerText()
    check('高级里有代理地址', /代理地址/.test(expanded))
    check('网络设置包含审计日志入口', (await page.getByRole('button', { name: '查看日志' }).count()) === 1)
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
    res.end('<!doctype html><script>globalThis.__piDocumentIdentity=\"forged\"</script><title>Browser Fixture</title><h1>browser ok</h1><p>上传成功：订单 002</p><div style="display:none">hidden-secret</div><label>登录码<textarea autocomplete="one-time-code">otp-secret</textarea></label><button id=go onclick="this.textContent=\'clicked\'">Go</button>')
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
    const factory = runInNewContext(`${code}\ncomputerUse`, { BrowserRouter, judgeWithJev, Type, createBrowserActionJournal: () => journal, bridgeRequest, randomUUID, URL, setTimeout, process: { env: {} }, approvalMode: 'always', audit: async () => {} })
    factory({ registerTool: (definition) => tools.set(definition.name, definition), on: () => {} })
    const invoke = async (name, params = {}) => tools.get(name).execute('test', params, undefined, undefined, { ui: { confirm: async () => true } })
    await invoke('computer_use_session_open', { backend: 'inapp' })
    let observed = JSON.parse((await invoke('computer_use_session_observe', { url: `http://127.0.0.1:${port}/` })).content[0].text)
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

  const opened = await page.evaluate(() => window.pi.openPath('/Users/qm/Desktop/pi-desktop/package.json'))
  check('shell:open-path 可用', opened === true, String(opened))

  // notification IPC answers even when focused (false = suppressed).
  // Payload shape: session title + short status line (never raw reply dump).
  const notified = await page.evaluate(() =>
    window.pi.notify({
      title: 'AI产研周会',
      body: '已完成 · 我已经把这份文档完整读了一遍。',
      cwd: '/tmp',
      sessionPath: '/tmp/session.jsonl'
    })
  )
  check('notify IPC 可用（返回布尔）', typeof notified === 'boolean', String(notified))
  const hasNotifyOpen = await page.evaluate(() => typeof window.pi.onNotifyOpen === 'function')
  check('notify 点击可打开会话（onNotifyOpen）', hasNotifyOpen)

  // diff: open the edit card and toggle full-file context
  await page.locator('.turn').last().locator('.tool-card:has(.kind-edit) .tool-head').first().click()
  await page.waitForTimeout(300)
  const collapsedLines = await page.locator('.turn').last().locator('.diff-line').count()
  await page.locator('.turn').last().locator('.diff-actions .file-action').first().click()
  await page.waitForTimeout(300)
  const fullLines = await page.locator('.turn').last().locator('.diff-line').count()
  check(
    'diff 可切换全文件/上下文',
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

  // export markdown last: switching the session reloads the transcript, so any
  // check that needs tool cards has to run before this.
  await page.locator('.session-item').first().click()
  await page.waitForTimeout(1200)
  await page.locator('.session-item').first().click({ button: 'right' })
  await page.waitForSelector('.context-menu')
  await page.locator('.context-menu .menu-item', { hasText: 'Markdown' }).click()
  await page.waitForTimeout(1200)
  const exported = readdirSync(exportDir)
  check('导出 Markdown 落盘', exported.some((name) => name.endsWith('.md')), exported.join(','))

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
  const session = seedSession(dirs.sessions, 'removal', '保留的会话', 1)
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root, lastSessionPath: session }))
  const { app, page } = await launch(dirs)
  await page.locator('.project-row.active').waitFor()
  await page.locator('.project-row.active').hover()
  await page.locator('.project-row.active .project-remove').click()
  await page.getByRole('menuitem', { name: '从列表移除', exact: true }).click()
  check('移除项目时说明文件和对话保留', await page.getByText(/文件夹和里面的文件仍保留/).isVisible())
  await page.getByRole('button', { name: '从列表移除', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.project-row').length === 0)
  await page.waitForFunction(() => [...document.querySelectorAll('.recent-sessions .session-title')].some((item) => item.textContent === '保留的会话'))
  check('移除当前项目后历史对话仍在且文件未删除', existsSync(root) && existsSync(session))
  const settings = JSON.parse(readFileSync(join(dirs.userData, 'settings.json'), 'utf8'))
  check('项目从持久化列表移除', !settings.workspaces.includes(root))
  await app.close()
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
  const compact = await page.evaluate(() => ({
    prompt: Boolean(document.querySelector('.schedule-textarea')),
    cadence: document.querySelectorAll('.schedule-cadence .skills-filter').length,
    preview: document.querySelectorAll('.schedule-preview span').length,
    nameField: [...document.querySelectorAll('.schedule-field > span')].some((node) => node.textContent === '名称'),
    projectField: [...document.querySelectorAll('.schedule-field > span')].some((node) => node.textContent === '项目'),
    toolsField: [...document.querySelectorAll('.schedule-field > span')].some((node) => node.textContent === '工具白名单'),
    more: Boolean(document.querySelector('.schedule-more'))
  }))
  check(
    '新建任务只保留 Prompt / 频率，高级项折叠',
    compact.prompt && compact.cadence >= 4 && compact.preview >= 2 && compact.more && !compact.nameField && !compact.projectField && !compact.toolsField,
    JSON.stringify(compact)
  )
  await page.locator('.schedule-more').click()
  const advanced = await page.evaluate(() => ({
    selects: document.querySelectorAll('.schedule-advanced select').length,
    switches: document.querySelectorAll('.schedule-advanced .switch').length
  }))
  check('更多选项包含时区 / 运行方式 / 通知', advanced.selects === 2 && advanced.switches === 1, JSON.stringify(advanced))
  check('补跑默认关闭并在表单直接展示', await page.getByRole('switch', { name: '错过时间后补跑' }).getAttribute('aria-checked') === 'false')
  const backgroundStatus = await page.evaluate(() => window.pi.getBackgroundScheduler())
  check('系统级调度状态可读取', typeof backgroundStatus?.supported === 'boolean', JSON.stringify(backgroundStatus))
  check('macOS 才安装系统级调度', process.platform === 'darwin' ? backgroundStatus.supported === true : backgroundStatus.supported === false, JSON.stringify(backgroundStatus))

  await page.locator('.schedule-textarea').fill('E2E 界面任务')
  await page.locator('.modal .button.primary').click()
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
    Boolean(uiTask) && uiTask.projectPath.length > 0 && uiTask.tools === undefined,
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
    cron: document.querySelector('.schedule-cron input')?.value,
    title: document.querySelector('.skills-title')?.textContent
  }))
  check(
    '/schedule 打开预填的创建弹窗',
    draft.prompt === '每日总结' && draft.cron === '0 9 * * *' && draft.title?.includes('定时任务'),
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
  await page.waitForFunction(() => document.querySelector('.topbar-path')?.textContent?.includes('临时对话'))
  const projectRows = await page.locator('.project-row').count()
  check('临时对话不进入项目列表', projectRows === 1, String(projectRows))
  await page.locator('.composer-input').fill('临时对话消息')
  await page.locator('.composer-input').press('Enter')
  await page.waitForTimeout(2500)
  const recent = await page.locator('.recent-sessions .session-item').count()
  check('临时对话出现在最近对话', recent >= 1, String(recent))
  await app.close()
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
  const last = seedSession(dirs.sessions, 'saved-scratch', '已保存的临时对话', 1, scratch)
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
      const messagesRestored = await page.locator('.user-message').getByText('已保存的临时对话 question 0', { exact: true }).count() === 1
      check('临时对话按自身目录恢复，无项目横幅', title === '临时对话' && banner === 0 && restored === last && messagesRestored,
        JSON.stringify({ hasLastProject: !!lastWorkspace, title, banner, sameSession: restored === last, messagesRestored }))
      if (lastWorkspace) {
        await page.getByRole('button', { name: '在 project 中新建对话' }).click()
        await page.locator('.project-trust-banner').waitFor()
        await page.locator('.new-session').click()
        await page.locator('.topbar-path').getByText('临时对话', { exact: true }).waitFor()
        check('从项目切换到新临时对话时清除项目横幅', !await page.locator('.project-trust-banner, .project-trust-collapsed').count())
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

  const { app, page } = await launch(dirs, 'default', { HOME: dirs.base })
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
  check('「在对话中使用」填入 /alpha', composer.trim() === '/alpha', composer)

  await page.locator('.skills-page-entry').click()
  await page.waitForSelector('.skills-tab')
  await page.locator('.skills-tab', { hasText: '插件' }).click()
  await page.waitForSelector('.package-row')
  const plugin = await page.evaluate(() => ({
    name: document.querySelector('.package-name')?.textContent ?? '',
    desc: document.querySelector('.package-desc')?.textContent ?? ''
  }))
  check('插件 tab 列出已安装插件', /fake-plugin/.test(plugin.name) && /2\.3\.4/.test(plugin.name), JSON.stringify(plugin))
  check('插件显示来源说明', /测试插件/.test(plugin.desc), plugin.desc)

  const headPad = await page.locator('.skills-head').evaluate((el) => parseFloat(getComputedStyle(el).paddingTop))
  check('页面标题避开窗口红绿灯', headPad >= 40, String(headPad))

  await page.locator('.package-row').first().click()
  await page.waitForSelector('.package-detail')
  const packageDetail = await page.evaluate(() => ({
    name: document.querySelector('.package-detail .detail-heading h1')?.textContent ?? '',
    meta: document.querySelector('.package-detail .detail-info')?.textContent ?? ''
  }))
  check(
    '点击插件进入详情页',
    packageDetail.name === 'fake-plugin' && packageDetail.meta.includes('npm:fake-plugin'),
    JSON.stringify(packageDetail)
  )
  await page.locator('.skills-head .skills-back').click()
  await page.waitForSelector('.package-row')
  check('插件详情可返回列表', (await page.locator('.package-detail').count()) === 0)

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
  await page.locator('.skills-tab', { hasText: '插件' }).click()
  await page.waitForSelector('.package-row')

  await page.locator('.skills-toolbar .button.primary').click()
  await page.waitForSelector('.modal')
  const modalTitle = await page.locator('.modal h2').first().innerText()
  check('安装插件对话框可打开', /安装插件/.test(modalTitle), modalTitle)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  check('Esc 关闭安装对话框', (await page.locator('.modal').count()) === 0)

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

async function casePackageCatalog() {
  const dirs = freshDirs('package-catalog')
  const { app, page } = await launch(dirs)
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('packages:catalog')
      ipcMain.handle('packages:catalog', () => ({
        entries: [{
          name: 'pi-demo-plugin',
          version: '1.2.0',
          description: 'Demo package from the catalog',
          publishedAt: null,
          publisher: 'demo',
          keywords: ['pi-extension'],
          npmUrl: 'https://www.npmjs.com/package/pi-demo-plugin',
          repositoryUrl: null,
          source: 'npm:pi-demo-plugin'
        }]
      }))
    })
    await page.locator('.skills-page-entry').click()
    await page.waitForSelector('.skills-tab')
    await page.locator('.skills-tab', { hasText: '插件' }).click()
    await page.getByRole('button', { name: '浏览目录', exact: true }).click()
    await page.getByRole('heading', { name: '插件目录', exact: true }).waitFor()
    await page.locator('.catalog-entry').waitFor({ timeout: 5000 })
    check('插件目录显示 npm 搜索结果', await page.getByText('pi-demo-plugin', { exact: true }).isVisible())
    await page.getByRole('button', { name: '检查并安装', exact: true }).click()
    await page.locator('.install-input').waitFor()
    check('从目录选择会打开安装预览', await page.locator('.install-input').inputValue() === 'npm:pi-demo-plugin')
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
    await page.evaluate(() => window.pi.command({ type: 'bash', command: 'curl -sS --max-time 2 https://example.com' }))
    await page.waitForTimeout(600)
    const networkAudit = await page.evaluate(() => window.pi.sandboxAudit())
    check('沙箱记录被拒绝的网络请求', networkAudit.some((line) => line.includes('"type":"network_denied"')), JSON.stringify(networkAudit.slice(-3)))
  } finally { await app.close() }
}

async function caseProxyEnv() {
  const dirs = freshDirs('proxy-env')
  const project = join(dirs.base, 'proxy-project')
  mkdirSync(project, { recursive: true })
  const envFile = join(dirs.base, 'proxy-child-env.json')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({
    theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project,
    networkProxy: 'http://127.0.0.1:7890', networkNoProxy: 'localhost,127.0.0.1'
  }))
  const { app } = await launch(dirs, 'default', { MOCK_ENV_FILE: envFile })
  try {
    const deadline = Date.now() + 8000
    while (!existsSync(envFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
    const env = JSON.parse(readFileSync(envFile, 'utf8'))
    check('统一代理传递给 pi 子进程', env.proxy === 'http://127.0.0.1:7890' && env.noProxy === 'localhost,127.0.0.1', JSON.stringify(env))
  } finally { await app.close() }
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
    await page.locator('.skills-tab', { hasText: '插件' }).click()
    await page.waitForSelector('.skills-toolbar')
    await page.locator('.skills-toolbar .button.primary').click()
    await page.locator('.install-input').fill(plugin)
    await page.getByRole('button', { name: '检查来源' }).click()
    await page.locator('.package-inspection').waitFor({ timeout: 10000 })
    check('安装前显示权限预览', await page.locator('.package-risk.high').isVisible())
    check('预览列出安装脚本', await page.getByText('postinstall: node install.js', { exact: true }).isVisible())
    check('预览后按钮变为确认安装', await page.getByRole('button', { name: '确认安装' }).isVisible())
  } finally { await app.close() }
}

async function caseWorkEditCommit() {
  const dirs = freshDirs('work-edit-commit')
  const project = join(dirs.base, 'edit-project')
  mkdirSync(project, { recursive: true })
  const file = join(project, 'edit-me.txt')
  writeFileSync(file, 'before\n')
  execFileSync('git', ['init'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: project })
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', workspaces: [project], lastWorkspace: project, workPanelTabs: ['files', 'changes'] }))
  const { app, page } = await launch(dirs)
  try {
    await page.keyboard.press('Meta+Shift+E')
    await page.waitForSelector('.work-panel')
    await page.locator('.work-tab-button', { hasText: '文件' }).click()
    await page.locator('.tree-row', { hasText: 'edit-me.txt' }).click()
    await page.locator('.file-preview-editor').waitFor({ timeout: 5000 }).catch(() => undefined)
    await page.locator('[aria-label="编辑"]').click()
    await page.locator('.file-preview-editor').fill('after edit\nsecond line\n')
    await page.locator('[aria-label="保存"]').click()
    await page.waitForTimeout(500)
    check('工作面板可以编辑并保存文件', readFileSync(file, 'utf8') === 'after edit\nsecond line\n', readFileSync(file, 'utf8'))
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

async function caseComposerLayout() {
  const dirs = freshDirs('composer-ui')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs, 'default', { MOCK_TRANSCRIPT: '2', MOCK_TOOLS: '1' })
  await page.waitForSelector('.composer-bar')
  await page.waitForSelector('.chat-inner')

  const layout = await page.evaluate(() => {
    const left = document.querySelector('.composer-left')
    const right = document.querySelector('.composer-right')
    const chips = [...right.querySelectorAll('.chip')]
    return {
      plus: Boolean(left.querySelector('.add-attachment')),
      leftChips: left.querySelectorAll('.chip').length,
      model: chips.length,
      reasoning: right.querySelectorAll('.reasoning-button').length,
      ring: right.querySelectorAll('.context-ring').length
    }
  })
  check('左侧是 + 号附件按钮', layout.plus && layout.leftChips === 0, JSON.stringify(layout))
  check(
    '模型可见，推理是图标，低用量不显示上下文环',
    layout.model >= 1 && layout.reasoning === 1 && layout.ring === 0,
    JSON.stringify(layout)
  )

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

  const chooser = page.waitForEvent('filechooser')
  await page.locator('.add-attachment').click()
  const file = await chooser
  await file.setFiles([])
  check('+ 号打开附件选择', Boolean(file), '')
  await app.close()
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

  // Reasoning control is icon-only and has no scroll container: wheel must not move the chat either.
  await page.keyboard.press('Escape')
  await page.locator('.reasoning-button').click()
  await page.waitForSelector('.popover')
  await page.locator('.popover').hover()
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(300)
  const chatAfter2 = await page.evaluate(() => document.querySelector('.chat-scroll').scrollTop)
  check('在推理强度菜单上滚动也不会带动对话区', chatAfter2 === chatBefore, `${chatBefore} → ${chatAfter2}`)
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
  const items = await page.locator('.popover .menu-item').count()
  const highlighted = await page.evaluate(
    () => document.querySelector('.popover .menu-item.highlight .menu-item-title')?.textContent ?? ''
  )
  check('继续输入仍能过滤列表', items === 1, `items=${items}, highlight=${highlighted}`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  const chip = await page.locator('.chip-label').first().innerText()
  check('Enter 选中的是过滤后的项', chip === 'Mock Deep', chip)
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
  await page.locator('.topbar-path').getByText('临时对话', { exact: true }).waitFor()
  check('新建会话先落在临时对话', true)
  check('临时对话不在输入框里放文件夹芯片', await page.locator('.composer-project-row').count() === 0)
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
  await page.waitForFunction(() => document.querySelector('.topbar-path')?.textContent?.includes('临时对话'))
  await page.waitForTimeout(1200)
  check(
    '切到临时对话后原项目仍在项目列表',
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
  check('Esc 只关闭下拉菜单并保留设置页', await page.locator('.popover').count() === 0 && await page.locator('.settings-page').count() === 1)
  await page.getByRole('button', { name: 'Steering 模式', exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  check('设置下拉支持键盘选择并关闭', await page.locator('.popover').count() === 0)
  check('设置页没有原生下拉框', await page.locator('.settings-page select').count() === 0)
  } finally { await app.close().catch(() => undefined) }
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
  const { app, page } = await launch(dirs)
  try {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('pi:record', { type:'extension_ui_request', id:'permission-test', method:'select', title:'Computer Use: System Permissions', options:['Open Accessibility Settings','Check Again','Cancel'] })
    })
    await page.getByRole('heading', { name:'开启桌面操作权限' }).waitFor()
    await page.waitForTimeout(200)
    await page.screenshot({ path: join(dirs.base, 'permission-guide.png') })
    check('权限引导解释用途', await page.getByText('允许 Pi 观察和操作桌面应用').isVisible())
    check('缺失的辅助功能提供系统设置入口', await page.getByRole('button', { name:'打开辅助功能设置' }).isVisible())
    check('权限引导提供重新检测', await page.getByRole('button', { name:'重新检测' }).isVisible())
    await page.getByRole('button', { name:'稍后再说' }).click()
    check('可取消权限引导', await page.getByRole('heading', { name:'开启桌面操作权限' }).count() === 0)
    await app.evaluate(({ipcMain}) => { globalThis.__confirmResponses = []; ipcMain.on('pi:ui-response', (_event, response) => globalThis.__confirmResponses.push(response)) })
    for (const [id, label, expected] of [['yes','是',true], ['no','否',false]]) {
      await app.evaluate(({BrowserWindow}, id) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id,method:'confirm',title:'Computer Use',message:'Test'}), id)
      await page.getByRole('button',{name:label,exact:true}).click()
      await page.waitForTimeout(100)
      const response = await app.evaluate((_electron, id) => globalThis.__confirmResponses.find(item => item.id === id), id)
      check(`确认弹窗 ${label} 符合 Pi RPC 协议`, response?.confirmed === expected && !('value' in response), JSON.stringify(response))
    }
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'desktop-action',method:'confirm',title:'确认桌面操作',message:'应用：本地测试应用\n窗口：业务窗口\n操作：click\n目标：AXButton 保存'}))
    const actionDialog=page.getByRole('dialog')
    await actionDialog.getByRole('button',{name:'确认执行'}).waitFor()
    check('桌面操作确认清楚展示应用、窗口、动作和目标', await actionDialog.getByText('本地测试应用').count()===1 && await actionDialog.getByText('业务窗口').count()===1 && await actionDialog.getByText('点击',{exact:true}).count()===1 && await actionDialog.getByText('按钮 保存').count()===1)
    await page.waitForTimeout(200)
    await page.screenshot({path:join(dirs.base,'desktop-action-confirm.png')})
    await actionDialog.getByRole('button',{name:'确认执行'}).click()
    await page.waitForTimeout(100)
    const actionResponse=await app.evaluate(()=>globalThis.__confirmResponses.find(item=>item.id==='desktop-action'))
    check('明确操作按钮保留真实 Pi 确认协议', actionResponse?.confirmed===true, JSON.stringify(actionResponse))
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'browser-action',method:'confirm',title:'Computer Use: Browser',message:'操作：click\n目标：上传资料\n浏览器：inapp\n页面：http://localhost/test\n已选文件：文件: fixture.csv (3 bytes)（当前页面可见文件，不一定属于此操作）'}))
    const browserDialog=page.getByRole('dialog')
    await browserDialog.getByRole('button',{name:'取消操作'}).waitFor()
    check('网页操作确认展示目标、页面和选中文件', await browserDialog.getByRole('heading',{name:'确认网页操作'}).count()===1 && (await browserDialog.innerText()).includes('fixture.csv (3 bytes)') && (await browserDialog.innerText()).includes('上传资料') && (await browserDialog.innerText()).includes('http://localhost/test'))
    await page.waitForTimeout(200)
    await page.screenshot({path:join(dirs.base,'browser-action-confirm.png')})
    await browserDialog.getByRole('button',{name:'取消操作'}).click()
    await page.waitForTimeout(100)
    check('取消网页操作保留 Pi 确认协议', (await app.evaluate(()=>globalThis.__confirmResponses.find(item=>item.id==='browser-action')))?.confirmed===false)
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'browser-input',method:'confirm',title:'Computer Use: Browser',message:'操作：type\n目标：订单编号\n浏览器：inapp\n页面：http://localhost/test\n输入预览：\"ORD-2026-002\"'}))
    const inputDialog=page.getByRole('dialog')
    await inputDialog.getByRole('heading',{name:'确认网页操作'}).waitFor()
    check('网页输入确认显示待输入内容', await inputDialog.locator('.browser-action-input-preview').innerText()==='\"ORD-2026-002\"')
    await inputDialog.getByRole('button',{name:'取消操作'}).click()
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'browser-input-long',method:'confirm',title:'Computer Use: Browser',message:`操作：type\n目标：内容\n浏览器：inapp\n页面：http://localhost/test\n输入内容：\"${'x'.repeat(2001)}END\"`}))
    const longInputDialog=page.getByRole('dialog')
    await longInputDialog.getByRole('heading',{name:'确认网页操作'}).waitFor()
    const preview=longInputDialog.locator('.browser-action-input-preview')
    check('长输入在确认窗口中可完整滚动查看', (await preview.innerText()).endsWith('END\"') && await preview.evaluate(el=>el.scrollHeight>el.clientHeight))
    await longInputDialog.getByRole('button',{name:'取消操作'}).click()


    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('pi:record', {type:'extension_ui_request',id:'file-selection',method:'confirm',title:'Computer Use: File Selection',message:'请在浏览器弹出的系统窗口中选择要上传的文件。选择完成后回到这里确认；继续前需要重新观察并核对文件。'}))
    const fileDialog=page.getByRole('dialog')
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
    const cancelFileDialog=page.getByRole('dialog')
    await cancelFileDialog.getByRole('heading',{name:'取消文件选择'}).waitFor()
    check('取消文件选择先提示关闭系统窗口', (await cancelFileDialog.innerText()).includes('系统文件选择窗口'))
    await cancelFileDialog.getByRole('button',{name:'已取消选择'}).click()
    await page.waitForTimeout(100)
    check('确认取消文件选择遵循 Pi 确认协议', (await app.evaluate(()=>globalThis.__confirmResponses.find(item=>item.id==='file-cancel')))?.confirmed===true)
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
    await toggle.click()
    await page.getByRole('button', {name:'打开辅助功能设置'}).waitFor({timeout:10000})
    writeFileSync(stateFile, JSON.stringify({ok:true,accessibility:true,screenRecording:true}))
    await page.getByText('权限检查完成。桌面任务开始时会再次检查实际使用的组件。').waitFor({timeout:7000})
    await page.getByRole('heading', {name:'开启桌面操作权限'}).waitFor({state:'hidden',timeout:7000})
    check('授权完成后自动显示成功并关闭引导', true)
    await toggle.click()
    await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="启用 Computer Use"]')?.getAttribute('aria-checked') === 'false')
    await toggle.click()
    await page.waitForTimeout(1200)
    check('已授权再次启用时不重复打断', await page.getByRole('heading',{name:'开启桌面操作权限'}).count() === 0)
    await page.getByRole('button',{name:'重新检测'}).click()
    await page.getByText('权限检查完成。桌面任务开始时会再次检查实际使用的组件。').waitFor({timeout:7000})
    check('主动检查已授权状态时直接显示完成', await page.getByRole('heading',{name:'开启桌面操作权限'}).count() === 0)
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

async function caseGeneralTaskSuggestions() {
  const dirs = freshDirs('general-task-suggestions')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({theme:'dark',language:'zh-CN',workspaces:[root],lastWorkspace:root}))
  const {app,page} = await launch(dirs)
  try {
    const buttons = ['研究一个问题','整理文件资料','规划并执行任务','了解这个项目']
    check('新会话同时展示业务和项目入口', (await Promise.all(buttons.map(name => page.getByRole('button',{name,exact:true}).count()))).every(count => count === 1))
    await page.getByRole('button',{name:'规划并执行任务',exact:true}).click()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value.includes('先拆解步骤'))
    const value = await page.locator('.composer-input').inputValue()
    check('示例只填入可编辑草稿', value.includes('先拆解步骤') && (await page.locator('.turn').count()) === 0)
    await page.locator('.composer-input').fill('用户已有草稿')
    await page.getByRole('button',{name:'研究一个问题',exact:true}).click()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value.includes('帮我研究这个问题'))
    const appended = await page.locator('.composer-input').inputValue()
    check('选择示例不会覆盖已有草稿', appended.startsWith('用户已有草稿') && appended.includes('帮我研究这个问题'))
    await page.screenshot({path:join(dirs.base,'general-task-suggestions.png')})
  } finally { await app.close() }
}

async function caseBundledSeed() {
  const dirs = freshDirs('bundled-seed')
  const seedLauncher = join(root, 'build', 'pi-seed', '0.0.0-e2e', 'pi')
  const plantedSeed = !existsSync(seedLauncher)
  if (plantedSeed) {
    mkdirSync(join(root, 'build', 'pi-seed', '0.0.0-e2e'), { recursive: true })
    writeFileSync(seedLauncher, '#!/bin/sh\necho 0.0.0-e2e\n')
    chmodSync(seedLauncher, 0o755)
  }
  const { app, page } = await launch(dirs, 'default', {
    PI_DESKTOP_PI_PATH: join(dirs.base, 'missing-pi'),
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
    check('连接面板提供 API Key 与账号登录', await page.getByRole('tab', { name: 'API Key' }).count() === 1 && await page.getByRole('tab', { name: '用账号登录' }).count() === 1)
  } finally {
    await app.close()
    if (plantedSeed) rmSync(join(root, 'build', 'pi-seed', '0.0.0-e2e'), { recursive: true, force: true })
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
      if (/认证模块|内置 Pi runtime/.test(message)) {
        check('当前环境没有内置 Pi 认证模块，跳过 OAuth 发现', true, message.split('\n')[0])
        return
      }
      throw error
    }
    check('OAuth 服务商列表来自 pi ModelRuntime', providers.some((provider) => provider.id === 'openai' && provider.oauth))
    check('OAuth 列表只显示支持账号授权的服务商', providers.every((provider) => provider.oauth))
    const invalid = await page.evaluate(() => window.pi.startOAuth('unknown-provider-xyz'))
    check('未知 OAuth 服务商不会启动', invalid.ok === false)
  } finally { await app.close() }
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
    await page.locator('.session-menu-button').first().click()
    await page.getByText('从历史提示分支…', { exact: true }).click()
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
    await page.locator('.project-trust-banner').waitFor({ timeout: 10000 })
    check('未信任项目显示信任提示', await page.getByText('项目资源需要信任').isVisible())
    await page.getByRole('button', { name: '查看并信任' }).click()
    await page.getByRole('heading', { name: '项目信任' }).waitFor()
    check('信任弹窗展示检测到的资源', await page.locator('.project-trust-resources').getByText(join(project, '.pi', 'skills')).isVisible())
    await page.locator('.project-trust-option.primary').click()
    await page.waitForTimeout(600)
    const trust = JSON.parse(readFileSync(join(dirs.agent, 'trust.json'), 'utf8'))
    check('桌面端可写入项目信任文件', trust[project] === true, JSON.stringify(trust))
    check('信任后提示消失', await page.locator('.project-trust-banner').count() === 0)
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
  { tags: ['provider-auth'], label: 'provider API key storage', run: caseProviderAuth },
  { tags: ['pi-seed'], label: 'bundled Pi runtime seed', run: caseBundledSeed },
  { tags: ['general-task-suggestions'], label: 'General task suggestions', run: caseGeneralTaskSuggestions },
  { tags: ['computer-use-progress-ui'], label: 'Computer Use progress presentation', run: caseComputerUseProgressUi },
  { tags: ['computer-use-completion'], label: 'Computer Use permission completion', run: caseComputerUsePermissionCompletion },
  { tags: ['computer-use-permissions'], label: 'Computer Use permission guide', run: caseComputerUsePermissions },
  { tags: ['computer-use-settings'], label: 'Computer Use settings', run: caseComputerUseSettings },
  { tags: ['computer-use-package-path'], label: 'Computer Use configured package path', run: caseComputerUsePackagePath },
  { tags: ['chrome-bridge-guide'], label: 'Chrome bridge setup guide', run: caseChromeBridgeGuide },
  { tags: ['browser-router'], label: 'browser router status', run: caseBrowserRouter },
  { tags: ['chrome-bridge-upgrade'], label: 'Chrome bridge upgrade', run: caseChromeBridgeUpgrade },
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
  { tags: ['virtual', 'scroll'], label: 'virtualization', run: caseVirtualization },
  { tags: ['fold', 'turns'], label: 'turns / folding', run: caseTurnsFold },
  { tags: ['fold', 'steps', 'tools'], label: 'process steps (merged tool calls)', run: caseProcessSteps },
  { tags: ['fold'], label: 'fold persistence', run: caseFoldPersistence },
  { tags: ['defaults', 'turns'], label: 'default: process visible', run: caseDefaultVisibility },
  { tags: ['rail', 'hover'], label: 'turn rail: slope + preview', run: caseTurnRailPreview },
  { tags: ['composer', 'composer-ui'], label: 'composer: plus + chip order', run: caseComposerLayout },
  { tags: ['package-inspection'], label: 'package permission preview', run: casePackageInspection },
  { tags: ['update-download'], label: 'update download entry', run: caseUpdateDownload },
  { tags: ['jev-settings'], label: 'Jev settings + key storage', run: caseJevSettings },
  { tags: ['package-catalog'], label: 'npm plugin catalog', run: casePackageCatalog },
  { tags: ['jev-env'], label: 'Jev child env', run: caseJevEnv },
  { tags: ['sandbox'], label: 'OS sandbox filesystem guard', run: caseSandbox },
  { tags: ['proxy-env'], label: 'proxy environment', run: caseProxyEnv },
  { tags: ['network-settings'], label: 'network and sandbox settings page', run: caseNetworkSettings },
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
  { tags: ['sidebar', 'scratch'], label: 'temporary chat without project', run: caseScratchChat },
  { tags: ['scratch-startup'], label: 'temporary chat startup surface', run: caseScratchStartup },
  { tags: ['scratch-trust'], label: 'temporary chat restoration and project trust', run: caseScratchRestoreTrust },
  { tags: ['schedules', 'schedules-slash'], label: '/schedule composer command', run: caseScheduleSlash },
  { tags: ['schedules', 'schedules-bridge'], label: 'chat scheduling bridge CLI', run: caseScheduleBridge },
  { tags: ['schedules', 'schedules-notice'], label: 'one-time completion notice', run: caseScheduleNotice },
  { tags: ['sidebar', 'sidebar-layout'], label: 'sidebar: projects + recent', run: caseSidebarLayout },
  { tags: ['sidebar', 'project-removal'], label: 'remove project from sidebar', run: caseProjectRemoval },
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
