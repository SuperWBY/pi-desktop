import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('output', { recursive: true })

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, PI_DESKTOP_PI_PATH: process.env.PI_DESKTOP_PI_PATH ?? '' }
})

const page = await app.firstWindow()
const logs = []
page.on('console', (message) => logs.push(`[${message.type()}] ${message.text()}`))
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`))

await page.waitForTimeout(4500)
await page.screenshot({ path: 'output/welcome.png' })
console.log('title:', await page.title())
console.log('body text:', (await page.locator('body').innerText()).slice(0, 600))
console.log('logs:', logs.slice(0, 40).join('\n'))

await app.close()
