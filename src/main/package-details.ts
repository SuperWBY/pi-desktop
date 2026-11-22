import { localizePackageReadme } from './package-readme-locales.ts'
import type { PackageDetails, PackageDetailsRequest, PackageDetailsResult, PackageReadme } from '@shared/types'

type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}
const string = (value: unknown): string => typeof value === 'string' ? value : ''
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
const dictionary = (value: unknown): Record<string, string> => Object.fromEntries(Object.entries(object(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
const person = (value: unknown): string | null => (typeof value === 'string' ? value.replace(/\s*<[^>]*>/g, '').trim() : string(object(value).name)) || null
const README_LIMIT = 512 * 1024
class MetadataLimitError extends Error {
  constructor() { super('插件信息超过读取上限。') }
}

function webUrl(value: unknown): string | null {
  try {
    const url = new URL(string(value))
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

function repository(value: unknown): { url: string | null; github: string | null; directory: string } {
  const repo = typeof value === 'string' ? { url: value } : object(value)
  let raw = string(repo.url).replace(/^git\+/, '')
  raw = raw.replace(/^git@github\.com:/, 'https://github.com/').replace(/^git:\/\/github\.com\//, 'https://github.com/')
  if (/^github:[\w.-]+\/[\w.-]+$/.test(raw)) raw = `https://github.com/${raw.slice(7)}`
  const url = webUrl(raw.replace(/\.git(?:#.*)?$/, ''))
  const match = url && new URL(url).hostname === 'github.com' ? new URL(url).pathname.match(/^\/([\w.-]+\/[\w.-]+)\/?$/) : null
  const parts = string(repo.directory).replace(/\\/g, '/').split('/').filter(Boolean)
  const directory = parts.some((part) => part === '.' || part === '..') ? '' : parts.map(encodeURIComponent).join('/')
  return { url, github: match?.[1] ?? null, directory }
}

function readmePaths(value: unknown): string[] {
  const path = string(value).replace(/\\/g, '/')
  const safe = path && !path.startsWith('/') && path.split('/').every((part) => part && part !== '.' && part !== '..')
  return [...new Set([...(safe ? [path] : []), 'README.md', 'readme.md', 'README'])]
}

/** Bounded reads, no installation or package code execution. */
async function readText(fetcher: typeof fetch, url: string, limit: number, accept: string, timeout = 8000): Promise<string | null> {
  const response = await fetcher(url, {
    headers: { Accept: accept, 'User-Agent': 'Pi-Desktop' },
    signal: AbortSignal.timeout(timeout), redirect: 'error'
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`读取插件信息失败（HTTP ${response.status}）。`)
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    throw new MetadataLimitError()
  }
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > limit) throw new MetadataLimitError()
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function loadReadme(
  fetcher: typeof fetch, name: string, version: string, pack: ObjectValue, manifest: ObjectValue,
  repo: ReturnType<typeof repository>, warnings: string[], fast = false
): Promise<PackageReadme | null> {
  const cdn = `https://cdn.jsdelivr.net/npm/${name}@${encodeURIComponent(version)}/`
  const paths = readmePaths(manifest.readmeFilename ?? pack.readmeFilename)
  const published = string(manifest.readme)
  if (published && Buffer.byteLength(published) <= README_LIMIT) {
    return { markdown: published, fileName: paths[0], source: 'npm', versionMatched: true,
      url: `https://www.npmjs.com/package/${name}/v/${encodeURIComponent(version)}`,
      baseUrl: new URL('.', `${cdn}${paths[0].split('/').map(encodeURIComponent).join('/')}`).href }
  }
  // Historical README content must come from the selected release, never the current dist-tag.
  const cdnRead = async (path: string): Promise<PackageReadme> => {
    const url = `${cdn}${path.split('/').map(encodeURIComponent).join('/')}`
    const markdown = await readText(fetcher, url, README_LIMIT, 'text/plain', fast ? 2500 : 8000)
    if (!markdown?.trim()) throw new Error('README not found')
    return { markdown, fileName: path, source: 'npm-cdn', versionMatched: true, url, baseUrl: new URL('.', url).href }
  }
  if (fast) {
    try { return await Promise.any(paths.map(cdnRead)) } catch { /* GitHub remains available. */ }
  } else {
  for (const path of paths) {
    const url = `${cdn}${path.split('/').map(encodeURIComponent).join('/')}`
    try {
      const markdown = await readText(fetcher, url, README_LIMIT, 'text/plain')
      if (markdown?.trim()) return { markdown, fileName: path, source: 'npm-cdn', versionMatched: true, url, baseUrl: new URL('.', url).href }
    } catch { break /* A failed CDN must not hide npm metadata or prevent GitHub fallback. */ }
  }
  }
  if (repo.github) {
    const gitHead = /^[a-f0-9]{40,64}$/i.test(string(manifest.gitHead)) ? string(manifest.gitHead) : null
    // A monorepo's package README belongs in repository.directory, not the repository root.
    const endpoint = repo.directory
      ? `https://api.github.com/repos/${repo.github}/contents/${repo.directory}/${paths[0].split('/').map(encodeURIComponent).join('/')}`
      : `https://api.github.com/repos/${repo.github}/readme`
    const url = `${endpoint}${gitHead ? `?ref=${gitHead}` : ''}`
    try {
      const raw = await readText(fetcher, url, README_LIMIT * 2, 'application/vnd.github+json', fast ? 2500 : 8000)
      const content = raw ? object(JSON.parse(raw)) : {}
      const markdown = content.encoding === 'base64' ? Buffer.from(string(content.content), 'base64').toString('utf8') : ''
      const download = webUrl(content.download_url)
      if (markdown.trim() && Buffer.byteLength(markdown) <= README_LIMIT && download && new URL(download).hostname === 'raw.githubusercontent.com') {
        if (!gitHead) warnings.push('README 来自 GitHub 默认分支，未确认与所选发布版本一致。')
        return { markdown, fileName: string(content.path) || paths[0], source: 'github', versionMatched: Boolean(gitHead),
          url: webUrl(content.html_url) ?? url, baseUrl: new URL('.', download).href }
      }
    } catch { /* Metadata remains useful when GitHub is unavailable or rate-limited. */ }
  }
  // Package-level README is not reliably tied to an arbitrary selected release.
  const packageReadme = version === object(pack['dist-tags']).latest ? string(pack.readme) : ''
  if (packageReadme.trim() && Buffer.byteLength(packageReadme) <= README_LIMIT) {
    warnings.push('README 来自 npm 包级说明，未确认与所选版本一致。')
    return { markdown: packageReadme, fileName: paths[0], source: 'npm', versionMatched: false,
      url: `https://www.npmjs.com/package/${name}`, baseUrl: cdn }
  }
  warnings.push('暂时无法读取所选版本的 README，可通过来源链接查看说明。')
  return null
}

/** One aggregation boundary shared by the Electron UI and possible future HTTP adapters. */
export function createPackageDetailsLoader(fetcher: typeof fetch = fetch, now: () => number = Date.now): (input: PackageDetailsRequest) => Promise<PackageDetailsResult> {
  const cache = new Map<string, { until: number; details: PackageDetails }>()
  const pending = new Map<string, Promise<PackageDetailsResult>>()

  const releases = new Map<string, { until: number; pack: ObjectValue }>()
  const releaseRequests = new Map<string, Promise<ObjectValue>>()
  const release = async (name: string, requested: string): Promise<ObjectValue> => {
    const key = `${name}@${requested}`
    const stored = releases.get(key)
    if (stored && stored.until > now()) return stored.pack
    if (releaseRequests.has(key)) return releaseRequests.get(key)!
    const request = (async () => {
      const raw = await readText(fetcher, `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(requested)}`, 2 * 1024 * 1024, 'application/json', 6000)
      if (raw === null) throw new Error('没有找到所选插件版本。')
      const data = object(JSON.parse(raw))
      // A release endpoint returns a single manifest, without historical releases.
      const manifest = data.versions ? object(object(data.versions)[string(object(data['dist-tags'])[requested]) || requested]) : data
      const version = string(manifest.version)
      if (manifest.name !== name || !version || (/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(requested) && requested !== version)) throw new Error('没有找到所选插件版本。')
      const pack = data.versions ? data : { name, versions: { [version]: manifest }, 'dist-tags': { [requested]: version }, time: {} }
      if (releases.size >= 48) releases.delete(releases.keys().next().value!)
      releases.set(key, { until: now() + 5 * 60_000, pack })
      if (key !== `${name}@${version}`) {
        if (releases.size >= 48) releases.delete(releases.keys().next().value!)
        releases.set(`${name}@${version}`, { until: now() + 5 * 60_000, pack })
      }
      return pack
    })()
    releaseRequests.set(key, request)
    try { return await request } finally { releaseRequests.delete(key) }
  }
  const load = async (name: string, requested: string, metadataOnly: boolean, fast: boolean): Promise<PackageDetailsResult> => {
    try {
      let releaseOnly = fast || metadataOnly
      let pack: ObjectValue
      if (releaseOnly) pack = await release(name, requested)
      else {
        try {
          const raw = await readText(fetcher, `https://registry.npmjs.org/${encodeURIComponent(name)}`, 8 * 1024 * 1024, 'application/json')
          if (raw === null) return { ok: false, error: '没有找到这个 npm 插件。' }
          pack = object(JSON.parse(raw))
        } catch (error) {
          if (!(error instanceof MetadataLimitError)) throw error
          // Large histories are not needed to display or install one release.
          // Preserve both read bounds and the requested version/tag identity.
          pack = await release(name, requested)
          releaseOnly = true
        }
      }
      const versions = object(pack.versions)
      const tags = object(pack['dist-tags'])
      const version = string(tags[requested]) || requested
      const manifest = object(versions[version])
      if (pack.name !== name || manifest.name !== name || manifest.version !== version) return { ok: false, error: '没有找到所选插件版本。' }
      const repo = repository(manifest.repository ?? pack.repository)
      const pi = object(manifest.pi)
      const dist = object(manifest.dist)
      const warnings: string[] = []
      const readme = metadataOnly ? null : await loadReadme(fetcher, name, version, pack, manifest, repo, warnings, fast || releaseOnly)
      if (readme && readme.source !== 'github' && repo.github && /^[a-f0-9]{40,64}$/i.test(string(manifest.gitHead))) {
        const cdnRoot = `https://cdn.jsdelivr.net/npm/${name}@${encodeURIComponent(version)}/`
        if (readme.baseUrl.startsWith(cdnRoot)) readme.imageFallbackBaseUrl =
          `https://raw.githubusercontent.com/${repo.github}/${manifest.gitHead}/${repo.directory ? `${repo.directory}/` : ''}${readme.baseUrl.slice(cdnRoot.length)}`
      }
      const details: PackageDetails = {
        name, version, latestVersion: string(tags.latest) || null,
        versions: Object.keys(versions).sort((a, b) => string(object(pack.time)[b]).localeCompare(string(object(pack.time)[a]))),
        description: string(manifest.description), author: person(manifest.author), publisher: person(manifest._npmUser),
        license: string(manifest.license) || string(object(manifest.license).type) || null,
        publishedAt: string(object(pack.time)[version]) || null,
        homepage: webUrl(manifest.homepage), repositoryUrl: repo.url,
        npmUrl: `https://www.npmjs.com/package/${name}`, catalogUrl: `https://pi.dev/packages/${name}`,
        installSource: `npm:${name}@${version}`,
        unpackedSize: typeof dist.unpackedSize === 'number' && Number.isFinite(dist.unpackedSize) && dist.unpackedSize >= 0 ? dist.unpackedSize : null,
        dependencies: dictionary(manifest.dependencies), peerDependencies: dictionary(manifest.peerDependencies), engines: dictionary(manifest.engines),
        manifest: { extensions: strings(pi.extensions), skills: strings(pi.skills), prompts: strings(pi.prompts), themes: strings(pi.themes), image: webUrl(pi.image), video: webUrl(pi.video) },
        readme, warnings, fetchedAt: now()
      }
      return { ok: true, details }
    } catch (error) {
      return { ok: false, error: error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? '连接插件源超时，请重试。' : error instanceof Error ? error.message : '无法读取插件详情。' }
    }
  }

  const getDetails = async (input: PackageDetailsRequest): Promise<PackageDetailsResult> => {
    if (!input || typeof input.name !== 'string') return { ok: false, error: '请提供 npm 包名。' }
    const name = input.name.trim().replace(/^npm:/, '')
    const requested = input.version === undefined ? 'latest' : typeof input.version === 'string' ? input.version.trim() : ''
    if (name.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) return { ok: false, error: 'npm 包名格式不正确。' }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,127}$/.test(requested)) return { ok: false, error: '请提供确切版本号或发布标签。' }
    const metadataOnly = input.metadataOnly === true
    const fast = input.fast === true
    const language = !metadataOnly && (input.language === 'zh-CN' || input.language === 'en') ? input.language : undefined
    const key = `${name}@${requested}${metadataOnly ? ':metadata' : fast ? ':fast' : ''}${language ? `:${language}` : ''}`
    const cached = cache.get(key)
    if (cached && cached.until > now()) return { ok: true, details: structuredClone(cached.details) }
    const existing = pending.get(key)
    if (existing) return structuredClone(await existing)
    const request = language ? (async (): Promise<PackageDetailsResult> => {
      const result = await getDetails({ ...input, language: undefined })
      if (!result.ok) return result
      try {
        const pack = await release(name, result.details.version)
        const manifest = object(object(pack.versions)[result.details.version])
        const repo = repository(manifest.repository ?? pack.repository)
        const readme = await localizePackageReadme({ read: (url, limit, accept, timeout) => readText(fetcher, url, limit, accept, timeout),
          name, version: result.details.version, language, original: result.details.readme, github: repo.github, directory: repo.directory, gitHead: string(manifest.gitHead) })
        if (readme?.source === 'npm-cdn' && repo.github && /^[a-f0-9]{40,64}$/i.test(string(manifest.gitHead))) {
          const cdnRoot = `https://cdn.jsdelivr.net/npm/${name}@${encodeURIComponent(result.details.version)}/`
          readme.imageFallbackBaseUrl = `https://raw.githubusercontent.com/${repo.github}/${manifest.gitHead}/${repo.directory ? `${repo.directory}/` : ''}${readme.baseUrl.slice(cdnRoot.length)}`
        }
        return { ok: true, details: { ...result.details, readme } }
      } catch { return { ok: true, details: { ...result.details, readme: result.details.readme ? { ...result.details.readme, localizationStatus: 'unavailable' } : null } } }
    })() : load(name, requested, metadataOnly, fast)
    pending.set(key, request)
    try {
      const result = await request
      if (result.ok) {
        if (cache.size >= 32) cache.delete(cache.keys().next().value!)
        cache.set(key, { until: now() + 5 * 60_000, details: result.details })
      }
      return structuredClone(result)
    } finally { pending.delete(key) }
  }
  return getDetails
}

export const getPackageDetails = createPackageDetailsLoader()
