// Isolated regression checks: never touch the user's pi configuration.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('vite')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-config-test-'))
async function main() {
try {
  process.env.PI_CODING_AGENT_DIR = path.join(temp, 'agent')
  fs.mkdirSync(process.env.PI_CODING_AGENT_DIR)
  const entry = path.join(temp, 'entry.ts')
  fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(__dirname, '..', 'src/main/models.ts'))}; export * from ${JSON.stringify(path.join(__dirname, '..', 'src/main/pi-settings.ts'))};`)
  await build({ configFile: false, logLevel: 'silent', build: { ssr: entry, outDir: temp, emptyOutDir: false, rollupOptions: { output: { format: 'cjs', entryFileNames: 'bundle.cjs' } } } })
  const models = require(path.join(temp, 'bundle.cjs'))
  const settings = models
  const file = path.join(process.env.PI_CODING_AGENT_DIR, 'models.json')
  fs.writeFileSync(file, '{broken')
  assert.throws(() => models.saveProvider('test', { models: [{ id: 'model' }] }), /未保存/)
  assert.throws(() => models.removeProvider('test'), /未删除/)
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
  fs.writeFileSync(file, '{"providers": []}')
  assert.throws(() => models.saveProvider('test', { models: [{ id: 'model' }] }), /providers/)
  assert.equal(fs.readFileSync(file, 'utf8'), '{"providers": []}')
  fs.writeFileSync(file, JSON.stringify({ providers: { test: { headers: { 'x-custom': 'value' }, models: [{ id: 'model', cost: { input: 2 }, reasoning: true }] } } }))
  models.saveProvider('test', { baseUrl: 'https://example.test/v1', models: [{ id: 'model', reasoning: true }] })
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(saved.providers.test.headers, { 'x-custom': 'value' })
  assert.deepEqual(saved.providers.test.models[0].cost, { input: 2 })
  settings.savePiSettings({ defaultProvider: 'test', defaultModel: 'model', steeringMode: 'all' })
  settings.savePiSettings({ defaultProvider: undefined, defaultModel: undefined })
  const piSettings = JSON.parse(fs.readFileSync(path.join(process.env.PI_CODING_AGENT_DIR, 'settings.json'), 'utf8'))
  assert.equal('defaultProvider' in piSettings, false)
  assert.equal('defaultModel' in piSettings, false)
  assert.equal(piSettings.steeringMode, 'all')
  console.log('隔离配置测试通过：错误保护、未知字段保留、默认模型清除')
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
