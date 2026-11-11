import { webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { generateInviteKeyPair, signInviteWithSecret } from '../web/invite'

beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
})

describe('CommonCircle invite signatures', () => {
  it('returns padded standard base64 for a 64-byte contract signature', async () => {
    const pair = await generateInviteKeyPair()
    const signature = await signInviteWithSecret({
      message: 'commoncircle-invite-v1\ncommoncircle-light.testnet\n1\nbob.testnet\n' + pair.publicKey,
      secret: pair.secret,
    })

    expect(signature).toMatch(/^[A-Za-z0-9+/]{86}==$/)
    expect(Uint8Array.from(atob(signature), (character) => character.charCodeAt(0))).toHaveLength(64)
  })
})
