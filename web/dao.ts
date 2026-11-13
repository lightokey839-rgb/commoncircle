import { rpcPost } from './rpc'

export const SPUTNIK_GLOBAL_HASH = 'Ea8tHXFSQVszVwGASyzAfLq65DjcRDhkfab4FcPaRpgD'
const EMPTY_CODE_HASH = '11111111111111111111111111111111'

type AccountView = { code_hash?: string; global_contract_hash?: string }
type AccessKeyView = { keys?: Array<{ public_key?: string }> }

/** The parts of a Sputnik v2 policy (get_policy) the trust check reads. */
export type VotePolicyJson = { weight_kind?: string; quorum?: string; threshold?: [number, number] | string }
export type PolicyRoleJson = {
  name: string
  kind: 'Everyone' | { Group: string[] } | { Member: string } | Record<string, unknown>
  permissions: string[]
  vote_policy?: Record<string, VotePolicyJson>
}
export type PolicyJson = { roles: PolicyRoleJson[]; default_vote_policy: VotePolicyJson }

export type DaoTrustSnapshot = {
  daoId: string
  expectedHash: string
  codeHash: string | null
  accessKeyCount: number | null
  /** null = not checked (no steward list given), else the result of evaluateDaoPolicy. */
  policyOk: boolean | null
  policyReason: string
  verified: boolean
  message: string
}

/** The proposal kinds a role can approve: permissions are "kind:action" with "*" wildcards. */
function approveKinds(permissions: string[]): string[] {
  const kinds: string[] = []
  for (const p of permissions) {
    const [kind, action] = p.split(':')
    if (action === '*' || action === 'VoteApprove') kinds.push(kind)
  }
  return kinds
}

/** Approvals Sputnik needs from a role of `total` equal-weight members (sputnikdao2 VotePolicy::threshold). */
export function requiredApprovals(policy: VotePolicyJson, total: number): number {
  const quorum = Number(policy.quorum ?? '0')
  const t = policy.threshold
  const byThreshold = Array.isArray(t)
    ? Math.min(Math.floor((t[0] * total) / Math.max(1, t[1])) + 1, total)
    : Math.min(Number(t ?? '0'), total)
  return Math.max(quorum, byThreshold)
}

/**
 * The circle promises: treasury money moves only when *both* (all) circle stewards vote yes.
 * True only if every role that can approve anything is a group whose members are exactly
 * the circle's active stewards, votes count one per member (RoleWeight), and every vote
 * policy that role can use needs all of them. At least two stewards.
 */
export function evaluateDaoPolicy(policy: PolicyJson, stewards: string[]): { ok: boolean; reason: string } {
  const want = [...new Set(stewards)].sort()
  if (want.length < 2) return { ok: false, reason: 'the circle has fewer than two stewards' }
  let approvers = 0
  for (const role of policy.roles ?? []) {
    const kinds = approveKinds(role.permissions ?? [])
    if (!kinds.length) continue
    approvers++
    const group = typeof role.kind === 'object' && role.kind && 'Group' in role.kind ? (role.kind as { Group: string[] }).Group : null
    if (!group) return { ok: false, reason: `role "${role.name}" can approve proposals but is not a fixed group of stewards` }
    const members = [...new Set(group)].sort()
    if (members.join(',') !== want.join(',')) return { ok: false, reason: `role "${role.name}" (${members.join(', ')}) is not exactly the circle's stewards (${want.join(', ')})` }
    const policies: Array<[string, VotePolicyJson]> = [['default', policy.default_vote_policy ?? {}], ...Object.entries(role.vote_policy ?? {})]
    for (const [kind, vp] of policies) {
      // An override for a kind this role cannot approve does not matter.
      if (kind !== 'default' && !kinds.includes('*') && !kinds.includes(kind)) continue
      if ((vp.weight_kind ?? 'RoleWeight') !== 'RoleWeight') return { ok: false, reason: `votes for ${kind} proposals are weighted by tokens, not one per steward` }
      const need = requiredApprovals(vp, members.length)
      if (need < members.length) return { ok: false, reason: `${kind} proposals pass with ${need} of ${members.length} steward votes` }
    }
  }
  if (!approvers) return { ok: false, reason: 'no role can approve proposals' }
  return { ok: true, reason: `every approval needs all ${want.length} stewards` }
}

export function evaluateDaoTrust(input: {
  daoId: string
  account: AccountView | null
  accessKeys: AccessKeyView | null
  expectedHash?: string
  /** Pass both to also check the voting rules; without them policyOk is null and verified stays false. */
  policy?: PolicyJson | null
  stewards?: string[]
}): DaoTrustSnapshot {
  const expectedHash = input.expectedHash ?? SPUTNIK_GLOBAL_HASH
  const codeHash = input.account?.global_contract_hash
    ?? (input.account?.code_hash && input.account.code_hash !== EMPTY_CODE_HASH ? input.account.code_hash : null)
  const accessKeyCount = input.accessKeys?.keys?.length ?? null
  const codeOk = codeHash === expectedHash && accessKeyCount === 0
  const policyCheck = input.policy && input.stewards ? evaluateDaoPolicy(input.policy, input.stewards) : null
  const verified = codeOk && !!policyCheck?.ok
  return {
    daoId: input.daoId,
    expectedHash,
    codeHash,
    accessKeyCount,
    policyOk: policyCheck ? policyCheck.ok : null,
    policyReason: policyCheck?.reason ?? 'voting rules not checked',
    verified,
    message: verified
      ? `Sputnik DAO · no keys · ${policyCheck.reason}`
      : !codeOk
        ? 'DAO trust check failed: treasury controls are disabled until the pinned code hash and empty key list both verify.'
        : `DAO trust check failed: ${policyCheck?.reason ?? 'its voting rules could not be checked'}.`,
  }
}

async function rpcQuery<T>(rpcUrl: string, params: Record<string, unknown>): Promise<T> {
  const { ok, payload: body } = await rpcPost<{ result?: T; error?: unknown }>(rpcUrl, { jsonrpc: '2.0', id: 'commoncircle-dao-check', method: 'query', params })
  if (!ok || body.error || body.result === undefined) throw new Error('NEAR RPC DAO trust check failed.')
  return body.result
}

function encodeBase64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Code hash, keys and voting rules. `stewards` = the circle's active stewards, read from its passports. */
export async function loadDaoTrust(rpcUrl: string, daoId: string, stewards: string[], expectedHash = SPUTNIK_GLOBAL_HASH): Promise<DaoTrustSnapshot> {
  try {
    const [account, accessKeys, policyRaw] = await Promise.all([
      rpcQuery<AccountView>(rpcUrl, { request_type: 'view_account', finality: 'final', account_id: daoId }),
      rpcQuery<AccessKeyView>(rpcUrl, { request_type: 'view_access_key_list', finality: 'final', account_id: daoId }),
      rpcQuery<{ result?: number[] }>(rpcUrl, { request_type: 'call_function', finality: 'final', account_id: daoId, method_name: 'get_policy', args_base64: encodeBase64('{}') }),
    ])
    const policy = policyRaw.result ? JSON.parse(new TextDecoder().decode(new Uint8Array(policyRaw.result))) as PolicyJson : null
    return evaluateDaoTrust({ daoId, account, accessKeys, expectedHash, policy, stewards })
  } catch (error) {
    return {
      daoId,
      expectedHash,
      codeHash: null,
      accessKeyCount: null,
      policyOk: null,
      policyReason: 'not checked',
      verified: false,
      message: error instanceof Error ? error.message : 'NEAR RPC DAO trust check failed.',
    }
  }
}
