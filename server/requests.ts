/** CommonCircle loan requests in the circle chat (members only), LoanBook-style.
 *
 * A member posts a request card (amount, days, reason) to the circle room: no gas,
 * nothing on-chain yet. Other members offer to lend. The borrower picks one of
 * them, signs `create_loan` naming that lender in their own wallet, and links the
 * resulting loan id here. The server checks the link against the chain
 * (`get_loan`): same borrower, circle, amount and days, and a lender who offered.
 * A direct loan (lender named up front) is recorded the same way, already linked.
 *
 * The reason text lives only here (the contract has no field for it). It is
 * access-controlled like the chat, NOT end-to-end encrypted, and never on-chain.
 * The server never signs anything and never moves money.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ChatError, pruneAccess, type AccessCheck } from './chat.ts'

export type ChainLoan = { loan_id: string; circle_id: string; borrower_id: string; lender_id: string; principal: string; duration_days: number }
export type LoanLookup = (loanId: string) => Promise<ChainLoan | null>

export type LoanRequest = {
  id: number
  circle_id: string
  borrower: string
  amount: string // USDC base units (6 decimals), U128 string
  days: number
  note: string
  at: number
  offers: string[]
  lender: string | null
  loan_id: string | null
  cancelled: boolean
  direct: boolean
}

export const MAX_NOTE = 500
const MAX_PER_ROOM = 300
const ACCESS_TTL_MS = 20_000
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

export class RequestService {
  private rooms = new Map<string, LoanRequest[]>()
  private nextId = 1
  private access = new Map<string, { allowed: boolean; until: number }>()
  private readonly deps: { checkAccess: AccessCheck; getLoan: LoanLookup; now?: () => number; storePath?: string; retryMs?: number }
  private readonly retries: number
  private readonly retryMs: number

  constructor(deps: { checkAccess: AccessCheck; getLoan: LoanLookup; now?: () => number; storePath?: string; retryMs?: number }) {
    this.deps = deps
    this.retryMs = deps.retryMs ?? 1500
    this.retries = this.retryMs ? 6 : 1
    if (deps.storePath) this.load(deps.storePath)
  }

  private now(): number { return this.deps.now?.() ?? Date.now() }

  private load(path: string): void {
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8')) as { rooms?: Record<string, LoanRequest[]> }
      for (const [circleId, list] of Object.entries(saved.rooms ?? {})) {
        this.rooms.set(circleId, list)
        for (const r of list) this.nextId = Math.max(this.nextId, r.id + 1)
      }
    } catch { /* nothing saved yet */ }
  }

  private save(): void {
    if (!this.deps.storePath) return
    mkdirSync(dirname(this.deps.storePath), { recursive: true })
    writeFileSync(this.deps.storePath, JSON.stringify({ rooms: Object.fromEntries(this.rooms) }))
  }

  private async requireMember(circleId: string, accountId: string): Promise<void> {
    if (!/^\d{1,19}$/.test(circleId)) throw new ChatError(400, 'CHAT_CIRCLE', 'Unknown circle.')
    const key = `${circleId}:${accountId}`
    const cached = this.access.get(key)
    let allowed = cached && cached.until > this.now() ? cached.allowed : undefined
    if (allowed === undefined) {
      allowed = (await this.deps.checkAccess(circleId, accountId)).allowed
      pruneAccess(this.access, this.now())
      this.access.set(key, { allowed, until: this.now() + ACCESS_TTL_MS })
    }
    if (!allowed) throw new ChatError(403, 'CHAT_NOT_MEMBER', 'Only members with an active card in this circle can see its loan requests.')
  }

  private find(circleId: string, id: unknown): LoanRequest {
    const r = (this.rooms.get(circleId) ?? []).find((x) => x.id === Number(id))
    if (!r) throw new ChatError(404, 'REQ_NOT_FOUND', 'That request no longer exists.')
    return r
  }

  private add(r: Omit<LoanRequest, 'id'>): LoanRequest {
    const request = { id: this.nextId++, ...r }
    const room = this.rooms.get(r.circle_id) ?? []
    room.push(request)
    this.rooms.set(r.circle_id, room.slice(-MAX_PER_ROOM))
    this.save()
    return request
  }

  async list(accountId: string, circleId: string): Promise<LoanRequest[]> {
    await this.requireMember(circleId, accountId)
    return this.rooms.get(circleId) ?? []
  }

  /** Post a request card to the circle room. Nothing on-chain yet. */
  async create(accountId: string, circleId: string, input: { amount?: unknown; days?: unknown; note?: unknown }): Promise<LoanRequest> {
    const amount = cleanAmount(input.amount)
    const days = cleanDays(input.days)
    const note = cleanNote(input.note)
    await this.requireMember(circleId, accountId)
    const open = (this.rooms.get(circleId) ?? []).filter((r) => r.borrower === accountId && !r.cancelled && !r.loan_id)
    if (open.length >= 3) throw new ChatError(409, 'REQ_TOO_MANY', 'You already have 3 open requests here. Cancel one first.')
    return this.add({ circle_id: circleId, borrower: accountId, amount, days, note, at: this.now(), offers: [], lender: null, loan_id: null, cancelled: false, direct: false })
  }

  /** Offer to lend (or withdraw the offer). Any member except the borrower, while the request is open. */
  async offer(accountId: string, circleId: string, id: unknown): Promise<LoanRequest> {
    await this.requireMember(circleId, accountId)
    const r = this.find(circleId, id)
    if (r.borrower === accountId) throw new ChatError(400, 'REQ_SELF', 'You cannot lend to yourself.')
    if (r.cancelled || r.loan_id) throw new ChatError(409, 'REQ_CLOSED', 'This request already has its lender.')
    r.offers = r.offers.includes(accountId) ? r.offers.filter((a) => a !== accountId) : [...r.offers, accountId]
    this.save()
    return r
  }

  /** The borrower withdraws a request that has no on-chain loan yet. */
  async cancel(accountId: string, circleId: string, id: unknown): Promise<LoanRequest> {
    await this.requireMember(circleId, accountId)
    const r = this.find(circleId, id)
    if (r.borrower !== accountId) throw new ChatError(403, 'REQ_NOT_BORROWER', 'Only the person who asked can cancel this request.')
    if (r.loan_id) throw new ChatError(409, 'REQ_LINKED', 'This request is already a loan on-chain. Cancel it with "Cancel request" on the loan.')
    r.cancelled = true
    this.save()
    return r
  }

  /** After the borrower's `create_loan`, link the on-chain loan, checked against the chain. */
  async link(accountId: string, circleId: string, id: unknown, loanIdInput: unknown): Promise<LoanRequest> {
    await this.requireMember(circleId, accountId)
    const r = this.find(circleId, id)
    if (r.borrower !== accountId) throw new ChatError(403, 'REQ_NOT_BORROWER', 'Only the person who asked can link the loan.')
    if (r.cancelled) throw new ChatError(409, 'REQ_CLOSED', 'This request was cancelled.')
    // Once linked, a request keeps its loan and lender. Re-sending the same loan id (a retry
    // after a dropped response) is a no-op; a different loan id is refused.
    if (r.loan_id !== null) {
      if (r.loan_id === loanIdInput) return r
      throw new ChatError(409, 'REQ_ALREADY_LINKED', `This request is already linked to loan #${r.loan_id}.`)
    }
    const loan = await this.chainLoan(loanIdInput)
    if (loan.borrower_id !== accountId || loan.circle_id !== circleId || loan.principal !== r.amount || loan.duration_days !== r.days) {
      throw new ChatError(409, 'REQ_MISMATCH', 'That on-chain loan does not match this request.')
    }
    if (!r.offers.includes(loan.lender_id)) throw new ChatError(409, 'REQ_LENDER', 'The loan names someone who did not offer to lend.')
    this.assertUnlinked(circleId, loan.loan_id, r.id)
    // Re-check after the chain lookup: a concurrent link may have landed meanwhile.
    if (r.loan_id !== null && r.loan_id !== loan.loan_id) {
      throw new ChatError(409, 'REQ_ALREADY_LINKED', `This request is already linked to loan #${r.loan_id}.`)
    }
    r.loan_id = loan.loan_id
    r.lender = loan.lender_id
    this.save()
    return r
  }

  /** A direct loan (lender named up front): record its reason, checked against the chain. */
  async direct(accountId: string, circleId: string, input: { loan_id?: unknown; note?: unknown }): Promise<LoanRequest> {
    const note = cleanNote(input.note)
    await this.requireMember(circleId, accountId)
    const loan = await this.chainLoan(input.loan_id)
    if (loan.borrower_id !== accountId || loan.circle_id !== circleId) throw new ChatError(403, 'REQ_NOT_BORROWER', 'Only the borrower of that loan can add its reason.')
    this.assertUnlinked(circleId, loan.loan_id, -1)
    return this.add({ circle_id: circleId, borrower: accountId, amount: loan.principal, days: loan.duration_days, note, at: this.now(),
      offers: [loan.lender_id], lender: loan.lender_id, loan_id: loan.loan_id, cancelled: false, direct: true })
  }

  private async chainLoan(loanIdInput: unknown): Promise<ChainLoan> {
    const loanId = typeof loanIdInput === 'string' && /^\d{1,19}$/.test(loanIdInput) ? loanIdInput : null
    if (!loanId) throw new ChatError(400, 'REQ_LOAN', 'Unknown loan number.')
    // A just-sent loan reaches "final" a couple of seconds after the wallet returns: retry briefly.
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const loan = await this.deps.getLoan(loanId)
      if (loan) return loan
      await new Promise((resolve) => setTimeout(resolve, this.retryMs))
    }
    throw new ChatError(404, 'REQ_LOAN', 'That loan is not on-chain (yet). Try again in a few seconds.')
  }

  private assertUnlinked(circleId: string, loanId: string, exceptId: number): void {
    if ((this.rooms.get(circleId) ?? []).some((x) => x.loan_id === loanId && x.id !== exceptId)) {
      throw new ChatError(409, 'REQ_DUPLICATE', 'That loan already has a request card.')
    }
  }
}

/** `get_loan` through a NEAR RPC view. */
export function rpcLoanLookup(rpcUrl: string, contractId: string): LoanLookup {
  return async (loanId) => {
    const args = Buffer.from(JSON.stringify({ loan_id: loanId })).toString('base64')
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'req-loan', method: 'query',
        params: { request_type: 'call_function', finality: 'final', account_id: contractId, method_name: 'get_loan', args_base64: args },
      }),
    })
    const body = await response.json() as { result?: { result?: number[] } }
    if (!body.result?.result) throw new ChatError(503, 'REQ_RPC', 'Could not read the loan on testnet. Try again.')
    return JSON.parse(Buffer.from(body.result.result).toString()) as ChainLoan | null
  }
}
