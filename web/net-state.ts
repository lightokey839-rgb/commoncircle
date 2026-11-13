// One place that knows how fresh the app's NEAR testnet data is.
//
//   connecting -> connected                       (first read worked)
//   connected  -> degraded                        (some reads failed, others worked)
//   connected  -> offline / stale                 (a full refresh failed; stale if we
//                                                 still have data from an earlier read)
//   any        -> connected                       (a full refresh worked again)
//
// Read-only pages may keep showing stale data (labelled with its time). Money actions
// never rely on it: they re-read the chain first (see requireFresh in app.ts).

export type NetPhase = 'connecting' | 'connected' | 'degraded' | 'offline' | 'stale'

export type NetState = {
  phase: NetPhase
  /** Last time a full refresh succeeded (ms), 0 = never. */
  lastOkAt: number
  /** Parts that failed in the last refresh (e.g. "DAO treasury balance"). */
  partial: string[]
  /** Plain reason of the last failure. */
  error: string
  /** Consecutive failed refreshes (drives the retry backoff). */
  failures: number
}

export const RETRY_MS = [5_000, 15_000, 30_000, 60_000] as const
/** Data older than this is called stale even if no refresh failed. */
export const STALE_AFTER_MS = 2 * 60_000

export const initialNet = (): NetState => ({ phase: 'connecting', lastOkAt: 0, partial: [], error: '', failures: 0 })

export function netSucceeded(_state: NetState, now: number, partial: string[] = []): NetState {
  return { phase: partial.length ? 'degraded' : 'connected', lastOkAt: now, partial, error: '', failures: 0 }
}

export function netFailed(state: NetState, error: string): NetState {
  return { ...state, phase: state.lastOkAt ? 'stale' : 'offline', error, failures: state.failures + 1 }
}

/** Delay before the next automatic retry; bounded, never faster than 5 s. */
export function retryDelay(state: NetState): number {
  return RETRY_MS[Math.min(Math.max(state.failures - 1, 0), RETRY_MS.length - 1)]
}

/** Is the data on screen too old to act on? */
export function isStale(state: NetState, now: number): boolean {
  return state.phase === 'stale' || state.phase === 'offline' || state.phase === 'connecting' || (state.lastOkAt > 0 && now - state.lastOkAt > STALE_AFTER_MS)
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Short label for the status pill and a sentence for the banner. */
export function describeNet(state: NetState, now: number): { pill: string; tone: 'ok' | 'warn' | 'bad' | 'idle'; banner: string | null } {
  switch (state.phase) {
    case 'connecting':
      return { pill: 'Connecting…', tone: 'idle', banner: null }
    case 'connected':
      return now - state.lastOkAt > STALE_AFTER_MS
        ? { pill: `Updated ${clock(state.lastOkAt)}`, tone: 'warn', banner: null }
        : { pill: 'Testnet live', tone: 'ok', banner: null }
    case 'degraded':
      return { pill: 'Partly updated', tone: 'warn', banner: `Some testnet reads failed (${state.partial.join(', ')}). Those parts say "unavailable"; everything else is current.` }
    case 'stale':
      return { pill: `Stale · ${clock(state.lastOkAt)}`, tone: 'bad', banner: `Can't reach NEAR testnet right now. You are seeing data from ${clock(state.lastOkAt)}, labelled stale. Money actions stay off until a fresh read works. Retrying by itself.` }
    case 'offline':
      return { pill: 'Testnet unreachable', tone: 'bad', banner: `Can't reach NEAR testnet right now${state.error ? ` (${state.error})` : ''}. Retrying by itself.` }
  }
}
