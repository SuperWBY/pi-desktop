#!/usr/bin/env node
/**
 * Non-interactive bridge for pi's ModelRuntime.login().
 *
 * The desktop UI owns the dialogs; this process owns pi's provider auth
 * implementation. It deliberately never prints credentials, only UI events
 * and prompt descriptors.
 */
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const packagePath = process.env.PI_AUTH_PACKAGE
if (!packagePath) {
  process.stdout.write(JSON.stringify({ type: 'error', message: 'PI_AUTH_PACKAGE is not set.' }) + '\n')
  process.exit(1)
}
const { ModelRuntime } = await import(pathToFileURL(packagePath).href)
const runtime = await ModelRuntime.create({
  authPath: process.env.PI_AUTH_FILE || undefined,
  modelsPath: null,
  allowModelNetwork: false
})

if (process.argv.includes('--list')) {
  const providers = runtime.getProviders()
    .filter((provider) => Boolean(provider.auth?.oauth || provider.auth?.apiKey?.login))
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      oauth: Boolean(provider.auth?.oauth),
      apiKey: Boolean(provider.auth?.apiKey?.login)
    }))
  process.stdout.write(JSON.stringify({ type: 'providers', providers }) + '\n')
  process.exit(0)
}

const provider = process.argv[2]
if (!provider) {
  process.stdout.write(JSON.stringify({ type: 'error', message: 'Provider is required.' }) + '\n')
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
const pending = new Map()
let sequence = 0

function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n')
}

function prompt(prompt) {
  const id = `prompt-${++sequence}`
  emit({ type: 'prompt', id, prompt })
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    if (prompt.signal) {
      prompt.signal.addEventListener('abort', () => {
        if (!pending.has(id)) return
        pending.delete(id)
        reject(new Error('Login prompt cancelled.'))
      }, { once: true })
    }
  })
}

rl.on('line', (line) => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.type !== 'response' || typeof message.id !== 'string') return
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.cancelled) entry.reject(new Error('Login cancelled.'))
  else entry.resolve(String(message.value ?? ''))
})

const interaction = {
  signal: new AbortController().signal,
  async prompt(value) {
    return prompt(value)
  },
  notify(event) {
    emit({ type: 'event', event })
  }
}

try {
  const credential = await runtime.login(provider, process.env.PI_AUTH_TYPE === 'api_key' ? 'api_key' : 'oauth', interaction, {
    getDeviceId: () => process.env.PI_DESKTOP_DEVICE_ID || 'pi-desktop'
  })
  emit({ type: 'done', credentialType: credential?.type ?? 'unknown' })
  process.exit(0)
} catch (error) {
  emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  process.exit(1)
}
