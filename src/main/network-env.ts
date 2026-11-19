import type { Settings } from '@shared/types'

function validProxy(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'socks5:'
  } catch {
    return false
  }
}

export function proxyEnv(settings: Settings): Record<string, string> {
  const proxy = settings.networkProxy?.trim()
  if (!proxy || !validProxy(proxy)) return {}
  return {
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    ALL_PROXY: proxy,
    ...(settings.networkNoProxy?.trim() ? { NO_PROXY: settings.networkNoProxy.trim() } : {})
  }
}
