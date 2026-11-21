import type { PackageCatalogEntry } from '@shared/types'

const DEFAULT_QUERIES = ['keywords:pi-extension', 'keywords:pi-plugin', 'keywords:pi-package']

function normalizeQuery(query: string): string[] {
  const needle = query.trim()
  if (!needle) return DEFAULT_QUERIES
  return DEFAULT_QUERIES.map((prefix) => `${prefix} ${needle}`)
}

async function loadCatalog(query = ''): Promise<{ entries: PackageCatalogEntry[]; error?: string }> {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const seen = new Set<string>()
  const entries: PackageCatalogEntry[] = []
  const errors: string[] = []
  const responses = await Promise.allSettled(normalizeQuery(query).map(async (text) => {
      const response = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=30`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Pi-Desktop' },
        signal: AbortSignal.timeout(4000)
      })
      if (!response.ok) throw new Error(`npm registry returned ${response.status}.`)
      return await response.json() as { objects?: unknown[] }
  }))
  for (const result of responses) {
    if (result.status === 'rejected') { errors.push('连接插件目录超时或暂不可用，请重试。'); continue }
    const body = result.value
      for (const raw of body.objects ?? []) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as { package?: Record<string, unknown> }
        const pkg = item.package
        if (!pkg || typeof pkg.name !== 'string' || !pkg.name.trim() || seen.has(pkg.name)) continue
        if (typeof pkg.version !== 'string') continue
        // npm search may include loosely related results even for an exact package
        // name. Keep the user's terms visible in the returned package metadata.
        const searchable = [pkg.name, pkg.description, ...(Array.isArray(pkg.keywords) ? pkg.keywords : []),
          typeof pkg.publisher === 'object' && pkg.publisher ? (pkg.publisher as { username?: string }).username : '']
          .filter((value): value is string => typeof value === 'string').join(' ').toLocaleLowerCase()
        if (!terms.every((term) => searchable.includes(term))) continue
        seen.add(pkg.name)
        const links = pkg.links && typeof pkg.links === 'object' ? pkg.links as Record<string, unknown> : {}
        entries.push({
          name: pkg.name,
          version: pkg.version,
          description: typeof pkg.description === 'string' ? pkg.description.slice(0, 300) : '',
          publishedAt: typeof pkg.date === 'string' ? pkg.date : null,
          publisher: typeof pkg.publisher === 'object' && pkg.publisher && typeof (pkg.publisher as { username?: unknown }).username === 'string' ? String((pkg.publisher as { username: string }).username) : null,
          keywords: Array.isArray(pkg.keywords) ? pkg.keywords.filter((value): value is string => typeof value === 'string').slice(0, 12) : [],
          npmUrl: typeof links.npm === 'string' ? links.npm : null,
          repositoryUrl: typeof links.repository === 'string' ? links.repository : null,
          source: `npm:${pkg.name}`
        })
        if (entries.length >= 60) break
      }
    if (entries.length >= 60) break
  }
  entries.sort((a, b) => {
    const aOfficial = /^@earendil-works\//.test(a.name) ? 1 : 0
    const bOfficial = /^@earendil-works\//.test(b.name) ? 1 : 0
    return bOfficial - aOfficial || a.name.localeCompare(b.name)
  })
  return {
    entries,
    ...(entries.length ? {} : { error: errors[0] ?? '没有找到匹配的插件。' })
  }
}

const cache = new Map<string, { until: number; result: Awaited<ReturnType<typeof loadCatalog>> }>()
const pending = new Map<string, Promise<Awaited<ReturnType<typeof loadCatalog>>>>()
export async function searchPackageCatalog(query = ''): Promise<Awaited<ReturnType<typeof loadCatalog>>> {
  const key = query.trim().toLowerCase()
  const stored = cache.get(key)
  if (stored && stored.until > Date.now()) return structuredClone(stored.result)
  const existing = pending.get(key)
  if (existing) return structuredClone(await existing)
  const request = loadCatalog(query)
  pending.set(key, request)
  try {
    const result = await request
    if (result.entries.length) {
      if (cache.size >= 24) cache.delete(cache.keys().next().value!)
      cache.set(key, { until: Date.now() + 5 * 60_000, result })
    }
    return structuredClone(result)
  } finally { pending.delete(key) }
}
