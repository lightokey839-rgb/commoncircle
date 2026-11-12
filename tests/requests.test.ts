import { describe, expect, it, vi } from 'vitest'
import { RequestService, type ChainLoan } from '../server/requests'

const members = new Set(['amy.testnet', 'ben.testnet', 'cat.testnet'])
const checkAccess = vi.fn(async (circleId: string, accountId: string) => ({ allowed: circleId === '3' && members.has(accountId) }))
const chain = new Map<string, ChainLoan>()
const getLoan = vi.fn(async (id: string) => chain.get(id) ?? null)
const service = () => new RequestService({ checkAccess, getLoan, now: () => 1000 })
const ask = { amount: '1000000', days: 7, note: 'School fees for my daughter' }

describe('loan request cards in the circle chat', () => {
  it('a member asks with a reason; every member sees it; others offer to lend', async () => {
    const s = service()
    const r = await s.create('amy.testnet', '3', ask)
    expect(r).toMatchObject({ borrower: 'amy.testnet', amount: '1000000', days: 7, note: 'School fees for my daughter', offers: [], loan_id: null })
    await s.offer('ben.testnet', '3', r.id)
    await s.offer('cat.testnet', '3', r.id)
    expect((await s.list('cat.testnet', '3'))[0].offers).toEqual(['ben.testnet', 'cat.testnet'])
    await s.offer('cat.testnet', '3', r.id) // withdraw
    expect((await s.list('ben.testnet', '3'))[0].offers).toEqual(['ben.testnet'])
  })

  it('needs a reason, a valid amount and days, and membership', async () => {
    const s = service()
    await expect(s.create('amy.testnet', '3', { ...ask, note: ' ' })).rejects.toMatchObject({ code: 'REQ_NOTE' })
    await expect(s.create('amy.testnet', '3', { ...ask, amount: '1.5' })).rejects.toMatchObject({ code: 'REQ_AMOUNT' })
    await expect(s.create('amy.testnet', '3', { ...ask, days: 0 })).rejects.toMatchObject({ code: 'REQ_DAYS' })
    await expect(s.create('eve.testnet', '3', ask)).rejects.toMatchObject({ status: 403 })
    await expect(s.list('eve.testnet', '3')).rejects.toMatchObject({ status: 403 })
  })

  it('the borrower cannot offer to themself; only the borrower can cancel', async () => {
    const s = service()
    const r = await s.create('amy.testnet', '3', ask)
    await expect(s.offer('amy.testnet', '3', r.id)).rejects.toMatchObject({ code: 'REQ_SELF' })
    await expect(s.cancel('ben.testnet', '3', r.id)).rejects.toMatchObject({ code: 'REQ_NOT_BORROWER' })
    expect((await s.cancel('amy.testnet', '3', r.id)).cancelled).toBe(true)
    await expect(s.offer('ben.testnet', '3', r.id)).rejects.toMatchObject({ code: 'REQ_CLOSED' })
  })

  it('links the on-chain loan only if it matches the request and names a lender who offered', async () => {
    const s = service()
    const r = await s.create('amy.testnet', '3', ask)
    await s.offer('ben.testnet', '3', r.id)
    chain.set('20', { loan_id: '20', circle_id: '3', borrower_id: 'amy.testnet', lender_id: 'cat.testnet', principal: '1000000', duration_days: 7 })
    await expect(s.link('amy.testnet', '3', r.id, '20')).rejects.toMatchObject({ code: 'REQ_LENDER' })
    chain.set('21', { loan_id: '21', circle_id: '3', borrower_id: 'amy.testnet', lender_id: 'ben.testnet', principal: '2000000', duration_days: 7 })
    await expect(s.link('amy.testnet', '3', r.id, '21')).rejects.toMatchObject({ code: 'REQ_MISMATCH' })
    chain.set('22', { loan_id: '22', circle_id: '3', borrower_id: 'amy.testnet', lender_id: 'ben.testnet', principal: '1000000', duration_days: 7 })
    await expect(s.link('ben.testnet', '3', r.id, '22')).rejects.toMatchObject({ code: 'REQ_NOT_BORROWER' })
    expect(await s.link('amy.testnet', '3', r.id, '22')).toMatchObject({ loan_id: '22', lender: 'ben.testnet' })
    await expect(s.cancel('amy.testnet', '3', r.id)).rejects.toMatchObject({ code: 'REQ_LINKED' })
    await expect(s.link('amy.testnet', '3', r.id, '99')).rejects.toMatchObject({ code: 'REQ_LOAN' })
  })

  it('records the reason of a direct loan, once, for its borrower only', async () => {
    const s = service()
    chain.set('30', { loan_id: '30', circle_id: '3', borrower_id: 'ben.testnet', lender_id: 'amy.testnet', principal: '3000000', duration_days: 5 })
    await expect(s.direct('cat.testnet', '3', { loan_id: '30', note: 'x' })).rejects.toMatchObject({ code: 'REQ_NOT_BORROWER' })
    expect(await s.direct('ben.testnet', '3', { loan_id: '30', note: 'Stock for my shop' }))
      .toMatchObject({ direct: true, lender: 'amy.testnet', amount: '3000000', days: 5, note: 'Stock for my shop' })
    await expect(s.direct('ben.testnet', '3', { loan_id: '30', note: 'again' })).rejects.toMatchObject({ code: 'REQ_DUPLICATE' })
  })
})
