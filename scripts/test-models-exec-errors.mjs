import assert from 'node:assert/strict'
import { mapErrnoMessage, stripRemoteError, userFacingError } from '../src/shared/errors.ts'

assert.equal(
  mapErrnoMessage(stripRemoteError("Error invoking remote method 'models:list': Error: spawn EINVAL")),
  '无法启动内置运行时，请重试或改用 API Key'
)
assert.equal(mapErrnoMessage('spawn EINVAL'), '无法启动内置运行时，请重试或改用 API Key')
assert.equal(userFacingError(new Error('spawn ENOENT')), '找不到所需程序，请重试')
assert.equal(userFacingError(new Error('spawn EACCES')), '没有权限执行该操作')
assert.match(userFacingError(new Error('spawn EFOO')), /操作失败/)

console.log('models exec error checks passed')
