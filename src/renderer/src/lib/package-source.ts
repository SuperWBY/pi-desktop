export function packageSource(input: string): { name: string; source: string; npm: boolean; version?: string } | null {
  let value = input.trim()
  if (value.length > 1000) return null
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      if (url.username || url.password || url.search || url.hash) return null
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if ((url.hostname === 'www.npmjs.com' || url.hostname === 'npmjs.com') && parts.shift() === 'package') {
        const versionAt = parts.indexOf('v')
        const version = versionAt > 0 ? parts[versionAt + 1] : undefined
        value = parts.slice(0, versionAt > 0 ? versionAt : undefined).join('/') + (version ? `@${version}` : '')
      } else if (url.hostname === 'pi.dev' && parts.shift() === 'packages') value = parts.join('/')
      else if (url.hostname === 'github.com' && parts.length === 2 && parts.every((part) => /^[\w.-]+$/.test(part))) {
        return { name: `github:${parts.join('/')}`, source: `https://github.com/${parts.join('/')}`, npm: false }
      } else return null
    } catch { return null }
  }
  value = value.replace(/^npm:/, '')
  const match = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@([a-zA-Z0-9][a-zA-Z0-9.+_-]{0,127}))?$/.exec(value)
  return match ? { name: match[1], source: `npm:${value}`, npm: true, version: match[2] } : null
}
