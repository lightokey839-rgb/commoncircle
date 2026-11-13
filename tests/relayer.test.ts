import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { RelayerGuard, type RelayerConfig, type RelayerReader, type RelayerSpendStore } from '../server/relayer'

const nowMs = 1_762_819_200_000
const config: RelayerConfig = {
  contractId: 'commoncircle-light.testnet',
  receivers: {
    circle: 'commoncircle-light.testnet',
    vault: 'vault.commoncircle-light.testnet',
    usdc: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
  },
  perAccountDailyCap: '100',
  totalDailyCap: '250',
  maxGasPrice: '1',
}

function base58Encode(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let number = 0n
  for (const byte of bytes) number = number * 256n + BigInt(byte)
  const digits: string[] = []
  while (number > 0n) {
    digits.push(alphabet[Number(number % 58n)])
    number /= 58n
  }
  const firstNonZero = [...bytes].findIndex((byte) => byte !== 0)
  const leadingZeroes = firstNonZero < 0 ? bytes.length : firstNonZero
  return '1'.repeat(leadingZeroes) + digits.reverse().join('')
}

function inviteProof(accountId = 'bob.testnet') {
  const keyPair = generateKeyPairSync('ed25519')
  const spki = keyPair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  const invitePublicKey = `ed25519:${base58Encode(spki.subarray(-32))}`
  const circleId = '1'
  const message = ['commoncircle-invite-v1', config.contractId, circleId, accountId, invitePublicKey].join('\n')
  const inviteSignature = sign(null, Buffer.from(message), keyPair.privateKey).toString('base64')
  return {
    invitePublicKey,
    inviteSignature,
    invite: { circle_id: circleId, invite_public_key: invitePublicKey, inviter_id: 'alice.testnet', invitee_id: accountId, expires_at: (BigInt(nowMs) * 1_000_000n + 60_000_000_000n).toString(), expired: false },
  }
}

function readerFor(invite: Awaited<ReturnType<typeof inviteProof>>['invite'] | null, allowed = false): RelayerReader {
  return {
    getInvite: vi.fn(async () => invite),
    checkAccess: vi.fn(async () => ({ allowed, reason: allowed ? 'Active' as const : 'NoPassport' as const, token_id: null, display_tier: null })),
  }
}

function request(proof: ReturnType<typeof inviteProof>, overrides: Record<string, unknown> = {}) {
  return {
    accountId: 'bob.testnet',
    circleId: '1',
    receiverId: config.receivers.circle,
    methodName: 'redeem_invite',
    gas: '10',
    invitePublicKey: proof.invitePublicKey,
    inviteSignature: proof.inviteSignature,
    ...overrides,
  }
}

describe('relayer allowlist and daily caps', () => {
  it('allows a valid invite signature for redeem_invite', async () => {
    const proof = inviteProof()
    const result = await new RelayerGuard(config, () => nowMs).authorize(request(proof), readerFor(proof.invite))
    expect(result.receiver).toBe('circle')
    expect(result.accountRemaining).toBe('90')
  })

  it('rejects an invalid invite signature before reserving budget', async () => {
    const proof = inviteProof()
    const guard = new RelayerGuard(config, () => nowMs)
    await expect(guard.authorize(request(proof, { inviteSignature: 'A'.repeat(88) }), readerFor(proof.invite))).rejects.toMatchObject({ code: 'RELAYER_INVITE_SIGNATURE' })
    const next = await guard.authorize(request(proof), readerFor(proof.invite))
    expect(next.accountRemaining).toBe('90')
  })

  it('allows a passport-backed call without an invite', async () => {
    const guard = new RelayerGuard(config, () => nowMs)
    const result = await guard.authorize({ accountId: 'member.testnet', circleId: '1', receiverId: config.receivers.usdc, methodName: 'storage_deposit', gas: '10' }, readerFor(null, true))
    expect(result.receiver).toBe('usdc')
  })

  it('does not treat an expired or wrongly named invite as redeem authorization', async () => {
    const proof = inviteProof()
    const wrongName = { ...proof.invite, invitee_id: 'carol.testnet' }
    await expect(new RelayerGuard(config, () => nowMs).authorize(request(proof), readerFor(wrongName))).rejects.toMatchObject({ code: 'RELAYER_INVITE' })
    const expired = { ...proof.invite, expires_at: (BigInt(nowMs) * 1_000_000n - 1n).toString() }
    await expect(new RelayerGuard(config, () => nowMs).authorize(request(proof), readerFor(expired))).rejects.toMatchObject({ code: 'RELAYER_INVITE' })
  })

  it('rejects receivers and methods outside the explicit allowlist', async () => {
    const proof = inviteProof()
    const guard = new RelayerGuard(config, () => nowMs)
    await expect(guard.authorize(request(proof, { receiverId: 'attacker.testnet' }), readerFor(proof.invite))).rejects.toMatchObject({ code: 'RELAYER_RECEIVER' })
    await expect(guard.authorize(request(proof, { methodName: 'set_passport_status' }), readerFor(proof.invite))).rejects.toMatchObject({ code: 'RELAYER_METHOD' })
  })

  it('enforces per-account and total daily caps, then resets at UTC day rollover', async () => {
    let clock = nowMs
    const guard = new RelayerGuard(config, () => clock)
    const proof = inviteProof()
    const reader = readerFor(proof.invite)
    await guard.authorize(request(proof, { gas: '60' }), reader)
    await expect(guard.authorize(request(proof, { gas: '41' }), reader)).rejects.toMatchObject({ code: 'RELAYER_ACCOUNT_CAP' })
    const other = inviteProof('carol.testnet')
    await guard.authorize(request(other, { accountId: 'carol.testnet', invitePublicKey: other.invitePublicKey, inviteSignature: other.inviteSignature, gas: '90' }), readerFor(other.invite))
    const third = inviteProof('dave.testnet')
    await guard.authorize(request(third, { accountId: 'dave.testnet', invitePublicKey: third.invitePublicKey, inviteSignature: third.inviteSignature, gas: '90' }), readerFor(third.invite))
    await expect(guard.authorize(request(proof, { gas: '11' }), reader)).rejects.toMatchObject({ code: 'RELAYER_TOTAL_CAP' })
    clock += 86_400_000
    // A day later the 60-second invite has expired (the guard is right to refuse it),
    // so bob comes back as a member: an active passport and an allowlisted USDC call.
    await expect(guard.authorize(request(proof, { gas: '100' }), reader)).rejects.toMatchObject({ code: 'RELAYER_INVITE' })
    const member = { invitePublicKey: undefined, inviteSignature: undefined, receiverId: config.receivers.usdc, methodName: 'storage_deposit' }
    const reset = await guard.authorize(request(proof, { ...member, gas: '100' }), readerFor(null, true))
    expect(reset.accountRemaining).toBe('0')
    expect(reset.totalRemaining).toBe('150')
  })
})

describe('relayer cost is computed server-side', () => {
  const member = (overrides: Record<string, unknown> = {}) => ({ accountId: 'member.testnet', circleId: '1', receiverId: config.receivers.vault, methodName: 'execute_repay', gas: '10', ...overrides })

  it('charges gas x maxGasPrice + deposit and ignores a lower caller estimate', async () => {
    const guard = new RelayerGuard({ ...config, maxGasPrice: '3' }, () => nowMs)
    const result = await guard.authorize(member({ gas: '20', estimatedCost: '1' }), readerFor(null, true))
    expect(result.cost).toBe('60')
    expect(result.accountRemaining).toBe('40')
    await expect(guard.authorize(member({ gas: '14', estimatedCost: '1' }), readerFor(null, true))).rejects.toMatchObject({ code: 'RELAYER_ACCOUNT_CAP' })
  })

  it('lets a higher caller estimate raise the charge, never lower it', async () => {
    const result = await new RelayerGuard(config, () => nowMs).authorize(member({ gas: '10', estimatedCost: '30' }), readerFor(null, true))
    expect(result.cost).toBe('30')
  })

  it('refuses missing, zero, malformed or over-limit gas', async () => {
    const guard = new RelayerGuard({ ...config, maxGasPerCall: '50' }, () => nowMs)
    const reader = readerFor(null, true)
    await expect(guard.authorize(member({ gas: undefined }), reader)).rejects.toMatchObject({ code: 'RELAYER_COST' })
    await expect(guard.authorize(member({ gas: '0' }), reader)).rejects.toMatchObject({ code: 'RELAYER_GAS' })
    await expect(guard.authorize(member({ gas: '-5' }), reader)).rejects.toMatchObject({ code: 'RELAYER_COST' })
    await expect(guard.authorize(member({ gas: '51' }), reader)).rejects.toMatchObject({ code: 'RELAYER_GAS' })
    expect(reader.checkAccess).not.toHaveBeenCalled()
  })

  it('never sponsors a deposit unless the method has a configured ceiling', async () => {
    const reader = readerFor(null, true)
    await expect(new RelayerGuard(config, () => nowMs).authorize(member({ deposit: '1' }), reader)).rejects.toMatchObject({ code: 'RELAYER_DEPOSIT' })
    const guard = new RelayerGuard({ ...config, maxDepositByMethod: { storage_deposit: '5' } }, () => nowMs)
    const usdc = { receiverId: config.receivers.usdc, methodName: 'storage_deposit' }
    expect((await guard.authorize(member({ ...usdc, deposit: '5' }), reader)).cost).toBe('15')
    await expect(guard.authorize(member({ ...usdc, deposit: '6' }), reader)).rejects.toMatchObject({ code: 'RELAYER_DEPOSIT' })
    await expect(guard.authorize(member({ deposit: '1' }), reader)).rejects.toMatchObject({ code: 'RELAYER_DEPOSIT' })
  })

  it('requires a positive maxGasPrice', () => {
    expect(() => new RelayerGuard({ ...config, maxGasPrice: '0' })).toThrow('maxGasPrice')
    expect(() => new RelayerGuard({ ...config, maxGasPrice: undefined as unknown as string })).toThrow('maxGasPrice')
  })
})

describe('relayer spend counters', () => {
  it('refuses live mode without a durable store (fail closed)', () => {
    expect(() => new RelayerGuard({ ...config, mode: 'live' })).toThrow('durable spend store')
    expect(new RelayerGuard({ ...config })).toBeInstanceOf(RelayerGuard)
  })

  it('in live mode reserves through the store, so the budget survives a restart', async () => {
    const spent = new Map<string, bigint>()
    const store: RelayerSpendStore = {
      reserve: vi.fn(async ({ day, accountId, cost, perAccountCap, totalCap }) => {
        const account = spent.get(`${day}:${accountId}`) ?? 0n
        const total = spent.get(`${day}:*`) ?? 0n
        if (account + cost > perAccountCap) return { ok: false as const, code: 'RELAYER_ACCOUNT_CAP' as const }
        if (total + cost > totalCap) return { ok: false as const, code: 'RELAYER_TOTAL_CAP' as const }
        spent.set(`${day}:${accountId}`, account + cost)
        spent.set(`${day}:*`, total + cost)
        return { ok: true as const, accountSpent: account + cost, totalSpent: total + cost }
      }),
    }
    const call = { accountId: 'member.testnet', circleId: '1', receiverId: config.receivers.vault, methodName: 'execute_repay', gas: '60' }
    const first = await new RelayerGuard({ ...config, mode: 'live', store }, () => nowMs).authorize(call, readerFor(null, true))
    expect(first.accountRemaining).toBe('40')
    // A fresh process (new guard) sees the same counters.
    await expect(new RelayerGuard({ ...config, mode: 'live', store }, () => nowMs).authorize(call, readerFor(null, true))).rejects.toMatchObject({ code: 'RELAYER_ACCOUNT_CAP' })
    expect(store.reserve).toHaveBeenCalledTimes(2)
  })
})
