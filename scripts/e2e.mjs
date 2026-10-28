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

function seedSession(sessionsDir, id, name, turns = 1) {
  const project = join(sessionsDir, '--mock-project--')
  mkdirSync(project, { recursive: true })
  const file = join(project, `2026-01-01T00-00-00-000Z_${id}.jsonl`)
  const now = new Date().toISOString()
  const lines = [
    { type: 'session', id, cwd: root, timestamp: now },
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
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs, 'default', {
    MOCK_TRANSCRIPT: '3',
    MOCK_TOOLS: '2',
    MOCK_EDIT: '1'
  })

  const closed = await page.locator('.work-panel').count()
  await page.keyboard.press('Meta+Shift+E')
  await page.waitForSelector('.work-panel')
  check('⌘⇧E 打开右侧工作面板', closed === 0)

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
    () => document.querySelector('.work-empty')?.textContent ?? ''
  )
  check('产物 tab 有空状态', artifacts.length > 0, artifacts.slice(0, 30))

  await page.keyboard.press('Meta+Shift+E')
  await page.waitForTimeout(400)
  check('⌘⇧E 再次关闭面板', (await page.locator('.work-panel').count()) === 0)
  await app.close()
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

  // export markdown / html through the virtual save dialog
  await page.locator('.session-item').first().click({ button: 'right' })
  await page.waitForSelector('.context-menu')
  await page.locator('.context-menu .menu-item', { hasText: 'Markdown' }).click()
  await page.waitForTimeout(1200)
  const exported = readdirSync(exportDir)
  check('导出 Markdown 落盘', exported.some((name) => name.endsWith('.md')), exported.join(','))

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

  const virtual = await page.evaluate(() => document.querySelectorAll('.turn').length)
  check('轮次数量统计正常', virtual >= 1, `turns=${virtual}`)
  await app.close()
}

async function caseVirtualization() {
  const dirs = freshDirs('virtual')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
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
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
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

  // collapse again and compare the anchor position
  const anchor = await page.evaluate(() => {
    const turn = document.querySelectorAll('.turn')[2]
    return turn.getBoundingClientRect().top
  })
  await page.locator('.turn').last().locator('.turn-summary-main').click()
  await page.waitForTimeout(400)
  const anchorAfter = await page.evaluate(() => {
    const turn = document.querySelectorAll('.turn')[2]
    return turn.getBoundingClientRect().top
  })
  check(
    '折叠/展开保持滚动锚点',
    Math.abs(anchor - anchorAfter) < 8,
    `${Math.round(anchor)} → ${Math.round(anchorAfter)}`
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
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
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

async function caseAutoFoldOnAnswer() {
  const dirs = freshDirs('autofold')
  writeFileSync(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs)
  await page.locator('.composer-input').fill('hello there')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  const during = await page.evaluate(() => ({
    liveSummary: document.querySelectorAll('.turn.is-streaming .turn-summary.is-live').length,
    foldedAnswer: document.querySelectorAll('.turn.is-streaming .folded-answer').length,
    actions: document.querySelectorAll('.turn.is-streaming .turn-summary-actions').length
  }))
  check(
    '流式中的轮次保持展开（只有运行中摘要，无折叠按钮）',
    during.liveSummary === 1 && during.foldedAnswer === 0,
    JSON.stringify(during)
  )
  await page.waitForTimeout(3500)
  const after = await page.evaluate(() => ({
    summaries: document.querySelectorAll('.turn-summary').length,
    cards: document.querySelectorAll('.tool-card').length
  }))
  check('结论落地后自动收起过程', after.summaries === 1, JSON.stringify(after))
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
    JSON.stringify({ theme: 'dark', workspaces: [root], lastWorkspace: root })
  )
  const { app, page } = await launch(dirs)
  await page.locator('.composer-input').fill('hello')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  const disabled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.chip')).map((chip) => chip.disabled)
  )
  check('流式输出中模型 / 强度不可切换', disabled.every(Boolean), JSON.stringify(disabled))
  await page.waitForTimeout(2500)
  const after = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.chip')).map((chip) => chip.disabled)
  )
  check('输出结束后恢复可切换', after.every((value) => value === false), JSON.stringify(after))
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
  await page.locator('.topbar .settings-entry').click({ position: { x: 2, y: 2 } })
  check('顶栏设置按钮边缘可点击', await page.locator('.settings-page').count() === 1)
  await page.getByRole('button', { name: 'Back to chat' }).click()
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

try {
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  console.log('\nmenu / keyboard')
  await caseLanguage()
  await caseComposerSafety()
  await caseMenuScrollAndKeyboard()
  console.log('\nwork panel')
  await caseWorkPanel()
  console.log('\npolish: files / export / lightbox')
  await casePolish()
  console.log('\nvirtualization')
  await caseVirtualization()
  console.log('\nturns / folding')
  await caseTurnsFold()
  console.log('\nfold persistence')
  await caseFoldPersistence()
  console.log('\nauto fold on answer')
  await caseAutoFoldOnAnswer()
  console.log('\nwheel isolation')
  await caseWheelIsolation()
  console.log('\nmenu typing')
  await caseMenuTyping()
  console.log('\nstreaming guard')
  await caseStreamingGuard()
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
