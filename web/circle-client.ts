/** Typed, read-first client for docs/CIRCLE_INTERFACE.md 1.0.0. */

export type U64 = string
export type U128 = string

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
  interface_version: '1.0.0'
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
  register_invite: U128
  redeem_invite: U128
  create_loan: U128
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
  E10_NO_PASSPORT: 'You need an active passport in this circle.',
  E12_NOT_NAMED_LENDER: 'Only the named lender can fund this loan.',
  E18_WINDOW_LAPSED: 'The funding window has closed.',
  E30_INVITE_NOT_FOUND: 'This invite is missing or already used.',
  E31_INVITE_EXPIRED: 'This invite has expired.',
  E32_INVITE_WRONG_ACCOUNT: 'This invite is for a different account.',
  E33_INVITE_BAD_SIGNATURE: 'This invite link is invalid.',
  E35_ALREADY_MEMBER: 'You already have, or previously held, a passport in this circle.',
  E40_NON_TRANSFERABLE: 'Passports cannot be transferred or approved.',
}

export function plainContractError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const code = message.match(/E\d+_[A-Z_]+/)?.[0]
  return (code && PLAIN_ERRORS[code]) || 'The CommonCircle contract rejected that action.'
}

function encodeBase64(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text)
}

export function canonicalInviteMessage(contractId: string, circleId: U64, callerId: string, invitePublicKey: string): string {
  return ['commoncircle-invite-v1', contractId, circleId, callerId, invitePublicKey].join('\n')
}

export class CircleClient {
  constructor(readonly rpcUrl: string, readonly contractId: string, readonly wallet?: NearWallet) {}

  async view<T>(methodName: string, args: Record<string, unknown> = {}): Promise<T> {
    const encoded = encodeBase64(new TextEncoder().encode(JSON.stringify(args)))
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: `${methodName}-${Date.now()}`, method: 'query',
        params: { request_type: 'call_function', finality: 'final', account_id: this.contractId, method_name: methodName, args_base64: encoded },
      }),
    })
    const payload = await response.json() as { result?: { result?: number[] }; error?: { cause?: { name?: string }; data?: string } }
    if (!response.ok || payload.error || !payload.result?.result) throw new ContractError(payload.error?.data ?? 'NEAR RPC view failed')
    return JSON.parse(new TextDecoder().decode(new Uint8Array(payload.result.result))) as T
  }

  getConfig(): Promise<ConfigView> { return this.view('get_config') }
  getCircle(circleId: U64): Promise<CircleView | null> { return this.view('get_circle', { circle_id: circleId }) }
  getInvite(invitePublicKey: string): Promise<InviteView | null> { return this.view('get_invite', { invite_public_key: invitePublicKey }) }
  passportFor(circleId: U64, accountId: string): Promise<PassportView | null> { return this.view('passport_for', { circle_id: circleId, account_id: accountId }) }
  checkAccess(circleId: U64, accountId: string): Promise<AccessView> { return this.view('check_access', { circle_id: circleId, account_id: accountId }) }
  loansByBorrower(accountId: string): Promise<LoanView[]> { return this.view('loans_by_borrower', { account_id: accountId, from_index: null, limit: 50 }) }
  loansByLender(accountId: string): Promise<LoanView[]> { return this.view('loans_by_lender', { account_id: accountId, from_index: null, limit: 50 }) }
  storageCosts(): Promise<StorageCosts> { return this.view('storage_costs') }

  async myPositions(accountId: string): Promise<{ borrowed: LoanView[]; lent: LoanView[] }> {
    const [borrowed, lent] = await Promise.all([this.loansByBorrower(accountId), this.loansByLender(accountId)])
    return { borrowed, lent }
  }

  private async call(methodName: string, args: Record<string, unknown>, deposit: U128, gas: U64): Promise<unknown> {
    if (!this.wallet) throw new Error('A connected NEAR wallet is required for this action.')
    return this.wallet.signAndSendTransaction({
      receiverId: this.contractId,
      actions: [{ type: 'FunctionCall', params: { methodName, args, gas, deposit } }],
    })
  }

  async joinByInvite(input: { circleId: U64; callerId: string; invitePublicKey: string; inviteSecret: string; signInvite: InviteSigner; deposit: U128 }): Promise<unknown> {
    const signature = await input.signInvite({
      message: canonicalInviteMessage(this.contractId, input.circleId, input.callerId, input.invitePublicKey),
      secret: input.inviteSecret,
    })
    return this.call('redeem_invite', { circle_id: input.circleId, invite_public_key: input.invitePublicKey, signature }, input.deposit, '50000000000000')
  }
}
