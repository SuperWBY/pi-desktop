import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('/agent/repos/pi-desktop')
const out = '/opt/cursor/artifacts'
mkdirSync(out, { recursive: true })
const packRoot = join(root, 'release', 'Pi Desktop-linux-x64')
const appPath = join(packRoot, 'Pi Desktop')
if (!existsSync(appPath)) throw new Error(`Packaged app missing: ${appPath}`)

function dirs(name) {
  const base = join(root, 'output', 'shots', 'models-pack', name)
  rmSync(base, { recursive: true, force: true })
  const d = { base, userData: join(base, 'userData'), agent: join(base, 'agent'), sessions: join(base, 'sessions') }
  for (const dir of Object.values(d)) mkdirSync(dir, { recursive: true })
  return d
}

async function launchPack(theme) {
  const d = dirs(theme)
  writeFileSync(join(d.userData, 'settings.json'), JSON.stringify({
    theme,
    language: 'zh-CN',
    autoCheckUpdates: false
  }))
  const app = await electron.launch({
    executablePath: appPath,
    args: [`--user-data-dir=${d.userData}`],
    cwd: packRoot,
    env: {
      ...process.env,
      HOME: d.base,
      PI_CODING_AGENT_DIR: d.agent,
      PI_CODING_AGENT_SESSION_DIR: d.sessions,
      PI_DESKTOP_SKIP_AUTO_INSTALL: '1',
      PI_DESKTOP_MOCK_AUTH: '1'
    }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.welcome, .composer-input', { timeout: 60000 })
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(1280, 900)
    win.center()
  })
  await page.waitForTimeout(600)
  return { app, page }
}

async function openModels(page) {
  await page.locator('.settings-entry, button[aria-label="设置"]').first().click()
  await page.locator('.settings-page').waitFor({ timeout: 15000 })
  const modelsNav = page.locator('.settings-nav-item, .settings-nav button, button').filter({ hasText: /^模型$/ })
  if (await modelsNav.count()) await modelsNav.first().click()
  await page.getByRole('heading', { name: '可用模型' }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
}

for (const theme of ['dark', 'light']) {
  const { app, page } = await launchPack(theme)
  await openModels(page)
  // Expand list if collapsed
  const summary = page.locator('summary').filter({ hasText: '查看可用模型列表' })
  if (await summary.count()) {
    const details = summary.locator('xpath=ancestor::details[1]')
    if (await details.getAttribute('open') === null) await summary.click()
  }
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `settings-models-packaged-${theme}.png`) })
  await page.locator('.settings-content, .settings-main, .settings-page .settings-body').first()
    .screenshot({ path: join(out, `settings-models-packaged-${theme}-crop.png`) })
    .catch(async () => {
      await page.locator('.settings-page').screenshot({ path: join(out, `settings-models-packaged-${theme}-crop.png`) })
    })
  console.log('shot', theme)
  await app.close()
}
