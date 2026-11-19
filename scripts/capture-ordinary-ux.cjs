// Capture the ordinary-user screens against the built renderer.
// Usage: HEADLESS_CHROME_PATH=... node /tmp/capture-ordinary-ux.mjs docs/screenshots/ordinary-user/after
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const outDir = path.resolve(process.argv[2] || 'docs/screenshots/ordinary-user/after')
const root = path.resolve('out/renderer')
fs.mkdirSync(outDir, { recursive: true })

const server = http.createServer((req, res) => {
  const file = path.join(root, req.url === '/' || req.url.startsWith('/?') ? 'index.html' : req.url.split('?')[0])
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
  res.setHeader('Content-Type', type[path.extname(file)] || 'application/octet-stream')
  fs.createReadStream(file).on('error', () => { res.statusCode = 404; res.end() }).pipe(res)
})

function installMock() {
  const scene = new URLSearchParams(location.search).get('scene') || 'chat'
  const scratch = '/Users/me/Library/Application Support/pi/scratch'
  const tempA = '/private/var/folders/xx/T/网页调研'
  const tempB = '/var/folders/xx/T/网页调研'
  const work = '/Users/me/work/网页调研'
  const notes = '/Users/me/notes/网页调研'
  const settings = {
    theme: 'dark', language: 'zh-CN', workPanelOpen: false,
    workspaces: scene === 'chat' ? [work, notes, tempA, tempB] : [work],
    workspaceNames: {},
    lastWorkspace: scene === 'welcome' || scene === 'model' ? '' : work,
    lastSessionPath: scene === 'welcome' || scene === 'model' ? '' : scene === 'chat' ? '/session/temp' : '/session/work',
    sandboxEnabled: false,
    toolApprovalMode: 'dangerous'
  }
  const toolMessages = [
    { role: 'user', content: '只用内置网页工具。打开 example.com 和 www.iana.org/help/example-domains，分别用命令命名 example 和 iana 并读取。切回 example 再读一遍。用一句话比较两页的用途。', timestamp: Date.now() },
    { role: 'assistant', content: [
      { type: 'toolCall', id: 'bash-env', name: 'bash', arguments: { command: "env | grep -i '^PI_' | sort" } },
      { type: 'toolCall', id: 'read-skill', name: 'read', arguments: { path: '/Users/me/work/网页调研/SKILL.md', offset: 1, limit: 200 } },
      { type: 'toolCall', id: 'bash-open', name: 'bash', arguments: { command: 'curl -s https://example.com' } },
      { type: 'toolCall', id: 'see-1', name: 'computer_use_session_observe', arguments: { url: 'https://example.com' } },
      { type: 'toolCall', id: 'see-2', name: 'computer_use_session_observe', arguments: { url: 'https://www.iana.org/help/example-domains' } }
    ], timestamp: Date.now() },
    { role: 'toolResult', toolCallId: 'bash-env', toolName: 'bash', content: [{ type: 'text', text: 'PI_HOME=/Users/me' }], isError: false, timestamp: Date.now() },
    { role: 'toolResult', toolCallId: 'read-skill', toolName: 'read', content: [{ type: 'text', text: '# skill' }], isError: false, timestamp: Date.now() },
    { role: 'toolResult', toolCallId: 'bash-open', toolName: 'bash', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: Date.now() },
    { role: 'toolResult', toolCallId: 'see-1', toolName: 'computer_use_session_observe', details: { url: 'https://example.com', title: 'Example Domain', backend: 'inapp', documentId: 'doc-example', page: 'example', sessionId: 's' }, content: [{ type: 'text', text: 'example' }], isError: false, timestamp: Date.now() },
    { role: 'toolResult', toolCallId: 'see-2', toolName: 'computer_use_session_observe', details: { url: 'https://www.iana.org/help/example-domains', title: 'Example Domains', backend: 'inapp', documentId: 'doc-iana', page: 'iana', sessionId: 's' }, content: [{ type: 'text', text: 'iana' }], isError: false, timestamp: Date.now() }
  ]
  const sessions = [
    { path: '/session/temp', id: 'temp', cwd: tempA, name: '未命名会话', preview: '', updatedAt: Date.now(), createdAt: Date.now(), messageCount: 0, size: 10 },
    { path: '/session/work', id: 'work', cwd: work, name: '比较两个网页', preview: '', updatedAt: Date.now() - 1000, createdAt: Date.now(), messageCount: 2, size: 10 },
    { path: '/session/notes', id: 'notes', cwd: notes, name: '整理资料', preview: '', updatedAt: Date.now() - 2000, createdAt: Date.now(), messageCount: 1, size: 10 }
  ]
  const skills = [
    ['agent-reach', '只读读取各平台内容'],
    ['anti-ui-slop', 'Stop Codex, GitHub Copilot, Claude Code, and Cursor from shipping generic UI.'],
    ['design-taste-frontend', 'Guidance for landing pages, portfolios, and redesigns.'],
    ['frontend-design', 'Guidance for distinctive, intentional visual design.'],
    ['gamma', '生成横向翻页网页 PPT。'],
    ['guizang-ppt-skill', '生成横向翻页网页 PPT，单 HTML 文件。'],
    ['alpha', '读取飞书多维表格：表、字段、记录与视图。'],
    ['beta', '把长视频字幕整理成摘要与博客。'],
    ['lark-approval', '飞书审批：查询和处理审批待办。'],
    ['lark-attendance', '飞书考勤打卡：查询自己的考勤打卡记录。'],
    ['lark-calendar', '飞书日历：管理日历和会议。'],
    ['lark-contact', '飞书 / Lark 通讯录：按姓名或部门查找联系人。'],
    ['lark-base', '飞书多维表格（Base）操作。'],
    ['lark-apps', '飞书应用：应用开发与托管。']
  ].map(([name, description]) => ({
    name, description, path: `/skills/${name}`, realPath: `/skills/${name}`, source: 'user', symlink: false,
    requires: { bins: [], missing: [] }, version: '1.0.0'
  }))
  let sessionPermission = { permission: 'review', mode: 'dangerous', sandboxed: false, files: 'workspace-write', network: 'model' }
  const api = {
    onPiInstallProgress: () => () => {},
    onBrowserReveal: () => () => {},
    onUpdateAvailable: () => () => {},
    onUpdateProgress: () => () => {},
    onSandboxDomainDenied: () => () => {},
    onOAuthEvent: () => () => {},
    onRecord: (callback) => { window.emitRecord = callback; return () => {} },
    onStatus: () => () => {},
    onStderr: () => () => {},
    onAppEvent: () => () => {},
    onSettings: () => () => {},
    onScheduleEvent: () => () => {},
    onScheduleOpen: () => () => {},
    onSchedulesChanged: () => () => {},
    sandboxStatus: async () => ({ available: true }),
    sessionSecurity: async () => sessionPermission,
    setSessionPermission: async ({ permission }) => {
      sessionPermission = { ...sessionPermission, permission }
      return sessionPermission
    },
    projectTrustStatus: async () => ({ required: false, decision: 'trusted', resources: [] }),
    countSkills: async () => skills.length,
    listSchedules: async () => [],
    getBackgroundScheduler: async () => ({ running: false }),
    previewSchedule: async () => [Date.now() + 86_400_000],
    validateCron: async () => null,
    getSessionNotices: async () => [],
    listSkills: async () => skills,
    listPackages: async () => [],
    listConnectors: async () => [],
    browserPreview: async () => ({
      image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="100%" height="100%" fill="#f7f4ee"/><text x="36" y="70" font-family="sans-serif" font-size="28" fill="#222">example.com</text><text x="36" y="120" font-family="sans-serif" font-size="16" fill="#555">Example Domain</text></svg>'),
      width: 640,
      height: 400
    }),
    bootstrap: async () => ({
      platform: 'darwin', appVersion: '0.7.7', electronVersion: '45',
      piPath: scene === 'welcome' ? '' : '/usr/local/bin/pi',
      piVersion: scene === 'welcome' ? null : '1.5.2',
      autoInstallPi: false,
      home: '/Users/me', sessionsRoot: '/Users/me/.pi/sessions', scratchPath: scratch,
      settings, piSettings: scene === 'model' || scene === 'welcome' ? {} : { defaultProvider: 'openai', defaultModel: 'gpt-4.1' },
      piSettingsFile: '/Users/me/.pi/agent/settings.json', agentDir: '/Users/me/.pi/agent'
    }),
    listSessions: async () => scene === 'welcome' || scene === 'model' ? [] : sessions,
    openSession: async ({ cwd, sessionPath }) => ({ ok: true, cwd, sessionPath: sessionPath ?? '/session/new' }),
    closeSession: async () => {},
    pickFolder: async () => null,
    readModelsConfig: async () => ({ file: '/mock/models.json', providers: {} }),
    listPiModels: async () => ({ models: [] }),
    command: async (command) => ({
      success: true,
      data: ({
        get_state: { thinkingLevel: 'off', model: { id: 'gpt-4.1', name: 'GPT', provider: 'openai' }, isStreaming: scene === 'preview' },
        get_messages: { messages: scene === 'tools' || scene === 'preview' ? toolMessages : scene === 'permission' ? [{ role: 'user', content: '帮我整理今天的会议纪要', timestamp: Date.now() }, { role: 'assistant', content: [{ type: 'text', text: '好的。' }], timestamp: Date.now() }] : [] },
        get_session_stats: {},
        get_available_models: { models: [] },
        get_available_thinking_levels: { levels: [] },
        get_commands: { commands: [] }
      })[command.type] || {}
    }),
    updateSettings: async (patch) => Object.assign(settings, patch),
    gitStatus: async () => ({ files: [] }),
    gitDiff: async () => '',
    readDir: async () => [],
    readText: async () => ({ ok: true, content: '', truncated: false }),
    notify: async () => true,
    installPi: async () => ({ ok: false, error: '请检查网络后再试一次。', output: 'installer log' }),
    recheckPi: async () => ({ piVersion: null }),
    sandboxAudit: async () => []
  }
  window.pi = new Proxy(api, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop === 'symbol') return undefined
      return (..._args) => String(prop).startsWith('on') ? () => {} : Promise.resolve(null)
    }
  })
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) })
  console.log('saved', name)
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.HEADLESS_CHROME_PATH || '/usr/bin/google-chrome'
  })
  const port = server.address().port
  const errors = []
  try {
    const open = async (scene) => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
      page.on('pageerror', (error) => errors.push(`${scene}: ${error.message}`))
      await page.addInitScript(installMock)
      await page.goto(`http://127.0.0.1:${port}/?scene=${scene}`)
      await page.waitForSelector('.sidebar, .welcome', { timeout: 8000 })
      await page.waitForTimeout(400)
      return page
    }

    const welcome = await open('welcome')
    await welcome.getByText('第一次使用，先完成准备工作').waitFor()
    await shot(welcome, '01-welcome-setup')
    await welcome.close()

    const model = await open('model')
    await model.getByText('还差一步：连接 AI 模型').waitFor()
    await shot(model, '02-welcome-model')
    await model.getByRole('button', { name: '连接模型' }).click()
    await model.getByText('用账号登录，或粘贴服务商给你的 API Key。密钥只保存在这台电脑上。').waitFor()
    await shot(model, '03-model-settings')
    await model.close()

    const chat = await open('chat')
    await chat.getByText('临时对话', { exact: true }).waitFor()
    await chat.getByText('想让 Pi 帮你做什么？').waitFor()
    const body = await chat.locator('body').innerText()
    if (body.includes('/private/var/folders') || body.includes('/var/folders')) throw new Error('临时路径仍显示在界面上')
    const labels = await chat.locator('.project-row-main span').allTextContents()
    if (labels.filter((label) => label.includes('网页调研')).length !== 2) throw new Error(`同名项目没有按预期区分: ${labels.join(' | ')}`)
    if (!labels.some((label) => label.includes(' · '))) throw new Error(`同名项目没有带上所在文件夹: ${labels.join(' | ')}`)
    await shot(chat, '04-new-chat')
    await chat.close()

    const tools = await open('tools')
    await tools.getByText('查看步骤', { exact: true }).click()
    await tools.getByText('查看环境信息', { exact: true }).waitFor()
    await tools.getByText('SKILL.md', { exact: true }).waitFor()
    await tools.getByText('example.com', { exact: true }).first().waitFor()
    if (await tools.getByText(/from 1, 200 lines/).count()) throw new Error('折叠行仍显示原始行号范围')
    if (await tools.getByText(/env \| grep/).count()) throw new Error('折叠行仍显示原始命令')
    await tools.locator('.tool-head').first().click()
    await tools.getByText(/env \| grep/).waitFor()
    await shot(tools, '05-tool-rows')
    await tools.close()

    const preview = await open('preview')
    await preview.getByText('只用内置网页工具', { exact: false }).first().waitFor()
    await preview.evaluate(() => {
      const emit = window.emitRecord
      const pages = [
        { id: 'p1', url: 'https://example.com', title: 'Example Domain', documentId: 'doc-example', page: 'example' },
        { id: 'p2', url: 'https://www.iana.org/help/example-domains', title: 'Example Domains', documentId: 'doc-iana', page: 'iana' }
      ]
      for (const item of pages) {
        emit({ type: 'tool_execution_start', toolCallId: item.id, toolName: 'computer_use_session_observe', args: { url: item.url } })
        emit({
          type: 'tool_execution_end', toolCallId: item.id, toolName: 'computer_use_session_observe', isError: false,
          result: { details: { url: item.url, title: item.title, backend: 'inapp', documentId: item.documentId, page: item.page, sessionId: 's' }, content: [{ type: 'text', text: item.title }] }
        })
      }
    })
    await preview.waitForSelector('.cu-preview[data-open="true"]')
    await preview.locator('.chat-scroll').evaluate((el) => { el.scrollTop = 0 })
    await preview.waitForTimeout(300)
    const overlap = await preview.evaluate(() => {
      const message = document.querySelector('.user-message')?.getBoundingClientRect()
      const card = document.querySelector('.cu-preview')?.getBoundingClientRect()
      if (!message || !card) return { missing: true }
      const x = Math.max(0, Math.min(message.right, card.right) - Math.max(message.left, card.left))
      const y = Math.max(0, Math.min(message.bottom, card.bottom) - Math.max(message.top, card.top))
      return { overlap: x > 1 && y > 1, message, card }
    })
    if (overlap.missing || overlap.overlap) throw new Error(`网页预览仍挡住消息: ${JSON.stringify(overlap)}`)
    await shot(preview, '06-preview')
    await preview.close()

    const permission = await open('permission')
    await permission.getByRole('button', { name: '这一次对话' }).click()
    await permission.getByText('之后的新对话', { exact: true }).waitFor()
    await permission.getByText('保护未开启', { exact: true }).waitFor()
    await shot(permission, '07-permission')
    await permission.close()

    const network = await open('chat')
    await network.locator('.sidebar-footer .settings-entry').click()
    await network.locator('.settings-nav-item').filter({ hasText: '网络与沙箱' }).click()
    await network.getByText('现在没有额外限制。打开保护后，才能限制能改哪些文件、能访问哪些网站。').waitFor()
    await shot(network, '08-network-off')
    await network.close()

    const skills = await open('chat')
    await skills.getByRole('button', { name: '技能与工具' }).click()
    await skills.getByText('处理飞书审批').waitFor()
    await skills.getByText('查找资料').waitFor()
    if (await skills.getByText('lark-approval', { exact: true }).count()) throw new Error('技能卡片仍显示原始 ID')
    await shot(skills, '09-skills')
    await skills.close()

    const schedule = await open('chat')
    await schedule.getByRole('button', { name: '定时任务' }).click()
    await schedule.getByRole('button', { name: '新建任务' }).first().click()
    await schedule.getByText('要做的事情', { exact: true }).first().waitFor()
    await schedule.getByText('更多选项').click()
    await schedule.getByText('使用 cron 表达式').waitFor()
    await shot(schedule, '10-schedule')
    await schedule.close()
  } finally {
    await browser.close()
    server.close()
  }
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('shots written to', outDir)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
