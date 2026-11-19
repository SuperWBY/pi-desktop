export const DESKTOP_PERMISSION_TITLE = 'Computer Use: System Permissions'
type Kind = 'accessibility' | 'screen'
type Status = { accessibility: boolean; screenRecording: boolean }
type Context = { hasUI: boolean; ui: { select(title: string, options: string[]): Promise<string | undefined> } }
type Dependencies = { check(): Promise<Status>; openSettings(kind: Kind): Promise<void> }

export async function ensureDesktopPermissions(ctx: Context, deps: Dependencies): Promise<void> {
  for (;;) {
    const status = await deps.check()
    if (status.accessibility && status.screenRecording) return
    if (!ctx.hasUI) throw new Error('Computer Use needs macOS Accessibility and Screen Recording permission. Open Pi Desktop to finish setup.')
    const options = [
      ...(!status.accessibility ? ['Open Accessibility Settings'] : []),
      ...(!status.screenRecording ? ['Open Screen Recording Settings'] : []),
      'Check Again', 'Cancel'
    ]
    const choice = await ctx.ui.select(DESKTOP_PERMISSION_TITLE, options)
    if (!choice || choice === 'Cancel') throw new Error('Computer Use permission setup cancelled.')
    if (choice === 'Check Again') continue
    const kind = choice === 'Open Accessibility Settings' && !status.accessibility ? 'accessibility' : choice === 'Open Screen Recording Settings' && !status.screenRecording ? 'screen' : null
    if (!kind) throw new Error('Invalid Computer Use permission selection.')
    await deps.openSettings(kind)
  }
}
