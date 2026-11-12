import type { CircleParams, LoanView, PassportView, U128 } from './circle-client'
import { usdcToBaseUnits } from './treasury'

// Loan rules the UI shows, read only from the circle's on-chain params and the
// contract config (docs/CIRCLE_INTERFACE.md sections 3.1 and 4). Money stays in
// integer base units (USDC has 6 decimals) as U128 strings; no floats.

export type BorrowLimit = {
  tier: 'Member' | 'Trusted'
  min: U128
  max: U128
  maxDays: number
  /** Open loans allowed per borrower per circle: 1 at Member, 2 at effective Trusted (interface section 4). */
  openAllowed: number
}

const minBig = (a: bigint, b: bigint) => (a < b ? a : b)

/** The one source for the borrower's limits: the circle params for their effective tier, capped by `hard_loan_cap`. */
export function borrowLimit(params: CircleParams, passport: Pick<PassportView, 'effective_tier'> | null, hardLoanCap: U128): BorrowLimit {
  const trusted = passport?.effective_tier === 'Trusted'
  const tierMax = BigInt(trusted ? params.trusted_max_amount : params.member_max_amount)
  return {
    tier: trusted ? 'Trusted' : 'Member',
    min: params.min_amount,
    max: minBig(tierMax, BigInt(hardLoanCap)).toString(),
    maxDays: params.max_duration_days,
    openAllowed: trusted ? 2 : 1,
  }
}

export type LoanInput = { amount: U128 | null; days: number | null; errors: { amount?: string; days?: string } }

/** Inline validation for the loan form. Errors are plain sentences shown under each field. */
export function validateLoanInput(amountText: string, daysText: string, limit: BorrowLimit, format: (u: U128) => string): LoanInput {
  const errors: LoanInput['errors'] = {}
  let amount: U128 | null = null
  try {
    amount = usdcToBaseUnits(amountText)
    if (BigInt(amount) < BigInt(limit.min) || BigInt(amount) > BigInt(limit.max)) {
      errors.amount = `Choose between ${format(limit.min)} and ${format(limit.max)} USDC (your limit as a ${limit.tier}).`
      amount = null
    }
  } catch {
    errors.amount = 'Enter an amount such as 1 or 2.5.'
  }
  const days = /^\d+$/.test(daysText.trim()) ? Number(daysText.trim()) : NaN
  if (!Number.isInteger(days) || days < 1 || days > limit.maxDays) {
    errors.days = `Choose a whole number of days from 1 to ${limit.maxDays}.`
  }
  return { amount, days: errors.days ? null : days, errors }
}

/** "90 seconds", "7 minutes", "2 hours", "3 days". */
export function formatDuration(totalSec: bigint): string {
  const plural = (n: bigint, unit: string) => `${n} ${unit}${n === 1n ? '' : 's'}`
  if (totalSec < 120n) return plural(totalSec, 'second')
  if (totalSec < 7200n && totalSec % 60n === 0n) return plural(totalSec / 60n, 'minute')
  if (totalSec < 7200n) return `${totalSec / 60n} min ${totalSec % 60n} s`
  if (totalSec < 172800n && totalSec % 3600n === 0n) return plural(totalSec / 3600n, 'hour')
  if (totalSec < 172800n) return plural(totalSec / 60n, 'minute')
  return plural(totalSec / 86400n, 'day')
}

/** "7 demo days = 7 minutes" on a demo circle; "7 days" when a day is a real day. */
export function loanLengthText(days: number, dayLengthSec: string): string {
  if (dayLengthSec === '86400') return `${days} day${days === 1 ? '' : 's'}`
  return `${days} demo day${days === 1 ? '' : 's'} = ${formatDuration(BigInt(days) * BigInt(dayLengthSec))}`
}

const nsToMs = (ns: string) => Number(BigInt(ns) / 1_000_000n)

/** "4:05" or "1:02:03" until a nanosecond timestamp; null when it has passed. */
export function countdown(targetNs: string | null, nowMs: number): string | null {
  if (!targetNs) return null
  const ms = nsToMs(targetNs) - nowMs
  if (ms <= 0) return null
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Open and still inside its funding window (a lapsed request is Cancelled in effect). */
export function isWaiting(loan: LoanView, nowMs: number): boolean {
  return loan.state === 'Open' && nsToMs(loan.funding_deadline) > nowMs
}

/** Requests that name this account as lender and can still be funded. */
export function requestsForLender(loans: LoanView[], accountId: string, nowMs: number): LoanView[] {
  return loans.filter((l) => l.lender_id === accountId && isWaiting(l, nowMs))
}

/** `cancel_loan`: the borrower, while Open and not lapsed (interface section 3). */
export function canCancel(loan: LoanView, accountId: string, nowMs: number): boolean {
  return loan.borrower_id === accountId && isWaiting(loan, nowMs)
}

export type TrustedProgress =
  | { trusted: true; onTime: number; late: number }
  | { trusted: false; onTime: number; late: number; qualifying: number; threshold: number; lenders: number; minLenders: number }

/**
 * Counters and progress toward Trusted, from the passport and the circle's
 * `trusted_threshold` and `min_distinct_lenders` (stored as min(value, N)).
 */
export function trustedProgress(passport: PassportView, params: CircleParams): TrustedProgress {
  if (passport.tier === 'Trusted') return { trusted: true, onTime: passport.on_time_count, late: passport.late_count }
  return {
    trusted: false,
    onTime: passport.on_time_count,
    late: passport.late_count,
    qualifying: passport.qualifying_count,
    threshold: params.trusted_threshold,
    lenders: passport.distinct_lenders,
    minLenders: params.min_distinct_lenders,
  }
}
