// Fase 5.6: keep the OS chrome (title bar, menus) on the theme the user picked
// in-app. nativeTheme.themeSource also pins 'system' explicitly, so switching
// back follows the OS again.

import { nativeTheme } from 'electron'
import type { NativeThemeSetting } from '@shared/ipc.ts'

/** Mirror the renderer's theme choice onto nativeTheme.themeSource. */
export function applyNativeTheme(t: NativeThemeSetting): void {
  nativeTheme.themeSource = t
}
