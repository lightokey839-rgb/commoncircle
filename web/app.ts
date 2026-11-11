import { CircleClient, plainContractError, type NearWallet } from './circle-client'
import { signInWithNep413, type Nep413Wallet } from './nep413'

type BrowserWallet = Nep413Wallet & NearWallet

declare global {
  interface Window {
    commonCircleWallet?: BrowserWallet
    commonCircleInviteSigner?: (input: { message: string; secret: string }) => Promise<string>
    COMMONCIRCLE_CONFIG?: { rpcUrl: string; contractId: string; authUrl: string; recipient: string }
  }
}

const config = window.COMMONCIRCLE_CONFIG ?? {
  rpcUrl: 'https://rpc.testnet.near.org',
  contractId: 'circle.testnet',
  authUrl: 'http://localhost:3001',
  recipient: window.location.host,
}
const client = new CircleClient(config.rpcUrl, config.contractId, window.commonCircleWallet)
let accountId = ''

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector(selector) as T
const status = () => $('#status')

function show(message: string): void {
  status().textContent = message
}

function row(label: string, value: string): HTMLLIElement {
  const item = document.createElement('li')
  item.textContent = `${label}: ${value}`
  return item
}

async function signIn(): Promise<void> {
  const wallet = window.commonCircleWallet
  accountId = $<HTMLInputElement>('#account-id').value.trim()
  if (!wallet) throw new Error('Connect a NEAR wallet adapter before signing in.')
  if (!accountId) throw new Error('Enter the NEAR account that the wallet will sign for.')
  const result = await signInWithNep413({ authUrl: config.authUrl, recipient: config.recipient, accountId, wallet })
  sessionStorage.setItem('commoncircle.token', result.token)
  show(`Signed in as ${result.accountId}.`)
}

async function joinInvite(): Promise<void> {
  if (!accountId) throw new Error('Sign in before joining a circle.')
  const inviteSecret = $<HTMLInputElement>('#invite-secret').value.trim()
  const invitePublicKey = $<HTMLInputElement>('#invite-public-key').value.trim()
  const circleId = $<HTMLInputElement>('#circle-id').value.trim()
  const signer = window.commonCircleInviteSigner
  if (!signer) throw new Error('Invite signing adapter is not installed; the secret stays in this browser.')
  if (!inviteSecret || !invitePublicKey || !circleId) throw new Error('Circle id, public key, and invite secret are required.')
  const invite = await client.getInvite(invitePublicKey)
  if (!invite || invite.expired || (invite.invitee_id && invite.invitee_id !== accountId)) throw new Error('Invite is missing, expired, or named for another account.')
  const storage = await client.storageCosts()
  await client.joinByInvite({ circleId, callerId: accountId, invitePublicKey, inviteSecret, signInvite: signer, deposit: storage.redeem_invite })
  show('Join transaction submitted. Refresh after finality to see the passport.')
}

async function loadPositions(): Promise<void> {
  if (!accountId) throw new Error('Sign in before loading positions.')
  const positions = await client.myPositions(accountId)
  const list = $('#positions')
  list.replaceChildren(
    ...positions.borrowed.map((loan) => row(`Borrowed #${loan.loan_id}`, `${loan.principal} USDC · ${loan.state}`)),
    ...positions.lent.map((loan) => row(`Lent #${loan.loan_id}`, `${loan.principal} USDC · ${loan.state}`)),
  )
  show(`Loaded ${positions.borrowed.length + positions.lent.length} positions. Amounts are integer USDC base units.`)
}

function wire(): void {
  $('#sign-in').addEventListener('click', () => void signIn().catch((error) => show(error instanceof Error ? error.message : String(error))))
  $('#join-invite').addEventListener('click', () => void joinInvite().catch((error) => show(plainContractError(error))))
  $('#load-positions').addEventListener('click', () => void loadPositions().catch((error) => show(error instanceof Error ? error.message : String(error))))
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire)
else wire()
