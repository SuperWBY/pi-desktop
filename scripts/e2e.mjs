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
if (!existsSync(outMain) || newestSourceMtime(join(root, 'src')) > statSync(outMain).mtimeMs) {
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
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dirs.userData}`],
    cwd: root,
    env: {
      ...process.env,
      PI_DESKTOP_PI_PATH: mockPi,
      PI_CODING_AGENT_DIR: dirs.agent,
      PI_CODING_AGENT_SESSION_DIR: dirs.sessions,
      MOCK_SCENARIO: scenario,
      ...extraEnv
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
  await page.waitForSelector('.tree-row')
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
    res.end('<!doctype html><title>Browser Fixture</title><h1>browser ok</h1>')
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
    const launched = await launch(dirs, 'default')
    app = launched.app
    const page = launched.page

    await page.keyboard.press('Meta+Shift+B')
    await page.waitForSelector('.browser-toolbar')
    check('⌘⇧B 打开右侧浏览器', await page.locator('.browser-toolbar').isVisible())
    check('空白浏览器显示空状态', (await page.locator('.browser-empty').count()) === 1)

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

  // notification IPC answers even when focused (false = suppressed)
  const notified = await page.evaluate(() => window.pi.notify({ title: 't', body: 'b' }))
  check('notify IPC 可用（返回布尔）', typeof notified === 'boolean', String(notified))

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
  check('更多选项包含时区 / 运行方式 / 补跑 / 通知', advanced.selects === 2 && advanced.switches === 2, JSON.stringify(advanced))
  const backgroundStatus = await page.evaluate(() => window.pi.getBackgroundScheduler())
  check('系统级调度状态可读取', backgroundStatus.supported === true, JSON.stringify(backgroundStatus))

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
  const detail = await waitForScheduleRun(page, task.id)
  const interrupted = detail?.runs.filter((run) => run.status === 'interrupted') ?? []
  const success = detail?.runs.filter((run) => run.status === 'success') ?? []
  check(
    '运行中退出会标记中断并补跑',
    interrupted.length === 1 && success.length === 1,
    JSON.stringify(detail?.runs.map((run) => run.status))
  )
  await app.close()
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

  await page.locator('.skill-card', { hasText: 'alpha' }).click()
  await page.waitForSelector('.skill-detail, .detail-page')
  const detailBack = await page.locator('.skills-head .skills-back').boundingBox()
  check('详情页返回键避开红绿灯', Boolean(detailBack && detailBack.y >= 44), JSON.stringify(detailBack))
  const detail = await page.evaluate(() => ({
    name: document.querySelector('.detail-heading h1')?.textContent ?? '',
    body: document.querySelector('.skill-readme')?.textContent ?? ''
  }))
  check(
    '详情页显示 SKILL.md 正文且隐藏 frontmatter',
    detail.name === 'alpha' &&
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

  await page.locator('.skills-tab', { hasText: '连接器' }).click()
  await page.waitForSelector('.connector-status')
  const connectorSummary = await page.evaluate(() => ({
    rows: document.querySelectorAll('.package-list .package-row').length,
    ok: document.querySelectorAll('.connector-status.ok').length,
    missing: document.querySelectorAll('.connector-status.missing').length
  }))
  check(
    '连接器 tab 聚合外部命令并区分状态',
    connectorSummary.rows === 3 && connectorSummary.ok === 2 && connectorSummary.missing === 1,
    JSON.stringify(connectorSummary)
  )

  await page.locator('.package-row', { hasText: 'lark-cli' }).first().click()
  await page.waitForSelector('.connector-detail')
  const connector = await page.evaluate(() => ({
    name: document.querySelector('.connector-detail .detail-heading h1')?.textContent ?? '',
    body: document.querySelector('.connector-detail')?.textContent ?? ''
  }))
  check(
    '连接器详情显示全局路径与使用它的技能',
    connector.name === 'lark-cli' &&
      connector.body.includes('.npm-global') &&
      connector.body.includes('gamma'),
    connector.body.slice(0, 120)
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
    const ring = right.querySelector('.context-ring')
    return {
      plus: Boolean(left.querySelector('.add-attachment')),
      leftChips: left.querySelectorAll('.chip').length,
      rightChips: chips.length,
      chipsBeforeRing: ring
        ? chips.every((chip) => chip.getBoundingClientRect().left < ring.getBoundingClientRect().left)
        : false
    }
  })
  check('左侧是 + 号附件按钮', layout.plus && layout.leftChips === 0, JSON.stringify(layout))
  check(
    '模型 / 思考在上下文左边',
    layout.rightChips === 2 && layout.chipsBeforeRing,
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

  // thinking menu has no scroll container: wheel must not move the chat either
  await page.keyboard.press('Escape')
  await page.locator('.chip').nth(1).click()
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
  await page.waitForSelector('.project-picker-trigger')
  check('新建会话先落在临时对话', (await page.locator('.topbar-path').innerText()).includes('临时对话'))
  await page.locator('.project-picker-trigger').click()
  await page.locator('.project-picker-item').filter({ hasText: 'streaming' }).click()
  await page.waitForFunction(() => document.querySelector('.project-row.active')?.textContent?.includes('streaming'))
  check('运行中也可以在初始对话框切换项目', (await page.locator('.project-row.active').innerText()).includes('streaming'))
  check('运行中切换项目不再弹阻止提示', (await page.getByText('任务正在运行', { exact: true }).count()) === 0)
  await page.waitForTimeout(2500)
  const after = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.chip')).map((chip) => chip.disabled)
  )
  check('切换后的新会话可正常操作', after.every((value) => value === false), JSON.stringify(after))
  await page.locator('.project-picker-trigger').click()
  await page
    .locator('.project-picker-item')
    .filter({ has: page.locator('.project-picker-name', { hasText: 'pi-desktop' }) })
    .click()
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

async function caseLanguage() {
  const dirs = freshDirs('language')
  writeFileSync(join(dirs.userData, 'settings.json'), JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root }))
  let { app, page } = await launch(dirs)
  await page.keyboard.press('Meta+,')
  await page.getByRole('button', { name: '界面语言', exact: true }).click()
  check('语言选择使用应用内菜单', await page.locator('.popover .menu-item').count() === 2)
  const languageMenuWidth = (await page.locator('.popover').boundingBox())?.width ?? 0
  check('短选项菜单宽度适中', languageMenuWidth <= 190, `width=${languageMenuWidth}`)
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
  check('语言切换后设置页显示英语', await page.getByRole('heading', { name: 'Settings', exact: true }).count() === 1)
  for (const category of ['General', 'Models', 'Tools & skills', 'Appearance', 'Sessions', 'Keyboard shortcuts', 'About']) {
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
  await app.close()
}

const only = (process.env.E2E_ONLY ?? '').trim().toLowerCase()
const wants = only ? only.split(/[,\s]+/).filter(Boolean) : []

// Every scenario is addressable by tag, so a change can be checked against the
// affected area without booting all twenty Electron instances.
const CASES = [
  { tags: ['language', 'settings'], label: 'language / settings menu', run: caseLanguage },
  { tags: ['composer'], label: 'composer safety (IME, draft)', run: caseComposerSafety },
  { tags: ['menu', 'keyboard'], label: 'model menu: scroll + keyboard', run: caseMenuScrollAndKeyboard },
  { tags: ['panel'], label: 'work panel', run: caseWorkPanel },
  { tags: ['browser'], label: 'in-app browser', run: caseBrowser },
  { tags: ['chrome-import', 'browser'], label: 'Chrome cookie import', run: caseChromeImport },
  { tags: ['polish', 'files', 'export'], label: 'polish: files / export / lightbox', run: casePolish },
  { tags: ['virtual', 'scroll'], label: 'virtualization', run: caseVirtualization },
  { tags: ['fold', 'turns'], label: 'turns / folding', run: caseTurnsFold },
  { tags: ['fold', 'steps', 'tools'], label: 'process steps (merged tool calls)', run: caseProcessSteps },
  { tags: ['fold'], label: 'fold persistence', run: caseFoldPersistence },
  { tags: ['defaults', 'turns'], label: 'default: process visible', run: caseDefaultVisibility },
  { tags: ['rail', 'hover'], label: 'turn rail: slope + preview', run: caseTurnRailPreview },
  { tags: ['composer', 'composer-ui'], label: 'composer: plus + chip order', run: caseComposerLayout },
  { tags: ['skills', 'plugins'], label: 'skills & plugins page', run: caseSkillsPage },
  { tags: ['schedules'], label: 'scheduled tasks', run: caseSchedules },
  { tags: ['schedules', 'schedules-recovery'], label: 'scheduled task restart recovery', run: caseScheduleRecovery },
  { tags: ['schedules', 'schedules-interrupted'], label: 'scheduled run interrupted by quit', run: caseScheduleInterrupted },
  { tags: ['schedules', 'schedules-phase3'], label: 'headless scheduler tick', run: caseScheduleHeadlessTick },
  { tags: ['schedules', 'schedules-phase2'], label: 'cron, timezone, continue session, tools', run: caseScheduleAdvanced },
  { tags: ['schedules', 'schedules-failures'], label: 'consecutive failures pause', run: caseScheduleFailures },
  { tags: ['schedules', 'schedules-event'], label: 'file-change trigger', run: caseScheduleEvent },
  { tags: ['sidebar', 'scratch'], label: 'temporary chat without project', run: caseScratchChat },
  { tags: ['schedules', 'schedules-slash'], label: '/schedule composer command', run: caseScheduleSlash },
  { tags: ['schedules', 'schedules-bridge'], label: 'chat scheduling bridge CLI', run: caseScheduleBridge },
  { tags: ['schedules', 'schedules-notice'], label: 'one-time completion notice', run: caseScheduleNotice },
  { tags: ['sidebar', 'sidebar-layout'], label: 'sidebar: projects + recent', run: caseSidebarLayout },
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
  for (const item of CASES) {
    if (wants.length && !item.tags.some((tag) => wants.includes(tag))) continue
    console.log(`\n${item.tags[0]}: ${item.label}`)
    await item.run()
  }
  if (wants.length) {
    console.log(`\n(e2e filter: ${wants.join(',')})`)
  }
} catch (error) {
  failures += 1
  console.error('\n crashed:', error instanceof Error ? error.stack : error)
}

const passed = results.filter((item) => item.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(failures ? 1 : 0)
