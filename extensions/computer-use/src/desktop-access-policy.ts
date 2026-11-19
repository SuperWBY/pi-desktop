import { readFileSync } from 'node:fs'

export function assertDesktopUseEnabled(settingsFile: string | undefined = process.env.PI_DESKTOP_SETTINGS_FILE): void {
  // This setting belongs to Pi Desktop; a standalone Pi session has its own configuration.
  if (!settingsFile) return
  let enabled = false
  try { enabled = JSON.parse(readFileSync(settingsFile, 'utf8')).computerUseEnabled === true } catch { /* Fail closed. */ }
  if (!enabled) throw new Error('Computer Use is disabled. Enable desktop access in Pi Desktop settings before continuing.')
}

const desktopTools = new Set(['computer_use_apps', 'computer_use_observe', 'computer_use_act', 'computer_use_batch', 'computer_use_desktop_reconcile'])
export function desktopToolBlockReason(toolName: string, settingsFile?: string): string | undefined {
  if (!desktopTools.has(toolName)) return undefined
  try { assertDesktopUseEnabled(settingsFile) } catch (error) { return error instanceof Error ? error.message : String(error) }
  return undefined
}
