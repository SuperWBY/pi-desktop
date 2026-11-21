import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackageTranslator } from '../src/main/package-translation.ts'
const root = await mkdtemp(join(tmpdir(), 'pi-market-translation-'))
try {
 let calls = 0; const inputs = []
 const run = async (texts, language) => { calls++; inputs.push(...texts); return texts.map((text) => language === 'en' ? `English ${text}` : `中文 ${text}`) }
 const translate = createPackageTranslator(root, run)
 const markdown = '# Features\n\nConnect `pi-demo` to servers.\n\n```json\n{"说明":"保持中文","command":"pi install npm:demo"}\n```\n\n[Read docs](https://example.com/docs)\n\n![logo](https://example.com/logo.png)'
 const result = await translate({ language: 'zh-CN', markdown: true, texts: [markdown] })
 assert.ok(result.ok)
 assert.ok(result.texts[0].includes('中文 Features'))
 assert.ok(result.texts[0].includes('`pi-demo`'))
 assert.ok(result.texts[0].includes('{"说明":"保持中文","command":"pi install npm:demo"}'))
 assert.ok(result.texts[0].includes('(https://example.com/docs)'))
 assert.ok(!inputs.some((text) => text.includes('pi install') || text.includes('保持中文')))
 const table = '| Feature | Status |\n| --- | --- |\n| ~~Old~~ | **Ready** |\n\nSee https://example.com/docs and team@example.com.'
 const tabular = await translate({ language: 'zh-CN', markdown: true, texts: [table] })
 assert.ok(tabular.ok)
 assert.ok(tabular.texts[0].includes('| --- | --- |'))
 assert.ok(tabular.texts[0].includes('~~中文 Old~~'))
 assert.ok(tabular.texts[0].includes('https://example.com/docs'))
 assert.ok(tabular.texts[0].includes('team@example.com'))
 assert.ok(!inputs.some((text) => text.includes('| ---') || text.includes('https://example.com/docs') || text.includes('team@example.com')))
 const before = calls
 await translate({ language: 'zh-CN', markdown: true, texts: [markdown] })
 assert.equal(calls, before)
 const second = createPackageTranslator(root, async () => { throw Error('cached content must not call the model') })
 assert.deepEqual(await second({ language: 'zh-CN', markdown: true, texts: [markdown] }), result)
 const duplicateBefore = inputs.length
 const duplicates = await translate({ language: 'zh-CN', texts: ['Duplicate prose', 'Duplicate prose'] })
 assert.equal(duplicates.texts[0], duplicates.texts[1])
 assert.equal(inputs.length - duplicateBefore, 1)
 const en = await translate({ language: 'en', texts: ['中文介绍'] })
 assert.match(en.texts[0], /English/)
 const failed = createPackageTranslator(root, async () => { throw Error('offline') })
 assert.equal((await failed({ language: 'zh-CN', texts: ['Uncached text'] })).ok, false)
 assert.equal((await translate({ language: 'en', texts: [42] })).ok, false)
 // A user-requested README may start while a background description is slow.
 let releaseBackground
 const starts = [], progress = []
 const concurrent = createPackageTranslator(join(root, 'concurrency'), async (texts) => {
  starts.push(texts[0])
  if (texts[0] === 'Background pending') await new Promise(resolve => { releaseBackground = resolve })
  if (texts[0] === 'Paragraph 0') await new Promise(resolve => setTimeout(resolve, 30))
  return texts.map(text => `译 ${text}`)
 })
 const background = concurrent({ language:'zh-CN', texts:['Background pending'] })
 await new Promise(resolve => setTimeout(resolve, 10))
 const source = Array.from({length:30}, (_, index) => `Paragraph ${index}\n\n\`code ${index}\``).join('\n\n')
 const partial = concurrent({ language:'zh-CN', markdown:true, texts:[source] }, value => progress.push(value))
 await new Promise(resolve => setTimeout(resolve, 20))
 assert.ok(starts.some(text => text.startsWith('Paragraph')), 'README was blocked by background translation')
 const output = await partial
 assert.ok(output.ok)
 assert.ok(progress.length >= 2 && progress[0].completed < progress[0].total, 'Missing incremental progress')
 assert.ok(progress.some(value => value.text.includes('译 Paragraph') && value.text.includes('\`code 0\`')))
 assert.ok(output.texts[0].includes('译 Paragraph 29') && output.texts[0].includes('\`code 29\`'))
 releaseBackground()
 assert.ok((await background).ok)
 const snapshots = []
 const failedPartial = createPackageTranslator(join(root, 'partial-failure'), async texts => {
  if (texts[0] === 'Paragraph 8') throw Error('provider failed')
  return texts.map(text => `译 ${text}`)
 })
 assert.equal((await failedPartial({language:'zh-CN',markdown:true,texts:[source]}, value => snapshots.push(value))).ok, false)
 const recover = createPackageTranslator(join(root, 'partial-failure'), async texts => texts.map(text => `恢复 ${text}`))
 const recovered = await recover({language:'zh-CN',markdown:true,texts:[source]})
 assert.ok(recovered.ok && recovered.texts[0].includes('恢复 Paragraph 12'), 'Partial failure must not poison cache')
 console.log('✓ Translates prose, preserves code/URLs, reuses persistent cache, separates languages, and reports failures')
} finally { await rm(root, { recursive: true, force: true }) }
