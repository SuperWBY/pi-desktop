import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Nodes } from 'mdast'
import type { PackageReadme } from '@shared/types'

type Language = 'zh-CN' | 'en'
type Read = (url: string, limit: number, accept: string, timeout?: number) => Promise<string | null>
const safePath = (path: string): boolean => path.length < 512 && !path.startsWith('/') && !/[\\?#%\x00-\x1f]/.test(path) && path.split('/').every(p => p && p !== '.' && p !== '..')
const encoded = (path: string): string => path.split('/').map(encodeURIComponent).join('/')

export function readmeLanguage(path: string): Language | undefined {
  const name = path.split('/').pop() ?? ''
  const suffix = /^readme[._-](.+?)(?:\.md|\.markdown|\.rst|\.txt)?$/i.exec(name)?.[1]?.toLowerCase().replace(/_/g, '-')
  if (suffix && /^(zh(?:-cn|-hans)?|cn|chinese)$/.test(suffix)) return 'zh-CN'
  if (suffix && /^en(?:-us|-gb)?$/.test(suffix)) return 'en'
  if (/^readme(?:\.(md|markdown|rst|txt))?$/i.test(name)) {
    if (/(?:^|\/)(zh(?:[-_]cn|[-_]hans)?|cn)(?:\/|$)/i.test(path)) return 'zh-CN'
    if (/(?:^|\/)en(?:[-_](us|gb))?(?:\/|$)/i.test(path)) return 'en'
  }
  return undefined
}

function candidates(paths: string[], language: Language, original: string): string[] {
  const directory = original.includes('/') ? original.slice(0, original.lastIndexOf('/') + 1) : ''
  return [...new Set(paths)].filter(path => safePath(path) && !/(^|\/)(node_modules|vendor|examples|fixtures)(\/|$)/i.test(path) && (!path.includes('/') || path.startsWith(directory || 'docs/') || /^(docs?|i18n|locales?|translations?|zh(?:[-_](cn|hans))?|cn|en(?:[-_](us|gb))?)\//i.test(path)) && readmeLanguage(path) === language)
    .sort((a, b) => {
      const rank = (path: string): number => (path.slice(0, path.lastIndexOf('/') + 1) === directory ? 0 : !path.includes('/') ? 1 : 2) * 100 + path.split('/').length
      return rank(a) - rank(b) || a.localeCompare(b)
    })
}

function authorLanguageLinks(markdown: string, language: Language, baseUrl: string, roots: string[], originalPath: string): string[] {
  const tree = unified().use(remarkParse).parse(markdown)
  const definitions = new Map<string, string>()
  const links: string[] = []
  const visit = (node: Nodes): void => {
    if (node.type === 'definition') definitions.set(node.identifier.toLowerCase(), node.url)
    if ('children' in node) node.children.forEach(visit)
  }
  visit(tree)
  const directory = originalPath.includes('/') ? originalPath.slice(0, originalPath.lastIndexOf('/') + 1) : ''
  const add = (target: string, label: string): void => {
    try {
      const url = new URL(target, baseUrl)
      const root = roots.find(root => url.href.startsWith(root))
      if (!root || url.search || url.hash) return
      const path = decodeURIComponent(url.href.slice(root.length))
      const declared = language === 'zh-CN' ? /^(简体中文|中文|Chinese|Simplified Chinese)$/i.test(label.trim()) : /^(English|英文|英语)$/i.test(label.trim())
      const appropriate = !path.includes('/') || (directory && path.startsWith(directory)) || /^(docs?|i18n|locales?|translations?|zh(?:[-_](cn|hans))?|cn|en(?:[-_](us|gb))?)\//i.test(path)
      if (safePath(path) && appropriate && (readmeLanguage(path) === language || (declared && /^readme(?:\.md)?$/i.test(path.split('/').pop() ?? '')))) links.push(path)
    } catch { /* Author links are untrusted data. */ }
  }
  const text = (node: Nodes): string => node.type === 'text' ? node.value : 'children' in node ? node.children.map(text).join('') : ''
  const collect = (node: Nodes): void => {
    const target = node.type === 'link' ? node.url : node.type === 'linkReference' ? definitions.get(node.identifier.toLowerCase()) : undefined
    if (target) add(target, text(node))
    // Read href data only; never render or execute author HTML.
    if (node.type === 'html') for (const match of node.value.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) add(match[2], match[3].replace(/<[^>]*>/g, ''))
    if ('children' in node) node.children.forEach(collect)
  }
  collect(tree)
  return [...new Set(links)].sort((a, b) => Number(b.startsWith(directory || 'README')) - Number(a.startsWith(directory || 'README'))).slice(0, 3)
}

/** Discover actual published filenames, then repository files at the release commit.
 * No translation, tarball execution, or unbounded requests. Network failures preserve the original. */
export async function localizePackageReadme(input: {
  read: Read; name: string; version: string; language: Language; original: PackageReadme | null;
  github: string | null; directory: string; gitHead: string
}): Promise<PackageReadme | null> {
  const { read, name, version, language, github, original } = input
  const directory = input.directory.split('/').map(part => decodeURIComponent(part)).join('/')
  const cdn = `https://cdn.jsdelivr.net/npm/${name}@${encodeURIComponent(version)}/`
  const suppliedPath = original?.fileName ?? 'README.md'
  const originalPath = original?.source === 'github' && directory && suppliedPath.startsWith(`${directory}/`)
    ? suppliedPath.slice(directory.length + 1) : suppliedPath
  if (original && readmeLanguage(originalPath) === language) return { ...original, language, localizationStatus: 'matched' }
  let unavailable = false
  const sha = /^[a-f0-9]{40,64}$/i.test(input.gitHead) ? input.gitHead : ''
  const readCandidate = async (path: string, source: 'npm-cdn' | 'github', url: string, matched: boolean): Promise<PackageReadme | null> => {
    try {
      const markdown = await read(url, 512 * 1024, 'text/plain', 2500)
      if (!markdown?.trim()) return null
      return { markdown, fileName: path, language, localizationStatus: 'matched', source, url, baseUrl: new URL('.', url).href, versionMatched: matched }
    } catch { unavailable = true; return null }
  }
  // Explicit author language links take precedence over filename discovery.
  const rawRoot = github && sha ? `https://raw.githubusercontent.com/${github}/${sha}/${input.directory ? `${input.directory}/` : ''}` : null
  if (original) {
    for (const path of authorLanguageLinks(original.markdown, language, original.baseUrl, [cdn, ...(rawRoot ? [rawRoot] : [])], originalPath)) {
      if (path === originalPath) return { ...original, language, localizationStatus: 'matched' }
      const published = await readCandidate(path, 'npm-cdn', cdn + encoded(path), true)
      if (published) return published
      if (rawRoot) {
        const fromRepo = await readCandidate([directory, path].filter(Boolean).join('/'), 'github', rawRoot + encoded(path), true)
        if (fromRepo) return fromRepo
      }
    }
  }
  try {
    const raw = await read(`https://data.jsdelivr.com/v1/package/npm/${name}@${encodeURIComponent(version)}/flat`, 1024 * 1024, 'application/json', 2500)
    const data = raw ? JSON.parse(raw) : null
    if (Array.isArray(data?.files)) {
      if (data.files.length > 20_000) unavailable = true
      const paths = data.files.slice(0, 20_000).flatMap((file: { name?: unknown }) => typeof file?.name === 'string' ? [file.name.replace(/^\//, '')] : [])
      for (const path of candidates(paths, language, originalPath).slice(0, 3)) {
        const result = await readCandidate(path, 'npm-cdn', cdn + encoded(path), true)
        if (result) return result
      }
    } else if (raw) unavailable = true
  } catch { unavailable = true }
  if (github) {
    const parent = originalPath.includes('/') ? originalPath.slice(0, originalPath.lastIndexOf('/')) : ''
    const directories = [...new Set([directory, [directory, parent].filter(Boolean).join('/')])]
    for (let index = 0; index < directories.length && index < 6; index++) {
      const dir = directories[index]
      try {
        const raw = await read(`https://api.github.com/repos/${github}/contents${dir ? `/${encoded(dir)}` : ''}${sha ? `?ref=${sha}` : ''}`, 1024 * 1024, 'application/vnd.github+json', 2500)
        const files = raw ? JSON.parse(raw) : []
        if (!Array.isArray(files)) { unavailable = true; continue }
        // Follow only documentation containers and the requested language, with a hard request cap.
        for (const file of files) {
          if (file?.type !== 'dir' || typeof file.path !== 'string' || !safePath(file.path)) continue
          const name = file.path.split('/').pop()
          const wanted = /^(docs?|i18n|locales?|translations?)$/i.test(name ?? '') || (language === 'zh-CN' ? /^(zh(?:[-_](cn|hans))?|cn)$/i : /^en(?:[-_](us|gb))?$/i).test(name ?? '')
          if (wanted && !directories.includes(file.path) && directories.length < 6) directories.push(file.path)
        }
        const paths = files.filter(file => file?.type === 'file' && typeof file.path === 'string').map(file => file.path as string)
        for (const path of candidates(paths, language, [directory, originalPath].filter(Boolean).join('/')).slice(0, 3)) {
          const file = files.find(file => file.path === path)
          let url: URL
          try { url = new URL(file.download_url) } catch { continue }
          if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.username || url.password || !url.pathname.startsWith(`/${github}/${sha ? `${sha}/` : ''}`) || url.search || url.hash) continue
          const result = await readCandidate(path, 'github', url.href, Boolean(sha))
          if (result) return result
        }
      } catch { unavailable = true }
    }
  }
  return original ? { ...original, language: readmeLanguage(originalPath), localizationStatus: unavailable ? 'unavailable' : 'not-found' } : null
}
