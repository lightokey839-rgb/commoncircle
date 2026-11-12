import { setupWalletSelector, type Account, type SignInParams, type Wallet, type WalletSelector } from '@near-wallet-selector/core'
import { Buffer } from 'buffer'
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet'
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet'
import { actionCreators } from '@near-js/transactions'
import type { FunctionCallAction, NearWallet } from './circle-client'
import type { Nep413Wallet, SignedMessage, SignMessageParams } from './nep413'

// NEAR Wallet Selector 10.1.4, installed from npm and pinned in package-lock.json
// (no runtime CDN). Testnet only. CommonCircle never sees a key: the wallet signs.

export type NearWalletController = NearWallet & Nep413Wallet & {
  accountId: string
  connect(walletId: 'my-near-wallet' | 'meteor-wallet'): Promise<string>
  disconnect(): Promise<void>
}

/** v10 wallets take @near-js/transactions Action objects, not the older { type, params } shape. */
export function toWalletActions(actions: FunctionCallAction[]) {
  return actions.map((action) => {
    if (action.type !== 'FunctionCall') throw new Error(`Unsupported NEAR action: ${String((action as { type?: string }).type)}`)
    return actionCreators.functionCall(action.params.methodName, action.params.args, BigInt(action.params.gas), BigInt(action.params.deposit))
  })
}

let selectorPromise: Promise<WalletSelector> | null = null
function getSelector(): Promise<WalletSelector> {
  selectorPromise ??= setupWalletSelector({ network: 'testnet', modules: [setupMyNearWallet(), setupMeteorWallet()] })
  return selectorPromise
}

export async function createNearWallet(input: {
  contractId: string
  onAccountChange?: (accountId: string) => void
}): Promise<NearWalletController> {
  const selector = await getSelector()
  let selected: Wallet | null = null
  let accountId = ''

  const syncAccount = async (): Promise<string> => {
    if (!selected) return accountId
    const accounts = await selected.getAccounts()
    accountId = accounts[0]?.accountId ?? ''
    if (accountId) input.onAccountChange?.(accountId)
    return accountId
  }

  const requireWallet = async (): Promise<Wallet> => {
    if (!selected || !accountId) throw new Error('Connect MyNearWallet or Meteor first.')
    await syncAccount()
    return selected
  }

  return {
    get accountId() { return accountId },
    async connect(walletId) {
      selected = await selector.wallet(walletId)
      const current = await selected.getAccounts()
      // Sign in without a contractId: the wallet adds no limited-access key to the user's
      // account, so every CommonCircle action goes through an explicit wallet approval.
      const signIn = (selected as unknown as { signIn(p: SignInParams): Promise<Account[]> }).signIn.bind(selected)
      const accounts = current.length ? current : await signIn({})
      accountId = accounts[0]?.accountId ?? ''
      if (!accountId) throw new Error('The wallet did not return a testnet account.')
      input.onAccountChange?.(accountId)
      return accountId
    },
    async disconnect() {
      if (selected) await selected.signOut()
      selected = null
      accountId = ''
      input.onAccountChange?.('')
    },
    async signMessage(params: SignMessageParams): Promise<SignedMessage> {
      const wallet = await requireWallet()
      if (!wallet.signMessage) throw new Error('This wallet cannot sign NEP-413 messages.')
      const signed = await wallet.signMessage({
        message: params.message,
        recipient: params.recipient,
        nonce: Buffer.from(params.nonce),
        state: params.state,
        callbackUrl: params.callbackUrl,
      })
      if (!signed) throw new Error('The wallet did not return the NEP-413 signature yet. Complete the wallet approval and try again.')
      return signed as SignedMessage
    },
    async signAndSendTransaction(transaction) {
      const wallet = await requireWallet()
      return wallet.signAndSendTransaction({ receiverId: transaction.receiverId, actions: toWalletActions(transaction.actions) })
    },
  }
}

/** Restore a wallet the user already connected (e.g. after MyNearWallet's redirect back). */
export async function restoreNearWallet(input: { contractId: string; onAccountChange?: (accountId: string) => void }): Promise<NearWalletController | null> {
  const selector = await getSelector()
  const active = selector.store.getState().selectedWalletId
  if (active !== 'my-near-wallet' && active !== 'meteor-wallet') return null
  const controller = await createNearWallet(input)
  await controller.connect(active)
  return controller
}
