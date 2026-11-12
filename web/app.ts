import { CircleClient, parseFtTransferCallOutcome, passportTokenTitle, type CircleParams, type LoanView, type PassportView } from './circle-client'
import { friendlyError, isRepeat, TOAST_MS, type NextAction, type ToastKind } from './notify'
import { badgeFor, memberLabel, type Tier } from './labels'
import { borrowLimit, canCancel, countdown, formatDuration, isWaiting, loanLengthText, requestsForLender, trustedProgress, validateLoanInput } from './loan-rules'
import { explorerTxUrl, moneySummary, runMoney, type MoneyDeps, type MoneyKind } from './money'
import { signInWithNep413 } from './nep413'
import { buildInviteLink, generateInviteKeyPair, parseInviteLink, signInviteWithSecret } from './invite'
import { loadReadOnlyDemo, type ReadOnlyDemoSnapshot } from './demo'
import { bindThemeForm, readThemeForm, renderThemePreview } from './theme'
// The wallet library (~1.5 MB) loads only on Connect or when a session exists.
import type { NearWalletController } from './near-wallet'
import { assertCircleName } from './text-rules'
import { avatarFor, ChatApiError, ChatClient, dayLabel, timeLabel, type ChatMessage, type LoanRequestCard } from './chat'
import {
  clearFlagProposal, DEMO_TREASURY_LOAN_DAYS, formatUsdc, loansNeedingProposal, proposalLoanId, repaymentNotice,
  SputnikDaoClient, stewardsOf, treasuryFundProposal, type SputnikProposal,
} from './treasury'

declare global {
  interface Window {
    commonCircleWallet?: NearWalletController
    commonCircleInviteSigner?: (input: { message: string; secret: string }) => Promise<string>
    COMMONCIRCLE_CONFIG?: { rpcUrl: string; contractId: string; authUrl: string; recipient: string; explorerUrl?: string }
  }
}

const config = {
  rpcUrl: 'https://test.rpc.fastnear.com',
  contractId: 'commoncircle-light.testnet',
  authUrl: 'http://localhost:3001',
  recipient: window.location.host,
  explorerUrl: 'https://testnet.nearblocks.io',
  ...window.COMMONCIRCLE_CONFIG,
}
const readClient = new CircleClient(config.rpcUrl, config.contractId)
const client = () => new CircleClient(config.rpcUrl, config.contractId, window.commonCircleWallet)
const TOKEN_KEY = 'commoncircle.session'
const VIEWS = ['home', 'chat', 'loans', 'direct', 'treasury', 'members', 'tools'] as const
type View = (typeof VIEWS)[number]

/** loans: as borrower in this circle; lent: as lender in this circle. */
type Me = { passport: PassportView | null; registered: boolean; loans: LoanView[]; lent: LoanView[]; signedIn: boolean; circles: Array<{ id: string; name: string }> }

let accountId = ''
let circleId = '3'
let walletController: NearWalletController | null = null
let demo: ReadOnlyDemoSnapshot | null = null
let me: Me | null = null
let usdcId = ''
let view: View = 'home'

// chat state
let chatRoom = '3'
let chatAllowed = false
const chatMessages = new Map<string, ChatMessage[]>()
const chatSeen = new Map<string, number>()
/** Loan request cards per circle room (server/requests.ts); needs the sign-in token. */
const chatRequests = new Map<string, LoanRequestCard[]>()
let chatTimer = 0

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector(selector) as T
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}
/** "The Dogs (DEMO)" -> "TD" */
const roomInitials = (name: string) => {
  const words = name.replace(/\(.*?\)/g, '').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w))
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase() || '#'
}

function avatar(account: string, size = ''): HTMLSpanElement {
  const { initials, hue } = avatarFor(account)
  const node = el('span', { className: `avatar${size ? ` avatar-${size}` : ''}`, textContent: initials, title: account })
  node.style.setProperty('--h', String(hue))
  return node
}

function who(account: string, label = memberLabel(account)): HTMLSpanElement {
  return el('span', { className: 'who', title: account }, avatar(account, 'sm'), el('span', { textContent: label }))
}

/** One badge component for Member / Trusted / Steward. */
function badge(tier: Tier): HTMLSpanElement {
  const b = badgeFor(tier)
  return el('span', { className: b.className, textContent: b.text })
}

/** A friendly account label: short text, full account in the tooltip, copied on click. */
function accountChip(account: string, label = account === accountId && accountId ? 'You' : memberLabel(account)): HTMLButtonElement {
  const chip = el('button', { className: 'acct', type: 'button', title: `${account} (click to copy)` }, el('span', { textContent: label }))
  chip.addEventListener('click', (event) => {
    event.stopPropagation()
    void navigator.clipboard?.writeText(account).then(() => show(`Copied ${account}.`, 'ok'), () => show(account, 'info'))
  })
  return chip
}

/* ---------- messages to the user ---------- */

let toastTimer = 0
let toastShown: { text: string; kind: ToastKind; next: NextAction } | null = null

function hideToast(): void {
  window.clearTimeout(toastTimer)
  $('#status').hidden = true
  toastShown = null
}

/** One toast at a time; repeats only restart the timer. `retry` re-runs the failed action. */
function show(message: string, kind: ToastKind = 'info', next: NextAction = null, retry?: () => Promise<void>): void {
  const toast = $('#status')
  const repeat = isRepeat(toastShown, { text: message, kind })
  toastShown = { text: message, kind, next }
  if (!repeat) {
    $('#status-text').textContent = message
    const actions: HTMLElement[] = []
    if (next === 'connect') actions.push(button('Retry', async () => { hideToast(); await connectWallet(lastWalletId) }, 'soft'))
    else if (next === 'retry' && retry) actions.push(button('Retry', async () => { hideToast(); await retry() }, 'soft'))
    $('#status-actions').replaceChildren(...actions)
    toast.className = `toast ${kind}`
    toast.hidden = false
  }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(hideToast, TOAST_MS[kind])
}

/** A plain sentence for any error (wallet, network, RPC, contract, chat server). */
function errorText(error: unknown, context: 'wallet' | 'chat' | 'chain' = 'chain'): string {
  if (error instanceof ChatApiError) return error.message
  return friendlyError(error, context).text
}

function showError(error: unknown, context: 'wallet' | 'chat' | 'chain' = 'chain', retry?: () => Promise<void>): void {
  const friendly = error instanceof ChatApiError ? { text: error.message, next: null } : friendlyError(error, context)
  show(friendly.text, 'bad', friendly.next, retry)
}

async function run(b: HTMLButtonElement | null, action: () => Promise<void>, context: 'wallet' | 'chat' | 'chain' = 'chain'): Promise<void> {
  if (b) { b.disabled = true; b.classList.add('busy') }
  try {
    await action()
  } catch (error) {
    // A wallet error that arrives after another path already connected the account is stale.
    if (context === 'wallet' && accountId) return
    showError(error, context, action)
  } finally {
    if (b) { b.disabled = false; b.classList.remove('busy') }
  }
}

function button(label: string, action: () => Promise<void>, kind: 'accent' | 'soft' | 'ghost' = 'accent', context: 'wallet' | 'chat' | 'chain' = 'chain'): HTMLButtonElement {
  const b = el('button', { className: `btn btn-${kind} btn-sm`, textContent: label, type: 'button' })
  b.addEventListener('click', () => void run(b, action, context))
  return b
}

function connectButtons(): HTMLButtonElement[] {
  return [
    button('Connect Meteor', () => connectWallet('meteor-wallet'), 'accent', 'wallet'),
    button('MyNearWallet', () => connectWallet('my-near-wallet'), 'ghost', 'wallet'),
  ]
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function afterTx(message: string): Promise<void> {
  show(`${message} Updating from testnet…`, 'ok')
  await wait(2500)
  await refreshAll()
  show(message, 'ok')
}

/* ---------- views ---------- */

function goView(next: View): void {
  view = next
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== next
  for (const item of document.querySelectorAll<HTMLButtonElement>('.nav-item')) item.classList.toggle('active', item.dataset.view === next)
  $('#crumb-view').textContent = $(`#view-${next}`).dataset.title ?? ''
  $('#sidebar').classList.remove('open')
  $('#panel').scrollTop = 0
  try { localStorage.setItem('commoncircle.view', next) } catch { /* ignore */ }
  if (next === 'chat') { void openRoom(chatRoom); startChatPolling() } else stopChatPolling()
}

/* ---------- wallet ---------- */

function onAccountChange(nextAccountId: string): void {
  const changed = nextAccountId !== accountId
  accountId = nextAccountId
  $<HTMLInputElement>('#account-id').value = nextAccountId
  $('#profile-out').hidden = !!nextAccountId
  $('#profile-in').hidden = !nextAccountId
  $('#wallet-account').textContent = nextAccountId
  $('#wallet-account').title = nextAccountId
  $('#profile-avatar').replaceWith(Object.assign(avatar(nextAccountId || '?'), { id: 'profile-avatar' }))
  // Re-render now so step 1 shows "Connected" at once; refreshMe() fills in the rest
  // after its testnet reads, which can take a few seconds.
  // A "connect your wallet" error is stale once an account is connected.
  if (nextAccountId && toastShown?.next === 'connect') hideToast()
  if (changed) { chatMessages.clear(); renderAll(); void refreshMe() }
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

type WalletId = 'my-near-wallet' | 'meteor-wallet'
let lastWalletId: WalletId = 'meteor-wallet'

async function connectWallet(walletId: WalletId): Promise<void> {
  lastWalletId = walletId
  if (!walletController) {
    show('Opening the wallet…')
    const { createNearWallet } = await import('./near-wallet')
    walletController = await createNearWallet({ contractId: config.contractId, onAccountChange })
    window.commonCircleWallet = walletController
  }
  const connected = await walletController.connect(walletId)
  show(`Connected as ${memberLabel(connected)}.`, 'ok')
}

async function disconnectWallet(): Promise<void> {
  if (!walletController) return
  await walletController.disconnect()
  try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
  me = null
  renderAll()
  show('Wallet disconnected.')
}

/** Switch account: sign out of the wallet, then sign in again (the wallet lets you pick). */
async function switchWallet(): Promise<void> {
  const id = lastWalletId
  await disconnectWallet()
  await connectWallet(id)
}

function requireWallet(): void {
  if (!window.commonCircleWallet || !accountId) throw new Error('Connect a wallet first (bottom left).')
}

/* ---------- sign-in token ---------- */

function session(): { accountId: string; token: string } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null') as { accountId?: string; token?: string } | null
    return saved?.accountId && saved.token ? { accountId: saved.accountId, token: saved.token } : null
  } catch {
    return null
  }
}

function chatClient(): ChatClient | null {
  const s = session()
  return s && s.accountId === accountId ? new ChatClient(config.authUrl, s.token) : null
}

async function signIn(): Promise<void> {
  requireWallet()
  const result = await signInWithNep413({ authUrl: config.authUrl, recipient: config.recipient, accountId, wallet: window.commonCircleWallet! })
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accountId: result.accountId, token: result.token })) } catch { /* ignore */ }
  await refreshMe()
  show(`Signed in as ${result.accountId}. No fee was charged.`, 'ok')
}

/* ---------- on-chain actions ---------- */

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
  if (!inviteSecret || !invitePublicKey || !cid) throw new Error('Open your invite link first (or fill in the invite details).')
  const invite = await readClient.getInvite(invitePublicKey)
  if (!invite) throw new Error('This invite was already used or does not exist.')
  if (invite.expired) throw new Error('This invite has expired. Ask for a new one.')
  if (invite.invitee_id && invite.invitee_id !== accountId) throw new Error(`This invite is for ${invite.invitee_id}. Connect that account instead.`)
  const storage = await readClient.storageCosts()
  const signer = window.commonCircleInviteSigner ?? signInviteWithSecret
  await client().joinByInvite({ circleId: cid, callerId: accountId, invitePublicKey, inviteSecret, signInvite: signer, deposit: storage.redeem_invite })
  forgetInvite()
  await afterTx('Welcome to the circle! Your card is being created.')
}

async function getUsdcId(): Promise<string> {
  if (!usdcId) usdcId = (await readClient.getConfig()).usdc_id
  return usdcId
}

async function registerForUsdc(): Promise<void> {
  requireWallet()
  await client().registerWithToken({ tokenId: await getUsdcId(), accountId })
  await afterTx('Ready: lenders can now send you USDC.')
}

/** create_loan in the current circle. `amount` is base units, already validated by the form. */
/** The new loan id from a create_loan outcome (loan_created event), else the newest matching open loan. */
async function newLoanId(raw: unknown, lenderId: string, amount: string): Promise<string | null> {
  const event = parseFtTransferCallOutcome(raw).events.find((e) => e.event === 'loan_created')
  const fromEvent = (event?.data[0] as { loan_id?: string } | undefined)?.loan_id
  if (fromEvent) return fromEvent
  const mine = await readClient.loansByBorrower(accountId).catch(() => [])
  return mine.filter((l) => l.lender_id === lenderId && l.principal === amount && l.state === 'Open').map((l) => l.loan_id).sort((a, b) => Number(b) - Number(a))[0] ?? null
}

async function requestLoan(lenderId: string, amount: string, durationDays: number, note = ''): Promise<void> {
  requireWallet()
  if (!lenderId) throw new Error('Choose who you are asking.')
  const storage = await readClient.storageCosts()
  const raw = await client().createLoan({ circleId, lenderId, amount, durationDays, deposit: storage.create_loan })
  const chat = chatClient()
  if (note.trim() && chat) {
    const loanId = await newLoanId(raw, lenderId, amount)
    if (loanId) await chat.directNote(circleId, loanId, note.trim()).catch(() => show('The loan is on-chain, but its reason could not be saved (chat server offline).', 'bad'))
  }
  const treasury = lenderId === demo?.circle?.treasury_id
  const fundingWindow = demo?.circle ? formatDuration(BigInt(demo.circle.params.funding_window_sec)) : 'the funding window'
  await afterTx(treasury ? 'Request recorded. Now open Treasury and press "2. Send to stewards".' : `Request sent. ${memberLabel(lenderId)} has ${fundingWindow} to fund it.`)
}

/* ---------- money actions: summary -> pending -> success / failure ---------- */

function moneyDeps(): MoneyDeps {
  const c = client()
  return {
    fundLoan: (input) => c.fundLoan(input),
    repayLoan: (input) => c.repayLoan(input),
    cancelLoan: (loanId) => c.cancelLoan(loanId),
    getLoan: (loanId) => readClient.getLoan(loanId),
    isRegistered: async (account) => !!(await new CircleClient(config.rpcUrl, await getUsdcId()).view<unknown>('storage_balance_of', { account_id: account })),
  }
}

/** Opens the "check before you sign" dialog; the action runs only on Confirm. */
async function money(kind: MoneyKind, loan: LoanView): Promise<void> {
  requireWallet()
  const dialog = $<HTMLDialogElement>('#money-dialog')
  const summary = moneySummary(kind, loan, memberLabel, demo?.circle?.params.day_length_sec ?? '86400')
  const state = $('#money-state')
  const confirm = $<HTMLButtonElement>('#money-confirm')
  const back = $<HTMLButtonElement>('#money-back')
  $('#money-title').textContent = summary.title
  $('#money-lines').replaceChildren(...summary.lines.map((line) => el('li', { textContent: line })))
  state.hidden = true
  state.className = 'money-state'
  confirm.textContent = summary.confirm
  confirm.disabled = false
  back.hidden = false
  back.disabled = false
  let finished = false
  confirm.onclick = async () => {
    if (finished) { dialog.close(); return }
    confirm.disabled = true
    back.disabled = true
    confirm.classList.add('busy')
    state.hidden = false
    state.textContent = 'Waiting for you to approve it in your wallet window…'
    const result = await runMoney(kind, loan, moneyDeps(), await getUsdcId().catch(() => ''), memberLabel)
    confirm.classList.remove('busy')
    state.className = `money-state ${result.ok ? 'ok' : 'bad'}`
    state.replaceChildren(result.text, ...(result.txHash ? [' ', el('a', { href: explorerTxUrl(config.explorerUrl, result.txHash), target: '_blank', rel: 'noopener', textContent: 'View the transaction' })] : []))
    finished = true
    confirm.textContent = 'Done'
    confirm.disabled = false
    back.hidden = true
    if (result.ok) show(result.text, 'ok')
    void refreshAll().catch(() => {})
  }
  back.onclick = () => dialog.close()
  dialog.showModal()
}

const fund = (loan: LoanView) => money('fund', loan)
const repay = (loan: LoanView) => money('repay', loan)
const cancelRequest = (loan: LoanView) => money('cancel', loan)

/** A live countdown: tick() fills it in every second. */
function untilSpan(targetNs: string | null, prefix: string, after: string): HTMLElement {
  const node = el('strong', { className: 'until' })
  node.dataset.until = targetNs ?? ''
  node.dataset.prefix = prefix
  node.dataset.after = after
  return node
}

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
  const cid = circleId
  const inviteeId = $<HTMLInputElement>('#invitee-account-id').value.trim() || null
  const hoursText = $<HTMLInputElement>('#invite-expiry-hours').value.trim() || '24'
  if (!/^\d+$/.test(hoursText) || hoursText === '0') throw new Error('Enter how many hours the link should work, for example 24.')
  if (inviteeId && !/^[a-z0-9._-]+\.testnet$/.test(inviteeId)) throw new Error('Enter their testnet account, for example friend.testnet.')
  const hours = BigInt(hoursText)
  const pair = await generateInviteKeyPair()
  const expiresAt = (BigInt(Date.now()) * 1_000_000n + hours * 3_600_000_000_000n).toString()
  const storage = await readClient.storageCosts()
  await client().registerInvite({ circleId: cid, invitePublicKey: pair.publicKey, expiresAt, inviteeId, deposit: storage.register_invite })
  const box = $<HTMLTextAreaElement>('#invite-link')
  box.value = buildInviteLink({ circleId: cid, invitePublicKey: pair.publicKey, inviteSecret: pair.secret })
  box.hidden = false
  $('#copy-invite').hidden = false
  show(inviteeId ? `Invite created for ${inviteeId}. Copy the link and send it privately.` : 'Invite created. Copy the link and send it privately.', 'ok')
}

const testnetDemoParams: CircleParams = {
  min_amount: '1000000', member_max_amount: '10000000', trusted_max_amount: '50000000', max_duration_days: 14,
  day_length_sec: '60', funding_window_sec: '3600', qualifying_min_amount: '1000000', qualifying_min_days: 1,
  trusted_threshold: 1, min_distinct_lenders: 1, recovery_lock_sec: '0', writeoff_grace_sec: '2592000',
}

async function createCircle(): Promise<void> {
  requireWallet()
  const name = $<HTMLInputElement>('#new-circle-name').value
  assertCircleName(name)
  const storage = await readClient.storageCosts()
  await client().createCircle({ name, params: testnetDemoParams, theme: readThemeForm('new-circle'), deposit: storage.create_circle })
  show('Circle created with the short testnet settings.', 'ok')
}

async function saveDesign(): Promise<void> {
  requireWallet()
  const cid = $<HTMLInputElement>('#design-circle-id').value.trim()
  if (!/^\d+$/.test(cid)) throw new Error('Enter a circle number.')
  const circle = await readClient.getCircle(cid)
  if (!circle) throw new Error('That circle does not exist.')
  if (circle.admin_id !== accountId) throw new Error(`Only the circle admin (${memberLabel(circle.admin_id)}) can change the design. In a DAO circle that is done by vote.`)
  const storage = await readClient.storageCosts()
  await client().setCircleTheme({ circleId: cid, theme: readThemeForm('design'), deposit: storage.set_circle_theme })
  show('Design saved. Cards update after the transaction is final.', 'ok')
}

/* ---------- chat ---------- */

function roomName(id: string): string {
  return me?.circles.find((c) => c.id === id)?.name ?? (demo?.circle?.circle_id === id ? demo.circle.name : `Circle ${id}`)
}

function tierOf(account: string): Tier | null {
  return demo?.passports.find((p) => p.owner_id === account)?.display_tier ?? null
}

function renderRooms(): void {
  const query = $<HTMLInputElement>('#chat-search').value.trim().toLowerCase()
  const ids = new Set<string>([...(me?.circles ?? []).map((c) => c.id), circleId])
  const rooms = [...ids].filter((id) => roomName(id).toLowerCase().includes(query))
  $('#room-list').replaceChildren(...(rooms.length ? rooms.map((id) => {
    const msgs = chatMessages.get(id) ?? []
    const last = msgs[msgs.length - 1]
    const unread = msgs.filter((m) => m.id > (chatSeen.get(id) ?? 0) && m.account_id !== accountId).length
    const item = el('button', { className: `room${id === chatRoom ? ' active' : ''}`, type: 'button' })
    const icon = el('span', { className: 'avatar avatar-room', textContent: roomInitials(roomName(id)) })
    item.append(icon, el('span', { className: 'room-main' },
      el('span', { className: 'room-name' }, el('span', { textContent: roomName(id) }), last ? el('time', { textContent: timeLabel(last.at) }) : ''),
      el('span', { className: 'room-last', textContent: last ? `${last.account_id === accountId ? 'You' : memberLabel(last.account_id)}: ${last.text}` : chatAllowed || id !== chatRoom ? 'No messages yet' : 'Members only' }),
      unread && id !== chatRoom ? el('span', { className: 'room-new', textContent: `${unread} new message${unread > 1 ? 's' : ''}` }) : ''))
    item.addEventListener('click', () => void openRoom(id))
    return el('li', {}, item)
  }) : [el('li', { className: 'muted small', textContent: 'No rooms match.' })]))

  const people = (demo?.circle?.circle_id === chatRoom ? demo.passports : [])
  $('#people-list').replaceChildren(...(people.length ? people.map((p) => el('li', {}, el('div', { className: 'room' },
    avatar(p.owner_id),
    el('span', { className: 'room-main' },
      el('span', { className: 'room-name' }, accountChip(p.owner_id), badge(p.display_tier)),
      el('span', { className: 'room-last', textContent: `On time ${p.on_time_count} · late ${p.late_count}` }))))) : [el('li', { className: 'muted small', textContent: 'Open the circle in Home to see its people.' })]))
  updateChatBadge()
}

function renderMessages(): void {
  const box = $('#messages')
  const msgs = chatMessages.get(chatRoom) ?? []
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80
  box.replaceChildren()
  if (!chatAllowed) {
    box.append(el('p', { className: 'chat-empty', textContent: 'Messages in this room are visible to its members only.' }))
    return
  }
  const cards = chatRequests.get(chatRoom) ?? []
  if (!msgs.length && !cards.length) {
    box.append(el('p', { className: 'chat-empty', textContent: 'No messages yet. Say hello, or press + to ask the circle for a loan.' }))
    return
  }
  let lastDay = ''
  let prev: ChatMessage | null = null
  const stream: Array<{ at: number; msg?: ChatMessage; card?: LoanRequestCard }> = [...msgs.map((m) => ({ at: m.at, msg: m })), ...cards.map((c) => ({ at: c.at, card: c }))].sort((a, b) => a.at - b.at)
  for (const item of stream) {
    const day = dayLabel(item.at)
    if (day !== lastDay) { box.append(el('p', { className: 'day', textContent: day })); lastDay = day; prev = null }
    if (item.card) { box.append(requestCard(item.card)); prev = null; continue }
    const m = item.msg!
    const mine = m.account_id === accountId
    const cont = !!prev && prev.account_id === m.account_id && m.at - prev.at < 5 * 60_000
    const tier = tierOf(m.account_id)
    const meta = el('div', { className: 'msg-meta' }, avatar(m.account_id, 'sm'), el('strong', { title: m.account_id, textContent: mine ? 'You' : memberLabel(m.account_id) }),
      tier ? badge(tier) : '', el('span', { textContent: timeLabel(m.at) }))
    box.append(el('div', { className: `msg${mine ? ' mine' : ''}${cont ? ' cont' : ''}` }, meta, el('div', { className: 'bubble', textContent: m.text })))
    prev = m
  }
  if (nearBottom || msgs.length) box.scrollTop = box.scrollHeight
  if (msgs.length) chatSeen.set(chatRoom, msgs[msgs.length - 1].id)
  tickDue()
}

function setGate(text: string, actions: HTMLElement[] = []): void {
  chatAllowed = false
  $('#chat-gate').hidden = false
  $('#composer').hidden = true
  $('#chat-access').textContent = text
  $('#chat-gate-actions').replaceChildren(...actions)
  $<HTMLTextAreaElement>('#chat-message').disabled = true
  $<HTMLButtonElement>('#send-chat').disabled = true
}

async function openRoom(id: string): Promise<void> {
  chatRoom = id
  $<HTMLInputElement>('#chat-circle-id').value = id
  $('#room-title').textContent = roomName(id)
  $('#room-avatar').textContent = roomInitials(roomName(id))
  const members = demo?.circle?.circle_id === id ? demo.circle.member_count : null
  $('#room-sub').textContent = `Circle room${members !== null ? ` · ${members} members` : ''} · members only`
  await checkChatAccess(true)
  renderRooms()
}

async function checkChatAccess(quiet = false): Promise<void> {
  if (!accountId) { setGate('Connect your wallet to open the chat.', connectButtons()); renderMessages(); return }
  const access = await readClient.checkAccess(chatRoom, accountId)
  if (!access.allowed) {
    setGate(access.reason === 'NoPassport' ? 'Only members can read this room. Join the circle with an invite first.' : `Your card in this circle is ${access.reason}, so the room is locked.`,
      [button('Go to my steps', async () => goView('home'), 'soft')])
    renderMessages()
    return
  }
  const chat = chatClient()
  if (!chat) {
    setGate('You are a member. Sign in once (a free signature) so the chat knows it is really you.', [button('Sign in to chat', async () => { await signIn(); await checkChatAccess(true) })])
    renderMessages()
    return
  }
  try {
    const msgs = await chat.list(chatRoom)
    chatMessages.set(chatRoom, msgs)
    await loadRequests(chat, chatRoom)
    chatAllowed = true
    $('#chat-gate').hidden = true
    $('#composer').hidden = false
    $<HTMLTextAreaElement>('#chat-message').disabled = false
    $<HTMLButtonElement>('#send-chat').disabled = false
    renderMessages()
    if (!quiet) show('Chat is open.', 'ok')
  } catch (error) {
    if (error instanceof ChatApiError && error.status === 401) {
      try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
      setGate('Your sign-in expired. Sign in again to keep chatting.', [button('Sign in to chat', async () => { await signIn(); await checkChatAccess(true) })])
    } else {
      setGate(errorText(error), [button('Try again', () => checkChatAccess(false), 'soft')])
    }
    renderMessages()
  }
}

async function loadRequests(chat: ChatClient, room: string): Promise<void> {
  try { chatRequests.set(room, await chat.requests(room)) } catch { /* the chat gate already says when the server is offline */ }
}

async function pollChat(): Promise<void> {
  const chat = chatClient()
  if (!chat || !accountId) return
  if (chatAllowed) {
    const before = JSON.stringify(chatRequests.get(chatRoom) ?? [])
    await loadRequests(chat, chatRoom)
    if (view === 'chat' && JSON.stringify(chatRequests.get(chatRoom) ?? []) !== before) renderMessages()
  }
  const ids = new Set<string>([...(me?.circles ?? []).map((c) => c.id)])
  for (const id of ids) {
    if (id === chatRoom && !chatAllowed) continue
    const have = chatMessages.get(id) ?? []
    const after = have.length ? have[have.length - 1].id : 0
    try {
      const fresh = await chat.list(id, after)
      if (fresh.length) {
        chatMessages.set(id, [...have, ...fresh])
        if (id === chatRoom && view === 'chat') renderMessages()
      }
    } catch { /* room not readable right now */ }
  }
  renderRooms()
}

/** One timer at a time: every 3 s while the chat is open, every 15 s in the background (for the badge). */
function setChatTimer(ms: number | null): void {
  window.clearInterval(chatTimer)
  chatTimer = ms === null ? 0 : window.setInterval(() => void pollChat(), ms)
}
function startChatPolling(): void { setChatTimer(3000) }
function stopChatPolling(): void { setChatTimer(accountId && session() ? 15000 : null) }

function updateChatBadge(): void {
  let unread = 0
  for (const [id, msgs] of chatMessages) {
    if (view === 'chat' && id === chatRoom) continue
    unread += msgs.filter((m) => m.id > (chatSeen.get(id) ?? 0) && m.account_id !== accountId).length
  }
  const badge = $('#nav-chat-badge')
  badge.hidden = unread === 0
  badge.textContent = String(unread)
}

async function sendChat(): Promise<void> {
  const chat = chatClient()
  if (!chat || !chatAllowed) throw new Error('Open the chat first.')
  const box = $<HTMLTextAreaElement>('#chat-message')
  const text = box.value.trim()
  if (!text) return
  const message = await chat.send(chatRoom, text)
  box.value = ''
  box.style.height = ''
  const have = chatMessages.get(chatRoom) ?? []
  if (!have.some((m) => m.id === message.id)) chatMessages.set(chatRoom, [...have, message])
  renderMessages()
  renderRooms()
}

/* ---------- loan requests in the chat (LoanBook-style) ---------- */

/** The on-chain loan behind a linked request card, from data already loaded. */
function chainLoanFor(card: LoanRequestCard): LoanView | null {
  if (!card.loan_id) return null
  return [...(me?.loans ?? []), ...(me?.lent ?? []), ...(demo?.loans ?? [])].find((l) => l.loan_id === card.loan_id) ?? null
}

/** Where a request stands, in plain words. */
function requestStatus(card: LoanRequestCard, loan: LoanView | null): { label: string; cls: string } {
  if (card.cancelled) return { label: 'Cancelled', cls: 'Cancelled' }
  if (!card.loan_id) return { label: card.offers.length ? `${card.offers.length} offer${card.offers.length > 1 ? 's' : ''}` : 'Waiting for offers', cls: 'Open' }
  if (!loan) return { label: `Loan #${card.loan_id}`, cls: 'Open' }
  if (loan.state === 'Open') return isWaiting(loan, Date.now()) ? { label: 'Waiting for funding', cls: 'Open' } : { label: 'Expired', cls: 'Cancelled' }
  if (loan.state === 'Repaid') return loan.repaid_on_time ? { label: 'Repaid on time', cls: 'Repaid' } : { label: 'Repaid late', cls: 'Repaid' }
  if (loan.state === 'Funded' && loan.overdue) return { label: 'Overdue', cls: 'Cancelled' }
  return { label: loan.state, cls: loan.state }
}

async function requestAction(card: LoanRequestCard, verb: 'offer' | 'cancel'): Promise<void> {
  const chat = chatClient()
  if (!chat) throw new Error('Sign in first (Home, step 3).')
  await chat.requestAction(card.circle_id, card.id, verb)
  await loadRequests(chat, card.circle_id)
  renderMessages()
  renderOpenRequests()
}

/** The borrower picks a lender who offered: create_loan naming them (wallet), then link it to the card. */
async function chooseLender(card: LoanRequestCard, lenderId: string): Promise<void> {
  requireWallet()
  const chat = chatClient()
  if (!chat) throw new Error('Sign in first (Home, step 3).')
  const storage = await readClient.storageCosts()
  const raw = await client().createLoan({ circleId: card.circle_id, lenderId, amount: card.amount, durationDays: card.days, deposit: storage.create_loan })
  const loanId = await newLoanId(raw, lenderId, card.amount)
  if (!loanId) throw new Error('The loan was sent, but its number could not be read yet. Press refresh in a few seconds.')
  await chat.requestAction(card.circle_id, card.id, 'link', loanId)
  await loadRequests(chat, card.circle_id)
  await afterTx(`Loan #${loanId} created. ${memberLabel(lenderId)} can now fund it.`)
  renderMessages()
}

function requestCard(card: LoanRequestCard): HTMLElement {
  const loan = chainLoanFor(card)
  const mine = card.borrower === accountId
  const status = requestStatus(card, loan)
  const length = loanLengthText(card.days, demo?.circle?.params.day_length_sec ?? '86400')
  const head = el('div', { className: 'req-head' }, avatar(card.borrower, 'sm'),
    el('span', { className: 'req-who' }, accountChip(card.borrower), card.direct ? ' made a direct loan request' : ' asks the circle for a loan'),
    el('span', { className: `state state-${status.cls}`, textContent: status.label }))
  const body = el('div', { className: 'req-body' },
    el('p', { className: 'req-amount' }, el('strong', { textContent: `${formatUsdc(card.amount)} USDC` }), ` · ${length} · no interest`),
    el('blockquote', { className: 'req-note', textContent: card.note }))
  const actions: HTMLElement[] = []
  const info: Array<Node | string> = []
  if (!card.cancelled && !card.loan_id) {
    if (card.offers.length) info.push('Offers from ', ...card.offers.flatMap((o, i) => (i ? [', ', accountChip(o)] : [accountChip(o)])), '.')
    else info.push('No offers yet.')
    if (mine) {
      for (const o of card.offers) actions.push(button(`Borrow from ${memberLabel(o)}`, () => chooseLender(card, o)))
      actions.push(button('Cancel request', () => requestAction(card, 'cancel'), 'ghost'))
    } else if (accountId) {
      actions.push(button(card.offers.includes(accountId) ? 'Withdraw my offer' : 'Offer to lend', () => requestAction(card, 'offer'), card.offers.includes(accountId) ? 'ghost' : 'accent'))
    }
  } else if (card.loan_id && loan) {
    const lender = loan.lender_id === accountId ? 'you' : memberLabel(loan.lender_id)
    if (isWaiting(loan, Date.now())) {
      info.push(`Loan #${loan.loan_id} names ${lender} as lender. `, windowSpan(loan))
      if (loan.lender_id === accountId) actions.push(button(`Fund ${formatUsdc(loan.principal)} USDC`, () => fund(loan)))
      if (canCancel(loan, accountId, Date.now())) actions.push(button('Cancel request', () => cancelRequest(loan), 'ghost'))
    } else if (loan.state === 'Funded' || loan.state === 'Repaying') {
      info.push(`Loan #${loan.loan_id}: ${lender} sent the money. `, dueSpan(loan))
      if (mine && loan.state === 'Funded') actions.push(button(`Repay ${formatUsdc(loan.outstanding)} USDC`, () => repay(loan)))
    } else {
      info.push(`Loan #${loan.loan_id} with ${lender}.`)
    }
  }
  return el('article', { className: `req-card${mine ? ' mine' : ''}`, ariaLabel: 'Loan request' }, head, body,
    info.length ? el('p', { className: 'req-info' }, ...info) : '',
    actions.length ? el('div', { className: 'req-actions' }, ...actions) : '')
}

/** The "ask the circle" panel above the composer. Limits and validation come from borrowLimit(). */
function askLimit() {
  return demo?.circle ? borrowLimit(demo.circle.params, me?.passport ?? null, demo.config.hard_loan_cap) : null
}

function checkAsk() {
  const limit = askLimit()
  if (!limit || !demo?.circle) return null
  const v = validateLoanInput($<HTMLInputElement>('#ask-amount').value, $<HTMLInputElement>('#ask-days').value, limit, formatUsdc)
  $('#ask-amount-hint').textContent = v.errors.amount ?? `Your limit as a ${limit.tier}: ${formatUsdc(limit.min)} to ${formatUsdc(limit.max)} USDC.`
  $('#ask-amount-hint').classList.toggle('bad', !!v.errors.amount)
  $('#ask-days-hint').textContent = v.errors.days ?? `${loanLengthText(v.days!, demo.circle.params.day_length_sec)} to repay after funding.`
  $('#ask-days-hint').classList.toggle('bad', !!v.errors.days)
  return v
}

async function postAsk(): Promise<void> {
  const chat = chatClient()
  if (!chat || !chatAllowed) throw new Error('Open the chat and sign in first.')
  const v = checkAsk()
  if (!v?.amount || !v.days) throw new Error('Fix the highlighted fields first.')
  const note = $<HTMLTextAreaElement>('#ask-note').value.trim()
  if (!note) throw new Error('Say in a few words what the loan is for.')
  await chat.ask(chatRoom, { amount: v.amount, days: v.days, note })
  $<HTMLTextAreaElement>('#ask-note').value = ''
  $('#ask-panel').hidden = true
  await loadRequests(chat, chatRoom)
  renderMessages()
  renderOpenRequests()
  show('Your request is in the chat. Members can now offer to lend.', 'ok')
}

/** Home: every open request in this circle, for every member (cards from the chat server, plus on-chain loans waiting for funding). */
function renderOpenRequests(): void {
  const now = Date.now()
  const cards = (chatRequests.get(circleId) ?? []).filter((c) => !c.cancelled && (!c.loan_id || (() => { const l = chainLoanFor(c); return !l || isWaiting(l, now) })()))
  const linked = new Set(cards.map((c) => c.loan_id).filter(Boolean))
  const chainOnly = (demo?.loans ?? []).filter((l) => isWaiting(l, now) && !linked.has(l.loan_id) && !(chatRequests.get(circleId) ?? []).some((c) => c.loan_id === l.loan_id))
  const items: HTMLLIElement[] = [
    ...cards.map((c) => el('li', {}, el('span', {}, accountChip(c.borrower), ` asks for ${formatUsdc(c.amount)} USDC: `, el('em', { textContent: `"${c.note}"` }), ' ',
      el('span', { className: 'muted small', textContent: c.loan_id ? `· loan #${c.loan_id}` : `· ${c.offers.length} offer${c.offers.length === 1 ? '' : 's'}` })))),
    ...chainOnly.map((l) => el('li', {}, el('span', {}, accountChip(l.borrower_id), ` asks `, l.lender_is_treasury ? 'the treasury' : accountChip(l.lender_id), ` for ${formatUsdc(l.principal)} USDC. `, windowSpan(l)))),
  ]
  $('#open-requests').hidden = !items.length
  $('#open-requests-list').replaceChildren(...items)
}

/** Members: the invite box, for Trusted members only (the contract's rule after attach_dao). */
function renderInvite(): void {
  const p = me?.passport
  const can = !!p && p.status === 'Active' && p.effective_tier === 'Trusted'
  $('#invite-form').hidden = !can
  $('#invite-eligibility').textContent = !accountId ? 'Connect your wallet to invite a friend.'
    : can ? 'Put in your friend\'s testnet account, make the link, copy it and send it privately. They open it, or paste it on Home.'
      : 'Only Trusted members can invite in this circle. Repay one loan on time and your card turns Trusted.'
}

/* ---------- reading state ---------- */

async function refreshMe(): Promise<void> {
  if (!accountId) { me = null; renderAll(); return }
  try {
    const usdc = new CircleClient(config.rpcUrl, await getUsdcId())
    const [passport, registration, loans, lent, tokens] = await Promise.all([
      readClient.passportFor(circleId, accountId),
      usdc.view<unknown>('storage_balance_of', { account_id: accountId }),
      readClient.loansByBorrower(accountId),
      readClient.loansByLender(accountId),
      readClient.nftTokensForOwner(accountId, null, 50).catch(() => []),
    ])
    const ids = [...new Set(tokens.map((t) => t.token_id.split(':')[0]))]
    const circles = await Promise.all(ids.map(async (id) => ({ id, name: (await readClient.getCircle(id).catch(() => null))?.name ?? `Circle ${id}` })))
    me = {
      passport, registered: !!registration, signedIn: session()?.accountId === accountId, circles,
      loans: loans.filter((l) => l.circle_id === circleId),
      lent: lent.filter((l) => l.circle_id === circleId),
    }
  } catch (error) {
    show(`Could not read your account. ${errorText(error)}`, 'bad', 'retry', refreshMe)
  }
  const chatForHome = chatClient()
  if (chatForHome && me?.passport) await loadRequests(chatForHome, circleId)
  renderAll()
  await Promise.all([
    loadMyCard().catch(() => {}),
    loadPositions().catch(() => {}),
    renderTreasury().catch(() => {}),
    view === 'chat' ? checkChatAccess(true).catch(() => {}) : Promise.resolve(),
  ])
  if (view !== 'chat') stopChatPolling()
}

async function refreshAll(): Promise<void> {
  await loadDemo()
  await refreshMe()
}

/* ---------- rendering ---------- */

function renderAll(): void {
  renderForYou()
  renderOpenRequests()
  renderInvite()
  renderJourney()
  renderMembers()
  renderSidebar()
  renderRooms()
}

function renderSidebar(): void {
  const ids = new Map<string, string>([[circleId, demo?.circle?.name ?? `Circle ${circleId}`]])
  for (const c of me?.circles ?? []) ids.set(c.id, c.name)
  $('#side-circles').replaceChildren(...[...ids].map(([id, name]) => {
    const item = el('button', { className: `circle-item${id === circleId ? ' active' : ''}`, type: 'button', title: name },
      el('span', { className: 'avatar avatar-sm avatar-room', textContent: roomInitials(name) }),
      el('span', { className: 'grow', textContent: name }))
    item.addEventListener('click', () => void run(null, async () => {
      $<HTMLInputElement>('#demo-circle-id').value = id
      await refreshAll()
      goView('home')
    }))
    return item
  }))
  const tier = me?.passport ? `${me.passport.display_tier} · ${demo?.circle?.name ?? `circle ${circleId}`}` : accountId ? 'Not a member of this circle yet' : ''
  $('#profile-tier').textContent = tier
  $('#crumb-circle').textContent = demo?.circle?.name ?? `Circle ${circleId}`
  const funded = me?.loans.find((l) => l.state === 'Funded')
  $('#nav-loans-badge').hidden = !funded
  $('#nav-loans-badge').textContent = funded ? '1' : ''
}

type StepState = 'done' | 'current' | 'waiting'
/**
 * A checklist step. Only the current step shows its actions (one primary button);
 * a done step collapses to a check and a one-line summary, with at most small
 * ghost buttons (`doneActions`, e.g. Switch / Disconnect).
 */
function step(n: number, state: StepState, title: string, desc: string | Node, actions: HTMLElement[] = [], form?: HTMLElement, doneActions: HTMLElement[] = []): HTMLLIElement {
  const li = el('li', { className: `step ${state}` })
  const shown = state === 'current' ? actions : state === 'done' ? doneActions : []
  li.append(
    el('span', { className: 'step-dot', textContent: state === 'done' ? '✓' : String(n), ariaHidden: 'true' }),
    el('div', { className: 'step-text' }, el('p', { className: 'step-title', textContent: state === 'done' ? `${title} · done` : title }), el('p', { className: 'step-desc' }, desc)),
    el('div', { className: 'step-action' }, ...shown),
  )
  if (form && state === 'current') li.append(form)
  return li
}

const dueSpan = (loan: LoanView): HTMLElement => untilSpan(loan.due_at, 'Due in ', 'Past due: repay now (it will count as late)')
const windowSpan = (loan: LoanView): HTMLElement => untilSpan(loan.funding_deadline, 'Expires in ', 'Expired')

/** P0-2 a: "Requests for you" for the connected lender, built from loans_by_lender. */
function renderForYou(): void {
  const requests = accountId && me ? requestsForLender(me.lent, accountId, Date.now()) : []
  $('#for-you').hidden = !requests.length
  $('#for-you-list').replaceChildren(...requests.map((loan) => el('li', {},
    el('span', {}, accountChip(loan.borrower_id), ` asks you for ${formatUsdc(loan.principal)} USDC for ${loanLengthText(loan.duration_days, demo?.circle?.params.day_length_sec ?? '86400')}. `, windowSpan(loan)),
    button(`Fund ${formatUsdc(loan.principal)} USDC`, () => fund(loan)))))
  tickDue()
}

/** P0-2 d: on-time / late counters and, from the circle's trusted_threshold, progress toward Trusted. */
function progressNode(passport: PassportView): HTMLElement | null {
  const params = demo?.circle?.params
  if (!params) return null
  const p = trustedProgress(passport, params)
  const counters = `On time ${p.onTime} · late ${p.late}`
  if (p.trusted) return el('span', { className: 'progress' }, el('span', { className: 'small muted', textContent: `${counters} · Trusted` }))
  const pct = Math.min(100, Math.round((p.qualifying / Math.max(1, p.threshold)) * 100))
  const bar = el('span', { className: 'progress-bar', role: 'progressbar', ariaValueMin: '0', ariaValueMax: String(p.threshold), ariaValueNow: String(p.qualifying) }, el('span'))
  ;(bar.firstChild as HTMLElement).style.width = `${pct}%`
  const lenders = p.minLenders > 1 ? `, from ${p.minLenders} different lenders (${p.lenders} so far)` : ''
  return el('span', { className: 'progress' },
    el('span', { className: 'small muted', textContent: `${counters} · ${p.qualifying} of ${p.threshold} on-time repayments toward Trusted${lenders}` }), bar)
}

let formSeq = 0

/**
 * P0-3: the one loan form (Home step 5 and Loans). Lender = a member picker
 * (label, badge, on-time/late) plus "Ask the treasury" when the spec allows it;
 * limits come from borrowLimit() only; amount and days are validated inline.
 */
function loanRequestForm(): HTMLElement {
  const id = `lf${++formSeq}`
  const circle = demo?.circle
  const passport = me?.passport ?? null
  if (!circle || !demo) return el('p', { className: 'muted', textContent: 'Loading the circle…' })
  if (!accountId) return el('p', { className: 'muted', textContent: 'Connect your wallet first (step 1).' })
  if (!passport || passport.status !== 'Active') return el('p', { className: 'muted', textContent: 'Join the circle first (step 2).' })
  const limit = borrowLimit(circle.params, passport, demo.config.hard_loan_cap)
  const lenders = demo.passports.filter((p) => p.owner_id !== accountId && p.status === 'Active')
  // Treasury loans: DAO attached and verified, at least 2 stewards, borrower effective Trusted and not a steward (interface section 4).
  const treasuryOk = !!circle.treasury_id && circle.treasury_lending_enabled && !!demo.dao?.verified && passport.effective_tier === 'Trusted' && !passport.steward

  const picker = el('div', { className: 'picker', role: 'radiogroup', ariaLabel: 'Who to ask' })
  const option = (value: string, main: Node[], sub: string, checked: boolean) => {
    const input = el('input', { type: 'radio', name: `${id}-lender`, value, checked })
    return el('label', { className: 'pick' }, input, el('span', { className: 'pick-main' }, ...main), el('span', { className: 'pick-sub', textContent: sub }))
  }
  const preferred = lenders.find((p) => p.owner_id === circle.founder_id)?.owner_id ?? lenders[0]?.owner_id
  for (const p of lenders) {
    picker.append(option(p.owner_id, [avatar(p.owner_id, 'sm'), el('span', { className: 'pick-name', title: p.owner_id, textContent: memberLabel(p.owner_id) }), badge(p.display_tier)],
      `On time ${p.on_time_count} · late ${p.late_count}`, p.owner_id === preferred))
  }
  if (treasuryOk) picker.append(option(circle.treasury_id!, [el('span', { className: 'avatar avatar-sm avatar-room', textContent: 'DAO' }), el('span', { className: 'pick-name', textContent: 'Ask the treasury (DAO)' })], 'Both stewards vote', !preferred))
  if (!picker.children.length) return el('p', { className: 'muted', textContent: 'There is nobody else in this circle to ask yet.' })

  const amount = el('input', { id: `${id}-amount`, inputMode: 'decimal', value: formatUsdc(limit.min) })
  const days = el('input', { id: `${id}-days`, inputMode: 'numeric', value: String(Math.min(7, limit.maxDays)) })
  amount.setAttribute('aria-describedby', `${id}-amount-hint`)
  days.setAttribute('aria-describedby', `${id}-days-hint`)
  const amountHint = el('p', { id: `${id}-amount-hint`, className: 'hint' })
  const daysHint = el('p', { id: `${id}-days-hint`, className: 'hint' })
  const note = el('textarea', { id: `${id}-note`, rows: 2, maxLength: 500, placeholder: 'For example: school fees, stock for my shop' })
  const noteHint = el('p', { className: 'hint', textContent: session()?.accountId === accountId ? 'Members of the circle see this. It is stored on the chat server, not on-chain.' : 'Sign in (step 3) to attach a reason that members can see.' })
  const send = el('button', { className: 'btn btn-accent', type: 'button', textContent: 'Send request' })
  const check = () => {
    const v = validateLoanInput(amount.value, days.value, limit, formatUsdc)
    amountHint.textContent = v.errors.amount ?? `Your limit as a ${limit.tier}: ${formatUsdc(limit.min)} to ${formatUsdc(limit.max)} USDC.`
    amountHint.classList.toggle('bad', !!v.errors.amount)
    amount.ariaInvalid = v.errors.amount ? 'true' : 'false'
    daysHint.textContent = v.errors.days ?? `${loanLengthText(v.days!, circle.params.day_length_sec)} to repay after funding.`
    daysHint.classList.toggle('bad', !!v.errors.days)
    days.ariaInvalid = v.errors.days ? 'true' : 'false'
    send.disabled = !v.amount || !v.days
    return v
  }
  amount.addEventListener('input', check)
  days.addEventListener('input', check)
  send.addEventListener('click', () => void run(send, async () => {
    const v = check()
    const lender = picker.querySelector<HTMLInputElement>('input:checked')?.value ?? ''
    if (!v.amount || !v.days) throw new Error('Fix the highlighted fields first.')
    await requestLoan(lender, v.amount, v.days, note.value)
  }))
  check()
  return el('div', { className: 'loan-form' },
    el('p', { className: 'field-label', textContent: 'Who to ask' }), picker,
    el('div', { className: 'field-row' },
      el('div', {}, el('label', { htmlFor: amount.id, textContent: 'Amount (USDC)' }), amount, amountHint),
      el('div', {}, el('label', { htmlFor: days.id, textContent: 'Days' }), days, daysHint)),
    el('label', { htmlFor: note.id, textContent: 'What is the loan for?' }), note, noteHint,
    send)
}

/** Paste an invite link instead of opening it from the address bar. */
function pasteInviteBox(): HTMLElement {
  const input = el('input', { className: 'paste-input', placeholder: 'Paste your invite link here', autocomplete: 'off', ariaLabel: 'Invite link' })
  const use = button('Use this link', async () => {
    const text = input.value.trim()
    let invite: ReturnType<typeof parseInviteLink>
    try { invite = parseInviteLink(text) } catch { throw new Error('That is not an invite link. Copy the whole link, starting with http.') }
    if (!invite.inviteSecret || !invite.invitePublicKey || !invite.circleId) throw new Error('That link is missing its invite part. Copy the whole link.')
    rememberInvite(invite)
    hydrateInviteFields()
    if (invite.circleId !== (demo?.circleId ?? circleId)) await refreshAll()
    renderJourney()
    show('Invite found. Press "Join the circle".', 'ok')
  })
  return el('div', { className: 'paste-box' }, input, use)
}

function renderJourney(): void {
  const circleName = demo?.circle?.name ?? `circle ${circleId}`
  const invite = inviteFields()
  const passport = me?.passport ?? null
  const isMember = !!passport && passport.status === 'Active'
  const loans = (me?.loans ?? []).slice().sort((a, b) => Number(b.loan_id) - Number(a.loan_id))
  const funded = loans.find((l) => l.state === 'Funded' || l.state === 'Repaying' || l.state === 'Funding')
  const open = loans.find((l) => isWaiting(l, Date.now()))
  const repaid = loans.find((l) => l.state === 'Repaid')
  const done = [!!accountId, isMember, !!me?.signedIn, !!me?.registered, !!(funded || repaid), !!repaid && !funded]
  const current = done.findIndex((d) => !d)
  const stateOf = (i: number): StepState => (done[i] ? 'done' : i === current ? 'current' : 'waiting')
  const steps: HTMLLIElement[] = []

  steps.push(step(1, stateOf(0), 'Connect your wallet',
    accountId ? el('span', {}, 'Connected as ', accountChip(accountId), '.') : 'Use a NEAR testnet wallet. Meteor is recommended. Allow pop-ups when asked.',
    connectButtons(), undefined,
    [button('Switch', switchWallet, 'ghost', 'wallet'), button('Disconnect', disconnectWallet, 'ghost')]))
  steps.push(step(2, stateOf(1), `Join ${circleName}`,
    isMember ? `You are a ${passport!.display_tier} of ${circleName}.`
      : passport ? `Your card is ${passport.status}. Ask the stewards for help.`
        : invite.inviteSecret ? 'You have an invite. Joining costs about 0.009 NEAR, which pays for storing your card.'
          : 'You need an invite link from a Trusted member of this circle. Open it in this browser.',
    invite.inviteSecret && !passport ? [button('Join the circle', joinInvite)] : !passport ? [pasteInviteBox()] : []))
  steps.push(step(3, stateOf(2), 'Sign in',
    me?.signedIn ? 'Signed in for this browser session. The chat is open to you.' : 'A free signature that proves the account is yours. It also opens the circle chat.',
    [button('Sign in', signIn)]))
  steps.push(step(4, stateOf(3), 'Get ready to receive USDC',
    me?.registered ? 'Your account can receive USDC.' : 'A one-time setup so a lender can send you money. Costs 0.00125 NEAR.',
    [button('Set up USDC', registerForUsdc)]))
  const trustedHint = passport?.effective_tier === 'Trusted' && !passport.steward ? ' As a Trusted member you can also ask the treasury.' : ''
  const got = funded ?? repaid
  const lenderName = (l: LoanView) => (l.lender_is_treasury ? 'the treasury' : memberLabel(l.lender_id))
  steps.push(step(5, stateOf(4), 'Ask a member for a loan',
    got ? `Loan #${got.loan_id}: ${formatUsdc(got.principal)} USDC from ${lenderName(got)}.`
      : open ? el('span', {}, `Request #${open.loan_id} for ${formatUsdc(open.principal)} USDC is waiting for `, open.lender_is_treasury ? 'the stewards' : accountChip(open.lender_id), ' to fund it. ', windowSpan(open))
        : `Choose who to ask, how much, and for how long.${trustedHint}`,
    open ? [button('Cancel request', () => cancelRequest(open), 'ghost')] : [], open ? undefined : loanRequestForm()))
  let repayDesc: string | Node = 'Once your loan arrives, pay it back before the due time to earn your next on-time mark.'
  const repayActions: HTMLElement[] = []
  if (funded) {
    repayDesc = el('span', {}, `You owe ${formatUsdc(funded.outstanding)} USDC to ${lenderName(funded)}. `, dueSpan(funded))
    if (funded.state === 'Funded') repayActions.push(button(`Repay ${formatUsdc(funded.outstanding)} USDC`, () => repay(funded)))
  } else if (repaid) {
    const late = repaid.repaid_on_time === false && !repaid.flag_cleared
    const progress = passport ? progressNode(passport) : null
    repayDesc = el('span', {}, late ? 'Repaid, but late. You can ask the stewards to forgive the late mark.'
      : `Repaid on time. Your card is ${passport?.effective_tier ?? 'updated'}${passport?.effective_tier === 'Trusted' ? '. Well done!' : '.'}`, ...(progress ? [progress] : []))
    if (late) repayActions.push(button('Ask stewards to forgive', () => askToForgive(repaid), 'soft'))
  }
  steps.push(step(6, funded ? 'current' : stateOf(5), 'Pay it back on time', repayDesc, repayActions, undefined, repayActions))
  // Two or more finished steps at the top fold into one line, so the next step stays in view.
  const leadingDone = steps.findIndex((li) => !li.classList.contains('done'))
  const folded = leadingDone === -1 ? steps.length : leadingDone
  if (folded >= 2 && current !== -1) {
    const summaries = ['Wallet connected', isMember ? `joined as ${passport!.display_tier}` : 'joined', 'signed in', 'ready for USDC', 'loan received'].slice(0, folded)
    const group = el('li', { className: 'step done group' },
      el('span', { className: 'step-dot', textContent: '✓', ariaHidden: 'true' }),
      el('div', { className: 'step-text' }, el('p', { className: 'step-title', textContent: `Steps 1–${folded} done` }),
        el('p', { className: 'step-desc' }, `${summaries.join(' · ')}. `, accountChip(accountId))),
      el('div', { className: 'step-action' }, button('Switch', switchWallet, 'ghost', 'wallet')))
    steps.splice(0, folded, group)
  }
  $('#steps').replaceChildren(...steps)
  $('#home-hero').classList.toggle('compact', isMember)
  $('#journey-sub').textContent = current === -1 ? 'All done: you joined, borrowed and repaid. Your card is on the right.' : 'Follow these in order. Each one updates from the blockchain by itself.'
  tickDue()
}

function renderMembers(): void {
  const grid = $('#demo-cards')
  grid.replaceChildren()
  for (const card of demo?.cards ?? []) {
    const fig = el('figure', { className: `member${card.passport.owner_id === accountId ? ' me' : ''}` })
    if (card.svg) fig.append(el('img', { alt: `${card.passport.owner_id} passport card`, src: URL.createObjectURL(new Blob([card.svg], { type: 'image/svg+xml' })) }))
    fig.append(el('figcaption', {},
      el('span', { className: 'who' }, avatar(card.passport.owner_id, 'sm'), accountChip(card.passport.owner_id)), badge(card.passport.display_tier)),
      el('p', { className: 'member-counts', textContent: `On time ${card.passport.on_time_count} · late ${card.passport.late_count}` }))
    grid.append(fig)
  }
  if (!grid.children.length) grid.append(el('p', { className: 'muted', textContent: 'No members yet.' }))
  $('#loan-form-slot').replaceChildren(loanRequestForm())
}

function renderLoansTable(): void {
  const loans = (demo?.loans ?? []).slice().sort((a, b) => Number(b.loan_id) - Number(a.loan_id))
  $('#circle-loans').replaceChildren(...(loans.length ? loans.map((l) => el('tr', {},
    el('td', { textContent: l.loan_id }),
    el('td', {}, who(l.borrower_id, l.borrower_id === accountId ? 'You' : memberLabel(l.borrower_id))),
    el('td', {}, l.lender_is_treasury ? who(l.lender_id, 'Treasury (DAO)') : who(l.lender_id, l.lender_id === accountId ? 'You' : memberLabel(l.lender_id))),
    el('td', { textContent: `${formatUsdc(l.principal)} USDC` }),
    el('td', { className: 'reason', textContent: (chatRequests.get(l.circle_id) ?? []).find((c) => c.loan_id === l.loan_id)?.note ?? '' }),
    el('td', {}, el('span', { className: `state state-${l.state}`, textContent: l.state === 'Repaid' && l.repaid_on_time === false ? (l.flag_cleared ? 'Repaid (late, forgiven)' : 'Repaid late') : l.state })),
  )) : [el('tr', {}, el('td', { colSpan: 6, className: 'muted', textContent: 'No loans yet.' }))]))
}

function tickDue(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-until]')) {
    const left = countdown(node.dataset.until || null, Date.now())
    node.textContent = left ? `${node.dataset.prefix ?? ''}${left}` : (node.dataset.after ?? '')
  }
}

async function loadMyCard(): Promise<void> {
  const image = $<HTMLImageElement>('#my-card-image')
  if (!accountId || !me?.passport) {
    image.hidden = true
    $('#load-my-card').hidden = true
    $('#my-card-title').textContent = accountId ? 'No card in this circle yet. Join with an invite (step 2).' : 'Connect a wallet and join to see your card.'
    return
  }
  const passport = me.passport
  const [svg, token] = await Promise.all([readClient.cardSvg(passport.token_id), readClient.nftToken(passport.token_id)])
  if (svg) { image.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); image.hidden = false }
  $('#load-my-card').hidden = false
  $('#my-card-title').textContent = `${token?.metadata?.title ?? passportTokenTitle(demo?.circle?.name ?? '')} · ${passport.display_tier} · on time ${passport.on_time_count}, late ${passport.late_count}`
}

async function loadPositions(): Promise<void> {
  const list = $('#positions')
  if (!accountId) { list.replaceChildren(el('li', { className: 'empty', textContent: 'Connect a wallet to see your loans.' })); return }
  const positions = await readClient.myPositions(accountId)
  const items: HTMLLIElement[] = []
  if (me && !me.registered) items.push(el('li', {}, el('span', { textContent: 'Not set up for USDC yet, so nobody can send you a loan.' }), button('Set up USDC', registerForUsdc)))
  const now = Date.now()
  const stateLabel = (loan: LoanView) => (loan.state === 'Open' && !isWaiting(loan, now) ? 'Expired' : loan.state)
  // Requests for you first (P0-2 a), then your own loans, then what you lent.
  for (const loan of requestsForLender(positions.lent, accountId, now).reverse()) {
    items.push(el('li', { className: 'request' }, el('span', {}, el('strong', { textContent: `Request #${loan.loan_id} for you` }), ' · ', accountChip(loan.borrower_id),
      ` asks for ${formatUsdc(loan.principal)} USDC · `, windowSpan(loan)), button(`Fund ${formatUsdc(loan.principal)} USDC`, () => fund(loan))))
  }
  for (const loan of positions.borrowed.slice().reverse()) {
    const lender = loan.lender_is_treasury ? el('span', { textContent: 'the treasury' }) : accountChip(loan.lender_id)
    const li = el('li', {}, el('span', {}, el('strong', { textContent: `Borrowed #${loan.loan_id}` }), ` · ${formatUsdc(loan.principal)} USDC from `, lender, ' ',
      el('span', { className: `state state-${stateLabel(loan)}`, textContent: stateLabel(loan) }), ' ',
      loan.state === 'Funded' ? dueSpan(loan) : isWaiting(loan, now) ? windowSpan(loan) : ''))
    if (loan.state === 'Funded') li.append(button(`Repay ${formatUsdc(loan.outstanding)} USDC`, () => repay(loan)))
    if (canCancel(loan, accountId, now)) li.append(button('Cancel request', () => cancelRequest(loan), 'ghost'))
    const late = (loan.overdue || (loan.state === 'Repaid' && loan.repaid_on_time === false)) && !loan.flag_cleared
    if (late) li.append(button('Ask stewards to forgive', () => askToForgive(loan), 'soft'))
    const note = repaymentNotice(null, loan)
    if (note) li.append(el('p', { className: 'notice', textContent: note }))
    items.push(li)
  }
  for (const loan of positions.lent.filter((l) => !isWaiting(l, now)).reverse()) {
    items.push(el('li', {}, el('span', {}, el('strong', { textContent: `Lent #${loan.loan_id}` }), ` · ${formatUsdc(loan.principal)} USDC to `, accountChip(loan.borrower_id), ' ',
      el('span', { className: `state state-${stateLabel(loan)}`, textContent: stateLabel(loan) }))))
  }
  if (!items.length) items.push(el('li', { className: 'empty', textContent: 'No loans yet. Ask a member on the right, or follow step 5 on Home.' }))
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
  const [policy, proposals, balance] = await Promise.all([dao.getPolicy(), dao.recentProposals(10), usdc.view<string>('ft_balance_of', { account_id: daoId })])
  const stewards = stewardsOf(policy)
  const bondNear = (Number(BigInt(policy.proposal_bond) / 10n ** 18n) / 1e6).toString()
  $('#stat-treasury').textContent = `${formatUsdc(balance)} USDC`
  $('#treasury-summary').replaceChildren(
    el('span', { className: 'muted small', textContent: 'Holds' }), el('b', { textContent: `${formatUsdc(balance)} USDC` }),
    el('span', {}, 'Stewards: ', ...stewards.flatMap((s, i) => (i ? [' and ', accountChip(s)] : [accountChip(s)]))),
    el('span', { className: 'muted small', textContent: `Asking costs a ${bondNear} NEAR deposit, returned when the vote passes.` }))
  const isSteward = !!accountId && stewards.includes(accountId)
  const passport = accountId ? await readClient.passportFor(cid, accountId) : null
  const eligible = !!passport && passport.effective_tier === 'Trusted' && !passport.steward && passport.status === 'Active'
  $('#treasury-ask').hidden = !eligible
  $('#treasury-eligibility').textContent = !accountId ? 'Connect a wallet to ask the treasury or, if you are a steward, to vote.'
    : isSteward ? 'You are a steward: approve requests below. Stewards cannot borrow from the treasury.'
      : !passport ? 'Join the circle first (Home, step 2).'
        : !eligible ? `Your card is ${passport.effective_tier}${passport.perks_paused ? ', with perks paused by an overdue loan' : ''}. The treasury lends only to Trusted members: repay a loan on time first.` : ''
  if (eligible) {
    const pending = loansNeedingProposal(await readClient.loansByBorrower(accountId), daoId, accountId, proposals)
    $('#treasury-pending').replaceChildren(...pending.map((loan) => el('li', {},
      el('span', { textContent: `Request #${loan.loan_id} · ${formatUsdc(loan.principal)} USDC · not sent to the stewards yet` }),
      button('2. Send to stewards', async () => {
        await dao.addProposal(treasuryFundProposal({ usdcId: demo!.config.usdc_id, circleContractId: config.contractId, loanId: loan.loan_id, amount: loan.principal, borrowerId: accountId }), policy.proposal_bond)
        await afterTx('Sent to the stewards. The money arrives when both have approved.')
      }))))
  }
  const voting = proposals.filter((p) => p.status === 'InProgress').length
  $('#nav-treasury-badge').hidden = !voting
  $('#nav-treasury-badge').textContent = String(voting)
  $('#treasury-proposals').replaceChildren(...(proposals.length ? proposals.map((p: SputnikProposal) => {
    const target = proposalLoanId(p)
    const approvals = Object.values(p.votes ?? {}).filter((v) => v === 'Approve').length
    const canVote = isSteward && p.status === 'InProgress' && !(accountId in (p.votes ?? {}))
    const what = target ? (target.action === 'fund' ? `Pay loan #${target.loanId}` : `Forgive the late mark on loan #${target.loanId}`) : p.description
    const label = p.status === 'InProgress' ? 'Voting' : p.status === 'Approved' ? 'Approved' : 'Other'
    const li = el('li', {}, avatar(p.proposer, 'sm'), el('span', {},
      el('strong', { textContent: `#${p.id} ${what}` }), el('br'),
      el('span', { className: 'muted small', textContent: `Asked by ${memberLabel(p.proposer)} · ${approvals} of ${stewards.length} approvals` })),
      el('span', { className: `state state-${label}`, textContent: label === 'Other' ? p.status : label }))
    if (canVote) li.append(button('Approve', async () => { await dao.approve(p); await afterTx(`You approved proposal #${p.id}.`) }))
    return li
  }) : [el('li', { className: 'empty', textContent: 'No votes yet. A Trusted member files the first request.' })]))
}

async function requestFromTreasury(): Promise<void> {
  requireWallet()
  if (!demo?.circle?.treasury_id || !demo.dao?.verified) throw new Error('This circle has no verified DAO treasury.')
  // Same limits as the loan form: one source (borrowLimit).
  const limit = borrowLimit(demo.circle.params, me?.passport ?? null, demo.config.hard_loan_cap)
  const v = validateLoanInput($<HTMLInputElement>('#treasury-amount').value, $<HTMLInputElement>('#treasury-days').value || String(DEMO_TREASURY_LOAN_DAYS), limit, formatUsdc)
  if (!v.amount || !v.days) throw new Error(v.errors.amount ?? v.errors.days ?? 'Check the amount and days.')
  const storage = await readClient.storageCosts()
  await client().createLoan({ circleId: demo.circle.circle_id, lenderId: demo.circle.treasury_id, amount: v.amount, durationDays: v.days, deposit: storage.create_loan })
  await afterTx('Request recorded. Now press "2. Send to stewards".')
}

async function loadDemo(): Promise<void> {
  const requested = $<HTMLInputElement>('#demo-circle-id').value.trim() || circleId
  const snapshot = await loadReadOnlyDemo(requested)
  demo = snapshot
  circleId = snapshot.circleId
  if (!usdcId) usdcId = snapshot.config.usdc_id
  $<HTMLInputElement>('#my-card-circle-id').value = circleId
  const lines = [
    `Contract ${snapshot.contractId} · interface ${snapshot.config.interface_version}`,
    `RPC ${snapshot.rpcUrl}`, `USDC ${snapshot.config.usdc_id}`,
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
    dao.textContent = snapshot.dao.verified ? '✓ Run by a real Sputnik DAO with no keys: only votes move its money.' : '⚠ The treasury account failed the DAO safety check. Treasury buttons are hidden.'
    dao.title = `${snapshot.dao.daoId} · code ${snapshot.dao.codeHash ?? 'unknown'} · keys ${snapshot.dao.accessKeyCount ?? 'unknown'}`
    dao.className = `dao-status ${snapshot.dao.verified ? 'trusted' : ''}`
  } else {
    dao.textContent = 'No DAO yet: the founder runs this circle.'
    dao.className = 'dao-status neutral'
  }
  if (!chatMessages.size) chatRoom = circleId
  renderAll()
  renderLoansTable()
  await renderTreasury().catch((error) => show(`Treasury: ${errorText(error)}`, 'bad'))
}

/* ---------- wiring ---------- */

function on(selector: string, action: () => Promise<void> | void, context: 'wallet' | 'chat' | 'chain' = 'chain'): void {
  const b = $<HTMLButtonElement>(selector)
  b.addEventListener('click', () => void run(b, async () => { await action() }, context))
}

function wire(): void {
  for (const item of document.querySelectorAll<HTMLButtonElement>('.nav-item')) item.addEventListener('click', () => goView(item.dataset.view as View))
  $('#menu-btn').addEventListener('click', (event) => { event.stopPropagation(); $('#sidebar').classList.toggle('open') })
  // Phone: a tap outside the slide-out menu closes it.
  document.addEventListener('click', (event) => {
    const sidebar = $('#sidebar')
    if (sidebar.classList.contains('open') && !sidebar.contains(event.target as Node)) sidebar.classList.remove('open')
  })
  on('#connect-meteor', () => connectWallet('meteor-wallet'), 'wallet')
  on('#connect-wallet', () => connectWallet('my-near-wallet'), 'wallet')
  $('#status-close').addEventListener('click', hideToast)
  on('#copy-invite', async () => { await navigator.clipboard.writeText($<HTMLTextAreaElement>('#invite-link').value); show('Link copied. Send it privately.', 'ok') })
  $('#go-ask-chat').addEventListener('click', () => { goView('chat'); $('#ask-panel').hidden = false; checkAsk() })
  $('#go-direct').addEventListener('click', () => goView('direct'))
  $('#open-chat-requests').addEventListener('click', () => goView('chat'))
  $('#ask-open').addEventListener('click', () => { $('#ask-panel').hidden = !$('#ask-panel').hidden; checkAsk() })
  $('#ask-close').addEventListener('click', () => { $('#ask-panel').hidden = true })
  for (const id of ['#ask-amount', '#ask-days']) $(id).addEventListener('input', () => { checkAsk() })
  on('#ask-post', postAsk)
  on('#disconnect-wallet', disconnectWallet)
  on('#sign-in', signIn)
  on('#join-invite', joinInvite)
  on('#create-invite', createInvite)
  on('#create-circle', createCircle)
  on('#save-design', saveDesign)
  on('#load-positions', refreshMe)
  on('#check-chat-access', () => checkChatAccess(false))
  on('#load-my-card', loadMyCard)
  on('#load-demo', refreshAll)
  on('#journey-refresh', async () => { await refreshAll(); show('Up to date with testnet.', 'ok') })
  on('#treasury-request', requestFromTreasury)
  const composer = $<HTMLFormElement>('#composer')
  const box = $<HTMLTextAreaElement>('#chat-message')
  composer.addEventListener('submit', (event) => { event.preventDefault(); void run($<HTMLButtonElement>('#send-chat'), sendChat) })
  box.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); composer.requestSubmit() } })
  box.addEventListener('input', () => { box.style.height = ''; box.style.height = `${Math.min(box.scrollHeight, 140)}px` })
  $('#chat-search').addEventListener('input', renderRooms)
  for (const [btn, show_, hide] of [['#seg-rooms', '#room-list', '#people-list'], ['#seg-people', '#people-list', '#room-list']] as const) {
    $(btn).addEventListener('click', () => {
      $('#seg-rooms').setAttribute('aria-selected', String(btn === '#seg-rooms'))
      $('#seg-people').setAttribute('aria-selected', String(btn === '#seg-people'))
      $(show_).hidden = false
      $(hide).hidden = true
      $('#list-label').textContent = btn === '#seg-rooms' ? 'Circle rooms' : `People in ${roomName(chatRoom)}`
    })
  }
  bindThemeForm('new-circle', () => $<HTMLInputElement>('#new-circle-name').value.trim() || 'New circle', (error) => show(errorText(error), 'bad'))
  bindThemeForm('design', () => `Circle ${$<HTMLInputElement>('#design-circle-id').value.trim() || '?'}`, (error) => show(errorText(error), 'bad'))
  $<HTMLInputElement>('#new-circle-name').addEventListener('input', () => renderThemePreview('new-circle', $('#new-circle-preview'), $<HTMLInputElement>('#new-circle-name').value.trim() || 'New circle'))
  for (const id of ['#circle-id', '#invite-public-key', '#invite-secret']) $(id).addEventListener('input', () => renderJourney())
  window.setInterval(tickDue, 1000)
}

// The invite link is kept in this browser until the join succeeds, so reopening the
// app without the link (a new tab, a bookmark) does not lose it. The invite key is a
// throwaway, single-use key that only the named invitee can redeem; it is never an
// account key.
const INVITE_KEY = 'commoncircle.pendingInvite'

function rememberInvite(invite: ReturnType<typeof parseInviteLink>): void {
  try { localStorage.setItem(INVITE_KEY, JSON.stringify(invite)) } catch { /* ignore */ }
}

function savedInvite(): ReturnType<typeof parseInviteLink> | null {
  try {
    const saved = JSON.parse(localStorage.getItem(INVITE_KEY) ?? 'null') as ReturnType<typeof parseInviteLink> | null
    return saved?.inviteSecret && saved.invitePublicKey && saved.circleId ? saved : null
  } catch {
    return null
  }
}

function forgetInvite(): void {
  try { localStorage.removeItem(INVITE_KEY) } catch { /* ignore */ }
}

function hydrateInviteFields(): void {
  let invite = parseInviteLink()
  if (invite.inviteSecret && invite.invitePublicKey && invite.circleId) rememberInvite(invite)
  else {
    const saved = savedInvite()
    if (saved && (!invite.circleId || invite.circleId === saved.circleId)) invite = saved
  }
  if (invite.circleId) {
    $<HTMLInputElement>('#circle-id').value = invite.circleId
    $<HTMLInputElement>('#demo-circle-id').value = invite.circleId
    circleId = invite.circleId
    chatRoom = invite.circleId
  }
  if (invite.invitePublicKey) $<HTMLInputElement>('#invite-public-key').value = invite.invitePublicKey
  if (invite.inviteSecret) $<HTMLInputElement>('#invite-secret').value = invite.inviteSecret
}

function boot(): void {
  hydrateInviteFields()
  wire()
  let start: View = 'home'
  try { const saved = localStorage.getItem('commoncircle.view'); if (saved && (VIEWS as readonly string[]).includes(saved)) start = saved as View } catch { /* ignore */ }
  if (inviteFields().inviteSecret) start = 'home'
  goView(start)
  renderAll()
  void loadDemo().catch((error) => show(`Could not load testnet data: ${errorText(error)}`, 'bad'))
  void restoreWallet().catch(() => { /* no saved wallet session */ })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
else boot()
