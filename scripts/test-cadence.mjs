import { nextRun, nextRuns, validateCron } from '../src/main/schedule-cadence.ts'
import { buildLaunchAgentPlist } from '../src/main/launch-agent.ts'

const failures = []
let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function local(ts, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(ts))
}

check(
  'daily 09:00 Asia/Shanghai',
  local(nextRun({ type: 'daily', time: '09:00' }, Date.UTC(2026, 0, 1, 0, 0), 'Asia/Shanghai'), 'Asia/Shanghai') ===
    '2026-01-01, 09:00'
)

check(
  'weekdays skip weekend',
  local(nextRun({ type: 'cron', expression: '0 9 * * 1-5' }, Date.UTC(2026, 0, 2, 12, 0), 'Asia/Shanghai'), 'Asia/Shanghai') ===
    '2026-01-05, 09:00'
)

check(
  'DST spring-forward skips nonexistent 02:30',
  local(nextRun({ type: 'cron', expression: '30 2 * * *' }, Date.UTC(2026, 2, 7, 12, 0), 'America/New_York'), 'America/New_York') ===
    '2026-03-09, 02:30'
)

check(
  'DST fall-back keeps local 01:30',
  local(nextRun({ type: 'cron', expression: '30 1 * * *' }, Date.UTC(2026, 10, 1, 0, 0), 'America/New_York'), 'America/New_York') ===
    '2026-11-01, 01:30'
)

const everyQuarter = nextRuns({ type: 'cron', expression: '*/15 * * * *' }, 3, Date.UTC(2026, 0, 1, 0, 0), 'UTC')
check('cron */15', everyQuarter.map((ts) => new Date(ts).toISOString()).join(',') ===
  '2026-01-01T00:15:00.000Z,2026-01-01T00:30:00.000Z,2026-01-01T00:45:00.000Z')

check('invalid cron is reported', Boolean(validateCron('bad cron')), validateCron('bad cron'))
check('@daily alias', validateCron('@daily') === null)
check('event cadence has no next run', nextRun({ type: 'event', event: 'file-change', path: '/tmp', debounceMs: 800 }) === null)

const plist = buildLaunchAgentPlist(
  ['/Applications/Pi Desktop.app/Contents/MacOS/Pi Desktop', '--scheduler-run-due'],
  '/Users/me/Library/Logs/Pi Desktop/scheduler.log'
)
check(
  'LaunchAgent plist 参数与间隔',
  plist.includes('<string>/Applications/Pi Desktop.app/Contents/MacOS/Pi Desktop</string>') &&
    plist.includes('<integer>60</integer>') &&
    plist.includes('<key>RunAtLoad</key>') &&
    plist.includes('scheduler.log')
)

if (failures.length) {
  console.error(`\n${failures.length} cadence check(s) failed`)
  process.exit(1)
}
console.log(`\n${checks}/${checks} cadence checks passed`)
