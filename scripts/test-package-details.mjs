import assert from 'node:assert/strict'
import { createPackageDetailsLoader } from '../src/main/package-details.ts'

let checks = 0
const test = async (name, run) => { await run(); checks++; console.log(`✓ ${name}`) }
const sha = 'a'.repeat(40)
const pkg = (name = 'test-plugin') => ({
  name, 'dist-tags': { latest: '2.0.0', beta: '3.0.0-beta.1' },
  readme: 'Package-level documentation may be newer than latest.', readmeFilename: 'README.md',
  time: { '1.0.0': '2026-10-01T00:00:00Z', '2.0.0': '2026-11-01T00:00:00Z', '3.0.0-beta.1': '2026-11-19T00:00:00Z' },
  versions: Object.fromEntries(['1.0.0', '2.0.0', '3.0.0-beta.1'].map((version) => [version, {
    name, version, description: 'Plugin description', author: { name: 'Author' }, _npmUser: { name: 'Publisher' }, license: 'MIT',
    repository: { url: 'git+https://github.com/example/test-plugin.git' }, gitHead: sha,
    homepage: 'https://example.com', dependencies: { useful: '^1.0.0' }, peerDependencies: { pi: '*' }, engines: { node: '>=22' },
    dist: { unpackedSize: 1024 }, pi: { extensions: ['./src/index.ts'], skills: ['./skills'], image: 'https://example.com/preview.png' }
  }]))
})
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const githubReadme = (markdown = '# GitHub README', branch = sha, path = 'README.md') => json({
  encoding: 'base64', content: Buffer.from(markdown).toString('base64'),
  html_url: `https://github.com/example/test-plugin/blob/${branch}/${path}`,
  download_url: `https://raw.githubusercontent.com/example/test-plugin/${branch}/${path}`
})
function harness(pack = pkg(), content = () => new Response('# Published README')) {
  const calls = []
  const fetcher = async (url, options) => {
    calls.push({ url, options })
    if (url.startsWith('https://registry.npmjs.org/')) return json(pack)
    return content(url, options)
  }
  return { calls, load: createPackageDetailsLoader(fetcher) }
}

await test('Get release metadata and a README pinned to the selected npm version', async () => {
  const { load, calls } = harness()
  const result = await load({ name: 'npm:test-plugin' })
  assert.ok(result.ok)
  const d = result.details
  assert.equal(d.version, '2.0.0')
  assert.equal(d.latestVersion, '2.0.0')
  assert.equal(d.installSource, 'npm:test-plugin@2.0.0')
  assert.equal(d.repositoryUrl, 'https://github.com/example/test-plugin')
  assert.equal(d.author, 'Author')
  assert.equal(d.publisher, 'Publisher')
  assert.equal(d.readme.source, 'npm-cdn')
  assert.equal(d.readme.versionMatched, true)
  assert.equal(d.readme.markdown, '# Published README')
  assert.equal(d.readme.baseUrl, 'https://cdn.jsdelivr.net/npm/test-plugin@2.0.0/')
  assert.deepEqual(d.manifest.skills, ['./skills'])
  assert.deepEqual(d.versions, ['3.0.0-beta.1', '2.0.0', '1.0.0'])
  assert.ok(calls.every(({ options }) => options.redirect === 'error' && options.signal))
})
await test('Historical versions do not reuse current package-level README', async () => {
  const { load, calls } = harness()
  const result = await load({ name: 'test-plugin', version: '1.0.0' })
  assert.equal(result.details.readme.markdown, '# Published README')
  assert.ok(calls.some(({ url }) => url.includes('test-plugin@1.0.0/README.md')))
  assert.equal(result.details.installSource, 'npm:test-plugin@1.0.0')
})
await test('Scoped package names and dist-tags resolve correctly', async () => {
  const { load, calls } = harness(pkg('@scope/test-plugin'))
  const result = await load({ name: '@scope/test-plugin', version: 'beta' })
  assert.ok(result.ok)
  assert.equal(result.details.version, '3.0.0-beta.1')
  assert.equal(calls[0].url, 'https://registry.npmjs.org/%40scope%2Ftest-plugin')
  assert.ok(result.details.readme.url.includes('@scope/test-plugin@3.0.0-beta.1/'))
})
await test('Unsafe names and ranges are rejected before any network request', async () => {
  const { load, calls } = harness()
  for (const input of [null, {}, { name: 1 }, { name: '../test' }, { name: 'https://example.com' }, { name: '@scope/../test' }, { name: 'test-plugin', version: '^2.0.0' }, { name: 'test-plugin', version: 2 }]) {
    assert.equal((await load(input)).ok, false)
  }
  assert.equal(calls.length, 0)
})
await test('Absent packages, absent versions and wrong package identities are explicit errors', async () => {
  assert.equal((await createPackageDetailsLoader(async () => new Response('', { status: 404 }))({ name: 'test-plugin' })).ok, false)
  assert.equal((await harness().load({ name: 'test-plugin', version: '9.0.0' })).ok, false)
  assert.equal((await harness(pkg('another-package')).load({ name: 'test-plugin' })).ok, false)
})
await test('GitHub fallback uses npm gitHead and the monorepo package directory', async () => {
  const pack = pkg()
  pack.versions['1.0.0'].repository.directory = 'packages/my plugin'
  const { load, calls } = harness(pack, (url) => url.startsWith('https://api.github.com/')
    ? githubReadme('# Old release README', sha, 'packages/my%20plugin/README.md') : new Response('', { status: 404 }))
  const result = await load({ name: 'test-plugin', version: '1.0.0' })
  assert.equal(result.details.readme.source, 'github')
  assert.equal(result.details.readme.versionMatched, true)
  assert.ok(calls.some(({ url }) => url === `https://api.github.com/repos/example/test-plugin/contents/packages/my%20plugin/README.md?ref=${sha}`))
  assert.equal(result.details.readme.baseUrl, `https://raw.githubusercontent.com/example/test-plugin/${sha}/packages/my%20plugin/`)
})
await test('Default-branch documentation is marked as unmatched to the release', async () => {
  const pack = pkg()
  delete pack.versions['2.0.0'].gitHead
  const { load } = harness(pack, (url) => url.startsWith('https://api.github.com/') ? githubReadme('# Main docs', 'main') : new Response('', { status: 404 }))
  const result = await load({ name: 'test-plugin' })
  assert.equal(result.details.readme.versionMatched, false)
  assert.match(result.details.warnings.join(' '), /GitHub 默认分支/)
})
await test('npm package-level README is a labelled fallback, not a version guarantee', async () => {
  const { load } = harness(pkg(), () => new Response('', { status: 404 }))
  const result = await load({ name: 'test-plugin' })
  assert.equal(result.details.readme.source, 'npm')
  assert.equal(result.details.readme.versionMatched, false)
  assert.match(result.details.warnings.join(' '), /npm 包级说明/)
})
await test('Missing historical documentation does not hide usable package metadata', async () => {
  const { load } = harness(pkg(), () => new Response('', { status: 404 }))
  const result = await load({ name: 'test-plugin', version: '1.0.0' })
  assert.ok(result.ok)
  assert.equal(result.details.readme, null)
  assert.match(result.details.warnings.join(' '), /无法读取所选版本/)
})
await test('Offline CDN and GitHub rate limits degrade to metadata and labelled README', async () => {
  const { load } = harness(pkg(), (url) => {
    if (url.startsWith('https://cdn.jsdelivr.net/')) throw Error('offline')
    return new Response('', { status: 403 })
  })
  const result = await load({ name: 'test-plugin' })
  assert.ok(result.ok)
  assert.equal(result.details.readme.versionMatched, false)
})
await test('Metadata size bounds and malformed JSON fail predictably', async () => {
  const large = createPackageDetailsLoader(async () => new Response('x', { headers: { 'Content-Length': String(9 * 1024 * 1024) } }))
  assert.match((await large({ name: 'test-plugin' })).error, /超过读取上限/)
  const invalid = createPackageDetailsLoader(async () => new Response('{'))
  assert.equal((await invalid({ name: 'test-plugin' })).ok, false)
})
await test('Unsafe resource URLs are filtered while valid metadata survives', async () => {
  const pack = pkg()
  pack.versions['2.0.0'].homepage = 'javascript:alert(1)'
  pack.versions['2.0.0'].pi.image = 'file:///private/preview.png'
  pack.versions['2.0.0'].pi.video = 'https://user:secret@example.com/a'
  const result = await harness(pack).load({ name: 'test-plugin' })
  assert.equal(result.details.homepage, null)
  assert.equal(result.details.manifest.image, null)
  assert.equal(result.details.manifest.video, null)
})
await test('Concurrent requests coalesce, cached values are isolated, and cache expires', async () => {
  let clock = 0
  let calls = 0
  const loader = createPackageDetailsLoader(async (url) => {
    calls++
    await new Promise((resolve) => setTimeout(resolve, 5))
    return url.startsWith('https://registry.npmjs.org/') ? json(pkg()) : new Response('# README')
  }, () => clock)
  const [a, b] = await Promise.all([loader({ name: 'test-plugin' }), loader({ name: 'test-plugin' })])
  assert.equal(calls, 2)
  a.details.description = 'mutated'
  assert.equal(b.details.description, 'Plugin description')
  assert.equal((await loader({ name: 'test-plugin' })).details.description, 'Plugin description')
  assert.equal(calls, 2)
  clock = 5 * 60_000 + 1
  await loader({ name: 'test-plugin' })
  assert.equal(calls, 4)
})
await test('Catalog metadata skips README requests and cannot poison full details cache', async () => {
  const { load, calls } = harness()
  const summary = await load({ name: 'test-plugin', metadataOnly: true })
  assert.equal(summary.details.readme, null)
  assert.deepEqual(summary.details.manifest.extensions, ['./src/index.ts'])
  assert.equal(calls.length, 1)
  assert.ok(calls.every(({ url }) => url.startsWith('https://registry.npmjs.org/')))
  const full = await load({ name: 'test-plugin' })
  assert.equal(full.details.readme.markdown, '# Published README')
})
await test('Fast metadata and README share a single small release request', async () => {
  const calls = []
  const manifest = pkg().versions['2.0.0']
  const load = createPackageDetailsLoader(async (url) => {
    calls.push(url)
    if (url === 'https://registry.npmjs.org/test-plugin/2.0.0') return json(manifest)
    if (url.startsWith('https://registry.npmjs.org/')) throw Error('complete history must not be requested')
    return new Response('# Version README')
  })
  const summary = await load({ name: 'test-plugin', version: '2.0.0', metadataOnly: true })
  assert.ok(summary.ok)
  assert.equal(summary.details.publishedAt, null)
  const full = await load({ name: 'test-plugin', version: '2.0.0', fast: true })
  assert.ok(full.ok)
  assert.equal(full.details.readme.markdown, '# Version README')
  assert.equal(calls.filter((url) => url.startsWith('https://registry.npmjs.org/')).length, 1)
})
await test('Failed fast documentation still returns installable release metadata', async () => {
  const load = createPackageDetailsLoader(async (url) => url.startsWith('https://registry.npmjs.org/') ? json(pkg().versions['2.0.0']) : Promise.reject(new DOMException('timed out', 'TimeoutError')))
  const result = await load({ name: 'test-plugin', version: '2.0.0', fast: true })
  assert.ok(result.ok)
  assert.equal(result.details.installSource, 'npm:test-plugin@2.0.0')
  assert.equal(result.details.readme, null)
})
await test('Oversized npm history falls back to the selected release without increasing read limits', async () => {
  for (const advertised of [true, false]) {
    const calls = []
    let cancelled = false
    const load = createPackageDetailsLoader(async (url) => {
      calls.push(url)
      if (url === 'https://registry.npmjs.org/test-plugin') return advertised
        ? new Response('', { headers: { 'Content-Length': String(42 * 1024 * 1024) } })
        : new Response(new ReadableStream({
          start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)) },
          cancel() { cancelled = true }
        }))
      if (url === 'https://registry.npmjs.org/test-plugin/1.0.0') return json(pkg().versions['1.0.0'])
      if (url.startsWith('https://registry.npmjs.org/')) throw Error('Unexpected metadata request')
      return new Response('# Selected release README')
    })
    const result = await load({ name: 'test-plugin', version: '1.0.0' })
    assert.ok(result.ok, result.error)
    assert.equal(result.details.version, '1.0.0')
    assert.equal(result.details.installSource, 'npm:test-plugin@1.0.0')
    assert.equal(result.details.readme.markdown, '# Selected release README')
    assert.equal(calls.filter((url) => url.startsWith('https://registry.npmjs.org/')).length, 2)
    if (!advertised) assert.ok(cancelled)
  }
})
await test('Published README carries a commit-pinned repository image fallback, including monorepo and nested docs', async () => {
  const pack = pkg()
  pack.versions['2.0.0'].repository.directory = 'packages/my plugin'
  pack.versions['2.0.0'].readmeFilename = 'docs/README.md'
  const result = await harness(pack).load({ name: 'test-plugin', fast: true })
  assert.ok(result.ok)
  assert.equal(result.details.readme.imageFallbackBaseUrl, `https://raw.githubusercontent.com/example/test-plugin/${sha}/packages/my%20plugin/docs/`)
  delete pack.versions['2.0.0'].gitHead
  const unpinned = await harness(pack).load({ name: 'test-plugin', fast: true })
  assert.equal(unpinned.details.readme.imageFallbackBaseUrl, undefined)
})
await test('Author locale selection uses independent caches and reuses the original README', async () => {
  const {load,calls}=harness(pkg(),url=>url.includes('/flat')?json({files:[{name:'/README_CN.md'},{name:'/README_EN.md'}]}):new Response(url.endsWith('README_CN.md')?'# 作者中文':url.endsWith('README_EN.md')?'# Author English':'# Original'))
  await load({name:'test-plugin',version:'2.0.0',metadataOnly:true,language:'zh-CN'})
  assert.equal(calls.length,1)
  const raw=await load({name:'test-plugin',version:'2.0.0',fast:true})
  const before=calls.filter(c=>c.url.endsWith('/README.md')).length
  const zh=await load({name:'test-plugin',version:'2.0.0',fast:true,language:'zh-CN'})
  const en=await load({name:'test-plugin',version:'2.0.0',fast:true,language:'en'})
  assert.equal(raw.details.readme.markdown,'# Original')
  assert.equal(zh.details.readme.markdown,'# 作者中文')
  assert.equal(en.details.readme.markdown,'# Author English')
  assert.equal(zh.details.readme.imageFallbackBaseUrl,`https://raw.githubusercontent.com/example/test-plugin/${sha}/`)
  assert.equal(calls.filter(c=>c.url.endsWith('/README.md')).length,before)
  const total=calls.length
  await load({name:'test-plugin',version:'2.0.0',fast:true,language:'zh-CN'})
  assert.equal(calls.length,total)
})
console.log(`${checks} package detail checks passed`)
