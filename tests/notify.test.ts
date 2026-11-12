import { describe, expect, it } from 'vitest'
import { firstSentence, friendlyError, isRepeat, TOAST_MS } from '../web/notify'
import { badgeFor, memberLabel } from '../web/labels'

describe('friendlyError (P0-1)', () => {
  it('turns "did not return a testnet account" into a testnet hint with Retry', () => {
    expect(friendlyError(new Error('The wallet did not return a testnet account.'), 'wallet'))
      .toEqual({ text: 'Your wallet did not share a testnet account. Switch your wallet to Testnet and try again.', next: 'connect' })
  })

  it("treats Meteor's 'No current account connected' the same way", () => {
    expect(friendlyError(new Error('No current account connected to Meteor Wallet'), 'wallet').next).toBe('connect')
  })

  it('explains a blocked pop-up', () => {
    expect(friendlyError(new Error("Couldn't open popup window to complete wallet action"), 'wallet').text).toMatch(/Allow pop-ups/)
  })

  it('says nothing was sent when the user closes the wallet', () => {
    expect(friendlyError(new Error('User rejected the request'), 'chain')).toEqual({ text: 'You closed the wallet window, so nothing was sent.', next: null })
  })

  it('maps contract error codes to the plain sentence', () => {
    expect(friendlyError(new Error('Smart contract panicked: E18_WINDOW_LAPSED')).text).toBe('The funding window has closed.')
  })

  it('says chat is offline when the chat server is unreachable, and offers Retry', () => {
    expect(friendlyError(new TypeError('Failed to fetch'), 'chat')).toEqual({ text: 'Chat is offline: the chat server did not answer. Everything else still works.', next: 'retry' })
  })

  it('says testnet is busy for RPC failures', () => {
    expect(friendlyError(new Error('NEAR RPC view failed'))).toEqual({ text: 'NEAR testnet is busy and did not answer. Try again in a moment.', next: 'retry' })
  })

  it('explains a low NEAR balance', () => {
    expect(friendlyError(new Error('{"type":"NotEnoughBalance","signer_id":"a.testnet"}')).text).toMatch(/enough testnet NEAR/)
  })

  it('never shows raw JSON', () => {
    const text = friendlyError(new Error('Wallet error {"code":-32000,"data":{"stack":"x"}} happened')).text
    expect(text).not.toMatch(/[{}]/)
    expect(friendlyError(new Error('{"a":1}')).text).toBe('Something went wrong. Try again.')
  })
})

describe('toasts', () => {
  it('stay 6 s, errors 10 s', () => {
    expect(TOAST_MS).toEqual({ info: 6000, ok: 6000, bad: 10000 })
  })

  it('de-duplicate an identical toast', () => {
    expect(isRepeat({ text: 'x', kind: 'bad' }, { text: 'x', kind: 'bad' })).toBe(true)
    expect(isRepeat({ text: 'x', kind: 'bad' }, { text: 'x', kind: 'ok' })).toBe(false)
    expect(isRepeat(null, { text: 'x', kind: 'ok' })).toBe(false)
  })

  it('cut long messages to one sentence', () => {
    expect(firstSentence('First part. Second part.')).toBe('First part.')
    expect(firstSentence('x'.repeat(200))).toHaveLength(158)
  })
})

describe('member labels and badges (P0-5)', () => {
  it('drops .testnet, keeps short names and shortens long ones to first 6 + last 6', () => {
    expect(memberLabel('254edye5v.testnet')).toBe('254edye5v')
    expect(memberLabel('bob.testnet')).toBe('bob')
    expect(memberLabel('commoncircle-light-lender.testnet')).toBe('common…lender')
    expect(memberLabel('dogs-dao.commoncircle-light.testnet')).toBe('dogs-d…-light')
  })

  it('gives every tier the same badge component', () => {
    expect(badgeFor('Steward')).toEqual({ text: 'Steward', className: 'badge badge-steward' })
    expect(badgeFor('Trusted').className).toBe('badge badge-trusted')
  })
})
