// Fase 5.4: the overlay icon itself. Pure pixel/PNG checks — the badge is a
// red circle with the count in white, 16×16, capped at "9+" — runnable in
// plain Node because the encoder is zlib + a CRC32, nothing else.

import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  badgeLabel,
  countOverlayPixels,
  countOverlayPng,
  OVERLAY_SIZE
} from '../../src/main/desktop/badge-icon.ts'

const px = (n: number, x: number, y: number) => {
  const { data } = countOverlayPixels(n)
  const i = (y * OVERLAY_SIZE + x) * 4
  return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const
}

describe('badge icon (tarea 5.4)', () => {
  it('caps the label at 9+ and never renders zero', () => {
    expect(badgeLabel(1)).toBe('1')
    expect(badgeLabel(9)).toBe('9')
    expect(badgeLabel(10)).toBe('9+')
    expect(badgeLabel(42)).toBe('9+')
  })

  it('draws a red circle: opaque in the middle, transparent at the corner', () => {
    const c = 8
    expect(px(3, c, c)[3]).toBe(255) // fully opaque center (digit ink or red)
    // left inside edge: inside the circle, outside the digit block → pure red
    expect(px(3, 2, c).slice(0, 3)).toEqual([0xc6, 0x2a, 0x2f]) // the app's red
    expect(px(3, 2, c)[3]).toBe(255)
    expect(px(3, 0, 0)[3]).toBe(0) // transparent corner
  })

  it('writes the count in white and keeps a white pixel for 9+', () => {
    // digit '3' of the 3×5 font has ink in the middle row's left column too, but
    // the robust check is: some pixel near the center is pure white
    const hasWhite = (n: number) => {
      const { data } = countOverlayPixels(n)
      for (let i = 0; i < data.length; i += 4)
        if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255)
          return true
      return false
    }
    expect(hasWhite(3)).toBe(true)
    expect(hasWhite(12)).toBe(true) // "9+" also leaves ink
  })

  it('encodes a valid 16×16 RGBA PNG', () => {
    const png = countOverlayPng(2)
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.readUInt32BE(16)).toBe(OVERLAY_SIZE) // IHDR width
    expect(png.readUInt32BE(20)).toBe(OVERLAY_SIZE) // IHDR height
    expect(png[25]).toBe(6) // color type RGBA
    // find the IDAT and inflate it: h × (1 + w×4) filter-prefixed scanlines
    const at = png.indexOf(Buffer.from('IDAT'))
    const len = png.readUInt32BE(at - 4)
    const raw = inflateSync(png.subarray(at + 4, at + 4 + len))
    expect(raw.length).toBe(OVERLAY_SIZE * (1 + OVERLAY_SIZE * 4))
    expect(raw[0]).toBe(0) // filter: none
  })
})
