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
    await page.addInitScript(({ dictationTest, platform }) => {
      let settings = {
        theme: 'dark', language: 'zh-CN', workspaces: ['/work/alpha', '/work/beta'],
        lastWorkspace: '/work/alpha', lastSessionPath: '/session/1', workPanelOpen: true, workPanelWidth: 360,
        workPanelTab: 'changes', workPanelTabs: ['home', 'changes', 'terminal'], followStream: true, turnAutoFold: true
      }
      settings = { ...settings, ...JSON.parse(sessionStorage.getItem('mock-settings') || '{}') }
      const models = [
        { id: 'test', name: 'Test Model', provider: 'mock' },
        { id: 'deep', name: 'Mock Deep', provider: 'mock' },
        ...Array.from({ length: 30 }, (_, i) => ({ id: `bulk-${i}`, name: `Mock Bulk ${i}`, provider: 'mock' }))
      ]
      let currentModel = models[0]
      let currentSessionPath = null
      let sessionPermission = { permission: 'review', mode: 'dangerous', sandboxed: false }
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
      if (sessionStorage.getItem('short-chat-fixture')) {
        messages.splice(0, messages.length,
          { role: 'user', content: '你好', timestamp: Date.now() },
          { role: 'assistant', content: [{ type: 'text', text: '你好！' }], timestamp: Date.now() })
      }
      if (sessionStorage.getItem('process-fixture')) {
        messages.splice(0, messages.length,
          { role: 'user', content: '历史错误分组', timestamp: Date.now() },
          { role: 'assistant', content: [{ type: 'toolCall', id: 'history-1', name: 'read', arguments: { path: 'a.txt' } }], timestamp: Date.now() },
          { role: 'toolResult', toolCallId: 'history-1', toolName: 'read', isError: true, content: [{ type: 'text', text: '读取失败' }], timestamp: Date.now() },
          { role: 'assistant', content: [{ type: 'toolCall', id: 'history-2', name: 'read', arguments: { path: 'b.txt' } }], timestamp: Date.now() },
          { role: 'toolResult', toolCallId: 'history-2', toolName: 'read', content: [{ type: 'text', text: 'ok' }], timestamp: Date.now() },
          { role: 'assistant', errorMessage: '执行异常详情', content: [{ type: 'toolCall', id: 'history-3', name: 'bash', arguments: { command: 'bad-command' } }], timestamp: Date.now() },
          { role: 'assistant', content: [{ type: 'text', text: '历史执行完成' }], timestamp: Date.now() },
          { role: 'user', content: '实时分组', timestamp: Date.now() })
      }
      const modelConfig = { file: '/mock/models.json', providers: {} }
      const piSettings = { defaultProvider: 'mock', defaultModel: 'test' }
      window.sentCommands = []
      const noop = () => () => {}
      const emitPty = (chunk) => window.__ptyDataCb?.({ id: 'pty-mock', data: chunk })
      window.pi = {
        platform,
        // PTY terminal mock: echoes keystrokes and answers canned commands so
        // xterm screenshots show a realistic session without a real shell.
        createTerminal: async () => {
          window.ptyBuffer = ''
          // Real shells print the prompt asynchronously; emitting after the
          // renderer's data subscription avoids the startup race.
          setTimeout(() => emitPty('\x1b[32m$\x1b[0m '), 60)
          return { id: 'pty-mock' }
        },
        writeTerminal: (id, data) => {
          const emit = emitPty
          for (const ch of data) {
            if (ch === '\r') {
              const cmd = window.ptyBuffer
              window.ptyBuffer = ''
              let out = ''
              if (/npm run build/.test(cmd)) out = '\x1b[36m> vite build\x1b[0m\n\ndist/index.html                  1.2 kB\nassets/index.js         2,546.6 kB\n\x1b[32m✓ built in 579ms\x1b[0m'
              else if (/git push/.test(cmd)) out = '\x1b[31mfatal: unable to access remote: authentication failed\x1b[0m'
              else if (/npm test/.test(cmd)) out = '\x1b[32mMock suite passed\x1b[0m\n  42 tests ✓'
              else out = `(mock) ${cmd}`
              emit(`\r\n${out}\r\n\x1b[32m$\x1b[0m `)
            } else if (ch === '\u007f') {
              window.ptyBuffer = window.ptyBuffer.slice(0, -1)
              emit('\b \b')
            } else {
              window.ptyBuffer += ch
              emit(ch)
            }
          }
        },
        resizeTerminal: async () => {},
        killTerminal: async () => {},
        onTerminalData: (callback) => { window.__ptyDataCb = callback; return () => {} },
        onTerminalExit: () => () => {},
        initialTheme: settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme,
        systemTheme: async () => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        onSystemTheme: (callback) => { const media = matchMedia('(prefers-color-scheme: dark)'); const change = () => callback(media.matches ? 'dark' : 'light'); media.addEventListener('change', change); return () => media.removeEventListener('change', change) },
        onPiInstallProgress: noop, onBrowserState: noop, onBrowserReveal: noop, onUpdateAvailable: noop,
        browserCurrent: async () => ({ documentId: null, controlledTab: null, otherTab: null }),
        onUpdateProgress: noop, onSandboxDomainDenied: noop, onOAuthEvent: noop,
        sandboxStatus: async () => ({ available: false, reason: '测试环境' }),
        sessionSecurity: async () => sessionPermission,
        setSessionPermission: async ({ permission }) => {
          sessionPermission = {
            permission,
            mode: permission === 'full' ? 'never' : permission === 'ask' ? 'all' : 'dangerous',
            sandboxed: false
          }
          return sessionPermission
        },
        projectTrustStatus: async () => ({ required: true, decision: null, resources: ['/work/alpha/.pi/extensions'] }),
        countSkills: async () => 0,
        listSchedules: async () => [],
        getSessionNotices: async () => [],
        bootstrap: async () => { const delay = Number(sessionStorage.getItem('mock-startup-delay') || 0); if (delay) await new Promise(resolve => setTimeout(resolve, delay)); if (sessionStorage.getItem('mock-startup-error')) throw Error('模拟启动失败'); return { settings, home: '/work', piVersion: '1.4.0', electronVersion: '45', appVersion: '0.1.6', piSettings } },
        updatePiSettings: async (patch) => { Object.assign(piSettings, patch); window.savedPiSettings = { ...piSettings }; return piSettings },
        listSessions: async () => [
          { path: '/session/1', id: '1', cwd: '/work/alpha', name: '项目结构', preview: '项目结构', updatedAt: Date.now(), createdAt: Date.now(), messageCount: 2, size: 10 },
          { path: '/session/2', id: '2', cwd: '/work/beta', name: 'Beta 的会话', preview: '', updatedAt: Date.now(), createdAt: Date.now(), messageCount: 2, size: 10 },
          { path: '/session/3', id: '3', cwd: '/work/gamma', name: '旧项目会话', preview: '', updatedAt: Date.now(), createdAt: Date.now(), messageCount: 2, size: 10 }
        ],
        openSession: async ({ cwd, sessionPath }) => {
          currentSessionPath = sessionPath ?? '/session/new'
          return { ok: true, cwd, sessionPath: currentSessionPath }
        },
        closeSession: async () => {},
        pickFolder: async () => { window.folderPickerOpened = true; return null },
        readModelsConfig: async () => modelConfig,
        listPiModels: async () => ({ models: [] }),
        saveProvider: async (id, entry) => { modelConfig.providers[id] = entry; window.savedProvider = { id, entry }; return modelConfig },
        command: async (command) => {
          if (['prompt', 'steer', 'follow_up'].includes(command.type)) window.sentCommands.push(command)
          if (['steer', 'follow_up'].includes(command.type) && window.failNextQueue) { window.failNextQueue = false; return { success: false, error: 'queue rejected' } }
          if (command.type === 'set_model') currentModel = models.find((model) => model.id === command.modelId)
          if (command.type === 'bash') {
            if (/fail|push|missing/.test(command.command)) return { success: false, error: 'fatal: unable to access remote: authentication failed' }
            if (/npm test/.test(command.command)) return await new Promise((resolve) => setTimeout(() => resolve({ success: true, data: { exitCode: 0, output: 'Mock suite passed\n  42 tests ✓' } }), 2500))
            return { success: true, data: { exitCode: 0, output: `> pi-desktop@0.7.8 build\n> vite build\n\ndist/index.html                  1.2 kB\nassets/index-BvQyLwNb.js  2,546.6 kB\n✓ built in 579ms` } }
          }
          return { success: true, data: ({
            get_state: { thinkingLevel: 'high', model: currentModel, isStreaming: window.mockStreaming === true },
            get_messages: { messages: currentSessionPath === '/session/new' ? [] : messages }, get_session_stats: {}, get_available_models: { models },
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
        onScheduleEvent: noop, onScheduleOpen: noop, onSchedulesChanged: noop,
        gitStatus: async () => ({ files: [] }), gitBranch: async () => null, gitDiff: async () => '',
        readDir: async (dir) => dir.endsWith('/nested')
          ? [{ path: `${dir}/nested.txt`, name: 'nested.txt', isDir: false, size: 8 }]
          : [{ path: `${dir}/example.txt`, name: 'example.txt', isDir: false, size: 8 }, { path: `${dir}/nested`, name: 'nested', isDir: true, size: 0 }],
        readText: async () => ({ ok: true, content: '示例文件', truncated: false }),
        openPath: async (value) => { window.openedPath = value; return true },
        notify: async (payload) => { window.lastNotify = payload; return true },
        onNotifyOpen: (callback) => { window.emitNotifyOpen = callback; return () => {} }
      }
      if (dictationTest) {
        window.dictationRequests = []
        window.dictationStops = []
        window.dictationCancels = []
        window.pi.dictation = {
          available: async () => {
            window.dictationAvailabilityChecked = true
            return !sessionStorage.getItem('mock-dictation-unavailable')
          },
          start: async (id, locale) => {
            window.dictationRequests.push({ id, locale })
            window.emitDictation({ id, type: 'recording' })
          },
          stop: async (id) => { window.dictationStops.push(id) },
          cancel: async (id) => { window.dictationCancels.push(id) },
          openSettings: async (permission) => { window.dictationPermission = permission },
          onEvent: (callback) => { window.emitDictation = callback; return () => {} }
        }
      }
    }, {
      dictationTest: process.env.HEADLESS_UI_ONLY === 'dictation',
      platform: process.env.HEADLESS_UI_PLATFORM || 'darwin'
    })
    const errors = []
    page.on('pageerror', (error) => { errors.push(error.message); console.error(`页面异常: ${error.message}`) })
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    if (process.env.HEADLESS_UI_ONLY === 'startup') {
      const assert = require('node:assert/strict')
      const shots = path.resolve(__dirname, '../output/startup')
      fs.mkdirSync(shots, { recursive: true })
      await page.evaluate(() => sessionStorage.removeItem('mock-startup-delay'))
      await page.reload()
      await page.locator('.startup-screen[data-finished="false"]').waitFor({state:'visible'})
      await page.waitForTimeout(200)
      assert.equal(await page.locator('.startup-screen[data-finished="false"]').count(), 1, 'Fast startup skipped the mark animation')
      await page.locator('.startup-screen').waitFor({ state:'detached', timeout:1500 })
      await page.evaluate(() => sessionStorage.setItem('mock-startup-delay', '1800'))
      await page.reload()
      const splash = page.locator('.startup-screen')
      await splash.waitFor({ state: 'visible' })
      await splash.evaluate(el => { for (const animation of el.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 160 } })
      await page.screenshot({ path: path.join(shots, 'pixels-scattered.png') })
      await splash.evaluate(el => { for (const animation of el.getAnimations({ subtree: true })) animation.currentTime = 360 })
      await page.screenshot({ path: path.join(shots, 'pixels-gathering.png') })
      await splash.evaluate(el => { for (const animation of el.getAnimations({ subtree: true })) animation.play() })
      await splash.getByText('正在启动…', { exact: true }).waitFor()
      assert.ok(await splash.locator('.startup-pixel').count() > 100, 'Pi mark must assemble from many pixels')
      assert.notEqual(await splash.locator('.startup-logo').evaluate(el => getComputedStyle(el).animationName), 'none')
      await page.screenshot({ path: path.join(shots, 'dark.png'), animations: 'disabled' })
      await splash.waitFor({ state: 'detached', timeout: 5000 })
      await page.waitForSelector('.turn')
      await page.evaluate(() => { sessionStorage.setItem('mock-settings', JSON.stringify({theme:'light'})); sessionStorage.setItem('mock-startup-delay', '1400') })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.reload()
      await splash.waitFor({state:'visible'})
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      assert.equal(await splash.locator('.startup-logo').evaluate(el => getComputedStyle(el).animationName), 'none')
      await page.screenshot({ path: path.join(shots, 'light.png'), animations: 'disabled' })
      await splash.waitFor({state:'detached', timeout:5000})
      await page.evaluate(() => { sessionStorage.removeItem('mock-startup-delay'); sessionStorage.setItem('mock-startup-error', '1') })
      await page.reload()
      await page.locator('.error-banner').getByText('模拟启动失败').waitFor()
      await splash.waitFor({state:'detached'})
      assert.equal(await page.getByRole('button', { name: 'Retry' }).isVisible(), true)
      await page.evaluate(() => sessionStorage.removeItem('mock-startup-error'))
      await page.getByRole('button', { name: 'Retry' }).click()
      await page.waitForSelector('.turn')
      await splash.waitFor({state:'detached', timeout:2000})
      if (errors.length) throw Error(`页面异常: ${errors.join('; ')}`)
      console.log('PASS startup: delayed bootstrap, brand animation, reduced motion, failure recovery and fast launch')
      return
    }
    await page.waitForSelector('.project-row').catch(async (error) => {
      throw new Error(`项目列表未加载: ${errors.join('; ') || '无页面异常'}; 内容: ${(await page.locator('body').innerText()).slice(0, 500)}`, { cause: error })
    })
    await page.waitForSelector('.turn')
    if (process.env.HEADLESS_UI_ONLY === 'dictation') {
      await require('./dictation-ui.cjs')(page)
      if (errors.length) throw Error(`页面异常: ${errors.join('; ')}`)
      return
    }
    if (process.env.HEADLESS_UI_ONLY === 'theme') {
      const assert = require('node:assert/strict')
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.locator('.sidebar-footer .settings-entry').click()
      await page.locator('.settings-nav-item').filter({ hasText: '外观' }).click()
      const system = page.getByRole('button', { name: '跟随系统', exact: true })
      await system.click()
      assert.equal(await system.getAttribute('aria-pressed'), 'true')
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
      await page.emulateMedia({ colorScheme: 'light' })
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock-settings')).theme), 'system')
      await page.screenshot({ path: path.resolve(__dirname, '../output/theme-system.png') })
      await page.reload()
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      await page.waitForSelector('.turn')
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
      await page.locator('.sidebar-footer .settings-entry').click()
      await page.locator('.settings-nav-item').filter({ hasText: '外观' }).click()
      await page.getByRole('button', { name: '浅色', exact: true }).click()
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      await page.emulateMedia({ colorScheme: 'light' })
      await page.emulateMedia({ colorScheme: 'dark' })
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light')
      if (errors.length) throw Error(`页面异常: ${errors.join('; ')}`)
      console.log('跟随系统主题检查通过：实时切换、重启恢复、手动覆盖与设置状态')
      return
    }
    if (process.env.HEADLESS_UI_ONLY === 'terminal-shots') {
      const shots = path.resolve(__dirname, '../output/terminal')
      fs.mkdirSync(shots, { recursive: true })
      const host = () => page.locator('.terminal-pty-host')
      const openTerminal = async () => {
        await page.locator('.work-tab-button').filter({ hasText: '终端' }).click()
        await host().waitFor()
        await host().click()
        await page.waitForFunction(() => document.querySelector('.terminal-pty-host')?.innerText.includes('$')).catch(async () => {
          const dump = await page.evaluate(() => ({
            hostSize: (h => h ? `${h.offsetWidth}x${h.offsetHeight}` : null)(document.querySelector('.terminal-pty-host')),
            text: (document.querySelector('.terminal-pty-host')?.innerText || '').slice(0, 200),
            xterm: Boolean(document.querySelector('.terminal-pty-host .xterm')),
            dataCb: typeof window.__ptyDataCb,
            buffer: window.ptyBuffer,
            pageErrors: window.__pageErrors || []
          }))
          throw Error(`terminal prompt never appeared: ${JSON.stringify(dump)}`)
        })
      }
      const runCommand = async (text) => {
        await host().click()
        await page.keyboard.type(text, { delay: 15 })
        await page.keyboard.press('Enter')
      }
      await openTerminal()
      await runCommand('npm run build')
      // The panel is narrow: match a prefix that cannot wrap mid-word.
      await page.waitForFunction(() => document.querySelector('.terminal-pty-host')?.innerText.includes('built in 57'))
      await runCommand('git push')
      await page.waitForFunction(() => document.querySelector('.terminal-pty-host')?.innerText.includes('fatal:'))
      await page.screenshot({ path: path.join(shots, 'dark.png'), animations: 'disabled' })
      await page.getByRole('button', { name: '清空', exact: true }).click()
      await page.waitForFunction(() => !(document.querySelector('.terminal-pty-host')?.innerText.includes('authentication failed')))
      if (!(await host().innerText()).includes('$')) throw Error('Clear must keep the prompt')
      await page.evaluate(() => sessionStorage.setItem('mock-settings', JSON.stringify({ ...JSON.parse(sessionStorage.getItem('mock-settings')), theme: 'light' })))
      await page.reload()
      await page.waitForSelector('.turn')
      await openTerminal()
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      await runCommand('npm run build')
      await page.waitForFunction(() => document.querySelector('.terminal-pty-host')?.innerText.includes('built in 57'))
      await page.screenshot({ path: path.join(shots, 'light.png'), animations: 'disabled' })
      if (errors.length) throw Error(`页面异常: ${errors.join('; ')}`)
      console.log('terminal-shots: dark / light 已保存到 output/terminal/')
      return
    }
    if (process.env.HEADLESS_UI_ONLY === 'settings-shots') {
      const shots = path.resolve(__dirname, '../output/settings-shortcuts')
      fs.mkdirSync(shots, { recursive: true })
      const openShortcuts = async () => {
        await page.locator('.sidebar-footer .settings-entry').click()
        await page.locator('.settings-nav-item').filter({ hasText: '快捷键' }).click()
        await page.getByText('发送消息', { exact: true }).waitFor()
      }
      await openShortcuts()
      await page.screenshot({ path: path.join(shots, 'dark.png'), animations: 'disabled' })
      await page.setViewportSize({ width: 900, height: 900 })
      await page.waitForTimeout(300)
      await page.screenshot({ path: path.join(shots, 'narrow.png'), animations: 'disabled' })
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.evaluate(() => sessionStorage.setItem('mock-settings', JSON.stringify({ ...JSON.parse(sessionStorage.getItem('mock-settings')), theme: 'light' })))
      await page.reload()
      await page.waitForSelector('.turn')
      await openShortcuts()
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      await page.screenshot({ path: path.join(shots, 'light.png'), animations: 'disabled' })
      if (errors.length) throw Error(`页面异常: ${errors.join('; ')}`)
      console.log('settings-shots: dark / narrow / light 已保存到 output/settings-shortcuts/')
      return
    }
    if (process.env.HEADLESS_UI_ONLY === 'settings-shots-win') {
      const shots = path.resolve(__dirname, '../output/settings-shortcuts')
      fs.mkdirSync(shots, { recursive: true })
      await page.locator('.sidebar-footer .settings-entry').click()
      await page.locator('.settings-nav-item').filter({ hasText: '快捷键' }).click()
      await page.getByText('发送消息', { exact: true }).waitFor()
      await page.screenshot({ path: path.join(shots, 'windows.png'), animations: 'disabled' })
      if (errors.length) throw Error(`页面异常: ${errors.join('; ')}`)
      console.log('settings-shots-win: windows.png 已保存')
      return
    }
    await require('./context-usage-ui.cjs')(page)
    if (process.env.HEADLESS_UI_ONLY === 'context') {
      if (errors.length) throw Error(`页面异常: ${errors.join('; ')}`)
      return
    }
    // Context tests exercise lifecycle events; restore an isolated renderer for other cases.
    await page.reload()
    await page.waitForSelector('.turn')
    await page.getByRole('button', { name: '自动模式', exact: true }).click()
    await page.getByRole('menuitemradio', { name: /手动确认/ }).click()
    await page.getByRole('button', { name: '手动确认', exact: true }).waitFor()
    if ((await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock-settings') || '{}'))).toolApprovalMode === 'all') throw Error('切换当前会话误改了全局默认权限')
    await page.getByRole('button', { name: '手动确认', exact: true }).click()
    await page.getByRole('menuitemradio', { name: /自动模式/ }).click()
    await page.getByRole('button', { name: '自动模式', exact: true }).waitFor()
    if (await page.locator('.project-trust-banner, .project-trust-collapsed').count()) throw Error('对话区仍有项目信任提示')
    const activeProject = page.locator('.project-row.active')
    await activeProject.hover()
    await activeProject.getByRole('button', { name: '项目操作' }).click()
    await page.getByRole('menuitem', { name: '项目信任', exact: true }).click()
    const projectTrust = page.getByRole('dialog', { name: '项目信任' })
    await projectTrust.getByText('/work/alpha/.pi/extensions', { exact: true }).waitFor()
    await projectTrust.getByRole('button', { name: '取消', exact: true }).click()
    if (await page.locator('.workspace-button, .brand-action').count()) throw Error('侧栏仍有重复的项目或新建会话入口')
    await page.locator('.project-add').click()
    await page.getByRole('heading', { name: '添加项目', exact: true }).waitFor()
    await page.getByRole('button', { name: '选择文件夹', exact: true }).click()
    if (!await page.evaluate(() => window.folderPickerOpened)) throw Error('项目列表无法打开文件夹')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    if (await page.locator('.work-tab-button').count() !== 1) throw Error('新工作区不应预置四个标签')
    if (await page.locator('.older-turns').count()) throw Error('默认隐藏了较早的对话')
    if (await page.locator('.work-file-head', { hasText: 'failed.txt' }).count()) throw Error('失败的写入被当作文件变更')
    if (!await page.locator('.work-file-head', { hasText: 'overwritten.txt' }).getByText('行数未知', { exact: true }).count()) throw Error('覆盖写入被误认为全部新增')
    const changeSummary = await page.locator('.work-summary').innerText()
    if (!changeSummary.includes('+1') || !changeSummary.includes('−1')) throw Error(`变更行数不准确: ${changeSummary}`)
    const turnChange = page.locator('.turn').filter({ hasText: '修改文件' }).locator('.turn-changes-row', { hasText: 'good.txt' })
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
    if (errorCount.trim() !== '1 条异常记录') throw Error(`同一工具错误被重复计数: ${errorCount}`)
    const toolErrorSummary = page.locator('.turn').filter({ hasText: '测试工具错误' }).locator('.turn-summary')
    if (!await toolErrorSummary.getByText('过程结束', { exact: false }).count() || await toolErrorSummary.evaluate(el => el.classList.contains('has-error'))) throw Error('工具异常被误标为整轮响应中断')
    const responseErrorSummary = page.locator('.turn').filter({ hasText: '请检查项目结构。' }).locator('.turn-summary')
    if (!await responseErrorSummary.getByText('响应中断', { exact: false }).count() || !await responseErrorSummary.evaluate(el => el.classList.contains('has-error'))) throw Error('最终响应异常没有被明确提示')
    if (await page.locator('.project-row').count() !== 2 || !await page.getByText('旧项目会话', { exact: true }).count()) throw Error('项目列表或最近对话未显示预期内容')
    await page.locator('.search-box input').fill('Beta 的会话')
    if (await page.locator('.project-row').count() !== 1) throw Error('搜索未隐藏无匹配的项目')
    await page.locator('.search-box input').fill('绝无匹配的会话名称')
    if (await page.getByText('没有匹配的会话。', { exact: true }).count() !== 1) throw Error('搜索无结果提示不正确')
    await page.locator('.search-box input').fill('')
    const betaExpand = page.getByRole('button', { name: '展开 beta 的会话' })
    if (await betaExpand.count()) await betaExpand.click()
    if (!await page.getByText('Beta 的会话', { exact: true }).isVisible()) throw Error('项目下未显示会话')
    await page.getByText('项目结构', { exact: true }).click()
    await page.waitForTimeout(100)
    await page.locator('.chat-scroll').evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
    await page.getByText('Beta 的会话', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.project-row.active .project-row-main span')?.textContent === 'beta')
    await page.getByText('项目结构', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.project-row.active .project-row-main span')?.textContent === 'alpha')
    await page.waitForTimeout(150)
    if (await page.locator('.chat-scroll').evaluate((el) => el.scrollTop) > 20) throw Error('切回会话后阅读位置丢失')
    await page.locator('.composer-input').fill('alpha 的草稿')
    await page.locator('input[type="file"]').setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=', 'base64') })
    await page.locator('.attachment').waitFor()
    await page.getByText('Beta 的会话', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.project-row.active .project-row-main span')?.textContent === 'beta')
    if (await page.locator('.composer-input').inputValue()) throw Error('切换项目时带入了其他会话的草稿')
    if (await page.locator('.attachment').count()) throw Error('切换项目时带入了其他会话的附件')
    await page.locator('.composer-input').fill('beta 的草稿')
    await page.getByRole('button', { name: '在 beta 中新建对话' }).click()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value === '')
    if (await page.getByText('当前有未发送的草稿', { exact: true }).count()) throw Error('草稿阻止了新建会话')
    await page.getByText('Beta 的会话', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.composer-input')?.value === 'beta 的草稿')
    await page.getByText('项目结构', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.project-row.active .project-row-main span')?.textContent === 'alpha')
    if (await page.locator('.composer-input').inputValue() !== 'alpha 的草稿') throw Error('切回会话未恢复草稿')
    if (await page.locator('.attachment').count() !== 1) throw Error('切回会话未恢复附件')
    await page.waitForTimeout(100)
    if (await page.locator('.chat-scroll').evaluate((el) => el.scrollTop) > 20) throw Error('切回会话后阅读位置丢失')
    await page.evaluate(() => window.emitRecord({ type: 'agent_start' }))
    await page.waitForTimeout(100)
    const liveTurn = page.locator('.turn.is-streaming').last()
    const liveToggle = liveTurn.locator('.turn-summary-main')
    if (await liveToggle.getAttribute('aria-expanded') !== 'true') throw Error('运行中的过程默认应展开')
    const firstElapsed = await liveTurn.locator('.turn-elapsed').textContent()
    await page.waitForFunction((previous) => {
      const elapsed = document.querySelector('.turn.is-streaming .turn-elapsed')?.textContent
      return elapsed?.startsWith('执行中 ') && elapsed !== previous
    }, firstElapsed)
    await liveToggle.click()
    if (await liveToggle.getAttribute('aria-expanded') !== 'false') throw Error('运行中不能收起过程')
    await liveToggle.click()
    if (await liveToggle.getAttribute('aria-expanded') !== 'true') throw Error('运行中不能展开过程')
    const tool = liveTurn.locator('.tool-card').first()
    const toolHead = tool.locator('.tool-head')
    if (await toolHead.getAttribute('aria-expanded') !== 'false') throw Error('工具详情默认没有收起')
    await toolHead.click()
    await page.evaluate(() => window.emitRecord({ type: 'tool_execution_start', toolCallId: 'edit-ok', toolName: 'edit', args: { path: 'good.txt' } }))
    await page.evaluate(() => window.emitRecord({ type: 'tool_execution_end', toolCallId: 'edit-ok', toolName: 'edit', isError: false }))
    if (await toolHead.getAttribute('aria-expanded') !== 'true') throw Error('工具状态变化覆盖了手动展开')
    await liveToggle.click()
    if (await liveToggle.getAttribute('aria-expanded') !== 'false') throw Error('运行中不能收起过程')
    await page.evaluate(() => window.emitRecord({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: '正在生成的回答' }], timestamp: Date.now() } }))
    await liveTurn.locator('.folded-answer').getByText('正在生成的回答', { exact: true }).waitFor({ state: 'visible' })
    if (await liveToggle.getAttribute('aria-expanded') !== 'false') throw Error('新消息覆盖了手动收起')
    await page.locator('.attachment-remove').click()
    await page.locator('.composer-input').fill('请任务结束后再检查')
    if (!await page.getByRole('button', { name: '停止', exact: true }).isVisible()) throw Error('运行中没有停止按钮')
    await page.locator('.composer-input').press('Enter')
    await page.waitForFunction(() => window.sentCommands.some((command) => command.type === 'follow_up' && command.message === '请任务结束后再检查'))
    await page.waitForFunction(() => document.querySelector('.composer-input').value === '')
    await page.locator('.queue-item').getByText('请任务结束后再检查', { exact: true }).waitFor()
    await page.locator('.composer-input').fill('现在调整方向')
    await page.locator('.composer-input').press('Enter')
    await page.locator('.queue-item').filter({ hasText: '现在调整方向' }).getByRole('button', { name: '引导', exact: true }).click()
    await page.waitForFunction(() => window.sentCommands.some((command) => command.type === 'steer' && command.message === '现在调整方向'))
    await page.waitForFunction(() => document.querySelector('.composer-input').value === '')
    await page.evaluate(() => window.emitRecord({ type: 'message_start', message: { role: 'user', content: '现在调整方向', timestamp: Date.now() } }))
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('.queue-item p')).some((el) => el.textContent === '现在调整方向'))
    await page.locator('.composer-input').fill('再排队一条')
    if (!await page.getByRole('button', { name: '停止', exact: true }).isVisible()) throw Error('插话后没有恢复停止按钮')
    await page.setViewportSize({ width: 860, height: 560 })
    await page.waitForTimeout(350)
    if (await page.locator('.composer-bar').evaluate((el) => el.scrollWidth > el.clientWidth + 1)) throw Error('运行中窄窗口发送控件溢出')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => { window.failNextQueue = true })
    await page.locator('.composer-input').press('Enter')
    await page.getByText('queue rejected', { exact: true }).waitFor()
    if (await page.locator('.queue-item').filter({ hasText: '再排队一条' }).count()) throw Error('发送失败的消息仍显示排队')
    if (await page.locator('.composer-input').inputValue() !== '再排队一条') throw Error('发送失败后草稿丢失')
    await page.evaluate(() => window.emitRecord({ type: 'queue_update', steering: ['立即调整'], followUp: ['稍后检查'] }))
    await page.locator('.queue-item.is-guiding').getByText('立即调整', { exact: true }).waitFor()
    await page.locator('.queue-item:not(.is-guiding)').getByText('稍后检查', { exact: true }).waitFor()
    await page.locator('.composer-input').fill('')
    // The Electron background-session test covers native notifications.
    await page.evaluate(() => window.emitRecord({ type: 'agent_settled' }))
    await page.getByRole('button', { name: '停止', exact: true }).waitFor({ state: 'hidden' })
    if (await page.locator('.queue-item').count()) throw Error('任务结束后仍显示排队消息')
    await page.waitForTimeout(100)
    await page.evaluate(() => { window.mockStreaming = true })
    await page.getByRole('button', { name: '在 beta 中新建对话' }).click()
    await page.waitForFunction(() => document.querySelector('.project-row.active .project-row-main span')?.textContent === 'beta')
    if (!await page.getByRole('button', { name: '停止', exact: true }).count()) throw Error('返回运行中会话后未恢复运行状态')
    await page.evaluate(() => { window.mockStreaming = false; window.emitRecord({ type: 'agent_settled' }) })
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
      await page.getByRole('button', { name: '新标签页', exact: true }).click()
      await page.locator('.work-home').getByRole('button', { name: label === '产物' ? '全部产物' : label, exact: true }).click()
    }
    if (await panel.count() !== 1 || await page.locator('.work-tab-button').count() !== 4) throw Error('工作面板入口或标签缺失')
    await page.getByRole('tab', { name: '变更', exact: true }).click()
    await page.getByRole('tab', { name: '变更', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => document.querySelector('[role="tab"][aria-label="文件"]')?.getAttribute('aria-selected') === 'true')
    await panel.click()
    // The panel animates to zero width. Wait for that instead of sampling mid-transition.
    await page.waitForFunction(() => {
      const el = document.querySelector('.work-panel')
      return !el || (el.classList.contains('is-closed') && el.getBoundingClientRect().width < 2)
    })
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
    await page.getByRole('button', { name: '在 alpha 中新建对话' }).click()
    await page.waitForFunction(() => document.querySelector('.project-row.active .project-row-main span')?.textContent === 'alpha')
    if (await page.getByRole('tab', { name: 'example.txt', exact: true }).count()) throw Error('切换项目后显示了旧项目的文件标签')
    await page.getByRole('button', { name: '在 beta 中新建对话' }).click()
    await page.waitForFunction(() => document.querySelector('.project-row.active .project-row-main span')?.textContent === 'beta')
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
    await page.getByRole('button', { name: '新标签页', exact: true }).click()
    await page.locator('.work-home').getByRole('button', { name: '文件', exact: true }).click()
    await page.getByRole('tab', { name: 'example.txt', exact: true }).click()
    if (!await page.locator('.file-preview:visible').getByText('示例文件', { exact: true }).isVisible()) throw Error('重新添加标签后预览丢失')
    await page.getByRole('button', { name: '关闭文件标签' }).click()
    await page.reload()
    await page.waitForSelector('.work-panel')
    if (await page.getByRole('tab', { name: '文件', exact: true }).count()) throw Error('重启后已关闭的标签重新出现')
    await page.getByRole('button', { name: '新标签页', exact: true }).click()
    await page.locator('.work-home').getByRole('button', { name: '文件', exact: true }).click()
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
    if (!await page.getByText('Pi 可执行文件', { exact: true }).isVisible()) throw Error('运行时设置应默认展开')
    await page.locator('.settings-search input').first().fill('可执行文件')
    if (!await page.getByText('Pi 可执行文件', { exact: true }).isVisible()) throw Error('搜索应显示收起的高级设置')
    await page.locator('.settings-search input').first().fill('')
    await page.locator('.settings-nav-item').filter({ hasText: '网页浏览' }).click()
    if (!await page.getByText('独立浏览器', { exact: true }).isVisible()) throw Error('独立浏览器应默认展开')
    await page.locator('.settings-search input').first().fill('cdp')
    if (!await page.getByText('独立浏览器', { exact: true }).isVisible()) throw Error('搜索 CDP 应找到独立浏览器')
    await page.locator('.settings-search input').first().fill('')
    await page.locator('.settings-nav-item').filter({ hasText: '权限与安全' }).click()
    if (!await page.getByRole('heading', { name: '新对话默认', exact: true }).isVisible()) throw Error('新对话默认设置缺失')
    if (await page.getByRole('switch', { name: '联网', exact: true }).getAttribute('aria-checked') !== 'true') throw Error('联网应默认开启')
    if (await page.getByRole('heading', { name: '网络代理', exact: true }).isVisible()) throw Error('默认不应展示网络代理')
    await page.getByText('连接与诊断', { exact: true }).click()
    if (!await page.getByRole('heading', { name: '网络代理', exact: true }).isVisible()) throw Error('展开后应显示网络代理')
    await page.locator('.settings-nav-item').filter({ hasText: '模型' }).click()
    await page.getByRole('button', { name: '添加服务商 / 模型' }).click()
    if (!await page.getByText('选择模型服务商', { exact: true }).isVisible()) throw Error('添加模型时没有先选择服务商')
    await page.getByRole('button', { name: 'vLLM / SGLang' }).click()
    await page.locator('.provider-form input[type="password"]').fill('do-not-carry-key')
    await page.getByRole('button', { name: '更换服务商' }).click()
    await page.getByRole('button', { name: 'Ollama', exact: true }).click()
    if (await page.locator('.provider-form input[type="password"]').inputValue() !== 'ollama') throw Error('切换服务商时带入了旧密钥')
    await page.getByRole('button', { name: '保存到 models.json' }).click()
    if (await page.evaluate(() => Boolean(window.savedProvider))) throw Error('没有模型 ID 仍保存了配置')
    await page.locator('.provider-form textarea').fill('test-model')
    await page.getByRole('button', { name: '保存到 models.json' }).click()
    await page.waitForFunction(() => window.savedProvider?.id === 'ollama')
    const savedProvider = await page.evaluate(() => window.savedProvider)
    if (savedProvider.entry.models[0].id !== 'test-model' || savedProvider.entry.baseUrl !== 'http://localhost:11434/v1') throw Error('保存的服务商配置不正确')
    await page.locator('.custom-provider').filter({ hasText: 'ollama' }).getByRole('button', { name: '编辑' }).click()
    await page.locator('.provider-form input').filter({ hasNot: page.locator('[type="password"]') }).first().waitFor()
    await page.locator('.provider-form input').nth(2).fill('http://localhost:2222/v1')
    await page.getByRole('button', { name: '保存到 models.json' }).click()
    await page.waitForFunction(() => window.savedProvider?.entry.baseUrl === 'http://localhost:2222/v1')
    if (await page.evaluate(() => window.savedProvider.entry.models[0].id) !== 'test-model') throw Error('编辑服务商丢失原模型')
    await page.getByRole('button', { name: '默认模型', exact: true }).click()
    await page.getByRole('menuitemradio', { name: '自动' }).click()
    await page.waitForFunction(() => window.savedPiSettings && window.savedPiSettings.defaultProvider === undefined && window.savedPiSettings.defaultModel === undefined)
    await page.locator('.settings-nav-item').filter({ hasText: '常规' }).click()
    await page.getByRole('button', { name: '界面语言', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'English' }).click()
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
    await page.locator('.settings-nav-item').filter({ hasText: 'Appearance' }).click()
    await page.locator('.theme-card').filter({ hasText: 'Light' }).click()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    await page.keyboard.press('Escape')
    if (await page.getByRole('button', { name: 'Work panel', exact: true }).count() !== 1) throw Error('英文工作面板入口缺失')
    if (await page.locator('.topbar-right svg.lucide-plus, .topbar-right svg.lucide-sun, .topbar-right svg.lucide-moon, .topbar-right .settings-entry').count()) throw Error('右上角仍有重复入口')
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
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByText('项目结构', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.project-row.active .project-row-main span')?.textContent === 'alpha')
    const longChat = page.locator('.chat-scroll')
    await longChat.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await longChat.hover()
    await page.mouse.wheel(0, -400)
    await page.locator('.jump-button').waitFor({ state: 'visible' })
    await page.locator('.jump-button').click()
    await page.locator('.jump-button').waitFor({ state: 'hidden' })
    await page.waitForTimeout(500)
    const distance = await longChat.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
    if (distance > 2) throw Error(`回到最新后没有到达底部: ${distance}`)
    await page.evaluate(() => sessionStorage.setItem('short-chat-fixture', '1'))
    await page.reload()
    await page.waitForSelector('.turn')
    const chat = page.locator('.chat-scroll')
    const canScroll = await chat.evaluate((el) => el.scrollHeight > el.clientHeight + 1)
    if (canScroll) throw Error('短对话测试前提不成立：内容可以滚动')
    await chat.hover()
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(150)
    if (await page.locator('.jump-button').count()) throw Error('短对话不能滚动时仍出现回到最新')
    await chat.locator('.chat-inner').evaluate((el) => {
      const growth = document.createElement('div')
      growth.style.height = '1600px'
      el.appendChild(growth)
    })
    await page.waitForFunction(() => {
      const el = document.querySelector('.chat-scroll')
      return el.scrollHeight > el.clientHeight && el.scrollHeight - el.scrollTop - el.clientHeight <= 2
    })
    await chat.hover()
    await page.mouse.wheel(0, -400)
    await page.locator('.jump-button').waitFor({ state: 'visible' })
    const readingTop = await chat.evaluate((el) => el.scrollTop)
    await chat.locator('.chat-inner').evaluate((el) => { el.lastElementChild.style.height = '2000px' })
    await page.waitForTimeout(150)
    const afterGrowth = await chat.evaluate((el) => el.scrollTop)
    if (Math.abs(afterGrowth - readingTop) > 2) throw Error('用户阅读历史消息时，新增内容导致位置跳动')
    await page.evaluate(() => { sessionStorage.removeItem('short-chat-fixture'); sessionStorage.setItem('process-fixture', '1') })
    await page.reload()
    await page.waitForSelector('.turn')
    const history = page.locator('.turn').filter({ hasText: '历史错误分组' })
    await history.locator('.turn-summary-main').click()
    const historyGroup = history.locator('.tool-group').first()
    if (await historyGroup.locator('.tool-failed').count() !== 1 || (await historyGroup.locator('.tool-failed').innerText()).trim() !== '1') throw Error('历史分组未显示失败数量')
    await page.evaluate(() => window.emitRecord({ type: 'tool_execution_end', toolCallId: 'history-1', toolName: 'read', isError: true }))
    if ((await historyGroup.locator('.tool-failed').innerText()).trim() !== '1') throw Error('同一错误在分组中重复计数')
    await historyGroup.locator('> .tool-head').click()
    if (await historyGroup.locator('.tool-card.status-error').count() !== 1) throw Error('分组中的失败详情状态不正确')
    await history.getByText('执行异常详情', { exact: true }).waitFor({ state: 'visible' })
    await page.evaluate(() => {
      window.emitRecord({ type: 'agent_start' })
      window.emitRecord({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'live-1', name: 'read', arguments: { path: 'one.txt' } }], timestamp: Date.now() } })
    })
    const liveGroupTurn = page.locator('.turn').filter({ hasText: '实时分组' })
    await liveGroupTurn.locator('.tool-card .tool-head').click()
    await page.evaluate(() => window.emitRecord({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'live-2', name: 'read', arguments: { path: 'two.txt' } }], timestamp: Date.now() } }))
    const group = liveGroupTurn.locator('.tool-group')
    await group.waitFor()
    if (await group.locator('> .tool-head').getAttribute('aria-expanded') !== 'true') throw Error('新增同类工具时丢失展开状态')
    if (await group.locator('.tool-card .tool-head').first().getAttribute('aria-expanded') !== 'true') throw Error('新增同类工具时已展开的详情丢失')
    if (errors.length) throw Error(`页面异常: ${errors.join('; ')}`)
    console.log('无窗口检查通过：项目切换、草稿保护、队列、模型菜单、工作面板、设置、主题和窄窗口；后台任务跨会话存活需另测')
  } finally {
    await browser.close()
    server.close()
  }
}
main().catch((error) => { console.error(error); server.close(); process.exitCode = 1 })
