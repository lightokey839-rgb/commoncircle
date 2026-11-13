import { CircleClient, type CircleView, type ConfigView, type LoanView, type PassportView } from './circle-client'
import { loadDaoTrust, type DaoTrustSnapshot } from './dao'

export const TESTNET_DEMO = {
  network: 'testnet',
  rpcUrl: 'https://test.rpc.fastnear.com',
  contractId: 'commoncircle-light.testnet',
  circleId: '3',
} as const

export type ReadOnlyDemoSnapshot = {
  network: 'testnet'
  rpcUrl: string
  contractId: string
  circleId: string
  config: ConfigView
  circle: CircleView | null
  loans: LoanView[]
  passports: PassportView[]
  cards: Array<{ passport: PassportView; svg: string | null }>
  dao: DaoTrustSnapshot | null
  /** Parts of the snapshot that could not be read (shown as "unavailable", never as zero). */
  partial?: string[]
}

export async function loadReadOnlyDemo(circleId: string = TESTNET_DEMO.circleId): Promise<ReadOnlyDemoSnapshot> {
  if (!/^\d+$/.test(circleId)) throw new Error('Demo circle id must be a U64 decimal string.')
  const client = new CircleClient(TESTNET_DEMO.rpcUrl, TESTNET_DEMO.contractId)
  const config = await client.getConfig()
  const circle = await client.getCircle(circleId)
  if (!circle) {
    return { ...TESTNET_DEMO, circleId, config, circle: null, loans: [], passports: [], cards: [], dao: null }
  }
  // Page through the views (50 per call) so counts are complete, not "first 50".
  const [loans, passports] = await Promise.all([
    allPages((fromIndex) => client.loansInCircle(circleId, { fromIndex, limit: 50 })),
    allPages((fromIndex) => client.passportsInCircle(circleId, { fromIndex, limit: 50 })),
  ])
  const partial: string[] = []
  const cards = await Promise.all(passports.map(async (passport) => ({
    passport,
    svg: await client.cardSvg(passport.token_id).catch(() => { if (!partial.includes('passport pictures')) partial.push('passport pictures'); return null }),
  })))
  // The DAO's voting group must be exactly the circle's active stewards (read from their passports).
  const stewards = passports.filter((p) => p.steward && p.status === 'Active').map((p) => p.owner_id)
  const dao = circle.treasury_id ? await loadDaoTrust(TESTNET_DEMO.rpcUrl, circle.treasury_id, stewards) : null
  return { ...TESTNET_DEMO, circleId, config, circle, loans, passports, cards, dao, partial }
}

/** Every page of a paginated contract view (50 rows per call), up to `maxPages` pages. */
export async function allPages<T>(page: (fromIndex: number) => Promise<T[]>, maxPages = 20): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < maxPages; i++) {
    const rows = await page(i * 50)
    out.push(...rows)
    if (rows.length < 50) break
  }
  return out
}
