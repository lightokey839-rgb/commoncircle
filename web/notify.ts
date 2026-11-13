import { plainContractError } from './circle-client'

// Plain-language messages for the toast. Pure functions, unit-tested in tests/notify.test.ts.

export type ToastKind = 'info' | 'ok' | 'bad'

/** How long a toast stays: 6 s, errors 10 s. Each toast also has a close button. */
export const TOAST_MS: Record<ToastKind, number> = { info: 6000, ok: 6000, bad: 10000 }

/** What the user can do next; the app turns this into a button on the toast. */
export type NextAction = 'connect' | 'retry' | null

export type FriendlyError = { text: string; next: NextAction }

const WALLET_ACCOUNT = /did not return a testnet account|No current account connected|wallet not signed in|Connect MyNearWallet or Meteor first/i
const WRONG_NETWORK = /mainnet|wrong network|network mismatch|networkId/i
const POPUP = /popup|pop-up|window\.open|Couldn't open/i
const CANCELLED = /user (closed|rejected|cancell?ed|denied)|rejected by user|closed the (window|modal)|cancell?ed by (the )?user|User aborted/i
const NO_BALANCE = /NotEnoughBalance|LackBalanceForState|not enough balance|insufficient (funds|balance)/i
const OFFLINE = /Failed to fetch|NetworkError|ECONNREFUSED|Load failed|ERR_CONNECTION/i
const CHAIN_REFUSED = /publishing_transaction_failed|final_execution_outcome|Transaction .* failed|ExecutionError/i
const RPC_DOWN = /NEAR RPC view failed|Server error|Too Many Requests|\b429\b|\b50[234]\b|timed? ?out|TIMEOUT/i

/**
 * One plain sentence and a next action for any error the app can meet: wallet,
 * network, RPC or contract. Never returns raw JSON or a stack trace.
 */
export function friendlyError(error: unknown, context: 'wallet' | 'chat' | 'chain' = 'chain'): FriendlyError {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (/E\d+_[A-Z_]+/.test(raw)) return { text: plainContractError(raw), next: null }
  if (WALLET_ACCOUNT.test(raw)) return { text: 'Your wallet did not share a testnet account. Switch your wallet to Testnet and try again.', next: 'connect' }
  if (WRONG_NETWORK.test(raw)) return { text: 'Your wallet is on the wrong network. Switch it to Testnet and try again.', next: 'connect' }
  if (POPUP.test(raw)) return { text: 'The wallet window could not open. Allow pop-ups for this site, then try again.', next: context === 'wallet' ? 'connect' : 'retry' }
  if (CANCELLED.test(raw)) return { text: 'You closed the wallet window, so nothing was sent.', next: context === 'wallet' ? 'connect' : null }
  if (NO_BALANCE.test(raw)) return { text: 'Your wallet does not have enough testnet NEAR for this. Top it up from the testnet faucet, then try again.', next: null }
  if (OFFLINE.test(raw)) {
    return context === 'chat'
      ? { text: 'Chat is offline: the chat server did not answer. Everything else still works.', next: 'retry' }
      : { text: 'Could not reach NEAR testnet. Check your connection, then try again.', next: 'retry' }
  }
  if (CHAIN_REFUSED.test(raw)) return { text: 'The blockchain refused that transaction, so nothing moved. Press refresh (top right) to see the latest state, then try again.', next: null }
  if (RPC_DOWN.test(raw)) return { text: 'NEAR testnet is busy and did not answer. Try again in a moment.', next: 'retry' }
  return { text: firstSentence(raw), next: null }
}

/** The first readable sentence of a message, without JSON blobs, capped at 160 characters. */
export function firstSentence(message: string): string {
  const clean = message.replace(/\{[\s\S]*\}/g, '').replace(/\s+/g, ' ').trim()
  if (!clean) return 'Something went wrong. Try again.'
  const sentence = clean.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? clean
  const capped = sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence
  return /[.!?…]$/.test(capped) ? capped : `${capped}.`
}

/** De-duplicate: a toast with the same text and kind as the one on screen only restarts its timer. */
export function isRepeat(current: { text: string; kind: ToastKind } | null, next: { text: string; kind: ToastKind }): boolean {
  return !!current && current.text === next.text && current.kind === next.kind
}
