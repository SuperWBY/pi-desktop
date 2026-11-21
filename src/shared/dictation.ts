export type DictationLocale = 'zh-CN' | 'en-US'
export type DictationPermission = 'microphone' | 'speech'
export type DictationSettingsTarget = DictationPermission | 'language'
export type DictationError = DictationPermission | 'language-unavailable' | 'unavailable' | 'busy' | 'no-speech' | 'failed' | 'timeout'

export type DictationEvent =
  | { type: 'recording' | 'transcribing' }
  | { type: 'level'; level: number }
  | { type: 'result'; text: string }
  | { type: 'error'; error: DictationError }

export interface DictationApi {
  available(): Promise<boolean>
  start(id: string, locale: DictationLocale): Promise<void>
  stop(id: string): Promise<void>
  cancel(id: string): Promise<void>
  openSettings(target: DictationSettingsTarget): Promise<void>
  onEvent(callback: (event: DictationEvent & { id: string }) => void): () => void
}
