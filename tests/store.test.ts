import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { FileStore, MemoryStore, type CircleStore } from '../server/store'
import { storeConformance } from './store-conformance'

storeConformance('memory', async () => new MemoryStore())

const dirs = new WeakMap<object, string>()
storeConformance('file (development)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-store-'))
  const s = new FileStore(dir)
  dirs.set(s, dir)
  return s
}, async (s) => new FileStore(dirs.get(s)!))

// PostgreSQL: `npm run test:db` starts a throwaway local server and sets TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL
if (url) {
  const { PostgresStore } = await import('../server/store-postgres')
  const pg = (await import('pg')).default
  const urls = new WeakMap<object, string>()
  let n = 0
  /** Each store gets its own schema (search_path), so tests never see each other's rows. */
  const connect = async (schemaUrl: string): Promise<CircleStore> => {
    const s = await PostgresStore.connect(schemaUrl)
    urls.set(s, schemaUrl)
    return s
  }
  const fresh = async () => {
    const schema = `cc_t${process.pid}_${++n}`
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`drop schema if exists ${schema} cascade; create schema ${schema}`)
    await admin.end()
    return connect(`${url}${url.includes('?') ? '&' : '?'}options=-c%20search_path%3D${schema}`)
  }
  storeConformance('postgres', fresh, async (s) => {
    await s.close() // a real restart: new pool, same database
    return connect(urls.get(s)!)
  })
} else {
  describe('postgres store', () => {
    it.skip('runs with npm run test:db (needs TEST_DATABASE_URL)', () => undefined)
  })
}
