import { CircleClient, plainContractError, type CircleParams, type NearWallet } from './circle-client'
import { signInWithNep413, type Nep413Wallet } from './nep413'
import { buildInviteLink, generateInviteKeyPair, parseInviteLink, signInviteWithSecret } from './invite'
import { loadReadOnlyDemo } from './demo'
import { bindThemeForm, readThemeForm, renderThemePreview } from './theme'

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
let chatUnlocked = false

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
  await client().createCircle({ name, params: testnetDemoParams, theme: readThemeForm('new-circle'), deposit: storage.create_circle })
  show('Circle creation submitted with the testnet DEMO parameters.')
}

async function saveDesign(): Promise<void> {
  if (!window.commonCircleWallet) throw new Error('Connect a NEAR wallet adapter before editing a design.')
  if (!accountId) throw new Error('Sign in before editing a design.')
  const circleId = $<HTMLInputElement>('#design-circle-id').value.trim()
  if (!/^\d+$/.test(circleId)) throw new Error('Enter a valid circle id.')
  const circle = await readClient.getCircle(circleId)
  if (!circle) throw new Error('That circle does not exist.')
  if (circle.admin_id !== accountId) throw new Error('Only the circle admin can edit this design.')
  const storage = await readClient.storageCosts()
  await client().setCircleTheme({ circleId, theme: readThemeForm('design'), deposit: storage.set_circle_theme })
  const passport = await readClient.passportFor(circleId, accountId)
  if (passport) {
    const svg = await readClient.cardSvg(passport.token_id)
    if (svg) {
      const image = $<HTMLImageElement>('#design-card-preview')
      image.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      image.hidden = false
    }
  }
  show('Design update submitted. The saved passport card preview will appear after finality.')
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

async function checkChatAccess(): Promise<void> {
  if (!accountId) throw new Error('Sign in before checking chat access.')
  const circleId = $<HTMLInputElement>('#chat-circle-id').value.trim()
  if (!/^\d+$/.test(circleId)) throw new Error('Enter a valid circle id.')
  const access = await readClient.checkAccess(circleId, accountId)
  chatUnlocked = access.allowed
  const message = $<HTMLTextAreaElement>('#chat-message')
  const send = $<HTMLButtonElement>('#send-chat')
  message.disabled = !chatUnlocked
  send.disabled = !chatUnlocked
  $('#chat-access').textContent = chatUnlocked
    ? `Chat unlocked for ${access.display_tier ?? 'member'} access.`
    : `Chat locked: ${access.reason}. An Active passport is required.`
  show(chatUnlocked ? 'On-chain chat access confirmed.' : 'On-chain chat access denied.')
}

function sendChat(): void {
  if (!chatUnlocked) throw new Error('Check on-chain chat access first.')
  const message = $<HTMLTextAreaElement>('#chat-message')
  const value = message.value.trim()
  if (!value) throw new Error('Write a message first.')
  const item = document.createElement('li')
  item.textContent = `${accountId}: ${value}`
  $('#chat-log').prepend(item)
  message.value = ''
  show('Demo message added locally; a production chat transport is not part of this scaffold.')
}

async function loadMyCard(): Promise<void> {
  if (!accountId) throw new Error('Sign in before loading your card.')
  const circleId = $<HTMLInputElement>('#my-card-circle-id').value.trim()
  if (!/^\d+$/.test(circleId)) throw new Error('Enter a valid circle id.')
  const passport = await readClient.passportFor(circleId, accountId)
  if (!passport) throw new Error('No passport exists for this account in that circle.')
  const [svg, token] = await Promise.all([readClient.cardSvg(passport.token_id), readClient.nftToken(passport.token_id)])
  if (!svg) throw new Error('The passport card is not available yet.')
  const image = $<HTMLImageElement>('#my-card-image')
  image.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  image.hidden = false
  $<HTMLElement>('#my-card-title').textContent = token?.metadata?.title ?? 'Passport card title unavailable.'
  show('Passport card loaded from the read-only card_svg view.')
}

async function loadDemo(): Promise<void> {
  const circleId = $<HTMLInputElement>('#demo-circle-id').value.trim() || '2'
  const snapshot = await loadReadOnlyDemo(circleId)
  const lines = [
    'READ-ONLY TESTNET DEMO',
    `RPC: ${snapshot.rpcUrl}`,
    `Contract: ${snapshot.contractId}`,
    `Interface: ${snapshot.config.interface_version}`,
    `USDC: ${snapshot.config.usdc_id}`,
    `Circle requested: ${snapshot.circleId}`,
  ]
  if (!snapshot.circle) {
    lines.push('No circle exists at this id yet. The contract is reachable and initialized.')
  } else {
    lines.push(`Circle: ${snapshot.circle.name}`, `Members: ${snapshot.circle.member_count}`, `Loans: ${snapshot.loans.length}`, `Passports: ${snapshot.passports.length}`)
    for (const passport of snapshot.passports) {
      lines.push(`Passport: ${passport.owner_id} · ${passport.display_tier} · ${passport.status}`)
    }
  }
  $('#demo-output').textContent = lines.join('\n')
  const cards = $('#demo-cards')
  cards.replaceChildren()
  for (const card of snapshot.cards) {
    if (!card.svg) continue
    const figure = document.createElement('figure')
    const image = document.createElement('img')
    image.alt = `${card.passport.owner_id} passport card`
    image.src = URL.createObjectURL(new Blob([card.svg], { type: 'image/svg+xml' }))
    const caption = document.createElement('figcaption')
    caption.textContent = `${card.passport.owner_id} · ${card.passport.display_tier}`
    figure.append(image, caption)
    cards.append(figure)
  }
  show('Read-only testnet data loaded. No wallet or transaction was used.')
}

function wire(): void {
  $('#sign-in').addEventListener('click', () => void signIn().catch((error) => show(error instanceof Error ? error.message : String(error))))
  $('#join-invite').addEventListener('click', () => void joinInvite().catch((error) => show(plainContractError(error))))
  $('#create-invite').addEventListener('click', () => void createInvite().catch((error) => show(plainContractError(error))))
  $('#create-circle').addEventListener('click', () => void createCircle().catch((error) => show(plainContractError(error))))
  $('#create-loan').addEventListener('click', () => void createLoan().catch((error) => show(plainContractError(error))))
  $('#save-design').addEventListener('click', () => void saveDesign().catch((error) => show(plainContractError(error))))
  $('#load-positions').addEventListener('click', () => void loadPositions().catch((error) => show(error instanceof Error ? error.message : String(error))))
  $('#check-chat-access').addEventListener('click', () => void checkChatAccess().catch((error) => show(error instanceof Error ? error.message : String(error))))
  $('#send-chat').addEventListener('click', () => void Promise.resolve().then(sendChat).catch((error) => show(error instanceof Error ? error.message : String(error))))
  $('#load-my-card').addEventListener('click', () => void loadMyCard().catch((error) => show(error instanceof Error ? error.message : String(error))))
  $('#load-demo').addEventListener('click', () => void loadDemo().catch((error) => show(error instanceof Error ? error.message : String(error))))
  bindThemeForm('new-circle', () => $<HTMLInputElement>('#new-circle-name').value.trim() || 'New circle', (error) => show(error instanceof Error ? error.message : String(error)))
  bindThemeForm('design', () => `Circle ${$<HTMLInputElement>('#design-circle-id').value.trim() || '?'}`, (error) => show(error instanceof Error ? error.message : String(error)))
  $<HTMLInputElement>('#new-circle-name').addEventListener('input', () => renderThemePreview('new-circle', $('#new-circle-preview'), $<HTMLInputElement>('#new-circle-name').value.trim() || 'New circle'))
}

function hydrateInviteFields(): void {
  const invite = parseInviteLink()
  if (invite.circleId) $<HTMLInputElement>('#circle-id').value = invite.circleId
  if (invite.invitePublicKey) $<HTMLInputElement>('#invite-public-key').value = invite.invitePublicKey
  if (invite.inviteSecret) $<HTMLInputElement>('#invite-secret').value = invite.inviteSecret
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { hydrateInviteFields(); wire() })
else { hydrateInviteFields(); wire() }
