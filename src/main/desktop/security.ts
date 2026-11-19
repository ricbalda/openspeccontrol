// Electron hardening (Fase 7): the fixed webPreferences every window of the
// app is created with, deny-by-default permission handlers for the session
// (only clipboard-sanitized-write passes, what a copy button needs), and the
// window-level blocks: no <webview>, no window.open, no navigation away from
// the page we loaded. Everything is injected (session/webContents come as
// arguments), so the module has no runtime dependency on electron and the
// rules are unit-testable in plain Node.

/** The slice of BrowserWindowConstructorOptions['webPreferences'] we fix. */
export interface SecureWebPreferences {
  contextIsolation: boolean
  sandbox: boolean
  nodeIntegration: boolean
  webSecurity: boolean
  spellcheck: boolean
  navigateOnDragDrop: boolean
}

/**
 * The one set of webPreferences the app is allowed to create windows with
 * (tarea 7.1): isolated, sandboxed, no Node in the renderer, web security on,
 * no spellcheck service, and dropping a file inside the page never navigates.
 * Spread it into the BrowserWindow constructor and add only `preload`.
 */
export const secureWebPreferences: SecureWebPreferences = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: false,
  navigateOnDragDrop: false
})

/** The only permission a page of this app may ever be granted. */
export const ALLOWED_PERMISSION = 'clipboard-sanitized-write'

/** True for the one allowed permission; false for everything else, known or not. */
export function permissionAllowed(permission: string): boolean {
  return permission === ALLOWED_PERMISSION
}

/** The slice of Electron's Session the permission hardening needs. */
export interface SessionRef {
  setPermissionRequestHandler(
    handler:
      | ((
          webContents: unknown,
          permission: string,
          callback: (permissionGranted: boolean) => void
        ) => void)
      | null
  ): void
  setPermissionCheckHandler(
    handler:
      | ((webContents: unknown, permission: string, requestingOrigin: string) => boolean)
      | null
  ): void
}

/**
 * Deny every permission request and permission check of the session except
 * clipboard-sanitized-write (tarea 7.3). Notifications come from the main
 * process (Fase 5), media/geolocation/… are never features of this app, so
 * anything asking for them is a prompt to refuse, not to grant.
 */
export function applySessionSecurity(session: SessionRef): void {
  session.setPermissionRequestHandler((_wc, permission, callback) => {
    const granted = permissionAllowed(permission)
    if (!granted) console.warn(`[security] permission request denied: ${permission}`)
    callback(granted)
  })
  session.setPermissionCheckHandler((_wc, permission) => permissionAllowed(permission))
}

/** The slice of a WebContents the navigation/window hardening needs. */
export interface WindowContentsRef {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(
    event: 'will-attach-webview',
    listener: (event: { preventDefault(): void }, webPreferences: unknown, params: unknown) => void
  ): void
  on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): void
}

/**
 * Block the three ways page content could escape its window (tarea 7.3):
 * <webview> tags never attach, window.open/rel=noopener targets are denied,
 * and an in-page navigation (a stray link) never leaves the app page. The
 * renderer is a single document; anything else is unexpected and refused.
 */
export function applyWindowSecurity(contents: WindowContentsRef): void {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
    console.warn('[security] blocked will-attach-webview')
  })
  contents.setWindowOpenHandler(() => {
    console.warn('[security] blocked window.open')
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    event.preventDefault()
    console.warn(`[security] blocked navigation to ${url}`)
  })
}
