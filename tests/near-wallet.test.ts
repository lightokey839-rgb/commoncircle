import { describe, expect, it } from 'vitest'
import { najActionToInternal } from '@near-wallet-selector/core'
import { toWalletActions } from '../web/near-wallet'

// Wallet Selector 10 wallets (MyNearWallet, Meteor) read @near-js Action objects and
// convert them with najActionToInternal. The older { type: 'FunctionCall', params }
// shape is not an Action and would not survive that conversion.
describe('NEAR Wallet Selector 10 action format', () => {
  it('turns our function calls into Actions the wallets convert back exactly', () => {
    const [action] = toWalletActions([{
      type: 'FunctionCall',
      params: { methodName: 'act_proposal', args: { id: 3, action: 'VoteApprove' }, gas: '300000000000000', deposit: '0' },
    }])
    expect(najActionToInternal(action)).toEqual({
      type: 'FunctionCall',
      params: { methodName: 'act_proposal', args: { id: 3, action: 'VoteApprove' }, gas: '300000000000000', deposit: '0' },
    })
  })

  it('keeps a 1 yoctoNEAR deposit and a nested msg string intact (ft_transfer_call)', () => {
    const args = { receiver_id: 'commoncircle-light.testnet', amount: '1000000', msg: '{"action":"repay","loan_id":"6"}' }
    const [action] = toWalletActions([{ type: 'FunctionCall', params: { methodName: 'ft_transfer_call', args, gas: '150000000000000', deposit: '1' } }])
    expect(najActionToInternal(action)).toEqual({ type: 'FunctionCall', params: { methodName: 'ft_transfer_call', args, gas: '150000000000000', deposit: '1' } })
  })

  it('refuses anything that is not a function call', () => {
    expect(() => toWalletActions([{ type: 'Transfer' } as never])).toThrow(/Unsupported/)
  })
})
