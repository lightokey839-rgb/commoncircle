/** CommonCircle NEP-413 sign-in scaffold.
 *
 * Routes:
 *   POST /nonce  { accountId, recipient? } -> one-use signing challenge
 *   POST /verify { accountId, publicKey, signature, nonce, message, recipient } -> JWT
 *   GET  /health -> readiness/configuration status
 *
 * Nonces are in-memory for this scaffold. Production deployment must replace
 * the map with an atomic durable store before running more than one instance.
 * The server never receives invite secrets or signs transactions for members.
 *
 * Run with Bun (`bun server/auth.ts`) or Node 24+ (`node server/auth.ts`;
 * Node strips the type annotations). NEAR_RPC_URL defaults to FastNEAR testnet.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ChatError, ChatService, rpcAccessCheck } from './chat.ts'
import { RequestService, rpcLoanLookup } from './requests.ts'
import { hasFullAccessKey, verifyNep413Signature } from './nep413.ts'
import { ChallengeStore, FixedWindowLimiter, MAX_BODY_BYTES, readJsonBody } from './limits.ts'

const PORT = Number(process.env.AUTH_PORT ?? 3001)
const APP_DOMAIN = process.env.APP_DOMAIN ?? 'localhost:5173'
const AUTH_RECIPIENT = process.env.NEAR_AUTH_RECIPIENT ?? APP_DOMAIN
const NEAR_RPC_URL = process.env.NEAR_RPC_URL ?? process.env.NEAR_TESTNET_RPC_URL ?? 'https://test.rpc.fastnear.com'
const CONTRACT_ID = process.env.CIRCLE_CONTRACT_ID ?? 'commoncircle-light.testnet'
// Local data (gitignored): the token-signing secret and chat history survive restarts.
const DATA_DIR = process.env.COMMONCIRCLE_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '.data')

function localSecret(): string {
  const path = join(DATA_DIR, 'jwt-secret')
  try { return readFileSync(path, 'utf8').trim() } catch { /* first run */ }
  const secret = randomBytes(32).toString('hex')
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(path, secret, { mode: 0o600 })
  return secret
}

const JWT_SECRET = process.env.AUTH_JWT_SECRET ?? localSecret()
const chat = new ChatService({ checkAccess: rpcAccessCheck(NEAR_RPC_URL, CONTRACT_ID), storePath: join(DATA_DIR, 'chat.json') })
const requests = new RequestService({ checkAccess: rpcAccessCheck(NEAR_RPC_URL, CONTRACT_ID), getLoan: rpcLoanLookup(NEAR_RPC_URL, CONTRACT_ID), storePath: join(DATA_DIR, 'requests.json') })
// Unauthenticated callers can create challenges, so the store is capped (503 when full),
// swept of expired entries on every /nonce, and each challenge is deleted once used.
const challenges = new ChallengeStore<{
  accountId: string
  message: string
  recipient: string
  expiresAt: number
}>(Number(process.env.AUTH_MAX_CHALLENGES ?? 10_000))
// Per-IP fixed windows on the unauthenticated sign-in routes.
const nonceLimiter = new FixedWindowLimiter({ limit: 20, windowMs: 60_000 })
const verifyLimiter = new FixedWindowLimiter({ limit: 20, windowMs: 60_000 })
// Behind a reverse proxy every client shares the proxy's address; set AUTH_TRUST_PROXY=1
// to key the limit on the last X-Forwarded-For hop (the one the proxy itself added).
const TRUST_PROXY = process.env.AUTH_TRUST_PROXY === '1'

function clientKey(request: Request, peer: string | undefined): string {
  if (TRUST_PROXY) {
    const hops = (request.headers.get('x-forwarded-for') ?? '').split(',').map((h) => h.trim()).filter(Boolean)
    if (hops.length) return hops[hops.length - 1]
  }
  return peer ?? 'unknown'
}

function allowedOrigins(): Set<string> {
  const origins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
  if (APP_DOMAIN !== 'localhost:5173') origins.add(APP_DOMAIN.startsWith('http') ? APP_DOMAIN : `https://${APP_DOMAIN}`)
  return origins
}

const origins = allowedOrigins()

function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin && origins.has(origin) ? origin : [...origins][0],
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(value: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...cors(origin) },
  })
}

function validAccountId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 2 && value.length <= 64 && /^[a-z0-9._-]+$/.test(value)
}

function validNonce(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return Buffer.from(value, 'base64url').length === 32 } catch { return false }
}

function signJwt(accountId: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: accountId, accountId, iat: now, exp: now + 86400 })).toString('base64url')
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

/** The account a sign-in token belongs to, or null if it is forged or expired. */
function verifyJwt(token: string): string | null {
  const [header, payload, signature] = token.split('.')
  if (!header || !payload || !signature) return null
  const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest()
  const given = Buffer.from(signature, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { accountId?: string; exp?: number }
    if (!claims.accountId || !claims.exp || claims.exp * 1000 < Date.now()) return null
    return claims.accountId
  } catch {
    return null
  }
}

/** GET/POST /chat/<circleId>/messages: members of the circle only (NEP-413 token + on-chain check). */
async function chatRoute(request: Request, circleId: string, origin: string | null): Promise<Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const accountId = token ? verifyJwt(token) : null
  if (!accountId) return json({ error: 'Sign in first to use the chat.' }, 401, origin)
  try {
    if (request.method === 'GET') {
      const after = Number(new URL(request.url).searchParams.get('after') ?? 0) || 0
      return json({ messages: await chat.list(accountId, circleId, after) }, 200, origin)
    }
    const input = await body(request)
    return json({ message: await chat.post(accountId, circleId, input?.text) }, 201, origin)
  } catch (error) {
    if (error instanceof ChatError) return json({ error: error.message, code: error.code }, error.status, origin)
    console.error('[chat] failed:', error instanceof Error ? error.message : String(error))
    return json({ error: 'Chat is unavailable right now.' }, 503, origin)
  }
}

/** Loan request cards in the circle room (server/requests.ts). Same sign-in and membership rules as the chat. */
async function requestRoute(request: Request, circleId: string, rest: string, origin: string | null): Promise<Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const accountId = token ? verifyJwt(token) : null
  if (!accountId) return json({ error: 'Sign in first to see loan requests.' }, 401, origin)
  try {
    if (rest === '' && request.method === 'GET') return json({ requests: await requests.list(accountId, circleId) }, 200, origin)
    const input = (await body(request)) ?? {}
    if (rest === '' && request.method === 'POST') return json({ request: await requests.create(accountId, circleId, input) }, 201, origin)
    if (rest === '/direct' && request.method === 'POST') return json({ request: await requests.direct(accountId, circleId, input) }, 201, origin)
    const action = rest.match(/^\/(\d{1,9})\/(offer|cancel|link)$/)
    if (action && request.method === 'POST') {
      const [, id, verb] = action
      const result = verb === 'offer' ? await requests.offer(accountId, circleId, id)
        : verb === 'cancel' ? await requests.cancel(accountId, circleId, id)
          : await requests.link(accountId, circleId, id, input.loan_id)
      return json({ request: result }, 200, origin)
    }
    return json({ error: 'Not found' }, 404, origin)
  } catch (error) {
    if (error instanceof ChatError) return json({ error: error.message, code: error.code }, error.status, origin)
    console.error('[requests] failed:', error instanceof Error ? error.message : String(error))
    return json({ error: 'Loan requests are unavailable right now.' }, 503, origin)
  }
}

/** JSON body, capped at 16 KiB on both the Bun and the Node path (413 when larger). */
function body(request: Request): Promise<Record<string, unknown> | null> {
  return readJsonBody(request, MAX_BODY_BYTES)
}

async function nonce(request: Request, origin: string | null, client: string): Promise<Response> {
  if (!nonceLimiter.allow(client)) return json({ error: 'Too many sign-in attempts. Wait a minute and try again.' }, 429, origin)
  const input = await body(request)
  const accountId = input?.accountId
  const recipient = input?.recipient ?? AUTH_RECIPIENT
  if (!validAccountId(accountId) || typeof recipient !== 'string' || recipient.length === 0) {
    return json({ error: 'accountId and recipient are required' }, 400, origin)
  }

  const nonceBytes = randomBytes(32)
  const nonceValue = nonceBytes.toString('base64url')
  const expiresAt = Date.now() + 5 * 60 * 1000
  const message = [
    'CommonCircle sign-in',
    `Account: ${accountId}`,
    `Recipient: ${recipient}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
    `Nonce: ${nonceValue}`,
  ].join('\n')
  if (!challenges.add(nonceValue, { accountId, message, recipient, expiresAt })) {
    return json({ error: 'Sign-in is busy right now. Try again in a few minutes.' }, 503, origin)
  }
  return json({ accountId, message, nonce: nonceValue, recipient, expiresAt: new Date(expiresAt).toISOString() }, 200, origin)
}

async function verifyLogin(request: Request, origin: string | null, client: string): Promise<Response> {
  if (!verifyLimiter.allow(client)) return json({ error: 'Too many sign-in attempts. Wait a minute and try again.' }, 429, origin)
  const input = await body(request)
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

  const challenge = challenges.get(nonceValue) // null if unknown, used (deleted) or expired
  if (!challenge || challenge.accountId !== accountId ||
      challenge.message !== message || challenge.recipient !== recipient) {
    return json({ error: 'invalid or expired sign-in challenge' }, 401, origin)
  }
  // Consume before any await so two concurrent requests cannot reuse the nonce.
  challenges.delete(nonceValue)

  try {
    const ok = verifyNep413Signature({
      message,
      nonce: Buffer.from(nonceValue, 'base64url'),
      recipient,
      publicKey,
      signature,
    })
    if (!ok) return json({ error: 'NEP-413 signature did not verify' }, 401, origin)
    if (!NEAR_RPC_URL || !(await hasFullAccessKey(NEAR_RPC_URL, accountId, publicKey))) {
      return json({ error: 'signing key is not a confirmed full-access key' }, 401, origin)
    }
  } catch (error) {
    console.error('[auth] NEP-413 verification failed:', error instanceof Error ? error.message : String(error))
    return json({ error: 'NEP-413 verification unavailable' }, 503, origin)
  }

  return json({ accountId, token: signJwt(accountId) }, 200, origin)
}

async function handle(request: Request, peer?: string): Promise<Response> {
  const url = new URL(request.url)
  const origin = request.headers.get('origin')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ ok: true, auth: 'NEP-413', fullAccessKeyLookup: Boolean(NEAR_RPC_URL) }, 200, origin)
  }
  try {
    if (url.pathname === '/nonce' && request.method === 'POST') return await nonce(request, origin, clientKey(request, peer))
    if (url.pathname === '/verify' && request.method === 'POST') return await verifyLogin(request, origin, clientKey(request, peer))
  } catch (error) {
    if (error instanceof ChatError) return json({ error: error.message, code: error.code }, error.status, origin)
    throw error
  }
  const room = url.pathname.match(/^\/chat\/(\d{1,19})\/messages$/)
  if (room && (request.method === 'GET' || request.method === 'POST')) return chatRoute(request, room[1], origin)
  const req = url.pathname.match(/^\/chat\/(\d{1,19})\/requests((?:\/[a-z0-9]+)*)$/)
  if (req) return requestRoute(request, req[1], req[2], origin)
  return json({ error: 'Not found' }, 404, origin)
}

type BunServer = { port: number; requestIP(request: Request): { address: string } | null }
const bun = (globalThis as { Bun?: { serve(options: { port: number; maxRequestBodySize: number; fetch(request: Request, server: BunServer): Promise<Response> }): BunServer } }).Bun
if (bun) {
  const server = bun.serve({
    port: PORT,
    maxRequestBodySize: MAX_BODY_BYTES, // Bun's own cap; body() also checks the bytes it reads.
    fetch: (request, srv) => handle(request, srv.requestIP(request)?.address),
  })
  console.log(`[auth] CommonCircle NEP-413 server (Bun) listening on http://localhost:${server.port}`)
} else {
  // Node: adapt node:http to the same fetch-style handler. Bodies are capped at 16 KiB.
  createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += (chunk as Buffer).length
        if (size > MAX_BODY_BYTES) { res.writeHead(413).end(); return }
        chunks.push(chunk as Buffer)
      }
      const method = req.method ?? 'GET'
      const request = new Request(`http://localhost:${PORT}${req.url ?? '/'}`, {
        method,
        headers: req.headers as Record<string, string>,
        body: method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : Buffer.concat(chunks),
      })
      const response = await handle(request, req.socket.remoteAddress)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      console.error('[auth] request failed:', error instanceof Error ? error.message : String(error))
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  }).listen(PORT, '127.0.0.1', () => {
    console.log(`[auth] CommonCircle NEP-413 server (Node) listening on http://localhost:${PORT}, RPC ${NEAR_RPC_URL}`)
  })
}
