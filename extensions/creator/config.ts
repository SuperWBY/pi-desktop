function positive(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), maximum) : fallback
}
export const CREATOR_LIMITS = {
  parentWatchMs: positive('PI_CREATOR_PARENT_WATCH_MS', 500, 10_000),
  children: positive('PI_CREATOR_CHILDREN', 3, 8),
  killMs: positive('PI_CREATOR_KILL_MS', 1000, 10_000),
  commandMs: positive('PI_CREATOR_COMMAND_MS', 120_000, 600_000),
  fileBytes: positive('PI_CREATOR_FILE_BYTES', 1024 * 1024, 8 * 1024 * 1024),
  packageBytes: positive('PI_CREATOR_PACKAGE_BYTES', 8 * 1024 * 1024, 32 * 1024 * 1024),
  files: positive('PI_CREATOR_FILE_COUNT', 256, 2048),
  testMs: positive('PI_CREATOR_TEST_MS', 20_000, 120_000),
  agentMs: positive('PI_CREATOR_SUBAGENT_MS', 120_000, 600_000),
  outputBytes: positive('PI_CREATOR_OUTPUT_BYTES', 512 * 1024, 4 * 1024 * 1024)
}
export const isolatedPiArgs = ['--no-session', '--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files']
