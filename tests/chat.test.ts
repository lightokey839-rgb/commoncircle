import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ChatService, cleanText, MAX_TEXT, RATE_MAX } from '../server/chat'

const members = new Set(['alice.testnet', 'bob.testnet'])
const checkAccess = vi.fn(async (circleId: string, accountId: string) => ({ allowed: circleId === '3' && members.has(accountId) }))

describe('circle chat (members only)', () => {
  it('lets two members talk in their circle and returns only newer messages', async () => {
    const chat = new ChatService({ checkAccess, now: () => 1000 })
    const a = await chat.post('alice.testnet', '3', 'Hi Bob')
    await chat.post('bob.testnet', '3', 'Hi Alice')
    expect((await chat.list('bob.testnet', '3')).map((m) => m.text)).toEqual(['Hi Bob', 'Hi Alice'])
    expect((await chat.list('alice.testnet', '3', a.id)).map((m) => m.account_id)).toEqual(['bob.testnet'])
  })

  it('refuses non-members, for reading and for posting', async () => {
    const chat = new ChatService({ checkAccess })
    await expect(chat.list('mallory.testnet', '3')).rejects.toMatchObject({ status: 403, code: 'CHAT_NOT_MEMBER' })
    await expect(chat.post('mallory.testnet', '3', 'hello')).rejects.toMatchObject({ status: 403 })
    await expect(chat.post('alice.testnet', '9', 'wrong circle')).rejects.toMatchObject({ status: 403 })
  })

  it('caches the on-chain check briefly, then asks again', async () => {
    let now = 0
    const check = vi.fn(async () => ({ allowed: true }))
    const chat = new ChatService({ checkAccess: check, now: () => now })
    await chat.list('alice.testnet', '3')
    await chat.list('alice.testnet', '3')
    expect(check).toHaveBeenCalledTimes(1)
    now += 21_000
    await chat.list('alice.testnet', '3')
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('rejects empty, oversized and hidden-character messages, and rate-limits', async () => {
    expect(() => cleanText('   ')).toThrow(/Write a message/)
    expect(() => cleanText('x'.repeat(MAX_TEXT + 1))).toThrow(/limited/)
    expect(() => cleanText('pay me‮')).toThrow(/hidden/)
    expect(cleanText('line one\r\nline two')).toBe('line one\nline two')
    const chat = new ChatService({ checkAccess, now: () => 5000 })
    for (let i = 0; i < RATE_MAX; i++) await chat.post('alice.testnet', '3', `m${i}`)
    await expect(chat.post('alice.testnet', '3', 'one too many')).rejects.toMatchObject({ status: 429 })
  })

  it('keeps history across restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-chat-'))
    const storePath = join(dir, 'chat.json')
    try {
      await new ChatService({ checkAccess, storePath }).post('alice.testnet', '3', 'still here?')
      const again = new ChatService({ checkAccess, storePath })
      const next = await again.post('bob.testnet', '3', 'yes')
      expect((await again.list('bob.testnet', '3')).map((m) => m.text)).toEqual(['still here?', 'yes'])
      expect(next.id).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
