// Transport-agnostic errors: the IPC layer (Fase 3) maps each code to an
// envelope { ok: false, error: { code, message } }. They replace the HTTP
// statuses Studio answered with (400/404/409/413/500).

export type OscErrorCode = 'invalid' | 'not_found' | 'conflict' | 'too_large' | 'internal'

export class OscError extends Error {
  constructor(
    readonly code: OscErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'OscError'
  }
}
