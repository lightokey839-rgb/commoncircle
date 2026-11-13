import { txHashOf, type FtTransferCallOutcome, type LoanView, type U128 } from './circle-client'
import { loanLengthText } from './loan-rules'
import { friendlyError } from './notify'
import { formatUsdc, repaymentNotice } from './treasury'

// Every money action (fund, repay, cancel) goes: plain summary -> pending ->
// success or failure, with an explorer link to the transaction. The contract
// calls are injected, so tests/money.test.ts runs the flows on mocks.

export type MoneyKind = 'fund' | 'repay' | 'cancel'

export type MoneyDeps = {
  fundLoan(input: { usdcId: string; loanId: string; amount: U128 }): Promise<FtTransferCallOutcome>
  repayLoan(input: { usdcId: string; loanId: string; amount: U128 }): Promise<FtTransferCallOutcome>
  cancelLoan(loanId: string): Promise<unknown>
  getLoan(loanId: string): Promise<LoanView | null>
  /** NEP-145: is the account registered with USDC (can it receive)? */
  isRegistered(accountId: string): Promise<boolean>
  /** NEP-145 storage_deposit for another account, paid by the signer (0.00125 NEAR). Optional. */
  registerAccount?(accountId: string): Promise<unknown>
}

/** Options the dialog collects before signing. */
export type MoneyOptions = { registerLender?: boolean }

/** The USDC storage deposit for one account (NEP-145, registration_only), in NEAR, shown before signing. */
export const USDC_REGISTRATION_NEAR = '0.00125'

export type MoneyResult = { ok: boolean; text: string; txHash: string | null }

export type MoneySummary = { title: string; lines: string[]; confirm: string }

/** What will happen, in plain words: who pays whom, how much, due when. */
export function moneySummary(kind: MoneyKind, loan: LoanView, label: (account: string) => string, dayLengthSec: string, options: MoneyOptions = {}): MoneySummary {
  const amount = `${formatUsdc(kind === 'repay' ? loan.outstanding : loan.principal)} USDC`
  const length = loanLengthText(loan.duration_days, dayLengthSec)
  if (kind === 'fund') {
    return {
      title: `Fund loan #${loan.loan_id}`,
      lines: [
        `You send ${amount} to ${label(loan.borrower_id)}. It goes straight to them; the circle never holds it.`,
        `They repay you within ${length} after the money arrives.`,
        'There is no interest, and repayment cannot be forced.',
      ],
      confirm: `Send ${amount}`,
    }
  }
  if (kind === 'repay') {
    return {
      title: `Repay loan #${loan.loan_id}`,
      lines: [
        `You pay ${amount} back to ${loan.lender_is_treasury ? 'the circle treasury (DAO)' : label(loan.lender_id)}.`,
        loan.overdue ? 'This loan is past its due time, so it will count as late.' : 'Paying before the due time counts as on time.',
        ...(options.registerLender ? [`${label(loan.lender_id)} is no longer set up to receive USDC, so a repayment would bounce back to you. First you pay ${USDC_REGISTRATION_NEAR} NEAR to set up their USDC account (a storage deposit), then the repayment. That is two wallet approvals.`] : []),
      ],
      confirm: options.registerLender ? `Set up their USDC (${USDC_REGISTRATION_NEAR} NEAR), then pay ${amount}` : `Pay ${amount}`,
    }
  }
  return {
    title: `Cancel request #${loan.loan_id}`,
    lines: [`You withdraw your request for ${amount} from ${label(loan.lender_id)}. No money moves.`],
    confirm: 'Cancel request',
  }
}

/** Run one money action and turn every outcome into a plain result. Never throws. */
export async function runMoney(kind: MoneyKind, loan: LoanView, deps: MoneyDeps, usdcId: string, label: (account: string) => string, options: MoneyOptions = {}): Promise<MoneyResult> {
  try {
    if (kind === 'fund') {
      if (!(await deps.isRegistered(loan.borrower_id))) {
        return { ok: false, txHash: null, text: `${label(loan.borrower_id)} is not set up to receive USDC yet, so nothing was sent. Ask them to finish step 4 on Home.` }
      }
      const outcome = await deps.fundLoan({ usdcId, loanId: loan.loan_id, amount: loan.principal })
      if (outcome.fundingFailed.length || outcome.refunded.length) {
        return { ok: false, txHash: outcome.txHash, text: 'Funding did not go through, and your USDC came straight back to you.' }
      }
      return { ok: true, txHash: outcome.txHash, text: `Sent ${formatUsdc(loan.principal)} USDC to ${label(loan.borrower_id)}. The repayment clock has started.` }
    }
    if (kind === 'repay') {
      if (options.registerLender) {
        if (!deps.registerAccount) return { ok: false, txHash: null, text: 'This wallet connection cannot set up the lender’s USDC account.' }
        await deps.registerAccount(loan.lender_id)
      }
      const outcome = await deps.repayLoan({ usdcId, loanId: loan.loan_id, amount: loan.outstanding })
      const after = await deps.getLoan(loan.loan_id).catch(() => null)
      if (outcome.repaymentFailed.length) return { ok: false, txHash: outcome.txHash, text: repaymentNotice(outcome, after) ?? 'Your repayment bounced and the money came back to you.' }
      const late = repaymentNotice(null, after)
      return { ok: true, txHash: outcome.txHash, text: late ?? `Repaid on time: ${formatUsdc(loan.outstanding)} USDC went back to ${loan.lender_is_treasury ? 'the treasury' : label(loan.lender_id)}.` }
    }
    const raw = await deps.cancelLoan(loan.loan_id)
    return { ok: true, txHash: txHashOf(raw), text: `Request #${loan.loan_id} is cancelled. No money moved.` }
  } catch (error) {
    return { ok: false, txHash: null, text: friendlyError(error, 'chain').text }
  }
}

/** Explorer link for a transaction hash (base URL comes from config). */
export function explorerTxUrl(explorerBase: string, hash: string): string {
  return `${explorerBase.replace(/\/$/, '')}/txns/${hash}`
}
