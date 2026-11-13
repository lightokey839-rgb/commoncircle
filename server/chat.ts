/** CommonCircle circle chat (members only).
 *
 * One room per circle. Reading and posting both require an Active passport in
 * that circle, checked on-chain with `check_access` (cached briefly). The
 * caller's identity comes from the NEP-413 sign-in token, verified by the
 * caller of this module. Messages are access-controlled, NOT end-to-end
 * encrypted: the server stores them in plain text.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type ChatMessage = { id: number; circle_id: string; account_id: string; text: string; at: number }
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
export const MAX_ROOM = 500
export const RATE_WINDOW_MS = 30_000
export const RATE_MAX = 8
const ACCESS_TTL_MS = 20_000
export const MAX_ACCESS_CACHE = 10_000

/** The membership cache is keyed by any circle id a signed-in caller names: keep it bounded.
 * Once it is full, drop expired entries, and clear it if that is not enough (it is only a cache). */
export function pruneAccess(cache: Map<string, { until: number }>, now: number, max = MAX_ACCESS_CACHE): void {
  if (cache.size < max) return
  for (const [key, value] of cache) if (value.until <= now) cache.delete(key)
  if (cache.size >= max) cache.clear()
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

export class ChatService {
  private rooms = new Map<string, ChatMessage[]>()
  private nextId = 1
  private access = new Map<string, { allowed: boolean; until: number }>()
  private recent = new Map<string, number[]>()
  private readonly deps: { checkAccess: AccessCheck; now?: () => number; storePath?: string }

  constructor(deps: { checkAccess: AccessCheck; now?: () => number; storePath?: string }) {
    this.deps = deps
    if (deps.storePath) this.load(deps.storePath)
  }

  private now(): number { return this.deps.now?.() ?? Date.now() }

  private load(path: string): void {
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8')) as { rooms?: Record<string, ChatMessage[]> }
      for (const [circleId, messages] of Object.entries(saved.rooms ?? {})) {
        this.rooms.set(circleId, messages.slice(-MAX_ROOM))
        for (const m of messages) this.nextId = Math.max(this.nextId, m.id + 1)
      }
    } catch { /* no history yet */ }
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
    if (!allowed) throw new ChatError(403, 'CHAT_NOT_MEMBER', 'Only members with an active card in this circle can use its chat.')
  }

  async list(accountId: string, circleId: string, after = 0): Promise<ChatMessage[]> {
    await this.requireMember(circleId, accountId)
    return (this.rooms.get(circleId) ?? []).filter((m) => m.id > after)
  }

  async post(accountId: string, circleId: string, rawText: unknown): Promise<ChatMessage> {
    const text = cleanText(rawText)
    await this.requireMember(circleId, accountId)
    const now = this.now()
    const times = (this.recent.get(accountId) ?? []).filter((t) => t > now - RATE_WINDOW_MS)
    if (times.length >= RATE_MAX) throw new ChatError(429, 'CHAT_RATE', 'You are sending messages too quickly. Wait a few seconds.')
    times.push(now)
    this.recent.set(accountId, times)
    const message: ChatMessage = { id: this.nextId++, circle_id: circleId, account_id: accountId, text, at: now }
    const room = this.rooms.get(circleId) ?? []
    room.push(message)
    this.rooms.set(circleId, room.slice(-MAX_ROOM))
    this.save()
    return message
  }
}

/** On-chain membership check through a NEAR RPC `check_access` view. */
export function rpcAccessCheck(rpcUrl: string, contractId: string): AccessCheck {
  return async (circleId, accountId) => {
    const args = Buffer.from(JSON.stringify({ circle_id: circleId, account_id: accountId })).toString('base64')
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'chat-access', method: 'query',
        params: { request_type: 'call_function', finality: 'final', account_id: contractId, method_name: 'check_access', args_base64: args },
      }),
    })
    const body = await response.json() as { result?: { result?: number[] } }
    if (!body.result?.result) throw new ChatError(503, 'CHAT_RPC', 'Could not check membership on testnet. Try again.')
    return JSON.parse(Buffer.from(body.result.result).toString()) as { allowed: boolean; display_tier?: string | null }
  }
}
