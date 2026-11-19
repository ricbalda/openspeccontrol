// Declaraciones de scripts/release-check-lib.mjs para sus pruebas (test/main/release-check.test.ts).

export declare const WINDOWS_CERT: string[]
export declare const WINDOWS_AZURE: string[]
export declare const MAC_CERT: string[]
export declare const NOTARIZE_API_KEY: string[]
export declare const NOTARIZE_APPLE_ID: string[]
export declare function checkSigningEnv(env: Record<string, string | undefined>): string[]
export declare function checkTagVersion(tag: string | undefined, version: string): string | null
