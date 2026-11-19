// Fase 8 (tarea 8.3): lógica pura de scripts/dist.mjs. Convierte las
// variables de entorno de firma en overrides de CLI para electron-builder,
// sin poner ningún secreto en el repositorio.
//
// Azure Trusted Signing necesita `win.azureSignOptions` en la configuración,
// pero electron-builder falla si el bloque existe sin credenciales (impide
// generar instaladores sin firma). Por eso no vive en electron-builder.yml:
// se inyecta como `-c.win.azureSignOptions.*` solo si AZURE_SIGN_* está
// completo. Las credenciales (AZURE_TENANT_ID, AZURE_CLIENT_ID y
// AZURE_CLIENT_SECRET) las lee electron-builder directamente del entorno.

/** Variables (no secretas) que describen la cuenta de Azure Trusted Signing. */
export const AZURE_SIGN_VARS = {
  endpoint: 'AZURE_SIGN_ENDPOINT',
  codeSigningAccountName: 'AZURE_SIGN_ACCOUNT',
  certificateProfileName: 'AZURE_SIGN_PROFILE',
  publisherName: 'AZURE_SIGN_PUBLISHER'
}

/** True si los argumentos piden un build de Windows (o no piden plataforma y el SO es Windows). */
export function targetsWindows(args, platform = process.platform) {
  if (args.includes('--win') || args.includes('-w')) return true
  const others = ['--mac', '-m', '--linux', '-l', '--dir']
  if (args.some((a) => others.includes(a))) return false
  return platform === 'win32'
}

/**
 * Overrides `-c.win.azureSignOptions.*`. Devuelve [] si falta alguna variable
 * (firma por certificado vía CSC_LINK, o sin firma).
 */
export function azureSignOverrides(env) {
  const entries = Object.entries(AZURE_SIGN_VARS).map(([key, name]) => [key, env[name]])
  if (entries.some(([, value]) => !value)) return []
  return entries.map(([key, value]) => `-c.win.azureSignOptions.${key}=${value}`)
}

/** Argumentos finales de electron-builder para los de `npm run dist:*`. */
export function electronBuilderArgs(args, env = process.env, platform = process.platform) {
  const sign = targetsWindows(args, platform) ? azureSignOverrides(env) : []
  return [...args, ...sign]
}
