import { viewFunction } from './rpc'
/** Typed, read-first client for docs/CIRCLE_INTERFACE.md 1.1.0. */

export type U64 = string
export type U128 = string
export type CircleThemePattern = 'None' | 'Dots' | 'Grid' | 'Waves' | 'Rays'

export type CircleTheme = {
  tagline?: string | null
  background?: string | null
  accent?: string | null
  text?: string | null
  pattern?: CircleThemePattern | null
  /** Raw base64 image bytes; never an SVG or data URI. */
  emblem?: string | null
}

export type CircleThemeView = {
  tagline: string | null
  background: string
  accent: string
  text: string
  pattern: CircleThemePattern
  emblem_mime: string | null
  emblem_bytes: number
  custom: boolean
}

export function passportTokenTitle(circleName: string): string {
  return `${circleName} Passport`
}

export type CircleParams = {
  min_amount: U128
  member_max_amount: U128
  trusted_max_amount: U128
  max_duration_days: number
  day_length_sec: U64
  funding_window_sec: U64
  qualifying_min_amount: U128
  qualifying_min_days: number
  trusted_threshold: number
  min_distinct_lenders: number
  recovery_lock_sec: U64
  writeoff_grace_sec: U64
}

export type ConfigView = {
  interface_version: '1.1.0'
  usdc_id: string
  vault_id: string
  hard_loan_cap: U128
  floors: { funding_window_sec: U64; qualifying_duration_sec: U64; recovery_lock_sec: U64; day_length_sec: U64 }
  gas: { min_ft_on_transfer: U64; recommended_ft_transfer_call: U64 }
  features: { recovery: boolean }
}

export type CircleView = {
  circle_id: U64
  name: string
  founder_id: string
  admin_id: string
  treasury_id: string | null
  dao_attached: boolean
  created_at: U64
  params: CircleParams
  member_count: number
  steward_count: number
  loan_count: number
  treasury_lending_enabled: boolean
  theme: CircleThemeView
}

export type LoanView = {
  loan_id: U64
  circle_id: U64
  borrower_id: string
  lender_id: string
  lender_is_treasury: boolean
  principal: U128
  total_repaid: U128
  outstanding: U128
  duration_days: number
  duration_sec: U64
  created_at: U64
  funding_deadline: U64
  funded_at: U64 | null
  due_at: U64 | null
  repaid_at: U64 | null
  state: 'Open' | 'Funding' | 'Funded' | 'Repaying' | 'Repaid' | 'Cancelled' | 'WrittenOff'
  cancel_reason: 'Borrower' | 'Lapsed' | null
  funded_via: 'Lender' | 'Vault' | 'Treasury' | null
  overdue: boolean
  repaid_on_time: boolean | null
  qualifying: boolean | null
  flag_cleared: boolean
}

export type PassportView = {
  token_id: string
  circle_id: U64
  owner_id: string
  tier: 'Member' | 'Trusted'
  steward: boolean
  display_tier: 'Member' | 'Trusted' | 'Steward'
  status: 'Active' | 'Suspended' | 'Revoked' | 'Expired'
  expires_at: U64 | null
  joined_at: U64
  invited_by: string | null
  on_time_count: number
  late_count: number
  qualifying_count: number
  distinct_lenders: number
  open_loans: number
  overdue_loans: number
  perks_paused: boolean
  effective_tier: 'Member' | 'Trusted'
  recovery: { new_account_id: string; unlocks_at: U64 } | null
}

export type AccessView = {
  allowed: boolean
  reason: 'Active' | 'NoPassport' | 'Suspended' | 'Revoked' | 'Expired' | 'NoCircle'
  token_id: string | null
  display_tier: 'Member' | 'Trusted' | 'Steward' | null
}

export type InviteView = {
  circle_id: U64
  invite_public_key: string
  inviter_id: string
  invitee_id: string | null
  expires_at: U64
  expired: boolean
}

export type StorageCosts = {
  create_circle: U128
  set_circle_theme: U128
  register_invite: U128
  redeem_invite: U128
  create_loan: U128
}

export type Pagination = { fromIndex?: number | null; limit?: number | null }
export type NftToken = {
  token_id: string
  owner_id: string
  metadata: {
    title: string | null
    description: string | null
    media: string | null
    media_hash: string | null
    copies: number | null
    issued_at: string | null
    expires_at: string | null
    starts_at: string | null
    updated_at: string | null
    extra: string | null
    reference: string | null
    reference_hash: string | null
  } | null
}
export type NftContractMetadata = {
  spec: string
  name: string
  symbol: string
  icon?: string | null
  base_uri?: string | null
  reference?: string | null
  reference_hash?: string | null
}

export type FundMessage = { action: 'fund'; loan_id: U64; lender_id?: string }
export type RepayMessage = { action: 'repay'; loan_id: U64 }
export type CommonCircleEvent = {
  standard: string
  version: string
  event: string
  data: Array<Record<string, unknown>>
}
export type FtTransferCallOutcome = {
  /** The transaction hash, when the wallet returned the outcome (for the explorer link). */
  txHash: string | null
  unusedAmount: U128 | null
  events: CommonCircleEvent[]
  refunded: CommonCircleEvent[]
  funded: CommonCircleEvent[]
  fundingFailed: CommonCircleEvent[]
  repayment: CommonCircleEvent[]
  repaid: CommonCircleEvent[]
  repaymentFailed: CommonCircleEvent[]
}

export type FunctionCallAction = {
  type: 'FunctionCall'
  params: { methodName: string; args: Record<string, unknown>; gas: U64; deposit: U128 }
}

export interface NearWallet {
  signAndSendTransaction(input: { receiverId: string; actions: FunctionCallAction[] }): Promise<unknown>
}

export type InviteSigner = (input: { message: string; secret: string }) => Promise<string>

export class ContractError extends Error {
  readonly code: string

  constructor(message: string) {
    const code = message.match(/^(E\d+_[A-Z_]+)/)?.[1] ?? 'UNKNOWN'
    super(message)
    this.name = 'ContractError'
    this.code = code
  }
}

const PLAIN_ERRORS: Record<string, string> = {
  E01_NOT_FOUND: 'That circle, loan, or passport does not exist.',
  E02_DEPOSIT: 'Attach more NEAR for storage.',
  E03_ONE_YOCTO: 'Attach exactly 1 yoctoNEAR for this action.',
  E04_BAD_PARAMS: 'That setting is not allowed (name or tagline with hidden characters, colour, image type or size).',
  E05_NOT_ADMIN: 'Only the circle admin can do this. In a DAO circle, the stewards decide by proposal.',
  E06_DAO_ALREADY_ATTACHED: 'This circle already has its DAO.',
  E10_NO_PASSPORT: 'You need an active passport in this circle.',
  E11_LENDER_NO_PASSPORT: 'The named lender is not an active member of this circle.',
  E12_NOT_NAMED_LENDER: 'Only the named lender can fund this loan.',
  E13_SELF_LOAN: 'You cannot lend to yourself.',
  E14_AMOUNT_OUT_OF_RANGE: "The amount is outside this circle's limits for your tier.",
  E15_DURATION_OUT_OF_RANGE: "The loan length is outside this circle's limits.",
  E16_OPEN_LOAN_LIMIT: 'You already have the maximum number of open loans.',
  E17_WRONG_STATE: 'That loan is not in the right state for this action.',
  E18_WINDOW_LAPSED: 'The funding window has closed.',
  E19_TREASURY_RULES: 'Treasury loans are only for Trusted members who are not stewards, with no overdue loans, in a circle with at least 2 stewards.',
  E20_NOT_BORROWER: 'Only the borrower can do this.',
  E30_INVITE_NOT_FOUND: 'This invite is missing or already used.',
  E31_INVITE_EXPIRED: 'This invite has expired.',
  E32_INVITE_WRONG_ACCOUNT: 'This invite is for a different account.',
  E33_INVITE_BAD_SIGNATURE: 'This invite link is invalid.',
  E35_ALREADY_MEMBER: 'You already have, or previously held, a passport in this circle.',
  E37_TREASURY_NO_PASSPORT: "The circle's DAO account cannot hold a passport in that circle.",
  E40_NON_TRANSFERABLE: 'Passports cannot be transferred or approved.',
  E60_LOW_GAS: 'Not enough gas was attached, so nothing moved. Try again with 150 Tgas.',
  E72_WRONG_AMOUNT: 'Fund with exactly the loan principal.',
  E73_IN_FLIGHT: 'Another transfer for this loan is still in progress. Wait a moment.',
}

export function plainContractError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const code = message.match(/E\d+_[A-Z_]+/)?.[0]
  if (code) return PLAIN_ERRORS[code] ?? `The CommonCircle contract rejected that action (${code}).`
  // Not a contract error (wallet closed, popup blocked, network): show what actually happened.
  return message || 'Something went wrong. Try again.'
}

function encodeBase64(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text)
}

export function canonicalInviteMessage(contractId: string, circleId: U64, callerId: string, invitePublicKey: string): string {
  return ['commoncircle-invite-v1', contractId, circleId, callerId, invitePublicKey].join('\n')
}

function assertBaseUnits(value: string, field: string): asserts value is U128 {
  if (!/^[0-9]+$/.test(value) || value === '0') throw new Error(`${field} must be a positive integer base-unit string.`)
}

function pagination(input: Pagination = {}): { from_index: number | null; limit: number | null } {
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 0 || limit > 50) throw new Error('limit must be an integer from 0 through 50.')
  if (input.fromIndex !== undefined && input.fromIndex !== null && (!Number.isInteger(input.fromIndex) || input.fromIndex < 0)) {
    throw new Error('fromIndex must be a non-negative integer or null.')
  }
  return { from_index: input.fromIndex ?? null, limit }
}

function nftPagination(fromIndex: U128 | null | undefined, limit: number | null | undefined): { from_index: U128 | null; limit: number | null } {
  if (fromIndex !== undefined && fromIndex !== null && !/^\d+$/.test(fromIndex)) throw new Error('NFT fromIndex must be a U128 string.')
  return { from_index: fromIndex ?? null, limit: pagination({ limit }).limit }
}

function decodeSuccessValue(outcome: unknown): U128 | null {
  if (!outcome || typeof outcome !== 'object') return null
  const statuses: unknown[] = []
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if ('SuccessValue' in value && typeof value.SuccessValue === 'string') statuses.push(value.SuccessValue)
    for (const child of Object.values(value)) visit(child)
  }
  visit(outcome)
  const encoded = statuses.at(-1)
  if (typeof encoded !== 'string' || encoded.length === 0) return null
  try {
    const decoded = atob(encoded)
    const value = JSON.parse(decoded) as unknown
    return typeof value === 'string' && /^[0-9]+$/.test(value) ? value : null
  } catch {
    return null
  }
}

function collectEvents(outcome: unknown): CommonCircleEvent[] {
  const events: CommonCircleEvent[] = []
  const visit = (value: unknown): void => {
    if (typeof value === 'string' && value.startsWith('EVENT_JSON:')) {
      try {
        const parsed = JSON.parse(value.slice('EVENT_JSON:'.length)) as CommonCircleEvent
        if (parsed && typeof parsed.event === 'string' && Array.isArray(parsed.data)) events.push(parsed)
      } catch {
        // Ignore non-JSON logs; wallet receipts can contain arbitrary contract logs.
      }
      return
    }
    if (!value || typeof value !== 'object') return
    for (const child of Object.values(value)) visit(child)
  }
  visit(outcome)
  return events
}

/** The transaction hash from a wallet's FinalExecutionOutcome, or null. */
export function txHashOf(outcome: unknown): string | null {
  if (!outcome || typeof outcome !== 'object') return null
  const o = outcome as { transaction?: { hash?: unknown }; transaction_outcome?: { id?: unknown } }
  const hash = o.transaction?.hash ?? o.transaction_outcome?.id
  return typeof hash === 'string' && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash) ? hash : null
}

export function parseFtTransferCallOutcome(outcome: unknown): FtTransferCallOutcome {
  const events = collectEvents(outcome)
  const byName = (name: string) => events.filter((event) => event.event === name)
  return {
    txHash: txHashOf(outcome),
    unusedAmount: decodeSuccessValue(outcome),
    events,
    refunded: byName('transfer_refunded'),
    funded: byName('loan_funded'),
    fundingFailed: byName('loan_funding_failed'),
    repayment: byName('loan_repayment'),
    repaid: byName('loan_repaid'),
    repaymentFailed: byName('loan_repayment_failed'),
  }
}

export class CircleClient {
  readonly rpcUrl: string
  readonly contractId: string
  readonly wallet?: NearWallet

  constructor(rpcUrl: string, contractId: string, wallet?: NearWallet) {
    this.rpcUrl = rpcUrl
    this.contractId = contractId
    this.wallet = wallet
  }

  async view<T>(methodName: string, args: Record<string, unknown> = {}): Promise<T> {
    const encoded = encodeBase64(new TextEncoder().encode(JSON.stringify(args)))
    // Primary RPC plus verified fallbacks, with retry and backoff (web/rpc.ts).
    const { ok, payload } = await viewFunction(this.rpcUrl, this.contractId, methodName, encoded)
    if (!ok || payload.error || !payload.result?.result) throw new ContractError(payload.error?.data ?? 'NEAR RPC view failed')
    return JSON.parse(new TextDecoder().decode(new Uint8Array(payload.result.result))) as T
  }

  getConfig(): Promise<ConfigView> { return this.view('get_config') }
  getCircle(circleId: U64): Promise<CircleView | null> { return this.view('get_circle', { circle_id: circleId }) }
  getLoan(loanId: U64): Promise<LoanView | null> { return this.view('get_loan', { loan_id: loanId }) }
  getInvite(invitePublicKey: string): Promise<InviteView | null> { return this.view('get_invite', { invite_public_key: invitePublicKey }) }
  passportFor(circleId: U64, accountId: string): Promise<PassportView | null> { return this.view('passport_for', { circle_id: circleId, account_id: accountId }) }
  checkAccess(circleId: U64, accountId: string): Promise<AccessView> { return this.view('check_access', { circle_id: circleId, account_id: accountId }) }
  loansByBorrower(accountId: string, page: Pagination = {}): Promise<LoanView[]> { return this.view('loans_by_borrower', { account_id: accountId, ...pagination(page) }) }
  loansByLender(accountId: string, page: Pagination = {}): Promise<LoanView[]> { return this.view('loans_by_lender', { account_id: accountId, ...pagination(page) }) }
  loansInCircle(circleId: U64, page: Pagination = {}): Promise<LoanView[]> { return this.view('loans_in_circle', { circle_id: circleId, ...pagination(page) }) }
  passportsInCircle(circleId: U64, page: Pagination = {}): Promise<PassportView[]> { return this.view('passports_in_circle', { circle_id: circleId, ...pagination(page) }) }
  cardSvg(tokenId: string): Promise<string | null> { return this.view('card_svg', { token_id: tokenId }) }
  nftToken(tokenId: string): Promise<NftToken | null> { return this.view('nft_token', { token_id: tokenId }) }
  nftMetadata(): Promise<NftContractMetadata> { return this.view('nft_metadata') }
  nftTotalSupply(): Promise<U128> { return this.view('nft_total_supply') }
  nftTokens(fromIndex?: U128 | null, limit?: number | null): Promise<NftToken[]> { return this.view('nft_tokens', nftPagination(fromIndex, limit)) }
  nftSupplyForOwner(accountId: string): Promise<U128> { return this.view('nft_supply_for_owner', { account_id: accountId }) }
  nftTokensForOwner(accountId: string, fromIndex?: U128 | null, limit?: number | null): Promise<NftToken[]> {
    return this.view('nft_tokens_for_owner', { account_id: accountId, ...nftPagination(fromIndex, limit) })
  }
  nftIsApproved(tokenId: string, approvedAccountId: string, approvalId?: U128 | null): Promise<boolean> {
    return this.view('nft_is_approved', { token_id: tokenId, approved_account_id: approvedAccountId, approval_id: approvalId ?? null })
  }
  storageCosts(): Promise<StorageCosts> { return this.view('storage_costs') }

  async registerInvite(input: { circleId: U64; invitePublicKey: string; expiresAt: U64; inviteeId?: string | null; deposit: U128 }): Promise<unknown> {
    return this.call('register_invite', {
      circle_id: input.circleId,
      invite_public_key: input.invitePublicKey,
      expires_at: input.expiresAt,
      invitee_id: input.inviteeId ?? null,
    }, input.deposit, '30000000000000')
  }

  async createCircle(input: { name: string; params: CircleParams; theme?: CircleTheme | null; deposit: U128 }): Promise<unknown> {
    const args: Record<string, unknown> = { name: input.name, params: input.params }
    if (input.theme !== undefined) args.theme = input.theme
    return this.call('create_circle', args, input.deposit, '50000000000000')
  }

  async setCircleTheme(input: { circleId: U64; theme: CircleTheme; deposit: U128 }): Promise<unknown> {
    return this.call('set_circle_theme', { circle_id: input.circleId, theme: input.theme }, input.deposit, '50000000000000')
  }

  async createLoan(input: { circleId: U64; lenderId: string; amount: U128; durationDays: number; deposit: U128 }): Promise<unknown> {
    assertBaseUnits(input.amount, 'amount')
    if (!Number.isInteger(input.durationDays) || input.durationDays < 1) throw new Error('durationDays must be a positive integer.')
    return this.call('create_loan', {
      circle_id: input.circleId,
      lender_id: input.lenderId,
      amount: input.amount,
      duration_days: input.durationDays,
    }, input.deposit, '50000000000000')
  }

  cancelLoan(loanId: U64): Promise<unknown> {
    return this.call('cancel_loan', { loan_id: loanId }, '1', '30000000000000')
  }

  async myPositions(accountId: string): Promise<{ borrowed: LoanView[]; lent: LoanView[] }> {
    const [borrowed, lent] = await Promise.all([this.loansByBorrower(accountId), this.loansByLender(accountId)])
    return { borrowed, lent }
  }

  private async sendFunctionCall(receiverId: string, methodName: string, args: Record<string, unknown>, deposit: U128, gas: U64): Promise<unknown> {
    if (!this.wallet) throw new Error('A connected NEAR wallet is required for this action.')
    return this.wallet.signAndSendTransaction({
      receiverId,
      actions: [{ type: 'FunctionCall', params: { methodName, args, gas, deposit } }],
    })
  }

  private call(methodName: string, args: Record<string, unknown>, deposit: U128, gas: U64): Promise<unknown> {
    return this.sendFunctionCall(this.contractId, methodName, args, deposit, gas)
  }

  private async transferCall(usdcId: string, amount: U128, message: FundMessage | RepayMessage): Promise<FtTransferCallOutcome> {
    assertBaseUnits(amount, 'amount')
    const outcome = await this.sendFunctionCall(usdcId, 'ft_transfer_call', {
      receiver_id: this.contractId,
      amount,
      msg: JSON.stringify(message),
    }, '1', '150000000000000')
    return parseFtTransferCallOutcome(outcome)
  }

  async joinByInvite(input: { circleId: U64; callerId: string; invitePublicKey: string; inviteSecret: string; signInvite: InviteSigner; deposit: U128 }): Promise<unknown> {
    const signature = await input.signInvite({
      message: canonicalInviteMessage(this.contractId, input.circleId, input.callerId, input.invitePublicKey),
      secret: input.inviteSecret,
    })
    return this.call('redeem_invite', { circle_id: input.circleId, invite_public_key: input.invitePublicKey, signature }, input.deposit, '50000000000000')
  }

  fundLoan(input: { usdcId: string; loanId: U64; amount: U128 }): Promise<FtTransferCallOutcome> {
    return this.transferCall(input.usdcId, input.amount, { action: 'fund', loan_id: input.loanId })
  }

  fundLoanFromVault(input: { usdcId: string; loanId: U64; lenderId: string; amount: U128 }): Promise<FtTransferCallOutcome> {
    return this.transferCall(input.usdcId, input.amount, { action: 'fund', loan_id: input.loanId, lender_id: input.lenderId })
  }

  /** NEP-145: an account must be registered with USDC before it can receive a loan. 0.00125 NEAR, once. */
  registerWithToken(input: { tokenId: string; accountId: string }): Promise<unknown> {
    return this.sendFunctionCall(input.tokenId, 'storage_deposit', { account_id: input.accountId, registration_only: true }, '1250000000000000000000', '30000000000000')
  }

  repayLoan(input: { usdcId: string; loanId: U64; amount: U128 }): Promise<FtTransferCallOutcome> {
    return this.transferCall(input.usdcId, input.amount, { action: 'repay', loan_id: input.loanId })
  }
}
