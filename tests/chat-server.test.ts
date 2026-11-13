// HTTP-level tests of the chat / NEP-413 sign-in server (server/app.ts) with real
// ed25519 signatures and an in-memory or file store. No network: the on-chain
// membership and key checks are injected.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp, CHALLENGE_TTL_MS } from '../server/app'
import { ChatError, ChatService, MembershipGate, RATE_MAX, type AccessCheck } from '../server/chat'
import { nep413Hash, verifyNep413Signature } from '../server/nep413'
import { RequestService, type ChainLoan } from '../server/requests'
import { FileStore, MemoryStore, type CircleStore } from '../server/store'
import { loadConfig } from '../server/config'

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`)
  let out = ''
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n }
  for (const b of bytes) { if (b !== 0) break; out = `1${out}` }
  return out
}

type Wallet = { accountId: string; publicKey: string; privateKey: KeyObject }
function wallet(accountId: string): Wallet {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  return { accountId, publicKey: `ed25519:${base58(raw)}`, privateKey }
}

const RECIPIENT = 'lightokey839-rgb.github.io'
const ORIGIN = 'https://lightokey839-rgb.github.io'

function setup(options: { store?: CircleStore; members?: Set<string>; access?: AccessCheck; clock?: { now: number }; keys?: Map<string, string> } = {}) {
  const clock = options.clock ?? { now: 1_700_000_000_000 }
  const members = options.members ?? new Set(['amy.testnet', 'ben.testnet'])
  const keys = options.keys ?? new Map<string, string>()
  const store = options.store ?? new MemoryStore()
  const access: AccessCheck = options.access ?? (async (circleId, accountId) => ({ allowed: circleId === '3' && members.has(accountId) }))
  const gate = new MembershipGate(access, () => clock.now)
  const chain = new Map<string, ChainLoan>()
  const app = createApp({
    store,
    chat: new ChatService({ checkAccess: access, store, gate, now: () => clock.now }),
    requests: new RequestService({ checkAccess: access, getLoan: async (id) => chain.get(id) ?? null, store, gate, now: () => clock.now, retryMs: 0 }),
    jwtSecret: 'x'.repeat(64),
    sessionTtlSec: 3600,
    origins: [ORIGIN],
    recipients: [RECIPIENT],
    maxChallenges: 100,
    verifySignature: verifyNep413Signature,
    hasFullAccessKey: async (accountId, publicKey) => keys.get(accountId) === publicKey,
    now: () => clock.now,
  })
  const call = async (path: string, init: { method?: string; body?: unknown; token?: string; origin?: string } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', origin: init.origin ?? ORIGIN }
    if (init.token) headers.authorization = `Bearer ${init.token}`
    const response = await app(new Request(`http://chat.test${path}`, { method: init.method ?? (init.body ? 'POST' : 'GET'), headers, body: init.body ? JSON.stringify(init.body) : undefined }), '10.0.0.1')
    return { status: response.status, body: await response.json().catch(() => null) as Record<string, any>, headers: response.headers }
  }
  const challenge = (w: Wallet, recipient = RECIPIENT) => call('/nonce', { body: { accountId: w.accountId, recipient } })
  const signed = (w: Wallet, c: Record<string, any>) => {
    const nonce = Buffer.from(c.nonce, 'base64url')
    const signature = sign(null, nep413Hash({ message: c.message, nonce, recipient: c.recipient }), w.privateKey).toString('base64')
    return { accountId: w.accountId, publicKey: w.publicKey, signature, nonce: c.nonce, message: c.message, recipient: c.recipient }
  }
  const signIn = async (w: Wallet) => {
    keys.set(w.accountId, w.publicKey)
    const c = (await challenge(w)).body
    const v = await call('/verify', { body: signed(w, c) })
    expect(v.status).toBe(200)
    return v.body.token as string
  }
  return { app, call, challenge, signed, signIn, clock, keys, chain, store }
}

describe('NEP-413 sign-in', () => {
  it('a valid signature from a full-access key gets a session token', async () => {
    const t = setup()
    const amy = wallet('amy.testnet')
    t.keys.set('amy.testnet', amy.publicKey)
    const c = await t.challenge(amy)
    expect(c.status).toBe(200)
    expect(c.body.message).toContain(`Recipient: ${RECIPIENT}`)
    const v = await t.call('/verify', { body: t.signed(amy, c.body) })
    expect(v.status).toBe(200)
    expect(v.body).toMatchObject({ accountId: 'amy.testnet' })
    expect(typeof v.body.token).toBe('string')
  })

  it('rejects a signature from the wrong key, a tampered message and a key that is not full-access', async () => {
    const t = setup()
    const amy = wallet('amy.testnet')
    const mallory = wallet('amy.testnet') // same account name, different key
    t.keys.set('amy.testnet', amy.publicKey)
    let c = (await t.challenge(amy)).body
    expect((await t.call('/verify', { body: { ...t.signed(mallory, c), publicKey: amy.publicKey } })).status).toBe(401)
    c = (await t.challenge(amy)).body
    expect((await t.call('/verify', { body: { ...t.signed(amy, c), message: `${c.message} ` } })).status).toBe(401)
    c = (await t.challenge(mallory)).body
    expect((await t.call('/verify', { body: t.signed(mallory, c) })).body.error).toMatch(/full-access/)
  })

  it('a nonce works once: a replay is refused', async () => {
    const t = setup()
    const amy = wallet('amy.testnet')
    t.keys.set('amy.testnet', amy.publicKey)
    const proof = t.signed(amy, (await t.challenge(amy)).body)
    expect((await t.call('/verify', { body: proof })).status).toBe(200)
    expect((await t.call('/verify', { body: proof })).status).toBe(401)
  })

  it('an expired challenge is refused', async () => {
    const t = setup()
    const amy = wallet('amy.testnet')
    t.keys.set('amy.testnet', amy.publicKey)
    const proof = t.signed(amy, (await t.challenge(amy)).body)
    t.clock.now += CHALLENGE_TTL_MS + 1
    expect((await t.call('/verify', { body: proof })).status).toBe(401)
  })

  it('only issues challenges naming this app as the recipient', async () => {
    const t = setup()
    expect((await t.challenge(wallet('amy.testnet'), 'evil.example')).status).toBe(400)
  })

  it('refuses forged, expired and foreign session tokens', async () => {
    const t = setup()
    const token = await t.signIn(wallet('amy.testnet'))
    const [h, p, s] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), accountId: 'ben.testnet' })).toString('base64url')
    expect((await t.call('/chat/3/messages', { token: `${h}.${forged}.${s}` })).status).toBe(401)
    expect((await t.call('/chat/3/messages', { token: 'not.a.token' })).status).toBe(401)
    t.clock.now += 3601_000
    expect((await t.call('/chat/3/messages', { token })).status).toBe(401)
  })

  it('rate-limits challenge requests per client', async () => {
    const t = setup()
    const statuses = []
    for (let i = 0; i < 22; i++) statuses.push((await t.challenge(wallet('amy.testnet'))).status)
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true)
    expect(statuses.at(-1)).toBe(429)
  })
})

describe('members-only chat over HTTP', () => {
  it('two members post and read in order; polling with after= returns only newer messages', async () => {
    const t = setup()
    const amy = await t.signIn(wallet('amy.testnet'))
    const ben = await t.signIn(wallet('ben.testnet'))
    const first = await t.call('/chat/3/messages', { token: amy, body: { text: 'Hi Ben' } })
    expect(first.status).toBe(201)
    await t.call('/chat/3/messages', { token: ben, body: { text: 'Hi Amy' } })
    expect((await t.call('/chat/3/messages', { token: ben })).body.messages.map((m: any) => m.text)).toEqual(['Hi Ben', 'Hi Amy'])
    expect((await t.call(`/chat/3/messages?after=${first.body.message.id}`, { token: amy })).body.messages.map((m: any) => m.account_id)).toEqual(['ben.testnet'])
  })

  it('a signed-in non-member can neither read nor post', async () => {
    const t = setup()
    const eve = await t.signIn(wallet('eve.testnet'))
    expect((await t.call('/chat/3/messages', { token: eve })).status).toBe(403)
    expect((await t.call('/chat/3/messages', { token: eve, body: { text: 'hello' } })).status).toBe(403)
    expect((await t.call('/chat/3/requests', { token: eve })).status).toBe(403)
  })

  it('fails closed with a temporary 503 when membership cannot be checked', async () => {
    const t = setup({ access: async () => { throw new Error('rpc down') } })
    const amy = await t.signIn(wallet('amy.testnet'))
    const r = await t.call('/chat/3/messages', { token: amy })
    expect(r.status).toBe(503)
    expect(r.body.error).toMatch(/Try again/)
  })

  it('a member removed on-chain loses access once the short cache expires', async () => {
    const members = new Set(['amy.testnet'])
    const t = setup({ members })
    const amy = await t.signIn(wallet('amy.testnet'))
    expect((await t.call('/chat/3/messages', { token: amy })).status).toBe(200)
    members.delete('amy.testnet')
    t.clock.now += 16_000
    expect((await t.call('/chat/3/messages', { token: amy })).status).toBe(403)
  })

  it('rejects empty, oversized and hidden-character messages and bad cursors', async () => {
    const t = setup()
    const amy = await t.signIn(wallet('amy.testnet'))
    expect((await t.call('/chat/3/messages', { token: amy, body: { text: '   ' } })).status).toBe(400)
    expect((await t.call('/chat/3/messages', { token: amy, body: { text: 'x'.repeat(1001) } })).status).toBe(400)
    expect((await t.call('/chat/3/messages', { token: amy, body: { text: 'pay me‮' } })).status).toBe(400)
    expect((await t.call('/chat/3/messages?after=-1', { token: amy })).status).toBe(400)
  })

  it('rate-limits a fast poster', async () => {
    const t = setup()
    const amy = await t.signIn(wallet('amy.testnet'))
    for (let i = 0; i < RATE_MAX; i++) expect((await t.call('/chat/3/messages', { token: amy, body: { text: `m${i}` } })).status).toBe(201)
    expect((await t.call('/chat/3/messages', { token: amy, body: { text: 'too many' } })).status).toBe(429)
  })

  it('pages history: latest page, then earlier with before=', async () => {
    const t = setup()
    const amy = await t.signIn(wallet('amy.testnet'))
    for (let i = 1; i <= 5; i++) { await t.call('/chat/3/messages', { token: amy, body: { text: `m${i}` } }); t.clock.now += 10_000 }
    expect((await t.call('/chat/3/messages?limit=2', { token: amy })).body.messages.map((m: any) => m.text)).toEqual(['m4', 'm5'])
    expect((await t.call('/chat/3/messages?before=4&limit=2', { token: amy })).body.messages.map((m: any) => m.text)).toEqual(['m2', 'm3'])
  })

  it('keeps messages and loan requests after a server restart (file store)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-http-'))
    const keys = new Map<string, string>()
    const t1 = setup({ store: new FileStore(dir), keys })
    const amy = wallet('amy.testnet')
    const token = await t1.signIn(amy)
    await t1.call('/chat/3/messages', { token, body: { text: 'before restart' } })
    await t1.call('/chat/3/requests', { token, body: { amount: '1000000', days: 7, note: 'Bus fare' } })
    const t2 = setup({ store: new FileStore(dir), keys })
    const token2 = await t2.signIn(amy)
    expect((await t2.call('/chat/3/messages', { token: token2 })).body.messages.map((m: any) => m.text)).toEqual(['before restart'])
    expect((await t2.call('/chat/3/requests', { token: token2 })).body.requests.map((r: any) => r.note)).toEqual(['Bus fare'])
  })

  it('answers CORS only for the configured origin', async () => {
    const t = setup()
    expect((await t.call('/health')).headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect((await t.call('/health', { origin: 'https://evil.example' })).headers.get('access-control-allow-origin')).toBeNull()
    expect((await t.call('/health')).body).toMatchObject({ ok: true, store: 'memory', delivery: 'polling' })
  })
})

describe('loan request cards over HTTP', () => {
  it('ask → offer → link the matching on-chain loan; a wrong or duplicate link is refused', async () => {
    const t = setup({ members: new Set(['amy.testnet', 'ben.testnet', 'cat.testnet']) })
    const amy = await t.signIn(wallet('amy.testnet'))
    const ben = await t.signIn(wallet('ben.testnet'))
    const card = (await t.call('/chat/3/requests', { token: amy, body: { amount: '2000000', days: 5, note: 'School fees' } })).body.request
    expect((await t.call(`/chat/3/requests/${card.id}/offer`, { token: ben, method: 'POST' })).body.request.offers).toEqual(['ben.testnet'])
    t.chain.set('70', { loan_id: '70', circle_id: '3', borrower_id: 'amy.testnet', lender_id: 'cat.testnet', principal: '2000000', duration_days: 5 })
    expect((await t.call(`/chat/3/requests/${card.id}/link`, { token: amy, body: { loan_id: '70' } })).body.code).toBe('REQ_LENDER')
    t.chain.set('71', { loan_id: '71', circle_id: '3', borrower_id: 'amy.testnet', lender_id: 'ben.testnet', principal: '2000000', duration_days: 5 })
    expect((await t.call(`/chat/3/requests/${card.id}/link`, { token: amy, body: { loan_id: '71' } })).body.request).toMatchObject({ loan_id: '71', lender: 'ben.testnet' })
    const second = (await t.call('/chat/3/requests', { token: amy, body: { amount: '2000000', days: 5, note: 'Again' } })).body.request
    await t.call(`/chat/3/requests/${second.id}/offer`, { token: ben, method: 'POST' })
    expect((await t.call(`/chat/3/requests/${second.id}/link`, { token: amy, body: { loan_id: '71' } })).body.code).toBe('REQ_DUPLICATE')
    expect((await t.call('/chat/3/requests/direct', { token: amy, body: { loan_id: '71', note: 'x' } })).body.code).toBe('REQ_DUPLICATE')
  })
})

describe('server configuration', () => {
  it('production refuses to start without a database, secret, origins or recipients', () => {
    expect(() => loadConfig({ COMMONCIRCLE_ENV: 'production' }, { dataDir: '.' })).toThrow(/DATABASE_URL[\s\S]*AUTH_JWT_SECRET[\s\S]*APP_ORIGINS/)
    expect(() => loadConfig({ COMMONCIRCLE_ENV: 'production', DATABASE_URL: 'postgres://x', AUTH_JWT_SECRET: 'short', APP_ORIGINS: ORIGIN }, { dataDir: '.' })).toThrow(/at least 32/)
    expect(() => loadConfig({ COMMONCIRCLE_ENV: 'production', DATABASE_URL: 'postgres://x', AUTH_JWT_SECRET: 'x'.repeat(40), APP_ORIGINS: 'http://insecure.example' }, { dataDir: '.' })).toThrow(/https/)
    const ok = loadConfig({ COMMONCIRCLE_ENV: 'production', DATABASE_URL: 'postgres://x', AUTH_JWT_SECRET: 'x'.repeat(40), APP_ORIGINS: ORIGIN }, { dataDir: '.' })
    expect(ok).toMatchObject({ production: true, host: '0.0.0.0', recipients: [RECIPIENT], origins: [ORIGIN] })
  })

  it('development uses local origins and a loopback host', () => {
    const dev = loadConfig({}, { dataDir: '.' })
    expect(dev).toMatchObject({ production: false, host: '127.0.0.1', databaseUrl: null })
    expect(dev.recipients).toContain('localhost:5173')
  })

  it('ChatError keeps its status', () => {
    expect(new ChatError(503, 'X', 'y')).toMatchObject({ status: 503, code: 'X' })
  })
})
