import { describe, expect, it, vi } from 'vitest'
import { ChallengeStore, FixedWindowLimiter, MAX_BODY_BYTES, readJsonBody } from '../server/limits'
import { ChatService, pruneAccess } from '../server/chat'

describe('sign-in challenge store', () => {
  it('serves a live challenge until it is consumed, then never again', () => {
    const store = new ChallengeStore<{ expiresAt: number }>(10, () => 1000)
    expect(store.add('a', { expiresAt: 2000 })).toBe(true)
    expect(store.get('a')).toEqual({ expiresAt: 2000 })
    store.delete('a')
    expect(store.get('a')).toBeNull()
    expect(store.size).toBe(0)
  })

  it('deletes expired challenges on lookup and sweeps them on every add', () => {
    let now = 1000
    const store = new ChallengeStore<{ expiresAt: number }>(10, () => now)
    store.add('a', { expiresAt: 1500 })
    store.add('b', { expiresAt: 1500 })
    store.add('c', { expiresAt: 5000 })
    now = 1500
    expect(store.get('a')).toBeNull()
    expect(store.size).toBe(2)
    store.add('d', { expiresAt: 5000 })
    expect(store.size).toBe(2) // b swept, c and d live
  })

  it('refuses new challenges when full of live ones, and accepts again once they expire', () => {
    let now = 1000
    const store = new ChallengeStore<{ expiresAt: number }>(3, () => now)
    for (const key of ['a', 'b', 'c']) expect(store.add(key, { expiresAt: 2000 })).toBe(true)
    expect(store.add('d', { expiresAt: 2000 })).toBe(false)
    expect(store.size).toBe(3)
    now = 2000
    expect(store.add('d', { expiresAt: 3000 })).toBe(true)
    expect(store.size).toBe(1)
  })
})

describe('per-IP fixed-window limiter', () => {
  it('allows `limit` calls per key per window, then resets', () => {
    let now = 0
    const limiter = new FixedWindowLimiter({ limit: 2, windowMs: 60_000, now: () => now })
    expect(limiter.allow('1.1.1.1')).toBe(true)
    expect(limiter.allow('1.1.1.1')).toBe(true)
    expect(limiter.allow('1.1.1.1')).toBe(false)
    expect(limiter.allow('2.2.2.2')).toBe(true)
    now = 60_000
    expect(limiter.allow('1.1.1.1')).toBe(true)
  })

  it('bounds the number of tracked keys per window', () => {
    let now = 0
    const limiter = new FixedWindowLimiter({ limit: 5, windowMs: 1000, maxKeys: 2, now: () => now })
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('b')).toBe(true)
    expect(limiter.allow('c')).toBe(false)
    expect(limiter.allow('a')).toBe(true)
    now = 1000
    expect(limiter.allow('c')).toBe(true)
  })
})

describe('16 KiB JSON body limit', () => {
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request('http://localhost/nonce', { method: 'POST', body, headers, duplex: 'half' } as RequestInit)

  it('parses a normal JSON object and returns null for missing or invalid JSON', async () => {
    expect(await readJsonBody(post(JSON.stringify({ accountId: 'amy.testnet' })))).toEqual({ accountId: 'amy.testnet' })
    expect(await readJsonBody(post('not json'))).toBeNull()
    expect(await readJsonBody(post('7'))).toBeNull()
    expect(await readJsonBody(new Request('http://localhost/nonce', { method: 'POST' }))).toBeNull()
  })

  it('refuses a declared Content-Length over the limit before reading', async () => {
    await expect(readJsonBody(post('{}', { 'content-length': String(MAX_BODY_BYTES + 1) }))).rejects.toMatchObject({ status: 413, code: 'BODY_TOO_LARGE' })
  })

  it('refuses a body whose actual bytes exceed the limit (no or false Content-Length)', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES) })
    await expect(readJsonBody(post(big))).rejects.toMatchObject({ status: 413 })
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls > 100) { controller.close(); return }
        controller.enqueue(new Uint8Array(1024).fill(32))
      },
    })
    await expect(readJsonBody(post(stream))).rejects.toMatchObject({ status: 413 })
    expect(pulls).toBeLessThan(30) // stopped reading shortly after 16 KiB
    const exact = JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES - 10) })
    expect(Buffer.byteLength(exact)).toBe(MAX_BODY_BYTES)
    expect(await readJsonBody(post(exact))).toMatchObject({ pad: expect.any(String) })
  })
})

describe('membership cache stays bounded', () => {
  it('prunes expired entries once full, and clears if still full', () => {
    const cache = new Map<string, { until: number }>([['a', { until: 5 }], ['b', { until: 50 }]])
    pruneAccess(cache, 10, 2)
    expect([...cache.keys()]).toEqual(['b'])
    cache.set('c', { until: 50 })
    pruneAccess(cache, 10, 2)
    expect(cache.size).toBe(0)
  })

  it('a signed-in caller probing many circle ids does not grow the cache past the cap', async () => {
    const checkAccess = vi.fn(async () => ({ allowed: false }))
    const chat = new ChatService({ checkAccess, now: () => 1000 })
    for (let id = 0; id < 10_050; id++) await chat.list('eve.testnet', String(id)).catch(() => undefined)
    const size = (chat as unknown as { access: Map<string, unknown> }).access.size
    expect(size).toBeLessThanOrEqual(10_000)
  })
})
