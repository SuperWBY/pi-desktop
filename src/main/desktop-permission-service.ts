export type DesktopPermissionKind = 'accessibility' | 'screen'
export type DesktopPermissionStatus = { accessibility: boolean; screenRecording: boolean }

export function createDesktopPermissionService(deps: {
  run(command: string): Promise<Record<string, unknown>>
  open(kind: DesktopPermissionKind): Promise<void>
}): { check(): Promise<DesktopPermissionStatus>; request(kind: DesktopPermissionKind): Promise<DesktopPermissionStatus> } {
  const check = async (): Promise<DesktopPermissionStatus> => {
    const result = await deps.run('check')
    return { accessibility: result.accessibility === true, screenRecording: result.screenRecording === true }
  }
  return {
    check,
    async request(kind) {
      if (kind !== 'accessibility' && kind !== 'screen') throw new Error('Invalid permission type.')
      const status = await check()
      if ((kind === 'accessibility' && !status.accessibility) || (kind === 'screen' && !status.screenRecording)) {
        await deps.open(kind)
        return check()
      }
      return status
    }
  }
}
