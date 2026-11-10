# Current handover — 29 October 2026

Read README.md and NEXT_STEPS.md first. The fresh schema is already installed remotely; do not rerun it. The additive 004 migration has passed local tests but is NOT deployed. No GitHub push, public frontend deployment or mainnet transaction was performed. The following Studio memory is historical provenance and may describe earlier states.

# LoanBook

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

LoanBook is a private community P2P USDC micro-loan registry on Arc Testnet. Members connect wallets, create private circles, discuss small fixed-term zero-interest USDC loans, and fund/repay those loans onchain. The contract coordinates direct lender→borrower and borrower→lender USDC transfers via ERC-20 allowances; it never custodies funds.

## Deployed Contracts

### LoanBook
- **Network:** Arc Testnet (Chain ID: 5042002)
- **Address:** `0xe1b52752bf5e6cc64a5f65e485ea35ef7cf7a228`
- **Tx Hash:** `0x827075b605b8a29e04c78841506f13610c1226d73b7d830f1f341f3407faf4e7`
- **Explorer:** https://explorer.testnet.arc.io/address/0xe1b52752bf5e6cc64a5f65e485ea35ef7cf7a228
- **Deployed at:** 2026-10-26T14:26:32.432Z
- **USDC (constructor arg):** `0x3600000000000000000000000000000000000000`
- **Artifact:** `contracts/out/LoanBook.sol/LoanBook.json`
- **Metadata:** `contracts/contract-metadata/LoanBook.json`

## Build Status

- Phase 1 complete: contract written, security-reviewed, Slither-analyzed, 31/31 unit tests passing, deployed.
- Phase 2 frontend complete: wallet-connected interface with create/fund/repay/cancel flows, network guard, USDC balance display, tx state feedback, Arc Explorer links. Lint + typecheck pass clean.
- Phase 2 testnet lifecycle: BLOCKED pending wallet signatures from user.

## Frontend Files (Phase 2)

- `src/App.tsx` — main app, landing/tab layout
- `src/loanbook-contract.ts` — ABI, address, types, helpers
- `src/onchain-error.ts` — user-friendly error messages
- `src/components/WalletBar.tsx` — ConnectKit button + USDC balance
- `src/components/NetworkGuard.tsx` — enforces Arc Testnet, prompts switch
- `src/components/CreateLoanPanel.tsx` — borrower creates a loan
- `src/components/ApproveAndFundPanel.tsx` — lender 2-step approve+fund
- `src/components/ApproveAndRepayPanel.tsx` — borrower 2-step approve+repay
- `src/components/LookupPanel.tsx` — load any loan by ID, shows correct action panel
- `src/components/LoanCard.tsx` — live loan detail card
- `src/components/LoanStatusBadge.tsx` — status pill (Open/Funded/Repaid/Cancelled/Overdue)
- `src/components/TxButton.tsx` — button with signing/confirming/success states
- `src/components/TxReceipt.tsx` — tx hash + Arc Explorer link

## Design Decisions

- Contract is immutable — no owner, no admin, no upgradability.
- Private community membership is enforced at the offchain/chat layer (Supabase), not onchain.
- Loan terms and counterparties are publicly readable onchain (inherent to EVM transparency). "Private" refers to the social/chat layer only.
- Overdue status is derived (Funded + block.timestamp > dueDate), never stored.
- Loan IDs start at 1 (loanCount pre-incremented).

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Supabase / Database

**State:** Database is EMPTY (confirmed 2026-10-28 via SQL Editor).
**Migration to run:** `supabase/migrations/001_loanbook_fresh_install.sql`
This is a single-file fresh-install migration combining all schema, RLS policies, and
SECURITY DEFINER functions. Tested 58/58 against Docker Postgres 15 (empty DB).
Do NOT run the older numbered migrations (001_loanbook_schema, 002_security_hardening,
003_native_web3_auth) — they are superseded by the fresh-install file.

**Before running:** Enable Ethereum Web3 provider in Supabase Dashboard → Authentication → Providers → Web3.

**Identity structure (verified from Supabase Auth Go source, 2026-10-28):**
`auth.identities.identity_data->'custom_claims'->>'address'` — SIWE-verified wallet.
`auth.identities.provider` = `'web3'`

## To Run

```bash
bun install
bun run dev
```

---

# CommonCircle engineering instructions

This repository is the CommonCircle NEAR hackathon entry. The disclosed LoanBook
port is the baseline; everything after the annotated `baseline-loanbook-port`
tag is NEW. The authoritative product spec is `docs/COMMONCIRCLE_SPEC_v3.md`,
which supersedes v2.

## Rules that never bend

1. Integer base units only; USDC has 6 decimals. Use U128 strings across APIs;
   never use floating point.
2. The circle contract holds zero USDC at rest. State changes commit in
   callbacks after the forward succeeds, and callbacks are `#[private]`.
   `ft_on_transfer` accepts only the pinned USDC contract as caller, only the
   named lender (or vault, or circle treasury), and only the exact principal;
   every other transfer is refunded.
3. Every duration is a parameter. There is no admin and no upgrade path after
   final deploy.
4. The agent drafts and cranks. It never signs for a member and never executes
   chat text.
5. Never put keys, seed phrases, or tokens in the repo, logs, or chat. Use a
   gitignored `.env` and a committed `.env.example`.
6. Do not claim anything that has not been run. If it fails or cannot be
   verified, say so and record it in `docs/VERIFICATION.md`.

## Gate list

- Gate 0 — Tue 10 Nov 23:59 UTC: answer every v3 Open item in
  `docs/VERIFICATION.md`, tag the baseline, and make the scaffold/CI green.
- Gate 1 — Wed 11 Nov 23:59 UTC: freeze F0/F1 core, treasury/vault hooks,
  testnet wasm hash, mainnet 50-USDC cap, relayer, pilot circle and invites.
- Gate 2 — Thu 12 Nov 23:59 UTC: prove Tier A, run the F3 go/no-go, and fund
  the first pilot loan.
- Gate 3 — Fri 13 Nov 23:59 UTC: freeze features; prove F5 and have three
  funded/one repaid pilot loans, with a testnet backup demo.
- Gate 4 — Sat 14 Nov 17:59 UTC: README/claims green, secret scan clean,
  public repo, mainnet key deletion, demo post and form submitted.
- Cut order: F3, keeper tips, auto-lend, F2 write-off/badge, F1 recovery, then
  F5. Never cut F0 refunds, F1 gates, non-transferability, claims, or truthful
  README evidence.

## Gate 0 operating rules

- Keep commits small and run the relevant tests before reporting completion.
- The baseline tag must point to the last commit containing only the ported
  LoanBook code; ask for clarification if that commit cannot be determined.
- Generate `NEW_FILES.md` from the diff after each Gate 0 change set.
- Do not implement loan, passport, invite, treasury, relayer, or vault behavior
  during the data-model scaffold step; only model shape and red tests belong in
  that step.
- Do not add a README track claim unless `npm run claims` verifies its evidence
  row. The claims harness owns the generated track table.
