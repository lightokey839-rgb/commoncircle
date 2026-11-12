export const SPUTNIK_GLOBAL_HASH = 'Ea8tHXFSQVszVwGASyzAfLq65DjcRDhkfab4FcPaRpgD'
const EMPTY_CODE_HASH = '11111111111111111111111111111111'

type AccountView = { code_hash?: string; global_contract_hash?: string }
type AccessKeyView = { keys?: Array<{ public_key?: string }> }

export type DaoTrustSnapshot = {
  daoId: string
  expectedHash: string
  codeHash: string | null
  accessKeyCount: number | null
  verified: boolean
  message: string
}

export function evaluateDaoTrust(input: {
  daoId: string
  account: AccountView | null
  accessKeys: AccessKeyView | null
  expectedHash?: string
}): DaoTrustSnapshot {
  const expectedHash = input.expectedHash ?? SPUTNIK_GLOBAL_HASH
  const codeHash = input.account?.global_contract_hash
    ?? (input.account?.code_hash && input.account.code_hash !== EMPTY_CODE_HASH ? input.account.code_hash : null)
  const accessKeyCount = input.accessKeys?.keys?.length ?? null
  const verified = codeHash === expectedHash && accessKeyCount === 0
  return {
    daoId: input.daoId,
    expectedHash,
    codeHash,
    accessKeyCount,
    verified,
    message: verified
      ? 'Sputnik DAO · no keys'
      : 'DAO trust check failed: treasury controls are disabled until the pinned code hash and empty key list both verify.',
  }
}

async function rpcQuery<T>(rpcUrl: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'commoncircle-dao-check', method: 'query', params }),
  })
  const body = await response.json() as { result?: T; error?: { cause?: unknown; data?: unknown } }
  if (!response.ok || body.error || body.result === undefined) throw new Error('NEAR RPC DAO trust check failed.')
  return body.result
}

export async function loadDaoTrust(rpcUrl: string, daoId: string, expectedHash = SPUTNIK_GLOBAL_HASH): Promise<DaoTrustSnapshot> {
  try {
    const [account, accessKeys] = await Promise.all([
      rpcQuery<AccountView>(rpcUrl, { request_type: 'view_account', finality: 'final', account_id: daoId }),
      rpcQuery<AccessKeyView>(rpcUrl, { request_type: 'view_access_key_list', finality: 'final', account_id: daoId }),
    ])
    return evaluateDaoTrust({ daoId, account, accessKeys, expectedHash })
  } catch (error) {
    return {
      daoId,
      expectedHash,
      codeHash: null,
      accessKeyCount: null,
      verified: false,
      message: error instanceof Error ? error.message : 'NEAR RPC DAO trust check failed.',
    }
  }
}
