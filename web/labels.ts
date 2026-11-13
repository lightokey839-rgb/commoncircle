// Friendly labels for NEAR accounts. Passports carry no nickname (docs/CIRCLE_INTERFACE.md
// section 6.1), so a member is shown as a deterministic avatar plus a shortened account;
// the full account is in the tooltip and is copied on click.

const NETWORK_SUFFIX = /\.(testnet|near)$/

const MAX = 16

/**
 * A readable name for an account. The network suffix (".testnet") is dropped, because
 * every account in the app has it. Short names stay whole. A sub-account shows its own
 * first part. A long hyphenated name keeps its last whole words, which are the part
 * people tell apart. Anything else keeps its start and end.
 *   "254edye5v.testnet"                    -> "254edye5v"
 *   "commoncircle-light-lender.testnet"    -> "…light-lender"
 *   "dogs-dao.commoncircle-light.testnet"  -> "dogs-dao"
 *   64-hex implicit account                -> "3e2210e1…fcb8af"
 */
export function memberLabel(accountId: string): string {
  const name = accountId.replace(NETWORK_SUFFIX, '')
  if (name.length <= MAX) return name
  const first = name.split('.')[0]
  if (first !== name && first.length >= 3 && first.length <= MAX) return first
  const words = first.split('-')
  if (words.length > 1) {
    let tail = words[words.length - 1]
    for (let i = words.length - 2; i >= 0 && `${words[i]}-${tail}`.length <= MAX - 1; i--) tail = `${words[i]}-${tail}`
    if (tail.length >= 4) return `…${tail.slice(-(MAX - 1))}`
  }
  return `${name.slice(0, 8)}…${name.slice(-6)}`
}

export type Tier = 'Member' | 'Trusted' | 'Steward'

/** Badge text and class for a display tier; one place so every badge looks the same. */
export function badgeFor(tier: Tier): { text: Tier; className: string } {
  return { text: tier, className: `badge badge-${tier.toLowerCase()}` }
}
