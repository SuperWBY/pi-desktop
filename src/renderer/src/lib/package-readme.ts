import type { Code, Root, RootContent } from 'mdast'
import type { Parent } from 'unist'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { PackageReadme } from '@shared/types'

/** Keep author-provided absolute URLs; only relative images may use the pinned repository fallback. */
export function readmeImageSources(src: string, readme: Pick<PackageReadme, 'baseUrl' | 'imageFallbackBaseUrl'>): string[] {
  const sources: string[] = []
  const add = (base: string, boundary?: { origin: string; path: string }): void => {
    try {
      const url = new URL(src, base)
      if (/^https?:$/.test(url.protocol) && !url.username && !url.password &&
        (!boundary || (url.origin === boundary.origin && url.pathname.startsWith(boundary.path)))) sources.push(url.href)
    } catch { /* Malformed upstream image URL. */ }
  }
  add(readme.baseUrl)
  if (sources.length && readme.imageFallbackBaseUrl && !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(src)) {
    try {
      const base = new URL(readme.imageFallbackBaseUrl)
      const root = base.pathname.match(/^\/[^/]+\/[^/]+\/[a-f0-9]{40,64}\//i)?.[0]
      if (base.hostname === 'raw.githubusercontent.com' && root) add(base.href, { origin: base.origin, path: root })
    } catch { /* No validated release image fallback. */ }
  }
  return [...new Set(sources)]
}

/** Keep upstream usage/configuration docs; the app owns installation. No install commands to copy. */
export function readmeHeadings(markdown: string): string[] {
  return unified().use(remarkParse).parse(markdown).children.filter((node) => node.type === 'heading').map((node) => node.type === 'heading' ? node.children.map((child) => 'value' in child ? child.value : '').join('').trim() : '')
}

export function hideInstallInstructions(options?: { headings?: string[] }): (tree: Root) => void {
  return (tree) => {
    const slugs = new Map<string, number>()
    let installDepth = 0
    let heading = 0
    tree.children = tree.children.flatMap((node: RootContent): RootContent[] => {
      if (node.type === 'heading') {
        const title = options?.headings?.[heading++] ?? node.children.map((child) => 'value' in child ? child.value : '').join('').trim()
        if (/^(?:installation|install|安装(?:说明|方法|指南)?)(?:\s|$)/i.test(title)) { installDepth = node.depth; return [] }
        if (installDepth && node.depth <= installDepth) installDepth = 0
        const slug = title.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/ /g, '-')
        const count = slugs.get(slug) ?? 0
        slugs.set(slug, count + 1)
        node.data = { ...node.data, hProperties: { id: `market-readme-${slug}${count ? `-${count}` : ''}` } }
      }
      if (installDepth) return []
      return [node]
    })
    // Quick-start instructions commonly put install blocks inside numbered lists.
    // Walk every container so those blocks cannot bypass the top-level filter.
    const clean = (parent: Parent): void => {
      parent.children = parent.children.flatMap((node) => {
        if (node.type === 'code') {
          const code = node as Code
          const lines = code.value.split('\n').filter((line) => !/^\s*(?:\$\s*)?(?:pi\s+(?:install|remove)|(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\b)/.test(line))
          if (!lines.some((line) => line.trim() && !/^\s*#/.test(line))) return []
          return [{ ...code, value: lines.join('\n') }]
        }
        if ('children' in node) clean(node as Parent)
        return [node]
      })
    }
    clean(tree)
  }
}
