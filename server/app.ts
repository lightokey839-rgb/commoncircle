/** CommonCircle chat / NEP-413 sign-in HTTP handler (fetch-style, no server started here).
 *
 * Routes:
 *   GET  /health                               -> readiness, store kind, network
 *   POST /nonce   { accountId, recipient }     -> one-time NEP-413 challenge (5 minutes)
 *   POST /verify  { accountId, publicKey, signature, nonce, message, recipient } -> session token
 *   GET  /chat/<circle>/messages?after=&before=&limit=   (members only)
 *   POST /chat/<circle>/messages { text }                (members only)
 *   GET  /chat/<circle>/requests                         (members only)
 *   POST /chat/<circle>/requests { amount, days, note }
 *   POST /chat/<circle>/requests/direct { loan_id, note }
 *   POST /chat/<circle>/requests/<id>/(offer|cancel|link) { loan_id? }
 *
 * The server never receives private keys, seed phrases or invite secrets, never signs
 * a transaction and never moves money. server/auth.ts wires this to a real HTTP server.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { ChatError, cursor, type ChatService } from './chat.ts'
import type { RequestService } from './requests.ts'
import type { CircleStore } from './store.ts'
import { MAX_BODY_BYTES, readJsonBody } from './limits.ts'

export type KeyCheck = (accountId: string, publicKey: string) => Promise<boolean>
export type SignatureCheck = (input: { message: string; nonce: Uint8Array; recipient: string; publicKey: string; signature: string }) => boolean

export type AppDeps = {
  store: CircleStore
  chat: ChatService
  requests: RequestService
  jwtSecret: string
  sessionTtlSec: number
  origins: string[]
  recipients: string[]
  maxChallenges: number
  verifySignature: SignatureCheck
  hasFullAccessKey: KeyCheck
  network?: string
  contractId?: string
  now?: () => number
  trustProxy?: boolean
}

export const CHALLENGE_TTL_MS = 5 * 60 * 1000
const ISSUER = 'commoncircle-chat'
const AUDIENCE = 'commoncircle-web'

export function validAccountId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 2 && value.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value)
}

function validNonce(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false
  return Buffer.from(value, 'base64url').length === 32
}

export function createApp(deps: AppDeps): (request: Request, peer?: string) => Promise<Response> {
  const now = deps.now ?? (() => Date.now())
  const origins = new Set(deps.origins)
  const recipients = new Set(deps.recipients)

  function cors(origin: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    }
    if (origin && origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin
    return headers
  }

  function json(value: unknown, status: number, origin: string | null, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors(origin), ...extra },
    })
  }

  function signToken(accountId: string): { token: string; expiresAt: string } {
    const iat = Math.floor(now() / 1000)
    const exp = iat + deps.sessionTtlSec
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ sub: accountId, accountId, iss: ISSUER, aud: AUDIENCE, iat, exp })).toString('base64url')
    const signature = createHmac('sha256', deps.jwtSecret).update(`${header}.${payload}`).digest('base64url')
    return { token: `${header}.${payload}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() }
  }

  /** The account a session token belongs to, or null if it is forged, for someone else, or expired. */
  function verifyToken(token: string): string | null {
    const [header, payload, signature, extra] = token.split('.')
    if (!header || !payload || !signature || extra !== undefined) return null
    const expected = createHmac('sha256', deps.jwtSecret).update(`${header}.${payload}`).digest()
    const given = Buffer.from(signature, 'base64url')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
    try {
      const head = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: string }
      if (head.alg !== 'HS256') return null
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { accountId?: string; exp?: number; iss?: string; aud?: string }
      if (claims.iss !== ISSUER || claims.aud !== AUDIENCE) return null
      if (!validAccountId(claims.accountId) || !claims.exp || claims.exp * 1000 <= now()) return null
      return claims.accountId
    } catch {
      return null
    }
  }

  function caller(request: Request): string | null {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    return token ? verifyToken(token) : null
  }

  function clientKey(request: Request, peer: string | undefined): string {
    if (deps.trustProxy) {
      const hops = (request.headers.get('x-forwarded-for') ?? '').split(',').map((h) => h.trim()).filter(Boolean)
      if (hops.length) return hops[hops.length - 1]
    }
    return peer ?? 'unknown'
  }

  async function limited(key: string, limit: number, windowMs: number): Promise<boolean> {
    return !(await deps.store.hit(key, limit, windowMs, now()))
  }

  async function nonce(request: Request, origin: string | null, client: string): Promise<Response> {
    if (await limited(`nonce:${client}`, 20, 60_000)) return json({ error: 'Too many sign-in attempts. Wait a minute and try again.' }, 429, origin)
    const input = await readJsonBody(request, MAX_BODY_BYTES)
    const accountId = input?.accountId
    const recipient = input?.recipient ?? deps.recipients[0]
    if (!validAccountId(accountId) || typeof recipient !== 'string' || !recipient) {
      return json({ error: 'accountId and recipient are required' }, 400, origin)
    }
    // Only this app's own host may appear in the message the wallet shows. A look-alike
    // site cannot fetch a challenge naming itself and relay the signature here.
    if (!recipients.has(recipient)) return json({ error: 'This sign-in server does not accept that recipient.' }, 400, origin)
    const nonceValue = randomBytes(32).toString('base64url')
    const expiresAt = now() + CHALLENGE_TTL_MS
    const message = [
      'CommonCircle sign-in',
      `Account: ${accountId}`,
      `Recipient: ${recipient}`,
      `Expires: ${new Date(expiresAt).toISOString()}`,
      `Nonce: ${nonceValue}`,
    ].join('\n')
    if (!(await deps.store.addChallenge(nonceValue, { accountId, message, recipient, expiresAt }, deps.maxChallenges, now()))) {
      return json({ error: 'Sign-in is busy right now. Try again in a few minutes.' }, 503, origin)
    }
    return json({ accountId, message, nonce: nonceValue, recipient, expiresAt: new Date(expiresAt).toISOString() }, 200, origin)
  }

  async function verify(request: Request, origin: string | null, client: string): Promise<Response> {
    if (await limited(`verify:${client}`, 20, 60_000)) return json({ error: 'Too many sign-in attempts. Wait a minute and try again.' }, 429, origin)
    const input = await readJsonBody(request, MAX_BODY_BYTES)
    const accountId = input?.accountId
    const publicKey = input?.publicKey
    const signature = input?.signature
    const nonceValue = input?.nonce
    const message = input?.message
    const recipient = input?.recipient
    if (!validAccountId(accountId) || typeof publicKey !== 'string' || typeof signature !== 'string' ||
        !validNonce(nonceValue) || typeof message !== 'string' || typeof recipient !== 'string') {
      return json({ error: 'invalid NEP-413 verification payload' }, 400, origin)
    }
    // Consume first (atomic delete in the store): a nonce works at most once, even when
    // two requests race on two server processes, and even if this attempt fails.
    const challenge = await deps.store.takeChallenge(nonceValue, now())
    if (!challenge || challenge.accountId !== accountId || challenge.message !== message || challenge.recipient !== recipient) {
      return json({ error: 'invalid or expired sign-in challenge' }, 401, origin)
    }
    let ok: boolean
    try {
      ok = deps.verifySignature({ message, nonce: Buffer.from(nonceValue, 'base64url'), recipient, publicKey, signature })
    } catch {
      ok = false
    }
    if (!ok) return json({ error: 'NEP-413 signature did not verify' }, 401, origin)
    try {
      if (!(await deps.hasFullAccessKey(accountId, publicKey))) return json({ error: 'signing key is not a confirmed full-access key' }, 401, origin)
    } catch {
      return json({ error: 'Could not look up the signing key on NEAR testnet. Try again.' }, 503, origin)
    }
    const session = signToken(accountId)
    return json({ accountId, token: session.token, expiresAt: session.expiresAt }, 200, origin)
  }

  async function chatRoute(request: Request, circleId: string, origin: string | null): Promise<Response> {
    const accountId = caller(request)
    if (!accountId) return json({ error: 'Sign in first to use the chat.' }, 401, origin)
    if (request.method === 'GET') {
      if (await limited(`read:${accountId}`, 240, 60_000)) return json({ error: 'Too many requests. Wait a moment.' }, 429, origin)
      const params = new URL(request.url).searchParams
      const after = cursor(params.get('after')) ?? 0
      const before = cursor(params.get('before'))
      const limit = cursor(params.get('limit'))
      return json({ messages: await deps.chat.list(accountId, circleId, after, { before, limit }) }, 200, origin)
    }
    const input = await readJsonBody(request, MAX_BODY_BYTES)
    return json({ message: await deps.chat.post(accountId, circleId, input?.text) }, 201, origin)
  }

  async function requestRoute(request: Request, circleId: string, rest: string, origin: string | null): Promise<Response> {
    const accountId = caller(request)
    if (!accountId) return json({ error: 'Sign in first to see loan requests.' }, 401, origin)
    if (rest === '' && request.method === 'GET') {
      if (await limited(`read:${accountId}`, 240, 60_000)) return json({ error: 'Too many requests. Wait a moment.' }, 429, origin)
      return json({ requests: await deps.requests.list(accountId, circleId) }, 200, origin)
    }
    if (request.method !== 'POST') return json({ error: 'Not found' }, 404, origin)
    if (await limited(`write:${accountId}`, 30, 60_000)) return json({ error: 'Too many changes. Wait a moment.' }, 429, origin)
    const input = (await readJsonBody(request, MAX_BODY_BYTES)) ?? {}
    if (rest === '') return json({ request: await deps.requests.create(accountId, circleId, input) }, 201, origin)
    if (rest === '/direct') return json({ request: await deps.requests.direct(accountId, circleId, input) }, 201, origin)
    const action = rest.match(/^\/(\d{1,15})\/(offer|cancel|link)$/)
    if (!action) return json({ error: 'Not found' }, 404, origin)
    const [, id, verb] = action
    const result = verb === 'offer' ? await deps.requests.offer(accountId, circleId, id)
      : verb === 'cancel' ? await deps.requests.cancel(accountId, circleId, id)
        : await deps.requests.link(accountId, circleId, id, input.loan_id)
    return json({ request: result }, 200, origin)
  }

  return async function handle(request: Request, peer?: string): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('origin')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        const store = await deps.store.health()
        return json({
          ok: store.ok, auth: 'NEP-413', network: deps.network ?? 'testnet', contract: deps.contractId ?? null,
          store: deps.store.kind, durable: deps.store.durable, shared: deps.store.shared, detail: store.detail,
          delivery: 'polling', encryption: 'none (access-controlled, not end-to-end encrypted)',
        }, store.ok ? 200 : 503, origin)
      }
      if (url.pathname === '/nonce' && request.method === 'POST') return await nonce(request, origin, clientKey(request, peer))
      if (url.pathname === '/verify' && request.method === 'POST') return await verify(request, origin, clientKey(request, peer))
      const room = url.pathname.match(/^\/chat\/(\d{1,19})\/messages$/)
      if (room && (request.method === 'GET' || request.method === 'POST')) return await chatRoute(request, room[1], origin)
      const req = url.pathname.match(/^\/chat\/(\d{1,19})\/requests((?:\/[a-z0-9]+)*)$/)
      if (req) return await requestRoute(request, req[1], req[2], origin)
      return json({ error: 'Not found' }, 404, origin)
    } catch (error) {
      if (error instanceof ChatError) return json({ error: error.message, code: error.code }, error.status, origin)
      console.error('[chat-server] request failed:', error instanceof Error ? error.message : String(error))
      return json({ error: 'The chat server had a problem. Try again in a moment.' }, 503, origin)
    }
  }
}
