import type { PackageCatalogEntry } from '@shared/types'

const DEFAULT_QUERIES = ['keywords:pi-extension', 'keywords:pi-plugin', 'keywords:pi-package']

function normalizeQuery(query: string): string[] {
  const needle = query.trim()
  if (!needle) return DEFAULT_QUERIES
  return DEFAULT_QUERIES.map((prefix) => `${prefix} ${needle}`)
}

export async function searchPackageCatalog(query = ''): Promise<{ entries: PackageCatalogEntry[]; error?: string }> {
  const seen = new Set<string>()
  const entries: PackageCatalogEntry[] = []
  const errors: string[] = []
  for (const text of normalizeQuery(query)) {
    try {
      const response = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=30`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Pi-Desktop' },
        signal: AbortSignal.timeout(8000)
      })
      if (!response.ok) {
        errors.push(`npm registry returned ${response.status}.`)
        continue
      }
      const body = await response.json() as { objects?: unknown[] }
      for (const raw of body.objects ?? []) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as { package?: Record<string, unknown> }
        const pkg = item.package
        if (!pkg || typeof pkg.name !== 'string' || !pkg.name.trim() || seen.has(pkg.name)) continue
        if (typeof pkg.version !== 'string') continue
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
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
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
