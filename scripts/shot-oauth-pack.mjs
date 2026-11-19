import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync, rmSync, existsSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('/agent/repos/pi-desktop')
const out = '/opt/cursor/artifacts'
mkdirSync(out, { recursive: true })
const packRoot = join(root, 'release', 'Pi Desktop-linux-x64')
const appPath = join(packRoot, 'Pi Desktop')
if (!existsSync(appPath)) throw new Error(`Packaged app missing: ${appPath}`)

function dirs(name) {
  const base = join(root, 'output', 'shots', 'oauth-pack', name)
  rmSync(base, { recursive: true, force: true })
  const d = { base, userData: join(base, 'userData'), agent: join(base, 'agent'), sessions: join(base, 'sessions') }
  for (const dir of Object.values(d)) mkdirSync(dir, { recursive: true })
  return d
}

async function shot(page, name) {
  await page.screenshot({ path: join(out, name) })
  console.log('shot', name)
}

async function launchPack(d, extraEnv = {}) {
  writeFileSync(join(d.userData, 'settings.json'), JSON.stringify({
    theme: d.theme,
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
      PI_DESKTOP_MOCK_AUTH: '1',
      ...extraEnv
    }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.welcome, .composer-input', { timeout: 60000 })
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(1280, 860)
    win.center()
  })
  await page.waitForTimeout(700)
  return { app, page }
}

async function openSettingsModels(page) {
  await page.locator('.settings-entry, button[aria-label="设置"]').first().click()
  await page.locator('.settings-page').waitFor({ timeout: 15000 })
  const modelsNav = page.locator('.settings-nav button, .settings-section-button, button').filter({ hasText: /^模型$/ })
  if (await modelsNav.count()) await modelsNav.first().click()
  await page.waitForTimeout(300)
}

const theme = process.argv[2] || 'dark'

{
  const d = dirs(theme)
  d.theme = theme
  const { app, page } = await launchPack(d)
  await page.getByRole('button', { name: '连接模型', exact: true }).click()
  await page.locator('.connect-model').waitFor()
  await page.getByRole('tab', { name: '用账号登录' }).click()
  await page.locator('.connect-provider').first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(300)
  await shot(page, `oauth-connect-account-${theme}.png`)
  await page.locator('.connect-model').screenshot({ path: join(out, `oauth-connect-account-${theme}-crop.png`) })
  await page.locator('.connect-close').click()

  await openSettingsModels(page)
  const oauthEntry = page.getByRole('button', { name: /用账号登录/ }).first()
  await oauthEntry.waitFor({ timeout: 10000 })
  await oauthEntry.click()
  await page.locator('.provider-oauth-dialog').waitFor({ timeout: 10000 })
  await page.locator('.provider-oauth-providers .connect-provider, .provider-oauth-unavailable').first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(350)
  await shot(page, `oauth-dialog-packaged-${theme}.png`)
  const dialog = page.locator('.modal-card, .modal, [role="dialog"]').filter({ has: page.locator('.provider-oauth-dialog') }).first()
  if (await dialog.count()) await dialog.screenshot({ path: join(out, `oauth-dialog-packaged-${theme}-crop.png`) })
  else await page.locator('.provider-oauth-dialog').screenshot({ path: join(out, `oauth-dialog-packaged-${theme}-crop.png`) })
  await app.close()
}

{
  // Hide only the auth entrypoint so welcome still resolves the seed launcher.
  const authIndex = join(packRoot, 'resources', 'pi-seed', '0.7.7-pack', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js')
  const authIndexHidden = `${authIndex}.hidden`
  if (existsSync(authIndex)) renameSync(authIndex, authIndexHidden)
  try {
    const d = dirs(theme + '-unavailable')
    d.theme = theme
    const { app, page } = await launchPack(d)
    await page.waitForTimeout(1000)
    const connect = page.getByRole('button', { name: '连接模型', exact: true })
    if (!(await connect.count())) {
      console.log('welcome text', (await page.locator('body').innerText()).slice(0, 500))
      await shot(page, `oauth-unavailable-welcome-${theme}.png`)
    } else {
      await connect.click()
      await page.locator('.connect-model').waitFor()
      await page.getByRole('tab', { name: '用账号登录' }).click()
      await page.getByText('当前版本暂不支持账号登录，请用 API Key').waitFor({ timeout: 10000 })
      await page.waitForTimeout(250)
      await shot(page, `oauth-unavailable-packaged-${theme}.png`)
      await page.locator('.connect-model').screenshot({ path: join(out, `oauth-unavailable-packaged-${theme}-crop.png`) })
      await page.locator('.connect-close').click()
    }

    await openSettingsModels(page)
    await page.getByRole('button', { name: /用账号登录/ }).first().click()
    await page.getByText('当前版本暂不支持账号登录，请用 API Key').waitFor({ timeout: 10000 })
    await page.waitForTimeout(250)
    await shot(page, `oauth-dialog-unavailable-packaged-${theme}.png`)
    const dialog = page.locator('.modal-card, .modal, [role="dialog"]').filter({ has: page.locator('.provider-oauth-dialog') }).first()
    if (await dialog.count()) await dialog.screenshot({ path: join(out, `oauth-dialog-unavailable-packaged-${theme}-crop.png`) })
    else await page.locator('.provider-oauth-dialog').screenshot({ path: join(out, `oauth-dialog-unavailable-packaged-${theme}-crop.png`) })
    await app.close()
  } finally {
    if (existsSync(authIndexHidden)) renameSync(authIndexHidden, authIndex)
  }
}

console.log('done')
