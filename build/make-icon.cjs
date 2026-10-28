const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const svg = readFileSync(join(__dirname, 'icon.svg'), 'utf8')
const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => setTimeout(resolve, 800))
  const image = await win.webContents.capturePage()
  writeFileSync(join(__dirname, 'icon.png'), image.toPNG())
  app.quit()
})
