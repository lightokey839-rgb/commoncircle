import { createHash, createPublicKey, verify } from 'node:crypto'

export type Nep413Payload = {
  message: string
  nonce: Uint8Array
  recipient: string
  callbackUrl?: string
}

const NEP413_TAG = 2 ** 31 + 413
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(value, 0)
  return bytes
}

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  return Buffer.concat([u32(bytes.length), bytes])
}

function optionalString(value: string | undefined): Buffer {
  return value === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), borshString(value)])
}

/** The exact SHA-256 preimage required by NEP-413. */
export function nep413Hash(payload: Nep413Payload): Buffer {
  if (payload.nonce.byteLength !== 32) throw new Error('NEP-413 nonce must be exactly 32 bytes')
  const serialized = Buffer.concat([
    u32(NEP413_TAG),
    borshString(payload.message),
    Buffer.from(payload.nonce),
    borshString(payload.recipient),
    optionalString(payload.callbackUrl),
  ])
  return createHash('sha256').update(serialized).digest()
}

function base58Decode(value: string): Buffer {
  let number = 0n
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character)
    if (digit < 0) throw new Error('invalid base58 public key')
    number = number * 58n + BigInt(digit)
  }
  const digits: number[] = []
  while (number > 0n) {
    digits.push(Number(number & 255n))
    number >>= 8n
  }
  digits.reverse()
  let leadingZeroes = 0
  while (leadingZeroes < value.length && value[leadingZeroes] === '1') leadingZeroes += 1
  return Buffer.concat([Buffer.alloc(leadingZeroes), Buffer.from(digits)])
}

function publicKeyBytes(publicKey: string): Buffer {
  const [keyType, encoded] = publicKey.split(':', 2)
  if (keyType !== 'ed25519' || !encoded) throw new Error('only ed25519 NEAR keys are supported')
  const bytes = base58Decode(encoded)
  if (bytes.length !== 32) throw new Error('NEAR ed25519 public key must be 32 bytes')
  return bytes
}

function signatureBytes(signature: string): Buffer {
  const normalized = signature.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Buffer.from(normalized, 'base64')
  if (bytes.length !== 64) throw new Error('NEP-413 signature must be 64 bytes')
  return bytes
}

export function verifyNep413Signature(input: Nep413Payload & { publicKey: string; signature: string }): boolean {
  const rawKey = publicKeyBytes(input.publicKey)
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey]),
    format: 'der',
    type: 'spki',
  })
  return verify(null, nep413Hash(input), key, signatureBytes(input.signature))
}

type RpcResponse = { result?: { keys?: Array<{ public_key?: string; access_key?: { permission?: unknown } }> }; error?: unknown }

/** A NEP-413 signature is only an account login after its key is confirmed on-chain. */
export async function hasFullAccessKey(rpcUrl: string, accountId: string, publicKey: string): Promise<boolean> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'commoncircle-nep413-key-check',
      method: 'query',
      params: { request_type: 'view_access_key_list', finality: 'final', account_id: accountId },
    }),
  })
  const payload = await response.json() as RpcResponse
  if (!response.ok || payload.error || !payload.result?.keys) throw new Error('NEAR RPC key lookup failed')
  return payload.result.keys.some((item) => item.public_key === publicKey && item.access_key?.permission === 'FullAccess')
}
