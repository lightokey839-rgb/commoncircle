// Circle chat client: talks to server/auth.ts (/chat/<circle>/messages) with the
// NEP-413 sign-in token. Members only; access-controlled, not end-to-end encrypted.

export type ChatMessage = { id: number; circle_id: string; account_id: string; text: string; at: number }

export class ChatApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class ChatClient {
  readonly baseUrl: string
  readonly token: string
  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.token = token
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) },
      })
    } catch {
      throw new ChatApiError(0, unreachable(this.baseUrl))
    }
    const body = await response.json().catch(() => ({})) as T & { error?: string }
    if (!response.ok) throw new ChatApiError(response.status, body.error ?? (response.status >= 500 ? 'The chat server had a problem. Try again in a moment.' : `Chat request failed (${response.status})`))
    return body
  }

  /** after > 0: newer than `after` (polling); before > 0: older than `before` ("load earlier"); neither: latest page. */
  async list(circleId: string, after = 0, before = 0): Promise<ChatMessage[]> {
    const query = before > 0 ? `before=${before}` : `after=${after}`
    return (await this.call<{ messages: ChatMessage[] }>(`/chat/${circleId}/messages?${query}`)).messages
  }

  async send(circleId: string, text: string): Promise<ChatMessage> {
    return (await this.call<{ message: ChatMessage }>(`/chat/${circleId}/messages`, { method: 'POST', body: JSON.stringify({ text }) })).message
  }

  /* Loan request cards (server/requests.ts). amount is USDC base units. */
  async requests(circleId: string): Promise<LoanRequestCard[]> {
    return (await this.call<{ requests: LoanRequestCard[] }>(`/chat/${circleId}/requests`)).requests
  }

  async ask(circleId: string, input: { amount: string; days: number; note: string }): Promise<LoanRequestCard> {
    return (await this.call<{ request: LoanRequestCard }>(`/chat/${circleId}/requests`, { method: 'POST', body: JSON.stringify(input) })).request
  }

  async requestAction(circleId: string, id: number, verb: 'offer' | 'cancel' | 'link', loanId?: string): Promise<LoanRequestCard> {
    return (await this.call<{ request: LoanRequestCard }>(`/chat/${circleId}/requests/${id}/${verb}`, { method: 'POST', body: JSON.stringify(loanId ? { loan_id: loanId } : {}) })).request
  }

  async directNote(circleId: string, loanId: string, note: string): Promise<LoanRequestCard> {
    return (await this.call<{ request: LoanRequestCard }>(`/chat/${circleId}/requests/direct`, { method: 'POST', body: JSON.stringify({ loan_id: loanId, note }) })).request
  }
}

const isLocal = (url: string) => { try { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(url).hostname) } catch { return false } }

/** What to say when the chat server does not answer at all. */
export function unreachable(baseUrl: string): string {
  return isLocal(baseUrl)
    ? 'The chat server is not running on this computer. Start it with npm run auth.'
    : 'The chat server is not answering. Free hosting sleeps when idle, so it can take up to a minute to wake up. Try again shortly.'
}

export type ChatHealth = { ok: boolean; store?: string; shared?: boolean; durable?: boolean; delivery?: string; detail?: string }

/** GET /health without a sign-in token. Never throws. */
export async function chatServerHealth(baseUrl: string, timeoutMs = 15000): Promise<{ reachable: boolean; health: ChatHealth | null; ms: number }> {
  const started = Date.now()
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    const health = await response.json().catch(() => null) as ChatHealth | null
    return { reachable: true, health, ms: Date.now() - started }
  } catch {
    return { reachable: false, health: null, ms: Date.now() - started }
  }
}

/** Merge newly fetched messages into what is on screen: by id, no duplicates, ascending. */
export function mergeMessages(have: ChatMessage[], fresh: ChatMessage[]): ChatMessage[] {
  const byId = new Map(have.map((m) => [m.id, m]))
  for (const m of fresh) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

export type LoanRequestCard = {
  id: number; circle_id: string; borrower: string; amount: string; days: number; note: string; at: number
  offers: string[]; lender: string | null; loan_id: string | null; cancelled: boolean; direct: boolean
}

/** Stable, readable initials and colour for an account (no photos on-chain). */
export function avatarFor(accountId: string): { initials: string; hue: number } {
  const base = accountId.replace(/\.(testnet|near)$/, '').split(/[.\-_]/).filter(Boolean)
  const last = base[base.length - 1] ?? accountId
  const initials = (base.length > 1 ? base[0][0] + last[0] : last.slice(0, 2)).toUpperCase()
  let hash = 0
  for (const ch of accountId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return { initials, hue: hash % 360 }
}

export function timeLabel(at: number, now = Date.now()): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const today = new Date(now).toDateString() === d.toDateString()
  return today ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
}

export function dayLabel(at: number, now = Date.now()): string {
  const d = new Date(at)
  const today = new Date(now)
  const yesterday = new Date(now - 86_400_000)
  if (d.toDateString() === today.toDateString()) return `Today, ${d.toLocaleDateString([], { day: 'numeric', month: 'long' })}`
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}
