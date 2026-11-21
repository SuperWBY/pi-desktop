import type { Definition, Nodes } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { mediaMimeType } from '@shared/media'
import { canonicalWorkspacePath } from '@shared/paths'
import { baseName } from './format'
import type { FileChange } from './session-changes'

export interface TurnMediaItem {
  key: string
  name: string
  kind: 'image' | 'video' | 'html' | 'website'
  source: string
  remote: boolean
}

const markdown = unified().use(remarkParse)

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node)
  if ('children' in node) for (const child of node.children) walk(child, visit)
}

function mediaSource(source: string, fromMarkdown: boolean): Omit<TurnMediaItem, 'key'> | undefined {
  if (!source || source.length > 8192) return undefined
  let path = source.trim()
  const remote = /^https:\/\//i.test(path)
  try {
    if (remote) path = new URL(path).pathname
    else if (/^file:\/\//i.test(path)) {
      const url = new URL(path)
      if (url.hostname && url.hostname !== 'localhost') return undefined
      path = url.pathname.replace(/^\/(?=[A-Za-z]:[\\/])/, '')
    } else if (/^sandbox:\//i.test(path)) path = path.slice('sandbox:'.length)
    else if (path.startsWith('//') || /^[a-z][a-z\d+.-]*:(?![\\/])/i.test(path) ||
      /^[a-z][a-z\d+.-]+:/i.test(path)) return undefined
    if (fromMarkdown) path = decodeURIComponent(path)
  } catch {
    return undefined
  }
  const mime = mediaMimeType(path)
  if (!mime) return undefined
  const kind = mime.startsWith('video/') ? 'video' : mime === 'text/html' ? 'html' : 'image'
  return { kind, name: baseName(path), source: remote ? source : path, remote }
}

export function isLocalMediaImage(url: string): boolean {
  const item = mediaSource(url, true)
  return item?.kind === 'image' && !item.remote
}

export function collectTurnMedia(text: string, changes: FileChange[], workspace: string): TurnMediaItem[] {
  const items = new Map<string, TurnMediaItem>()
  const addWebsite = (source: string, label: string): void => {
    if (!/^https?:\/\//i.test(source) || source.length > 8192) return
    try {
      const url = new URL(source)
      if (url.username || url.password) return
      const key = url.href
      if (!items.has(key)) items.set(key, {
        key, source: key, name: label.trim().slice(0, 160) || url.host, kind: 'website', remote: true
      })
    } catch {
      // Leave malformed URLs in the original answer.
    }
  }
  const add = (source: string, fromMarkdown: boolean): void => {
    const item = mediaSource(source, fromMarkdown)
    // Remote images and pages stay ordinary links.
    if (!item || (item.remote && item.kind !== 'video')) return
    if (!item.remote && !workspace) return
    const key = item.remote ? item.source : canonicalWorkspacePath(
      item.source.startsWith('/') || /^[A-Za-z]:[\\/]/.test(item.source) ? item.source : `${workspace}/${item.source.replace(/^\.\//, '')}`
    )
    if (!items.has(key)) items.set(key, { ...item, key })
  }

  if (text && /pi:website|\.(?:png|jpe?g|gif|webp|avif|svg|mp4|m4v|webm|mov|html?)\b/i.test(text)) {
    const root = markdown.parse(text)
    const definitions = new Map<string, Definition>()
    walk(root, (node) => { if (node.type === 'definition') definitions.set(node.identifier, node) })
    walk(root, (node) => {
      if (node.type === 'link' || node.type === 'linkReference') {
        const link = node.type === 'link' ? node : definitions.get(node.identifier)
        if (link?.title === 'pi:website') {
          let label = ''
          walk(node, (child) => {
            if (child.type === 'text' || child.type === 'inlineCode') label += child.value
            if (child.type === 'image') label += child.alt ?? ''
          })
          addWebsite(link.url, label)
          return
        }
        if (link) add(link.url, true)
      }
      if (node.type === 'image') add(node.url, true)
      if (node.type === 'imageReference') {
        const definition = definitions.get(node.identifier)
        if (definition) add(definition.url, true)
      }
      if (node.type === 'inlineCode') add(node.value, false)
    })
  }
  for (const change of changes) add(change.path, false)
  return [...items.values()]
}
