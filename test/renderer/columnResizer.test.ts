// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_MAX,
  AGENT_MIN,
  CENTER_MIN,
  RAIL_MAX,
  RAIL_MIN,
  clampAgentWidth,
  clampRailWidth,
  readAgentWidth,
  readRailWidth,
  resolveWidths,
  saveAgentWidth,
  saveRailWidth
} from '../../src/renderer/src/panes/ColumnResizer.tsx'

describe('chat width limits', () => {
  it('keeps the chat between its minimum and the room the document leaves', () => {
    expect(clampAgentWidth(100, 1440, 272)).toBe(AGENT_MIN)
    // 1440 - 272 - 480 = 688: a wide chat stops there, the document keeps 480px
    expect(clampAgentWidth(5000, 1440, 272)).toBe(1440 - 272 - CENTER_MIN)
    expect(clampAgentWidth(5000, 2560, 272)).toBe(AGENT_MAX)
    expect(clampAgentWidth(600, 1440, 272)).toBe(600)
  })

  it('never goes below the minimum, even in a narrow window', () => {
    expect(clampAgentWidth(600, 900, 210)).toBe(AGENT_MIN)
  })

  it('rounds to whole pixels', () => {
    expect(clampAgentWidth(412.6, 1440, 272)).toBe(413)
  })
})

describe('chat width memory', () => {
  beforeEach(() => localStorage.clear())

  it('remembers the width the user chose, and nothing when reset', () => {
    expect(readAgentWidth()).toBeNull()
    saveAgentWidth(620)
    expect(readAgentWidth()).toBe(620)
    saveAgentWidth(null)
    expect(readAgentWidth()).toBeNull()
  })

  it('ignores a stored value that is not a width', () => {
    localStorage.setItem('agent-width', 'wide')
    expect(readAgentWidth()).toBeNull()
    localStorage.setItem('agent-width', '-5')
    expect(readAgentWidth()).toBeNull()
  })
})

describe('rail width limits', () => {
  it('keeps the rail between its minimum and the room the chat and the document leave', () => {
    expect(clampRailWidth(50, 1440, 400)).toBe(RAIL_MIN)
    expect(clampRailWidth(5000, 1440, 400)).toBe(RAIL_MAX)
    // 1200 - 400 - 480 = 320: in a smaller window the document room wins over the maximum
    expect(clampRailWidth(5000, 1200, 400)).toBe(1200 - 400 - CENTER_MIN)
    expect(clampRailWidth(5000, 2560, 300)).toBe(RAIL_MAX)
    expect(clampRailWidth(320, 1440, 400)).toBe(320)
  })

  it('never goes below the minimum, even in a narrow window', () => {
    expect(clampRailWidth(320, 900, 300)).toBe(RAIL_MIN)
  })

  it('rounds to whole pixels', () => {
    expect(clampRailWidth(251.4, 1440, 400)).toBe(251)
  })
})

describe('rail width memory', () => {
  beforeEach(() => localStorage.clear())

  it('remembers the width the user chose, under its own key, and nothing when reset', () => {
    expect(readRailWidth()).toBeNull()
    saveRailWidth(300)
    expect(readRailWidth()).toBe(300)
    expect(localStorage.getItem('rail-width')).toBe('300')
    expect(readAgentWidth()).toBeNull()
    saveRailWidth(null)
    expect(readRailWidth()).toBeNull()
  })

  it('ignores a stored value that is not a width', () => {
    localStorage.setItem('rail-width', 'wide')
    expect(readRailWidth()).toBeNull()
    localStorage.setItem('rail-width', '0')
    expect(readRailWidth()).toBeNull()
  })

  it('survives a storage that throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readRailWidth()).toBeNull()
    expect(() => saveRailWidth(300)).not.toThrow()
    get.mockRestore()
    set.mockRestore()
  })
})

describe('rail and chat share the window', () => {
  const base = { prefRail: null, prefAgent: null, defRail: 272, defAgent: 400 }

  it('leaves the CSS defaults alone when the user chose nothing', () => {
    const r = resolveWidths({ ...base, viewport: 1440 })
    expect(r).toEqual({ rail: 272, agent: 400, railInline: false, agentInline: false })
  })

  it('applies the rail the user chose, and the chat keeps its width if there is room', () => {
    const r = resolveWidths({ ...base, viewport: 1600, prefRail: 360 })
    expect(r).toMatchObject({ rail: 360, agent: 400, railInline: true, agentInline: false })
  })

  it('narrows the chat, not the document, when the rail takes its room', () => {
    // 1100 - 480 (document) - 400 (rail) = 220 < AGENT_MIN: the chat floors at 300
    const r = resolveWidths({ ...base, viewport: 1100, prefRail: 400, prefAgent: 500 })
    expect(r.agent).toBe(AGENT_MIN)
    // and the rail then fits what is left: 1100 - 300 - 480 = 320
    expect(r.rail).toBe(320)
    expect(r.agentInline).toBe(true)
  })

  it('shrinks the chat first, then the rail, as the window narrows', () => {
    const at = (viewport: number) =>
      resolveWidths({ ...base, viewport, prefRail: 400, prefAgent: 500 })
    expect(at(1600)).toMatchObject({ rail: 400, agent: 500 })
    expect(at(1300)).toMatchObject({ rail: 400, agent: 420 })
    expect(at(1000)).toMatchObject({ rail: 220, agent: AGENT_MIN })
    expect(at(800)).toMatchObject({ rail: RAIL_MIN, agent: AGENT_MIN })
  })

  it('brings the chosen widths back when the window grows again', () => {
    const prefs = { ...base, prefRail: 400, prefAgent: 500 }
    expect(resolveWidths({ ...prefs, viewport: 1000 }).rail).toBeLessThan(400)
    expect(resolveWidths({ ...prefs, viewport: 1600 })).toMatchObject({ rail: 400, agent: 500 })
  })

  it('overrides a default chat that a wider rail would squeeze', () => {
    const r = resolveWidths({ ...base, viewport: 1000, prefRail: 300, defAgent: 400 })
    // 1000 - 300 (chat floor) - 480 = 220: the rail gives up what it cannot keep
    expect(r).toMatchObject({ rail: 220, agent: AGENT_MIN, agentInline: true })
  })

  it('clamps a stored rail that is out of range', () => {
    expect(resolveWidths({ ...base, viewport: 2560, prefRail: 9999 }).rail).toBe(RAIL_MAX)
    expect(resolveWidths({ ...base, viewport: 2560, prefRail: 20 }).rail).toBe(RAIL_MIN)
  })
})
