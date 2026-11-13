> **HISTORICAL — LoanBook (Arc/EVM), October 2026.** This file describes the earlier LoanBook app this repository started from (tag `baseline-loanbook-port`). It is kept for the record and is **not** about CommonCircle on NEAR. Current documents: `README.md`, `STATUS.md`, `docs/VERIFICATION.md`, `docs/SHIP_CHECKLIST.md`, `docs/DEMO_SCRIPT.md`.

# Deployment handover

The Supabase upgrade was deployed on 29 October 2026 to project itlnfringcqusrboqqgh as migration `20261029140324_verified_community_loans`. The `verify-loan` Edge Function is active at version 1 with platform JWT verification enabled. A branch named `codex/loanbook-release-candidate` was created from the current GitHub `main` head, but source changes have not been pushed into it. No public frontend deployment has been made. Existing destinations are GitHub lightokey839-rgb/Loanbook and Supabase Loanbook project itlnfringcqusrboqqgh. Announce the exact branch and hosting destination before publishing. Do not create a replacement repository or overwrite Arc Studio history.

## Database and verifier

The fresh-install schema was already installed in the existing Supabase project and was not rerun. The additive `004_verified_community_loans.sql` migration was applied once. It adds proof fields, deployment allowlisting, explicit grants, restricted profile visibility, immutable loan binding, and service-only verified status updates without dropping tables.

The deployed verifier contains `supabase/functions/verify-loan/index.ts`, `_shared/verification.ts`, and `deno.json`. It uses the platform JWT gate, then checks the bearer token with Auth `getUser()` and performs RLS reads before creating a service client. Supabase provides server-only service-role credentials. Never expose these in VITE variables.

Enable the native Ethereum Web3 auth provider. Configure allowed SIWE/redirect origins for the actual HTTPS frontend. ALLOWED_ORIGINS must include that origin. Current verifier defaults cover localhost:5173, 127.0.0.1:5173 and https://lightokey839-rgb.github.io. No custom host is automatically trusted.

Verify migration status, grants, security advisors, and Realtime publication before testing with two authenticated clients and an outsider. Run Deno checks and integration tests before treating the verifier as production ready.

## Hosting and repository

Build with npm ci and npm run build. Publish dist to a static HTTPS host tied to the existing repository. GitHub Pages is a candidate, not yet configured; private-repository plan eligibility must be checked. For Pages use VITE_BASE_PATH=/Loanbook/. For a root hostname use /. Inject only the public Supabase URL/key and selected network/address into the build. Never upload populated .env files or telemetry logs.

Preserve existing commits; integrate through a new branch and pull request against the current main head. The existing repository was private when inspected. Confirm publication eligibility and scan history before changing visibility. Do not force-push or initialize a replacement history.

## Arc networks

| Network | Chain | RPC | Explorer |
|---|---|---|---|
| Testnet | 5042002 | https://rpc.testnet.arc.io | https://explorer.testnet.arc.io |
| Mainnet | 5042 | https://rpc.mainnet.arc.io | https://explorer.arc.io |

Official references checked during research: https://docs.arc.io/arc/references/connect-to-arc and https://docs.arc.io/arc/references/contract-addresses. USDC ERC-20 address is 0x3600000000000000000000000000000000000000 on both; ERC-20 amounts use 6 decimals, native gas accounting uses 18. They represent the same balance: reserve USDC for gas. Recheck gas estimates and official deployment guidance before broadcast: https://docs.arc.io/arc/references/gas-and-fees and https://docs.arc.io/arc/tutorials/deploy-on-arc.

Testnet address retained from Studio: 0xe1b52752bf5e6cc64a5f65e485ea35ef7cf7a228. Mainnet address deliberately blank. VITE_NETWORK=mainnet disables contract actions until VITE_MAINNET_LOANBOOK_ADDRESS is configured. A corresponding database deployment registry entry is also required.

Mainnet deployment automation and explorer verification still require completion and rehearsal. Existing Studio deployment scripts are preserved, not approved mainnet scripts. Obtain explicit user approval before every mainnet deployment, allowance, or USDC transfer. Use a wallet/keystore; never place a raw private key in shell history, source, logs, or a ZIP.
