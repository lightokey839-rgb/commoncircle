import { describe, expect, it } from 'vitest'
import { evaluateDaoTrust, SPUTNIK_GLOBAL_HASH } from '../web/dao'
import {
  clearFlagProposal, formatUsdc, loansNeedingProposal, proposalLoanId, repaymentNotice, stewardsOf, treasuryFundProposal,
  usdcToBaseUnits, SputnikDaoClient, type SputnikPolicy, type SputnikProposal,
} from '../web/treasury'
import { assertCircleName, assertTagline, isPlainText } from '../web/text-rules'
import type { FtTransferCallOutcome, FunctionCallAction, LoanView } from '../web/circle-client'

const DAO = 'dogs-dao.commoncircle-light.testnet'
const CIRCLE = 'commoncircle-light.testnet'
const USDC = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af'

describe('F-06 DAO trust check', () => {
  it('passes only a Sputnik global-hash DAO with no keys (the live demo DAO)', () => {
    const ok = evaluateDaoTrust({
      daoId: DAO,
      account: { code_hash: '11111111111111111111111111111111', global_contract_hash: SPUTNIK_GLOBAL_HASH },
      accessKeys: { keys: [] },
    })
    expect(ok.verified).toBe(true)
    expect(ok.message).toBe('Sputnik DAO · no keys')
  })

  it('accepts the same code deployed locally (code_hash)', () => {
    expect(evaluateDaoTrust({ daoId: DAO, account: { code_hash: SPUTNIK_GLOBAL_HASH }, accessKeys: { keys: [] } }).verified).toBe(true)
  })

  it('fails when the account still has a key, even with the right code', () => {
    const r = evaluateDaoTrust({ daoId: DAO, account: { global_contract_hash: SPUTNIK_GLOBAL_HASH }, accessKeys: { keys: [{ public_key: 'ed25519:x' }] } })
    expect(r.verified).toBe(false)
    expect(r.accessKeyCount).toBe(1)
  })

  it('fails for a plain account or different code', () => {
    expect(evaluateDaoTrust({ daoId: DAO, account: { code_hash: '11111111111111111111111111111111' }, accessKeys: { keys: [] } }).verified).toBe(false)
    expect(evaluateDaoTrust({ daoId: DAO, account: { code_hash: 'SomethingElse' }, accessKeys: { keys: [] } }).verified).toBe(false)
  })

  it('fails closed when RPC data is missing', () => {
    expect(evaluateDaoTrust({ daoId: DAO, account: null, accessKeys: null }).verified).toBe(false)
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
    unusedAmount: null, events: [], refunded: [], funded: [], fundingFailed: [], repayment: [], repaid: [],
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
