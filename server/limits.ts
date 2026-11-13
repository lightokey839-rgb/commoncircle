/** Memory and request-size bounds for the sign-in/chat server (server/auth.ts).
 *
 * Kept in their own module so they can be unit-tested: importing auth.ts starts
 * the server. Plain fields, not parameter properties: `node server/auth.ts`
 * only strips types.
 */

import { ChatError } from './chat.ts'

export const MAX_BODY_BYTES = 16 * 1024

/** One-use sign-in challenges with a hard size cap. Expired entries are swept on every add. */
export class ChallengeStore<T extends { expiresAt: number }> {
  private readonly map = new Map<string, T>()
  private readonly maxSize: number
  private readonly now: () => number

  constructor(maxSize: number, now: () => number = () => Date.now()) {
    this.maxSize = maxSize
    this.now = now
  }

  get size(): number { return this.map.size }

  sweep(): void {
    const now = this.now()
    for (const [key, value] of this.map) if (value.expiresAt <= now) this.map.delete(key)
  }

  /** False when the store is full of live challenges (the caller should refuse with 503). */
  add(key: string, value: T): boolean {
    this.sweep()
    if (this.map.size >= this.maxSize) return false
    this.map.set(key, value)
    return true
  }

  /** The live challenge for `key`, or null. An expired one is deleted on sight. */
  get(key: string): T | null {
    const value = this.map.get(key)
    if (!value) return null
    if (value.expiresAt <= this.now()) {
      this.map.delete(key)
      return null
    }
    return value
  }

  /** Consume a challenge: it can never be used again. */
  delete(key: string): void {
    this.map.delete(key)
  }
}

/** Fixed-window request counter per key (client IP). All counters reset together at the
 * end of each window, so memory is bounded by `maxKeys`; past that, new keys are refused. */
export class FixedWindowLimiter {
  private readonly limit: number
  private readonly windowMs: number
  private readonly maxKeys: number
  private readonly now: () => number
  private windowStart = -Infinity
  private readonly counts = new Map<string, number>()

  constructor(options: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }) {
    this.limit = options.limit
    this.windowMs = options.windowMs
    this.maxKeys = options.maxKeys ?? 10_000
    this.now = options.now ?? (() => Date.now())
  }

  allow(key: string): boolean {
    const now = this.now()
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now
      this.counts.clear()
    }
    const count = this.counts.get(key)
    if (count === undefined && this.counts.size >= this.maxKeys) return false
    const next = (count ?? 0) + 1
    this.counts.set(key, next)
    return next <= this.limit
  }
}

/** Parse a JSON object body of at most `maxBytes`, checking Content-Length first and then the
 * bytes actually read. Throws a 413 ChatError when too large; returns null for missing or bad JSON. */
export async function readJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown> | null> {
  const tooLarge = () => new ChatError(413, 'BODY_TOO_LARGE', `Request body is larger than ${maxBytes} bytes.`)
  const declared = request.headers.get('content-length')
  if (declared !== null && !(Number(declared) <= maxBytes)) throw tooLarge()
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge()
    }
    chunks.push(value)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}
