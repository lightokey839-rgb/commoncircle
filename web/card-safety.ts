// Red-team finding 1: the contract checks an emblem's size (12 KiB) and magic bytes but
// not its pixel dimensions, so a tiny PNG can declare 30000 x 30000 pixels and make a
// viewer decode gigabytes. The contract is frozen, so this app refuses to render a card
// whose embedded images declare more than MAX_SIDE pixels on a side. Wallets and other
// explorers are not protected by this; see docs/VERIFICATION.md.

export const MAX_SIDE = 1024

function decodeBase64(b64: string): Uint8Array {
  const raw = atob(b64.replace(/\s+/g, ''))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3])

/** Declared width and height of a PNG, GIF, JPEG or WebP, or null when it cannot be read. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: u32be(b, 16), height: u32be(b, 20) }
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: u16le(b, 6), height: u16le(b, 8) }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const marker = b[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = u16be(b, i + 2)
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: u16be(b, i + 5), width: u16be(b, i + 7) }
      }
      i += 2 + len
    }
    return null
  }
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (chunk === 'VP8X') return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
    if (chunk === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }
  return null
}

/**
 * The card SVG if every embedded raster image is a readable size no larger than
 * MAX_SIDE on a side, else null with a reason. SVG cards with no embedded images pass.
 */
export function checkCardSvg(svg: string): { ok: true } | { ok: false; reason: string } {
  const images = svg.matchAll(/data:image\/(png|gif|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)/g)
  for (const match of images) {
    let size: { width: number; height: number } | null = null
    try { size = imageSize(decodeBase64(match[2])) } catch { size = null }
    if (!size) return { ok: false, reason: `its ${match[1].toUpperCase()} emblem could not be read safely` }
    if (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width < 1 || size.height < 1) {
      return { ok: false, reason: `its emblem declares ${size.width} × ${size.height} pixels (limit ${MAX_SIDE})` }
    }
  }
  return { ok: true }
}
