import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { RelayerGuard, RelayerError, type RelayerConfig, type RelayerReader } from '../server/relayer'

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
    checkAccess: vi.fn(async () => ({ allowed, reason: allowed ? 'Active' : 'NoPassport', token_id: null, display_tier: null })),
  }
}

function request(proof: ReturnType<typeof inviteProof>, overrides: Record<string, unknown> = {}) {
  return {
    accountId: 'bob.testnet',
    circleId: '1',
    receiverId: config.receivers.circle,
    methodName: 'redeem_invite',
    estimatedCost: '10',
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
    const result = await guard.authorize({ accountId: 'member.testnet', circleId: '1', receiverId: config.receivers.usdc, methodName: 'storage_deposit', estimatedCost: '10' }, readerFor(null, true))
    expect(result.receiver).toBe('usdc')
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
    await guard.authorize(request(proof, { estimatedCost: '60' }), reader)
    await expect(guard.authorize(request(proof, { estimatedCost: '41' }), reader)).rejects.toMatchObject({ code: 'RELAYER_ACCOUNT_CAP' })
    const other = inviteProof('carol.testnet')
    await guard.authorize(request(other, { accountId: 'carol.testnet', invitePublicKey: other.invitePublicKey, inviteSignature: other.inviteSignature, estimatedCost: '150' }), readerFor(other.invite))
    await expect(guard.authorize(request(other, { accountId: 'carol.testnet', invitePublicKey: other.invitePublicKey, inviteSignature: other.inviteSignature, estimatedCost: '41' }), readerFor(other.invite))).rejects.toMatchObject({ code: 'RELAYER_TOTAL_CAP' })
    clock += 86_400_000
    const reset = await guard.authorize(request(proof, { estimatedCost: '100' }), reader)
    expect(reset.accountRemaining).toBe('0')
  })
})
