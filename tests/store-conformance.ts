// The same behaviour checks for every CircleStore (memory, file, PostgreSQL).
import { describe, expect, it } from 'vitest'
import { ChatError } from '../server/chat'
import { RequestService } from '../server/requests'
import { DuplicateLoanLink, type CircleStore, type LoanRequest } from '../server/store'

const base: Omit<LoanRequest, 'id'> = { circle_id: '3', borrower: 'amy.testnet', amount: '1000000', days: 7, note: 'Rent', at: 1, offers: [], lender: null, loan_id: null, cancelled: false, direct: false }

export function storeConformance(name: string, make: () => Promise<CircleStore>, reopen?: (store: CircleStore) => Promise<CircleStore>): void {
  describe(`${name} store`, () => {
    it('numbers messages per room, in order, and pages after / before / latest', async () => {
      const s = await make()
      try {
        for (let i = 1; i <= 5; i++) await s.appendMessage({ circle_id: '3', account_id: 'amy.testnet', text: `m${i}`, at: i })
        await s.appendMessage({ circle_id: '4', account_id: 'ben.testnet', text: 'other room', at: 9 })
        const all = await s.listMessages('3', { limit: 100 })
        expect(all.map((m) => m.id)).toEqual([1, 2, 3, 4, 5])
        expect((await s.listMessages('4', { limit: 100 })).map((m) => m.id)).toEqual([1])
        expect((await s.listMessages('3', { after: 3, limit: 100 })).map((m) => m.text)).toEqual(['m4', 'm5'])
        expect((await s.listMessages('3', { limit: 2 })).map((m) => m.text)).toEqual(['m4', 'm5'])
        expect((await s.listMessages('3', { before: 4, limit: 2 })).map((m) => m.text)).toEqual(['m2', 'm3'])
      } finally { await s.close() }
    })

    it('gives concurrent posters distinct, gap-free numbers', async () => {
      const s = await make()
      try {
        await Promise.all(Array.from({ length: 20 }, (_, i) => s.appendMessage({ circle_id: '7', account_id: i % 2 ? 'amy.testnet' : 'ben.testnet', text: `c${i}`, at: i })))
        const ids = (await s.listMessages('7', { limit: 100 })).map((m) => m.id)
        expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
      } finally { await s.close() }
    })

    it('consumes a sign-in challenge exactly once and ignores expired ones', async () => {
      const s = await make()
      try {
        const c = { accountId: 'amy.testnet', message: 'm', recipient: 'r', expiresAt: 1000 }
        expect(await s.addChallenge('n1', c, 10, 0)).toBe(true)
        const [a, b] = await Promise.all([s.takeChallenge('n1', 10), s.takeChallenge('n1', 10)])
        expect([a, b].filter(Boolean)).toHaveLength(1)
        expect(await s.addChallenge('n2', c, 10, 0)).toBe(true)
        expect(await s.takeChallenge('n2', 2000)).toBeNull()
        expect(await s.addChallenge('n3', c, 1, 0)).toBe(true)
        expect(await s.addChallenge('n4', c, 1, 0)).toBe(false) // cap reached
      } finally { await s.close() }
    })

    it('counts rate-limit hits per key and window', async () => {
      const s = await make()
      try {
        const results = []
        for (let i = 0; i < 4; i++) results.push(await s.hit('k', 3, 60_000, 120_000))
        expect(results).toEqual([true, true, true, false])
        expect(await s.hit('k', 3, 60_000, 180_000)).toBe(true) // next window
        expect(await s.hit('other', 3, 60_000, 120_000)).toBe(true)
      } finally { await s.close() }
    })

    it('updates a request under a lock and refuses a second card for the same loan', async () => {
      const s = await make()
      try {
        const r1 = await s.createRequest(base, () => undefined)
        const r2 = await s.createRequest({ ...base, note: 'Bus fare' }, () => undefined)
        expect(r2.id).toBeGreaterThan(r1.id)
        const linked = await s.updateRequest('3', r1.id, (r) => ({ ...r, offers: ['ben.testnet'], lender: 'ben.testnet', loan_id: '42' }))
        expect(linked).toMatchObject({ loan_id: '42', lender: 'ben.testnet', offers: ['ben.testnet'] })
        await expect(s.updateRequest('3', r2.id, (r) => ({ ...r, loan_id: '42' }))).rejects.toBeInstanceOf(DuplicateLoanLink)
        await expect(s.createRequest({ ...base, loan_id: '42', direct: true }, () => undefined)).rejects.toBeInstanceOf(DuplicateLoanLink)
        await expect(s.createRequest(base, () => { throw new ChatError(409, 'REQ_TOO_MANY', 'no') })).rejects.toMatchObject({ code: 'REQ_TOO_MANY' })
        expect((await s.listRequests('3', 10)).map((r) => r.loan_id)).toEqual(['42', null])
      } finally { await s.close() }
    })

    it('serialises concurrent offers on one request (no lost update)', async () => {
      const s = await make()
      try {
        const svc = new RequestService({ checkAccess: async () => ({ allowed: true }), getLoan: async () => null, store: s, retryMs: 0 })
        const r = await svc.create('amy.testnet', '3', { amount: '1000000', days: 7, note: 'Seeds' })
        const lenders = ['ben.testnet', 'cat.testnet', 'dan.testnet', 'eve.testnet', 'fay.testnet']
        await Promise.all(lenders.map((l) => svc.offer(l, '3', r.id)))
        const after = (await svc.list('amy.testnet', '3')).find((x) => x.id === r.id)!
        expect(after.offers.slice().sort()).toEqual(lenders)
      } finally { await s.close() }
    })

    if (reopen) {
      it('keeps messages and requests after a restart', async () => {
        const s = await make()
        await s.appendMessage({ circle_id: '3', account_id: 'amy.testnet', text: 'still here?', at: 1 })
        const r = await s.createRequest(base, () => undefined)
        const again = await reopen(s)
        try {
          expect((await again.listMessages('3', { limit: 10 })).map((m) => m.text)).toEqual(['still here?'])
          expect((await again.appendMessage({ circle_id: '3', account_id: 'ben.testnet', text: 'yes', at: 2 })).id).toBe(2)
          expect((await again.listRequests('3', 10)).map((x) => x.id)).toEqual([r.id])
        } finally { await again.close() }
      })
    }
  })
}
