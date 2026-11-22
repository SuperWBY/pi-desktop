export type NotifyKind = 'done' | 'approval' | 'error'

const body = {
  'zh-CN': { done: '对话已完成', approval: '需要你确认', error: '对话出错了' },
  en: { done: 'Chat completed', approval: 'Needs confirmation', error: 'Chat failed' }
}

export function desktopNotifyCopy(kind: NotifyKind, language?: string | null): { title: string; body: string } {
  return { title: 'Pi', body: body[language === 'en' ? 'en' : 'zh-CN'][kind] }
}
