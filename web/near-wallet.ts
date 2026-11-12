import type { NearWallet } from './circle-client'
import type { Nep413Wallet, SignedMessage, SignMessageParams } from './nep413'

const WALLET_SELECTOR_VERSION = '10.1.4'
const WALLET_SELECTOR_CDN = 'https://esm.sh'

type SelectorAccount = { accountId: string; publicKey?: string }
type SelectorAction = {
  type: 'FunctionCall'
  params: { methodName: string; args: Record<string, unknown>; gas: bigint; deposit: bigint }
}
type SelectorWallet = {
  getAccounts(): Promise<SelectorAccount[]>
  signIn(input: { contractId: string }): Promise<SelectorAccount[]>
  signOut(): Promise<void>
  signAndSendTransaction(input: { receiverId: string; actions: SelectorAction[] }): Promise<unknown>
  signMessage(input: { message: string; recipient: string; nonce: Uint8Array; state?: string; callbackUrl?: string }): Promise<SignedMessage | void>
}
type Selector = {
  wallet(id?: string): Promise<SelectorWallet>
}

export type NearWalletController = NearWallet & Nep413Wallet & {
  accountId: string
  connect(walletId: 'my-near-wallet' | 'meteor-wallet'): Promise<string>
  disconnect(): Promise<void>
}

async function loadSelector(): Promise<Selector> {
  const [core, myNear, meteor] = await Promise.all([
    import(/* @vite-ignore */ `${WALLET_SELECTOR_CDN}/@near-wallet-selector/core@${WALLET_SELECTOR_VERSION}?bundle`),
    import(/* @vite-ignore */ `${WALLET_SELECTOR_CDN}/@near-wallet-selector/my-near-wallet@${WALLET_SELECTOR_VERSION}?bundle`),
    import(/* @vite-ignore */ `${WALLET_SELECTOR_CDN}/@near-wallet-selector/meteor-wallet@${WALLET_SELECTOR_VERSION}?bundle`),
  ]) as Array<Record<string, unknown>>
  const setupWalletSelector = core.setupWalletSelector as (input: { network: string; modules: unknown[] }) => Promise<Selector>
  const setupMyNearWallet = myNear.setupMyNearWallet as () => unknown
  const setupMeteorWallet = meteor.setupMeteorWallet as () => unknown
  return setupWalletSelector({ network: 'testnet', modules: [setupMyNearWallet(), setupMeteorWallet()] })
}

export async function createNearWallet(input: {
  contractId: string
  onAccountChange?: (accountId: string) => void
}): Promise<NearWalletController> {
  const selector = await loadSelector()
  let selected: SelectorWallet | null = null
  let accountId = ''

  const syncAccount = async (): Promise<string> => {
    if (!selected) return accountId
    const accounts = await selected.getAccounts()
    accountId = accounts[0]?.accountId ?? ''
    if (accountId) input.onAccountChange?.(accountId)
    return accountId
  }

  const requireWallet = async (): Promise<SelectorWallet> => {
    if (!selected || !accountId) throw new Error('Connect MyNearWallet or Meteor before signing in.')
    await syncAccount()
    return selected
  }

  return {
    get accountId() { return accountId },
    async connect(walletId) {
      selected = await selector.wallet(walletId)
      const currentAccounts = await selected.getAccounts()
      const accounts = currentAccounts.length ? currentAccounts : await selected.signIn({ contractId: input.contractId })
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
      const signed = await wallet.signMessage({
        message: params.message,
        recipient: params.recipient,
        nonce: params.nonce,
        state: params.state,
        callbackUrl: params.callbackUrl,
      })
      if (!signed) throw new Error('The wallet did not return the NEP-413 signature yet. Complete the wallet approval and try again.')
      return signed
    },
    async signAndSendTransaction(transaction) {
      const wallet = await requireWallet()
      return wallet.signAndSendTransaction({
        receiverId: transaction.receiverId,
        actions: transaction.actions.map((action) => {
          if (action.type !== 'FunctionCall') throw new Error(`Unsupported NEAR action: ${action.type}`)
          return {
            type: 'FunctionCall',
            params: {
              methodName: action.params.methodName,
              args: action.params.args,
              gas: BigInt(action.params.gas),
              deposit: BigInt(action.params.deposit),
            },
          }
        }),
      })
    },
  }
}
