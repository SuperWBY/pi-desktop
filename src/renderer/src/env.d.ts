import type { PiDesktopApi } from '@shared/api'

declare global {
  interface Window {
    pi: PiDesktopApi
  }
}

export {}
