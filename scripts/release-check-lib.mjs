// Fase 10 (tarea 10.3): comprobaciones previas del workflow de release
// (.github/workflows/release.yml), en lógica pura para poder probarlas.
//
//  · la etiqueta del release coincide con la versión de package.json;
//  · están los secretos de firma de Windows y macOS y los de notarización,
//    de modo que el release falla ANTES de construir y no deja artefactos
//    sin firmar (capacidad desktop-distribution, "Faltan secretos de firma").
//
// Solo se comprueba que las variables existan: nunca se imprime su valor.

/** Windows, vía A: certificado .pfx (en base64) y su contraseña. */
export const WINDOWS_CERT = ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']
/** Windows, vía B: Azure Trusted Signing (credenciales + datos de la cuenta). */
export const WINDOWS_AZURE = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_SIGN_ENDPOINT',
  'AZURE_SIGN_ACCOUNT',
  'AZURE_SIGN_PROFILE',
  'AZURE_SIGN_PUBLISHER'
]
/** macOS: identidad Developer ID (.p12 en base64) y su contraseña. */
export const MAC_CERT = ['CSC_LINK', 'CSC_KEY_PASSWORD']
/** Notarización, vía A: clave de la API de App Store Connect. */
export const NOTARIZE_API_KEY = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
/** Notarización, vía B: Apple ID con contraseña específica de aplicación. */
export const NOTARIZE_APPLE_ID = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']

const missing = (env, names) => names.filter((n) => !env[n])

/**
 * ¿Hay credenciales de firma suficientes? Devuelve los problemas encontrados
 * (lista vacía = todo en orden). Windows necesita UNA de sus dos vías; macOS
 * necesita el certificado Y una de las dos vías de notarización.
 */
export function checkSigningEnv(env) {
  const problems = []

  const winCert = missing(env, WINDOWS_CERT)
  const winAzure = missing(env, WINDOWS_AZURE)
  if (winCert.length > 0 && winAzure.length > 0) {
    problems.push(
      'Windows sin firma: configura el certificado ' +
        `(${WINDOWS_CERT.join(' + ')}) o Azure Trusted Signing ` +
        `(${WINDOWS_AZURE.join(', ')}). Faltan: ${winCert.join(', ')} / ${winAzure.join(', ')}`
    )
  }

  const macCert = missing(env, MAC_CERT)
  if (macCert.length > 0) {
    problems.push(`macOS sin identidad Developer ID. Faltan: ${macCert.join(', ')}`)
  }
  const notaryKey = missing(env, NOTARIZE_API_KEY)
  const notaryId = missing(env, NOTARIZE_APPLE_ID)
  if (notaryKey.length > 0 && notaryId.length > 0) {
    problems.push(
      'macOS sin notarización: configura la clave de API ' +
        `(${NOTARIZE_API_KEY.join(' + ')}) o el Apple ID ` +
        `(${NOTARIZE_APPLE_ID.join(' + ')}). Faltan: ${notaryKey.join(', ')} / ${notaryId.join(', ')}`
    )
  }
  return problems
}

const TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

/** La etiqueta debe ser `v<versión de package.json>`. Devuelve el problema o null. */
export function checkTagVersion(tag, version) {
  if (!tag || !TAG.test(tag)) {
    return `la etiqueta "${tag ?? ''}" no tiene la forma v<major>.<minor>.<patch>[-prerelease]`
  }
  if (tag !== `v${version}`) {
    return `la etiqueta ${tag} no coincide con la versión de package.json (${version}): sube la versión antes de etiquetar`
  }
  return null
}
