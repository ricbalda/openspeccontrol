// Declaraciones de scripts/ci-smoke-lib.mjs para sus pruebas (test/main/ci-smoke.test.ts).

export declare const ROOT_PROBE: string
export declare function pickPageTarget<T extends { type?: string; url?: string }>(
  targets: T[] | unknown
): T | null
export declare function describeConsoleError(msg: {
  method?: string
  params?: Record<string, unknown>
}): string | null
export declare function smokeVerdict(input: {
  probe: { present: boolean; children: number } | null
  errors?: string[]
}): { ok: boolean; problems: string[] }
