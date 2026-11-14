import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CircleParams, LoanView, PassportView } from '../web/circle-client'
import { circleStats, demoDifferences, evidenceTotals, privileges, recentActivity, trackSummaries, treasuryEligibility, wantsPublicDemo, type EvidenceStatus } from '../web/overview'
import { formatUsdc } from '../web/treasury'

const ns = (ms: number) => (BigInt(ms) * 1_000_000n).toString()
const loan = (over: Partial<LoanView>): LoanView => ({
  loan_id: '1', circle_id: '3', borrower_id: 'b.testnet', lender_id: 'l.testnet', lender_is_treasury: false, principal: '1000000', total_repaid: '0',
  outstanding: '1000000', duration_days: 7, duration_sec: '420', created_at: ns(1000), funding_deadline: ns(9_000_000), funded_at: null, due_at: null,
  repaid_at: null, state: 'Open', cancel_reason: null, funded_via: null, overdue: false, repaid_on_time: null, qualifying: null, flag_cleared: false, ...over,
})
const passport = (over: Partial<PassportView>): PassportView => ({
  token_id: '3:a.testnet', circle_id: '3', owner_id: 'a.testnet', tier: 'Member', steward: false, display_tier: 'Member', status: 'Active', expires_at: null,
  joined_at: ns(500), invited_by: null, on_time_count: 0, late_count: 0, qualifying_count: 0, distinct_lenders: 0, open_loans: 0, overdue_loans: 0,
  perks_paused: false, effective_tier: 'Member', recovery: null, ...over,
})
const demo: CircleParams = {
  min_amount: '1000000', member_max_amount: '10000000', trusted_max_amount: '50000000', max_duration_days: 14, day_length_sec: '60', funding_window_sec: '3600',
  qualifying_min_amount: '1000000', qualifying_min_days: 1, trusted_threshold: 1, min_distinct_lenders: 1, recovery_lock_sec: '0', writeoff_grace_sec: '2592000',
}
const standard: CircleParams = { ...demo, day_length_sec: '86400', funding_window_sec: '259200', trusted_threshold: 3, min_distinct_lenders: 2 }

describe('overview statistics come only from contract views', () => {
  it('counts members, trusted, loans, funded, repaid, active, overdue and outstanding', () => {
    const loans = [
      loan({ loan_id: '1' }),
      loan({ loan_id: '2', state: 'Funded', funded_at: ns(2000), outstanding: '2500000', overdue: true }),
      loan({ loan_id: '3', state: 'Repaid', funded_at: ns(2000), repaid_at: ns(3000), outstanding: '0', repaid_on_time: true }),
      loan({ loan_id: '4', state: 'Cancelled' }),
    ]
    const people = [passport({}), passport({ owner_id: 'c.testnet', effective_tier: 'Trusted' }), passport({ owner_id: 'd.testnet', status: 'Revoked' })]
    expect(circleStats(loans, people)).toEqual({ members: 2, trusted: 1, totalLoans: 4, funded: 2, repaid: 1, active: 1, overdue: 1, outstanding: '2500000' })
  })

  it('builds activity from view timestamps only, newest first', () => {
    const items = recentActivity([loan({ state: 'Repaid', funded_at: ns(2000), repaid_at: ns(3000), repaid_on_time: true })], [passport({})], formatUsdc, (a) => a)
    expect(items.map((i) => i.kind)).toEqual(['repaid', 'funded', 'requested', 'joined'])
    expect(items[0].text).toBe('b.testnet repaid loan #1 on time')
  })
})

describe('demo settings are labelled, standard settings are not (Phase 5)', () => {
  it('lists every demo shortcut', () => {
    expect(demoDifferences(demo)).toHaveLength(4)
    expect(demoDifferences(demo)[1]).toBe('1 on-time repayment earns Trusted (standard: 3)')
    expect(demoDifferences(standard)).toEqual([])
  })
})

describe('treasury eligibility (interface section 4)', () => {
  it('explains every refusal and allows a Trusted non-steward', () => {
    expect(treasuryEligibility(passport({ effective_tier: 'Trusted' }), true, false).reason).toMatch(/DAO trust checks/)
    expect(treasuryEligibility(passport({ effective_tier: 'Trusted' }), false, true).reason).toMatch(/2 active stewards/)
    expect(treasuryEligibility(null, true, true).reason).toBe('Join the circle first.')
    expect(treasuryEligibility(passport({ steward: true, effective_tier: 'Trusted' }), true, true).reason).toMatch(/cannot borrow/)
    expect(treasuryEligibility(passport({ tier: 'Trusted', perks_paused: true }), true, true).reason).toMatch(/overdue/)
    expect(treasuryEligibility(passport({}), true, true).reason).toBe('Only Trusted members can borrow from the treasury.')
    expect(treasuryEligibility(passport({ effective_tier: 'Trusted' }), true, true).eligible).toBe(true)
  })

  it('describes the passport of another member in the third person, never as "you"', () => {
    const trusted = passport({ effective_tier: 'Trusted' })
    expect(treasuryEligibility(trusted, true, true).reason).toBe('You are Trusted and not a steward: you can ask the treasury.')
    const other = treasuryEligibility(trusted, true, true, false)
    expect(other).toEqual({ eligible: true, reason: 'Trusted and not a steward: this member can ask the treasury.' })
    for (const p of [passport({ status: 'Suspended' }), passport({ tier: 'Trusted', perks_paused: true }), trusted]) {
      expect(treasuryEligibility(p, true, true, false).reason).not.toMatch(/\b[Yy]ou(r)?\b/)
    }
  })

  it('shows the Member → Trusted change in privileges', () => {
    expect(privileges(passport({}), demo, '50000000', formatUsdc)[0]).toBe('Borrow 1 to 10 USDC per loan, up to 1 open loan at a time.')
    expect(privileges(passport({ effective_tier: 'Trusted' }), demo, '50000000', formatUsdc)[0]).toBe('Borrow 1 to 50 USDC per loan, up to 2 open loans at a time.')
  })
})

describe('evidence status comes from the claims harness output', () => {
  const status: EvidenceStatus = {
    generated_at: 'x', source: 'evidence/evidence.json',
    claims: [
      { id: 'a', track: 'Open Innovation', feature: 'F0', kind: 'tx', status: 'PASS', reason: '', reference: {} },
      { id: 'b', track: 'Open Innovation', feature: 'F0', kind: 'view', status: 'FAIL', reason: '', reference: {} },
      { id: 'c', track: 'Social Money', feature: 'F2', kind: 'test', status: 'PASS', reason: '', reference: {} },
    ],
  }
  it('drops a track with any failing claim and marks an empty track unverified', () => {
    const [oi, sm, nft] = trackSummaries(status, ['Open Innovation', 'Social Money', 'NFTs That Do Something'])
    expect([oi.status, oi.pass, oi.fail]).toEqual(['DROPPED', 1, 1])
    expect(sm.status).toBe('PASS')
    expect(nft.status).toBe('UNVERIFIED')
    expect(trackSummaries(null, ['Social Money'])[0].status).toBe('UNVERIFIED')
  })

  it('counts passes over all claims without inventing any', () => {
    expect(evidenceTotals(status)).toEqual({ pass: 2, total: 3 })
    expect(evidenceTotals(null)).toEqual({ pass: 0, total: 0 })
  })

  it('the committed web/evidence-status.json lists every claim in evidence/evidence.json', () => {
    const web = JSON.parse(readFileSync('web/evidence-status.json', 'utf8')) as EvidenceStatus
    const src = JSON.parse(readFileSync('evidence/evidence.json', 'utf8')) as { claims: Array<{ id: string }> }
    expect(web.claims.map((c) => c.id).sort()).toEqual(src.claims.map((c) => c.id).sort())
  })
})

describe('the link for judges, ?demo=1', () => {
  it('opens the public demo only when asked, and never instead of an invite', () => {
    expect(wantsPublicDemo('?demo=1', false)).toBe(true)
    expect(wantsPublicDemo('?circle_id=3&demo=1', false)).toBe(true)
    expect(wantsPublicDemo('', false)).toBe(false)
    expect(wantsPublicDemo('?demo=0', false)).toBe(false)
    expect(wantsPublicDemo('?circle_id=3', false)).toBe(false)
    expect(wantsPublicDemo('?demo=1', true)).toBe(false)
  })
})
