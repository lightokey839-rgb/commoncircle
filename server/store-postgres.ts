/** PostgreSQL storage for the CommonCircle chat server (see server/store.ts for the contract).
 *
 * Safe for several server processes behind one load balancer:
 *   - message numbers: the room's counter row is locked for the insert transaction;
 *   - request changes: a per-room advisory lock around read-check-write, plus a unique
 *     index so one on-chain loan can never be linked to two cards;
 *   - sign-in challenges: DELETE … RETURNING, so a nonce is consumed exactly once;
 *   - rate limits: INSERT … ON CONFLICT DO UPDATE counters.
 *
 * `pg` is loaded only when DATABASE_URL is set. Plain fields only (node strips types).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DuplicateLoanLink, RequestNotFound, type Challenge, type ChatMessage, type CircleStore, type LoanRequest, type MessagePage } from './store.ts'

type QueryResult<R> = { rows: R[]; rowCount: number | null }
type Queryable = { query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<R>> }
type PoolClient = Queryable & { release(): void }
type Pool = Queryable & { connect(): Promise<PoolClient>; end(): Promise<void> }

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

type RequestRow = {
  id: string; circle_id: string; borrower: string; amount: string; days: number; note: string; created_ms: string
  offers: string[]; lender: string | null; loan_id: string | null; cancelled: boolean; direct: boolean
}

const toRequest = (r: RequestRow): LoanRequest => ({
  id: Number(r.id), circle_id: r.circle_id, borrower: r.borrower, amount: r.amount, days: r.days, note: r.note,
  at: Number(r.created_ms), offers: r.offers ?? [], lender: r.lender, loan_id: r.loan_id, cancelled: r.cancelled, direct: r.direct,
})

const toMessage = (r: { circle_id: string; seq: string; account_id: string; body: string; created_ms: string }): ChatMessage => ({
  id: Number(r.seq), circle_id: r.circle_id, account_id: r.account_id, text: r.body, at: Number(r.created_ms),
})

const isUniqueViolation = (error: unknown) => (error as { code?: string })?.code === '23505'

export class PostgresStore implements CircleStore {
  readonly kind = 'postgres'
  readonly durable = true
  readonly shared = true
  private readonly pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  /** Connect with `pg` (loaded on demand) and apply pending migrations. */
  static async connect(connectionString: string, options: { ssl?: boolean; max?: number } = {}): Promise<PostgresStore> {
    const pg = await import('pg') as unknown as { default?: { Pool: new (config: object) => Pool }; Pool?: new (config: object) => Pool }
    const PoolClass = pg.default?.Pool ?? pg.Pool!
    const pool = new PoolClass({
      connectionString,
      max: options.max ?? 10,
      ...(options.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    })
    const store = new PostgresStore(pool)
    await store.migrate()
    return store
  }

  /** Apply server/migrations/*.sql once each, in name order, under a global advisory lock. */
  async migrate(): Promise<string[]> {
    const applied: string[] = []
    await this.transaction(async (db) => {
      await db.query('select pg_advisory_xact_lock(hashtext($1))', ['commoncircle:migrate'])
      await db.query('create table if not exists schema_migrations (name text primary key, applied_ms bigint not null)')
      const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name))
      for (const name of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
        if (done.has(name)) continue
        await db.query(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
        await db.query('insert into schema_migrations (name, applied_ms) values ($1, $2)', [name, Date.now()])
        applied.push(name)
      }
    })
    return applied
  }

  private async transaction<T>(work: (db: Queryable) => Promise<T>): Promise<T> {
    const db = await this.pool.connect()
    try {
      await db.query('begin')
      const result = await work(db)
      await db.query('commit')
      return result
    } catch (error) {
      await db.query('rollback').catch(() => undefined)
      throw error
    } finally {
      db.release()
    }
  }

  private lockRoom(db: Queryable, kind: string, circleId: string): Promise<unknown> {
    return db.query('select pg_advisory_xact_lock(hashtext($1))', [`commoncircle:${kind}:${circleId}`])
  }

  async appendMessage(input: Omit<ChatMessage, 'id'>): Promise<ChatMessage> {
    return this.transaction(async (db) => {
      const seq = (await db.query<{ last_seq: string }>(
        `insert into chat_rooms (circle_id, last_seq) values ($1, 1)
         on conflict (circle_id) do update set last_seq = chat_rooms.last_seq + 1
         returning last_seq`, [input.circle_id])).rows[0].last_seq
      await db.query('insert into chat_messages (circle_id, seq, account_id, body, created_ms) values ($1, $2, $3, $4, $5)',
        [input.circle_id, seq, input.account_id, input.text, input.at])
      return { id: Number(seq), ...input }
    })
  }

  async listMessages(circleId: string, page: MessagePage): Promise<ChatMessage[]> {
    const cols = 'circle_id, seq, account_id, body, created_ms'
    if (page.after !== undefined && page.after > 0) {
      const { rows } = await this.pool.query<Parameters<typeof toMessage>[0]>(
        `select ${cols} from chat_messages where circle_id = $1 and seq > $2 order by seq asc limit $3`, [circleId, page.after, page.limit])
      return rows.map(toMessage)
    }
    const before = page.before !== undefined && page.before > 0 ? page.before : null
    const { rows } = await this.pool.query<Parameters<typeof toMessage>[0]>(
      `select ${cols} from chat_messages where circle_id = $1 and ($2::bigint is null or seq < $2::bigint) order by seq desc limit $3`, [circleId, before, page.limit])
    return rows.map(toMessage).reverse()
  }

  private async room(db: Queryable, circleId: string, limit = 1000): Promise<LoanRequest[]> {
    const { rows } = await db.query<RequestRow>('select * from loan_requests where circle_id = $1 order by id desc limit $2', [circleId, limit])
    return rows.map(toRequest).reverse()
  }

  async listRequests(circleId: string, limit: number): Promise<LoanRequest[]> {
    return this.room(this.pool, circleId, limit)
  }

  async createRequest(input: Omit<LoanRequest, 'id'>, guard: (room: LoanRequest[]) => void): Promise<LoanRequest> {
    try {
      return await this.transaction(async (db) => {
        await this.lockRoom(db, 'requests', input.circle_id)
        guard(await this.room(db, input.circle_id))
        const { rows } = await db.query<RequestRow>(
          `insert into loan_requests (circle_id, borrower, amount, days, note, created_ms, offers, lender, loan_id, cancelled, direct, updated_ms)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $6) returning *`,
          [input.circle_id, input.borrower, input.amount, input.days, input.note, input.at, input.offers, input.lender, input.loan_id, input.cancelled, input.direct])
        return toRequest(rows[0])
      })
    } catch (error) {
      if (isUniqueViolation(error) && input.loan_id) throw new DuplicateLoanLink(input.loan_id)
      throw error
    }
  }

  async updateRequest(circleId: string, id: number, mutate: (request: LoanRequest, room: LoanRequest[]) => LoanRequest): Promise<LoanRequest> {
    let loanId: string | null = null
    try {
      return await this.transaction(async (db) => {
        await this.lockRoom(db, 'requests', circleId)
        const room = await this.room(db, circleId)
        const current = room.find((r) => r.id === id)
        if (!current) throw new RequestNotFound(String(id))
        const next = mutate(structuredClone(current), structuredClone(room))
        loanId = next.loan_id
        const { rows } = await db.query<RequestRow>(
          `update loan_requests set offers = $3, lender = $4, loan_id = $5, cancelled = $6, updated_ms = $7
           where circle_id = $1 and id = $2 returning *`,
          [circleId, id, next.offers, next.lender, next.loan_id, next.cancelled, Date.now()])
        return toRequest(rows[0])
      })
    } catch (error) {
      if (isUniqueViolation(error) && loanId) throw new DuplicateLoanLink(loanId)
      throw error
    }
  }

  async addChallenge(nonce: string, challenge: Challenge, max: number, now: number): Promise<boolean> {
    return this.transaction(async (db) => {
      await db.query('select pg_advisory_xact_lock(hashtext($1))', ['commoncircle:challenges'])
      await db.query('delete from auth_challenges where expires_ms <= $1', [now])
      const live = Number((await db.query<{ n: string }>('select count(*) as n from auth_challenges')).rows[0].n)
      if (live >= max) return false
      await db.query('insert into auth_challenges (nonce, account_id, message, recipient, expires_ms) values ($1, $2, $3, $4, $5)',
        [nonce, challenge.accountId, challenge.message, challenge.recipient, challenge.expiresAt])
      return true
    })
  }

  async takeChallenge(nonce: string, now: number): Promise<Challenge | null> {
    const { rows } = await this.pool.query<{ account_id: string; message: string; recipient: string; expires_ms: string }>(
      'delete from auth_challenges where nonce = $1 returning account_id, message, recipient, expires_ms', [nonce])
    const row = rows[0]
    if (!row || Number(row.expires_ms) <= now) return null
    return { accountId: row.account_id, message: row.message, recipient: row.recipient, expiresAt: Number(row.expires_ms) }
  }

  async hit(key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
    const window = Math.floor(now / windowMs)
    const { rows } = await this.pool.query<{ hits: number }>(
      `insert into rate_limits (key, window_no, hits) values ($1, $2, 1)
       on conflict (key, window_no) do update set hits = rate_limits.hits + 1
       returning hits`, [key, window])
    // Old windows are dead weight: prune now and then.
    if (Math.random() < 0.01) await this.pool.query('delete from rate_limits where window_no < $1', [window - 2]).catch(() => undefined)
    return rows[0].hits <= limit
  }

  /** Delete every chat message and loan request card (off-chain data only). Used by CHAT_RESET on start. */
  async resetChat(): Promise<void> {
    await this.pool.query('truncate chat_messages, chat_rooms, loan_requests restart identity')
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.pool.query('select 1')
      return { ok: true, detail: 'postgres store (shared, durable)' }
    } catch (error) {
      return { ok: false, detail: `postgres unreachable: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
