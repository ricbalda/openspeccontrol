// window.osc: the whole preload surface (Fase 3). It replaces the
// window.electron / window.api declarations of the electron-vite template.
import type { OscApi } from '@shared/ipc.ts'

declare global {
  interface Window {
    osc: OscApi
  }
}

export {}
