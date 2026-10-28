import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'

const packaged = process.argv.includes('--packaged')

mkdirSync('output', { recursive: true })

const app = packaged
  ? await electron.launch({
      executablePath: 'release/Pi Desktop-darwin-arm64/Pi Desktop.app/Contents/MacOS/Pi Desktop'
    })
  : await electron.launch({ args: ['.'] })

const page = await app.firstWindow()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

await page.waitForSelector('.composer-input, .welcome', { timeout: 40_000 })
await page.waitForTimeout(2500)
await page.screenshot({ path: packaged ? 'output/smoke-packaged.png' : 'output/smoke.png' })

console.log('title:', await page.title())
console.log('status:', await page.locator('.footer-meta').innerText())
console.log('errors:', errors.length ? errors.join('\n') : 'none')

await app.close()
