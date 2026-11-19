// agentEnv (tarea 6.2): corporate shells often export only the lowercase proxy
// variables, while some HTTP clients read only the uppercase ones — the agent
// environment must mirror http_proxy/https_proxy/no_proxy upwards, without
// touching variables that were already there.

import { afterEach, describe, expect, it } from 'vitest'
import { agentEnv } from '../../src/main/core/acp/hub.ts'

const VARS = ['http_proxy', 'https_proxy', 'no_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']
const saved = VARS.map((k) => [k, process.env[k]] as const)

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('agentEnv mirrors the proxy variables (tarea 6.2)', () => {
  it('lowercase definitions reach the agent in both cases', () => {
    for (const k of VARS) delete process.env[k]
    process.env.http_proxy = 'http://proxy:80'
    process.env.https_proxy = 'http://proxy:443'
    process.env.no_proxy = 'localhost,.internal'
    const env = agentEnv()
    expect(env.http_proxy).toBe('http://proxy:80')
    expect(env.HTTP_PROXY).toBe('http://proxy:80') // mirrored
    expect(env.https_proxy).toBe('http://proxy:443')
    expect(env.HTTPS_PROXY).toBe('http://proxy:443')
    expect(env.no_proxy).toBe('localhost,.internal')
    expect(env.NO_PROXY).toBe('localhost,.internal')
  })

  it('an explicit uppercase value is never overwritten by the lowercase one', () => {
    for (const k of VARS) delete process.env[k]
    process.env.https_proxy = 'http://lower:1'
    process.env.HTTPS_PROXY = 'http://upper:2'
    const env = agentEnv()
    // on Windows both spellings share one case-insensitive env slot (the write
    // order above already made them equal); the mirror targets the case-sensitive
    // macOS/Linux worlds, so this is the cross-platform claim either way
    expect(env.HTTPS_PROXY).toBe('http://upper:2')
  })

  it('uppercase-only definitions stay as they are (no lowercase is invented)', () => {
    for (const k of VARS) delete process.env[k]
    process.env.HTTP_PROXY = 'http://proxy:80'
    const env = agentEnv()
    expect(env.HTTP_PROXY).toBe('http://proxy:80')
    expect(env.http_proxy).toBeUndefined()
  })

  it('the agent-specific extra variables win over the process ones', () => {
    process.env.OPENCODE_CONFIG = '/from-process'
    const env = agentEnv({ OPENCODE_CONFIG: '/from-agent' })
    expect(env.OPENCODE_CONFIG).toBe('/from-agent')
  })
})
