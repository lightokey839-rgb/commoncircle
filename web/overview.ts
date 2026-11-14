import type { CircleParams, LoanView, PassportView, U128 } from './circle-client'
import { borrowLimit } from './loan-rules'

// Pure helpers for the Overview, My Passport and Evidence views. Everything is
// derived from contract views already fetched (loans_in_circle, passports_in_circle,
// get_circle, ft_balance_of); nothing here invents a number.

export type CircleStats = {
  members: number
  trusted: number
  totalLoans: number
  funded: number // ever funded (funded_at set)
  repaid: number
  active: number // Funded / Funding / Repaying / WrittenOff (money out, not yet back)
  overdue: number
  outstanding: U128 // USDC base units still owed on active loans
}

const ACTIVE = new Set(['Funded', 'Funding', 'Repaying', 'WrittenOff'])

export function circleStats(loans: LoanView[], passports: PassportView[]): CircleStats {
  let outstanding = 0n
  for (const l of loans) if (ACTIVE.has(l.state)) outstanding += BigInt(l.outstanding)
  return {
    members: passports.filter((p) => p.status === 'Active').length,
    trusted: passports.filter((p) => p.status === 'Active' && p.effective_tier === 'Trusted').length,
    totalLoans: loans.length,
    funded: loans.filter((l) => l.funded_at !== null).length,
    repaid: loans.filter((l) => l.state === 'Repaid').length,
    active: loans.filter((l) => ACTIVE.has(l.state)).length,
    overdue: loans.filter((l) => l.overdue).length,
    outstanding: outstanding.toString(),
  }
}

/** The documented defaults (docs/CIRCLE_INTERFACE.md 3.1): 3 qualifying repayments, 2 distinct lenders, real 1-day days. */
export const STANDARD_RULES = { trusted_threshold: 3, min_distinct_lenders: 2, day_length_sec: '86400', funding_window_sec: '259200' } as const

/** Which of this circle's settings are weaker or faster than the standard ones (shown as "Demo settings"). */
export function demoDifferences(params: CircleParams): string[] {
  const out: string[] = []
  if (params.day_length_sec !== STANDARD_RULES.day_length_sec) out.push(`a "day" lasts ${params.day_length_sec} seconds (standard: 1 real day)`)
  if (params.trusted_threshold < STANDARD_RULES.trusted_threshold) out.push(`${params.trusted_threshold} on-time repayment${params.trusted_threshold === 1 ? '' : 's'} earns Trusted (standard: ${STANDARD_RULES.trusted_threshold})`)
  if (params.min_distinct_lenders < STANDARD_RULES.min_distinct_lenders) out.push(`from ${params.min_distinct_lenders} lender${params.min_distinct_lenders === 1 ? '' : 's'} (standard: ${STANDARD_RULES.min_distinct_lenders} different lenders)`)
  if (params.funding_window_sec !== STANDARD_RULES.funding_window_sec) out.push(`a request can be funded for ${Number(params.funding_window_sec) / 60} minutes (standard: 72 hours)`)
  return out
}

export type TreasuryEligibility = { eligible: boolean; reason: string }

/** Interface section 4: DAO attached, at least 2 Active stewards, borrower effective Trusted and not a steward. */
export function treasuryEligibility(passport: PassportView | null, lendingEnabled: boolean, daoVerified: boolean, mine = true): TreasuryEligibility {
  // `mine` = the passport belongs to the person reading. Another member's passport is described in the third person.
  if (!daoVerified) return { eligible: false, reason: 'The treasury account did not pass the app\'s DAO trust checks, so treasury requests are switched off.' }
  if (!lendingEnabled) return { eligible: false, reason: 'Treasury lending needs a DAO and at least 2 active stewards in this circle.' }
  if (!passport) return { eligible: false, reason: 'Join the circle first.' }
  if (passport.status !== 'Active') return { eligible: false, reason: `${mine ? 'Your' : 'This'} passport is ${passport.status}.` }
  if (passport.steward) return { eligible: false, reason: 'Stewards approve treasury loans, so they cannot borrow from the treasury.' }
  if (passport.perks_paused) return { eligible: false, reason: mine ? 'An overdue loan pauses Trusted perks. Repay it (or ask the stewards to clear the flag).' : 'An overdue loan pauses this member\'s Trusted perks until it is repaid or the stewards clear the flag.' }
  if (passport.effective_tier !== 'Trusted') return { eligible: false, reason: 'Only Trusted members can borrow from the treasury.' }
  return { eligible: true, reason: mine ? 'You are Trusted and not a steward: you can ask the treasury.' : 'Trusted and not a steward: this member can ask the treasury.' }
}

/** What the passport unlocks right now, in plain words, from the circle params. */
export function privileges(passport: PassportView, params: CircleParams, hardLoanCap: U128, format: (u: U128) => string): string[] {
  const limit = borrowLimit(params, passport, hardLoanCap)
  const memberCap = borrowLimit(params, { effective_tier: 'Member' }, hardLoanCap)
  const trustedCap = borrowLimit(params, { effective_tier: 'Trusted' }, hardLoanCap)
  const out = [`Borrow ${format(limit.min)} to ${format(limit.max)} USDC per loan, up to ${limit.openAllowed} open loan${limit.openAllowed > 1 ? 's' : ''} at a time.`]
  if (limit.tier === 'Trusted') out.push(`Invite new members, and ask the DAO treasury for a loan (if not a steward).`)
  else out.push(`Trusted raises the limit from ${format(memberCap.max)} to ${format(trustedCap.max)} USDC, allows 2 open loans, invites and treasury loans.`)
  return out
}

export type Activity = { at: number; kind: 'joined' | 'requested' | 'funded' | 'repaid' | 'cancelled' | 'overdue'; text: string; loanId?: string; account: string }

const nsToMs = (ns: string | null) => (ns ? Number(BigInt(ns) / 1_000_000n) : 0)

/** Recent activity, only from timestamps the contract views return (no invented feed). Newest first. */
export function recentActivity(loans: LoanView[], passports: PassportView[], format: (u: U128) => string, label: (a: string) => string, limit = 12): Activity[] {
  const items: Activity[] = []
  for (const p of passports) items.push({ at: nsToMs(p.joined_at), kind: 'joined', account: p.owner_id, text: `${label(p.owner_id)} joined${p.invited_by ? `, invited by ${label(p.invited_by)}` : ''}` })
  for (const l of loans) {
    const lender = l.lender_is_treasury ? 'the treasury' : label(l.lender_id)
    items.push({ at: nsToMs(l.created_at), kind: 'requested', loanId: l.loan_id, account: l.borrower_id, text: `${label(l.borrower_id)} asked ${lender} for ${format(l.principal)} USDC (loan #${l.loan_id})` })
    if (l.funded_at) items.push({ at: nsToMs(l.funded_at), kind: 'funded', loanId: l.loan_id, account: l.lender_id, text: `${lender} funded loan #${l.loan_id}: ${format(l.principal)} USDC went straight to ${label(l.borrower_id)}` })
    if (l.repaid_at) items.push({ at: nsToMs(l.repaid_at), kind: 'repaid', loanId: l.loan_id, account: l.borrower_id, text: `${label(l.borrower_id)} repaid loan #${l.loan_id} ${l.repaid_on_time ? 'on time' : 'late'}` })
  }
  return items.filter((i) => i.at > 0).sort((a, b) => b.at - a.at).slice(0, limit)
}

/* ---------- evidence (written by `npm run claims` into web/evidence-status.json) ---------- */

export type ClaimStatus = { id: string; track: string; feature: string; kind: 'tx' | 'view' | 'test'; status: 'PASS' | 'FAIL'; reason: string; reference: Record<string, unknown> }
export type EvidenceStatus = { generated_at: string; source: string; claims: ClaimStatus[] }

export type TrackSummary = { track: string; feature: string; pass: number; fail: number; total: number; status: 'PASS' | 'DROPPED' | 'UNVERIFIED'; claims: ClaimStatus[] }

/** Pass count over all claims, straight from the claims harness output (never computed here). */
export function evidenceTotals(status: EvidenceStatus | null): { pass: number; total: number } {
  const claims = status?.claims ?? []
  return { pass: claims.filter((c) => c.status === 'PASS').length, total: claims.length }
}

/**
 * The judges' link "?demo=1" opens the public demo circle without a click. An invite link wins:
 * someone who was invited to a circle is never switched to the demo instead.
 */
export function wantsPublicDemo(search: string, hasInvite: boolean): boolean {
  if (hasInvite) return false
  return new URLSearchParams(search).get('demo') === '1'
}

/** Group the claims harness output by track. A track passes only when every one of its claims passed. */
export function trackSummaries(status: EvidenceStatus | null, order: string[]): TrackSummary[] {
  return order.map((track) => {
    const claims = (status?.claims ?? []).filter((c) => c.track === track)
    const pass = claims.filter((c) => c.status === 'PASS').length
    const fail = claims.length - pass
    return { track, feature: claims[0]?.feature ?? '', pass, fail, total: claims.length, claims, status: !claims.length ? 'UNVERIFIED' : fail ? 'DROPPED' : 'PASS' }
  })
}
