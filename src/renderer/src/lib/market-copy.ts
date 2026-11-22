export function packageError(t: (text: string) => string, message = ''): string {
  if (/timeout|timed out|aborted|超时/i.test(message)) return t('连接插件源超时，请重试。')
  const http = /HTTP (\d{3})/.exec(message)
  if (http) return t('读取插件信息失败（HTTP {code}）。').replace('{code}', http[1])
  const exit = /Pi 意外停止了（代码 (.*?)）/.exec(message)
  if (exit) return t('Pi 操作未完成（代码 {code}）。').replace('{code}', exit[1])
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(message)) return t('无法连接插件源，请检查网络后重试。')
  if (/Unexpected token|JSON/i.test(message)) return t('插件信息格式不正确，请稍后重试。')
  return t(message || '操作未完成，请重试。')
}
