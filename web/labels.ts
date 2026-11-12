// Friendly labels for NEAR accounts. Passports carry no nickname (docs/CIRCLE_INTERFACE.md
// section 6.1), so a member is shown as a deterministic avatar plus a shortened account;
// the full account is in the tooltip and is copied on click.

const NETWORK_SUFFIX = /\.(testnet|near)$/

/**
 * First 6 and last 6 characters of the account name. The network suffix (".testnet")
 * is dropped first, because every account in the app has it and "…estnet" says nothing.
 *   "commoncircle-light-lender.testnet" -> "common…lender"
 *   "254edye5v.testnet"                 -> "254edye5v"
 */
export function memberLabel(accountId: string): string {
  const name = accountId.replace(NETWORK_SUFFIX, '')
  return name.length > 13 ? `${name.slice(0, 6)}…${name.slice(-6)}` : name
}

export type Tier = 'Member' | 'Trusted' | 'Steward'

/** Badge text and class for a display tier; one place so every badge looks the same. */
export function badgeFor(tier: Tier): { text: Tier; className: string } {
  return { text: tier, className: `badge badge-${tier.toLowerCase()}` }
}
