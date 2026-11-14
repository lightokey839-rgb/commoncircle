import { describe, expect, it } from 'vitest'
import { evaluateDaoPolicy, evaluateDaoTrust, requiredApprovals, SPUTNIK_GLOBAL_HASH, type PolicyJson } from '../web/dao'
import {
  clearFlagProposal, formatUsdc, loansNeedingProposal, proposalLoanId, repaymentNotice, staleProposalNote, stewardsOf, treasuryFundProposal,
  usdcToBaseUnits, SputnikDaoClient, type SputnikPolicy, type SputnikProposal,
} from '../web/treasury'
import { assertCircleName, assertTagline, isPlainText } from '../web/text-rules'
import type { FtTransferCallOutcome, FunctionCallAction, LoanView } from '../web/circle-client'

const DAO = 'dogs-dao.commoncircle-light.testnet'
const CIRCLE = 'commoncircle-light.testnet'
const USDC = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af'

// The live dogs-dao policy (get_policy on testnet, 13 Nov 2026) and circle 3's two stewards.
const STEWARDS = ['commoncircle-light-steward.testnet', 'commoncircle-light-lender.testnet']
const LIVE_POLICY: PolicyJson = {
  roles: [
    { name: 'stewards', kind: { Group: [...STEWARDS] }, permissions: ['*:*'], vote_policy: {} },
    { name: 'members-may-ask', kind: 'Everyone', permissions: ['call:AddProposal', 'transfer:AddProposal'], vote_policy: {} },
  ],
  default_vote_policy: { weight_kind: 'RoleWeight', quorum: '0', threshold: [1, 2] },
}
const GOOD = { daoId: DAO, account: { code_hash: '11111111111111111111111111111111', global_contract_hash: SPUTNIK_GLOBAL_HASH }, accessKeys: { keys: [] }, policy: LIVE_POLICY, stewards: STEWARDS }

describe('F-06 DAO trust check', () => {
  it('passes the live demo DAO: Sputnik global hash, no keys, both stewards must approve', () => {
    const ok = evaluateDaoTrust(GOOD)
    expect(ok.verified).toBe(true)
    expect(ok.policyOk).toBe(true)
    expect(ok.message).toBe('Sputnik DAO · no keys · every approval needs all 2 stewards')
  })

  it('accepts the same code deployed locally (code_hash)', () => {
    expect(evaluateDaoTrust({ ...GOOD, account: { code_hash: SPUTNIK_GLOBAL_HASH } }).verified).toBe(true)
  })

  it('fails when the account still has a key, even with the right code', () => {
    const r = evaluateDaoTrust({ ...GOOD, accessKeys: { keys: [{ public_key: 'ed25519:x' }] } })
    expect(r.verified).toBe(false)
    expect(r.accessKeyCount).toBe(1)
  })

  it('fails for a plain account or different code', () => {
    expect(evaluateDaoTrust({ ...GOOD, account: { code_hash: '11111111111111111111111111111111' } }).verified).toBe(false)
    expect(evaluateDaoTrust({ ...GOOD, account: { code_hash: 'SomethingElse' } }).verified).toBe(false)
  })

  it('fails closed when RPC data or the voting rules are missing', () => {
    expect(evaluateDaoTrust({ daoId: DAO, account: null, accessKeys: null }).verified).toBe(false)
    // Right code, no keys, but nobody checked the policy: not verified.
    expect(evaluateDaoTrust({ ...GOOD, policy: null }).verified).toBe(false)
  })
})

describe('F-06b DAO voting rules (red-team finding 4)', () => {
  it('Sputnik threshold maths: [1,2] of 2 needs 2, of 3 needs 2; weight 1 needs 1', () => {
    expect(requiredApprovals({ threshold: [1, 2], quorum: '0' }, 2)).toBe(2)
    expect(requiredApprovals({ threshold: [1, 2], quorum: '0' }, 3)).toBe(2)
    expect(requiredApprovals({ threshold: '1', quorum: '0' }, 2)).toBe(1)
    expect(requiredApprovals({ threshold: [1, 2], quorum: '3' }, 3)).toBe(3)
  })

  it('refuses a permissive DAO: one steward vote is enough', () => {
    const r = evaluateDaoTrust({ ...GOOD, policy: { ...LIVE_POLICY, default_vote_policy: { weight_kind: 'RoleWeight', quorum: '0', threshold: '1' } } })
    expect(r.verified).toBe(false)
    expect(r.message).toContain('pass with 1 of 2')
  })

  it('refuses a per-kind override that lets transfers pass with one vote', () => {
    const roles = [{ ...LIVE_POLICY.roles[0], vote_policy: { transfer: { weight_kind: 'RoleWeight', quorum: '0', threshold: '1' } } }, LIVE_POLICY.roles[1]]
    expect(evaluateDaoPolicy({ ...LIVE_POLICY, roles }, STEWARDS).ok).toBe(false)
  })

  it('refuses a voting group that is not exactly the circle stewards', () => {
    const extra = [{ ...LIVE_POLICY.roles[0], kind: { Group: [...STEWARDS, 'outsider.testnet'] } }, LIVE_POLICY.roles[1]]
    expect(evaluateDaoPolicy({ ...LIVE_POLICY, roles: extra }, STEWARDS).ok).toBe(false)
    const other = [{ ...LIVE_POLICY.roles[0], kind: { Group: ['a.testnet', 'b.testnet'] } }, LIVE_POLICY.roles[1]]
    expect(evaluateDaoPolicy({ ...LIVE_POLICY, roles: other }, STEWARDS).ok).toBe(false)
  })

  it('refuses when Everyone (or a token role) can vote, or token-weighted votes', () => {
    const everyone = [LIVE_POLICY.roles[0], { ...LIVE_POLICY.roles[1], permissions: ['*:VoteApprove'] }]
    expect(evaluateDaoPolicy({ ...LIVE_POLICY, roles: everyone }, STEWARDS).ok).toBe(false)
    expect(evaluateDaoPolicy({ ...LIVE_POLICY, default_vote_policy: { weight_kind: 'TokenWeight', quorum: '0', threshold: [1, 2] } }, STEWARDS).ok).toBe(false)
  })

  it('refuses a circle with fewer than two stewards', () => {
    expect(evaluateDaoPolicy(LIVE_POLICY, [STEWARDS[0]]).ok).toBe(false)
  })
})

describe('Sputnik treasury proposals', () => {
  it('builds the Transfer-with-msg proposal that funded loan 6 on testnet', () => {
    const p = treasuryFundProposal({ usdcId: USDC, circleContractId: CIRCLE, loanId: '6', amount: '1000000', borrowerId: 'b.testnet' })
    expect(p.proposal.kind).toEqual({ Transfer: { token_id: USDC, receiver_id: CIRCLE, amount: '1000000', msg: '{"action":"fund","loan_id":"6"}' } })
    expect(proposalLoanId({ ...base, kind: p.proposal.kind })).toEqual({ loanId: '6', action: 'fund' })
  })

  it('builds the clear_flag FunctionCall proposal (F-09) and reads its loan back', () => {
    const p = clearFlagProposal({ circleContractId: CIRCLE, loanId: '4' })
    const action = p.proposal.kind.FunctionCall.actions[0]
    expect(action).toMatchObject({ method_name: 'clear_flag', deposit: '1', gas: '30000000000000' })
    expect(JSON.parse(atob(action.args))).toEqual({ loan_id: '4' })
    expect(proposalLoanId({ ...base, kind: p.proposal.kind })).toEqual({ loanId: '4', action: 'clear_flag' })
  })

  it('lists the stewards from the live policy shape', () => {
    const policy: SputnikPolicy = {
      roles: [
        { name: 'stewards', kind: { Group: ['commoncircle-light-steward.testnet', 'commoncircle-light-lender.testnet'] }, permissions: ['*:*'] },
        { name: 'members-may-ask', kind: 'Everyone', permissions: ['call:AddProposal', 'transfer:AddProposal'] },
      ],
      default_vote_policy: { weight_kind: 'RoleWeight', quorum: '0', threshold: [1, 2] },
      proposal_bond: '100000000000000000000000',
      proposal_period: '3600000000000',
    }
    expect(stewardsOf(policy)).toEqual(['commoncircle-light-lender.testnet', 'commoncircle-light-steward.testnet'])
  })

  it('offers "file proposal" only for open treasury loans without a live proposal', () => {
    const loans = [loan('6', 'Open'), loan('7', 'Open'), loan('8', 'Funded'), { ...loan('9', 'Open'), lender_id: 'someone.testnet' }]
    const proposals = [{ ...base, status: 'InProgress', kind: treasuryFundProposal({ usdcId: USDC, circleContractId: CIRCLE, loanId: '6', amount: '1', borrowerId: 'b' }).proposal.kind }]
    expect(loansNeedingProposal(loans, DAO, 'b.testnet', proposals).map((l) => l.loan_id)).toEqual(['7'])
  })

  it('echoes the stored proposal kind and attaches 300 Tgas when a steward approves', async () => {
    const sent: Array<{ receiverId: string; actions: FunctionCallAction[] }> = []
    const dao = new SputnikDaoClient('https://rpc.invalid', DAO, { signAndSendTransaction: async (tx) => { sent.push(tx); return {} } })
    const kind = treasuryFundProposal({ usdcId: USDC, circleContractId: CIRCLE, loanId: '6', amount: '1000000', borrowerId: 'b' }).proposal.kind
    await dao.approve({ ...base, id: 3, kind })
    expect(sent[0].receiverId).toBe(DAO)
    expect(sent[0].actions[0].params).toEqual({ methodName: 'act_proposal', args: { id: 3, action: 'VoteApprove', proposal: kind }, gas: '300000000000000', deposit: '0' })
  })
})

describe('F-09 repayment notices', () => {
  const outcome = (repaymentFailed: number): FtTransferCallOutcome => ({
    txHash: null, unusedAmount: null, events: [], refunded: [], funded: [], fundingFailed: [], repayment: [], repaid: [],
    repaymentFailed: Array.from({ length: repaymentFailed }, () => ({ standard: 'commoncircle', version: '1.0.0', event: 'loan_repayment_failed', data: [] })),
  })
  it('explains a bounced repayment', () => {
    expect(repaymentNotice(outcome(1), null)).toMatch(/bounced/)
  })
  it('explains late and overdue loans, and stays quiet once the flag is cleared', () => {
    expect(repaymentNotice(null, { ...loan('4', 'Repaid'), repaid_on_time: false })).toMatch(/late/)
    expect(repaymentNotice(null, { ...loan('4', 'Funded'), overdue: true })).toMatch(/overdue/)
    expect(repaymentNotice(null, { ...loan('4', 'Repaid'), repaid_on_time: false, flag_cleared: true })).toBeNull()
  })
})

describe('amounts and 1.1.1 text rules', () => {
  it('converts USDC exactly, without floating point', () => {
    expect(usdcToBaseUnits('1')).toBe('1000000')
    expect(usdcToBaseUnits('2.5')).toBe('2500000')
    expect(usdcToBaseUnits('0.000001')).toBe('1')
    expect(() => usdcToBaseUnits('1.0000001')).toThrow()
    expect(formatUsdc('2500000')).toBe('2.5')
  })

  it('rejects the same hidden and direction-changing characters as the contract', () => {
    for (const bad of ['a​b', 'a‮b', 'a⁦b', '﻿a', 'a؜b', 'a\u0007b', 'a\u0085b']) expect(isPlainText(bad)).toBe(false)
    expect(isPlainText('The Dogs (DEMO) é 🐶')).toBe(true)
    expect(() => assertCircleName(' padded')).toThrow(/spaces/)
    expect(() => assertCircleName('Dogs‮')).toThrow(/hidden/)
    expect(() => assertTagline('x'.repeat(33))).toThrow(/32/)
  })
})

const base: SputnikProposal = {
  id: 0, proposer: 'b.testnet', description: '', kind: {}, status: 'Approved', vote_counts: {}, votes: {}, submission_time: '0',
}

function loan(id: string, state: LoanView['state']): LoanView {
  return {
    loan_id: id, circle_id: '3', borrower_id: 'b.testnet', lender_id: DAO, lender_is_treasury: true, principal: '1000000',
    total_repaid: '0', outstanding: '1000000', duration_days: 7, duration_sec: '420', created_at: '0', funding_deadline: '0',
    funded_at: null, due_at: null, repaid_at: null, state, cancel_reason: null, funded_via: null, overdue: false,
    repaid_on_time: null, qualifying: null, flag_cleared: false,
  }
}

describe('an open vote that can no longer do anything says so', () => {
  const NOW = 1_800_000_000_000
  const deadline = (ms: number) => (BigInt(ms) * 1_000_000n).toString()
  it('a fund vote for a cancelled, lapsed or already funded loan', () => {
    expect(staleProposalNote('InProgress', 'fund', loan('13', 'Cancelled'), NOW)).toBe('loan #13 was cancelled, so this vote can no longer pay it')
    expect(staleProposalNote('InProgress', 'fund', { ...loan('7', 'Open'), funding_deadline: deadline(NOW - 1) }, NOW)).toBe('loan #7 passed its funding deadline, so this vote can no longer pay it')
    expect(staleProposalNote('InProgress', 'fund', loan('6', 'Repaid'), NOW)).toBe('loan #6 is already repaid')
  })
  it('a forgive vote whose late mark is already cleared', () => {
    expect(staleProposalNote('InProgress', 'clear_flag', { ...loan('4', 'Repaid'), flag_cleared: true }, NOW)).toBe('the late mark on loan #4 was already forgiven')
    expect(staleProposalNote('InProgress', 'clear_flag', loan('19', 'Repaid'), NOW)).toBeNull()
  })
  it('says nothing for a live vote, a finished vote or an unknown loan', () => {
    expect(staleProposalNote('InProgress', 'fund', { ...loan('8', 'Open'), funding_deadline: deadline(NOW + 60_000) }, NOW)).toBeNull()
    expect(staleProposalNote('Approved', 'fund', loan('13', 'Cancelled'), NOW)).toBeNull()
    expect(staleProposalNote('InProgress', 'fund', null, NOW)).toBeNull()
    expect(staleProposalNote('InProgress', null, loan('13', 'Cancelled'), NOW)).toBeNull()
  })
})
