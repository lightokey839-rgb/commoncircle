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
      throw new ChatApiError(0, 'The chat server is not reachable. Start it with npm run auth.')
    }
    const body = await response.json().catch(() => ({})) as T & { error?: string }
    if (!response.ok) throw new ChatApiError(response.status, body.error ?? `Chat request failed (${response.status})`)
    return body
  }

  async list(circleId: string, after = 0): Promise<ChatMessage[]> {
    return (await this.call<{ messages: ChatMessage[] }>(`/chat/${circleId}/messages?after=${after}`)).messages
  }

  async send(circleId: string, text: string): Promise<ChatMessage> {
    return (await this.call<{ message: ChatMessage }>(`/chat/${circleId}/messages`, { method: 'POST', body: JSON.stringify({ text }) })).message
  }
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
