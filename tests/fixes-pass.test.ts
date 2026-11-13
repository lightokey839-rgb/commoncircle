import { afterEach, describe, expect, it } from 'vitest'
import { checkCardSvg, imageSize, MAX_SIDE } from '../web/card-safety'
import { endpointsFor, isRetryable, resetRpcState, rpcPost, rpcHealth, TESTNET_RPCS } from '../web/rpc'

/** A PNG signature + IHDR declaring width x height (no pixel data needed to read the size). */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, width)
  new DataView(b.buffer).setUint32(20, height)
  b[24] = 8; b[25] = 6
  return b
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const svgWith = (mime: string, bytes: Uint8Array) => `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:${mime};base64,${b64(bytes)}"/></svg>`

describe('card image guard (red-team finding 1, frontend side)', () => {
  it('reads PNG and GIF sizes', () => {
    expect(imageSize(pngHeader(128, 96))).toEqual({ width: 128, height: 96 })
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x80, 0x00, 0x40, 0x00])
    expect(imageSize(gif)).toEqual({ width: 128, height: 64 })
  })

  it('reads a JPEG SOF0 size', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x60, 0x00, 0x80, 0x03, 0, 0, 0, 0])
    expect(imageSize(jpeg)).toEqual({ width: 128, height: 96 })
  })

  it('refuses the 30000 x 30000 PNG from rt_png_with_huge_declared_dimensions_is_accepted_known_issue', () => {
    const r = checkCardSvg(svgWith('image/png', pngHeader(30000, 30000)))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('30000 × 30000')
  })

  it('passes a normal 128 px emblem and a card with no emblem', () => {
    expect(checkCardSvg(svgWith('image/png', pngHeader(128, 128))).ok).toBe(true)
    expect(checkCardSvg(svgWith('image/png', pngHeader(MAX_SIDE, MAX_SIDE))).ok).toBe(true)
    expect(checkCardSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>').ok).toBe(true)
  })

  it('fails closed on an emblem it cannot read', () => {
    expect(checkCardSvg(svgWith('image/webp', new Uint8Array([1, 2, 3, 4]))).ok).toBe(false)
  })
})

describe('RPC fallback (bug 6)', () => {
  afterEach(() => resetRpcState())

  it('tries the configured endpoint, then the other verified testnet endpoints; a custom RPC never wanders', () => {
    expect(endpointsFor(TESTNET_RPCS[0])).toEqual([...TESTNET_RPCS])
    expect(endpointsFor('https://rpc.invalid')).toEqual(['https://rpc.invalid'])
  })

  it('retries outages, not answers', () => {
    expect(isRetryable(503, undefined)).toBe(true)
    expect(isRetryable(429, undefined)).toBe(true)
    expect(isRetryable(200, { name: 'HANDLER_ERROR', cause: { name: 'TIMEOUT_ERROR' } })).toBe(true)
    expect(isRetryable(200, { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT' } })).toBe(false)
    expect(isRetryable(200, undefined)).toBe(false)
  })

  it('falls back to the next endpoint when the first is down, then sticks to the one that answered', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(url)
      if (url === TESTNET_RPCS[0]) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({ result: { result: [123] } }), { status: 200 })
    }) as unknown as typeof fetch
    const first = await rpcPost(TESTNET_RPCS[0], {}, { fetchImpl, delays: [0] })
    expect(first.payload).toEqual({ result: { result: [123] } })
    expect(calls).toEqual([TESTNET_RPCS[0], TESTNET_RPCS[1]])
    expect(rpcHealth()).toMatchObject({ ok: true, endpoint: TESTNET_RPCS[1] })
    calls.length = 0
    await rpcPost(TESTNET_RPCS[0], {}, { fetchImpl, delays: [0] })
    expect(calls).toEqual([TESTNET_RPCS[1]])
  })

  it('backs off and retries whole rounds, then reports the outage', async () => {
    let n = 0
    const fetchImpl = (async () => { n++; return new Response('{}', { status: 503 }) }) as unknown as typeof fetch
    await expect(rpcPost(TESTNET_RPCS[0], {}, { fetchImpl, delays: [0, 1, 1] })).rejects.toThrow(/NEAR RPC view failed/)
    expect(n).toBe(3 * TESTNET_RPCS.length)
    expect(rpcHealth().ok).toBe(false)
  })
})
