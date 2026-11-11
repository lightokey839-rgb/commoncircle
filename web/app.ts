import { CircleClient, plainContractError, type CircleParams, type NearWallet } from './circle-client'
import { signInWithNep413, type Nep413Wallet } from './nep413'
import { buildInviteLink, generateInviteKeyPair, parseInviteLink, signInviteWithSecret } from './invite'

type BrowserWallet = Nep413Wallet & NearWallet

declare global {
  interface Window {
    commonCircleWallet?: BrowserWallet
    commonCircleInviteSigner?: (input: { message: string; secret: string }) => Promise<string>
    COMMONCIRCLE_CONFIG?: { rpcUrl: string; contractId: string; authUrl: string; recipient: string }
  }
}

const config = window.COMMONCIRCLE_CONFIG ?? {
  rpcUrl: 'https://test.rpc.fastnear.com',
  contractId: 'commoncircle-light.testnet',
  authUrl: 'http://localhost:3001',
  recipient: window.location.host,
}
const readClient = new CircleClient(config.rpcUrl, config.contractId)
const client = () => new CircleClient(config.rpcUrl, config.contractId, window.commonCircleWallet)
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
  const signer = window.commonCircleInviteSigner ?? signInviteWithSecret
  if (!inviteSecret || !invitePublicKey || !circleId) throw new Error('Circle id, public key, and invite secret are required.')
  const invite = await readClient.getInvite(invitePublicKey)
  if (!invite || invite.expired || (invite.invitee_id && invite.invitee_id !== accountId)) throw new Error('Invite is missing, expired, or named for another account.')
  const storage = await readClient.storageCosts()
  await client().joinByInvite({ circleId, callerId: accountId, invitePublicKey, inviteSecret, signInvite: signer, deposit: storage.redeem_invite })
  show('Join transaction submitted. Refresh after finality to see the passport.')
}

async function createInvite(): Promise<void> {
  const wallet = window.commonCircleWallet
  if (!wallet) throw new Error('Connect a NEAR wallet adapter before registering an invite.')
  if (!accountId) throw new Error('Sign in before creating an invite.')
  const circleId = $<HTMLInputElement>('#invite-circle-id').value.trim()
  const inviteeId = $<HTMLInputElement>('#invitee-account-id').value.trim() || null
  const hours = BigInt($<HTMLInputElement>('#invite-expiry-hours').value || '72')
  if (!/^\d+$/.test(circleId) || hours <= 0n) throw new Error('Enter a valid circle id and positive expiry.')
  const pair = await generateInviteKeyPair()
  const expiresAt = (BigInt(Date.now()) * 1_000_000n + hours * 3_600_000_000_000n).toString()
  const storage = await readClient.storageCosts()
  await client().registerInvite({ circleId, invitePublicKey: pair.publicKey, expiresAt, inviteeId, deposit: storage.register_invite })
  const link = buildInviteLink({ circleId, invitePublicKey: pair.publicKey, inviteSecret: pair.secret })
  $<HTMLTextAreaElement>('#invite-link').value = link
  show('Invite registered. Share the link; its secret exists only in the URL fragment.')
}

const testnetDemoParams: CircleParams = {
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

async function createCircle(): Promise<void> {
  if (!window.commonCircleWallet) throw new Error('Connect a NEAR wallet adapter before creating a circle.')
  if (!accountId) throw new Error('Sign in before creating a circle.')
  const name = $<HTMLInputElement>('#new-circle-name').value.trim()
  if (!name) throw new Error('Circle name is required.')
  const storage = await readClient.storageCosts()
  await client().createCircle({ name, params: testnetDemoParams, deposit: storage.create_circle })
  show('Circle creation submitted with the testnet DEMO parameters.')
}

async function createLoan(): Promise<void> {
  if (!window.commonCircleWallet) throw new Error('Connect a NEAR wallet adapter before creating a loan.')
  if (!accountId) throw new Error('Sign in before creating a loan.')
  const circleId = $<HTMLInputElement>('#loan-circle-id').value.trim()
  const lenderId = $<HTMLInputElement>('#loan-lender-id').value.trim()
  const amount = $<HTMLInputElement>('#loan-amount').value.trim()
  const durationDaysText = $<HTMLInputElement>('#loan-duration-days').value.trim()
  const durationDays = Number(durationDaysText)
  if (!/^\d+$/.test(circleId) || !lenderId || !/^\d+$/.test(amount) || !Number.isInteger(durationDays) || durationDays < 1) {
    throw new Error('Circle, lender, amount, and duration are required; amount stays in USDC base units.')
  }
  const storage = await readClient.storageCosts()
  await client().createLoan({ circleId, lenderId, amount, durationDays, deposit: storage.create_loan })
  show('Loan creation submitted. The lender must be named exactly as entered.')
}

async function loadPositions(): Promise<void> {
  if (!accountId) throw new Error('Sign in before loading positions.')
  const positions = await readClient.myPositions(accountId)
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
  $('#create-invite').addEventListener('click', () => void createInvite().catch((error) => show(plainContractError(error))))
  $('#create-circle').addEventListener('click', () => void createCircle().catch((error) => show(plainContractError(error))))
  $('#create-loan').addEventListener('click', () => void createLoan().catch((error) => show(plainContractError(error))))
  $('#load-positions').addEventListener('click', () => void loadPositions().catch((error) => show(error instanceof Error ? error.message : String(error))))
}

function hydrateInviteFields(): void {
  const invite = parseInviteLink()
  if (invite.circleId) $<HTMLInputElement>('#circle-id').value = invite.circleId
  if (invite.invitePublicKey) $<HTMLInputElement>('#invite-public-key').value = invite.invitePublicKey
  if (invite.inviteSecret) $<HTMLInputElement>('#invite-secret').value = invite.inviteSecret
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { hydrateInviteFields(); wire() })
else { hydrateInviteFields(); wire() }
