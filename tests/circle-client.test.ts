import { describe, expect, it } from 'vitest'
import { CircleClient, passportTokenTitle, type CircleParams, type FunctionCallAction, type NearWallet } from '../web/circle-client'

const params: CircleParams = {
  min_amount: '1000000',
  member_max_amount: '10000000',
  trusted_max_amount: '50000000',
  max_duration_days: 14,
  day_length_sec: '60',
  funding_window_sec: '3600',
  qualifying_min_amount: '1000000',
  qualifying_min_days: 1,
  trusted_threshold: 1,
  min_distinct_lenders: 1,
  recovery_lock_sec: '0',
  writeoff_grace_sec: '2592000',
}

describe('CommonCircle interface 1.1.0 client', () => {
  it('uses the circle-specific 1.1.0 passport title', () => {
    expect(passportTokenTitle('The Dogs (DEMO)')).toBe('The Dogs (DEMO) Passport')
  })

  it('passes the optional create theme and uses the 50 Tgas method budget', async () => {
    const calls: FunctionCallAction[] = []
    const wallet: NearWallet = {
      signAndSendTransaction: async ({ actions }) => {
        calls.push(...actions)
        return {}
      },
    }
    const client = new CircleClient('https://rpc.invalid', 'commoncircle-light.testnet', wallet)
    const theme = {
      tagline: 'Small turns, stronger ties',
      background: '#112233',
      accent: '#44AA88',
      text: '#FFFFFF',
      pattern: 'Dots' as const,
      emblem: 'iVBORw0KGgo=',
    }

    await client.createCircle({ name: 'The Dogs', params, theme, deposit: '123' })
    await client.setCircleTheme({ circleId: '2', theme, deposit: '456' })

    expect(calls).toHaveLength(2)
    expect(calls[0].params).toMatchObject({
      methodName: 'create_circle',
      gas: '50000000000000',
      deposit: '123',
      args: { name: 'The Dogs', params, theme },
    })
    expect(calls[1].params).toMatchObject({
      methodName: 'set_circle_theme',
      gas: '50000000000000',
      deposit: '456',
      args: { circle_id: '2', theme },
    })
  })
})
