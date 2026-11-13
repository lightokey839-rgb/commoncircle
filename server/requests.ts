/** CommonCircle loan requests in the circle chat (members only).
 *
 * A member posts a request card (amount, days, reason) to the circle room: no gas,
 * nothing on-chain yet. Other members offer to lend. The borrower picks one of
 * them, signs `create_loan` naming that lender in their own wallet, and links the
 * resulting loan id here. The server checks the link against the chain
 * (`get_loan`): same borrower, circle, amount and days, and a lender who offered;
 * one on-chain loan can be linked to one card only.
 * A direct loan (lender named up front) is recorded the same way, already linked.
 *
 * The reason text lives only here (the contract has no field for it). It is
 * access-controlled like the chat, NOT end-to-end encrypted, and never on-chain.
 * The server never signs anything and never moves money.
 *
 * Every change is a read-check-write under a per-room lock in the store
 * (server/store.ts), so two server processes cannot both win a race.
 */

import { dirname } from 'node:path'
import { ChatError, MembershipGate, type AccessCheck } from './chat.ts'
import { DuplicateLoanLink, FileStore, MemoryStore, RequestNotFound, type CircleStore, type LoanRequest } from './store.ts'

export type { LoanRequest } from './store.ts'
export type ChainLoan = { loan_id: string; circle_id: string; borrower_id: string; lender_id: string; principal: string; duration_days: number }
export type LoanLookup = (loanId: string) => Promise<ChainLoan | null>

export const MAX_NOTE = 500
export const MAX_OPEN_PER_BORROWER = 3
const LIST_LIMIT = 300
const HIDDEN = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F؜​-‏‪-‮⁠-⁩﻿]/u

export function cleanNote(input: unknown): string {
  const text = typeof input === 'string' ? input.replace(/\r\n?/g, '\n').trim() : ''
  if (!text) throw new ChatError(400, 'REQ_NOTE', 'Say in a few words what the loan is for.')
  if ([...text].length > MAX_NOTE) throw new ChatError(400, 'REQ_NOTE', `Keep the reason under ${MAX_NOTE} characters.`)
  if (HIDDEN.test(text)) throw new ChatError(400, 'REQ_NOTE', 'The reason contains hidden or direction-changing characters.')
  return text
}

function cleanAmount(input: unknown): string {
  if (typeof input !== 'string' || !/^[1-9]\d{0,17}$/.test(input)) throw new ChatError(400, 'REQ_AMOUNT', 'Enter an amount in USDC.')
  return input
}

function cleanDays(input: unknown): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1 || input > 3650) throw new ChatError(400, 'REQ_DAYS', 'Choose a whole number of days.')
  return input
}

function requestId(input: unknown): number {
  const id = typeof input === 'number' ? input : typeof input === 'string' && /^\d{1,15}$/.test(input) ? Number(input) : NaN
  if (!Number.isSafeInteger(id) || id < 1) throw new ChatError(404, 'REQ_NOT_FOUND', 'That request no longer exists.')
  return id
}

export type RequestDeps = {
  checkAccess: AccessCheck
  getLoan: LoanLookup
  now?: () => number
  /** Development only: a JSON file. Ignored when `store` is given. */
  storePath?: string
  store?: CircleStore
  gate?: MembershipGate
  retryMs?: number
}

export class RequestService {
  readonly store: CircleStore
  private readonly gate: MembershipGate
  private readonly getLoan: LoanLookup
  private readonly nowFn: () => number
  private readonly retries: number
  private readonly retryMs: number

  constructor(deps: RequestDeps) {
    this.nowFn = deps.now ?? (() => Date.now())
    this.getLoan = deps.getLoan
    this.store = deps.store ?? (deps.storePath ? new FileStore(dirname(deps.storePath), { chat: `${deps.storePath}.chat.json`, requests: deps.storePath }) : new MemoryStore())
    this.gate = deps.gate ?? new MembershipGate(deps.checkAccess, this.nowFn)
    this.retryMs = deps.retryMs ?? 1500
    this.retries = this.retryMs ? 6 : 1
  }

  private member(circleId: string, accountId: string): Promise<void> {
    return this.gate.require(circleId, accountId, 'its loan requests')
  }

  /** The store's update, with its errors turned into plain API errors. */
  private async update(circleId: string, id: unknown, mutate: (r: LoanRequest, room: LoanRequest[]) => LoanRequest): Promise<LoanRequest> {
    try {
      return await this.store.updateRequest(circleId, requestId(id), mutate)
    } catch (error) {
      if (error instanceof RequestNotFound) throw new ChatError(404, 'REQ_NOT_FOUND', 'That request no longer exists.')
      if (error instanceof DuplicateLoanLink) throw new ChatError(409, 'REQ_DUPLICATE', 'That loan already has a request card.')
      throw error
    }
  }

  async list(accountId: string, circleId: string): Promise<LoanRequest[]> {
    await this.member(circleId, accountId)
    return this.store.listRequests(circleId, LIST_LIMIT)
  }

  /** Post a request card to the circle room. Nothing on-chain yet. */
  async create(accountId: string, circleId: string, input: { amount?: unknown; days?: unknown; note?: unknown }): Promise<LoanRequest> {
    const amount = cleanAmount(input.amount)
    const days = cleanDays(input.days)
    const note = cleanNote(input.note)
    await this.member(circleId, accountId)
    return this.store.createRequest(
      { circle_id: circleId, borrower: accountId, amount, days, note, at: this.nowFn(), offers: [], lender: null, loan_id: null, cancelled: false, direct: false },
      (room) => {
        const open = room.filter((r) => r.borrower === accountId && !r.cancelled && !r.loan_id)
        if (open.length >= MAX_OPEN_PER_BORROWER) throw new ChatError(409, 'REQ_TOO_MANY', `You already have ${MAX_OPEN_PER_BORROWER} open requests here. Cancel one first.`)
      })
  }

  /** Offer to lend (or withdraw the offer). Any member except the borrower, while the request is open. */
  async offer(accountId: string, circleId: string, id: unknown): Promise<LoanRequest> {
    await this.member(circleId, accountId)
    return this.update(circleId, id, (r) => {
      if (r.borrower === accountId) throw new ChatError(400, 'REQ_SELF', 'You cannot lend to yourself.')
      if (r.cancelled || r.loan_id) throw new ChatError(409, 'REQ_CLOSED', 'This request already has its lender.')
      r.offers = r.offers.includes(accountId) ? r.offers.filter((a) => a !== accountId) : [...r.offers, accountId]
      return r
    })
  }

  /** The borrower withdraws a request that has no on-chain loan yet. */
  async cancel(accountId: string, circleId: string, id: unknown): Promise<LoanRequest> {
    await this.member(circleId, accountId)
    return this.update(circleId, id, (r) => {
      if (r.borrower !== accountId) throw new ChatError(403, 'REQ_NOT_BORROWER', 'Only the person who asked can cancel this request.')
      if (r.loan_id) throw new ChatError(409, 'REQ_LINKED', 'This request is already a loan on-chain. Cancel it with "Cancel request" on the loan.')
      r.cancelled = true
      return r
    })
  }

  /** After the borrower's `create_loan`, link the on-chain loan, checked against the chain. */
  async link(accountId: string, circleId: string, id: unknown, loanIdInput: unknown): Promise<LoanRequest> {
    await this.member(circleId, accountId)
    const rid = requestId(id)
    // Cheap checks first (no chain call for a request that cannot be linked).
    const before = (await this.store.listRequests(circleId, 1000)).find((r) => r.id === rid)
    if (!before) throw new ChatError(404, 'REQ_NOT_FOUND', 'That request no longer exists.')
    const check = (r: LoanRequest): 'same' | 'open' => {
      if (r.borrower !== accountId) throw new ChatError(403, 'REQ_NOT_BORROWER', 'Only the person who asked can link the loan.')
      if (r.cancelled) throw new ChatError(409, 'REQ_CLOSED', 'This request was cancelled.')
      // Once linked, a request keeps its loan and lender. Re-sending the same loan id (a retry
      // after a dropped response) is a no-op; a different loan id is refused.
      if (r.loan_id !== null) {
        if (r.loan_id === loanIdInput) return 'same'
        throw new ChatError(409, 'REQ_ALREADY_LINKED', `This request is already linked to loan #${r.loan_id}.`)
      }
      return 'open'
    }
    if (check(before) === 'same') return before
    const loan = await this.chainLoan(loanIdInput)
    if (loan.borrower_id !== accountId || loan.circle_id !== circleId || loan.principal !== before.amount || loan.duration_days !== before.days) {
      throw new ChatError(409, 'REQ_MISMATCH', 'That on-chain loan does not match this request.')
    }
    // Re-check everything under the room lock: a concurrent link may have landed meanwhile.
    return this.update(circleId, rid, (r, room) => {
      if (check(r) === 'same') return r
      if (!r.offers.includes(loan.lender_id)) throw new ChatError(409, 'REQ_LENDER', 'The loan names someone who did not offer to lend.')
      if (room.some((x) => x.loan_id === loan.loan_id && x.id !== r.id)) throw new ChatError(409, 'REQ_DUPLICATE', 'That loan already has a request card.')
      r.loan_id = loan.loan_id
      r.lender = loan.lender_id
      return r
    })
  }

  /** A direct loan (lender named up front): record its reason, checked against the chain. */
  async direct(accountId: string, circleId: string, input: { loan_id?: unknown; note?: unknown }): Promise<LoanRequest> {
    const note = cleanNote(input.note)
    await this.member(circleId, accountId)
    const loan = await this.chainLoan(input.loan_id)
    if (loan.borrower_id !== accountId || loan.circle_id !== circleId) throw new ChatError(403, 'REQ_NOT_BORROWER', 'Only the borrower of that loan can add its reason.')
    try {
      return await this.store.createRequest(
        { circle_id: circleId, borrower: accountId, amount: loan.principal, days: loan.duration_days, note, at: this.nowFn(), offers: [loan.lender_id], lender: loan.lender_id, loan_id: loan.loan_id, cancelled: false, direct: true },
        (room) => { if (room.some((x) => x.loan_id === loan.loan_id)) throw new ChatError(409, 'REQ_DUPLICATE', 'That loan already has a request card.') })
    } catch (error) {
      if (error instanceof DuplicateLoanLink) throw new ChatError(409, 'REQ_DUPLICATE', 'That loan already has a request card.')
      throw error
    }
  }

  private async chainLoan(loanIdInput: unknown): Promise<ChainLoan> {
    const loanId = typeof loanIdInput === 'string' && /^\d{1,19}$/.test(loanIdInput) ? loanIdInput : null
    if (!loanId) throw new ChatError(400, 'REQ_LOAN', 'Unknown loan number.')
    // A just-sent loan reaches "final" a couple of seconds after the wallet returns: retry briefly.
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const loan = await this.getLoan(loanId)
      if (loan) return loan
      if (attempt + 1 < this.retries) await new Promise((resolve) => setTimeout(resolve, this.retryMs))
    }
    throw new ChatError(404, 'REQ_LOAN', 'That loan is not on-chain (yet). Try again in a few seconds.')
  }
}

/** `get_loan` through a NEAR RPC view. */
export function rpcLoanLookup(rpcUrl: string, contractId: string, timeoutMs = 8000): LoanLookup {
  return async (loanId) => {
    const args = Buffer.from(JSON.stringify({ loan_id: loanId })).toString('base64')
    let body: { result?: { result?: number[] } }
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          jsonrpc: '2.0', id: 'req-loan', method: 'query',
          params: { request_type: 'call_function', finality: 'final', account_id: contractId, method_name: 'get_loan', args_base64: args },
        }),
      })
      body = await response.json() as { result?: { result?: number[] } }
    } catch {
      throw new ChatError(503, 'REQ_RPC', 'Could not read the loan on testnet. Try again.')
    }
    if (!body.result?.result) throw new ChatError(503, 'REQ_RPC', 'Could not read the loan on testnet. Try again.')
    return JSON.parse(Buffer.from(body.result.result).toString()) as ChainLoan | null
  }
}
