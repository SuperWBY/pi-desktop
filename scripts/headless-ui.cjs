// Renderer regression checks without opening or focusing a desktop window.
// Run `npm run build` first. Set HEADLESS_CHROME_PATH if Chrome is elsewhere.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../out/renderer')
const server = http.createServer((req, res) => {
  const file = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0])
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
  res.setHeader('Content-Type', type[path.extname(file)] || 'application/octet-stream')
  fs.createReadStream(file).on('error', () => { res.statusCode = 404; res.end() }).pipe(res)
})

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.HEADLESS_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.addInitScript(() => {
      let settings = {
        theme: 'dark', language: 'zh-CN', workspaces: ['/work/alpha', '/work/beta'],
        lastWorkspace: '/work/alpha', workPanelOpen: true, workPanelWidth: 360,
        workPanelTab: 'changes', followStream: true
      }
      settings = { ...settings, ...JSON.parse(sessionStorage.getItem('mock-settings') || '{}') }
      const models = [
        { id: 'test', name: 'Test Model', provider: 'mock' },
        { id: 'deep', name: 'Mock Deep', provider: 'mock' },
        ...Array.from({ length: 30 }, (_, i) => ({ id: `bulk-${i}`, name: `Mock Bulk ${i}`, provider: 'mock' }))
      ]
      let currentModel = models[0]
      const messages = [
        { role: 'user', content: '请检查项目结构。', timestamp: Date.now() },
        { role: 'assistant', content: [{ type: 'text', text: '正在检查项目。' }], timestamp: Date.now() },
        { role: 'assistant', content: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=' }], errorMessage: '模拟失败详情', timestamp: Date.now() },
        { role: 'user', content: '一个简单问题', timestamp: Date.now() },
        { role: 'assistant', content: [{ type: 'text', text: '一个直接回答' }], timestamp: Date.now() }
      ]
      for (let i = 0; i < 5; i++) {
        messages.push({ role: 'user', content: `问题 ${i}`, timestamp: Date.now() })
        messages.push({ role: 'assistant', content: [{ type: 'text', text: `回答 ${i}` }], timestamp: Date.now() })
      }
      messages.push({ role: 'user', content: '测试工具错误', timestamp: Date.now() })
      messages.push({ role: 'assistant', content: [{ type: 'toolCall', id: 'failed-call', name: 'read', arguments: { path: 'missing.txt' } }], timestamp: Date.now() })
      messages.push({ role: 'toolResult', toolCallId: 'failed-call', toolName: 'read', content: [{ type: 'text', text: 'not found' }], isError: true, timestamp: Date.now() })
      messages.push({ role: 'assistant', content: [{ type: 'text', text: '文件未找到。' }], timestamp: Date.now() })
      messages.push({ role: 'user', content: '修改文件', timestamp: Date.now() })
      messages.push({ role: 'assistant', content: [
        { type: 'toolCall', id: 'edit-ok', name: 'edit', arguments: { path: 'good.txt', oldText: 'one\ntwo\nthree', newText: 'one\nchanged\nthree' } },
        { type: 'toolCall', id: 'write-ok', name: 'write', arguments: { path: 'overwritten.txt', content: 'new contents' } },
        { type: 'toolCall', id: 'write-failed', name: 'write', arguments: { path: '/work/alpha/failed.txt', content: 'not saved' } }
      ], timestamp: Date.now() })
      messages.push({ role: 'toolResult', toolCallId: 'edit-ok', toolName: 'edit', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: Date.now() })
      messages.push({ role: 'toolResult', toolCallId: 'write-ok', toolName: 'write', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: Date.now() })
      messages.push({ role: 'toolResult', toolCallId: 'write-failed', toolName: 'write', content: [{ type: 'text', text: 'permission denied' }], isError: true, timestamp: Date.now() })
      messages.push({ role: 'assistant', content: [{ type: 'text', text: '一项修改完成，另一项失败。' }], timestamp: Date.now() })
      const noop = () => () => {}
      window.pi = {
        bootstrap: async () => ({ settings, home: '/work', piVersion: '1.4.0', electronVersion: '45', appVersion: '0.1.6', piSettings: {} }),
        listSessions: async () => [
          { path: '/session/1', id: '1', cwd: '/work/alpha', name: '项目结构', preview: '项目结构', updatedAt: Date.now(), createdAt: Date.now(), messageCount: 2, size: 10 },
          { path: '/session/2', id: '2', cwd: '/work/beta', name: 'Beta 的会话', preview: '', updatedAt: Date.now(), createdAt: Date.now(), messageCount: 2, size: 10 },
          { path: '/session/3', id: '3', cwd: '/work/gamma', name: '旧项目会话', preview: '', updatedAt: Date.now(), createdAt: Date.now(), messageCount: 2, size: 10 }
        ],
        openSession: async ({ cwd, sessionPath }) => ({ ok: true, cwd, sessionPath: sessionPath ?? null }),
        command: async (command) => {
          if (command.type === 'set_model') currentModel = models.find((model) => model.id === command.modelId)
          return { success: true, data: ({
            get_state: { thinkingLevel: 'high', model: currentModel, isStreaming: false },
            get_messages: { messages }, get_session_stats: {}, get_available_models: { models },
            get_available_thinking_levels: { levels: [] }, get_commands: { commands: [] }
          })[command.type] || {} }
        },
        updateSettings: async (patch) => {
          settings = { ...settings, ...patch }
          sessionStorage.setItem('mock-settings', JSON.stringify(settings))
          return settings
        },
        onRecord: (callback) => { window.emitRecord = callback; return () => {} },
        onStatus: noop, onStderr: noop, onAppEvent: noop, onSettings: noop,
        gitStatus: async () => ({ files: [] }), gitDiff: async () => '',
        readDir: async (dir) => dir.endsWith('/nested')
          ? [{ path: `${dir}/nested.txt`, name: 'nested.txt', isDir: false, size: 8 }]
          : [{ path: `${dir}/example.txt`, name: 'example.txt', isDir: false, size: 8 }, { path: `${dir}/nested`, name: 'nested', isDir: true, size: 0 }],
        readText: async () => ({ ok: true, content: '示例文件', truncated: false }),
        openPath: async (value) => { window.openedPath = value; return true }, notify: async () => true
      }
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.waitForSelector('.project-shortcut')
    await page.waitForSelector('.turn')
    if (await page.locator('.work-tab-button').count() !== 1) throw Error('新工作区不应预置四个标签')
    if (await page.locator('.older-turns').count()) throw Error('默认隐藏了较早的对话')
    if (await page.locator('.work-file-head', { hasText: 'failed.txt' }).count()) throw Error('失败的写入被当作文件变更')
    if (!await page.locator('.work-file-head', { hasText: 'overwritten.txt' }).getByText('行数未知', { exact: true }).count()) throw Error('覆盖写入被误认为全部新增')
    const changeSummary = await page.locator('.work-summary').innerText()
    if (!changeSummary.includes('+1') || !changeSummary.includes('−1')) throw Error(`变更行数不准确: ${changeSummary}`)
    const turnChange = page.locator('.turn').filter({ hasText: '修改文件' }).getByRole('button', { name: /good\.txt/ })
    if (!await turnChange.count()) throw Error('回答下没有本轮变更入口')
    await turnChange.click()
    await page.locator('.work-file-body').waitFor()
    await page.locator('.work-file-actions').getByRole('button', { name: '打开', exact: true }).click()
    if (await page.evaluate(() => window.openedPath) !== '/work/alpha/good.txt') throw Error('相对文件路径没有基于项目解析')
    if (!await page.getByText('模拟失败详情', { exact: true }).count()) throw Error('折叠回复隐藏了失败详情')
    if (!await page.locator('.folded-answer img').count()) throw Error('折叠回复隐藏了图片')
    const imageWidth = await page.locator('.folded-answer img').evaluate((el) => el.getBoundingClientRect().width)
    if (imageWidth > 8) throw Error('小图片被拉伸到对话宽度')
    if (await page.getByText('正在检查项目。', { exact: true }).count()) throw Error('把过程文字误当成最终回复')
    if (await page.locator('.turn').filter({ hasText: '一个简单问题' }).locator('.turn-summary').count()) throw Error('普通回答显示了无意义的执行过程')
    await page.evaluate(() => window.emitRecord({ type: 'tool_execution_end', toolCallId: 'failed-call', toolName: 'read', isError: true }))
    await page.waitForTimeout(100)
    const errorCount = await page.locator('.turn').filter({ hasText: '测试工具错误' }).locator('.turn-summary-error').innerText()
    if (errorCount.trim() !== '1') throw Error(`同一工具错误被重复计数: ${errorCount}`)
    if (await page.locator('.project-shortcut').count() !== 3) throw Error('旧会话的项目没有出现在项目列表')
    const betaExpand = page.getByRole('button', { name: '展开 beta 的会话' })
    if (await betaExpand.count() !== 1) throw Error('无法展开其他项目的会话')
    await betaExpand.click()
    if (!await page.getByText('Beta 的会话', { exact: true }).isVisible()) throw Error('项目下未显示会话')
    await page.getByText('项目结构', { exact: true }).click()
    await page.waitForTimeout(100)
    await page.locator('.chat-scroll').evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
    await page.getByText('Beta 的会话', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.workspace-name')?.textContent === 'beta')
    await page.getByText('项目结构', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.workspace-name')?.textContent === 'alpha')
    await page.waitForTimeout(150)
    if (await page.locator('.chat-scroll').evaluate((el) => el.scrollTop) > 20) throw Error('切回会话后阅读位置丢失')
    await page.locator('.composer-input').fill('alpha 的草稿')
    await page.locator('input[type="file"]').setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=', 'base64') })
    await page.locator('.attachment').waitFor()
    await page.locator('.project-shortcut').filter({ hasText: 'beta' }).click()
    await page.waitForFunction(() => document.querySelector('.workspace-name')?.textContent === 'beta')
    if (await page.locator('.composer-input').inputValue()) throw Error('切换项目时带入了其他会话的草稿')
    if (await page.locator('.attachment').count()) throw Error('切换项目时带入了其他会话的附件')
    await page.locator('.composer-input').fill('beta 的草稿')
    await page.locator('.new-session').click()
    await page.waitForTimeout(150)
    if (await page.locator('.composer-input').inputValue() !== 'beta 的草稿' || !await page.getByText('当前有未发送的草稿', { exact: true }).count()) throw Error('新建会话时未保护未发送草稿')
    await page.locator('.composer-input').fill('')
    await page.locator('.new-session').click()
    await page.waitForTimeout(150)
    if (await page.locator('.composer-input').inputValue()) throw Error('同一项目的新会话继承了之前的草稿')
    await page.getByText('项目结构', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.workspace-name')?.textContent === 'alpha')
    if (await page.locator('.composer-input').inputValue() !== 'alpha 的草稿') throw Error('切回会话未恢复草稿')
    if (await page.locator('.attachment').count() !== 1) throw Error('切回会话未恢复附件')
    await page.waitForTimeout(100)
    if (await page.locator('.chat-scroll').evaluate((el) => el.scrollTop) > 20) throw Error('切回会话后阅读位置丢失')
    await page.evaluate(() => window.emitRecord({ type: 'agent_start' }))
    await page.waitForTimeout(100)
    const liveSummary = page.locator('.turn.is-streaming .turn-summary-text').last()
    const firstLiveSummary = await liveSummary.innerText()
    await page.waitForTimeout(1200)
    if (await liveSummary.innerText() === firstLiveSummary) throw Error('运行中耗时没有更新')
    await page.locator('.project-shortcut').filter({ hasText: 'beta' }).click()
    await page.waitForTimeout(100)
    if (await page.locator('.workspace-name').innerText() !== 'alpha') throw Error('运行中切换中断任务')
    if (!await page.getByText('任务正在运行', { exact: true }).count()) throw Error('运行中切换没有提示')
    await page.evaluate(() => window.emitRecord({ type: 'agent_settled' }))
    await page.waitForTimeout(100)
    await page.locator('.project-shortcut').filter({ hasText: 'beta' }).click()
    await page.waitForFunction(() => document.querySelector('.workspace-name')?.textContent === 'beta')
    await page.locator('.chip').first().click()
    await page.waitForSelector('.popover .menu-list')
    await page.mouse.move(0, 0)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    if (await page.locator('.menu-item.highlight .menu-item-title').innerText() !== 'Mock Bulk 0') throw Error('模型菜单键盘导航错误')
    await page.locator('.menu-search input').fill('deep')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.chip-label')?.textContent === 'Mock Deep')
    const panel = page.getByRole('button', { name: '工作面板', exact: true })
    for (const label of ['文件', '终端', '产物']) {
      await page.getByRole('button', { name: '添加工作区标签' }).click()
      await page.getByRole('menuitem', { name: label, exact: true }).click()
    }
    if (await panel.count() !== 1 || await page.locator('.work-tab-button').count() !== 4) throw Error('工作面板入口或标签缺失')
    await page.getByRole('tab', { name: '变更', exact: true }).click()
    await page.getByRole('tab', { name: '变更', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => document.querySelector('[role="tab"][aria-label="文件"]')?.getAttribute('aria-selected') === 'true')
    await panel.click()
    if (await page.locator('.work-panel').isVisible()) throw Error('面板未关闭')
    await panel.click()
    await page.waitForSelector('.work-panel')
    await page.getByRole('tab', { name: '文件' }).click()
    await page.getByText('example.txt', { exact: true }).click()
    if (!await page.getByRole('tab', { name: 'example.txt', exact: true }).count()) throw Error('文件没有作为独立标签打开')
    await page.getByRole('tab', { name: '文件', exact: true }).click()
    await page.getByText('nested', { exact: true }).click()
    await page.getByText('nested.txt', { exact: true }).click()
    if (!await page.getByRole('tab', { name: 'nested.txt', exact: true }).count()) throw Error('不能同时打开多个文件标签')
    await page.getByRole('button', { name: '关闭nested.txt标签' }).click()
    if (await page.getByRole('tab', { name: 'nested.txt', exact: true }).count()) throw Error('文件标签无法关闭')
    await page.locator('.project-shortcut').filter({ hasText: 'alpha' }).click()
    await page.waitForFunction(() => document.querySelector('.workspace-name')?.textContent === 'alpha')
    if (await page.getByRole('tab', { name: 'example.txt', exact: true }).count()) throw Error('切换项目后显示了旧项目的文件标签')
    await page.locator('.project-shortcut').filter({ hasText: 'beta' }).click()
    await page.waitForFunction(() => document.querySelector('.workspace-name')?.textContent === 'beta')
    await page.getByRole('tab', { name: '文件', exact: true }).click()
    await page.getByText('example.txt', { exact: true }).click()
    await page.getByRole('tab', { name: 'example.txt', exact: true }).click()
    await page.getByRole('tab', { name: '变更' }).click()
    await page.getByRole('tab', { name: 'example.txt', exact: true }).click()
    if (!await page.locator('.file-preview:visible').getByText('示例文件', { exact: true }).count()) throw Error('切换面板标签后文件预览丢失')
    const maximize = page.getByRole('button', { name: '放大工作面板' })
    if (await maximize.count() !== 1) throw Error('工作面板缺少放大入口')
    const beforeMaximize = await page.locator('.work-panel').evaluate((el) => el.getBoundingClientRect().width)
    await maximize.click()
    const afterMaximize = await page.locator('.work-panel').evaluate((el) => el.getBoundingClientRect().width)
    if (afterMaximize <= beforeMaximize + 100 || !await page.locator('.file-preview:visible').getByText('示例文件', { exact: true }).isVisible()) throw Error('放大工作面板失败或丢失预览')
    await page.getByRole('button', { name: '恢复工作面板' }).click()
    const separator = page.getByRole('separator', { name: '调整工作面板宽度' })
    if (await separator.count() !== 1) throw Error('工作面板缺少键盘可操作的分隔线')
    const widthBeforeKey = await page.locator('.work-panel').evaluate((el) => el.getBoundingClientRect().width)
    await separator.focus()
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(100)
    const widthAfterKey = await page.locator('.work-panel').evaluate((el) => el.getBoundingClientRect().width)
    if (widthAfterKey <= widthBeforeKey) throw Error('键盘不能调整工作面板宽度')
    const handle = page.getByRole('separator', { name: '调整工作面板宽度' })
    const handleBox = await handle.boundingBox()
    await page.mouse.move(handleBox.x + 5, handleBox.y + 100)
    await page.mouse.down()
    await page.mouse.move(handleBox.x - 30, handleBox.y + 100)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    if (await page.evaluate(() => document.body.classList.contains('is-resizing'))) throw Error('拖动面板时失焦未结束拖拽')
    await page.mouse.up()
    const closeFileTab = page.getByRole('button', { name: '关闭文件标签' })
    if (await closeFileTab.count() !== 1) throw Error('缺少关闭工作区标签入口')
    await closeFileTab.click()
    if (await page.getByRole('tab', { name: '文件', exact: true }).count()) throw Error('标签未关闭')
    await page.getByRole('button', { name: '添加工作区标签' }).click()
    await page.getByRole('menuitem', { name: '文件', exact: true }).click()
    await page.getByRole('tab', { name: 'example.txt', exact: true }).click()
    if (!await page.locator('.file-preview:visible').getByText('示例文件', { exact: true }).isVisible()) throw Error('重新添加标签后预览丢失')
    await page.getByRole('button', { name: '关闭文件标签' }).click()
    await page.reload()
    await page.waitForSelector('.work-panel')
    if (await page.getByRole('tab', { name: '文件', exact: true }).count()) throw Error('重启后已关闭的标签重新出现')
    await page.getByRole('button', { name: '添加工作区标签' }).click()
    await page.getByRole('menuitem', { name: '文件', exact: true }).click()
    await page.getByText('example.txt', { exact: true }).click()
    await panel.click()
    await panel.click()
    if (!await page.locator('.file-preview:visible').getByText('示例文件', { exact: true }).isVisible()) throw Error('关闭并重新打开面板后预览丢失')
    await page.getByRole('tab', { name: '文件', exact: true }).click()
    await page.locator('.work-search input').fill('nested.txt')
    if (!await page.getByText('nested', { exact: true }).count()) throw Error('筛选时隐藏了可展开目录')
    await page.getByText('nested', { exact: true }).click()
    await page.getByText('nested.txt', { exact: true }).waitFor()
    await page.locator('.sidebar-footer .settings-entry').click()
    await page.waitForSelector('.settings-page')
    if (!await page.getByText('常规', { exact: true }).count()) throw Error('设置页未显示')
    await page.getByRole('button', { name: '界面语言', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'English' }).click()
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    if (await page.getByRole('button', { name: 'Work panel', exact: true }).count() !== 1) throw Error('英文工作面板入口缺失')
    await page.locator('.topbar-right .icon-button').filter({ has: page.locator('svg.lucide-sun') }).click()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    await page.setViewportSize({ width: 860, height: 560 })
    await page.waitForTimeout(350) // allow the sidebar width transition to settle
    const layout = await page.evaluate(() => ({
      main: document.querySelector('.main').getBoundingClientRect().toJSON(),
      panel: document.querySelector('.work-panel').getBoundingClientRect().toJSON()
    }))
    if (layout.main.right > layout.panel.left + 1 || layout.main.width < 340) throw Error('窄窗口工作面板遮挡对话或对话区过窄')
    const activeTabVisible = await page.locator('.work-tabs').evaluate((el) => {
      const selected = el.querySelector('[role="tab"][aria-selected="true"]')
      if (!selected) return false
      const strip = el.getBoundingClientRect(), item = selected.getBoundingClientRect()
      return item.left >= strip.left - 1 && item.right <= strip.right + 1
    })
    if (!activeTabVisible) throw Error('窄窗口下当前标签被遮住')
    const overflow = await page.locator('.composer-bar').evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    if (overflow) throw Error('窄窗口输入栏溢出')
    await page.locator('.work-panel .work-icon[aria-label="Close"]').click()
    await page.locator('.composer-input').fill('Test draft')
    if (await page.locator('.composer-input').inputValue() !== 'Test draft') throw Error('窄窗口输入框不可用')
    if (errors.length) throw Error(`页面异常: ${errors.join('; ')}`)
    console.log('无窗口检查通过：项目切换、运行中保护、模型菜单、工作面板、设置、主题和窄窗口')
  } finally {
    await browser.close()
    server.close()
  }
}
main().catch((error) => { console.error(error); server.close(); process.exitCode = 1 })
