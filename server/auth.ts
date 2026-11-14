/** CommonCircle chat + NEP-413 sign-in server (entrypoint).
 *
 *   Development:  npm run auth            (JSON files in server/.data, one process only)
 *   With Postgres: DATABASE_URL=postgres://… npm run auth
 *   Production:   COMMONCIRCLE_ENV=production + DATABASE_URL, AUTH_JWT_SECRET,
 *                 APP_ORIGINS, NEAR_AUTH_RECIPIENTS (see docs/CHAT_SERVER.md)
 *
 * Routes and rules live in server/app.ts; configuration checks in server/config.ts.
 * Run with Node 24+ (`node server/auth.ts`, types are stripped) or Bun.
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { ChatService, MembershipGate, rpcAccessCheck } from './chat.ts'
import { ConfigError, loadConfig, type ServerConfig } from './config.ts'
import { MAX_BODY_BYTES } from './limits.ts'
import { hasFullAccessKey, verifyNep413Signature } from './nep413.ts'
import { RequestService, rpcLoanLookup } from './requests.ts'
import { FileStore, type CircleStore } from './store.ts'

let config: ServerConfig
try {
  config = loadConfig(process.env, { dataDir: join(dirname(fileURLToPath(import.meta.url)), '.data') })
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error)
  process.exit(1)
}

/** Development only: a random signing secret kept in a local file (gitignored). */
function localSecret(dataDir: string): string {
  const path = join(dataDir, 'jwt-secret')
  try { return readFileSync(path, 'utf8').trim() } catch { /* first run */ }
  const secret = randomBytes(32).toString('hex')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(path, secret, { mode: 0o600 })
  return secret
}

async function openStore(): Promise<CircleStore> {
  if (config.databaseUrl) {
    const { PostgresStore } = await import('./store-postgres.ts')
    return PostgresStore.connect(config.databaseUrl, { ssl: config.databaseSsl })
  }
  // loadConfig() already refused production without DATABASE_URL.
  console.warn(`[chat-server] DEVELOPMENT storage: JSON files in ${config.dataDir}. Single process only; not for hosting.`)
  return new FileStore(config.dataDir)
}

const store = await openStore()

// One-time wipe of chat messages and request cards (never on-chain loans): set
// CHAT_RESET=delete-all-chat-data, let the service restart once, then remove the variable.
if (process.env.CHAT_RESET === 'delete-all-chat-data') {
  const resettable = store as CircleStore & { resetChat?: () => Promise<void> }
  if (resettable.resetChat) {
    await resettable.resetChat()
    console.warn('[chat-server] CHAT_RESET: all chat messages and loan request cards were deleted. Remove CHAT_RESET now.')
  } else {
    console.warn('[chat-server] CHAT_RESET is set but this store cannot be reset; delete server/.data instead.')
  }
}
const gate = new MembershipGate(rpcAccessCheck(config.rpcUrl, config.contractId))
const handle = createApp({
  store,
  chat: new ChatService({ checkAccess: async () => ({ allowed: false }), store, gate }),
  requests: new RequestService({ checkAccess: async () => ({ allowed: false }), getLoan: rpcLoanLookup(config.rpcUrl, config.contractId), store, gate }),
  jwtSecret: config.jwtSecret ?? localSecret(config.dataDir),
  sessionTtlSec: config.sessionTtlSec,
  origins: config.origins,
  recipients: config.recipients,
  maxChallenges: config.maxChallenges,
  verifySignature: verifyNep413Signature,
  hasFullAccessKey: (accountId, publicKey) => hasFullAccessKey(config.rpcUrl, accountId, publicKey),
  network: 'testnet',
  contractId: config.contractId,
  trustProxy: config.trustProxy,
})

const banner = `store=${store.kind}${store.shared ? ' (shared)' : ' (single process)'}, RPC ${config.rpcUrl}, origins ${config.origins.join(' ')}, recipients ${config.recipients.join(' ')}`

type BunServer = { port: number; requestIP(request: Request): { address: string } | null; stop(): void }
const bun = (globalThis as { Bun?: { serve(options: { port: number; hostname: string; maxRequestBodySize: number; fetch(request: Request, server: BunServer): Promise<Response> }): BunServer } }).Bun
let stop: () => void
if (bun) {
  const server = bun.serve({
    port: config.port,
    hostname: config.host,
    maxRequestBodySize: MAX_BODY_BYTES,
    fetch: (request, srv) => handle(request, srv.requestIP(request)?.address),
  })
  stop = () => server.stop()
  console.log(`[chat-server] CommonCircle (Bun) on http://${config.host}:${server.port} · ${banner}`)
} else {
  const server = createServer((req, res) => { void (async () => {
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += (chunk as Buffer).length
        if (size > MAX_BODY_BYTES) { res.writeHead(413).end(); return }
        chunks.push(chunk as Buffer)
      }
      const method = req.method ?? 'GET'
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value)
      const request = new Request(`http://internal${req.url ?? '/'}`, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : Buffer.concat(chunks),
      })
      const response = await handle(request, req.socket.remoteAddress)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      console.error('[chat-server] request failed:', error instanceof Error ? error.message : String(error))
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  })() })
  server.listen(config.port, config.host, () => console.log(`[chat-server] CommonCircle (Node) on http://${config.host}:${config.port} · ${banner}`))
  stop = () => server.close()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stop()
    void store.close().finally(() => process.exit(0))
  })
}
