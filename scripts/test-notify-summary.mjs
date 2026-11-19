import assert from 'node:assert/strict'
import { cleanReplySummary, desktopNotifyCopy } from '../src/shared/notify-summary.ts'

const raw =
  '我已经把这份《AI产研周会2026》文档完整读了一遍 (wiki: KpJiwqF7XiwDArknjy4cQgcnAg，最近修改 21 分钟前)。下面是我继续梳理出的内容：第一点很重要。'

assert.equal(
  cleanReplySummary(raw),
  '我已经把这份《AI产研周会2026》文档完整读了一遍。'
)

assert.equal(
  cleanReplySummary('See https://example.com/docs and `code` then **bold** text here.'),
  'See and then bold text here.'
)

assert.equal(
  cleanReplySummary('```ts\nconst x = 1\n```\nDone with the change.'),
  'Done with the change.'
)

assert.equal(
  cleanReplySummary('Hash abcdef0123456789 and id KpJiwqF7XiwDArknjy4cQgcnAg gone.'),
  'Hash and id gone.'
)

{
  const summary = cleanReplySummary('Updated README.md and package.json for v1.2.3. Next we ship.')
  assert.ok(summary.includes('README.md'), summary)
  assert.notEqual(summary, 'Updated README.')
  assert.ok(!summary.includes('Next we ship'), summary)
}

{
  const summary = cleanReplySummary(
    'Here are recommendations for internationalization in the app.',
    80
  )
  assert.match(summary, /recommendations/)
  assert.match(summary, /internationalization/)
}

assert.equal(
  cleanReplySummary('Done for now. 下面继续说明其余细节。'),
  'Done for now.'
)

const long = '这是一句没有句号但非常非常非常非常非常非常非常非常非常非常非常非常长的摘要内容需要截断处理'
const clipped = cleanReplySummary(long, 40)
assert.ok([...clipped].length <= 41, clipped)
assert.ok(clipped.endsWith('…'), clipped)

const done = desktopNotifyCopy({
  kind: 'done',
  sessionTitle: 'AI产研周会',
  replyText: raw,
  language: 'zh-CN'
})
assert.equal(done.title, 'AI产研周会')
assert.equal(done.body, '已完成 · 我已经把这份《AI产研周会2026》文档完整读了一遍。')

const untitled = desktopNotifyCopy({ kind: 'done', sessionTitle: '', replyText: '短回复。', language: 'zh-CN' })
assert.equal(untitled.title, 'Pi')
assert.equal(untitled.body, '已完成 · 短回复。')

const approval = desktopNotifyCopy({ kind: 'approval', sessionTitle: '需要确认的会话', language: 'zh-CN' })
assert.equal(approval.title, '需要确认的会话')
assert.equal(approval.body, '需要你确认')

const error = desktopNotifyCopy({
  kind: 'error',
  sessionTitle: null,
  replyText: 'Network failed (request-id: abcdef0123456789deadbeef)',
  language: 'zh-CN'
})
assert.equal(error.title, 'Pi')
assert.match(error.body, /^出错了/)

const english = desktopNotifyCopy({ kind: 'done', sessionTitle: 'Weekly', replyText: 'All set.', language: 'en' })
assert.equal(english.body, 'Done · All set.')

console.log(
  JSON.stringify(
    {
      before: {
        title: 'pi 完成了',
        body: raw.slice(0, 100)
      },
      after: done
    },
    null,
    2
  )
)
console.log('notify-summary tests passed')
