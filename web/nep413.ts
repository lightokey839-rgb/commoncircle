import type { NearWallet } from './circle-client'

export type SignMessageParams = {
  message: string
  recipient: string
  nonce: Uint8Array
  callbackUrl?: string
  state?: string
}

export type SignedMessage = {
  accountId: string
  publicKey: string
  signature: string
  state?: string
}

export interface Nep413Wallet extends NearWallet {
  signMessage(params: SignMessageParams): Promise<SignedMessage>
}

type NonceResponse = {
  accountId: string
  message: string
  nonce: string
  recipient: string
  expiresAt: string
}

function decodeNonce(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0))
  if (bytes.length !== 32) throw new Error('The server returned an invalid NEP-413 nonce.')
  return bytes
}

async function post<T>(url: string, payload: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new Error('The chat sign-in server is not answering. If it was idle it can take up to a minute to wake up; try again shortly.')
  }
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Sign-in failed (${response.status}). Try again.`)
  return body
}

export async function signInWithNep413(input: {
  authUrl: string
  recipient: string
  accountId: string
  wallet: Nep413Wallet
}): Promise<{ accountId: string; token: string }> {
  const challenge = await post<NonceResponse>(`${input.authUrl.replace(/\/$/, '')}/nonce`, {
    accountId: input.accountId,
    recipient: input.recipient,
  })
  const signed = await input.wallet.signMessage({
    message: challenge.message,
    recipient: challenge.recipient,
    nonce: decodeNonce(challenge.nonce),
    state: challenge.nonce,
  })
  if (signed.accountId !== input.accountId) throw new Error('The wallet signed for a different account.')
  return post(`${input.authUrl.replace(/\/$/, '')}/verify`, {
    ...signed,
    accountId: input.accountId,
    message: challenge.message,
    nonce: challenge.nonce,
    recipient: challenge.recipient,
  })
}
