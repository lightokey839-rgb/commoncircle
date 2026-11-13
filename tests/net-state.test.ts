import { describe, expect, it } from 'vitest'
import { describeNet, initialNet, isStale, netFailed, netSucceeded, retryDelay, STALE_AFTER_MS } from '../web/net-state'
import { mergeMessages, unreachable } from '../web/chat'
import { allPages } from '../web/demo'

describe('network state (stale data is labelled, never treated as fresh)', () => {
  it('starts connecting, becomes live, then stale with the last good time when a refresh fails', () => {
    let s = initialNet()
    expect(describeNet(s, 0).pill).toBe('Connecting…')
    expect(isStale(s, 0)).toBe(true) // nothing read yet: money actions stay off
    s = netSucceeded(s, 1_000)
    expect(describeNet(s, 2_000)).toMatchObject({ pill: 'Testnet live', tone: 'ok', banner: null })
    expect(isStale(s, 2_000)).toBe(false)
    s = netFailed(s, 'Failed to fetch')
    expect(s.phase).toBe('stale')
    expect(describeNet(s, 3_000).banner).toMatch(/labelled stale\. Money actions stay off/)
    expect(isStale(s, 3_000)).toBe(true)
  })

  it('is offline (not stale) when nothing was ever read', () => {
    const s = netFailed(initialNet(), 'Failed to fetch')
    expect(s.phase).toBe('offline')
    expect(describeNet(s, 0).tone).toBe('bad')
  })

  it('calls data old after two minutes even without a failure', () => {
    const s = netSucceeded(initialNet(), 1_000)
    expect(isStale(s, 1_000 + STALE_AFTER_MS + 1)).toBe(true)
    expect(describeNet(s, 1_000 + STALE_AFTER_MS + 1).tone).toBe('warn')
  })

  it('reports partial failures as degraded, naming what is missing', () => {
    const s = netSucceeded(initialNet(), 0, ['treasury balance'])
    expect(s.phase).toBe('degraded')
    expect(describeNet(s, 1).banner).toContain('treasury balance')
  })

  it('backs off retries and caps the delay', () => {
    let s = initialNet()
    const delays: number[] = []
    for (let i = 0; i < 6; i++) { s = netFailed(s, 'x'); delays.push(retryDelay(s)) }
    expect(delays).toEqual([5_000, 15_000, 30_000, 60_000, 60_000, 60_000])
    expect(netSucceeded(s, 1).failures).toBe(0)
  })
})

describe('chat client helpers', () => {
  it('merges polled messages by id without duplicates, in order', () => {
    const m = (id: number) => ({ id, circle_id: '3', account_id: 'a.testnet', text: `m${id}`, at: id })
    expect(mergeMessages([m(1), m(2), m(3)], [m(3), m(5), m(4)]).map((x) => x.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('explains an unreachable server differently for local and hosted servers', () => {
    expect(unreachable('http://localhost:3001')).toMatch(/npm run auth/)
    expect(unreachable('https://chat.example.com')).toMatch(/wake up/)
  })
})

describe('paged contract views', () => {
  it('reads every page of 50 so counts are complete', async () => {
    const rows = Array.from({ length: 123 }, (_, i) => i)
    const calls: number[] = []
    const all = await allPages(async (from) => { calls.push(from); return rows.slice(from, from + 50) })
    expect(all).toHaveLength(123)
    expect(calls).toEqual([0, 50, 100])
  })
})
