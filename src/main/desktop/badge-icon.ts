// Fase 5.4: the Windows taskbar overlay icon. Electron takes a NativeImage, so
// the pending-decisions badge is drawn here from scratch: a red circle (the
// app's --bad red) with the count in white, rendered 4× and box-downsampled to
// a crisp 16×16, then encoded as a PNG in pure Node (zlib + a CRC32). No
// canvas, no native deps, fully testable outside Electron.

import { deflateSync } from 'node:zlib'

/** Overlay icons are shown at the taskbar's small icon size. */
export const OVERLAY_SIZE = 16
/** Supersampling factor: draw at 64×64, average each 4×4 block down to 16. */
const SS = 4
const BIG = OVERLAY_SIZE * SS

// the app's error red (index.css --bad, light theme); fixed on purpose: the
// overlay sits on the OS taskbar, not inside the themed window
const RED: [number, number, number] = [0xc6, 0x2a, 0x2f]
const WHITE: [number, number, number] = [0xff, 0xff, 0xff]

/** 3×5 pixel font: the digits 0-9 and the "+" of the "9+" cap. */
const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '011', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000']
}

/** The label a badge shows: the count itself, capped at "9+". */
export const badgeLabel = (n: number): string =>
  n >= 10 ? '9+' : String(Math.max(1, Math.min(9, n)))

/** Draw the supersampled RGBA bitmap (BIG×BIG) for the label of `n`. */
function drawBig(n: number): Float32Array {
  const px = new Float32Array(BIG * BIG * 4) // r,g,b,a floats; a in [0,1]
  const cx = BIG / 2,
    cy = BIG / 2,
    R = BIG / 2 - 2
  // the text: each font pixel becomes a SS×SS block… scaled up a bit more so
  // the glyph fills the circle (3×5 font → 5 rows tall is too tiny at 64px)
  const label = badgeLabel(n)
  const g = 9 // font-pixel size: 5 rows * 9 = 45px tall inside the 60px circle
  // every glyph is 3 font-px wide plus a 1 font-px gap; the label is that
  // sequence without the trailing gap
  const cols = label.length * 4 - 1
  const x0 = Math.round(cx - (cols * g) / 2),
    y0 = Math.round(cy - (5 * g) / 2)
  for (let y = 0; y < BIG; y++) {
    for (let x = 0; x < BIG; x++) {
      const i = (y * BIG + x) * 4
      // circle coverage with a 1px anti-aliased edge
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const cov = Math.max(0, Math.min(1, R + 0.5 - dist))
      if (cov <= 0) continue
      px[i] = RED[0]
      px[i + 1] = RED[1]
      px[i + 2] = RED[2]
      px[i + 3] = cov
      // the label, in solid white: font column 3 mod 4 is the glyph gap
      const fc = Math.floor((x - x0) / g),
        fr = Math.floor((y - y0) / g)
      if (fc >= 0 && fc < cols && fr >= 0 && fr < 5 && fc % 4 !== 3) {
        const glyph = FONT[label[Math.floor(fc / 4)]]
        if (glyph[fr][fc % 4] === '1') {
          px[i] = WHITE[0]
          px[i + 1] = WHITE[1]
          px[i + 2] = WHITE[2]
        }
      }
    }
  }
  return px
}

/** The 16×16 RGBA bitmap of the badge for `n` pending decisions. */
export function countOverlayPixels(n: number): { width: number; height: number; data: Uint8Array } {
  const big = drawBig(n)
  const out = new Uint8Array(OVERLAY_SIZE * OVERLAY_SIZE * 4)
  for (let y = 0; y < OVERLAY_SIZE; y++) {
    for (let x = 0; x < OVERLAY_SIZE; x++) {
      // average the SS×SS block, weighting color by alpha (so the soft edge
      // doesn't bleed red into transparent pixels)
      let r = 0,
        g = 0,
        b = 0,
        a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * BIG + (x * SS + sx)) * 4
          const al = big[i + 3]
          r += big[i] * al
          g += big[i + 1] * al
          b += big[i + 2] * al
          a += al
        }
      }
      const o = (y * OVERLAY_SIZE + x) * 4
      if (a > 0) {
        out[o] = Math.round(r / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(b / a)
      }
      out[o + 3] = Math.round((a / (SS * SS)) * 255)
    }
  }
  return { width: OVERLAY_SIZE, height: OVERLAY_SIZE, data: out }
}

// ---- minimal PNG encoder (RGBA, 8-bit, no filters) --------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  out.set(data, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** The badge for `n` as a PNG Buffer, ready for nativeImage.createFromBuffer. */
export function countOverlayPng(n: number): Buffer {
  const { width, height, data } = countOverlayPixels(n)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0 // filter: none
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (1 + width * 4) + 1
    )
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0))
  ])
}
