// npm run test:db — PostgreSQL tests for the CommonCircle chat server.
//
// 1. Uses TEST_DATABASE_URL if set; otherwise starts a throwaway local PostgreSQL
//    (embedded-postgres, devDependency) in a temp directory.
// 2. Runs tests/store.test.ts against it (same checks as the memory and file stores:
//    ordering, concurrent posts, one-time challenges, rate limits, locked request
//    updates, duplicate-link refusal, persistence across a reconnect).
// 3. Starts the real server (node server/auth.ts) on that database, checks /health
//    reports the shared postgres store, stops it, starts it again and checks again.
// Replaces the old LoanBook script of the same name, which was missing.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localPostgres } from './local-postgres.mjs'

const root = new URL('..', import.meta.url)
let url = process.env.TEST_DATABASE_URL
let pg = null
let dir = null
const port = 54000 + Math.floor(Math.random() * 900)

function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

async function health(serverPort, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${serverPort}/health`)
      return { status: r.status, body: await r.json() }
    } catch { await new Promise((r) => setTimeout(r, 250)) }
  }
  throw new Error('server did not answer /health')
}

async function serverRound(databaseUrl) {
  const serverPort = 3900 + Math.floor(Math.random() * 90)
  const child = spawn(process.execPath, ['server/auth.ts'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(serverPort), AUTH_JWT_SECRET: 'test-only-'.repeat(4), COMMONCIRCLE_ENV: '' },
  })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  try {
    const h = await health(serverPort)
    if (h.status !== 200 || h.body.store !== 'postgres' || h.body.shared !== true) throw new Error(`unexpected /health ${JSON.stringify(h)}\n${log}`)
    return h.body
  } finally {
    child.kill()
  }
}

let code = 1
try {
  if (!url) {
    dir = mkdtempSync(join(tmpdir(), 'cc-pg-'))
    pg = await localPostgres({ databaseDir: join(dir, 'data'), port, user: 'postgres', password: 'postgres', persistent: false })
    await pg.initialise()
    await pg.start()
    url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`
    console.log(`[test:db] local PostgreSQL on port ${port}`)
  }
  code = await run('npx', ['vitest', 'run', '--configLoader', 'native', '--environment', 'node', 'tests/store.test.ts'], { TEST_DATABASE_URL: url })
  if (code === 0) {
    const first = await serverRound(url)
    const second = await serverRound(url) // restart against the same database
    console.log(`[test:db] server on postgres: ${first.detail}; restarted: ${second.detail}`)
  }
} catch (error) {
  console.error('[test:db] failed:', error instanceof Error ? error.message : error)
  code = 1
} finally {
  if (pg) await pg.stop().catch(() => undefined)
  if (dir) rmSync(dir, { recursive: true, force: true })
}
process.exit(code)
