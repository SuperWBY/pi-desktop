import assert from 'node:assert/strict'
import { desktopNotifyCopy } from '../src/shared/notification-copy.ts'

assert.deepEqual(desktopNotifyCopy('done', 'zh-CN'), { title: 'Pi', body: '对话已完成' })
assert.equal(desktopNotifyCopy('approval').body, '需要你确认')
assert.equal(desktopNotifyCopy('error', 'zh-CN').body, '对话出错了')
assert.deepEqual(desktopNotifyCopy('done', 'en'), { title: 'Pi', body: 'Chat completed' })
assert.equal(desktopNotifyCopy('approval', 'en').body, 'Needs confirmation')
assert.equal(desktopNotifyCopy('error', 'en').body, 'Chat failed')

console.log('notification copy checks passed')
