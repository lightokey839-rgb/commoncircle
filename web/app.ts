import { CircleClient, passportTokenTitle, plainContractError, type CircleParams, type LoanView, type PassportView } from './circle-client'
import { signInWithNep413 } from './nep413'
import { buildInviteLink, generateInviteKeyPair, parseInviteLink, signInviteWithSecret } from './invite'
import { loadReadOnlyDemo, type ReadOnlyDemoSnapshot } from './demo'
import { bindThemeForm, readThemeForm, renderThemePreview } from './theme'
// The wallet library (~1.5 MB) loads only on Connect or when a session exists, so the
// read-only page paints first.
import type { NearWalletController } from './near-wallet'
import { assertCircleName } from './text-rules'
import {
  clearFlagProposal, DEMO_TREASURY_LOAN_DAYS, formatUsdc, loansNeedingProposal, proposalLoanId, repaymentNotice,
  SputnikDaoClient, stewardsOf, treasuryFundProposal, usdcToBaseUnits, type SputnikProposal,
} from './treasury'

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
const TOKEN_KEY = 'commoncircle.session'

type Me = { passport: PassportView | null; registered: boolean; loans: LoanView[]; signedIn: boolean }

let accountId = ''
let circleId = '3'
let chatUnlocked = false
let walletController: NearWalletController | null = null
let demo: ReadOnlyDemoSnapshot | null = null
let me: Me | null = null
let usdcId = ''

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector(selector) as T
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}
const short = (id: string) => (id.length > 26 ? `${id.slice(0, 12)}…${id.slice(-11)}` : id)

/* ---------- messages ---------- */

let toastTimer = 0
function show(message: string, kind: 'info' | 'ok' | 'bad' = 'info'): void {
  const toast = $('#status')
  toast.textContent = message
  toast.className = `toast ${kind}`
  toast.hidden = false
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.hidden = true }, kind === 'bad' ? 14000 : 7000)
}

function errorText(error: unknown): string {
  const text = plainContractError(error)
  if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(text)) {
    return 'Could not reach a server. If this was sign-in, start the sign-in server (npm run auth) and try again.'
  }
  return text
}

/** Run an action from a button: show a spinner, report errors in plain words. */
async function run(button: HTMLButtonElement | null, action: () => Promise<void>): Promise<void> {
  if (button) { button.disabled = true; button.classList.add('busy') }
  try {
    await action()
  } catch (error) {
    show(errorText(error), 'bad')
  } finally {
    if (button) { button.disabled = false; button.classList.remove('busy') }
  }
}

function button(label: string, action: () => Promise<void>, kind: 'primary' | 'secondary' | 'ghost' = 'primary'): HTMLButtonElement {
  const b = el('button', { className: `btn btn-${kind} btn-sm`, textContent: label, type: 'button' })
  b.addEventListener('click', () => void run(b, action))
  return b
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** After a transaction, give testnet a moment to finalise, then re-read everything. */
async function afterTx(message: string): Promise<void> {
  show(`${message} Updating from testnet…`, 'ok')
  await wait(2500)
  await refreshAll()
  show(message, 'ok')
}

/* ---------- wallet ---------- */

function onAccountChange(nextAccountId: string): void {
  const changed = nextAccountId !== accountId
  accountId = nextAccountId
  $<HTMLInputElement>('#account-id').value = nextAccountId
  const label = $('#wallet-account')
  label.textContent = nextAccountId ? short(nextAccountId) : ''
  label.title = nextAccountId
  label.hidden = !nextAccountId
  $('#connect-meteor').hidden = !!nextAccountId
  $('#connect-wallet').hidden = !!nextAccountId
  $('#disconnect-wallet').hidden = !nextAccountId
  if (changed) void refreshMe()
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
}

async function connectWallet(walletId: 'my-near-wallet' | 'meteor-wallet'): Promise<void> {
  if (!walletController) {
    show('Opening the wallet…')
    const { createNearWallet } = await import('./near-wallet')
    walletController = await createNearWallet({ contractId: config.contractId, onAccountChange })
    window.commonCircleWallet = walletController
  }
  const connected = await walletController.connect(walletId)
  show(`Connected as ${connected}.`, 'ok')
}

async function disconnectWallet(): Promise<void> {
  if (!walletController) return
  await walletController.disconnect()
  try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
  me = null
  renderAll()
  show('Wallet disconnected.')
}

function requireWallet(): void {
  if (!window.commonCircleWallet || !accountId) throw new Error('Connect a wallet first (top right).')
}

/* ---------- actions ---------- */

async function signIn(): Promise<void> {
  requireWallet()
  const result = await signInWithNep413({ authUrl: config.authUrl, recipient: config.recipient, accountId, wallet: window.commonCircleWallet! })
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accountId: result.accountId, token: result.token })) } catch { /* ignore */ }
  await refreshMe()
  show(`Signed in as ${result.accountId}. No fee was charged.`, 'ok')
}

function signedInAs(account: string): boolean {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null') as { accountId?: string } | null
    return saved?.accountId === account
  } catch {
    return false
  }
}

function inviteFields() {
  return {
    circleId: $<HTMLInputElement>('#circle-id').value.trim(),
    invitePublicKey: $<HTMLInputElement>('#invite-public-key').value.trim(),
    inviteSecret: $<HTMLInputElement>('#invite-secret').value.trim(),
  }
}

async function joinInvite(): Promise<void> {
  requireWallet()
  const { circleId: cid, invitePublicKey, inviteSecret } = inviteFields()
  if (!inviteSecret || !invitePublicKey || !cid) throw new Error('Open your invite link first (or fill in the invite details below).')
  const invite = await readClient.getInvite(invitePublicKey)
  if (!invite) throw new Error('This invite was already used or does not exist.')
  if (invite.expired) throw new Error('This invite has expired. Ask for a new one.')
  if (invite.invitee_id && invite.invitee_id !== accountId) throw new Error(`This invite is for ${invite.invitee_id}. Connect that account instead.`)
  const storage = await readClient.storageCosts()
  const signer = window.commonCircleInviteSigner ?? signInviteWithSecret
  await client().joinByInvite({ circleId: cid, callerId: accountId, invitePublicKey, inviteSecret, signInvite: signer, deposit: storage.redeem_invite })
  await afterTx('Welcome to the circle! Your card is being created.')
}

async function registerForUsdc(): Promise<void> {
  requireWallet()
  await client().registerWithToken({ tokenId: usdcId || (await readClient.getConfig()).usdc_id, accountId })
  await afterTx('Ready: lenders can now send you USDC.')
}

async function requestLoan(lenderId: string, amountText: string, daysText: string, cid = circleId): Promise<void> {
  requireWallet()
  const amount = usdcToBaseUnits(amountText)
  const durationDays = Number(daysText)
  if (!lenderId) throw new Error('Choose who you are asking.')
  if (!Number.isInteger(durationDays) || durationDays < 1) throw new Error('Days must be a whole number.')
  const storage = await readClient.storageCosts()
  await client().createLoan({ circleId: cid, lenderId, amount, durationDays, deposit: storage.create_loan })
  await afterTx(`Request sent. ${short(lenderId)} can now fund it (within 1 hour).`)
}

async function repay(loan: LoanView): Promise<void> {
  requireWallet()
  const outcome = await client().repayLoan({ usdcId: usdcId || (await readClient.getConfig()).usdc_id, loanId: loan.loan_id, amount: loan.outstanding })
  const after = await readClient.getLoan(loan.loan_id)
  const notice = repaymentNotice(outcome, after)
  if (notice) { await refreshAll(); show(notice, 'bad'); return }
  await afterTx(`Repaid loan #${loan.loan_id}. The money went straight back to ${short(loan.lender_id)}.`)
}

async function fund(loan: LoanView): Promise<void> {
  requireWallet()
  const outcome = await client().fundLoan({ usdcId: usdcId || (await readClient.getConfig()).usdc_id, loanId: loan.loan_id, amount: loan.principal })
  if (outcome.fundingFailed.length || outcome.refunded.length) {
    await refreshAll()
    show('Funding did not go through, and your USDC came straight back. Is the borrower registered for USDC?', 'bad')
    return
  }
  await afterTx(`Funded loan #${loan.loan_id}: ${formatUsdc(loan.principal)} USDC went straight to ${short(loan.borrower_id)}.`)
}

/** F-09: in a circle whose verified DAO is the admin, anyone may ask the stewards to clear a flag. */
async function askToForgive(loan: LoanView): Promise<void> {
  requireWallet()
  const circle = await readClient.getCircle(loan.circle_id)
  if (!circle?.treasury_id) throw new Error('This circle has no DAO yet; ask the circle founder to clear the flag.')
  const dao = new SputnikDaoClient(config.rpcUrl, circle.treasury_id, window.commonCircleWallet)
  const policy = await dao.getPolicy()
  await dao.addProposal(clearFlagProposal({ circleContractId: config.contractId, loanId: loan.loan_id }), policy.proposal_bond)
  await afterTx(`Asked the stewards to forgive the late mark on loan #${loan.loan_id}.`)
}

async function createInvite(): Promise<void> {
  requireWallet()
  const cid = $<HTMLInputElement>('#invite-circle-id').value.trim()
  const inviteeId = $<HTMLInputElement>('#invitee-account-id').value.trim() || null
  const hours = BigInt($<HTMLInputElement>('#invite-expiry-hours').value || '72')
  if (!/^\d+$/.test(cid) || hours <= 0n) throw new Error('Enter a circle number and a positive number of hours.')
  const pair = await generateInviteKeyPair()
  const expiresAt = (BigInt(Date.now()) * 1_000_000n + hours * 3_600_000_000_000n).toString()
  const storage = await readClient.storageCosts()
  await client().registerInvite({ circleId: cid, invitePublicKey: pair.publicKey, expiresAt, inviteeId, deposit: storage.register_invite })
  $<HTMLTextAreaElement>('#invite-link').value = buildInviteLink({ circleId: cid, invitePublicKey: pair.publicKey, inviteSecret: pair.secret })
  show('Invite created. Send the link privately; only the person you named can use it.', 'ok')
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
  requireWallet()
  const name = $<HTMLInputElement>('#new-circle-name').value
  assertCircleName(name)
  const storage = await readClient.storageCosts()
  await client().createCircle({ name, params: testnetDemoParams, theme: readThemeForm('new-circle'), deposit: storage.create_circle })
  show('Circle created with the short testnet settings. Look it up in the Circle tab.', 'ok')
}

async function saveDesign(): Promise<void> {
  requireWallet()
  const cid = $<HTMLInputElement>('#design-circle-id').value.trim()
  if (!/^\d+$/.test(cid)) throw new Error('Enter a circle number.')
  const circle = await readClient.getCircle(cid)
  if (!circle) throw new Error('That circle does not exist.')
  if (circle.admin_id !== accountId) throw new Error(`Only the circle admin (${short(circle.admin_id)}) can change the design. In a DAO circle that is done by proposal.`)
  const storage = await readClient.storageCosts()
  await client().setCircleTheme({ circleId: cid, theme: readThemeForm('design'), deposit: storage.set_circle_theme })
  show('Design saved. Cards update after the transaction is final.', 'ok')
}

async function checkChatAccess(quiet = false): Promise<void> {
  if (!accountId) { if (!quiet) throw new Error('Connect a wallet first.'); return }
  const access = await readClient.checkAccess(circleId, accountId)
  chatUnlocked = access.allowed
  $<HTMLTextAreaElement>('#chat-message').disabled = !chatUnlocked
  $<HTMLButtonElement>('#send-chat').disabled = !chatUnlocked
  $('#chat-access').textContent = chatUnlocked
    ? `Unlocked: you are an active ${access.display_tier ?? 'member'} of this circle.`
    : 'Locked: you need an active card in this circle.'
  if (!quiet) show(chatUnlocked ? 'Chat unlocked.' : 'Chat stays locked.', chatUnlocked ? 'ok' : 'info')
}

function sendChat(): void {
  if (!chatUnlocked) throw new Error('Check your access first.')
  const box = $<HTMLTextAreaElement>('#chat-message')
  const value = box.value.trim()
  if (!value) throw new Error('Write a message first.')
  $('#chat-log').prepend(el('li', {}, el('strong', { textContent: short(accountId) }), ` ${value}`))
  box.value = ''
}

/* ---------- reading state ---------- */

async function refreshMe(): Promise<void> {
  if (!accountId) { me = null; renderAll(); return }
  try {
    if (!usdcId) usdcId = (await readClient.getConfig()).usdc_id
    const usdc = new CircleClient(config.rpcUrl, usdcId)
    const [passport, registration, loans] = await Promise.all([
      readClient.passportFor(circleId, accountId),
      usdc.view<unknown>('storage_balance_of', { account_id: accountId }),
      readClient.loansByBorrower(accountId),
    ])
    me = { passport, registered: !!registration, loans: loans.filter((l) => l.circle_id === circleId), signedIn: signedInAs(accountId) }
  } catch (error) {
    show(`Could not read your account: ${errorText(error)}`, 'bad')
  }
  renderAll()
  await Promise.all([
    loadMyCard().catch(() => {}),
    loadPositions().catch(() => {}),
    checkChatAccess(true).catch(() => {}),
    renderTreasury().catch(() => {}),
  ])
}

async function refreshAll(): Promise<void> {
  await loadDemo()
  await refreshMe()
}

/* ---------- rendering ---------- */

function renderAll(): void {
  renderJourney()
  renderMembers()
}

type StepState = 'done' | 'current' | 'waiting'
function step(n: number, state: StepState, title: string, desc: string | Node, actions: HTMLElement[] = [], form?: HTMLElement): HTMLLIElement {
  const li = el('li', { className: `step ${state}` })
  li.append(
    el('span', { className: 'step-dot', textContent: state === 'done' ? '✓' : String(n) }),
    el('div', {}, el('p', { className: 'step-title', textContent: title }), el('p', { className: 'step-desc' }, desc)),
    el('div', { className: 'step-action' }, ...(state === 'waiting' ? [] : actions)),
  )
  if (form && state === 'current') li.append(form)
  return li
}

function dueSpan(loan: LoanView): HTMLElement {
  const node = el('strong', { className: 'due' })
  node.dataset.due = loan.due_at ?? ''
  return node
}

function loanRequestForm(): HTMLElement {
  const lenders = (demo?.passports ?? []).filter((p) => p.owner_id !== accountId && p.status === 'Active')
  const select = el('select', { id: 'step-lender' })
  for (const p of lenders) select.append(el('option', { value: p.owner_id, textContent: `${short(p.owner_id)} · ${p.display_tier}` }))
  const preferred = lenders.find((p) => p.owner_id === 'commoncircle-light-lender.testnet')
  if (preferred) select.value = preferred.owner_id
  const amount = el('input', { inputMode: 'decimal', value: '1' })
  const days = el('input', { inputMode: 'numeric', value: '7' })
  const send = button('Send request', () => requestLoan(select.value, amount.value, days.value))
  return el('div', { className: 'step-form' },
    el('label', {}, 'Ask', select),
    el('label', {}, 'USDC', amount),
    el('label', {}, 'Days', days),
    send,
  )
}

function renderJourney(): void {
  const circleName = demo?.circle?.name ?? `circle ${circleId}`
  const invite = inviteFields()
  const passport = me?.passport ?? null
  const isMember = !!passport && passport.status === 'Active'
  const loans = (me?.loans ?? []).slice().sort((a, b) => Number(b.loan_id) - Number(a.loan_id))
  const funded = loans.find((l) => l.state === 'Funded' || l.state === 'Repaying')
  const open = loans.find((l) => l.state === 'Open')
  const repaid = loans.find((l) => l.state === 'Repaid')
  const done = [
    !!accountId,
    isMember,
    !!me?.signedIn,
    !!me?.registered,
    !!(funded || repaid),
    !!repaid && !funded,
  ]
  const current = done.findIndex((d) => !d)
  const stateOf = (i: number): StepState => (done[i] ? 'done' : i === current ? 'current' : 'waiting')
  const steps: HTMLLIElement[] = []

  steps.push(step(1, stateOf(0), 'Connect your wallet',
    accountId ? `Connected as ${accountId}.` : 'Use a NEAR testnet wallet. Meteor is recommended. Allow pop-ups when asked.',
    [button('Connect Meteor', () => connectWallet('meteor-wallet')), button('MyNearWallet', () => connectWallet('my-near-wallet'), 'ghost')]))

  steps.push(step(2, stateOf(1), `Join ${circleName}`,
    isMember ? `You are a ${passport!.display_tier} of ${circleName}.`
      : passport ? `Your card is ${passport.status}. Ask the stewards for help.`
        : invite.inviteSecret ? `You have an invite. Joining costs about 0.009 NEAR, which pays for storing your card.`
          : 'You need an invite link from a Trusted member of this circle. Open it in this browser.',
    invite.inviteSecret && !passport ? [button('Join the circle', joinInvite)] : []))

  steps.push(step(3, stateOf(2), 'Sign in',
    me?.signedIn ? 'Signed in for this browser session.' : 'Prove this account is yours with a free signature. Nothing is sent to the blockchain.',
    [button('Sign in', signIn)]))

  steps.push(step(4, stateOf(3), 'Get ready to receive USDC',
    me?.registered ? 'Your account can receive USDC.' : 'A one-time setup so a lender can send you money. Costs 0.00125 NEAR.',
    [button('Set up USDC', registerForUsdc)]))

  const trustedHint = passport?.effective_tier === 'Trusted' && !passport.steward ? ' As a Trusted member you can also ask the treasury (Treasury tab).' : ''
  steps.push(step(5, stateOf(4), 'Ask a member for a loan',
    funded || repaid ? `Loan #${(funded ?? repaid)!.loan_id}: ${formatUsdc((funded ?? repaid)!.principal)} USDC from ${short((funded ?? repaid)!.lender_id)}.`
      : open ? el('span', {}, `Request #${open.loan_id} for ${formatUsdc(open.principal)} USDC is waiting for ${short(open.lender_id)} to fund it (they have 1 hour).`)
        : `Choose who to ask, how much, and for how long. Demo days are 60 seconds, so 7 days means 7 minutes to repay.${trustedHint}`,
    [],
    open ? undefined : loanRequestForm()))

  let repayDesc: string | Node = 'Once your loan arrives, pay it back before the due time. Your card turns Trusted.'
  const repayActions: HTMLElement[] = []
  if (funded) {
    repayDesc = el('span', {}, `You owe ${formatUsdc(funded.outstanding)} USDC to ${short(funded.lender_id)}. `, dueSpan(funded))
    repayActions.push(button('Repay now', () => repay(funded)))
  } else if (repaid) {
    const late = repaid.repaid_on_time === false && !repaid.flag_cleared
    repayDesc = late
      ? 'Repaid, but late. You can ask the stewards to forgive the late mark.'
      : `Repaid on time. Your card is ${passport?.effective_tier ?? 'updated'}${passport?.effective_tier === 'Trusted' ? '. Well done!' : '.'}`
    if (late) repayActions.push(button('Ask stewards to forgive', () => askToForgive(repaid), 'secondary'))
  }
  steps.push(step(6, funded ? 'current' : stateOf(5), 'Pay it back on time', repayDesc, repayActions))

  $('#steps').replaceChildren(...steps)
  $('#journey-sub').textContent = current === -1
    ? 'All done: you joined, borrowed and repaid. Check your card in the Me tab.'
    : 'Follow these in order. Each one updates from the blockchain by itself.'
  tickDue()
}

function renderMembers(): void {
  const grid = $('#demo-cards')
  grid.replaceChildren()
  for (const card of demo?.cards ?? []) {
    const fig = el('figure', { className: `member${card.passport.owner_id === accountId ? ' me' : ''}` })
    if (card.svg) fig.append(el('img', { alt: `${card.passport.owner_id} passport card`, src: URL.createObjectURL(new Blob([card.svg], { type: 'image/svg+xml' })) }))
    fig.append(el('figcaption', {},
      el('span', { className: 'who', title: card.passport.owner_id, textContent: card.passport.owner_id === accountId ? 'You' : short(card.passport.owner_id) }),
      el('span', { className: `tier tier-${card.passport.display_tier}`, textContent: card.passport.display_tier })))
    grid.append(fig)
  }
  if (!grid.children.length) grid.append(el('p', { className: 'muted', textContent: 'No members yet.' }))
}

function renderLoansTable(): void {
  const body = $('#circle-loans')
  const loans = (demo?.loans ?? []).slice().sort((a, b) => Number(b.loan_id) - Number(a.loan_id))
  body.replaceChildren(...(loans.length ? loans.map((l) => el('tr', {},
    el('td', { textContent: l.loan_id }),
    el('td', { className: 'acct', title: l.borrower_id, textContent: short(l.borrower_id) }),
    el('td', { className: 'acct', title: l.lender_id, textContent: l.lender_is_treasury ? 'Treasury (DAO)' : short(l.lender_id) }),
    el('td', { textContent: `${formatUsdc(l.principal)} USDC` }),
    el('td', {}, el('span', { className: `state state-${l.state}`, textContent: l.state === 'Repaid' && l.repaid_on_time === false ? (l.flag_cleared ? 'Repaid (late, forgiven)' : 'Repaid late') : l.state })),
  )) : [el('tr', {}, el('td', { colSpan: 5, className: 'muted', textContent: 'No loans yet.' }))]))
}

function tickDue(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-due]')) {
    const due = node.dataset.due
    if (!due) { node.textContent = ''; continue }
    const ms = Number(BigInt(due) / 1_000_000n) - Date.now()
    node.textContent = ms > 0 ? `Due in ${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}` : 'Past due: repay now'
  }
}

async function loadMyCard(): Promise<void> {
  const image = $<HTMLImageElement>('#my-card-image')
  if (!accountId || !me?.passport) {
    image.hidden = true
    $('#load-my-card').hidden = true
    $('#my-card-title').textContent = accountId ? 'You do not have a card in this circle yet. Join with an invite (step 2).' : 'Connect a wallet and join to see your card.'
    return
  }
  const passport = me.passport
  const [svg, token] = await Promise.all([readClient.cardSvg(passport.token_id), readClient.nftToken(passport.token_id)])
  if (svg) {
    image.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    image.hidden = false
  }
  $('#load-my-card').hidden = false
  $('#my-card-title').textContent = `${token?.metadata?.title ?? passportTokenTitle(demo?.circle?.name ?? '')} · ${passport.display_tier} · on time ${passport.on_time_count}, late ${passport.late_count}`
}

async function loadPositions(): Promise<void> {
  const list = $('#positions')
  if (!accountId) { list.replaceChildren(el('li', { className: 'muted', textContent: 'Connect a wallet to see your loans.' })); return }
  const positions = await readClient.myPositions(accountId)
  const items: HTMLLIElement[] = []
  if (me && !me.registered) {
    items.push(el('li', {}, el('span', { textContent: 'Not set up for USDC yet, so nobody can send you a loan.' }), button('Set up USDC', registerForUsdc)))
  }
  for (const loan of positions.borrowed.slice().reverse()) {
    const li = el('li', {}, el('span', {},
      el('strong', { textContent: `Borrowed #${loan.loan_id}` }),
      ` · ${formatUsdc(loan.principal)} USDC from ${short(loan.lender_id)} `,
      el('span', { className: `state state-${loan.state}`, textContent: loan.state }),
      ' ', loan.state === 'Funded' ? dueSpan(loan) : ''))
    if (loan.state === 'Funded') li.append(button('Repay', () => repay(loan)))
    const late = (loan.overdue || (loan.state === 'Repaid' && loan.repaid_on_time === false)) && !loan.flag_cleared
    if (late) li.append(button('Ask stewards to forgive', () => askToForgive(loan), 'secondary'))
    const note = repaymentNotice(null, loan)
    if (note) li.append(el('p', { className: 'notice', textContent: note }))
    items.push(li)
  }
  for (const loan of positions.lent.slice().reverse()) {
    const li = el('li', {}, el('span', {},
      el('strong', { textContent: `Lent #${loan.loan_id}` }),
      ` · ${formatUsdc(loan.principal)} USDC to ${short(loan.borrower_id)} `,
      el('span', { className: `state state-${loan.state}`, textContent: loan.state })))
    if (loan.state === 'Open') li.append(button('Fund it', () => fund(loan)))
    items.push(li)
  }
  if (!items.length) items.push(el('li', { className: 'muted', textContent: 'No loans yet. Ask a member in step 5.' }))
  list.replaceChildren(...items)
  tickDue()
}

async function renderTreasury(): Promise<void> {
  const panel = $('#treasury-actions')
  const none = $('#treasury-none')
  if (!demo?.circle?.treasury_id || !demo.dao?.verified) { panel.hidden = true; none.hidden = false; $('#stat-treasury').textContent = 'none'; return }
  panel.hidden = false
  none.hidden = true
  const daoId = demo.circle.treasury_id
  const cid = demo.circle.circle_id
  const dao = new SputnikDaoClient(config.rpcUrl, daoId, window.commonCircleWallet)
  const usdc = new CircleClient(config.rpcUrl, demo.config.usdc_id)
  const [policy, proposals, balance] = await Promise.all([
    dao.getPolicy(),
    dao.recentProposals(10),
    usdc.view<string>('ft_balance_of', { account_id: daoId }),
  ])
  const stewards = stewardsOf(policy)
  const bondNear = (Number(BigInt(policy.proposal_bond) / 10n ** 18n) / 1e6).toString()
  $('#stat-treasury').textContent = `${formatUsdc(balance)} USDC`
  $('#treasury-summary').textContent = `Holds ${formatUsdc(balance)} USDC · Stewards: ${stewards.map(short).join(' and ')} · Asking costs a ${bondNear} NEAR deposit, returned when the vote passes.`

  const isSteward = !!accountId && stewards.includes(accountId)
  const passport = accountId ? await readClient.passportFor(cid, accountId) : null
  const eligible = !!passport && passport.effective_tier === 'Trusted' && !passport.steward && passport.status === 'Active'
  $('#treasury-ask').hidden = !eligible
  $('#treasury-eligibility').textContent = !accountId
    ? 'Connect a wallet to ask the treasury or, if you are a steward, to vote.'
    : isSteward ? 'You are a steward: approve requests below. Stewards cannot borrow from the treasury.'
      : !passport ? 'Join the circle first (step 2).'
        : !eligible ? `Your card is ${passport.effective_tier}${passport.perks_paused ? ', with perks paused by an overdue loan' : ''}. The treasury lends only to Trusted members: repay a loan on time first.`
          : ''

  if (eligible) {
    const mine = await readClient.loansByBorrower(accountId)
    const pending = loansNeedingProposal(mine, daoId, accountId, proposals)
    $('#treasury-pending').replaceChildren(...pending.map((loan) => el('li', {},
      el('span', { textContent: `Request #${loan.loan_id} · ${formatUsdc(loan.principal)} USDC · not sent to the stewards yet` }),
      button('2. Send to stewards', async () => {
        await dao.addProposal(treasuryFundProposal({ usdcId: demo!.config.usdc_id, circleContractId: config.contractId, loanId: loan.loan_id, amount: loan.principal, borrowerId: accountId }), policy.proposal_bond)
        await afterTx(`Sent to the stewards. The money arrives when both have approved.`)
      }))))
  }

  $('#treasury-proposals').replaceChildren(...(proposals.length ? proposals.map((p: SputnikProposal) => {
    const target = proposalLoanId(p)
    const approvals = Object.values(p.votes ?? {}).filter((v) => v === 'Approve').length
    const canVote = isSteward && p.status === 'InProgress' && !(accountId in (p.votes ?? {}))
    const what = target ? (target.action === 'fund' ? `Pay loan #${target.loanId}` : `Forgive late mark on loan #${target.loanId}`) : p.description
    const li = el('li', {}, el('span', {},
      el('strong', { textContent: `#${p.id} ${what}` }),
      ` · by ${short(p.proposer)} · ${approvals} of ${stewards.length} approvals `,
      el('span', { className: `state state-${p.status === 'Approved' ? 'Repaid' : p.status === 'InProgress' ? 'Open' : 'Cancelled'}`, textContent: p.status === 'InProgress' ? 'Voting' : p.status })))
    if (canVote) li.append(button('Approve', async () => { await dao.approve(p); await afterTx(`You approved proposal #${p.id}.`) }))
    return li
  }) : [el('li', { className: 'muted', textContent: 'No proposals yet. A Trusted member files the first request.' })]))
}

async function requestFromTreasury(): Promise<void> {
  requireWallet()
  if (!demo?.circle?.treasury_id || !demo.dao?.verified) throw new Error('This circle has no verified DAO treasury.')
  const amount = usdcToBaseUnits($<HTMLInputElement>('#treasury-amount').value)
  const days = Number($<HTMLInputElement>('#treasury-days').value || DEMO_TREASURY_LOAN_DAYS)
  if (!Number.isInteger(days) || days < 1) throw new Error('Days must be a whole number.')
  const storage = await readClient.storageCosts()
  await client().createLoan({ circleId: demo.circle.circle_id, lenderId: demo.circle.treasury_id, amount, durationDays: days, deposit: storage.create_loan })
  await afterTx('Request recorded. Now press "2. Send to stewards".')
}

async function loadDemo(): Promise<void> {
  const requested = $<HTMLInputElement>('#demo-circle-id').value.trim() || circleId
  const snapshot = await loadReadOnlyDemo(requested)
  demo = snapshot
  circleId = snapshot.circleId
  if (!usdcId) usdcId = snapshot.config.usdc_id
  for (const id of ['#my-card-circle-id', '#chat-circle-id']) $<HTMLInputElement>(id).value = circleId
  const lines = [
    `Contract ${snapshot.contractId} · interface ${snapshot.config.interface_version}`,
    `RPC ${snapshot.rpcUrl}`,
    `USDC ${snapshot.config.usdc_id}`,
    `Circle ${snapshot.circleId}: ${snapshot.circle ? snapshot.circle.name : 'does not exist'}`,
  ]
  if (snapshot.circle) {
    lines.push(`Admin ${snapshot.circle.admin_id} · treasury ${snapshot.circle.treasury_id ?? 'none'}`)
    for (const p of snapshot.passports) lines.push(`Card ${p.token_id} · ${p.display_tier} · ${p.status}`)
  }
  $('#demo-output').textContent = lines.join('\n')
  $('#circle-name').textContent = snapshot.circle ? snapshot.circle.name : `Circle ${snapshot.circleId} does not exist`
  $('#stat-members').textContent = snapshot.circle ? String(snapshot.circle.member_count) : '–'
  $('#stat-loans').textContent = snapshot.circle ? String(snapshot.circle.loan_count) : '–'
  const dao = $('#dao-status')
  if (snapshot.dao) {
    dao.textContent = snapshot.dao.verified
      ? '✓ Run by a real Sputnik DAO with no keys: only votes move its money.'
      : '⚠ The treasury account failed the DAO safety check. Treasury buttons are hidden.'
    dao.title = `${snapshot.dao.daoId} · code ${snapshot.dao.codeHash ?? 'unknown'} · keys ${snapshot.dao.accessKeyCount ?? 'unknown'}`
    dao.className = `dao-status ${snapshot.dao.verified ? 'trusted' : ''}`
  } else {
    dao.textContent = 'No DAO is attached yet: the founder runs this circle.'
    dao.className = 'dao-status neutral'
  }
  renderMembers()
  renderLoansTable()
  renderJourney()
  await renderTreasury().catch((error) => show(`Treasury: ${errorText(error)}`, 'bad'))
}

/* ---------- tabs and wiring ---------- */

const TABS = ['circle', 'treasury', 'me', 'tools'] as const
function goTab(name: (typeof TABS)[number]): void {
  for (const t of TABS) {
    $(`#tab-btn-${t}`).setAttribute('aria-selected', String(t === name))
    $(`#tab-${t}`).hidden = t !== name
  }
  try { localStorage.setItem('commoncircle.tab', name) } catch { /* ignore */ }
}

function on(selector: string, action: () => Promise<void> | void): void {
  const b = $<HTMLButtonElement>(selector)
  b.addEventListener('click', () => void run(b, async () => { await action() }))
}

function wire(): void {
  on('#connect-meteor', () => connectWallet('meteor-wallet'))
  on('#connect-wallet', () => connectWallet('my-near-wallet'))
  on('#disconnect-wallet', disconnectWallet)
  on('#sign-in', signIn)
  on('#join-invite', joinInvite)
  on('#create-invite', createInvite)
  on('#create-circle', createCircle)
  on('#create-loan', () => requestLoan(
    $<HTMLInputElement>('#loan-lender-id').value.trim(),
    $<HTMLInputElement>('#loan-amount').value,
    $<HTMLInputElement>('#loan-duration-days').value,
    $<HTMLInputElement>('#loan-circle-id').value.trim(),
  ))
  on('#save-design', saveDesign)
  on('#load-positions', refreshMe)
  on('#check-chat-access', () => checkChatAccess(false))
  on('#send-chat', sendChat)
  on('#load-my-card', loadMyCard)
  on('#load-demo', refreshAll)
  on('#journey-refresh', async () => { await refreshAll(); show('Up to date with testnet.', 'ok') })
  on('#treasury-request', requestFromTreasury)
  for (const t of TABS) $(`#tab-btn-${t}`).addEventListener('click', () => goTab(t))
  bindThemeForm('new-circle', () => $<HTMLInputElement>('#new-circle-name').value.trim() || 'New circle', (error) => show(errorText(error), 'bad'))
  bindThemeForm('design', () => `Circle ${$<HTMLInputElement>('#design-circle-id').value.trim() || '?'}`, (error) => show(errorText(error), 'bad'))
  $<HTMLInputElement>('#new-circle-name').addEventListener('input', () => renderThemePreview('new-circle', $('#new-circle-preview'), $<HTMLInputElement>('#new-circle-name').value.trim() || 'New circle'))
  for (const id of ['#circle-id', '#invite-public-key', '#invite-secret']) $(id).addEventListener('input', () => renderJourney())
  window.setInterval(tickDue, 1000)
}

function hydrateInviteFields(): void {
  const invite = parseInviteLink()
  if (invite.circleId) {
    $<HTMLInputElement>('#circle-id').value = invite.circleId
    $<HTMLInputElement>('#demo-circle-id').value = invite.circleId
    circleId = invite.circleId
  }
  if (invite.invitePublicKey) $<HTMLInputElement>('#invite-public-key').value = invite.invitePublicKey
  if (invite.inviteSecret) $<HTMLInputElement>('#invite-secret').value = invite.inviteSecret
}

function boot(): void {
  hydrateInviteFields()
  wire()
  let tab: (typeof TABS)[number] = 'circle'
  try { const saved = localStorage.getItem('commoncircle.tab'); if (saved && (TABS as readonly string[]).includes(saved)) tab = saved as typeof tab } catch { /* ignore */ }
  goTab(tab)
  renderJourney()
  void loadDemo().catch((error) => show(`Could not load testnet data: ${errorText(error)}`, 'bad'))
  void restoreWallet().catch(() => { /* no saved wallet session */ })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
else boot()
