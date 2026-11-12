import { CircleClient, passportTokenTitle, plainContractError, type CircleParams, type LoanView, type NearWallet } from './circle-client'
import { signInWithNep413, type Nep413Wallet } from './nep413'
import { buildInviteLink, generateInviteKeyPair, parseInviteLink, signInviteWithSecret } from './invite'
import { loadReadOnlyDemo, type ReadOnlyDemoSnapshot } from './demo'
import { bindThemeForm, readThemeForm, renderThemePreview } from './theme'
// The wallet library (~1.5 MB) loads only on Connect or when a session exists, so the
// read-only demo paints first.
import type { NearWalletController } from './near-wallet'
import { assertCircleName } from './text-rules'
import {
  clearFlagProposal, DEMO_TREASURY_LOAN_DAYS, formatUsdc, loansNeedingProposal, proposalLoanId, repaymentNotice,
  SputnikDaoClient, stewardsOf, treasuryFundProposal, usdcToBaseUnits, type SputnikProposal,
} from './treasury'

type BrowserWallet = Nep413Wallet & NearWallet

declare global {
  interface Window {
    commonCircleWallet?: NearWalletController
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
let walletController: NearWalletController | null = null
let demo: ReadOnlyDemoSnapshot | null = null

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
  if (!wallet) throw new Error('Connect a MyNearWallet or Meteor testnet wallet first.')
  accountId = wallet.accountId || $<HTMLInputElement>('#account-id').value.trim()
  if (!accountId) throw new Error('Enter the NEAR account that the wallet will sign for.')
  const result = await signInWithNep413({ authUrl: config.authUrl, recipient: config.recipient, accountId, wallet })
  sessionStorage.setItem('commoncircle.token', result.token)
  show(`Signed in as ${result.accountId}.`)
}

function onAccountChange(nextAccountId: string): void {
  const changed = nextAccountId !== accountId
  accountId = nextAccountId
  $<HTMLInputElement>('#account-id').value = nextAccountId
  $('#wallet-account').textContent = nextAccountId ? `Connected: ${nextAccountId}` : 'No wallet connected.'
  $<HTMLButtonElement>('#disconnect-wallet').hidden = !nextAccountId
  if (changed) void renderTreasury().catch((error) => show(plainContractError(error)))
}

function hasSavedWalletSession(): boolean {
  try {
    const saved = localStorage.getItem('near-wallet-selector:selectedWalletId')
    return !!saved && saved !== 'null'
  } catch {
    return false
  }
}

async function restoreWallet(): Promise<void> {
  if (!hasSavedWalletSession()) return
  const { restoreNearWallet } = await import('./near-wallet')
  const restored = await restoreNearWallet({ contractId: config.contractId, onAccountChange })
  if (!restored) return
  walletController = restored
  window.commonCircleWallet = restored
  show(`Wallet reconnected as ${restored.accountId}.`)
}

async function connectWallet(walletId: 'my-near-wallet' | 'meteor-wallet'): Promise<void> {
  if (!walletController) {
    show('Loading the wallet selector…')
    const { createNearWallet } = await import('./near-wallet')
    walletController = await createNearWallet({ contractId: config.contractId, onAccountChange })
    window.commonCircleWallet = walletController
  }
  const connected = await walletController.connect(walletId)
  show(`Connected to ${walletId === 'my-near-wallet' ? 'MyNearWallet' : 'Meteor'} as ${connected}.`)
}

async function disconnectWallet(): Promise<void> {
  if (!walletController) return
  await walletController.disconnect()
  sessionStorage.removeItem('commoncircle.token')
  show('Wallet disconnected.')
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
  const name = $<HTMLInputElement>('#new-circle-name').value
  assertCircleName(name)
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
  const amount = usdcToBaseUnits($<HTMLInputElement>('#loan-amount').value)
  const durationDaysText = $<HTMLInputElement>('#loan-duration-days').value.trim()
  const durationDays = Number(durationDaysText)
  if (!/^\d+$/.test(circleId) || !lenderId || !Number.isInteger(durationDays) || durationDays < 1) {
    throw new Error('Circle, lender, amount, and duration are required.')
  }
  const storage = await readClient.storageCosts()
  await client().createLoan({ circleId, lenderId, amount, durationDays, deposit: storage.create_loan })
  show('Request submitted. The named lender can fund it from "My positions" within the funding window.')
}

function actionRow(text: string, buttons: Array<{ label: string; run: () => Promise<void> }>, note?: string | null): HTMLLIElement {
  const item = document.createElement('li')
  const label = document.createElement('span')
  label.textContent = text
  item.append(label)
  for (const b of buttons) {
    const button = document.createElement('button')
    button.className = 'secondary inline'
    button.textContent = b.label
    button.addEventListener('click', () => void b.run().catch((error) => show(plainContractError(error))))
    item.append(button)
  }
  if (note) {
    const p = document.createElement('p')
    p.className = 'notice'
    p.textContent = note
    item.append(p)
  }
  return item
}

function dueText(loan: LoanView): string {
  if (!loan.due_at) return ''
  const ms = Number(BigInt(loan.due_at) / 1_000_000n) - Date.now()
  return ms > 0 ? ` · due in ${Math.ceil(ms / 1000)} s` : ' · past due'
}

/** F-09: in a circle whose verified DAO is the admin, anyone may ask the stewards to clear a flag. */
async function askToForgive(loan: LoanView): Promise<void> {
  const circle = await readClient.getCircle(loan.circle_id)
  if (!circle?.treasury_id) throw new Error('This circle has no DAO yet; ask the circle founder to clear the flag.')
  const dao = new SputnikDaoClient(config.rpcUrl, circle.treasury_id, window.commonCircleWallet)
  const policy = await dao.getPolicy()
  await dao.addProposal(clearFlagProposal({ circleContractId: config.contractId, loanId: loan.loan_id }), policy.proposal_bond)
  show(`Request filed: the stewards can now vote to clear the flag on loan ${loan.loan_id}.`)
}

async function loadPositions(): Promise<void> {
  if (!accountId) throw new Error('Sign in before loading positions.')
  const [positions, cfg] = await Promise.all([readClient.myPositions(accountId), readClient.getConfig()])
  const list = $('#positions')
  const borrowed = positions.borrowed.map((loan) => {
    const buttons: Array<{ label: string; run: () => Promise<void> }> = []
    if (loan.state === 'Funded') {
      buttons.push({ label: 'Repay', run: async () => {
        const outcome = await client().repayLoan({ usdcId: cfg.usdc_id, loanId: loan.loan_id, amount: loan.outstanding })
        const after = await readClient.getLoan(loan.loan_id)
        show(repaymentNotice(outcome, after) ?? `Repaid loan ${loan.loan_id}. The money went straight to ${loan.lender_id}.`)
        await loadPositions()
      } })
    }
    const late = (loan.overdue || (loan.state === 'Repaid' && loan.repaid_on_time === false)) && !loan.flag_cleared
    if (late) buttons.push({ label: 'Ask stewards to forgive', run: () => askToForgive(loan) })
    return actionRow(`Borrowed #${loan.loan_id} · ${formatUsdc(loan.principal)} USDC from ${loan.lender_id} · ${loan.state}${loan.state === 'Funded' ? dueText(loan) : ''}`, buttons, repaymentNotice(null, loan))
  })
  const lent = positions.lent.map((loan) => {
    const buttons = loan.state === 'Open'
      ? [{ label: 'Fund', run: async () => {
          const outcome = await client().fundLoan({ usdcId: cfg.usdc_id, loanId: loan.loan_id, amount: loan.principal })
          show(outcome.fundingFailed.length || outcome.refunded.length
            ? 'Funding did not go through, and your USDC was returned in the same transaction.'
            : `Funded loan ${loan.loan_id}: ${formatUsdc(loan.principal)} USDC went straight to ${loan.borrower_id}.`)
          await loadPositions()
        } }]
      : []
    return actionRow(`Lent #${loan.loan_id} · ${formatUsdc(loan.principal)} USDC to ${loan.borrower_id} · ${loan.state}`, buttons)
  })
  list.replaceChildren(...borrowed, ...lent)
  show(`Loaded ${positions.borrowed.length + positions.lent.length} positions.`)
}

async function renderTreasury(): Promise<void> {
  const panel = $('#treasury-actions')
  if (!demo?.circle?.treasury_id || !demo.dao?.verified) { panel.hidden = true; return }
  panel.hidden = false
  const daoId = demo.circle.treasury_id
  const circleId = demo.circle.circle_id
  const dao = new SputnikDaoClient(config.rpcUrl, daoId, window.commonCircleWallet)
  const usdc = new CircleClient(config.rpcUrl, demo.config.usdc_id)
  const [policy, proposals, balance] = await Promise.all([
    dao.getPolicy(),
    dao.recentProposals(10),
    usdc.view<string>('ft_balance_of', { account_id: daoId }),
  ])
  const stewards = stewardsOf(policy)
  const bondNear = (Number(BigInt(policy.proposal_bond) / 10n ** 18n) / 1e6).toString()
  $('#treasury-summary').textContent =
    `${daoId} holds ${formatUsdc(balance)} USDC. Stewards: ${stewards.join(', ')} (all must approve). Filing a request costs a ${bondNear} NEAR bond, returned when it passes.`

  const isSteward = !!accountId && stewards.includes(accountId)
  const passport = accountId ? await readClient.passportFor(circleId, accountId) : null
  const eligible = !!passport && passport.effective_tier === 'Trusted' && !passport.steward && passport.status === 'Active'
  $('#treasury-ask').hidden = !eligible
  $('#treasury-eligibility').textContent = !accountId
    ? 'Connect a wallet to ask the treasury or, if you are a steward, to vote.'
    : isSteward ? 'You are a steward: approve requests below. Stewards cannot borrow from the treasury.'
      : !passport ? 'You have no passport in this circle.'
        : !eligible ? `Your passport is ${passport.effective_tier}${passport.perks_paused ? ' with perks paused (an overdue loan)' : ''}. The treasury lends only to Trusted members.`
          : ''

  if (eligible) {
    const mine = await readClient.loansByBorrower(accountId)
    const pending = loansNeedingProposal(mine, daoId, accountId, proposals)
    $('#treasury-pending').replaceChildren(...pending.map((loan) => actionRow(
      `Request #${loan.loan_id} · ${formatUsdc(loan.principal)} USDC · not yet proposed`,
      [{ label: '2. File proposal', run: async () => {
        await dao.addProposal(treasuryFundProposal({ usdcId: demo!.config.usdc_id, circleContractId: config.contractId, loanId: loan.loan_id, amount: loan.principal, borrowerId: accountId }), policy.proposal_bond)
        show(`Proposal filed for loan ${loan.loan_id}. Both stewards must approve; the money arrives when the second one does.`)
        await renderTreasury()
      } }],
    )))
  }

  $('#treasury-proposals').replaceChildren(...(proposals.length ? proposals.map((p: SputnikProposal) => {
    const target = proposalLoanId(p)
    const approvals = Object.values(p.votes ?? {}).filter((v) => v === 'Approve').length
    const canVote = isSteward && p.status === 'InProgress' && !(accountId in (p.votes ?? {}))
    return actionRow(
      `#${p.id} · ${p.status} · ${approvals}/${stewards.length} approvals · ${target ? `${target.action === 'fund' ? 'fund' : 'clear flag on'} loan ${target.loanId}` : p.description}`,
      canVote ? [{ label: 'Approve', run: async () => {
        await dao.approve(p)
        show(`Approved proposal ${p.id}.`)
        await loadDemo()
      } }] : [],
    )
  }) : [row('No proposals yet', 'a Trusted member files the first request')]))
}

async function requestFromTreasury(): Promise<void> {
  if (!window.commonCircleWallet || !accountId) throw new Error('Connect a wallet first.')
  if (!demo?.circle?.treasury_id || !demo.dao?.verified) throw new Error('This circle has no verified DAO treasury.')
  const amount = usdcToBaseUnits($<HTMLInputElement>('#treasury-amount').value)
  const days = Number($<HTMLInputElement>('#treasury-days').value || DEMO_TREASURY_LOAN_DAYS)
  if (!Number.isInteger(days) || days < 1) throw new Error('Days must be a whole number.')
  const storage = await readClient.storageCosts()
  await client().createLoan({ circleId: demo.circle.circle_id, lenderId: demo.circle.treasury_id, amount, durationDays: days, deposit: storage.create_loan })
  show('Request recorded on-chain. Now press "2. File proposal" so the stewards can vote.')
  await renderTreasury()
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
  const [svg, token, circle] = await Promise.all([readClient.cardSvg(passport.token_id), readClient.nftToken(passport.token_id), readClient.getCircle(circleId)])
  if (!svg) throw new Error('The passport card is not available yet.')
  const image = $<HTMLImageElement>('#my-card-image')
  image.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  image.hidden = false
  $<HTMLElement>('#my-card-title').textContent = token?.metadata?.title ?? (circle ? passportTokenTitle(circle.name) : 'Passport card title unavailable.')
  show('Passport card loaded from the read-only card_svg view.')
}

async function loadDemo(): Promise<void> {
  const circleId = $<HTMLInputElement>('#demo-circle-id').value.trim() || '3'
  const snapshot = await loadReadOnlyDemo(circleId)
  demo = snapshot
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
  const daoStatus = $('#dao-status')
  daoStatus.textContent = snapshot.dao
    ? `${snapshot.dao.message}${snapshot.dao.codeHash ? ` · hash ${snapshot.dao.codeHash}` : ''}${snapshot.dao.accessKeyCount === null ? '' : ` · keys ${snapshot.dao.accessKeyCount}`}`
    : 'No DAO treasury is attached to this circle.'
  daoStatus.className = `dao-status ${snapshot.dao?.verified ? 'trusted' : 'untrusted'}`
  $('#treasury-actions').hidden = !snapshot.dao?.verified
  await renderTreasury().catch((error) => show(`Treasury panel: ${error instanceof Error ? error.message : String(error)}`))
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
  $('#connect-wallet').addEventListener('click', () => void connectWallet('my-near-wallet').catch((error) => show(error instanceof Error ? error.message : String(error))))
  $('#connect-meteor').addEventListener('click', () => void connectWallet('meteor-wallet').catch((error) => show(error instanceof Error ? error.message : String(error))))
  $('#disconnect-wallet').addEventListener('click', () => void disconnectWallet().catch((error) => show(error instanceof Error ? error.message : String(error))))
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
  $('#treasury-request').addEventListener('click', () => void requestFromTreasury().catch((error) => show(plainContractError(error))))
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

function boot(): void {
  hydrateInviteFields()
  wire()
  void loadDemo().catch((error) => show(error instanceof Error ? error.message : String(error)))
  void restoreWallet().catch(() => { /* no saved wallet session */ })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
else boot()
