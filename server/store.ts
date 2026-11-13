/** Storage for the CommonCircle chat server (server/auth.ts).
 *
 * One interface, three implementations:
 *   - MemoryStore:   tests only. Nothing survives a restart.
 *   - FileStore:     local development. JSON files in COMMONCIRCLE_DATA_DIR; survives a
 *                    restart but is NOT safe for more than one server process.
 *   - PostgresStore: production (server/store-postgres.ts). Shared by any number of
 *                    server processes: per-room message order, one-time sign-in
 *                    challenges, rate-limit counters and request updates are all atomic
 *                    in the database.
 *
 * Plain fields, not parameter properties: `node server/auth.ts` only strips types.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ChatMessage = { id: number; circle_id: string; account_id: string; text: string; at: number }

export type LoanRequest = {
  id: number
  circle_id: string
  borrower: string
  amount: string // USDC base units (6 decimals), U128 decimal string
  days: number
  note: string
  at: number
  offers: string[]
  lender: string | null
  loan_id: string | null
  cancelled: boolean
  direct: boolean
}

export type Challenge = { accountId: string; message: string; recipient: string; expiresAt: number }

export type MessagePage = { after?: number; before?: number; limit: number }

export interface CircleStore {
  /** 'memory' | 'file' | 'postgres' */
  readonly kind: string
  /** Survives a restart. */
  readonly durable: boolean
  /** Safe to share between several server processes. */
  readonly shared: boolean
  /** Append a message; `id` is the next number in that circle's room (1, 2, 3…), assigned atomically. */
  appendMessage(input: Omit<ChatMessage, 'id'>): Promise<ChatMessage>
  /** Ascending by id. after: newer than; before: older than; neither: the latest `limit`. */
  listMessages(circleId: string, page: MessagePage): Promise<ChatMessage[]>
  /** Ascending by id; the newest `limit` requests of the room. */
  listRequests(circleId: string, limit: number): Promise<LoanRequest[]>
  /**
   * Add a request. `guard` sees every request of the room and may throw to refuse;
   * guard + insert run under one per-room lock.
   */
  createRequest(input: Omit<LoanRequest, 'id'>, guard: (room: LoanRequest[]) => void): Promise<LoanRequest>
  /**
   * Read-modify-write one request under a per-room lock. `mutate` gets a copy of the
   * request and of the whole room; it returns the new value or throws to refuse.
   * Returning the same object unchanged is allowed (a no-op).
   */
  updateRequest(circleId: string, id: number, mutate: (request: LoanRequest, room: LoanRequest[]) => LoanRequest): Promise<LoanRequest>
  /** False when `max` live challenges already exist (the caller answers 503). */
  addChallenge(nonce: string, challenge: Challenge, max: number, now: number): Promise<boolean>
  /** Atomically remove and return a live challenge. A nonce can be taken at most once. */
  takeChallenge(nonce: string, now: number): Promise<Challenge | null>
  /** Fixed-window counter. True while `key` has made at most `limit` calls in this window. */
  hit(key: string, limit: number, windowMs: number, now: number): Promise<boolean>
  health(): Promise<{ ok: boolean; detail: string }>
  close(): Promise<void>
}

/** Thrown by a store when a request would link an on-chain loan that another card already has. */
export class DuplicateLoanLink extends Error {
  readonly loanId: string
  constructor(loanId: string) {
    super(`loan ${loanId} is already linked`)
    this.loanId = loanId
  }
}

export class RequestNotFound extends Error {}

const MAX_MESSAGES_PER_ROOM = 2000
const MAX_REQUESTS_PER_ROOM = 1000

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** In-process store. Every method does its work synchronously, so each call is atomic in one process. */
export class MemoryStore implements CircleStore {
  readonly kind: string = 'memory'
  readonly durable: boolean = false
  readonly shared = false
  protected rooms = new Map<string, ChatMessage[]>()
  protected requests = new Map<string, LoanRequest[]>()
  protected nextRequestId = 1
  private challenges = new Map<string, Challenge>()
  private counters = new Map<string, { window: number; count: number }>()

  protected changed(): void { /* FileStore persists here */ }

  async appendMessage(input: Omit<ChatMessage, 'id'>): Promise<ChatMessage> {
    const room = this.rooms.get(input.circle_id) ?? []
    const message: ChatMessage = { id: (room[room.length - 1]?.id ?? 0) + 1, ...input }
    room.push(message)
    this.rooms.set(input.circle_id, room.length > MAX_MESSAGES_PER_ROOM ? room.slice(-MAX_MESSAGES_PER_ROOM) : room)
    this.changed()
    return { ...message }
  }

  async listMessages(circleId: string, page: MessagePage): Promise<ChatMessage[]> {
    const room = this.rooms.get(circleId) ?? []
    if (page.after !== undefined && page.after > 0) return room.filter((m) => m.id > page.after!).slice(0, page.limit).map((m) => ({ ...m }))
    const older = page.before !== undefined && page.before > 0 ? room.filter((m) => m.id < page.before!) : room
    return older.slice(-page.limit).map((m) => ({ ...m }))
  }

  async listRequests(circleId: string, limit: number): Promise<LoanRequest[]> {
    return clone((this.requests.get(circleId) ?? []).slice(-limit))
  }

  async createRequest(input: Omit<LoanRequest, 'id'>, guard: (room: LoanRequest[]) => void): Promise<LoanRequest> {
    const room = this.requests.get(input.circle_id) ?? []
    guard(clone(room))
    if (input.loan_id !== null && room.some((r) => r.loan_id === input.loan_id)) throw new DuplicateLoanLink(input.loan_id)
    const request: LoanRequest = { id: this.nextRequestId++, ...clone(input) }
    room.push(request)
    this.requests.set(input.circle_id, room.length > MAX_REQUESTS_PER_ROOM ? room.slice(-MAX_REQUESTS_PER_ROOM) : room)
    this.changed()
    return clone(request)
  }

  async updateRequest(circleId: string, id: number, mutate: (request: LoanRequest, room: LoanRequest[]) => LoanRequest): Promise<LoanRequest> {
    const room = this.requests.get(circleId) ?? []
    const index = room.findIndex((r) => r.id === id)
    if (index < 0) throw new RequestNotFound(String(id))
    const next = mutate(clone(room[index]), clone(room))
    if (next.loan_id !== null && room.some((r) => r.id !== id && r.loan_id === next.loan_id)) throw new DuplicateLoanLink(next.loan_id)
    room[index] = { ...clone(next), id, circle_id: circleId }
    this.changed()
    return clone(room[index])
  }

  async addChallenge(nonce: string, challenge: Challenge, max: number, now: number): Promise<boolean> {
    for (const [key, value] of this.challenges) if (value.expiresAt <= now) this.challenges.delete(key)
    if (this.challenges.size >= max) return false
    this.challenges.set(nonce, { ...challenge })
    return true
  }

  async takeChallenge(nonce: string, now: number): Promise<Challenge | null> {
    const value = this.challenges.get(nonce)
    this.challenges.delete(nonce)
    return value && value.expiresAt > now ? value : null
  }

  async hit(key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
    const window = Math.floor(now / windowMs)
    const current = this.counters.get(key)
    const count = current && current.window === window ? current.count + 1 : 1
    if (this.counters.size > 50_000) for (const [k, v] of this.counters) if (v.window !== window) this.counters.delete(k)
    this.counters.set(key, { window, count })
    return count <= limit
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: `${this.kind} store (${this.shared ? 'shared' : 'single process only'})` }
  }

  async close(): Promise<void> { /* nothing to release */ }
}

/**
 * MemoryStore persisted to two JSON files after every change (write to a temp file, then
 * rename). For one local server process only: a second process would not see these
 * writes and would overwrite them. Challenges and rate limits stay in memory.
 */
export class FileStore extends MemoryStore {
  readonly kind: string = 'file'
  readonly durable: boolean = true
  private readonly chatPath: string
  private readonly requestPath: string

  constructor(dataDir: string, files: { chat?: string; requests?: string } = {}) {
    super()
    this.chatPath = files.chat ?? join(dataDir, 'chat.json')
    this.requestPath = files.requests ?? join(dataDir, 'requests.json')
    this.load()
  }

  private load(): void {
    try {
      const saved = JSON.parse(readFileSync(this.chatPath, 'utf8')) as { rooms?: Record<string, ChatMessage[]> }
      for (const [circleId, messages] of Object.entries(saved.rooms ?? {})) {
        // Older files numbered messages across all rooms; renumbering keeps each room's order.
        this.rooms.set(circleId, messages.slice().sort((a, b) => a.id - b.id))
      }
    } catch { /* no history yet */ }
    try {
      const saved = JSON.parse(readFileSync(this.requestPath, 'utf8')) as { rooms?: Record<string, LoanRequest[]> }
      for (const [circleId, list] of Object.entries(saved.rooms ?? {})) {
        this.requests.set(circleId, list)
        for (const r of list) this.nextRequestId = Math.max(this.nextRequestId, r.id + 1)
      }
    } catch { /* nothing saved yet */ }
  }

  private writeAtomic(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(value))
    renameSync(temp, path)
  }

  protected changed(): void {
    this.writeAtomic(this.chatPath, { rooms: Object.fromEntries(this.rooms) })
    this.writeAtomic(this.requestPath, { rooms: Object.fromEntries(this.requests) })
  }
}
