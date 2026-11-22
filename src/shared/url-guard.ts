/** Pure URL guard shared by the main-process browser panel. No Electron
 * imports so test scripts can exercise it directly. */

export function isLocalhost(hostname: string): boolean {
  const value = hostname.toLowerCase()
  return value === 'localhost' || value.endsWith('.localhost') || value === '127.0.0.1' || value === '::1'
}

/**
 * Normalize an IP-literal host to a canonical address string so private-range
 * checks cannot be bypassed by alternate encodings (decimal `2130706433`,
 * hex `0x7f.0.0.1`, `::ffff:` mapped IPv6, bracketed IPv6, `0.0.0.0`).
 * Returns null for hosts that are not IP literals.
 */
export function normalizeIpLiteral(host: string): string | null {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (value.includes(':')) {
    if (value === '::' || value === '::1') return value
    // Dotted-quad mapped form (::ffff:10.0.0.1) before expansion: the dotted
    // tail is not hex, so the eight-group expansion would reject it.
    const mappedDotted = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (mappedDotted) return normalizeIpLiteral(mappedDotted[1])
    // Expand ::-compression to eight hex groups; the URL parser may hand us
    // IPv4-mapped forms in pure hex spelling (::ffff:a00:1).
    const halves = value.split('::')
    if (halves.length > 2) return null
    const head = halves[0] ? halves[0].split(':') : []
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
    const groups = halves.length === 2 ? [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail] : head
    if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
      // A trailing dotted quad (e.g. 64:ff9b::1.2.3.4) is uncommon and out of
      // scope here: treat it as unparseable rather than guessing.
      return null
    }
    if (groups.slice(0, 5).every((group) => group === '0') && groups[5] === 'ffff') {
      const high = parseInt(groups[6], 16)
      const low = parseInt(groups[7], 16)
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
    }
    return groups.join(':')
  }
  // IPv4, including decimal/octal/hex shorthand (inet_aton semantics). A
  // single part may be a full hex literal ('0xffffffff' → 10 characters);
  // dotted octets are at most 4 characters ('0xff').
  const parts = value.split('.')
  if (parts.length === 0 || parts.length > 4 || parts.some((part) => part === '' || (parts.length > 1 && part.length > 4))) return null
  const parse = (part: string): number | null => {
    if (/^0[xX]/.test(part)) {
      if (!/^[0-9a-fA-F]+$/.test(part.slice(2)) || part.length < 3) return null
      return parseInt(part, 16)
    }
    if (!/^\d+$/.test(part)) return null
    if (part.length > 1 && part.startsWith('0')) return parseInt(part, 8)
    return parseInt(part, 10)
  }
  const numbers: number[] = []
  for (const part of parts) {
    const parsed = parse(part)
    if (parsed === null || parsed > 255 && parts.length > 1) return null
    numbers.push(parsed)
  }
  if (parts.length === 1) {
    if (numbers[0] > 0xFFFFFFFF) return null
    return [(numbers[0] >>> 24) & 255, (numbers[0] >>> 16) & 255, (numbers[0] >>> 8) & 255, numbers[0] & 255].join('.')
  }
  if (parts.length === 2) {
    if (numbers[1] > 0xFFFFFF) return null
    return [numbers[0], (numbers[1] >>> 16) & 255, (numbers[1] >>> 8) & 255, numbers[1] & 255].join('.')
  }
  if (parts.length === 3) {
    if (numbers[2] > 0xFFFF) return null
    return [numbers[0], numbers[1], (numbers[2] >>> 8) & 255, numbers[2] & 255].join('.')
  }
  return numbers.join('.')
}

export function isPrivateIp(ip: string): boolean {
  const bytes = ip.split('.').map(Number)
  if (bytes.length === 4 && bytes.every((byte) => Number.isInteger(byte))) {
    const [a, b] = bytes
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 198 && (b === 18 || b === 19)) return true
    if (a >= 224) return true
    return false
  }
  if (ip === '::' || ip === '::1') return true
  const groups = ip.split(':')
  if (groups.length === 8 && groups.every((group) => parseInt(group, 16) === 0)) return true
  if (/^f[cd]/.test(groups[0] ?? '')) return true
  if (/^fe8|^fe9|^fea|^feb/.test(groups[0] ?? '')) return true
  if (/^ff/.test(groups[0] ?? '')) return true
  return false
}

export function isPrivateHost(hostname: string): boolean {
  if (isLocalhost(hostname)) return true
  const ip = normalizeIpLiteral(hostname)
  if (ip) return isPrivateIp(ip)
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return true
  if (/^169\.254\./.test(hostname)) return true
  return false
}

export function normalizeBrowserUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (isPrivateHost(url.hostname) && !isLocalhost(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}
