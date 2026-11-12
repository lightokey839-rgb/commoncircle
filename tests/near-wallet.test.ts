import { describe, expect, it } from 'vitest'
import { najActionToInternal } from '@near-wallet-selector/core'
import { currentAccounts, toWalletActions } from '../web/near-wallet'

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

// Meteor (wallet-selector 10.1.4, @meteorwallet/sdk 1.0.24) throws from getAccounts()
// before the first sign-in instead of returning []. Connect must treat that as
// "not signed in yet" and go on to open the wallet.
describe('currentAccounts', () => {
  it('treats Meteor\'s "No current account connected" error as no accounts', async () => {
    const meteorBeforeSignIn = { getAccounts: async () => { throw new Error('No current account connected to Meteor Wallet') } }
    await expect(currentAccounts(meteorBeforeSignIn)).resolves.toEqual([])
  })

  it('returns the signed-in account when there is one', async () => {
    const signedIn = { getAccounts: async () => [{ accountId: 'someone.testnet', publicKey: 'ed25519:x' }] }
    await expect(currentAccounts(signedIn)).resolves.toEqual([{ accountId: 'someone.testnet', publicKey: 'ed25519:x' }])
  })
})
