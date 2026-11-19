// Declaraciones de scripts/dist-args.mjs para sus pruebas (test/main/dist-args.test.ts).

export declare const AZURE_SIGN_VARS: Record<
  'endpoint' | 'codeSigningAccountName' | 'certificateProfileName' | 'publisherName',
  string
>
export declare function targetsWindows(args: string[], platform?: string): boolean
export declare function azureSignOverrides(env: Record<string, string | undefined>): string[]
export declare function electronBuilderArgs(
  args: string[],
  env?: Record<string, string | undefined>,
  platform?: string
): string[]
