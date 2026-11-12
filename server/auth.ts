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
import { hasFullAccessKey, verifyNep413Signature } from './nep413.ts'

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
const challenges = new Map<string, {
  accountId: string
  message: string
  recipient: string
  expiresAt: number
  used: boolean
}>()

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

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json()
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

async function nonce(request: Request, origin: string | null): Promise<Response> {
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
  challenges.set(nonceValue, { accountId, message, recipient, expiresAt, used: false })
  return json({ accountId, message, nonce: nonceValue, recipient, expiresAt: new Date(expiresAt).toISOString() }, 200, origin)
}

async function verifyLogin(request: Request, origin: string | null): Promise<Response> {
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

  const challenge = challenges.get(nonceValue)
  if (!challenge || challenge.used || challenge.expiresAt <= Date.now() || challenge.accountId !== accountId ||
      challenge.message !== message || challenge.recipient !== recipient) {
    return json({ error: 'invalid or expired sign-in challenge' }, 401, origin)
  }
  // Consume before any await so two concurrent requests cannot reuse the nonce.
  challenge.used = true

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

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const origin = request.headers.get('origin')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ ok: true, auth: 'NEP-413', fullAccessKeyLookup: Boolean(NEAR_RPC_URL) }, 200, origin)
  }
  if (url.pathname === '/nonce' && request.method === 'POST') return nonce(request, origin)
  if (url.pathname === '/verify' && request.method === 'POST') return verifyLogin(request, origin)
  const room = url.pathname.match(/^\/chat\/(\d{1,19})\/messages$/)
  if (room && (request.method === 'GET' || request.method === 'POST')) return chatRoute(request, room[1], origin)
  return json({ error: 'Not found' }, 404, origin)
}

const bun = (globalThis as { Bun?: { serve(options: { port: number; fetch(request: Request): Promise<Response> }): { port: number } } }).Bun
if (bun) {
  const server = bun.serve({ port: PORT, fetch: handle })
  console.log(`[auth] CommonCircle NEP-413 server (Bun) listening on http://localhost:${server.port}`)
} else {
  // Node: adapt node:http to the same fetch-style handler. Bodies are capped at 16 KiB.
  createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += (chunk as Buffer).length
        if (size > 16 * 1024) { res.writeHead(413).end(); return }
        chunks.push(chunk as Buffer)
      }
      const method = req.method ?? 'GET'
      const request = new Request(`http://localhost:${PORT}${req.url ?? '/'}`, {
        method,
        headers: req.headers as Record<string, string>,
        body: method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : Buffer.concat(chunks),
      })
      const response = await handle(request)
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
