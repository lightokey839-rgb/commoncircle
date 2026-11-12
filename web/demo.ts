import { CircleClient, type CircleView, type ConfigView, type LoanView, type PassportView } from './circle-client'

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
}

export async function loadReadOnlyDemo(circleId = TESTNET_DEMO.circleId): Promise<ReadOnlyDemoSnapshot> {
  if (!/^\d+$/.test(circleId)) throw new Error('Demo circle id must be a U64 decimal string.')
  const client = new CircleClient(TESTNET_DEMO.rpcUrl, TESTNET_DEMO.contractId)
  const config = await client.getConfig()
  const circle = await client.getCircle(circleId)
  if (!circle) {
    return { ...TESTNET_DEMO, circleId, config, circle: null, loans: [], passports: [], cards: [] }
  }
  const [loans, passports] = await Promise.all([
    client.loansInCircle(circleId, { limit: 50 }),
    client.passportsInCircle(circleId, { limit: 50 }),
  ])
  const cards = await Promise.all(passports.map(async (passport) => ({
    passport,
    svg: await client.cardSvg(passport.token_id).catch(() => null),
  })))
  return { ...TESTNET_DEMO, circleId, config, circle, loans, passports, cards }
}
