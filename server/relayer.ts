import { createPublicKey, verify } from 'node:crypto'
import type { AccessView, InviteView, U128, U64 } from '../web/circle-client'

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const DAY_MS = 86_400_000

export type RelayerReceiver = 'circle' | 'vault' | 'usdc'
export type RelayerAllowlist = Record<RelayerReceiver, readonly string[]>

export const DEFAULT_RELAYER_ALLOWLIST: RelayerAllowlist = {
  circle: ['redeem_invite'],
  vault: ['execute_repay', 'execute_auto_lend'],
  usdc: ['storage_deposit'],
}

export type RelayerConfig = {
  contractId: string
  receivers: { circle: string; vault: string; usdc: string }
  perAccountDailyCap: U128
  totalDailyCap: U128
  allowlist?: RelayerAllowlist
}

export type RelayerRequest = {
  accountId: string
  circleId: U64
  receiverId: string
  methodName: string
  estimatedCost: U128
  invitePublicKey?: string
  inviteSignature?: string
}

export type RelayerReader = {
  getInvite(invitePublicKey: string): Promise<InviteView | null>
  checkAccess(circleId: U64, accountId: string): Promise<AccessView>
}

export type RelayerReservation = {
  day: string
  receiver: RelayerReceiver
  accountId: string
  cost: U128
  accountRemaining: U128
  totalRemaining: U128
}

export class RelayerError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'RelayerError'
    this.code = code
  }
}

function parseBudget(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${field} must be a decimal U128 string.`)
  return BigInt(value)
}

function dayKey(nowMs: number): string {
  return Math.floor(nowMs / DAY_MS).toString()
}

function base58Decode(value: string): Buffer {
  let number = 0n
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character)
    if (digit < 0) throw new RelayerError('RELAYER_INVITE_KEY', 'invite public key is not valid base58')
    number = number * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  while (number > 0n) {
    bytes.push(Number(number & 255n))
    number >>= 8n
  }
  bytes.reverse()
  let leadingZeroes = 0
  while (leadingZeroes < value.length && value[leadingZeroes] === '1') leadingZeroes += 1
  return Buffer.concat([Buffer.alloc(leadingZeroes), Buffer.from(bytes)])
}

function verifyInviteSignature(input: { contractId: string; circleId: U64; accountId: string; invitePublicKey: string; signature: string }): boolean {
  const [keyType, encodedKey] = input.invitePublicKey.split(':', 2)
  if (keyType !== 'ed25519' || !encodedKey || !/^[A-Za-z0-9+/]{86}==$/.test(input.signature)) return false
  let rawKey: Buffer
  try {
    rawKey = base58Decode(encodedKey)
  } catch {
    return false
  }
  if (rawKey.length !== 32) return false
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey]),
    format: 'der',
    type: 'spki',
  })
  const message = ['commoncircle-invite-v1', input.contractId, input.circleId, input.accountId, input.invitePublicKey].join('\n')
  return verify(null, Buffer.from(message, 'utf8'), publicKey, Buffer.from(input.signature, 'base64'))
}

function validInvite(invite: InviteView | null, request: RelayerRequest, nowMs: number): boolean {
  if (!invite || invite.expired || invite.circle_id !== request.circleId) return false
  if (invite.invitee_id !== null && invite.invitee_id !== request.accountId) return false
  try {
    return BigInt(invite.expires_at) > BigInt(Math.floor(nowMs)) * 1_000_000n
  } catch {
    return false
  }
}

export class RelayerGuard {
  private readonly config: RelayerConfig
  private readonly clock: () => number
  private currentDay = ''
  private totalSpent = 0n
  private readonly accountSpent = new Map<string, bigint>()
  private readonly perAccountCap: bigint
  private readonly totalCap: bigint
  private readonly allowlist: RelayerAllowlist

  constructor(config: RelayerConfig, clock: () => number = () => Date.now()) {
    this.config = config
    this.clock = clock
    this.perAccountCap = parseBudget(config.perAccountDailyCap, 'perAccountDailyCap')
    this.totalCap = parseBudget(config.totalDailyCap, 'totalDailyCap')
    if (this.perAccountCap === 0n || this.totalCap === 0n) throw new Error('relayer caps must be positive')
    this.allowlist = config.allowlist ?? DEFAULT_RELAYER_ALLOWLIST
  }

  async authorize(request: RelayerRequest, reader: RelayerReader): Promise<RelayerReservation> {
    const receiver = this.receiverKind(request.receiverId)
    if (!receiver) throw new RelayerError('RELAYER_RECEIVER', 'receiver is outside the circle, vault, and USDC allowlist')
    if (!this.allowlist[receiver].includes(request.methodName)) {
      throw new RelayerError('RELAYER_METHOD', `${request.methodName} is not allowed for ${receiver}`)
    }
    const cost = parseBudget(request.estimatedCost, 'estimatedCost')
    if (cost === 0n) throw new RelayerError('RELAYER_COST', 'estimatedCost must be positive')

    const nowMs = this.clock()
    const invite = request.invitePublicKey ? await reader.getInvite(request.invitePublicKey) : null
    const hasInvite = validInvite(invite, request, nowMs)
    if (request.invitePublicKey && hasInvite) {
      if (!request.inviteSignature || !verifyInviteSignature({
        contractId: this.config.contractId,
        circleId: request.circleId,
        accountId: request.accountId,
        invitePublicKey: request.invitePublicKey,
        signature: request.inviteSignature,
      })) {
        throw new RelayerError('RELAYER_INVITE_SIGNATURE', 'invite signature is invalid')
      }
    }

    if (request.methodName === 'redeem_invite' && !hasInvite) {
      throw new RelayerError('RELAYER_INVITE', 'redeem requires a current named or open invite')
    }
    if (!hasInvite) {
      const access = await reader.checkAccess(request.circleId, request.accountId)
      if (!access.allowed) throw new RelayerError('RELAYER_PASSPORT', 'account has no active passport in this circle')
    }

    return this.reserve(receiver, request.accountId, cost, nowMs)
  }

  private receiverKind(receiverId: string): RelayerReceiver | null {
    if (receiverId === this.config.receivers.circle) return 'circle'
    if (receiverId === this.config.receivers.vault) return 'vault'
    if (receiverId === this.config.receivers.usdc) return 'usdc'
    return null
  }

  private reserve(receiver: RelayerReceiver, accountId: string, cost: bigint, nowMs: number): RelayerReservation {
    const currentDay = dayKey(nowMs)
    if (this.currentDay !== currentDay) {
      this.currentDay = currentDay
      this.totalSpent = 0n
      this.accountSpent.clear()
    }
    const accountSpent = this.accountSpent.get(accountId) ?? 0n
    if (accountSpent + cost > this.perAccountCap) throw new RelayerError('RELAYER_ACCOUNT_CAP', 'account daily cap exceeded')
    if (this.totalSpent + cost > this.totalCap) throw new RelayerError('RELAYER_TOTAL_CAP', 'relayer total daily cap exceeded')
    this.accountSpent.set(accountId, accountSpent + cost)
    this.totalSpent += cost
    return {
      day: currentDay,
      receiver,
      accountId,
      cost: cost.toString(),
      accountRemaining: (this.perAccountCap - accountSpent - cost).toString(),
      totalRemaining: (this.totalCap - this.totalSpent).toString(),
    }
  }
}
