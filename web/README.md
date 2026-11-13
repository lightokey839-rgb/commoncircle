# CommonCircle web app (`web/`)

The current CommonCircle front end. Plain TypeScript, no UI framework, built by Vite
(`vite.config.ts` sets `root: 'web'`). The old LoanBook React app in `src/` is not served.

Run it (Windows PowerShell or any shell), from the repository root:

```bash
npm ci
npm run build      # writes web/dist
npm run preview    # serves http://localhost:5173
npm run auth       # second terminal: NEP-413 sign-in, members-only chat and loan requests on :3001
```

`npm run dev` also works on most machines; on the builder's PC Vite's dependency
pre-bundling stalls, so build + preview is the tested path.

## Pages

| Page | What it shows | Data |
| --- | --- | --- |
| Overview | Circle stats, the loan contract's live USDC balance (zero custody), DAO balance, demo-settings label, your steps, your card, recent activity | `loans_in_circle`, `passports_in_circle`, `get_circle`, USDC `ft_balance_of` |
| Chat | Members-only room; loan request cards with a reason, offers, "Borrow from …", Fund, Repay | sign-in server (`server/chat.ts`, `server/requests.ts`) + contract views |
| Loans / Direct loans | Your loans, requests for you, all circle loans with reasons; a direct request to a chosen member | `loans_by_borrower`, `loans_by_lender`, `create_loan`, `cancel_loan`, USDC `ft_transfer_call` |
| My Passport | Any member's passport (read-only), its stats, the exact road to Trusted from the circle params, what it unlocks, treasury eligibility | `passports_in_circle`, `card_svg`, `get_circle().params` |
| Treasury | Sputnik DAO balance, stewards, proposals and approvals; ask / approve when eligible | DAO `get_policy`, `get_proposal`; frontend DAO trust check (`dao.ts`) |
| Members | Cards, badges, counts; Invite a friend (Trusted members) | `register_invite` |
| Advanced tools | New circle (demo or standard rules), card design, raw data | `create_circle`, `set_circle_theme` |
| Evidence & Tracks | The three tracks with every claim and its PASS/FAIL | `web/evidence-status.json`, written only by `npm run claims` |

## Files

- `app.ts` – the page logic. `circle-client.ts` – typed views and calls (1.1.1).
- `near-wallet.ts` – NEAR Wallet Selector 10.1.4 (Meteor, MyNearWallet), pinned from npm.
- `money.ts` – the "check before you sign" flow for fund / repay / cancel, including the
  optional USDC registration of a lender who left the token.
- `loan-rules.ts`, `overview.ts` – pure rules and stats from the circle params (unit-tested).
- `notify.ts`, `labels.ts` – plain-language errors, member labels and badges.
- `dao.ts` – the fail-closed frontend DAO check: pinned Sputnik code hash **and** no access keys.
  The circle contract does not check this; the app does.

Money is handled as integer base units (USDC 6 decimals) in strings and BigInt.
Testnet only; there is no mainnet setting.
