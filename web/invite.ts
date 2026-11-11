import type { InviteSigner } from './circle-client'

const ED25519 = { name: 'Ed25519' } as AlgorithmIdentifier
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export type InviteKeyPair = { publicKey: string; secret: string }
export type ParsedInvite = { circleId: string | null; invitePublicKey: string | null; inviteSecret: string | null }

function base64UrlEncode(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64Encode(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text)
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}

function base58Encode(bytes: Uint8Array): string {
  let number = 0n
  for (const byte of bytes) number = number * 256n + BigInt(byte)
  const digits: string[] = []
  while (number > 0n) {
    digits.push(BASE58_ALPHABET[Number(number % 58n)])
    number /= 58n
  }
  const firstNonZero = [...bytes].findIndex((byte) => byte !== 0)
  const leadingZeroes = firstNonZero < 0 ? bytes.length : firstNonZero
  return '1'.repeat(leadingZeroes) + (digits.reverse().join('') || '')
}

function secretJwk(secret: string): JsonWebKey {
  const value = JSON.parse(new TextDecoder().decode(base64UrlDecode(secret))) as JsonWebKey
  if (value.kty !== 'OKP' || value.crv !== 'Ed25519' || typeof value.d !== 'string' || typeof value.x !== 'string') {
    throw new Error('Invalid invite secret.')
  }
  return { kty: value.kty, crv: value.crv, d: value.d, x: value.x }
}

export async function generateInviteKeyPair(): Promise<InviteKeyPair> {
  if (!globalThis.crypto?.subtle) throw new Error('This browser does not provide WebCrypto.')
  const pair = await globalThis.crypto.subtle.generateKey(ED25519, true, ['sign', 'verify']) as CryptoKeyPair
  const rawPublicKey = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey))
  const privateJwk = await globalThis.crypto.subtle.exportKey('jwk', pair.privateKey)
  const secret = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    kty: privateJwk.kty,
    crv: privateJwk.crv,
    d: privateJwk.d,
    x: privateJwk.x,
  })))
  return { publicKey: `ed25519:${base58Encode(rawPublicKey)}`, secret }
}

export const signInviteWithSecret: InviteSigner = async ({ message, secret }) => {
  const key = await globalThis.crypto.subtle.importKey('jwk', secretJwk(secret), ED25519, false, ['sign'])
  const signature = await globalThis.crypto.subtle.sign(ED25519, key, new TextEncoder().encode(message))
  // Base64VecU8 in near-sdk expects standard padded base64. Only the secret
  // stored in the URL fragment uses base64url.
  return base64Encode(new Uint8Array(signature))
}

export function buildInviteLink(input: { circleId: string; invitePublicKey: string; inviteSecret: string; origin?: string; pathname?: string }): string {
  const url = new URL(input.pathname ?? globalThis.location.pathname, input.origin ?? globalThis.location.origin)
  url.search = new URLSearchParams({ circle_id: input.circleId, invite_public_key: input.invitePublicKey }).toString()
  // The private key is deliberately a fragment: it is not sent in HTTP Referer headers.
  url.hash = new URLSearchParams({ invite_secret: input.inviteSecret }).toString()
  return url.toString()
}

export function parseInviteLink(href = globalThis.location.href): ParsedInvite {
  const url = new URL(href)
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
  return {
    circleId: url.searchParams.get('circle_id') ?? fragment.get('circle_id'),
    invitePublicKey: url.searchParams.get('invite_public_key') ?? fragment.get('invite_public_key'),
    inviteSecret: fragment.get('invite_secret'),
  }
}
