// NEAR testnet JSON-RPC with fallbacks, retry and backoff.
//
// Every endpoint below was checked alive from a browser origin on 2026-11-13
// (get_config on commoncircle-light.testnet answered, CORS allowed). Dead or
// discontinued ones (rpc.testnet.pagoda.co, *.lava.build) are left out.
export const TESTNET_RPCS = [
  'https://test.rpc.fastnear.com',
  'https://rpc.testnet.near.org',
  'https://near-testnet.drpc.org',
] as const

export type RpcHealth = { ok: boolean; endpoint: string; lastOkAt: number; lastError: string }
type Listener = (health: RpcHealth) => void

const listeners = new Set<Listener>()
let health: RpcHealth = { ok: true, endpoint: TESTNET_RPCS[0], lastOkAt: 0, lastError: '' }
/** The endpoint that answered last; tried first next time so a dead primary costs one timeout, not one per call. */
let sticky: string | null = null

export function rpcHealth(): RpcHealth { return health }
export function onRpcHealth(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function setHealth(next: RpcHealth): void {
  const changed = next.ok !== health.ok || next.endpoint !== health.endpoint
  health = next
  if (changed || next.ok) for (const l of listeners) l(health)
}

/** The order to try: the last good endpoint, the configured one, then the other known testnet endpoints. */
export function endpointsFor(primary: string): string[] {
  const known = (TESTNET_RPCS as readonly string[]).includes(primary)
  if (!known) return [primary] // a custom RPC (tests, local node): never wander off to public ones
  const order = [sticky, primary, ...TESTNET_RPCS].filter((u): u is string => !!u)
  return [...new Set(order)]
}

type JsonRpcError = { name?: string; cause?: { name?: string }; data?: unknown; message?: string }

/** Errors worth trying another endpoint for. A contract panic or unknown account is an answer, not an outage. */
export function isRetryable(status: number, error: JsonRpcError | undefined): boolean {
  if (status === 429 || status >= 500) return true
  if (!error) return false
  const cause = error.cause?.name ?? ''
  return error.name === 'INTERNAL_ERROR' || /TIMEOUT|NO_SYNCED_BLOCKS|UNAVAILABLE_SHARD|NOT_SYNCED/.test(cause)
}

export type RpcOptions = { fetchImpl?: typeof fetch; delays?: number[]; timeoutMs?: number }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * POST one JSON-RPC body. Tries each endpoint in turn; when a whole round fails,
 * waits (backoff) and tries again. Returns the first real answer (success or a
 * non-retryable error body) as { status, ok, payload } so callers keep their
 * own error handling.
 */
export async function rpcPost<T = unknown>(primary: string, body: unknown, options: RpcOptions = {}): Promise<{ status: number; ok: boolean; payload: T }> {
  const doFetch = options.fetchImpl ?? fetch
  const delays = options.delays ?? [0, 600, 1800]
  const timeoutMs = options.timeoutMs ?? 10_000
  let lastError: unknown = null
  for (const delay of delays) {
    if (delay) await sleep(delay)
    for (const url of endpointsFor(primary)) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
      try {
        const response = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          ...(controller ? { signal: controller.signal } : {}),
        })
        const payload = await response.json() as T & { error?: JsonRpcError }
        if (isRetryable(response.status, payload?.error)) { lastError = new Error(`NEAR RPC view failed (${url}: ${response.status})`); continue }
        sticky = url
        setHealth({ ok: true, endpoint: url, lastOkAt: Date.now(), lastError: '' })
        return { status: response.status, ok: response.ok, payload }
      } catch (error) {
        lastError = error
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : 'NEAR RPC view failed'
  setHealth({ ...health, ok: false, lastError: message })
  throw new Error(/Failed to fetch|NetworkError|Load failed|abort/i.test(message) ? `Failed to fetch NEAR testnet (${message})` : message)
}

/** A read-only contract view through rpcPost. */
export async function viewFunction(primary: string, accountId: string, methodName: string, argsBase64: string, options?: RpcOptions): Promise<{ ok: boolean; payload: { result?: { result?: number[] }; error?: { cause?: { name?: string }; data?: string } } }> {
  return rpcPost(primary, {
    jsonrpc: '2.0', id: `${methodName}-${Date.now()}`, method: 'query',
    params: { request_type: 'call_function', finality: 'final', account_id: accountId, method_name: methodName, args_base64: argsBase64 },
  }, options)
}

/** Test hook. */
export function resetRpcState(): void {
  sticky = null
  health = { ok: true, endpoint: TESTNET_RPCS[0], lastOkAt: 0, lastError: '' }
}
