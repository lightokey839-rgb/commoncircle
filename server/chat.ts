/** CommonCircle circle chat (members only).
 *
 * One room per circle. Reading and posting both require an Active passport in
 * that circle, checked on-chain with `check_access` (see MembershipGate). The
 * caller's identity comes from the NEP-413 sign-in token, verified by the
 * caller of this module. Messages are access-controlled, NOT end-to-end
 * encrypted: the server stores them in plain text, and they are never on-chain.
 *
 * Storage is a CircleStore (server/store.ts): PostgreSQL in production, a JSON
 * file for local development, memory in tests.
 */

import { dirname } from 'node:path'
import { FileStore, MemoryStore, type ChatMessage, type CircleStore } from './store.ts'

export type { ChatMessage } from './store.ts'
export type AccessCheck = (circleId: string, accountId: string) => Promise<{ allowed: boolean; display_tier?: string | null }>

// Plain fields, not parameter properties: `node server/auth.ts` only strips types.
export class ChatError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const MAX_TEXT = 1000
/** Most messages one page returns. */
export const MAX_ROOM = 200
export const RATE_WINDOW_MS = 30_000
export const RATE_MAX = 8
/** A "yes, member" answer is reused this long; a revoked or banned passport loses access within it. */
export const ACCESS_TTL_MS = 15_000
/** A "not a member" answer is reused only briefly, so a member who just joined gets in fast. */
export const DENIED_TTL_MS = 5_000
export const MAX_ACCESS_CACHE = 10_000

/** The membership cache is keyed by any circle id a signed-in caller names: keep it bounded.
 * Once it is full, drop expired entries, and clear it if that is not enough (it is only a cache). */
export function pruneAccess(cache: Map<string, { until: number }>, now: number, max = MAX_ACCESS_CACHE): void {
  if (cache.size < max) return
  for (const [key, value] of cache) if (value.until <= now) cache.delete(key)
  if (cache.size >= max) cache.clear()
}

const RPC_DOWN = 'Could not check your membership on NEAR testnet just now. Try again in a moment.'

/**
 * Server-side membership check shared by the chat and the request cards.
 * - Fails closed: if testnet cannot be asked, the caller gets a 503 "try again"
 *   (never "you are not a member", and never access).
 * - RPC failures are never cached; denials only for DENIED_TTL_MS.
 */
export class MembershipGate {
  readonly cache = new Map<string, { allowed: boolean; until: number }>()
  private readonly checkAccess: AccessCheck
  private readonly now: () => number

  constructor(checkAccess: AccessCheck, now: () => number = () => Date.now()) {
    this.checkAccess = checkAccess
    this.now = now
  }

  async require(circleId: string, accountId: string, what = 'its chat'): Promise<void> {
    if (!/^\d{1,19}$/.test(circleId)) throw new ChatError(400, 'CHAT_CIRCLE', 'Unknown circle.')
    const key = `${circleId}:${accountId}`
    const now = this.now()
    const cached = this.cache.get(key)
    let allowed = cached && cached.until > now ? cached.allowed : undefined
    if (allowed === undefined) {
      let answer: { allowed: boolean }
      try {
        answer = await this.checkAccess(circleId, accountId)
      } catch (error) {
        if (error instanceof ChatError) throw error
        throw new ChatError(503, 'CHAT_RPC', RPC_DOWN)
      }
      allowed = answer.allowed === true
      pruneAccess(this.cache, now)
      this.cache.set(key, { allowed, until: now + (allowed ? ACCESS_TTL_MS : DENIED_TTL_MS) })
    }
    if (!allowed) throw new ChatError(403, 'CHAT_NOT_MEMBER', `Only members with an active passport in this circle can use ${what}.`)
  }
}

// Same rule as the contract's names (control and direction-changing characters),
// except that line breaks are allowed in chat.
const HIDDEN = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F؜​-‏‪-‮⁠-⁩﻿]/u

export function cleanText(input: unknown): string {
  if (typeof input !== 'string') throw new ChatError(400, 'CHAT_TEXT', 'Message text is required.')
  const text = input.replace(/\r\n?/g, '\n').trim()
  if (!text) throw new ChatError(400, 'CHAT_TEXT', 'Write a message first.')
  if ([...text].length > MAX_TEXT) throw new ChatError(400, 'CHAT_TEXT', `Messages are limited to ${MAX_TEXT} characters.`)
  if (HIDDEN.test(text)) throw new ChatError(400, 'CHAT_TEXT', 'The message contains hidden or direction-changing characters.')
  return text
}

/** A non-negative whole number from a query string, or undefined. */
export function cursor(value: string | null): number | undefined {
  if (value === null || value === '') return undefined
  if (!/^\d{1,15}$/.test(value)) throw new ChatError(400, 'CHAT_CURSOR', 'Bad message cursor.')
  return Number(value)
}

export type ChatDeps = {
  checkAccess: AccessCheck
  now?: () => number
  /** Development only: a JSON file. Ignored when `store` is given. */
  storePath?: string
  store?: CircleStore
  gate?: MembershipGate
}

export class ChatService {
  readonly store: CircleStore
  private readonly gate: MembershipGate
  private readonly nowFn: () => number

  constructor(deps: ChatDeps) {
    this.nowFn = deps.now ?? (() => Date.now())
    this.store = deps.store ?? (deps.storePath ? new FileStore(dirname(deps.storePath), { chat: deps.storePath, requests: `${deps.storePath}.requests.json` }) : new MemoryStore())
    this.gate = deps.gate ?? new MembershipGate(deps.checkAccess, this.nowFn)
  }

  /** The membership cache (exposed for tests that check it stays bounded). */
  get access(): Map<string, { allowed: boolean; until: number }> { return this.gate.cache }

  /**
   * after > 0: messages newer than `after` (polling). before > 0: older than `before`
   * ("load earlier"). Neither: the latest page. Always ascending by id, at most `limit`.
   */
  async list(accountId: string, circleId: string, after = 0, options: { before?: number; limit?: number } = {}): Promise<ChatMessage[]> {
    await this.gate.require(circleId, accountId)
    const limit = Math.max(1, Math.min(MAX_ROOM, options.limit ?? MAX_ROOM))
    return this.store.listMessages(circleId, { after: after || undefined, before: options.before, limit })
  }

  async post(accountId: string, circleId: string, rawText: unknown): Promise<ChatMessage> {
    const text = cleanText(rawText)
    await this.gate.require(circleId, accountId)
    if (!(await this.store.hit(`chat:${accountId}`, RATE_MAX, RATE_WINDOW_MS, this.nowFn()))) {
      throw new ChatError(429, 'CHAT_RATE', 'You are sending messages too quickly. Wait a few seconds.')
    }
    return this.store.appendMessage({ circle_id: circleId, account_id: accountId, text, at: this.nowFn() })
  }
}

/** On-chain membership check through a NEAR RPC `check_access` view. Throws a 503 ChatError when RPC fails. */
export function rpcAccessCheck(rpcUrl: string, contractId: string, timeoutMs = 8000): AccessCheck {
  return async (circleId, accountId) => {
    const args = Buffer.from(JSON.stringify({ circle_id: circleId, account_id: accountId })).toString('base64')
    let body: { result?: { result?: number[] } }
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          jsonrpc: '2.0', id: 'chat-access', method: 'query',
          params: { request_type: 'call_function', finality: 'final', account_id: contractId, method_name: 'check_access', args_base64: args },
        }),
      })
      body = await response.json() as { result?: { result?: number[] } }
    } catch {
      throw new ChatError(503, 'CHAT_RPC', RPC_DOWN)
    }
    if (!body.result?.result) throw new ChatError(503, 'CHAT_RPC', RPC_DOWN)
    return JSON.parse(Buffer.from(body.result.result).toString()) as { allowed: boolean; display_tier?: string | null }
  }
}
