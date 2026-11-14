import { describe, expect, it, vi } from 'vitest'
import { parseFtTransferCallOutcome, type CircleParams, type LoanView, type PassportView } from '../web/circle-client'
import { borrowLimit, canCancel, countdown, formatDuration, loanLengthText, openLimitMessage, requestsForLender, trustedProgress, validateLoanInput } from '../web/loan-rules'
import { explorerTxUrl, moneySummary, runMoney, type MoneyDeps } from '../web/money'
import { formatUsdc } from '../web/treasury'

const NOW = 1_800_000_000_000 // ms
const ns = (ms: number) => (BigInt(ms) * 1_000_000n).toString()
const HASH = '9wsL3gA1E4YN9pxpNzaAKLErF11BSB2QaJMxX6KY2YVD'
const label = (a: string) => a.replace('.testnet', '')

const loan = (over: Partial<LoanView> = {}): LoanView => ({
  loan_id: '9', circle_id: '3', borrower_id: 'bo.testnet', lender_id: 'le.testnet', lender_is_treasury: false,
  principal: '1000000', total_repaid: '0', outstanding: '1000000', duration_days: 7, duration_sec: '420',
  created_at: ns(NOW - 60_000), funding_deadline: ns(NOW + 3_540_000), funded_at: null, due_at: null, repaid_at: null,
  state: 'Open', cancel_reason: null, funded_via: null, overdue: false, repaid_on_time: null, qualifying: null, flag_cleared: false,
  ...over,
})

const params: CircleParams = {
  min_amount: '1000000', member_max_amount: '10000000', trusted_max_amount: '50000000', max_duration_days: 14,
  day_length_sec: '60', funding_window_sec: '3600', qualifying_min_amount: '1000000', qualifying_min_days: 1,
  trusted_threshold: 1, min_distinct_lenders: 1, recovery_lock_sec: '0', writeoff_grace_sec: '2592000',
}

/** A wallet outcome as the wallet returns it: tx hash plus receipts with EVENT_JSON logs. */
const walletOutcome = (...events: string[]) => ({
  transaction: { hash: HASH },
  receipts_outcome: [{ outcome: { logs: events.map((e) => `EVENT_JSON:${JSON.stringify({ standard: 'commoncircle', version: '1.0.0', event: e, data: [{}] })}`), status: { SuccessValue: '' } } }],
})

const deps = (over: Partial<MoneyDeps> = {}): MoneyDeps => ({
  fundLoan: vi.fn(async () => parseFtTransferCallOutcome(walletOutcome('loan_funded'))),
  repayLoan: vi.fn(async () => parseFtTransferCallOutcome(walletOutcome('loan_repayment', 'loan_repaid'))),
  cancelLoan: vi.fn(async () => ({ transaction: { hash: HASH } })),
  getLoan: vi.fn(async () => loan({ state: 'Repaid', repaid_on_time: true })),
  isRegistered: vi.fn(async () => true),
  ...over,
})

describe('fund (P0-2)', () => {
  it('sends the principal and returns the tx hash', async () => {
    const d = deps()
    const r = await runMoney('fund', loan(), d, 'usdc', label)
    expect(r).toEqual({ ok: true, txHash: HASH, text: 'Sent 1 USDC to bo. The repayment clock has started.' })
    expect(d.fundLoan).toHaveBeenCalledWith({ usdcId: 'usdc', loanId: '9', amount: '1000000' })
  })

  it('stops before sending when the borrower is not set up for USDC', async () => {
    const d = deps({ isRegistered: vi.fn(async () => false) })
    const r = await runMoney('fund', loan(), d, 'usdc', label)
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/not set up to receive USDC/)
    expect(d.fundLoan).not.toHaveBeenCalled()
  })

  it('reports a refunded funding as a failure, with the tx link', async () => {
    const r = await runMoney('fund', loan(), deps({ fundLoan: vi.fn(async () => parseFtTransferCallOutcome(walletOutcome('loan_funding_failed', 'transfer_refunded'))) }), 'usdc', label)
    expect(r).toEqual({ ok: false, txHash: HASH, text: 'Funding did not go through, and your USDC came straight back to you.' })
  })

  it('reports a lapsed window in plain words', async () => {
    const r = await runMoney('fund', loan(), deps({ fundLoan: vi.fn(async () => { throw new Error('Smart contract panicked: E18_WINDOW_LAPSED') }) }), 'usdc', label)
    expect(r).toEqual({ ok: false, txHash: null, text: 'The funding window has closed.' })
  })

  it('reports a closed wallet window', async () => {
    const r = await runMoney('fund', loan(), deps({ fundLoan: vi.fn(async () => { throw new Error('User rejected the request') }) }), 'usdc', label)
    expect(r.text).toBe('You closed the wallet window, so nothing was sent.')
  })
})

describe('repay (P0-2)', () => {
  it('pays the outstanding amount and says on time', async () => {
    const d = deps()
    const r = await runMoney('repay', loan({ state: 'Funded' }), d, 'usdc', label)
    expect(r).toEqual({ ok: true, txHash: HASH, text: 'Repaid on time: 1 USDC went back to le.' })
    expect(d.repayLoan).toHaveBeenCalledWith({ usdcId: 'usdc', loanId: '9', amount: '1000000' })
  })

  it('says late when the loan ended up repaid after the due time', async () => {
    const r = await runMoney('repay', loan({ state: 'Funded' }), deps({ getLoan: vi.fn(async () => loan({ state: 'Repaid', repaid_on_time: false })) }), 'usdc', label)
    expect(r.ok).toBe(true)
    expect(r.text).toMatch(/counts as late/)
  })

  it('reports a bounced repayment', async () => {
    const r = await runMoney('repay', loan({ state: 'Funded' }), deps({ repayLoan: vi.fn(async () => parseFtTransferCallOutcome(walletOutcome('loan_repayment_failed'))) }), 'usdc', label)
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/bounced/)
  })

  it('sets up an unregistered lender’s USDC first, only when the borrower confirmed it, then repays', async () => {
    const registerAccount = vi.fn(async () => ({}))
    const d = deps({ registerAccount })
    const summary = moneySummary('repay', loan({ state: 'Funded' }), label, '60', { registerLender: true })
    expect(summary.confirm).toBe('Set up their USDC (0.00125 NEAR), then pay 1 USDC')
    expect(summary.lines.join(' ')).toMatch(/no longer set up to receive USDC/)
    const r = await runMoney('repay', loan({ state: 'Funded' }), d, 'usdc', label, { registerLender: true })
    expect(r.ok).toBe(true)
    expect(registerAccount).toHaveBeenCalledWith('le.testnet')
    expect(registerAccount.mock.invocationCallOrder[0]).toBeLessThan((d.repayLoan as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
    await runMoney('repay', loan({ state: 'Funded' }), deps({ registerAccount }), 'usdc', label)
    expect(registerAccount).toHaveBeenCalledTimes(1) // never without the option
  })

  it('reports an RPC failure', async () => {
    const r = await runMoney('repay', loan({ state: 'Funded' }), deps({ repayLoan: vi.fn(async () => { throw new Error('NEAR RPC view failed') }) }), 'usdc', label)
    expect(r.text).toBe('NEAR testnet is busy and did not answer. Try again in a moment.')
  })
})

describe('cancel (P0-2)', () => {
  it('cancels and returns the tx hash', async () => {
    const d = deps()
    expect(await runMoney('cancel', loan(), d, 'usdc', label)).toEqual({ ok: true, txHash: HASH, text: 'Request #9 is cancelled. No money moved.' })
    expect(d.cancelLoan).toHaveBeenCalledWith('9')
  })

  it('reports a wrong-state refusal', async () => {
    const r = await runMoney('cancel', loan(), deps({ cancelLoan: vi.fn(async () => { throw new Error('E17_WRONG_STATE') }) }), 'usdc', label)
    expect(r).toEqual({ ok: false, txHash: null, text: 'That loan is not in the right state for this action.' })
  })

  it('is offered only to the borrower while the window is open', () => {
    expect(canCancel(loan(), 'bo.testnet', NOW)).toBe(true)
    expect(canCancel(loan(), 'le.testnet', NOW)).toBe(false)
    expect(canCancel(loan({ funding_deadline: ns(NOW - 1) }), 'bo.testnet', NOW)).toBe(false)
  })
})

describe('summaries say who pays whom, how much, due when', () => {
  it('fund', () => {
    expect(moneySummary('fund', loan(), label, '60').lines[1]).toBe('They repay you within 7 demo days = 7 minutes after the money arrives.')
  })
  it('repay to the treasury', () => {
    expect(moneySummary('repay', loan({ lender_is_treasury: true }), label, '60').lines[0]).toBe('You pay 1 USDC back to the circle treasury (DAO).')
  })

  it('a repayment summary says how long is left before the due time', () => {
    const funded = loan({ state: 'Funded', due_at: ns(NOW + 95_000) })
    expect(moneySummary('repay', funded, label, '60', { nowMs: NOW }).lines[1]).toBe('Paying before the due time counts as on time. About 1:35 was left when this box opened; the repayment must land on testnet before then.')
    // No clock given, or the due time already passed: no countdown is made up.
    expect(moneySummary('repay', funded, label, '60').lines[1]).toBe('Paying before the due time counts as on time.')
    expect(moneySummary('repay', loan({ state: 'Funded', due_at: ns(NOW - 1000) }), label, '60', { nowMs: NOW }).lines[1]).toBe('Paying before the due time counts as on time.')
    expect(moneySummary('repay', loan({ state: 'Funded', due_at: ns(NOW - 1000), overdue: true }), label, '60', { nowMs: NOW }).lines[1]).toBe('This loan is past its due time, so it will count as late.')
  })
  it('explorer link', () => {
    expect(explorerTxUrl('https://testnet.nearblocks.io/', HASH)).toBe(`https://testnet.nearblocks.io/txns/${HASH}`)
  })
})

describe('loan rules come from the circle params (P0-3)', () => {
  it('uses the member cap for Members and the trusted cap for effective Trusted, capped by hard_loan_cap', () => {
    expect(borrowLimit(params, { effective_tier: 'Member' }, '50000000')).toEqual({ tier: 'Member', min: '1000000', max: '10000000', maxDays: 14, openAllowed: 1 })
    expect(borrowLimit(params, { effective_tier: 'Trusted' }, '20000000').max).toBe('20000000')
  })

  it('validates amount and days inline', () => {
    const limit = borrowLimit(params, null, '50000000')
    expect(validateLoanInput('1', '7', limit, formatUsdc)).toEqual({ amount: '1000000', days: 7, errors: {} })
    expect(validateLoanInput('11', '7', limit, formatUsdc).errors.amount).toBe('Choose between 1 and 10 USDC (your limit as a Member).')
    expect(validateLoanInput('abc', '0', limit, formatUsdc).errors).toEqual({ amount: 'Enter an amount such as 1 or 2.5.', days: 'Choose a whole number of days from 1 to 14.' })
    expect(validateLoanInput('1', '15', limit, formatUsdc).days).toBeNull()
  })

  it('shows demo time', () => {
    expect(loanLengthText(7, '60')).toBe('7 demo days = 7 minutes')
    expect(loanLengthText(1, '60')).toBe('1 demo day = 60 seconds')
    expect(loanLengthText(7, '86400')).toBe('7 days')
    expect(formatDuration(3600n)).toBe('60 minutes')
  })

  it('counts down and stops at zero', () => {
    expect(countdown(ns(NOW + 125_000), NOW)).toBe('2:05')
    expect(countdown(ns(NOW + 3_723_000), NOW)).toBe('1:02:03')
    expect(countdown(ns(NOW - 1), NOW)).toBeNull()
  })

  it('refuses before signing when the open-loan limit is reached (E16), counting lapsed requests as closed', () => {
    const limit = { openAllowed: 2, tier: 'Trusted' as const }
    expect(openLimitMessage([loan({ loan_id: '13' }), loan({ loan_id: '14' })], limit, NOW)).toMatch(/#13 and #14 are still open/)
    expect(openLimitMessage([loan({ loan_id: '13' }), loan({ loan_id: '14', funding_deadline: ns(NOW - 1) })], limit, NOW)).toBeNull()
    expect(openLimitMessage([loan({ state: 'Funded' })], { openAllowed: 1, tier: 'Member' }, NOW)).toMatch(/1 open loan at a time/)
    expect(openLimitMessage([loan({ state: 'Repaid' }), loan({ state: 'Cancelled' })], { openAllowed: 1, tier: 'Member' }, NOW)).toBeNull()
  })

  it('lists only live requests that name the lender', () => {
    const list = [loan(), loan({ loan_id: '10', lender_id: 'x.testnet' }), loan({ loan_id: '11', funding_deadline: ns(NOW - 1) }), loan({ loan_id: '12', state: 'Funded' })]
    expect(requestsForLender(list, 'le.testnet', NOW).map((l) => l.loan_id)).toEqual(['9'])
  })

  it('shows progress toward Trusted from the circle threshold', () => {
    const passport = { tier: 'Member', on_time_count: 0, late_count: 0, qualifying_count: 0, distinct_lenders: 0 } as PassportView
    expect(trustedProgress(passport, params)).toEqual({ trusted: false, onTime: 0, late: 0, qualifying: 0, threshold: 1, lenders: 0, minLenders: 1 })
    expect(trustedProgress({ ...passport, tier: 'Trusted', on_time_count: 1 }, params)).toEqual({ trusted: true, onTime: 1, late: 0 })
  })
})
