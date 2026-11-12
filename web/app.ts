import { CircleClient, passportTokenTitle, type CircleParams, type LoanView, type PassportView } from './circle-client'
import { friendlyError, isRepeat, TOAST_MS, type NextAction, type ToastKind } from './notify'
import { badgeFor, memberLabel, type Tier } from './labels'
import { signInWithNep413 } from './nep413'
import { buildInviteLink, generateInviteKeyPair, parseInviteLink, signInviteWithSecret } from './invite'
import { loadReadOnlyDemo, type ReadOnlyDemoSnapshot } from './demo'
import { bindThemeForm, readThemeForm, renderThemePreview } from './theme'
// The wallet library (~1.5 MB) loads only on Connect or when a session exists.
import type { NearWalletController } from './near-wallet'
import { assertCircleName } from './text-rules'
import { avatarFor, ChatApiError, ChatClient, dayLabel, timeLabel, type ChatMessage } from './chat'
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
const VIEWS = ['home', 'chat', 'loans', 'treasury', 'members', 'tools'] as const
type View = (typeof VIEWS)[number]

type Me = { passport: PassportView | null; registered: boolean; loans: LoanView[]; signedIn: boolean; circles: Array<{ id: string; name: string }> }

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
let chatTimer = 0

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector(selector) as T
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}
const short = (id: string) => (id.length > 24 ? `${id.slice(0, 11)}…${id.slice(-10)}` : id)
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

async function requestLoan(lenderId: string, amountText: string, daysText: string, cid = circleId): Promise<void> {
  requireWallet()
  const amount = usdcToBaseUnits(amountText)
  const durationDays = Number(daysText)
  if (!lenderId) throw new Error('Choose who you are asking.')
  if (!Number.isInteger(durationDays) || durationDays < 1) throw new Error('Days must be a whole number.')
  const storage = await readClient.storageCosts()
  await client().createLoan({ circleId: cid, lenderId, amount, durationDays, deposit: storage.create_loan })
  await afterTx(`Request sent. ${short(lenderId)} can fund it within 1 hour.`)
}

async function repay(loan: LoanView): Promise<void> {
  requireWallet()
  const outcome = await client().repayLoan({ usdcId: await getUsdcId(), loanId: loan.loan_id, amount: loan.outstanding })
  const notice = repaymentNotice(outcome, await readClient.getLoan(loan.loan_id))
  if (notice) { await refreshAll(); show(notice, 'bad'); return }
  await afterTx(`Repaid loan #${loan.loan_id}. The money went straight back to ${short(loan.lender_id)}.`)
}

async function fund(loan: LoanView): Promise<void> {
  requireWallet()
  const outcome = await client().fundLoan({ usdcId: await getUsdcId(), loanId: loan.loan_id, amount: loan.principal })
  if (outcome.fundingFailed.length || outcome.refunded.length) {
    await refreshAll()
    show('Funding did not go through, and your USDC came straight back. Is the borrower set up for USDC?', 'bad')
    return
  }
  await afterTx(`Funded loan #${loan.loan_id}: ${formatUsdc(loan.principal)} USDC went straight to ${short(loan.borrower_id)}.`)
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
  if (circle.admin_id !== accountId) throw new Error(`Only the circle admin (${short(circle.admin_id)}) can change the design. In a DAO circle that is done by vote.`)
  const storage = await readClient.storageCosts()
  await client().setCircleTheme({ circleId: cid, theme: readThemeForm('design'), deposit: storage.set_circle_theme })
  show('Design saved. Cards update after the transaction is final.', 'ok')
}

/* ---------- chat ---------- */

function roomName(id: string): string {
  return me?.circles.find((c) => c.id === id)?.name ?? (demo?.circle?.circle_id === id ? demo.circle.name : `Circle ${id}`)
}

function tierOf(account: string): string | null {
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
      el('span', { className: 'room-last', textContent: last ? `${last.account_id === accountId ? 'You' : short(last.account_id)}: ${last.text}` : chatAllowed || id !== chatRoom ? 'No messages yet' : 'Members only' }),
      unread && id !== chatRoom ? el('span', { className: 'room-new', textContent: `${unread} new message${unread > 1 ? 's' : ''}` }) : ''))
    item.addEventListener('click', () => void openRoom(id))
    return el('li', {}, item)
  }) : [el('li', { className: 'muted small', textContent: 'No rooms match.' })]))

  const people = (demo?.circle?.circle_id === chatRoom ? demo.passports : [])
  $('#people-list').replaceChildren(...(people.length ? people.map((p) => el('li', {}, el('div', { className: 'room' },
    avatar(p.owner_id),
    el('span', { className: 'room-main' },
      el('span', { className: 'room-name' }, el('span', { textContent: p.owner_id === accountId ? 'You' : short(p.owner_id) }), el('span', { className: `tier tier-${p.display_tier}`, textContent: p.display_tier })),
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
  if (!msgs.length) {
    box.append(el('p', { className: 'chat-empty', textContent: 'No messages yet. Say hello to your circle.' }))
    return
  }
  let lastDay = ''
  let prev: ChatMessage | null = null
  for (const m of msgs) {
    const day = dayLabel(m.at)
    if (day !== lastDay) { box.append(el('p', { className: 'day', textContent: day })); lastDay = day; prev = null }
    const mine = m.account_id === accountId
    const cont = !!prev && prev.account_id === m.account_id && m.at - prev.at < 5 * 60_000
    const tier = tierOf(m.account_id)
    const meta = el('div', { className: 'msg-meta' }, avatar(m.account_id, 'sm'), el('strong', { textContent: mine ? 'You' : short(m.account_id) }),
      tier ? el('span', { className: `tier tier-${tier}`, textContent: tier }) : '', el('span', { textContent: timeLabel(m.at) }))
    box.append(el('div', { className: `msg${mine ? ' mine' : ''}${cont ? ' cont' : ''}` }, meta, el('div', { className: 'bubble', textContent: m.text })))
    prev = m
  }
  if (nearBottom || msgs.length) box.scrollTop = box.scrollHeight
  chatSeen.set(chatRoom, msgs[msgs.length - 1].id)
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

async function pollChat(): Promise<void> {
  const chat = chatClient()
  if (!chat || !accountId) return
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

/* ---------- reading state ---------- */

async function refreshMe(): Promise<void> {
  if (!accountId) { me = null; renderAll(); return }
  try {
    const usdc = new CircleClient(config.rpcUrl, await getUsdcId())
    const [passport, registration, loans, tokens] = await Promise.all([
      readClient.passportFor(circleId, accountId),
      usdc.view<unknown>('storage_balance_of', { account_id: accountId }),
      readClient.loansByBorrower(accountId),
      readClient.nftTokensForOwner(accountId, null, 50).catch(() => []),
    ])
    const ids = [...new Set(tokens.map((t) => t.token_id.split(':')[0]))]
    const circles = await Promise.all(ids.map(async (id) => ({ id, name: (await readClient.getCircle(id).catch(() => null))?.name ?? `Circle ${id}` })))
    me = { passport, registered: !!registration, loans: loans.filter((l) => l.circle_id === circleId), signedIn: session()?.accountId === accountId, circles }
  } catch (error) {
    show(`Could not read your account: ${errorText(error)}`, 'bad')
  }
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
  return el('div', { className: 'step-form' },
    el('label', {}, 'Ask', select), el('label', {}, 'USDC', amount), el('label', {}, 'Days', days),
    button('Send request', () => requestLoan(select.value, amount.value, days.value)))
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
    invite.inviteSecret && !passport ? [button('Join the circle', joinInvite)] : []))
  steps.push(step(3, stateOf(2), 'Sign in',
    me?.signedIn ? 'Signed in for this browser session. The chat is open to you.' : 'A free signature that proves the account is yours. It also opens the circle chat.',
    [button('Sign in', signIn)]))
  steps.push(step(4, stateOf(3), 'Get ready to receive USDC',
    me?.registered ? 'Your account can receive USDC.' : 'A one-time setup so a lender can send you money. Costs 0.00125 NEAR.',
    [button('Set up USDC', registerForUsdc)]))
  const trustedHint = passport?.effective_tier === 'Trusted' && !passport.steward ? ' As a Trusted member you can also ask the treasury.' : ''
  const got = funded ?? repaid
  steps.push(step(5, stateOf(4), 'Ask a member for a loan',
    got ? `Loan #${got.loan_id}: ${formatUsdc(got.principal)} USDC from ${short(got.lender_id)}.`
      : open ? `Request #${open.loan_id} for ${formatUsdc(open.principal)} USDC is waiting for ${short(open.lender_id)} to fund it (they have 1 hour).`
        : `Choose who to ask, how much, and for how long. Demo days are 60 seconds, so 7 days means 7 minutes to repay.${trustedHint}`,
    [], open ? undefined : loanRequestForm()))
  let repayDesc: string | Node = 'Once your loan arrives, pay it back before the due time. Your card turns Trusted.'
  const repayActions: HTMLElement[] = []
  if (funded) {
    repayDesc = el('span', {}, `You owe ${formatUsdc(funded.outstanding)} USDC to ${short(funded.lender_id)}. `, dueSpan(funded))
    repayActions.push(button('Repay now', () => repay(funded)))
  } else if (repaid) {
    const late = repaid.repaid_on_time === false && !repaid.flag_cleared
    repayDesc = late ? 'Repaid, but late. You can ask the stewards to forgive the late mark.'
      : `Repaid on time. Your card is ${passport?.effective_tier ?? 'updated'}${passport?.effective_tier === 'Trusted' ? '. Well done!' : '.'}`
    if (late) repayActions.push(button('Ask stewards to forgive', () => askToForgive(repaid), 'soft'))
  }
  steps.push(step(6, funded ? 'current' : stateOf(5), 'Pay it back on time', repayDesc, repayActions))
  $('#steps').replaceChildren(...steps)
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
      el('span', { title: card.passport.owner_id, textContent: card.passport.owner_id === accountId ? 'You' : short(card.passport.owner_id) }),
      el('span', { className: `tier tier-${card.passport.display_tier}`, textContent: card.passport.display_tier })))
    grid.append(fig)
  }
  if (!grid.children.length) grid.append(el('p', { className: 'muted', textContent: 'No members yet.' }))
  const lenders = $('#lender-options')
  lenders.replaceChildren(...(demo?.passports ?? []).filter((p) => p.owner_id !== accountId).map((p) => el('option', { value: p.owner_id })))
}

function renderLoansTable(): void {
  const loans = (demo?.loans ?? []).slice().sort((a, b) => Number(b.loan_id) - Number(a.loan_id))
  $('#circle-loans').replaceChildren(...(loans.length ? loans.map((l) => el('tr', {},
    el('td', { textContent: l.loan_id }),
    el('td', {}, who(l.borrower_id, l.borrower_id === accountId ? 'You' : short(l.borrower_id))),
    el('td', {}, l.lender_is_treasury ? who(l.lender_id, 'Treasury (DAO)') : who(l.lender_id, l.lender_id === accountId ? 'You' : short(l.lender_id))),
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
  for (const loan of positions.borrowed.slice().reverse()) {
    const li = el('li', {}, el('span', {}, el('strong', { textContent: `Borrowed #${loan.loan_id}` }), ` · ${formatUsdc(loan.principal)} USDC from ${short(loan.lender_id)} `,
      el('span', { className: `state state-${loan.state}`, textContent: loan.state }), ' ', loan.state === 'Funded' ? dueSpan(loan) : ''))
    if (loan.state === 'Funded') li.append(button('Repay', () => repay(loan)))
    const late = (loan.overdue || (loan.state === 'Repaid' && loan.repaid_on_time === false)) && !loan.flag_cleared
    if (late) li.append(button('Ask stewards to forgive', () => askToForgive(loan), 'soft'))
    const note = repaymentNotice(null, loan)
    if (note) li.append(el('p', { className: 'notice', textContent: note }))
    items.push(li)
  }
  for (const loan of positions.lent.slice().reverse()) {
    const li = el('li', {}, el('span', {}, el('strong', { textContent: `Lent #${loan.loan_id}` }), ` · ${formatUsdc(loan.principal)} USDC to ${short(loan.borrower_id)} `,
      el('span', { className: `state state-${loan.state}`, textContent: loan.state })))
    if (loan.state === 'Open') li.append(button('Fund it', () => fund(loan)))
    items.push(li)
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
    el('span', { textContent: `Stewards: ${stewards.map(short).join(' and ')}` }),
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
      el('span', { className: 'muted small', textContent: `Asked by ${short(p.proposer)} · ${approvals} of ${stewards.length} approvals` })),
      el('span', { className: `state state-${label}`, textContent: label === 'Other' ? p.status : label }))
    if (canVote) li.append(button('Approve', async () => { await dao.approve(p); await afterTx(`You approved proposal #${p.id}.`) }))
    return li
  }) : [el('li', { className: 'empty', textContent: 'No votes yet. A Trusted member files the first request.' })]))
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
  on('#disconnect-wallet', disconnectWallet)
  on('#sign-in', signIn)
  on('#join-invite', joinInvite)
  on('#create-invite', createInvite)
  on('#create-circle', createCircle)
  on('#create-loan', () => requestLoan($<HTMLInputElement>('#loan-lender-id').value.trim(), $<HTMLInputElement>('#loan-amount').value, $<HTMLInputElement>('#loan-duration-days').value, $<HTMLInputElement>('#loan-circle-id').value.trim()))
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
