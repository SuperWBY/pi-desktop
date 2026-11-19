import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('/agent/repos/pi-desktop')
const phase = process.argv[2] || 'after'
const out = join(root, 'docs/screenshots/round2-batch1/after')
mkdirSync(out, { recursive: true })
const mockPi = join(root, 'scripts/mock-pi.mjs')

function dirs(name) {
  const base = join(root, 'output', 'shots', phase, name)
  rmSync(base, { recursive: true, force: true })
  const d = { base, userData: join(base, 'userData'), agent: join(base, 'agent'), sessions: join(base, 'sessions') }
  for (const dir of Object.values(d)) mkdirSync(dir, { recursive: true })
  return d
}

async function launch(d, extra = {}, settings = {}, agentSettings = null) {
  writeFileSync(join(d.userData, 'settings.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN', autoCheckUpdates: false, ...settings }))
  if (agentSettings) writeFileSync(join(d.agent, 'settings.json'), JSON.stringify(agentSettings))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${d.userData}`],
    cwd: root,
    env: {
      ...process.env,
      HOME: d.base,
      PI_DESKTOP_PI_PATH: mockPi,
      PI_CODING_AGENT_DIR: d.agent,
      PI_CODING_AGENT_SESSION_DIR: d.sessions,
      PI_DESKTOP_SKIP_AUTO_INSTALL: '1',
      PI_DESKTOP_MOCK_AUTH: '1',
      ...extra
    }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.composer-input, .welcome', { timeout: 45000 })
  await page.waitForTimeout(800)
  return { app, page }
}

async function size(app, w, h) {
  await app.evaluate(({ BrowserWindow }, dims) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(dims.w, dims.h)
    win.center()
  }, { w, h })
  await new Promise((r) => setTimeout(r, 250))
}

async function shot(page, name) {
  await page.screenshot({ path: join(out, name) })
  console.log('shot', name)
}

const theme = process.argv[3] || 'dark'

if (process.argv[2] === 'welcome') {
  const d = dirs('welcome-' + theme)
  const { app, page } = await launch(d, {
    PI_DESKTOP_PI_PATH: join(d.base, 'missing-pi'),
    PATH: '/usr/bin:/bin',
    PI_DESKTOP_SKIP_SEED: '1'
  }, { theme })
  await size(app, 1280, 860)
  await shot(page, `first-run-${theme}.png`)
  await size(app, 860, 560)
  await shot(page, `first-run-${theme}-860.png`)
  await app.close()
} else if (process.argv[2] === 'ready') {
  const d = dirs('ready-' + theme)
  const { app, page } = await launch(d, {}, { theme })
  await page.waitForTimeout(1500)
  await size(app, 1280, 860)
  await shot(page, `welcome-ready-${theme}.png`)
  const connect = page.getByRole('button', { name: '连接模型', exact: true })
  if (await connect.count()) {
    await connect.click()
    await page.waitForTimeout(500)
    await shot(page, `connect-model-${theme}.png`)
    await size(app, 860, 560)
    await shot(page, `connect-model-${theme}-860.png`)
  } else {
    console.log('no connect button; body:', (await page.locator('body').innerText()).slice(0, 400))
    await shot(page, `welcome-or-chat-${theme}.png`)
  }
  await app.close()
} else if (process.argv[2] === 'chat') {
  const d = dirs('chat-' + theme)
  const { app, page } = await launch(d, { MOCK_TRANSCRIPT: '2', MOCK_TOOLS: '4', MOCK_SPLIT_TOOLS: '1' }, { theme, workspaces: [root], lastWorkspace: root })
  await page.waitForSelector('.turn', { timeout: 20000 })
  await size(app, 1280, 860)
  await page.locator('.user-message').first().hover().catch(() => {})
  await page.waitForTimeout(200)
  await shot(page, `conversation-${theme}.png`)
  const group = page.locator('.tool-group .tool-head').first()
  if (await group.count()) {
    await group.click()
    await page.waitForTimeout(250)
  }
  await page.locator('.user-message').first().hover().catch(() => {})
  await shot(page, `tools-${theme}.png`)
  const chip = page.locator('.approval-mode-chip')
  if (await chip.count()) {
    await chip.click()
    await page.waitForTimeout(250)
    await shot(page, `permission-${theme}.png`)
    await page.keyboard.press('Escape')
  } else {
    const icon = page.locator('.protection-chip, [aria-label^="保护"]')
    if (await icon.count()) {
      await icon.click()
      await page.waitForTimeout(250)
      await shot(page, `permission-${theme}.png`)
    }
  }
  await page.locator('.composer-input').click()
  await page.waitForTimeout(150)
  await shot(page, `composer-${theme}.png`)
  await size(app, 860, 560)
  await page.locator('.composer-input').click()
  await shot(page, `composer-${theme}-860.png`)
  await app.close()
} else if (process.argv[2] === 'actions') {
  const d = dirs('actions-' + theme)
  const { app, page } = await launch(d, { MOCK_TRANSCRIPT: '2' }, { theme, workspaces: [root], lastWorkspace: root })
  await page.waitForSelector('.composer-input', { timeout: 20000 })
  await size(app, 1280, 860)
  const input = page.locator('.composer-input')
  await input.fill('为什么临时对话，会有信任横幅，别人的心聊天其实只是想先确认一下这个对话没有选文件夹')
  await input.press('Enter')
  await page.locator('.user-message').getByText('为什么临时对话', { exact: false }).waitFor({ timeout: 15000 })
  await page.locator('.assistant-message').filter({ hasText: 'mock reply' }).last().waitFor({ timeout: 20000 })
  await page.locator('.send-button.stop').waitFor({ state: 'hidden', timeout: 20000 })
  await page.waitForTimeout(300)
  const user = page.locator('.user-message').last()
  await user.scrollIntoViewIfNeeded()
  await user.hover()
  await page.waitForTimeout(300)
  const row = user.locator('.message-action-row')
  console.log('user row', JSON.stringify(await row.innerText()), 'opacity', await row.evaluate((el) => getComputedStyle(el).opacity))
  await shot(page, `message-actions-user-${theme}.png`)
  const reply = page.locator('.assistant-message').filter({ hasText: 'mock reply' }).last()
  if (await reply.count()) {
    await reply.scrollIntoViewIfNeeded()
    await reply.hover()
    await page.waitForTimeout(300)
    await shot(page, `message-actions-assistant-${theme}.png`)
  }
  await size(app, 860, 560)
  await user.hover()
  await shot(page, `message-actions-user-${theme}-860.png`)
  await app.close()
} else if (process.argv[2] === 'stop') {
  const d = dirs('stop-' + theme)
  const { app, page } = await launch(d, { MOCK_STREAM_INTERVAL: '120' }, { theme, workspaces: [root], lastWorkspace: root })
  await page.waitForSelector('.composer-input', { timeout: 20000 })
  await size(app, 1280, 860)
  await page.locator('.composer-input').fill('流式回复时看停止按钮')
  await page.locator('.composer-input').press('Enter')
  await page.locator('.send-button.stop').waitFor({ timeout: 10000 })
  await page.waitForFunction(() => {
    const button = document.querySelector('.send-button.stop')
    if (!button) return false
    return !button.querySelector('.spinner') && Boolean(button.querySelector('svg'))
  }, null, { timeout: 10000 })
  await page.waitForTimeout(150)
  const box = await page.locator('.send-button.stop').boundingBox()
  const label = await page.locator('.send-button.stop').getAttribute('aria-label')
  const text = await page.locator('.send-button.stop').innerText()
  console.log('stop', JSON.stringify({ box, label, text }))
  if (!box || box.width < 28 || box.height < 28 || Math.abs(box.width - box.height) > 1) {
    throw new Error(`stop button footprint wrong: ${JSON.stringify(box)}`)
  }
  if (label !== '停止' || text.trim()) throw new Error(`stop button not icon-only: label=${label} text=${JSON.stringify(text)}`)
  await page.locator('.composer').screenshot({ path: join(out, `composer-stop-${theme}-crop.png`) })
  await page.locator('.send-button.stop').screenshot({ path: join(out, `composer-stop-${theme}-btn.png`) })
  await shot(page, `composer-stop-${theme}.png`)
  await app.close()
} else if (process.argv[2] === 'fixups') {
  // 4 full-access confirm, 5 welcome/connect spacing, 6 assistant actions, 7 sidebar needs-model
  const theme = process.argv[3] || 'dark'
  {
    const d = dirs('fixups-welcome-' + theme)
    const { app, page } = await launch(d, {}, { theme })
    await page.waitForTimeout(1200)
    await size(app, 1280, 860)
    await shot(page, `welcome-needs-model-${theme}.png`)
    const status = page.locator('.sidebar-status, .status-chip, button').filter({ hasText: '先连接模型' }).first()
    if (await status.count()) console.log('sidebar status', await status.innerText())
    await page.getByRole('button', { name: '连接模型', exact: true }).click()
    await page.waitForTimeout(400)
    await shot(page, `connect-spacing-${theme}.png`)
    await app.close()
  }
  {
    const d = dirs('fixups-permission-' + theme)
    const { app, page } = await launch(
      d,
      { MOCK_TRANSCRIPT: '1' },
      { theme, workspaces: [root], lastWorkspace: root },
      { defaultProvider: 'mock', defaultModel: 'test' }
    )
    await page.waitForSelector('.composer-input', { timeout: 20000 })
    await size(app, 1280, 860)
    await page.waitForFunction(() => document.querySelector('.approval-mode-chip:not([disabled])'), null, { timeout: 20000 })
    await page.locator('.approval-mode-chip').click()
    await page.waitForTimeout(200)
    await page.locator('.menu-item').filter({ hasText: '不受限' }).click()
    await page.getByText('这次不受限？').waitFor({ timeout: 5000 })
    await page.waitForTimeout(200)
    await shot(page, `full-access-confirm-${theme}.png`)
    await page.getByRole('button', { name: '取消' }).click()
    await app.close()
  }
  {
    const d = dirs('fixups-actions-' + theme)
    const { app, page } = await launch(
      d,
      { MOCK_TRANSCRIPT: '2' },
      { theme, workspaces: [root], lastWorkspace: root },
      { defaultProvider: 'mock', defaultModel: 'test' }
    )
    await page.waitForSelector('.composer-input', { timeout: 20000 })
    await size(app, 1280, 860)
    await page.locator('.composer-input').fill('检查助手消息操作只剩时间和复制')
    await page.locator('.composer-input').press('Enter')
    await page.locator('.assistant-message').filter({ hasText: 'mock reply' }).last().waitFor({ timeout: 20000 })
    await page.locator('.send-button.stop').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(300)
    const reply = page.locator('.assistant-message').filter({ hasText: 'mock reply' }).last()
    await reply.hover()
    await page.waitForTimeout(250)
    const edit = reply.locator('[aria-label="编辑"]')
    if (await edit.count()) throw new Error('assistant still has edit')
    await shot(page, `message-actions-assistant-${theme}.png`)
    const user = page.locator('.user-message').last()
    await user.hover()
    await page.waitForTimeout(250)
    if ((await user.locator('[aria-label="编辑"]').count()) !== 1) throw new Error('user missing edit')
    await shot(page, `message-actions-user-${theme}.png`)
    await app.close()
  }
} else if (process.argv[2] === 'effort') {
  const theme = process.argv[3] || 'dark'
  const d = dirs('effort-' + theme)
  const { app, page } = await launch(
    d,
    { MOCK_TRANSCRIPT: '1' },
    { theme, workspaces: [root], lastWorkspace: root },
    { defaultProvider: 'mock', defaultModel: 'test' }
  )
  await page.waitForSelector('.model-chip', { timeout: 20000 })
  await size(app, 1280, 860)
  await page.locator('.composer-input').click()
  await page.waitForTimeout(200)
  await shot(page, `composer-effort-chip-${theme}.png`)
  await page.locator('.composer').screenshot({ path: join(out, `composer-effort-chip-${theme}-crop.png`) })
  await page.locator('.model-chip').click()
  await page.waitForSelector('.thinking-effort')
  await page.waitForTimeout(250)
  await shot(page, `composer-effort-menu-${theme}.png`)
  await page.locator('.popover').screenshot({ path: join(out, `composer-effort-menu-${theme}-crop.png`) })
  await app.close()
} else {
  console.log('usage: welcome|ready|chat|actions|stop|fixups|effort [dark|light]')
}
