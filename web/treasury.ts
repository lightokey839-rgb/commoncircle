import type { FtTransferCallOutcome, LoanView, NearWallet, U128, U64 } from './circle-client'
import { viewFunction } from './rpc'

// Sputnik DAO v2 (sputnikdao2) treasury helpers. The JSON matches what ran on
// testnet with contracts/scripts/testnet-dao.sh (proposals 0-3 on
// dogs-dao.commoncircle-light.testnet).

export type SputnikRole = { name: string; kind: 'Everyone' | { Group: string[] } | { Member: string }; permissions: string[] }
export type SputnikPolicy = {
  roles: SputnikRole[]
  default_vote_policy: { weight_kind: string; quorum: string; threshold: [number, number] | string }
  proposal_bond: U128
  proposal_period: U64
}
export type TransferKind = { Transfer: { token_id: string; receiver_id: string; amount: U128; msg?: string | null } }
export type FunctionCallKind = {
  FunctionCall: { receiver_id: string; actions: Array<{ method_name: string; args: string; deposit: U128; gas: U64 }> }
}
export type ProposalKind = TransferKind | FunctionCallKind | Record<string, unknown>
export type SputnikProposal = {
  id: number
  proposer: string
  description: string
  kind: ProposalKind
  /** 'InProgress' | 'Approved' | 'Rejected' | 'Removed' | 'Expired' | 'Moved' | 'Failed' (kept open: newer Sputnik versions may add states). */
  status: string
  vote_counts: Record<string, [string, string, string]>
  votes: Record<string, string>
  submission_time: U64
}

export const ADD_PROPOSAL_GAS = '50000000000000' // 50 Tgas
export const VOTE_GAS = '300000000000000' // 300 Tgas: the executing vote runs ft_transfer_call and the circle callback
export const DEMO_TREASURY_LOAN_DAYS = 7 // DEMO circles use 60-second days: 7 days = 7 minutes to repay

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64(text: string): string {
  const binary = atob(text)
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

export function stewardsOf(policy: SputnikPolicy): string[] {
  const role = policy.roles.find((r) => typeof r.kind === 'object' && 'Group' in r.kind && r.permissions.some((p) => p === '*:*' || p.endsWith(':VoteApprove')))
  return role && typeof role.kind === 'object' && 'Group' in role.kind ? [...role.kind.Group].sort() : []
}

/** The member's request: the DAO calls USDC ft_transfer_call to the circle with a fund msg. */
export function treasuryFundProposal(input: { usdcId: string; circleContractId: string; loanId: U64; amount: U128; borrowerId: string }) {
  return {
    proposal: {
      description: `CommonCircle treasury loan ${input.loanId}: ${formatUsdc(input.amount)} USDC to ${input.borrowerId} (Trusted, not a steward)`,
      kind: {
        Transfer: {
          token_id: input.usdcId,
          receiver_id: input.circleContractId,
          amount: input.amount,
          msg: JSON.stringify({ action: 'fund', loan_id: input.loanId }),
        },
      } satisfies TransferKind,
    },
  }
}

/** F-09: stewards forgive a late or overdue flag; the DAO (circle admin) calls clear_flag. */
export function clearFlagProposal(input: { circleContractId: string; loanId: U64 }) {
  return {
    proposal: {
      description: `CommonCircle: forgive the late flag on loan ${input.loanId}`,
      kind: {
        FunctionCall: {
          receiver_id: input.circleContractId,
          actions: [{ method_name: 'clear_flag', args: encodeBase64(JSON.stringify({ loan_id: input.loanId })), deposit: '1', gas: '30000000000000' }],
        },
      } satisfies FunctionCallKind,
    },
  }
}

/** The loan a proposal acts on, if it is a treasury fund or a clear_flag proposal. */
export function proposalLoanId(proposal: SputnikProposal): { loanId: U64; action: 'fund' | 'clear_flag' } | null {
  const kind = proposal.kind as Partial<TransferKind & FunctionCallKind>
  if (kind.Transfer?.msg) {
    try {
      const msg = JSON.parse(kind.Transfer.msg) as { action?: string; loan_id?: string }
      if (msg.action === 'fund' && msg.loan_id) return { loanId: msg.loan_id, action: 'fund' }
    } catch { /* not ours */ }
  }
  const call = kind.FunctionCall?.actions?.find((a) => a.method_name === 'clear_flag')
  if (call) {
    try {
      const args = JSON.parse(decodeBase64(call.args)) as { loan_id?: string }
      if (args.loan_id) return { loanId: args.loan_id, action: 'clear_flag' }
    } catch { /* not ours */ }
  }
  return null
}

/**
 * Why an open vote can no longer take effect, in plain words; null while it still can, or when the
 * loan is not known. The proposal itself stays "InProgress" on the DAO until it expires there.
 */
export function staleProposalNote(status: string, action: 'fund' | 'clear_flag' | null, loan: LoanView | null, nowMs: number): string | null {
  if (status !== 'InProgress' || !action || !loan) return null
  if (action === 'clear_flag') return loan.flag_cleared ? `the late mark on loan #${loan.loan_id} was already forgiven` : null
  if (loan.state === 'Cancelled') return `loan #${loan.loan_id} was cancelled, so this vote can no longer pay it`
  if (loan.state !== 'Open') return `loan #${loan.loan_id} is already ${loan.state.toLowerCase()}`
  if (Number(BigInt(loan.funding_deadline) / 1_000_000n) <= nowMs) return `loan #${loan.loan_id} passed its funding deadline, so this vote can no longer pay it`
  return null
}

/** Open treasury loans of this borrower that no live (InProgress or Approved) fund proposal covers yet. */
export function loansNeedingProposal(loans: LoanView[], daoId: string, borrowerId: string, proposals: SputnikProposal[]): LoanView[] {
  const covered = new Set(
    proposals
      .filter((p) => p.status === 'InProgress' || p.status === 'Approved')
      .map(proposalLoanId)
      .filter((x): x is { loanId: U64; action: 'fund' } => x?.action === 'fund')
      .map((x) => x.loanId),
  )
  return loans.filter((l) => l.lender_id === daoId && l.borrower_id === borrowerId && l.state === 'Open' && !covered.has(l.loan_id))
}

export function formatUsdc(baseUnits: U128): string {
  const v = BigInt(baseUnits)
  const whole = v / 1_000_000n
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

export function usdcToBaseUnits(text: string): U128 {
  const t = text.trim()
  if (!/^\d+(\.\d{1,6})?$/.test(t)) throw new Error('Enter a USDC amount such as 1 or 2.5 (up to 6 decimals).')
  const [whole, frac = ''] = t.split('.')
  return (BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'))).toString()
}

/** F-09: a repayment that bounced (lender left USDC) or arrived late; what to tell the borrower. */
export function repaymentNotice(outcome: FtTransferCallOutcome | null, loan: LoanView | null): string | null {
  if (outcome?.repaymentFailed.length) {
    return 'Your repayment bounced: the lender is no longer registered with USDC, so the money was returned to you. The loan may now show as late. You can ask the stewards to clear the flag.'
  }
  if (loan && loan.state === 'Repaid' && loan.repaid_on_time === false && !loan.flag_cleared) {
    return 'Repaid, but after the due date, so it counts as late. You can ask the stewards to forgive it.'
  }
  if (loan && loan.overdue && !loan.flag_cleared) {
    return 'This loan is overdue, so your Trusted perks are paused until it is repaid or the stewards clear the flag.'
  }
  return null
}

export class SputnikDaoClient {
  constructor(readonly rpcUrl: string, readonly daoId: string, readonly wallet?: NearWallet) {}

  async view<T>(methodName: string, args: Record<string, unknown> = {}): Promise<T> {
    const { ok, payload: body } = await viewFunction(this.rpcUrl, this.daoId, methodName, encodeBase64(JSON.stringify(args)))
    if (!ok || body.error || !body.result?.result) throw new Error(`DAO view ${methodName} failed`)
    return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T
  }

  getPolicy(): Promise<SputnikPolicy> { return this.view('get_policy') }
  getLastProposalId(): Promise<number> { return this.view('get_last_proposal_id') }
  getProposal(id: number): Promise<SputnikProposal> { return this.view('get_proposal', { id }) }

  async recentProposals(limit = 10): Promise<SputnikProposal[]> {
    const last = await this.getLastProposalId()
    const from = Math.max(0, last - limit)
    if (last === 0) return []
    const list = await this.view<SputnikProposal[]>('get_proposals', { from_index: from, limit })
    return list.sort((a, b) => b.id - a.id)
  }

  private send(methodName: string, args: Record<string, unknown>, deposit: U128, gas: U64): Promise<unknown> {
    if (!this.wallet) throw new Error('Connect a NEAR wallet first.')
    return this.wallet.signAndSendTransaction({
      receiverId: this.daoId,
      actions: [{ type: 'FunctionCall', params: { methodName, args, gas, deposit } }],
    })
  }

  /** Anyone may file transfer or call proposals (role "members-may-ask"); the bond is returned when it passes. */
  addProposal(proposal: { proposal: unknown }, bond: U128): Promise<unknown> {
    return this.send('add_proposal', proposal, bond, ADD_PROPOSAL_GAS)
  }

  /** Steward approval. Sputnik requires the proposal kind to be echoed back. */
  approve(proposal: SputnikProposal): Promise<unknown> {
    return this.send('act_proposal', { id: proposal.id, action: 'VoteApprove', proposal: proposal.kind }, '0', VOTE_GAS)
  }
}
