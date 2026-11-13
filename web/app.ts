import { CircleClient, parseFtTransferCallOutcome, passportTokenTitle, type CircleParams, type LoanView, type PassportView } from './circle-client'
import { friendlyError, isRepeat, TOAST_MS, type NextAction, type ToastKind } from './notify'
import { badgeFor, memberLabel, type Tier } from './labels'
import { circleStats, demoDifferences, privileges, recentActivity, STANDARD_RULES, trackSummaries, treasuryEligibility, type EvidenceStatus } from './overview'
import evidenceFile from './evidence-status.json'
import { borrowLimit, canCancel, countdown, formatDuration, isWaiting, loanLengthText, openLimitMessage, requestsForLender, trustedProgress, validateLoanInput } from './loan-rules'
import { explorerTxUrl, moneySummary, runMoney, type MoneyDeps, type MoneyKind, type MoneyOptions } from './money'
import { signInWithNep413 } from './nep413'
import { buildInviteLink, generateInviteKeyPair, parseInviteLink, signInviteWithSecret } from './invite'
import { allPages, loadReadOnlyDemo, type ReadOnlyDemoSnapshot } from './demo'
import { bindThemeForm, readThemeForm, renderThemePreview } from './theme'
// The wallet library (~1.5 MB) loads only on Connect or when a session exists.
import type { NearWalletController } from './near-wallet'
import { assertCircleName } from './text-rules'
import { checkCardSvg } from './card-safety'
import { onRpcHealth, rpcHealth, rpcPost, TESTNET_RPCS } from './rpc'
import { describeNet, initialNet, isStale, netFailed, netSucceeded, retryDelay, type NetState } from './net-state'
import { avatarFor, ChatApiError, ChatClient, chatServerHealth, dayLabel, mergeMessages, timeLabel, type ChatMessage, type LoanRequestCard } from './chat'
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
  // Set VITE_AUTH_URL at build time to point a hosted copy at a hosted sign-in server.
  authUrl: (import.meta.env.VITE_AUTH_URL as string | undefined) || 'http://localhost:3001',
  recipient: window.location.host,
  explorerUrl: 'https://testnet.nearblocks.io',
  ...window.COMMONCIRCLE_CONFIG,
}
const readClient = new CircleClient(config.rpcUrl, config.contractId)
const client = () => new CircleClient(config.rpcUrl, config.contractId, window.commonCircleWallet)
const TOKEN_KEY = 'commoncircle.session'
const VIEWS = ['locked', 'home', 'chat', 'members', 'invites', 'loans', 'direct', 'myloans', 'passport', 'treasury', 'activity', 'evidence', 'network', 'tools', 'settings'] as const
/** Pages that show a circle's members, loans, chat or money: members only (or the public demo on request). */
const GATED = new Set<string>(['chat', 'members', 'loans', 'direct', 'myloans', 'passport', 'treasury', 'activity'])
/** Set only when someone presses "View the public demo circle" (for judges); never for other circles. */
let demoOpen = false
const DEMO_CIRCLE = '3'

/** May this browser show the open circle's activity? Members of it, or the public demo when asked for. */
function canView(): boolean {
  if (me?.passport?.status === 'Active') return true
  return demoOpen && circleId === DEMO_CIRCLE
}

/** Phone tab bar: which tab lights up for each page ("more" covers the rest). */
const TAB_OF: Partial<Record<string, string>> = { home: 'home', chat: 'chat', loans: 'loans', direct: 'loans', myloans: 'loans', passport: 'passport' }
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
/** USDC balances read from testnet: the loan contract (zero custody) and the DAO treasury. null = not read. */
let balances: { contract: string | null; dao: string | null } = { contract: null, dao: null }
let loadError = ''
let passportAccount = ''
/** How fresh the testnet data on screen is (web/net-state.ts). */
let net: NetState = initialNet()
/** Bumped when the account or circle changes: answers to older reads are dropped. */
let epoch = 0
/** One refresh at a time; callers share the one in flight. */
let refreshing: Promise<void> | null = null

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
    void navigator.clipboard?.writeText(account).then(() => show(`${account} (copied)`, 'ok'), () => show(account, 'info'))
  })
  return chip
}

/* ---------- messages to the user ---------- */

let toastTimer = 0
let toastShown: { text: string; kind: ToastKind; next: NextAction } | null = null

function hideToast(): void {
  window.clearTimeout(toastTimer)
  $('#status').hidden = true
  document.body.classList.remove('has-toast')
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
    document.body.classList.add('has-toast')
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
  // Testnet being unreachable is shown once in the banner (with the last good data kept), not as a toast.
  // Testnet unreachable: the banner keeps the last good data (labelled stale) and retries.
  if (context === 'chain' && isNetworkText(friendly.text)) netTrouble(friendly.text)
  show(friendly.text, 'bad', friendly.next, retry)
}

const isNetworkText = (text: string) => /Could not reach NEAR testnet|NEAR testnet is busy/.test(text)

/* ---------- testnet connection banner: keep the last good data, retry with backoff ---------- */

let netRetryTimer = 0

/** The status pill and banner, from the one network state. */
function renderNet(): void {
  const d = describeNet(net, Date.now())
  const pill = $('#net-pill')
  pill.className = `net-pill ${d.tone}`
  $('#net-pill-text').textContent = d.pill
  pill.title = net.lastOkAt ? `Last successful testnet read: ${new Date(net.lastOkAt).toLocaleString()}` : 'No successful testnet read yet'
  const banner = $('#net-banner')
  banner.hidden = !d.banner
  banner.className = `net-banner ${d.tone === 'bad' ? 'bad' : ''}`
  $('#net-banner-text').textContent = d.banner ?? ''
}

/** A full refresh failed: keep the last good data (labelled stale) and retry with bounded backoff. */
function netTrouble(error = ''): void {
  net = netFailed(net, error)
  renderNet()
  window.clearTimeout(netRetryTimer)
  netRetryTimer = window.setTimeout(() => void refreshAll().catch(() => undefined), retryDelay(net))
}

function netOk(partial: string[] = []): void {
  window.clearTimeout(netRetryTimer)
  net = netSucceeded(net, Date.now(), partial)
  renderNet()
}

/** Money actions never rely on cached data: refuse while testnet is unreachable or the data is stale. */
function requireFresh(): void {
  if (isStale(net, Date.now())) throw new Error('The data on screen is not fresh (NEAR testnet could not be reached). Press Retry, then try again. Nothing was sent.')
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

/** Show the current page, or the members-only notice in its place. */
function showView(): void {
  const locked = GATED.has(view) && !canView()
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== (locked ? 'locked' : view)
  document.body.classList.toggle('gated', !canView())
  if (!locked) return
  const name = $(`#view-${view}`).dataset.title ?? 'This page'
  const pending = inviteFields()
  $('#locked-title').textContent = `${name}: for circle members`
  $('#locked-text').textContent = !accountId
    ? 'Connect your wallet. If you belong to a circle, it opens here. Circles are private to their members in this app.'
    : pending.inviteSecret ? 'You have an invite. Join the circle on Overview, then this page opens.'
      : `${memberLabel(accountId)} is not a member of this circle. Ask a member for an invite link, or start your own circle.`
  $('#locked-actions').replaceChildren(
    ...(accountId ? [] : connectButtons()),
    button(pending.inviteSecret ? 'Go to Join' : 'Paste an invite link', async () => goView('home')),
    button('Start my own circle', async () => { goView('tools'); const d = document.querySelector<HTMLDetailsElement>('#view-tools details'); if (d) d.open = true }, 'ghost'),
    ...(circleId === DEMO_CIRCLE ? [button('View the public demo circle', async () => { demoOpen = true; renderAll() }, 'ghost')] : []))
}

function goView(next: View): void {
  view = next
  showView()
  for (const item of document.querySelectorAll<HTMLButtonElement>('.nav-item')) {
    item.classList.toggle('active', item.dataset.view === next)
    if (item.dataset.view === next) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  }
  const tab = TAB_OF[next] ?? 'more'
  for (const t of document.querySelectorAll<HTMLButtonElement>('.tab')) t.classList.toggle('active', t.dataset.tab === tab)
  const title = $(`#view-${next}`).dataset.title ?? ''
  $('#crumb-view').textContent = title
  document.title = `${title} · CommonCircle`
  closeDrawer()
  window.scrollTo({ top: 0 })
  try { localStorage.setItem('commoncircle.view', next) } catch { /* ignore */ }
  if (next === 'chat') { void openRoom(chatRoom); startChatPolling() } else stopChatPolling()
  if (next === 'network') renderNetwork()
  if (next === 'settings') renderSettings()
  if (next === 'direct') mountForm($('#loan-form-slot'), 'direct')
}

/* ---------- drawer (phone) and account menu ---------- */

function openDrawer(): void {
  $('#sidebar').classList.add('open')
  $('#scrim').hidden = false
  $('#menu-btn').setAttribute('aria-expanded', 'true')
}

function closeDrawer(): void {
  $('#sidebar').classList.remove('open')
  $('#scrim').hidden = true
  $('#menu-btn').setAttribute('aria-expanded', 'false')
}

function closeAccountMenu(): void {
  $('#account-menu').hidden = true
  $('#head-connect').setAttribute('aria-expanded', 'false')
  $('#head-account').setAttribute('aria-expanded', 'false')
}

/** Header menu: wallet choices when disconnected; full account, copy, Switch, Disconnect when connected. */
function toggleAccountMenu(trigger: HTMLElement): void {
  const menu = $('#account-menu')
  if (!menu.hidden) { closeAccountMenu(); return }
  const item = (label: string, action: () => Promise<void>, context: 'wallet' | 'chain' = 'chain') => {
    const b = el('button', { className: 'menu-item', type: 'button', textContent: label, role: 'menuitem' })
    b.addEventListener('click', () => { closeAccountMenu(); void run(null, action, context) })
    return b
  }
  menu.replaceChildren(...(accountId
    ? [el('p', { className: 'menu-head' }, el('span', { className: 'small muted', textContent: 'Signed in as' }), el('strong', { className: 'menu-account', textContent: accountId })),
      item('Copy account ID', async () => { await navigator.clipboard.writeText(accountId); show(`${accountId} (copied)`, 'ok') }),
      item('Switch account', switchWallet, 'wallet'),
      item('Disconnect', disconnectWallet)]
    : [el('p', { className: 'menu-head small muted', textContent: 'Connect a NEAR testnet wallet' }),
      item('Meteor (recommended)', () => connectWallet('meteor-wallet'), 'wallet'),
      item('MyNearWallet', () => connectWallet('my-near-wallet'), 'wallet')]))
  menu.hidden = false
  trigger.setAttribute('aria-expanded', 'true')
  menu.querySelector('button')?.focus()
}

function renderHeadAccount(): void {
  $('#head-connect').hidden = !!accountId
  const chip = $('#head-account')
  chip.hidden = !accountId
  const bal = walletBal && walletBal.account === accountId ? walletBal : null
  const balText = !bal ? 'reading balance…' : `${bal.near === null ? '?' : formatNear(bal.near)} NEAR · ${bal.usdc === null ? '?' : formatUsdc(bal.usdc)} USDC`
  if (accountId) chip.replaceChildren(avatar(accountId, 'sm'), el('span', { className: 'head-chip-text' },
    el('span', { className: 'head-chip-name', textContent: memberLabel(accountId) }),
    el('span', { className: 'head-chip-bal', textContent: balText })))
  chip.title = accountId ? `Signed in as ${accountId}${bal ? ` · wallet balance on testnet: ${balText}. NEAR and USDC are two separate tokens: the USDC figure is your test-USDC, not the NEAR balance converted to dollars.` : ''}` : ''
}

let autoSwitched = ''

/** The connected wallet's own balances (read-only views on testnet). null = could not read, never shown as 0. */
let walletBal: { account: string; usdc: string | null; near: string | null } | null = null

/** yoctoNEAR -> "12.34" (BigInt, no floating point). */
function formatNear(yocto: string): string {
  const v = BigInt(yocto)
  const whole = v / 10n ** 24n
  const cents = (v % 10n ** 24n) / 10n ** 22n
  return `${whole}.${cents.toString().padStart(2, '0')}`
}

async function loadWalletBalance(account: string): Promise<void> {
  const usdc = new CircleClient(config.rpcUrl, await getUsdcId())
  const [u, n] = await Promise.all([
    usdc.view<string>('ft_balance_of', { account_id: account }).catch(() => null),
    rpcPost<{ result?: { amount?: string } }>(config.rpcUrl, { jsonrpc: '2.0', id: 'bal', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: account } })
      .then((r) => r.payload.result?.amount ?? null).catch(() => null),
  ])
  if (account !== accountId) return
  walletBal = { account, usdc: u, near: n }
  renderHeadAccount()
}

/* ---------- wallet ---------- */

function onAccountChange(nextAccountId: string): void {
  const changed = nextAccountId !== accountId
  accountId = nextAccountId
  $<HTMLInputElement>('#account-id').value = nextAccountId
  $('#profile-out').hidden = !!nextAccountId
  $('#profile-in').hidden = !nextAccountId
  $('#wallet-account').textContent = nextAccountId ? memberLabel(nextAccountId) : ''
  $('#wallet-account').title = nextAccountId ? `${nextAccountId} (tap to copy)` : ''
  $('#profile-avatar').replaceWith(Object.assign(avatar(nextAccountId || '?'), { id: 'profile-avatar' }))
  closeAccountMenu()
  renderHeadAccount()
  // Re-render now so step 1 shows "Connected" at once; refreshMe() fills in the rest
  // after its testnet reads, which can take a few seconds.
  // A "connect your wallet" error is stale once an account is connected.
  if (nextAccountId && toastShown?.next === 'connect') hideToast()
  if (changed) {
    // A different account: forget everything read for the previous one, and drop its in-flight reads.
    epoch++
    me = null
    chatMessages.clear()
    chatRequests.clear()
    chatAllowed = false
    formCache.clear()
    renderAll()
    void refreshMe()
  }
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
  inviteResult = null
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
  if (!window.commonCircleWallet || !accountId) throw new Error('Connect a wallet first (Connect wallet, top right).')
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

/** A public copy (GitHub Pages) can only use a chat server that was configured at build time. */
function chatServerConfigured(): boolean {
  const local = (h: string) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(h)
  try { return !(local(new URL(config.authUrl).hostname) && !local(window.location.hostname)) } catch { return false }
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
/** Refuse before signing when the open-loan limit is reached (the contract would fail with E16). */
async function assertCanBorrow(): Promise<void> {
  if (!demo?.circle) return
  const limit = borrowLimit(demo.circle.params, me?.passport ?? null, demo.config.hard_loan_cap)
  const loans = (await readClient.loansByBorrower(accountId)).filter((l) => l.circle_id === circleId)
  const message = openLimitMessage(loans, limit, Date.now())
  if (message) throw new Error(message)
}

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
  await assertCanBorrow()
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
    registerAccount: async (account) => c.registerWithToken({ tokenId: await getUsdcId(), accountId: account }),
  }
}

/** Opens the "check before you sign" dialog; the action runs only on Confirm. */
async function money(kind: MoneyKind, cachedLoan: LoanView): Promise<void> {
  requireWallet()
  requireFresh()
  // Never act on cached data: read the loan from testnet now and summarise that.
  let loan: LoanView | null
  try {
    loan = await readClient.getLoan(cachedLoan.loan_id)
  } catch {
    throw new Error(`Could not read loan #${cachedLoan.loan_id} from NEAR testnet just now, so nothing was sent. Try again in a moment.`)
  }
  if (!loan) throw new Error(`Loan #${cachedLoan.loan_id} was not found on testnet. Nothing was sent.`)
  if (kind === 'fund' && !(loan.state === 'Open' && isWaiting(loan, Date.now()))) { void refreshAll(); throw new Error(`Loan #${loan.loan_id} can no longer be funded (it is ${loan.state === 'Open' ? 'past its funding deadline' : loan.state}). Nothing was sent.`) }
  if (kind === 'repay' && loan.state !== 'Funded') { void refreshAll(); throw new Error(`Loan #${loan.loan_id} is ${loan.state}, so there is nothing to repay right now.`) }
  if (kind === 'cancel' && loan.state !== 'Open') { void refreshAll(); throw new Error(`Loan #${loan.loan_id} is ${loan.state} and cannot be cancelled.`) }
  const dialog = $<HTMLDialogElement>('#money-dialog')
  // Repaying a lender who left USDC would bounce: offer to pay their USDC registration first (F-09 route).
  const options: MoneyOptions = {}
  if (kind === 'repay' && !loan.lender_is_treasury) options.registerLender = !(await moneyDeps().isRegistered(loan.lender_id).catch(() => true))
  const summary = moneySummary(kind, loan, memberLabel, demo?.circle?.params.day_length_sec ?? '86400', options)
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
    const result = await runMoney(kind, loan, moneyDeps(), await getUsdcId().catch(() => ''), memberLabel, options)
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

/** The last invite link made in this tab. The secret is never stored or sent anywhere: copy it now, or make another. */
let inviteResult: { circleId: string; link: string; qrSvg: string; inviteeId: string | null; expiresAt: number } | null = null

async function qrSvg(text: string): Promise<string> {
  const { default: QRCode } = await import('qrcode')
  return QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#221c18', light: '#ffffff' } })
}

async function createInvite(inviteeText: string, hoursText: string): Promise<void> {
  requireWallet()
  const cid = circleId
  const inviteeId = inviteeText.trim() || null
  const hoursValue = hoursText.trim() || '24'
  if (!/^\d+$/.test(hoursValue) || hoursValue === '0') throw new Error('Enter how many hours the link should work, for example 24.')
  if (inviteeId && !/^[a-z0-9._-]+\.testnet$/.test(inviteeId)) throw new Error('Enter their testnet account, for example friend.testnet.')
  const hours = BigInt(hoursValue)
  const pair = await generateInviteKeyPair()
  const expiresAt = (BigInt(Date.now()) * 1_000_000n + hours * 3_600_000_000_000n).toString()
  const storage = await readClient.storageCosts()
  await client().registerInvite({ circleId: cid, invitePublicKey: pair.publicKey, expiresAt, inviteeId, deposit: storage.register_invite })
  const link = buildInviteLink({ circleId: cid, invitePublicKey: pair.publicKey, inviteSecret: pair.secret })
  inviteResult = { circleId: cid, link, qrSvg: await qrSvg(link).catch(() => ''), inviteeId, expiresAt: Date.now() + Number(hours) * 3_600_000 }
  renderInvitePanels()
  show(inviteeId ? `Invite created for ${inviteeId}. Copy the link or show the QR code.` : 'Invite created. Copy the link or show the QR code.', 'ok')
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
  const standard = $<HTMLSelectElement>('#new-circle-preset').value === 'standard'
  const params: CircleParams = standard ? { ...testnetDemoParams, ...STANDARD_RULES, qualifying_min_days: 1, recovery_lock_sec: '259200' } : testnetDemoParams
  const raw = await client().createCircle({ name, params, theme: readThemeForm('new-circle'), deposit: storage.create_circle })
  // The new circle's number: from the circle_created event, else the newest passport this account holds.
  const event = parseFtTransferCallOutcome(raw).events.find((e) => e.event === 'circle_created')
  let newId = (event?.data[0] as { circle_id?: string } | undefined)?.circle_id ?? null
  if (!newId) {
    await wait(2500)
    const tokens = await readClient.nftTokensForOwner(accountId, null, 100).catch(() => [])
    newId = tokens.map((t) => t.token_id.split(':')[0]).sort((a, b) => Number(b) - Number(a))[0] ?? null
  }
  show(standard ? 'Circle created with the standard rules.' : 'Circle created with demo settings (60-second days, 1 repayment to Trusted).', 'ok')
  if (newId) {
    $<HTMLInputElement>('#demo-circle-id').value = newId
    await refreshAll()
    goView('home')
    show('Circle created. You are its founder: invite members on Overview.', 'ok')
  }
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

/** A room's name, or null while it is still loading (shown as a skeleton, never as "Circle 3"). */
function knownRoomName(id: string): string | null {
  return me?.circles.find((c) => c.id === id)?.name ?? (demo?.circle?.circle_id === id ? demo.circle.name : null)
}
function roomName(id: string): string {
  return knownRoomName(id) ?? `Circle ${id}`
}
const skeleton = () => el('span', { className: 'skeleton-line', ariaLabel: 'Loading' })

function tierOf(account: string): Tier | null {
  return demo?.passports.find((p) => p.owner_id === account)?.display_tier ?? null
}

function renderRooms(): void {
  const query = $<HTMLInputElement>('#chat-search').value.trim().toLowerCase()
  const ids = new Set<string>([...(me?.circles ?? []).map((c) => c.id), circleId])
  const rooms = [...ids].filter((id) => !query || (knownRoomName(id) ?? '').toLowerCase().includes(query))
  $('#room-list').replaceChildren(...(rooms.length ? rooms.map((id) => {
    const msgs = chatMessages.get(id) ?? []
    const last = msgs[msgs.length - 1]
    const unread = msgs.filter((m) => m.id > (chatSeen.get(id) ?? 0) && m.account_id !== accountId).length
    const item = el('button', { className: `room${id === chatRoom ? ' active' : ''}`, type: 'button' })
    const name = knownRoomName(id)
    const icon = el('span', { className: 'avatar avatar-room', textContent: name ? roomInitials(name) : '' })
    item.append(icon, el('span', { className: 'room-main' },
      el('span', { className: 'room-name' }, name ? el('span', { textContent: name }) : skeleton(), last ? el('time', { textContent: timeLabel(last.at) }) : ''),
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

function renderMessages(stickToBottom = true): void {
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
  // Older history is paged: ids are 1, 2, 3… per room, so a first id above 1 means there is more.
  if (msgs.length && msgs[0].id > 1) {
    const earlier = button('Load earlier messages', async () => {
      const chat = chatClient()
      if (!chat) return
      const room = chatRoom
      const older = await chat.list(room, 0, msgs[0].id)
      chatMessages.set(room, mergeMessages(chatMessages.get(room) ?? [], older))
      const keep = box.scrollHeight - box.scrollTop
      renderMessages(false)
      box.scrollTop = box.scrollHeight - keep
    }, 'ghost', 'chat')
    earlier.classList.add('load-earlier')
    box.append(earlier)
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
  if (stickToBottom && nearBottom) box.scrollTop = box.scrollHeight
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
  const name = knownRoomName(id)
  $('#room-title').replaceChildren(name ?? skeleton())
  $('#room-avatar').textContent = name ? roomInitials(name) : ''
  const members = demo?.circle?.circle_id === id ? demo.circle.member_count : null
  $('#room-sub').textContent = `Circle room${members !== null ? ` · ${members} members` : ''} · members only`
  await checkChatAccess(true)
  renderRooms()
  $('#messages').scrollTop = $('#messages').scrollHeight
  $('#view-chat').classList.remove('rooms-open')
}

async function checkChatAccess(quiet = false): Promise<void> {
  // A public copy of the app (e.g. GitHub Pages) has no sign-in server unless one is configured.
  if (!chatServerConfigured()) {
    setGate('Chat and "ask your circle" requests are switched off on this copy of the app: no chat server is configured for it. Joining, direct loans, the treasury and passports all still work.', [button('Make a direct loan instead', async () => goView('direct'), 'soft')]); renderMessages(); return
  }
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
      setGate(error instanceof ChatApiError ? errorText(error) : 'The chat server is not answering right now, so chat and loan requests are paused. Direct loans still work.',
        [button('Try again', () => checkChatAccess(false), 'soft'), button('Make a direct loan', async () => goView('direct'), 'ghost')])
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
        chatMessages.set(id, mergeMessages(have, fresh))
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
  // If an earlier try already created this loan on-chain (but the link failed), link that one instead of making another.
  const linked = new Set((chatRequests.get(card.circle_id) ?? []).map((c) => c.loan_id).filter(Boolean))
  const existing = (await readClient.loansByBorrower(accountId)).find((l) => l.circle_id === card.circle_id && l.lender_id === lenderId
    && l.principal === card.amount && l.duration_days === card.days && isWaiting(l, Date.now()) && !linked.has(l.loan_id))
  let loanId = existing?.loan_id ?? null
  if (!loanId) {
    await assertCanBorrow()
    const storage = await readClient.storageCosts()
    const raw = await client().createLoan({ circleId: card.circle_id, lenderId, amount: card.amount, durationDays: card.days, deposit: storage.create_loan })
    loanId = await newLoanId(raw, lenderId, card.amount)
  }
  if (!loanId) throw new Error('The loan was sent, but its number could not be read yet. Press the button again in a few seconds; it will not create a second loan.')
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

/**
 * Who may invite, by the frozen contract's rule (register_invite): an Active passport and
 * either the founder while still admin, or effectively Trusted. A steward of a DAO circle
 * who is not Trusted cannot invite; the contract refuses (E34), so the panel says so.
 */
function inviteRight(): { can: boolean; why: string } {
  const p = me?.passport
  const circle = demo?.circle
  if (!accountId) return { can: false, why: 'Connect your wallet to invite people.' }
  if (!p || !circle) return { can: false, why: 'Join this circle first; then you can invite people once you are Trusted.' }
  if (p.status !== 'Active') return { can: false, why: `Your card is ${p.status}, so you cannot invite right now.` }
  const founderAdmin = circle.founder_id === accountId && circle.admin_id === accountId
  if (founderAdmin) return { can: true, why: 'You founded this circle, so you can invite anyone.' }
  if (p.effective_tier === 'Trusted') return { can: true, why: 'You are Trusted in this circle, so you can invite.' }
  return { can: false, why: p.steward
    ? 'This circle is run by its DAO, and the contract only lets Trusted members invite. Repay one loan on time to turn Trusted, or ask a Trusted member for a link.'
    : 'Only the founder and Trusted members can invite in this circle. Repay one loan on time and your card turns Trusted.' }
}

function invitePanel(where: 'home' | 'members'): HTMLElement[] {
  const right = inviteRight()
  const nodes: HTMLElement[] = [el('div', { className: 'box-head' }, el('h2', { textContent: 'Invite members' }), el('p', { className: 'muted', textContent: right.why }))]
  if (!right.can) return nodes
  const result = inviteResult && inviteResult.circleId === circleId ? inviteResult : null
  if (result) {
    const link = el('textarea', { className: 'invite-link', rows: 3, readOnly: true, value: result.link, ariaLabel: 'Invite link' })
    link.addEventListener('focus', () => link.select())
    const qr = el('div', { className: 'invite-qr', ariaLabel: 'QR code of the invite link' })
    if (result.qrSvg) qr.innerHTML = result.qrSvg // SVG generated locally by the qrcode library from our own link
    const expires = new Date(result.expiresAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    nodes.push(el('div', { className: 'invite-result' },
      result.qrSvg ? qr : '',
      el('div', { className: 'invite-result-main' },
        el('p', { className: 'small', textContent: `${result.inviteeId ? `For ${result.inviteeId}. ` : 'Anyone with this link can join once. '}Works until ${expires}.` }),
        link,
        el('div', { className: 'btn-row' },
          button('Copy link', async () => { await navigator.clipboard.writeText(result.link); show('Link copied. Send it privately.', 'ok') }),
          ...(typeof navigator.share === 'function' ? [button('Share', async () => { await navigator.share({ title: 'Join my CommonCircle', url: result.link }) }, 'ghost')] : []),
          button('Make another link', async () => { inviteResult = null; renderInvitePanels() }, 'ghost')),
        el('p', { className: 'hint', textContent: 'The link holds a one-time secret that exists only on this screen: it is not saved anywhere. Copy it now; if you lose it, make another link (each costs a small NEAR storage deposit).' }))))
    return nodes
  }
  const id = `inv-${where}`
  const invitee = el('input', { id: `${id}-who`, autocomplete: 'off', placeholder: 'friend.testnet (optional)' })
  const hours = el('input', { id: `${id}-hours`, inputMode: 'numeric', value: '24' })
  const make = el('button', { className: 'btn btn-accent', type: 'button', textContent: 'Create invite link' })
  make.addEventListener('click', () => void run(make, () => createInvite(invitee.value, hours.value)))
  nodes.push(el('div', { className: 'field-row' },
    el('div', {}, el('label', { htmlFor: invitee.id, textContent: 'Their NEAR testnet account' }), invitee, el('p', { className: 'hint', textContent: 'Leave empty for a link anyone can use once.' })),
    el('div', {}, el('label', { htmlFor: hours.id, textContent: 'Link works for (hours)' }), hours)),
  el('div', { className: 'btn-row' }, make))
  return nodes
}

/** Non-members: no circle details on Overview, only what they need to join. */
function renderGateHero(): void {
  if (!demo?.circle) return
  const pending = inviteFields()
  const invitedHere = !!pending.inviteSecret && pending.circleId === circleId
  const open = canView()
  $('#circle-name').textContent = open || invitedHere ? demo.circle.name : (accountId ? 'Join or start a circle' : 'Welcome to CommonCircle')
  $('#crumb-circle').textContent = open || invitedHere ? demo.circle.name : 'No circle open'
  if (!open) { $('#demo-flag').hidden = true; $('#dao-status').hidden = true } else $('#dao-status').hidden = false
  $('#visitor-note').hidden = open && !(demoOpen && !me?.passport)
  $('#visitor-note').textContent = invitedHere ? `You were invited to ${demo.circle.name}. Join below to see its members, chat and loans.`
    : demoOpen && circleId === DEMO_CIRCLE ? 'You are viewing the public demo circle. This is public testnet data, not yours.'
      : 'Circles are private to their members in this app. Paste an invite link to join one, or start your own in Advanced tools.'
  if (!open && !invitedHere && circleId === DEMO_CIRCLE) {
    $('#visitor-note').append(' ', el('button', { className: 'btn btn-ghost btn-sm', type: 'button', textContent: 'View the public demo circle', onclick: () => { demoOpen = true; renderAll() } }))
  }
}

/** Invitations page. Only shows the form when the contract would let this account invite. */
let invitePanelKey = ''
function renderInvitePanels(): void {
  // Rebuild only when something the panel shows changes, so a background refresh never clears typing.
  const right = inviteRight()
  const key = JSON.stringify([accountId, circleId, right.can, right.why, inviteResult?.link ?? ''])
  if (key === invitePanelKey) return
  invitePanelKey = key
  $('#members-invite').replaceChildren(...invitePanel('members'))
}

/* ---------- overview, passport, evidence ---------- */

/** A passport card picture, or a placeholder when its embedded image is unsafe to decode (red-team finding 1). */
function cardImage(svg: string | null, alt: string): HTMLElement | null {
  if (!svg) return null
  const check = checkCardSvg(svg)
  if (!check.ok) return el('p', { className: 'card-blocked', textContent: `Card picture not shown: ${check.reason}.` })
  return el('img', { alt, src: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })) })
}

function tile(label: string, value: string | null, note = '', cls = ''): HTMLElement {
  // null = could not be read: say so, never show a made-up zero.
  return el('div', { className: `tile ${cls}${value === null ? ' unavailable' : ''}` },
    el('p', { className: 'tile-label', textContent: label }),
    el('p', { className: 'tile-value', textContent: value ?? 'Unavailable' }),
    note ? el('p', { className: 'tile-note', textContent: note }) : '')
}

const usdText = (v: string | null) => (v === null ? null : `${formatUsdc(v)} USDC`)

/** Overview numbers, all from testnet views. Loading and failure never show a misleading 0. */
function renderStats(): void {
  const grid = $('#stats-grid')
  if (loadError && !demo) {
    grid.replaceChildren(el('div', { className: 'tile tile-error' }, el('p', { textContent: `Could not read testnet: ${loadError}` }), button('Retry', refreshAll, 'ghost')))
    renderCustody(); renderTrust(); renderDaoSummary(); renderQuick()
    return
  }
  if (!demo?.circle) {
    grid.replaceChildren(...Array.from({ length: 6 }, () => el('div', { className: 'tile skeleton' }, el('p', { className: 'tile-label', textContent: 'Loading…' }), el('p', { className: 'tile-value', textContent: '0' }))))
    renderCustody(); renderTrust(); renderDaoSummary(); renderQuick()
    return
  }
  const st = circleStats(demo.loans, demo.passports)
  const repaidUsdc = demo.loans.filter((l) => l.state === 'Repaid').reduce((sum, l) => sum + BigInt(l.principal), 0n).toString()
  const lentUsdc = demo.loans.filter((l) => l.funded_at !== null).reduce((sum, l) => sum + BigInt(l.principal), 0n).toString()
  const waiting = demo.loans.filter((l) => isWaiting(l, Date.now())).length
  const repaidLoans = demo.loans.filter((l) => l.state === 'Repaid')
  const onTimeLoans = repaidLoans.filter((l) => l.repaid_on_time === true).length
  const lateLoans = repaidLoans.filter((l) => l.repaid_on_time === false).length
  const forgiven = repaidLoans.filter((l) => l.repaid_on_time === false && l.flag_cleared).length
  const stale = isStale(net, Date.now()) ? ' (stale)' : ''
  $('#stats-note').textContent = `From the contract's views on NEAR testnet${net.lastOkAt ? `, read ${new Date(net.lastOkAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}${stale}` : ''}.`
  grid.replaceChildren(
    tile('Members', String(st.members), `${st.trusted} Trusted`),
    tile('Loans in this circle', String(st.totalLoans), `${st.funded} funded · ${waiting} waiting for a lender`),
    tile('Lent so far', `${formatUsdc(lentUsdc)} USDC`, `${st.repaid} repaid (${formatUsdc(repaidUsdc)} USDC): ${onTimeLoans} on time, ${lateLoans} late${forgiven ? `, ${forgiven} late mark${forgiven > 1 ? 's' : ''} forgiven` : ''}`),
    tile('Out right now', `${formatUsdc(st.outstanding)} USDC`, `${st.active} active loan${st.active === 1 ? '' : 's'}`),
    tile('Overdue', String(st.overdue), st.overdue ? 'Trusted perks paused for those borrowers' : 'none', st.overdue ? 'warn' : ''),
    tile('Circle treasury', demo.circle.treasury_id ? usdText(balances.dao) : 'No DAO', demo.circle.treasury_id ? `${memberLabel(demo.circle.treasury_id)} · separate from loans` : 'The founder runs this circle'),
  )
  renderCustody(); renderTrust(); renderDaoSummary(); renderQuick()
}

/** Zero custody, with the live balance of the loan contract (never mixed with the DAO's). */
function renderCustody(): void {
  const custody = $('#custody')
  const value = balances.contract
  const zero = value === '0'
  custody.className = `card custody ${value === null ? '' : zero ? 'ok' : 'warn'}`
  custody.replaceChildren(
    el('p', { className: 'tile-label', textContent: 'Loan contract USDC balance (zero custody)' }),
    el('p', { className: 'custody-value', textContent: !demo ? '…' : value === null ? 'Unavailable' : `${formatUsdc(value)} USDC` }),
    el('div', { className: 'mini-flow', ariaLabel: 'Lender to contract check to borrower' }, el('span', { textContent: 'Lender' }), el('i', { textContent: '→' }), el('span', { textContent: 'Contract checks' }), el('i', { textContent: '→' }), el('span', { textContent: 'Borrower' })),
    el('p', { className: 'custody-text', textContent: !demo ? 'Reading the balance…'
      : value === null ? 'Could not read the balance right now. This is not a zero.'
        : zero ? `No pooled pot: funding passes from the lender through the contract's checks to the borrower in one transaction, and failed paths refund the lender. Live balance of ${config.contractId}${isStale(net, Date.now()) ? ' (stale)' : ''}.`
          : 'The contract holds USDC right now. It should be 0 at rest; a transfer may be in flight. Refresh in a moment.' }),
    el('button', { className: 'btn btn-ghost btn-sm', type: 'button', textContent: 'Network details', onclick: () => goView('network') }))
}

function renderTrust(): void {
  const box = $('#trust-summary')
  const passports = (demo?.passports ?? []).filter((p) => p.status === 'Active')
  if (!demo?.circle) { box.replaceChildren(el('h2', { textContent: 'Trust in this circle' }), el('p', { className: 'muted', textContent: 'Loading…' })); return }
  const trusted = passports.filter((p) => p.effective_tier === 'Trusted').length
  const onTime = passports.reduce((s, p) => s + p.on_time_count, 0)
  const late = passports.reduce((s, p) => s + p.late_count, 0)
  const pct = (n: number, d: number) => `${d ? Math.round((n / d) * 100) : 0}%`
  const bar = (n: number, d: number) => { const b = el('div', { className: 'bar' }, el('span')); (b.firstChild as HTMLElement).style.width = pct(n, d); return b }
  box.replaceChildren(
    el('div', { className: 'section-head row' }, el('h2', { textContent: 'Trust in this circle' }), el('button', { className: 'btn btn-ghost btn-sm', type: 'button', textContent: 'Members', onclick: () => goView('members') })),
    el('div', { className: 'trust-bars' },
      el('p', { className: 'small', textContent: `${trusted} of ${passports.length} members are Trusted` }), bar(trusted, passports.length),
      el('p', { className: 'small', textContent: `Passports record ${onTime} on-time and ${late} late repayment${late === 1 ? '' : 's'}` }), bar(onTime, onTime + late)),
    el('p', { className: 'hint', textContent: 'A late mark the circle\'s DAO forgives by vote is removed from the passport, so passport counts can be lower than the loan list.' }),
    el('p', { className: 'hint', textContent: 'Reputation counts only inside this circle. Accounts that cooperate can build it between themselves; the minimums slow that down but do not prove they are different people.' }))
}

function renderDaoSummary(): void {
  const box = $('#dao-summary')
  const circle = demo?.circle
  if (!circle) { box.hidden = true; return }
  box.hidden = false
  if (!circle.treasury_id) {
    box.replaceChildren(el('h2', { textContent: 'Circle treasury' }), el('p', { className: 'muted', textContent: 'No DAO is attached yet: the founder administers this circle. A DAO treasury can be attached later.' }))
    return
  }
  const verified = !!demo?.dao?.verified
  box.replaceChildren(
    el('div', { className: 'section-head row' }, el('h2', { textContent: 'Circle treasury' }), el('button', { className: 'btn btn-ghost btn-sm', type: 'button', textContent: 'Treasury', onclick: () => goView('treasury') })),
    el('dl', { className: 'kv' },
      el('dt', { textContent: 'DAO' }), el('dd', {}, el('code', { textContent: circle.treasury_id })),
      el('dt', { textContent: 'Holds' }), el('dd', { textContent: usdText(balances.dao) ?? 'Unavailable (could not read)' }),
      el('dt', { textContent: 'Check' }), el('dd', { className: verified ? 'net-ok' : 'net-bad', textContent: verified ? 'DAO verified by CommonCircle frontend trust checks' : 'Did not pass this app\'s DAO trust checks' })))
}

type Quick = { label: string; sub: string; icon: string; go: () => void; primary?: boolean }
const QI = {
  ask: '<path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>',
  direct: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  repay: '<path d="M3 7h18v12H3zM12 10v6M9 13h6"/>',
  invite: '<path d="M15 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM3 21a8 8 0 0 1 13-6.2M19 14v6M16 17h6"/>',
  wallet: '<path d="M3 7h18v12H3zM16 13h2"/>',
  join: '<path d="M10 17l5-5-5-5M15 12H3M21 3v18"/>',
  passport: '<path d="M5 3h14v18H5zM9 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0M8 16h8"/>',
}

/** The one or two things this account can do next, from real state only. */
function renderQuick(): void {
  const items: Quick[] = []
  const member = !!me?.passport && me.passport.status === 'Active'
  const funded = me?.loans.find((l) => l.state === 'Funded')
  const forMe = accountId && me ? requestsForLender(me.lent, accountId, Date.now()) : []
  if (!accountId) items.push({ label: 'Connect wallet', sub: 'NEAR testnet', icon: QI.wallet, go: () => toggleAccountMenu($('#head-connect')), primary: true })
  else if (!member) items.push({ label: 'Join with an invite', sub: 'Paste your link above', icon: QI.join, go: () => { $<HTMLInputElement>('.paste-input')?.focus() }, primary: true })
  if (funded) items.push({ label: `Repay ${formatUsdc(funded.outstanding)} USDC`, sub: `Loan #${funded.loan_id}`, icon: QI.repay, go: () => void run(null, () => repay(funded)), primary: true })
  if (forMe.length) items.push({ label: `${forMe.length} request${forMe.length > 1 ? 's' : ''} for you`, sub: 'Review and fund', icon: QI.repay, go: () => $('#for-you').scrollIntoView({ behavior: 'smooth' }), primary: !funded })
  if (member) {
    items.push({ label: 'Ask your circle', sub: 'Post in the chat', icon: QI.ask, go: () => { goView('chat'); $('#ask-panel').hidden = false; checkAsk() }, primary: !funded && !forMe.length })
    items.push({ label: 'Ask one member', sub: 'Direct loan', icon: QI.direct, go: () => goView('direct') })
    if (inviteRight().can) items.push({ label: 'Invite someone', sub: 'One-time link', icon: QI.invite, go: () => goView('invites') })
    items.push({ label: 'My passport', sub: me?.passport?.display_tier ?? '', icon: QI.passport, go: () => { passportAccount = accountId; renderPassport(); goView('passport') } })
  }
  $('#quick-actions').replaceChildren(...items.slice(0, 4).map((q) => {
    const b = el('button', { className: `quick-btn${q.primary ? ' primary' : ''}`, type: 'button' })
    const icon = el('span', { className: 'qi', ariaHidden: 'true' })
    icon.innerHTML = `<svg viewBox="0 0 24 24">${q.icon}</svg>` // static icon markup defined above
    b.append(icon, el('span', {}, el('strong', { textContent: q.label }), q.sub ? el('small', { textContent: q.sub }) : ''))
    b.addEventListener('click', q.go)
    return b
  }))
}

const activityTime = (at: number) => new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function activityItems(limit: number): HTMLLIElement[] {
  const items = demo ? recentActivity(demo.loans, demo.passports, formatUsdc, memberLabel, limit) : []
  if (!items.length) return [el('li', { className: 'empty', textContent: demo ? 'No activity yet.' : loadError ? 'Unavailable: testnet could not be read.' : 'Loading…' })]
  const loanState = (id?: string) => demo?.loans.find((l) => l.loan_id === id)
  return items.map((a) => {
    const loan = loanState(a.loanId)
    const label = loan ? (loan.state === 'Repaid' && loan.repaid_on_time === false ? 'Repaid late' : loan.state === 'Open' && !isWaiting(loan, Date.now()) ? 'Expired' : loan.state) : ''
    return el('li', { className: `act act-${a.kind}` },
      el('span', { className: 'act-dot', ariaHidden: 'true' }),
      el('span', { className: 'act-text', textContent: a.text }),
      el('span', { className: 'act-meta' },
        el('time', { textContent: activityTime(a.at) }),
        a.loanId ? el('span', { textContent: `Loan #${a.loanId}` }) : '',
        label ? el('span', { className: `state state-${label.split(' ')[0]}`, textContent: `now ${label}` }) : '',
        el('a', { href: `${config.explorerUrl}/address/${a.account}`, target: '_blank', rel: 'noopener', textContent: `${memberLabel(a.account)} on NearBlocks` })))
  })
}

function renderActivity(): void {
  $<HTMLAnchorElement>('#activity-link').href = `${config.explorerUrl}/address/${config.contractId}`
  $('#activity').replaceChildren(...activityItems(6))
  $('#activity-full').replaceChildren(...activityItems(200))
}

/** My Passport (connected member) or Member passport (anyone else, read-only). Never mixes the two. */
function renderPassport(): void {
  const select = $<HTMLSelectElement>('#pp-account')
  const passports = demo?.passports ?? []
  const mine = accountId && passports.some((p) => p.owner_id === accountId) ? accountId : ''
  if (!passportAccount || !passports.some((p) => p.owner_id === passportAccount)) passportAccount = mine || passports.find((p) => p.display_tier === 'Trusted')?.owner_id || passports[0]?.owner_id || ''
  select.replaceChildren(...passports.map((p) => el('option', { value: p.owner_id, selected: p.owner_id === passportAccount, textContent: `${p.owner_id === accountId ? 'Me · ' : ''}${memberLabel(p.owner_id)} · ${p.display_tier}` })))
  const body = $('#passport-body')
  const p = passports.find((x) => x.owner_id === passportAccount)
  const isMine = !!p && p.owner_id === accountId
  $('#pp-title').textContent = isMine || !p ? 'My passport' : 'Member passport'
  $('#crumb-view').textContent = view === 'passport' ? (isMine || !p ? 'My passport' : 'Member passport') : $('#crumb-view').textContent
  const card = demo?.cards.find((c) => c.passport.owner_id === passportAccount)
  if (!p || !demo?.circle) {
    body.replaceChildren(el('div', { className: 'card' }, el('p', { className: 'muted', textContent: demo ? 'No passports in this circle yet.' : loadError ? 'Unavailable: testnet could not be read.' : 'Loading…' })))
    return
  }
  const params = demo.circle.params
  const prog = trustedProgress(p, params)
  const limit = borrowLimit(params, p, demo.config.hard_loan_cap)
  const elig = treasuryEligibility(p, demo.circle.treasury_lending_enabled, !!demo.dao?.verified)
  const founderAdmin = demo.circle.founder_id === p.owner_id && demo.circle.admin_id === p.owner_id
  const canInvite = p.status === 'Active' && (founderAdmin || p.effective_tier === 'Trusted')
  const art = el('figure', { className: 'pp-card' })
  const picture = cardImage(card?.svg ?? null, `${p.owner_id} passport`)
  art.append(picture ?? el('p', { className: 'card-blocked', textContent: 'Passport picture unavailable right now.' }))
  art.append(el('figcaption', { className: 'small' }, `Token ${p.token_id} · NEP-171 · non-transferable (nft_transfer always fails) · `,
    el('a', { href: `${config.explorerUrl}/address/${p.owner_id}`, target: '_blank', rel: 'noopener', textContent: 'owner on NearBlocks' })))
  const who = el('div', { className: 'pp-who' }, avatar(p.owner_id), el('div', { className: 'grow' },
    el('p', { className: 'small muted', textContent: isMine ? 'Your account' : 'Viewing another member (read-only)' }),
    el('p', { className: 'acct-full', textContent: p.owner_id })), badge(p.display_tier), p.steward ? badge('Steward') : '')
  const statsList = el('dl', { className: 'pp-stats' },
    ...[['Circle', demo.circle.name], ['Passport token', p.token_id], ['Tier', p.tier], ['Effective tier', p.effective_tier], ['Status', p.status],
      ['On-time repayments', String(p.on_time_count)], ['Late repayments', String(p.late_count)], ['Counted toward Trusted', `${p.qualifying_count} of ${params.trusted_threshold}`],
      ['Different lenders', `${p.distinct_lenders} (needs ${params.min_distinct_lenders})`], ['Loan limit', `${formatUsdc(limit.min)}–${formatUsdc(limit.max)} USDC`],
      ['Open loans', `${p.open_loans} of ${limit.openAllowed} allowed`], ['Overdue loans', String(p.overdue_loans)],
      ['Can invite', canInvite ? 'Yes' : 'No'], ['Treasury loans', elig.eligible ? 'Eligible' : 'Not eligible']]
      .map(([k, v]) => el('div', {}, el('dt', { textContent: k }), el('dd', { textContent: v }))))
  const need = prog.trusted ? null : [
    `${prog.qualifying} of ${prog.threshold} on-time repayment${prog.threshold === 1 ? '' : 's'} that count`,
    `${prog.lenders} of ${prog.minLenders} different lender${prog.minLenders === 1 ? '' : 's'}`,
    `a loan counts if it is at least ${formatUsdc(params.qualifying_min_amount)} USDC for ${params.qualifying_min_days}+ day${params.qualifying_min_days === 1 ? '' : 's'}, repaid by its due time`,
  ]
  const diffs = demoDifferences(params)
  const side = el('div', { className: 'pp-side' },
    el('div', { className: 'card' }, who, isMine ? '' : el('p', { className: 'viewing-other', textContent: `These are ${memberLabel(p.owner_id)}'s numbers, not yours.${mine ? ' Pick "Me" above to see your own passport.' : ''}` }), statsList),
    el('div', { className: 'card' }, el('h2', { textContent: prog.trusted ? 'Trusted' : 'Road to Trusted' }),
      prog.trusted ? el('p', { textContent: p.perks_paused ? 'Trusted, but perks are paused by an overdue loan until it is repaid or the stewards clear the flag.' : 'Earned by on-time repayments. The tier never goes down; an overdue loan only pauses its perks.' })
        : el('ul', { className: 'pp-need' }, ...need!.map((t) => el('li', { textContent: t }))),
      progressNode(p) ?? '',
      diffs.length ? el('p', { className: 'demo-flag', textContent: `This circle uses demo settings: ${diffs.join('; ')}.` }) : ''),
    el('div', { className: 'card' }, el('h2', { textContent: 'What this passport unlocks' }),
      el('ul', { className: 'pp-need' }, ...privileges(p, params, demo.config.hard_loan_cap, formatUsdc).map((t) => el('li', { textContent: t }))),
      el('p', { className: `eligibility ${elig.eligible ? 'ok' : ''}`, textContent: `Treasury: ${elig.reason}` })))
  body.replaceChildren(art, side)
}

const TRACKS: Array<{ track: string; heading: string; problem: string; does: string; tests: string; reproduce: string; limits: string }> = [
  {
    track: 'NFTs That Do Something', heading: 'Your repayment history becomes your financial passport.',
    problem: 'People with no credit file have no way to carry proof that they repay.',
    does: 'Each member holds a non-transferable NEP-171 passport. On-time repayments that qualify move it from Member to Trusted; an overdue loan pauses Trusted perks. The tier sets the loan limit, the number of open loans, who may invite, and treasury access. The card art is drawn on-chain from the circle theme and the record.',
    tests: 'readme_checks::try_nft_transfer_on_a_passport, readme_checks::create_a_loan_naming_a_non_member (CI report)',
    reproduce: 'Open My Passport; or rows f1-tier-flip and f1-web-repay-tier: the repayment transaction emits tier_changed Member → Trusted.',
    limits: 'Reputation is local to one circle. Cooperating accounts can lend to each other to farm it; min_distinct_lenders and the qualifying minimums slow that down but are not Sybil resistance.',
  },
  {
    track: 'Social Money', heading: 'Borrow when you need it. Build trust when you repay.',
    problem: 'Rotating savings pay you on a schedule, not when you need the money.',
    does: 'Members ask the circle (with a reason) in the chat, any member can offer to lend, and loans go straight between them. A Sputnik DAO is the circle\'s treasury: a Trusted, non-steward member asks, both stewards approve, the DAO funds, and repayment returns to the DAO. Stewards cannot borrow from it; the DAO can forgive a late flag by vote.',
    tests: 'sandbox_sputnik (2 tests), readme_checks::treasury_loan_for_a_steward_or_with_fewer_than_two_stewards, redteam::rt_dao_cannot_take_a_passport_or_count_as_steward',
    reproduce: 'Open Treasury for proposals 0–3, or rows f2-proposal-funds-loan and f2-treasury-repaid.',
    limits: 'The app, not the contract, checks that the treasury is a keyless Sputnik DAO. Both steward accounts are run by the same testnet operator, so the votes do not prove two people. Two NEAR accounts are not two humans.',
  },
  {
    track: 'Open Innovation', heading: 'Loans move directly between people. The lending contract does not hold a pooled pot.',
    problem: 'A shared pot is a honeypot and needs a custodian.',
    does: 'The lender sends USDC with ft_transfer_call; the contract checks the loan, forwards the money to the borrower in the same transaction and records it. If anything fails (borrower not set up for USDC, wrong lender, wrong token, wrong amount, too little gas) the lender is refunded. The contract\'s USDC balance is 0 at rest.',
    tests: 'sandbox_f0 (refund proofs), readme_checks::fund_to_an_unregistered_borrower, redteam::rt_contract_never_subsidises_storage (CI report)',
    reproduce: 'The live balance above; rows f0-refund (loan_funding_failed, lender refunded), f0-low-gas-real-usdc (E60, refunded), f0-zero-balance.',
    limits: 'Testnet only, unsecured loans: repayment cannot be forced. The contract account still has a full-access key until ship, so its code can still be upgraded.',
  },
]

function renderEvidence(): void {
  const status = evidenceFile as unknown as EvidenceStatus
  const total = status.claims.length
  const passed = status.claims.filter((c) => c.status === 'PASS').length
  $('#evidence-generated').textContent = `Claims run ${new Date(status.generated_at).toLocaleString()}: ${passed} of ${total} pass. That time is when the evidence was generated, not a live chain check (the live balance below is).`
  const zero = balances.contract === null ? 'unavailable' : `${formatUsdc(balances.contract)} USDC`
  $('#tracks').replaceChildren(...trackSummaries(status, TRACKS.map((t) => t.track)).map((sum) => {
    const t = TRACKS.find((x) => x.track === sum.track)!
    const claims = sum.claims.map((c) => {
      const ref = c.reference as { explorer?: string; tx_hash?: string; method?: string; account_id?: string; report?: string; snapshot?: string; network?: string }
      const kind = c.kind === 'tx' ? 'Transaction' : c.kind === 'view' ? 'Contract view' : 'Automated test'
      const evidence = c.kind === 'tx' && ref.explorer ? el('a', { href: ref.explorer, target: '_blank', rel: 'noopener', textContent: `${ref.tx_hash ?? 'transaction'} on NearBlocks` })
        : c.kind === 'view' ? el('code', { textContent: `${ref.method ?? 'view'}(${ref.account_id ?? ''})` })
          : el('span', { textContent: ref.report ?? 'CI test report' })
      return el('details', { className: 'claim' },
        el('summary', {}, el('span', { className: 'claim-id', textContent: c.id }), el('span', { className: `state state-${c.status}`, textContent: c.status })),
        el('dl', { className: 'kv' },
          el('dt', { textContent: 'Feature' }), el('dd', { textContent: c.feature }),
          el('dt', { textContent: 'Type' }), el('dd', { textContent: kind }),
          el('dt', { textContent: 'Network' }), el('dd', { textContent: ref.network ?? 'NEAR testnet' }),
          el('dt', { textContent: 'Reference' }), el('dd', {}, evidence),
          el('dt', { textContent: 'Result' }), el('dd', { textContent: c.reason || c.status })))
    })
    return el('section', { className: 'card track' },
      el('div', { className: 'track-head' },
        el('div', {}, el('p', { className: 'eyebrow', textContent: sum.track }), el('h2', { textContent: t.heading })),
        el('div', { className: `track-status ${sum.status === 'PASS' ? 'ok' : 'bad'}` }, el('strong', { textContent: sum.status }), el('span', { textContent: `${sum.pass} of ${sum.total} claims pass${sum.fail ? ` · ${sum.fail} fail` : ''}` }))),
      sum.track === 'Open Innovation' ? el('p', { className: `custody-inline ${balances.contract === '0' ? 'ok' : ''}`, textContent: `Live chain check${net.lastOkAt ? ` (${new Date(net.lastOkAt).toLocaleTimeString()})` : ''}: the loan contract holds ${zero}.` }) : '',
      el('dl', { className: 'track-facts' },
        ...[['Problem', t.problem], ['What CommonCircle does', t.does], ['Automated tests', t.tests], ['Reproduce', t.reproduce], ['Limits we disclose', t.limits]]
          .map(([k, v]) => el('div', {}, el('dt', { textContent: k }), el('dd', { textContent: v })))),
      el('div', { className: 'claims' }, ...claims))
  }))
}

/** NEAR network details: where data comes from and how fresh it is. */
function renderNetwork(): void {
  const h = rpcHealth()
  const snapshot = demo
  const row = (k: string, v: Node | string) => [el('dt', { textContent: k }), el('dd', {}, v)]
  const code = (t: string) => el('code', { textContent: t })
  const link = (href: string, t: string) => el('a', { href, target: '_blank', rel: 'noopener', textContent: t })
  const state = describeNet(net, Date.now())
  const cls = state.tone === 'ok' ? 'net-ok' : state.tone === 'bad' ? 'net-bad' : 'net-warn'
  $('#network-body').replaceChildren(
    el('div', { className: 'card' }, el('h2', { textContent: 'Connection' }), el('dl', { className: 'kv' },
      ...row('Network', 'NEAR testnet (no real money)'),
      ...row('Status', el('span', { className: cls, textContent: state.pill })),
      ...row('Last good read', net.lastOkAt ? new Date(net.lastOkAt).toLocaleString() : 'none yet'),
      ...row('RPC in use', code(h.endpoint)),
      ...row('Fallbacks', el('span', {}, ...TESTNET_RPCS.flatMap((u, i) => (i ? [', ', code(u)] : [code(u)])))),
      ...(net.partial.length ? row('Could not read', net.partial.join(', ')) : []),
      ...(h.lastError ? row('Last RPC error', h.lastError) : [])),
    el('button', { className: 'btn btn-ghost btn-sm', type: 'button', textContent: 'Refresh now', onclick: () => void run(null, refreshAll) })),
    el('div', { className: 'card' }, el('h2', { textContent: 'Contracts and tokens' }), el('dl', { className: 'kv' },
      ...row('Circle contract', link(`${config.explorerUrl}/address/${config.contractId}`, config.contractId)),
      ...row('Interface', snapshot ? code(snapshot.config.interface_version) : '…'),
      ...row('USDC token', snapshot ? link(`${config.explorerUrl}/address/${snapshot.config.usdc_id}`, snapshot.config.usdc_id) : '…'),
      ...row('Loan contract USDC', usdText(balances.contract) ?? 'Unavailable'),
      ...row('Circle', snapshot?.circle ? `${snapshot.circle.name} (#${snapshot.circle.circle_id})` : '…'),
      ...row('Circle admin', snapshot?.circle ? code(snapshot.circle.admin_id) : '…'),
      ...row('Contract keys', 'The contract account still has a full-access key, so its code can be upgraded. It is not locked.'))),
    el('div', { className: 'card' }, el('h2', { textContent: 'DAO treasury' }), el('dl', { className: 'kv' },
      ...row('DAO', snapshot?.circle?.treasury_id ? link(`${config.explorerUrl}/address/${snapshot.circle.treasury_id}`, snapshot.circle.treasury_id) : 'none'),
      ...row('Treasury USDC', snapshot?.circle?.treasury_id ? (usdText(balances.dao) ?? 'Unavailable') : '—'),
      ...row('Trust check', snapshot?.dao ? (snapshot.dao.verified ? 'DAO verified by CommonCircle frontend trust checks' : snapshot.dao.message) : '—'),
      ...row('Code hash', snapshot?.dao?.codeHash ? code(snapshot.dao.codeHash) : '—'),
      ...row('Access keys', snapshot?.dao ? String(snapshot.dao.accessKeyCount ?? 'unknown') : '—'),
      ...row('Who checks', 'This app (frontend). The circle contract does not verify which DAO is attached.'))),
    el('div', { className: 'card' }, el('h2', { textContent: 'Circle rules (read from the contract)' }), snapshot?.circle ? el('dl', { className: 'kv' },
      ...row('A "day" lasts', loanLengthText(1, snapshot.circle.params.day_length_sec)),
      ...row('Funding window', formatDuration(BigInt(snapshot.circle.params.funding_window_sec))),
      ...row('Trusted after', `${snapshot.circle.params.trusted_threshold} qualifying on-time repayment${snapshot.circle.params.trusted_threshold === 1 ? '' : 's'}`),
      ...row('Different lenders', String(snapshot.circle.params.min_distinct_lenders)),
      ...row('Member limit', `${formatUsdc(snapshot.circle.params.min_amount)}–${formatUsdc(snapshot.circle.params.member_max_amount)} USDC`),
      ...row('Trusted limit', `up to ${formatUsdc(snapshot.circle.params.trusted_max_amount)} USDC`),
      ...row('Settings', demoDifferences(snapshot.circle.params).length ? `Demo (faster than standard): ${demoDifferences(snapshot.circle.params).join('; ')}` : 'Standard')) : el('p', { className: 'muted', textContent: 'Loading…' })),
  )
}

/** Account & network settings: wallet, chat session, chat server health. */
function renderSettings(): void {
  $('#settings-wallet-actions').replaceChildren(...(accountId
    ? [button('Copy account ID', async () => { await navigator.clipboard.writeText(accountId); show(`${accountId} (copied)`, 'ok') }, 'ghost'), button('Switch account', switchWallet, 'ghost', 'wallet'), button('Disconnect', disconnectWallet, 'ghost')]
    : connectButtons()))
  const s = session()
  const exp = s ? tokenExpiry(s.token) : null
  $('#settings-session').textContent = !accountId ? 'Connect a wallet first.'
    : s && s.accountId === accountId ? `Signed in to chat as ${s.accountId}${exp ? ` until ${exp.toLocaleString()}` : ''}.` : 'Not signed in to chat in this browser.'
  $('#settings-chat').replaceChildren(
    el('dt', { textContent: 'Server' }), el('dd', {}, el('code', { textContent: config.authUrl })),
    el('dt', { textContent: 'Configured' }), el('dd', { textContent: chatServerConfigured() ? 'Yes' : 'No (chat is off on this copy)' }),
    el('dt', { textContent: 'Privacy' }), el('dd', { textContent: 'Members only, checked on-chain. Not end-to-end encrypted; the server operator can read messages.' }),
    el('dt', { textContent: 'Delivery' }), el('dd', { textContent: 'Checks for new messages every 3 s while the chat is open (polling, not instant push).' }),
    el('dt', { textContent: 'Health' }), el('dd', { id: 'settings-health', textContent: 'Not checked yet.' }))
}

/** When the chat session token expires (read from its payload; the server checks the signature). */
function tokenExpiry(token: string): Date | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    return payload.exp ? new Date(payload.exp * 1000) : null
  } catch { return null }
}

async function checkServer(): Promise<void> {
  const out = $('#settings-health')
  out.textContent = 'Checking… (a sleeping free server can take up to a minute)'
  const result = await chatServerHealth(config.authUrl, 70_000)
  out.textContent = !result.reachable ? `Not reachable after ${Math.round(result.ms / 1000)} s.`
    : result.health?.ok ? `OK in ${(result.ms / 1000).toFixed(1)} s · storage ${result.health.store}${result.health.shared ? ' (shared, durable)' : result.health.durable ? ' (single process)' : ' (memory)'} · delivery ${result.health.delivery ?? 'polling'}`
      : `Answered but not healthy: ${result.health?.detail ?? 'unknown'}`
}

/* ---------- reading state ---------- */

async function refreshMe(): Promise<void> {
  if (!accountId) { me = null; renderAll(); return }
  const mine = epoch
  const account = accountId
  try {
    const usdc = new CircleClient(config.rpcUrl, await getUsdcId())
    void loadWalletBalance(account).catch(() => undefined)
    const [passport, registration, loans, lent, tokens] = await Promise.all([
      readClient.passportFor(circleId, account),
      usdc.view<unknown>('storage_balance_of', { account_id: account }),
      allPages((fromIndex) => readClient.loansByBorrower(account, { fromIndex, limit: 50 })),
      allPages((fromIndex) => readClient.loansByLender(account, { fromIndex, limit: 50 })),
      readClient.nftTokensForOwner(account, null, 50).catch(() => []),
    ])
    const ids = [...new Set(tokens.map((t) => t.token_id.split(':')[0]))]
    const circles = await Promise.all(ids.map(async (id) => ({ id, name: (await readClient.getCircle(id).catch(() => null))?.name ?? `Circle ${id}` })))
    // The account (or circle) changed while we were reading: these answers belong to someone else.
    if (mine !== epoch || account !== accountId) return
    // A wallet that belongs to circles but not to the one on screen opens its own circle (once).
    if (!passport && circles.length && autoSwitched !== account && !inviteFields().inviteSecret) {
      autoSwitched = account
      $<HTMLInputElement>('#demo-circle-id').value = circles[0].id
      window.setTimeout(() => void refreshAll().then(() => show(`Showing your own circle: ${circles[0].name}.`, 'ok')).catch(() => undefined), 0)
      return
    }
    me = {
      passport, registered: !!registration, signedIn: session()?.accountId === account, circles,
      loans: loans.filter((l) => l.circle_id === circleId),
      lent: lent.filter((l) => l.circle_id === circleId),
    }
  } catch (error) {
    if (mine !== epoch) return
    const text = errorText(error)
    if (isNetworkText(text)) netTrouble(text)
    else show(`Could not read your account. ${text}`, 'bad', 'retry', refreshMe)
  }
  const chatForHome = chatClient()
  if (chatForHome && me?.passport) await loadRequests(chatForHome, circleId)
  if (mine !== epoch) return
  renderAll()
  await Promise.all([
    loadMyCard().catch(() => {}),
    loadPositions().catch(() => {}),
    renderTreasury().catch(() => {}),
    view === 'chat' ? checkChatAccess(true).catch(() => {}) : Promise.resolve(),
  ])
  if (view !== 'chat') stopChatPolling()
}

/** Re-read everything. Concurrent callers (Retry, timers, after a transaction) share one refresh. */
async function refreshAll(): Promise<void> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      await loadDemo()
      await refreshMe()
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/* ---------- rendering ---------- */

function renderAll(): void {
  renderStats()
  renderActivity()
  renderPassport()
  renderForYou()
  renderOpenRequests()
  renderInvitePanels()
  renderJourney()
  renderMembers()
  renderLoansTable()
  renderSidebar()
  renderRooms()
  showView()
  renderGateHero()
  if (view === 'direct') mountForm($('#loan-form-slot'), 'direct')
  if (view === 'network') renderNetwork()
  if (view === 'settings') renderSettings()
}

function renderSidebar(): void {
  // "Your circles" comes from the contract (nft_tokens_for_owner for the connected account), never from this browser.
  const mine = me?.circles ?? []
  const viewingOther = !mine.some((c) => c.id === circleId)
  $('#side-circles').replaceChildren(...mine.map(({ id, name }) => {
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
  const circleName = demo?.circle?.name ?? null
  $('#side-circles-note').textContent = !accountId ? 'Connect a wallet to see the circles you belong to.'
    : !me ? 'Reading your circles from testnet…'
      : !mine.length ? `${memberLabel(accountId)} is not in any circle yet. Paste an invite link on Overview.`
        : viewingOther && circleName ? `Now viewing ${circleName}, which you are not a member of.` : ''
  const tier = me?.passport ? `${me.passport.display_tier} · ${demo?.circle?.name ?? `circle ${circleId}`}` : accountId ? 'Not a member of this circle yet' : ''
  $('#profile-tier').textContent = tier
  $('#crumb-circle').replaceChildren(demo?.circle?.name ?? skeleton())
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

/** Why the loan form cannot be shown yet, as a full card with a way forward (never a blank page). */
function formState(title: string, text: string, actions: HTMLElement[] = []): HTMLElement {
  return el('div', { className: 'form-state' }, el('h2', { textContent: title }), el('p', { className: 'muted', textContent: text }), actions.length ? el('div', { className: 'btn-row' }, ...actions) : '')
}

/**
 * Mounted forms, per slot. A form is rebuilt only when what it depends on changes
 * (account, circle, passport, members, chain refresh failing), so a background refresh
 * never wipes what someone is typing.
 */
const formCache = new Map<string, { key: string; node: HTMLElement }>()

function formKey(): string {
  const p = me?.passport
  return JSON.stringify([accountId, circleId, !!demo?.circle, loadError && !demo ? loadError : '', !!me, p?.status, p?.effective_tier, p?.steward,
    (demo?.passports ?? []).filter((x) => x.status === 'Active').map((x) => `${x.owner_id}:${x.display_tier}:${x.on_time_count}:${x.late_count}`).join(','),
    demo?.dao?.verified, demo?.circle?.treasury_lending_enabled])
}

function mountForm(slot: HTMLElement, name: string): void {
  const key = formKey()
  const cached = formCache.get(name)
  if (cached && cached.key === key) {
    if (cached.node.parentElement !== slot) slot.replaceChildren(cached.node)
    return
  }
  const node = loanRequestForm()
  formCache.set(name, { key, node })
  slot.replaceChildren(node)
}

/**
 * The one loan form (Direct loans page and Overview step 5). Lender = a member picker
 * (label, badge, on-time/late) plus "Ask the treasury" when the spec allows it;
 * limits come from borrowLimit() only; amount and days are validated inline.
 */
function loanRequestForm(): HTMLElement {
  const id = `lf${++formSeq}`
  const circle = demo?.circle
  const passport = me?.passport ?? null
  if (!demo && loadError) return formState('Testnet could not be read', `The form needs the circle's members and limits from NEAR testnet. ${loadError}`, [button('Retry', refreshAll, 'ghost')])
  if (!circle || !demo) return formState('Loading the circle…', 'Reading members and limits from NEAR testnet.')
  if (!accountId) return formState('Connect your wallet', 'Connect a NEAR testnet wallet to ask a member for a loan. Viewing works without one.', connectButtons())
  if (!me) return formState('Reading your passport…', `Checking ${memberLabel(accountId)}'s membership in ${circle.name} on testnet.`)
  if (!passport) return formState(`You are not a member of ${circle.name} yet`, `${memberLabel(accountId)} has no passport in this circle, so the contract would refuse a loan request. Join with an invite link from the founder or a Trusted member first.`, [button('Paste an invite link', async () => { goView('home'); $<HTMLInputElement>('.paste-input')?.focus() }), button('Look at members', async () => goView('members'), 'ghost')])
  if (passport.status !== 'Active') return formState(`Your passport is ${passport.status}`, 'Only members with an active passport can borrow. Ask the circle\'s stewards for help.')
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
  if (!picker.children.length) return formState('Nobody to ask yet', 'There is no other active member in this circle yet. Invite someone you trust first.', [button('Invitations', async () => goView('invites'), 'ghost')])

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
    goView('home')
    show('Invite found. Press "Join the circle" in your steps.', 'ok')
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
    isMember ? `You are a ${passport.display_tier} of ${circleName}.`
      : passport ? `Your card is ${passport.status}. Ask the stewards for help.`
        : invite.inviteSecret ? 'You have an invite. Joining costs about 0.009 NEAR, which pays for storing your card.'
          : 'You need an invite link from the founder or a Trusted member. Paste it in "Have an invite link?" above.',
    invite.inviteSecret && !passport ? [button('Join the circle', joinInvite)] : []))
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
    open ? [button('Cancel request', () => cancelRequest(open), 'ghost')] : [], open ? undefined : (() => { const slot = el('div', { className: 'form-slot' }); mountForm(slot, 'journey'); return slot })()))
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
    const summaries = ['Wallet connected', isMember ? `joined as ${passport?.display_tier ?? 'Member'}` : 'joined', 'signed in', 'ready for USDC', 'loan received'].slice(0, folded)
    const group = el('li', { className: 'step done group' },
      el('span', { className: 'step-dot', textContent: '✓', ariaHidden: 'true' }),
      el('div', { className: 'step-text' }, el('p', { className: 'step-title', textContent: `Steps 1–${folded} done` }),
        el('p', { className: 'step-desc' }, `${summaries.join(' · ')}. `, accountChip(accountId))),
      el('div', { className: 'step-action' }, button('Switch', switchWallet, 'ghost', 'wallet')))
    steps.splice(0, folded, group)
  }
  $('#steps').replaceChildren(...steps)
  // Not a member of this circle: the paste-invite box is always on Overview, on every screen size.
  const joinBox = $('#join-box')
  joinBox.hidden = isMember || !!passport
  if (!joinBox.hidden) {
    $('#join-text').textContent = invite.inviteSecret
      ? (accountId ? 'Invite found. Press "Join the circle" in your steps below.' : 'Invite found. Connect your wallet (top right), then join.')
      : `${accountId ? `${memberLabel(accountId)} is not a member of ${circleName} yet. ` : ''}Paste the invite link you were sent to join. Opening the link in this browser works too.`
    if (invite.inviteSecret) {
      const key = `${invite.invitePublicKey}|${accountId}|${circleName}`
      if ($('#join-slot').dataset.key !== key) {
        $('#join-slot').dataset.key = key
        const status = el('p', { className: 'hint', textContent: 'Checking the invite on testnet…' })
        const actions = accountId ? [button(`Join ${circleName}`, joinInvite)] : connectButtons()
        const other = button('Use a different link', async () => {
          forgetInvite()
          for (const id of ['#circle-id', '#invite-public-key', '#invite-secret']) $<HTMLInputElement>(id).value = ''
          $('#join-slot').dataset.key = ''
          $('#join-slot').replaceChildren(pasteInviteBox())
          renderJourney()
        }, 'ghost')
        $('#join-slot').replaceChildren(el('div', { className: 'btn-row' }, ...actions, other), status)
        void readClient.getInvite(invite.invitePublicKey).then((iv) => {
          const wrongWallet = !!iv?.invitee_id && !!accountId && iv.invitee_id !== accountId
          status.textContent = !iv ? 'This invite was already used or does not exist. Ask for a new link.'
            : iv.expired ? 'This invite has expired. Ask for a new link.'
              : wrongWallet ? `This invite is only for ${iv.invitee_id}. Connect that wallet to join.`
                : `Valid invite from ${memberLabel(iv.inviter_id)}. Joining costs about 0.01 NEAR (it pays for storing your passport), so the wallet needs some testnet NEAR.`
          status.classList.toggle('bad', !iv || iv.expired || wrongWallet)
        }).catch(() => { status.textContent = 'Could not check the invite right now. You can still try to join.' })
      }
    } else if (!$('#join-slot').firstChild || $('#join-slot').dataset.key) { $('#join-slot').dataset.key = ''; $('#join-slot').replaceChildren(pasteInviteBox()) }
  }
  $('#invite-details').hidden = isMember
  $('#home-hero').classList.toggle('compact', isMember)
  // A wallet that is not a member is only looking at this circle's public, on-chain history.
  const visitor = !isMember && !!demo?.circle
  $('#hero-eyebrow').textContent = isMember ? 'Your circle' : 'Viewing a circle'
  $('#visitor-note').hidden = !visitor
  $('#visitor-note').textContent = !accountId ? 'You are viewing as a visitor. This is the circle\'s public history on testnet, not yours.'
    : `${memberLabel(accountId)} is not a member here. You are viewing this circle's public history on testnet; none of it is yours.`
  if (!$('#invites-paste').firstChild) $('#invites-paste').replaceChildren(pasteInviteBox())
  $('#journey-sub').textContent = current === -1 ? 'All done: you joined, borrowed and repaid. Your card is on the right.' : 'Follow these in order. Each one updates from the blockchain by itself.'
  tickDue()
}

function renderMembers(): void {
  const passports = demo?.passports ?? []
  const table = $('#members-table')
  const rows = passports.map((p) => el('div', { className: 'mrow' },
    el('span', { className: 'who' }, avatar(p.owner_id, 'sm'), accountChip(p.owner_id)),
    el('span', {}, badge(p.display_tier), p.steward ? ' ' : '', p.steward ? badge('Steward') : ''),
    el('span', { className: 'c-hide', textContent: p.status }),
    el('span', { className: 'c-hide', textContent: `${p.on_time_count} on time` }),
    el('span', { className: 'c-hide', textContent: `${p.late_count} late` })))
  table.replaceChildren(
    el('div', { className: 'section-head row' }, el('h2', { textContent: passports.length === 1 ? '1 member' : `${passports.length} members` }), el('span', { className: 'muted small', textContent: demo?.circle ? `${demo.circle.name} · from passports_in_circle` : '' })),
    el('div', { className: 'mtable' },
      el('div', { className: 'mrow head' }, el('span', { textContent: 'Account' }), el('span', { textContent: 'Tier' }), el('span', { textContent: 'Passport' }), el('span', { textContent: 'On time' }), el('span', { textContent: 'Late' })),
      ...(rows.length ? rows : [el('p', { className: 'muted', textContent: demo ? 'No members yet.' : loadError ? 'Unavailable: testnet could not be read.' : 'Loading…' })])))
  $('#members-invite-cta').hidden = !inviteRight().can
  const grid = $('#demo-cards')
  grid.replaceChildren()
  for (const card of demo?.cards ?? []) {
    const owner = card.passport.owner_id
    const fig = el('figure', { className: `member${owner === accountId ? ' me' : ''}` })
    const picture = cardImage(card.svg, `${owner} passport`)
    if (picture) fig.append(picture)
    fig.append(el('figcaption', {},
      el('span', { className: 'who' }, avatar(owner, 'sm'), accountChip(owner)), badge(card.passport.display_tier)),
      el('p', { className: 'member-counts', textContent: `On time ${card.passport.on_time_count} · late ${card.passport.late_count}` }),
      el('button', { className: 'btn btn-ghost btn-sm', type: 'button', textContent: owner === accountId ? 'My passport' : 'View passport', onclick: () => { passportAccount = owner; renderPassport(); goView('passport') } }))
    grid.append(fig)
  }
  if (!grid.children.length) grid.append(el('p', { className: 'muted', textContent: demo ? 'No members yet.' : 'Loading…' }))
}

function renderLoansTable(): void {
  const loans = (demo?.loans ?? []).slice().sort((a, b) => Number(b.loan_id) - Number(a.loan_id))
  const now = Date.now()
  const reasonOf = (l: LoanView) => (chatRequests.get(l.circle_id) ?? []).find((c) => c.loan_id === l.loan_id)?.note ?? ''
  const party = (account: string, treasury = false) => treasury ? who(account, 'Treasury (DAO)') : account === accountId ? who(account, 'You') : el('span', { className: 'who' }, avatar(account, 'sm'), accountChip(account))
  const status = (l: LoanView) => l.state === 'Repaid' && l.repaid_on_time === false ? (l.flag_cleared ? 'Repaid late (forgiven)' : 'Repaid late')
    : l.state === 'Open' && !isWaiting(l, now) ? 'Expired' : l.state === 'Funded' && l.overdue ? 'Overdue' : l.state
  $('#loans-count').textContent = demo ? `${loans.length} loan${loans.length === 1 ? '' : 's'} · loan numbers are shared by every circle, so they skip` : ''
  $('#circle-loans').replaceChildren(...(loans.length ? [
    el('div', { className: 'loan-row head' }, el('span', { textContent: 'Loan' }), el('span', { textContent: 'Borrower' }), el('span', { textContent: 'Lender' }), el('span', { textContent: 'Amount' }), el('span', { className: 'reason', textContent: 'Reason' }), el('span', { textContent: 'Status' })),
    ...loans.map((l) => {
      const s = status(l)
      const reason = reasonOf(l)
      return el('div', { className: 'loan-row' },
        el('span', { className: 'c-id num', textContent: `#${l.loan_id}` }),
        el('span', { className: 'c-b' }, party(l.borrower_id)),
        el('span', { className: 'c-l' }, party(l.lender_id, l.lender_is_treasury)),
        el('span', { className: 'c-amt num', textContent: `${formatUsdc(l.principal)} USDC · ${loanLengthText(l.duration_days, demo?.circle?.params.day_length_sec ?? '86400')}` }),
        el('span', { className: 'reason', textContent: reason || '—', title: reason }),
        el('span', { className: 'c-who', textContent: `${l.borrower_id === accountId ? 'You' : memberLabel(l.borrower_id)} borrowed from ${l.lender_is_treasury ? 'the treasury' : l.lender_id === accountId ? 'you' : memberLabel(l.lender_id)}${reason ? ` · "${reason}"` : ''}` }),
        el('span', { className: 'c-status' }, el('span', { className: `state state-${s.split(' ')[0]}`, textContent: s })))
    })] : [el('p', { className: 'muted', textContent: demo ? 'No loans in this circle yet.' : loadError ? 'Unavailable: testnet could not be read.' : 'Loading…' })]))
}

function tickDue(): void {
  renderNet()
  for (const node of document.querySelectorAll<HTMLElement>('[data-until]')) {
    const left = countdown(node.dataset.until || null, Date.now())
    node.textContent = left ? `${node.dataset.prefix ?? ''}${left}` : (node.dataset.after ?? '')
  }
}

async function loadMyCard(): Promise<void> {
  const image = $<HTMLImageElement>('#my-card-image')
  const empty = $('#hero-card-empty')
  if (!accountId || !me?.passport) {
    image.hidden = true
    empty.hidden = false
    $('#load-my-card').hidden = true
    empty.textContent = accountId ? 'No passport in this circle yet. Join with an invite to get one.' : 'Connect a wallet and join to see your passport here.'
    $('#my-card-title').textContent = ''
    return
  }
  const passport = me.passport
  const [svg, token] = await Promise.all([readClient.cardSvg(passport.token_id), readClient.nftToken(passport.token_id)])
  const check = svg ? checkCardSvg(svg) : null
  if (svg && check?.ok) { image.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); image.hidden = false; empty.hidden = true }
  else { image.hidden = true; empty.hidden = false; empty.textContent = svg ? `Passport picture not shown: ${check && !check.ok ? check.reason : 'unsafe image'}.` : 'Passport picture unavailable right now.' }
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
  $('#nav-treasury-badge').hidden = true
  if (!demo?.circle?.treasury_id || !demo.dao?.verified) { panel.hidden = true; none.hidden = false; return }
  panel.hidden = false
  none.hidden = true
  const daoId = demo.circle.treasury_id
  const cid = demo.circle.circle_id
  const dao = new SputnikDaoClient(config.rpcUrl, daoId, window.commonCircleWallet)
  const usdc = new CircleClient(config.rpcUrl, demo.config.usdc_id)
  const [policy, proposals, balance] = await Promise.all([dao.getPolicy(), dao.recentProposals(10), usdc.view<string>('ft_balance_of', { account_id: daoId })])
  const stewards = stewardsOf(policy)
  const bondNear = (Number(BigInt(policy.proposal_bond) / 10n ** 18n) / 1e6).toString()
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
  // Badge = votes waiting for THIS steward, not every open proposal.
  const voting = isSteward && canView() ? proposals.filter((p) => p.status === 'InProgress' && !(accountId in (p.votes ?? {}))).length : 0
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
  await assertCanBorrow()
  const storage = await readClient.storageCosts()
  await client().createLoan({ circleId: demo.circle.circle_id, lenderId: demo.circle.treasury_id, amount: v.amount, durationDays: v.days, deposit: storage.create_loan })
  await afterTx('Request recorded. Now press "2. Send to stewards".')
}

async function loadDemo(): Promise<void> {
  const requested = $<HTMLInputElement>('#demo-circle-id').value.trim() || circleId
  let snapshot: ReadOnlyDemoSnapshot
  try {
    snapshot = await loadReadOnlyDemo(requested)
  } catch (error) {
    // Keep the last good snapshot on screen, labelled stale; never replace it with zeros.
    const text = errorText(error)
    if (!demo) loadError = text
    netTrouble(text)
    renderAll()
    throw error
  }
  if (snapshot.circleId !== circleId) { epoch++; formCache.clear(); chatRequests.clear() }
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
  const usdc = new CircleClient(config.rpcUrl, snapshot.config.usdc_id)
  const [contractBal, daoBal] = await Promise.all([
    usdc.view<string>('ft_balance_of', { account_id: snapshot.contractId }).catch(() => null),
    snapshot.circle?.treasury_id ? usdc.view<string>('ft_balance_of', { account_id: snapshot.circle.treasury_id }).catch(() => null) : Promise.resolve(null),
  ])
  balances = { contract: contractBal, dao: daoBal }
  loadError = ''
  const partial = [...(snapshot.partial ?? [])]
  if (contractBal === null) partial.push('loan contract balance')
  if (snapshot.circle?.treasury_id && daoBal === null) partial.push('treasury balance')
  netOk(partial)
  const diffs = snapshot.circle ? demoDifferences(snapshot.circle.params) : []
  $('#demo-flag').hidden = !diffs.length
  $('#demo-flag').textContent = diffs.length ? `Demo settings, faster than standard: ${diffs.join('; ')}.` : ''
  const dao = $('#dao-status')
  if (snapshot.dao) {
    dao.textContent = snapshot.dao.verified ? '✓ DAO verified by CommonCircle frontend trust checks' : `⚠ ${snapshot.dao.message} Treasury actions are hidden.`
    dao.title = `${snapshot.dao.daoId} · code ${snapshot.dao.codeHash ?? 'unknown'} · keys ${snapshot.dao.accessKeyCount ?? 'unknown'} · voting: ${snapshot.dao.policyReason}. The circle contract itself does not check this.`
    dao.className = `flag ${snapshot.dao.verified ? 'trusted' : 'flag-warn'}`
  } else {
    dao.textContent = 'No DAO yet: the founder runs this circle'
    dao.className = 'flag'
  }
  if (!chatMessages.size) chatRoom = circleId
  renderAll()
  renderEvidence()
  await renderTreasury().catch((error) => { const text = errorText(error); if (isNetworkText(text)) netTrouble(text); else show(`Treasury: ${text}`, 'bad') })
}

/* ---------- wiring ---------- */

function on(selector: string, action: () => Promise<void> | void, context: 'wallet' | 'chat' | 'chain' = 'chain'): void {
  const b = $<HTMLButtonElement>(selector)
  b.addEventListener('click', () => void run(b, async () => { await action() }, context))
}

function wire(): void {
  for (const item of document.querySelectorAll<HTMLButtonElement>('.nav-item')) item.addEventListener('click', () => goView(item.dataset.view as View))
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) if (tab.dataset.tab !== 'more') tab.addEventListener('click', () => goView(tab.dataset.tab as View))
  $('#menu-btn').addEventListener('click', (event) => { event.stopPropagation(); if ($('#sidebar').classList.contains('open')) closeDrawer(); else openDrawer() })
  $('#side-close').addEventListener('click', closeDrawer)
  $('#room-back').addEventListener('click', () => $('#view-chat').classList.add('rooms-open'))
  $('#see-activity').addEventListener('click', () => goView('activity'))
  $('#members-invite-cta').addEventListener('click', () => goView('invites'))
  $('#net-pill').addEventListener('click', () => goView('network'))
  on('#check-server', checkServer)
  on('#sign-out', async () => { try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ } chatAllowed = false; if (me) me.signedIn = false; renderAll(); renderSettings(); show('Signed out of the chat in this browser.', 'ok') })
  // Phone: a tap on the backdrop (or anywhere outside the drawer) closes it; so does Escape.
  $('#scrim').addEventListener('click', closeDrawer)
  document.addEventListener('click', (event) => {
    const target = event.target as Node
    if ($('#sidebar').classList.contains('open') && !$('#sidebar').contains(target)) closeDrawer()
    if (!$('#account-menu').hidden && !(target instanceof Element && target.closest('.head-account'))) closeAccountMenu()
  })
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeDrawer(); closeAccountMenu() } })
  $('#head-connect').addEventListener('click', (event) => { event.stopPropagation(); toggleAccountMenu($('#head-connect')) })
  $('#head-account').addEventListener('click', (event) => { event.stopPropagation(); toggleAccountMenu($('#head-account')) })
  on('#switch-wallet', switchWallet, 'wallet')
  $('#wallet-account').addEventListener('click', () => { if (accountId) void navigator.clipboard?.writeText(accountId).then(() => show(`${accountId} (copied)`, 'ok'), () => show(accountId, 'info')) })
  on('#net-banner-retry', async () => { await refreshAll() })
  // One RPC answering again does not make the whole snapshot fresh: re-read everything.
  onRpcHealth((h) => { if (h.ok && (net.phase === 'stale' || net.phase === 'offline')) void refreshAll().catch(() => undefined) })
  on('#connect-meteor', () => connectWallet('meteor-wallet'), 'wallet')
  on('#connect-wallet', () => connectWallet('my-near-wallet'), 'wallet')
  $('#status-close').addEventListener('click', hideToast)
  $<HTMLSelectElement>('#pp-account').addEventListener('change', (event) => { passportAccount = (event.target as HTMLSelectElement).value; renderPassport() })
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
  $('#theme-toggle').addEventListener('click', () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('commoncircle.theme', next) } catch { /* ignore */ } })
  // Keep the snapshot fresh while the page is visible (one refresh at a time; failures back off by themselves).
  window.setInterval(() => { if (document.visibilityState === 'visible' && !refreshing && (net.phase === 'connected' || net.phase === 'degraded')) void refreshAll().catch(() => undefined) }, 60_000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isStale(net, Date.now())) void refreshAll().catch(() => undefined) })
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
  try { const t = localStorage.getItem('commoncircle.theme'); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t } catch { /* ignore */ }
  hydrateInviteFields()
  wire()
  let start: View = 'home'
  try { const saved = localStorage.getItem('commoncircle.view'); if (saved && (VIEWS as readonly string[]).includes(saved)) start = saved as View } catch { /* ignore */ }
  if (inviteFields().inviteSecret) start = 'home'
  goView(start)
  renderAll()
  renderHeadAccount()
  renderNet()
  // loadDemo() already records the failure (banner + bounded retry); nothing else to do here.
  void loadDemo().catch(() => undefined)
  void restoreWallet().catch(() => { /* no saved wallet session */ })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
else boot()
