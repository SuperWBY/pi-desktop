import { randomUUID } from 'node:crypto'
import { createAuthenticatedBridge } from '../../extensions/computer-use/src/chrome-bridge-auth.ts'
import { readChromePairing } from '../../extensions/computer-use/src/chrome-bridge-pairing.ts'

export type ChromeBridgeVersionStatus = 'current' | 'outdated' | 'unknown'

export function classifyBridgeVersion(actual: unknown, expected: unknown): ChromeBridgeVersionStatus {
  const parse = (value: unknown): number[] | null => {
    if (typeof value !== 'string' || !/^\d{1,5}(\.\d{1,5}){0,3}$/.test(value)) return null
    const parts = value.split('.').map(Number)
    return parts.every(part => part <= 65535) ? parts : null
  }
  const a = parse(actual), b = parse(expected)
  if (!a || !b) return 'unknown'
  for (let i = 0; i < 4; i++) {
    if ((a[i] ?? 0) < (b[i] ?? 0)) return 'outdated'
    if ((a[i] ?? 0) > (b[i] ?? 0)) return 'current'
  }
  return 'current'
}

export async function checkChromeBridge(options: { port?: number; timeoutMs?: number; key?: string; expectedVersion?: string } = {}): Promise<{ connected: boolean; busy: boolean; versionStatus?: ChromeBridgeVersionStatus }> {
  try {
    const key = options.key ?? readChromePairing()
    const bridge = createAuthenticatedBridge({ key, task: { id: randomUUID(), type: 'ping' }, port: options.port ?? Number(process.env.PI_CHROME_BRIDGE_PORT ?? 9317), timeoutMs: options.timeoutMs ?? 2500 })
    const [, result] = await Promise.all([bridge.ready, bridge.result])
    const connected = !!result && typeof result === 'object' && (result as { protocol?: number }).protocol === 1
    return { connected, busy: false, ...(connected ? { versionStatus: classifyBridgeVersion((result as { version?: unknown }).version, options.expectedVersion) } : {}) }
  } catch (error) {
    return { connected: false, busy: (error as NodeJS.ErrnoException)?.code === 'EADDRINUSE' }
  }
}
