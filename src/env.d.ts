/// <reference types="vite/client" />
import type { KdApi } from '@shared/types'

declare global {
  interface Window {
    api: KdApi
  }
}

export {}
