// Fase 10 (tarea 10.3): la puerta previa del release (scripts/release-check-lib.mjs)
// exige la etiqueta == versión y todos los secretos de firma y notarización; sin
// ellos el release falla antes de construir ("Faltan secretos de firma").

import { describe, expect, it } from 'vitest'
import {
  checkSigningEnv,
  checkTagVersion,
  MAC_CERT,
  NOTARIZE_API_KEY,
  NOTARIZE_APPLE_ID,
  WINDOWS_AZURE,
  WINDOWS_CERT
} from '../../scripts/release-check-lib.mjs'

const fill = (...groups: string[][]): Record<string, string> =>
  Object.fromEntries(groups.flat().map((n) => [n, 'valor']))

describe('checkSigningEnv', () => {
  it('falla si no hay ningún secreto y lo dice para Windows y macOS', () => {
    const problems = checkSigningEnv({})
    expect(problems).toHaveLength(3)
    expect(problems.join('\n')).toMatch(/Windows sin firma/)
    expect(problems.join('\n')).toMatch(/macOS sin identidad/)
    expect(problems.join('\n')).toMatch(/sin notarización/)
  })

  it('pasa con certificado de Windows + macOS con clave de API', () => {
    expect(checkSigningEnv(fill(WINDOWS_CERT, MAC_CERT, NOTARIZE_API_KEY))).toEqual([])
  })

  it('pasa con Azure Trusted Signing + macOS con Apple ID', () => {
    expect(checkSigningEnv(fill(WINDOWS_AZURE, MAC_CERT, NOTARIZE_APPLE_ID))).toEqual([])
  })

  it('falla si Azure está incompleto (falta una variable AZURE_SIGN_*)', () => {
    const env = fill(WINDOWS_AZURE, MAC_CERT, NOTARIZE_API_KEY)
    delete (env as Record<string, string | undefined>).AZURE_SIGN_PUBLISHER
    const problems = checkSigningEnv(env)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/AZURE_SIGN_PUBLISHER/)
  })

  it('falla si falta la notarización o la identidad de macOS', () => {
    expect(checkSigningEnv(fill(WINDOWS_CERT, MAC_CERT))[0]).toMatch(/sin notarización/)
    expect(checkSigningEnv(fill(WINDOWS_CERT, NOTARIZE_API_KEY))[0]).toMatch(/Developer ID/)
  })

  it('no incluye valores de secretos en los mensajes, solo nombres', () => {
    const env = { ...fill(WINDOWS_CERT), CSC_LINK: 'SECRETO-NO-FILTRAR' }
    expect(checkSigningEnv(env).join('\n')).not.toContain('SECRETO-NO-FILTRAR')
  })

  it('una variable vacía cuenta como ausente', () => {
    const env = { ...fill(WINDOWS_CERT, MAC_CERT, NOTARIZE_API_KEY), WIN_CSC_LINK: '' }
    expect(checkSigningEnv(env)[0]).toMatch(/WIN_CSC_LINK/)
  })
})

describe('checkTagVersion', () => {
  it('acepta v<versión>', () => {
    expect(checkTagVersion('v0.1.0', '0.1.0')).toBeNull()
    expect(checkTagVersion('v1.2.0-beta.1', '1.2.0-beta.1')).toBeNull()
  })

  it('rechaza etiquetas que no coinciden con la versión', () => {
    expect(checkTagVersion('v0.2.0', '0.1.0')).toMatch(/no coincide/)
  })

  it('rechaza etiquetas mal formadas o vacías', () => {
    expect(checkTagVersion('0.1.0', '0.1.0')).toMatch(/forma/)
    expect(checkTagVersion('vnext', '0.1.0')).toMatch(/forma/)
    expect(checkTagVersion(undefined, '0.1.0')).toMatch(/forma/)
  })
})
