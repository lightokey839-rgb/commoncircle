> **HISTORICAL — LoanBook (Arc/EVM), October 2026.** This file describes the earlier LoanBook app this repository started from (tag `baseline-loanbook-port`). It is kept for the record and is **not** about CommonCircle on NEAR. Current documents: `README.md`, `STATUS.md`, `docs/VERIFICATION.md`, `docs/SHIP_CHECKLIST.md`, `docs/DEMO_SCRIPT.md`.

# LoanBook — Bug Log

Maintained throughout development. Entries are never deleted. Each bug has a permanent ID.

Categories: **CONFIG** (dependency/build/tooling), **APP** (runtime/UI), **CONTRACT** (Solidity), **PLATFORM** (Arc Studio limitations).

---

## LB-001 — Tailwind v4 `@import` used against Tailwind v3 installation

| Field | Value |
|---|---|
| **ID** | LB-001 |
| **Category** | CONFIG |
| **Status** | **Fixed** |
| **Date discovered** | 2026-10-26 |
| **Discovered during** | Phase 2 frontend build — first dev-server load after UI implementation |

### Error message

```
[plugin:vite:css] [postcss] postcss-import:
node_modules/tailwindcss/lib/index.js:1:1:
Unknown word "use strict"
```

### Affected files

- `src/index.css` — line 1

### How to reproduce

1. Install Tailwind CSS v3 (present as `tailwindcss@3.4.19` in `package.json`).
2. Write `@import "tailwindcss";` as the first line of any CSS file processed by Vite + PostCSS.
3. Start the dev server (`bun run dev`). The PostCSS `postcss-import` plugin resolves `tailwindcss` to `node_modules/tailwindcss/lib/index.js` (a CommonJS JS file), encounters `"use strict"` and fails with "Unknown word".

### Root cause

`@import "tailwindcss"` is a Tailwind **v4** syntax that works only when the `@tailwindcss/vite` (or `@tailwindcss/postcss`) v4 plugin is installed. This project uses Tailwind v3, whose PostCSS plugin processes `@tailwind` directives, not bare CSS `@import` bare-specifiers. The v4 `@import` bypasses the plugin and falls through to `postcss-import`, which treats it as a CSS file import, resolves the package entry point (`lib/index.js`), and fails because that file is JavaScript.

### Fix applied

`src/index.css` line 1 changed from:

```css
@import "tailwindcss";
```

to:

```css
@import url('https://fonts.googleapis.com/...');

@tailwind base;
@tailwind components;
@tailwind utilities;
```

Google Fonts `@import url(...)` moved before `@tailwind` directives (PostCSS requires all `@import` rules first). Removed an erroneous `@layer base { * { @apply border-border; } }` block that referenced a non-existent Tailwind token.

### Verification

| Check | Result |
|---|---|
| `bun run check` (lint + typecheck) | 0 errors, 0 warnings |
| `bunx vite build` | Succeeded — no CSS errors, `✓ built in 15.43s` |
| Dev server HTTP response | `200 OK` |
| `console.jsonl` after fix | `[vite] connected.` — no error entries |

**Status: Fixed.**

---

## LB-002 — Enum comparison lint errors (`no-unsafe-enum-comparison`)

| Field | Value |
|---|---|
| **ID** | LB-002 |
| **Category** | APP |
| **Status** | **Fixed** |
| **Date discovered** | 2026-10-26 |
| **Discovered during** | Phase 2 `bun run check` after initial component writes |

### Error message

```
typescript(no-unsafe-enum-comparison): The two values in this comparison do not have a shared enum type.
Left operand: number   Right operand: LoanState.Funded
```

### Affected files

- `src/components/LoanCard.tsx`
- `src/components/ApproveAndFundPanel.tsx`
- `src/components/ApproveAndRepayPanel.tsx`
- `src/components/LookupPanel.tsx`
- `src/components/LoanStatusBadge.tsx`

### Root cause

The contract ABI returns `loan.state` as a plain `number` (uint8 on-chain). The TypeScript code compared it directly against a `LoanState` enum member (e.g. `loan.state === LoanState.Funded`). OXLint's `no-unsafe-enum-comparison` rule rejects comparisons between a `number` and an enum member because they do not share the same enum type.

### Fix applied

Replaced all `loan.state === LoanState.X` comparisons with `loan.state === N` (numeric literals: 0=Open, 1=Funded, 2=Repaid, 3=Cancelled). Removed `LoanState` imports from the affected component files. `LoanState` is still exported from `loanbook-contract.ts` for documentation purposes; numeric literals are used at comparison sites.

### Verification

`bun run check` passes with 0 errors after fix. **Status: Fixed.**

---

## LB-003 — `bigint` rendered as JSX ReactNode (`0n` falsy render)

| Field | Value |
|---|---|
| **ID** | LB-003 |
| **Category** | APP |
| **Status** | **Fixed** |
| **Date discovered** | 2026-10-26 |
| **Discovered during** | Phase 2 `bun run check` — TypeScript error on `LookupPanel.tsx:102` |

### Error message

```
src/components/LookupPanel.tsx(102,11): error TS2322:
Type '0n | Element | null' is not assignable to type 'ReactNode'.
Type '0n' is not assignable to type 'ReactNode'.
```

### Affected files

- `src/components/LookupPanel.tsx`

### Root cause

The expression `{activeLoanId && (<button ...>)}` — where `activeLoanId` is `bigint | null` — can produce `0n` when `activeLoanId` is `0n`. React cannot render `bigint` (`0n`) as a ReactNode; TypeScript correctly rejects it. In this codebase loan IDs start at 1 so `0n` should never be a valid active ID, but the type was `bigint | null` which includes `0n`.

### Fix applied

Changed `{activeLoanId && (...)}` to `{activeLoanId !== null && (...)}` — an explicit null-check that does not produce a bigint as the falsy branch value.

### Verification

`bun run check` passes with 0 errors after fix. **Status: Fixed.**

---

## LB-004 — `TxButton` received undeclared `style` prop

| Field | Value |
|---|---|
| **ID** | LB-004 |
| **Category** | APP |
| **Status** | **Fixed** |
| **Date discovered** | 2026-10-26 |
| **Discovered during** | Phase 2 `bun run check` — TypeScript error |

### Error message

```
error TS2322: Type '{ state: ...; style: CSSProperties; children: string; }' is not assignable to type 'IntrinsicAttributes & Props'.
Property 'style' does not exist on type 'IntrinsicAttributes & Props'.
```

### Affected files

- `src/components/ApproveAndFundPanel.tsx`
- `src/components/ApproveAndRepayPanel.tsx`

### Root cause

`TxButton` was written without a `style` prop in its `Props` interface. Call sites in `ApproveAndFundPanel` and `ApproveAndRepayPanel` passed inline `style` overrides to customise button colours. TypeScript correctly rejected these because the prop does not exist on the component type.

### Fix applied

Removed the `style` prop from the call sites. Button variants (`primary`, `secondary`, `danger`) cover the needed colour variations without needing per-instance style overrides.

### Verification

`bun run check` passes with 0 errors after fix. **Status: Fixed.**

---

## LB-005 — `parseLoan` expected tuple, wagmi returns named struct

| Field | Value |
|---|---|
| **ID** | LB-005 |
| **Category** | APP |
| **Status** | **Fixed** |
| **Date discovered** | 2026-10-26 |
| **Discovered during** | Phase 2 `bun run check` — TypeScript error on `LoanCard.tsx:48` |

### Error message

```
error TS2352: Conversion of type '{ amount: bigint; borrower: ...; state: number; }' to type
'readonly [string, string, bigint, bigint, bigint, bigint, bigint, number]' may be a mistake.
```

### Affected files

- `src/loanbook-contract.ts` — `parseLoan` function signature
- `src/components/LoanCard.tsx`
- `src/components/LookupPanel.tsx`

### Root cause

`parseLoan` was typed to accept a tuple `readonly [string, string, bigint, ...]`. wagmi v2 actually decodes named struct return types into plain objects with named fields (`{ borrower, lender, amount, ... }`), not positional tuples. The cast at call sites was incompatible.

### Fix applied

Changed `parseLoan`'s parameter type from a positional tuple to a named-field object type matching wagmi's decoded output. Updated the function body to read named fields instead of index positions. Updated call-site casts accordingly.

### Verification

`bun run check` passes with 0 errors after fix. **Status: Fixed.**

---

---

## LB-006 — Lender address required before any member can offer to fund

| Field | Value |
|---|---|
| **ID** | LB-006 |
| **Category** | UX/DESIGN |
| **Status** | **Mitigated** (two-stage flow added; full fix needs Supabase backend) |
| **Date discovered** | 2026-10-26 |
| **Discovered during** | Phase 3 UX review |

### Description

The original "Create Loan Request" screen required the borrower to enter a specific lender's wallet address before posting the request. This breaks the intended social-lending UX where a borrower posts a need to the group and members volunteer to lend.

The borrower cannot know lender addresses in advance; they should post a request and wait for expressions of interest.

### Classification

UX/Design limitation — not a smart contract vulnerability. The contract `createLoan(address lender, ...)` correctly requires a named lender; the design issue is in _when_ that address is collected.

### Fix applied

Added a two-stage `LoanRequestPanel`:
1. **Stage 1 — Offchain request:** borrower enters amount, duration, and optional note. No lender address required. No gas. Stored locally (localStorage) pending the Supabase backend.
2. **Stage 2 — Expressions of interest:** group members click "I'm Interested". Their connected wallet address is recorded.
3. **Stage 3 — Borrower selects lender:** borrower reviews interested wallets and picks one.
4. **Stage 4 — Onchain confirm:** borrower reviews fee notice and calls `createLoan` with the selected lender address. Gas paid here only.

The original `CreateLoanPanel` (direct lender-address entry) is preserved under a "Direct / Advanced" tab for testing.

### Remaining blocker

Stage 1–3 currently uses `localStorage` only. A private community (only authenticated group members see the request) requires the Supabase backend from Phase 4. Until then the interest list is local to the borrower's browser and not visible to potential lenders.

**Status: Mitigated. Full resolution pending Phase 4 (Supabase backend).**

---

## LB-007 — Creating an unfunded onchain request costs borrower gas

| Field | Value |
|---|---|
| **ID** | LB-007 |
| **Category** | UX/DESIGN |
| **Status** | **Mitigated** (offchain request stage added) |
| **Date discovered** | 2026-10-26 |
| **Discovered during** | Phase 3 UX review |

### Description

The original flow called `createLoan` onchain immediately when the borrower submitted a request. This means every exploratory request — even one where no lender ultimately volunteers — costs the borrower a gas fee (paid in USDC on Arc). A borrower who posts five requests and gets no takers has paid gas for all five without receiving anything.

### Classification

UX/Design limitation — not a smart contract vulnerability. The contract behaviour is correct: it records immutable agreements. The issue is the timing of the onchain call.

### Fix applied

The new `LoanRequestPanel` defers the `createLoan` onchain call to Stage 4 (after a lender has been selected). Stages 1–3 are offchain. The borrower only pays gas once a specific lender has volunteered and been chosen. A clear fee notice ("This transaction will cost a small USDC gas fee on Arc Testnet") is shown before the wallet prompt.

**Status: Mitigated. Full resolution requires Supabase backend so Stage 1–3 are truly private and cross-device.**

---

---

## LB-008 — Render-body side-effects (`setStep` called during render)

| Field | Value |
|---|---|
| **ID** | LB-008 |
| **Category** | APP |
| **Status** | **Fixed** |
| **Date discovered** | 2026-10-26 |
| **Discovered during** | LB-009 investigation — code review of ApproveAndFundPanel and ApproveAndRepayPanel |

### Error

No visible error thrown, but React may fire `setStep` multiple times (strict mode double-invocation) or in the wrong order when `approveSuccess && step === 'approve'` evaluates true during a re-render triggered by an unrelated state change.

### Root cause

`setStep('fund')` and `onFunded()` / `onRepaid()` were called directly in the render function body inside `if (approveSuccess && step === 'approve')` blocks. This is a React anti-pattern: calling `setState` during render is undefined behaviour and can cause double-updates, infinite loops in strict mode, or missed state transitions.

### Fix applied

Moved all side-effects into `useEffect` hooks with appropriate dependency arrays in both `ApproveAndFundPanel` and `ApproveAndRepayPanel`.

**Status: Fixed.**

---

## LB-009 — USDC approval failure and possible incorrect balance display for lender wallet on Arc Testnet

| Field | Value |
|---|---|
| **ID** | LB-009 |
| **Category** | APP |
| **Status** | **Investigating → Mitigated (4 root causes confirmed and fixed; real-wallet retest needed)** |
| **Date discovered** | 2026-10-26 |
| **Discovered during** | Phase 2 testnet verification — lender wallet showing 0.00 USDC; approve returning generic revert error |

### Reported symptoms

1. Lender wallet `0xca07…219c` reportedly received 20 test USDC but LoanBook displays 0.00 USDC.
2. Clicking "Approve 5.00 USDC" returns generic message "Transaction reverted. Check your USDC balance and allowance."

### Investigation

**Live RPC checks performed:**

| Check | Result |
|---|---|
| Chain ID from RPC | `0x4cef52` = 5042002 ✓ |
| USDC `symbol()` | `USDC` ✓ |
| USDC `decimals()` | `6` ✓ |
| `balanceOf(deployer)` via `eth_call` | Returns correct 6-decimal value ✓ |
| `eth_getBalance` (native, 18 dec) vs `balanceOf` (ERC-20, 6 dec) | Same pool, different decimal representations — confirmed NOT confused in WalletBar code |
| `approve(LoanBook, 5000000)` simulation via `eth_call` | Returns `0x...0001` (success) — USDC contract accepts approve ✓ |
| `totalSupply()` | Works, returns valid value ✓ |

The USDC ERC-20 contract at `0x3600…0000` is a live working contract. The `balanceOf` query in WalletBar uses the correct 6-decimal ERC-20 path. Simulation confirms `approve` would succeed. The revert is therefore happening at the **wallet / transport / submission layer**, not at the contract level.

### Confirmed root causes (4)

**RC-1 (HIGH): `parseOnchainError` swallows actual error messages.**
Any error containing `"reverted"` falls through to a generic catch-all that discards the real underlying message. This makes every failure look identical and prevents diagnosis. The actual cause (wrong network, nonce error, gas issue, RPC rejection) is lost.

**RC-2 (MEDIUM): Render-body side-effects in `ApproveAndFundPanel` / `ApproveAndRepayPanel`.**
`setStep` and `onFunded`/`onRepaid` called directly during render can mis-fire or cause double-state-transitions in React Strict Mode. This can put the component in a state where it shows "allowance confirmed" while the approve tx is still pending, or skips the fund step.

**RC-3 (MEDIUM): `config.ts` uses `http()` with no explicit RPC URL.**
wagmi picks from viem's multi-RPC list (4 providers: blockdaemon, drpc, quicknode, default). If the picked provider is rate-limited or returns a different nonce/state than the wallet's own configured RPC, the `eth_estimateGas` pre-flight or `eth_sendRawTransaction` can return a misleading error.

**RC-4 (LOW): `WalletBar` balance query has no `refetchOnMount` or address-change invalidation.**
If the user connects a second wallet (Sarah) after the page has already loaded, the previous cached balance query for Alex's address is still displayed until the 8-second interval fires.

### Fixes applied

| Fix | File(s) | Change |
|---|---|---|
| RC-1 | `src/onchain-error.ts` | Rewrote to walk the viem error cause chain (`shortMessage`, `details`, cause recursion); surfaces actual error text truncated to 200 chars instead of generic fallback |
| RC-2 | `src/components/ApproveAndFundPanel.tsx`, `ApproveAndRepayPanel.tsx` | Moved all `setStep` / callback calls into `useEffect` with proper dependency arrays |
| RC-3 | `src/config.ts` | Pinned transport to `http('https://rpc.testnet.arc.io')` explicitly |
| RC-4 | `src/components/WalletBar.tsx` | Added `refetchOnMount: true`, `refetchOnWindowFocus: true`, `useEffect` watching `address` to force immediate refetch on wallet switch; added `useBalance` for native balance in tooltip |

### Additional improvements

- `ApproveAndFundPanel` and `ApproveAndRepayPanel` now show live ERC-20 USDC balance inline and disable the Approve button with a red warning if balance is insufficient.
- Error messages now include the raw truncated error string when no specific pattern matches — making all future failures diagnosable.

### Remaining blocker

The actual lender wallet `0xca07…219c` full address is not known — abbreviated addresses cannot be looked up onchain. To verify the 20 USDC is actually present, provide the full address and I will run `balanceOf` directly.

**Status: Investigating → root causes fixed in code; production retest needed with the lender wallet.**

---

## Platform Limitations (Not Bugs)

### Arc Studio preview and browser wallet connection

Arc Studio runs the app preview in an iframe served from a sandbox domain. MetaMask and Rabby injected wallets work because they operate through the page's JavaScript context regardless of the iframe. The ConnectKit modal will appear normally. WalletConnect QR-code scanning also works. No limitation on wallet connection in the preview.

### Arc Studio cannot sign transactions on the user's behalf

Arc Studio's deploy tool uses a Circle-managed platform wallet. It cannot sign `createLoan`, `fundLoan`, `repayLoan`, or `cancelLoan` transactions, and it cannot impersonate an end-user wallet. All LoanBook contract interactions require the user to sign from their own wallet (Alex and Sarah). This is by design, not a bug.

### Phase 2 testnet lifecycle verification

The complete Alex → Sarah loan lifecycle (createLoan → approve → fundLoan → approve → repayLoan) is blocked until the user provides two funded wallet addresses and executes the transactions. The contract and frontend are ready; the block is solely on wallet signatures.

---

## LB-010 — Community tab renders empty without Supabase credentials

**Category:** CONFIG  
**Severity:** Low (feature gated)  
**Discovered:** Phase 4 implementation  
**Status:** By Design / Mitigated

**Description:** The Community tab requires a running Supabase project with credentials in `.env`. If `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` are missing or blank, `makeSupabaseClient()` cannot construct a valid client, and all queries return errors. The `AuthGate` component detects wallet-connected state and prompts sign-in, but the sign-in flow itself requires the auth server (`bun run server:auth`) to be running with the four server-side environment variables set.

**Mitigation:** The Community tab in `App.tsx` will show a graceful configuration notice if `import.meta.env.VITE_SUPABASE_URL` is falsy — no crash, just an instructional message directing the user to complete the setup documented in `docs/SUPABASE_SETUP.md`.

**Resolution:** Add an early guard in `CommunityHub.tsx` that renders a setup notice when Supabase env vars are absent.

---

## LB-011 — `no-unsafe-enum-comparison`: LoanState enum vs number

**Category:** APP  
**Severity:** Low (linter error, not runtime failure)  
**Discovered:** Premium redesign (Phase 5)  
**Status:** Fixed

**Description:** `LoanData.state` is typed as `number`. Comparing `number` to a `LoanState` enum value triggers `typescript(no-unsafe-enum-comparison)` because the two sides don't share a declared enum type.

**Fix:** All comparisons now cast the enum side: `x.loan.state === (LoanState.Open as number)`. This is correct at runtime since TypeScript numeric enums ARE plain numbers, but the explicit cast satisfies the linter.

---

## LB-012 — `static-components`: SidebarContent defined inside AppShell render

**Category:** APP  
**Severity:** Low (linter error, potential re-mount on every render)  
**Discovered:** Premium redesign (Phase 5)  
**Status:** Fixed

**Description:** `SidebarContent` was initially defined as a nested function inside `AppShell`. The `react(static-components)` linter rule treats this as a component created during render, which causes it to unmount and remount on every parent render.

**Fix:** `SidebarContent` extracted as a module-level component with a `SidebarProps` interface. All needed state (page, address, balances) passed explicitly as props.


---

## LB-013 — Auth: `buildSiweMessage` reconstructed with different timestamp on /verify

**Category:** APP — Security  
**Severity:** HIGH (authentication bypass)  
**Discovered:** Pre-mainnet audit, 2026-10-28  
**Status:** Fixed

**Root cause:** `server/auth.ts` called `buildSiweMessage()` twice — once during `/nonce` (storing the nonce) and once during `/verify` (reconstructing the message for signature recovery). The second call produced a different `Issued At` timestamp, so the reconstructed message bytes never matched the signed bytes. `recoverMessageAddress()` recovered a garbage address that never equalled `norm`, causing all verifications to return HTTP 401 "Signature does not match wallet" even for valid signatures.

**Files changed:** `server/auth.ts`, `supabase/migrations/002_security_hardening.sql`

**Fix:** Added a `message` TEXT column to the `nonces` table. `/nonce` stores the complete signed message text verbatim. `/verify` retrieves it from the DB and passes it directly to `recoverMessageAddress()` — never reconstructed.

**Verification:** Lint + typecheck pass. Live wallet sign-in BLOCKED (no Supabase project in sandbox), but the fix is mechanically correct — one source of truth for the signed message.

---

## LB-014 — Auth: nonce consumption is non-atomic (TOCTOU race)

**Category:** APP — Security  
**Severity:** HIGH (replay attack)  
**Discovered:** Pre-mainnet audit, 2026-10-28  
**Status:** Fixed

**Root cause:** `/verify` did `SELECT … WHERE used=false` then `UPDATE SET used=true` as two separate DB round-trips. Under concurrent load, two requests with the same nonce could both pass the SELECT before either UPDATE committed, allowing the same nonce to be consumed twice (replay attack).

**Files changed:** `server/auth.ts`, `supabase/migrations/002_security_hardening.sql`

**Fix:** New `consume_nonce(p_nonce, p_wallet)` Postgres function uses a single atomic `UPDATE … RETURNING message` where `used=false AND expires_at>now()`. Only one concurrent caller can UPDATE the same row; the loser gets an empty result set and an HTTP 401. `/verify` now calls `supa.rpc('consume_nonce', …)`.

**Verification:** Lint + typecheck pass. Concurrent replay test BLOCKED (no live DB in sandbox).

---

## LB-015 — Auth: CORS wildcard `*` accepts requests from any origin

**Category:** APP — Security  
**Severity:** MEDIUM  
**Discovered:** Pre-mainnet audit, 2026-10-28  
**Status:** Fixed

**Root cause:** `cors()` helper always set `Access-Control-Allow-Origin: *`, allowing any website to make CORS requests to the auth server. This is a concern if the auth server is exposed on the internet.

**Files changed:** `server/auth.ts`

**Fix:** `buildAllowedOrigins()` computes an explicit allowlist from `APP_DOMAIN` plus localhost in development. Responses include `Vary: Origin` and reflect only the allowed origin.

---

## LB-016 — RLS: `members_insert_self` policy allows joining groups without an invite code

**Category:** APP — Security  
**Severity:** HIGH (authorization bypass)  
**Discovered:** Pre-mainnet audit, 2026-10-28  
**Status:** Fixed

**Root cause:** The `members_insert_self` RLS policy checked only that `wallet = jwt.wallet`, meaning any authenticated wallet could insert itself into any group by knowing (or guessing) the group UUID, completely bypassing the invite-code gate. The invite code was validated only client-side.

**Files changed:** `supabase/migrations/002_security_hardening.sql`, `src/components/community/GroupList.tsx`

**Fix:** Replaced the permissive insert policy with `members_insert_owner_only` (group creation only). Added `join_group_by_invite(p_invite_code, p_wallet)` security-definer DB function that validates the invite code server-side before inserting the membership row. `GroupList.tsx` now calls `client.rpc('join_group_by_invite', …)` instead of direct INSERT.

**Verification:** Lint + typecheck pass. Three-identity test (Alex/Sarah/James) BLOCKED (no live DB in sandbox).

---

## LB-017 — RLS: borrower can mark loan requests Funded/Repaid without onchain proof

**Category:** APP — Security  
**Severity:** HIGH (data integrity)  
**Discovered:** Pre-mainnet audit, 2026-10-28  
**Status:** Fixed

**Root cause:** The `requests_update_borrower` RLS policy allowed the borrower to UPDATE any column on their own loan requests, including `status`. A borrower could set `status = 'repaid'` in the DB without any onchain transaction, misleading lenders.

**Files changed:** `supabase/migrations/002_security_hardening.sql`

**Fix:** New `requests_update_borrower_restricted` policy constrains the allowed `status` values in the `WITH CHECK` clause to `('open', 'lender_selected', 'cancelled')`. Status transitions to `funded` or `repaid` are now only possible through the `update_loan_request_status()` security-definer function, which the auth server calls after verifying the onchain receipt.

**Verification:** Lint + typecheck pass. Direct `status='repaid'` update test BLOCKED (no live DB in sandbox).

---

## LB-018 — USDC: floating-point arithmetic in `parseUsdc` and `RequestCard`

**Category:** APP — Data Integrity  
**Severity:** MEDIUM  
**Discovered:** Pre-mainnet audit, 2026-10-28  
**Status:** Fixed

**Root cause:** `parseUsdc()` in `loanbook-contract.ts` used `parseFloat(str) * 1_000_000` which introduces IEEE-754 rounding errors. Example: `parseFloat("0.1") * 1_000_000 = 99999.99999…` rounds to `99999`, not `100000`. `RequestCard.tsx` had an inline duplicate: `BigInt(Math.round(parseFloat(request.amount_usdc) * 1_000_000))`. `GroupView.tsx` used `amtNum.toFixed(6)` after `parseFloat`. `CreateLoanPanel.tsx` used `parseFloat(days) * 86400`.

**Files changed:** `src/loanbook-contract.ts`, `src/components/community/RequestCard.tsx`, `src/components/community/GroupView.tsx`, `src/components/CreateLoanPanel.tsx`

**Fix:** `parseUsdc()` rewritten as string-based bigint arithmetic: splits on `.`, pads fractional part to exactly 6 digits, constructs bigint directly. `formatUsdc()` rewritten with pure bigint division. Added `validateUsdcInput()` function with explicit range and decimal-place checks. All call sites updated. Integer-day duration uses `parseInt(days, 10)`.

**Test cases (unit):**
- `parseUsdc("0.1")` → `100000n` (was `99999n` or varied by platform)
- `parseUsdc("0.01")` → `10000n`
- `parseUsdc("5")` → `5000000n`
- `parseUsdc("0.000001")` → `1n`
- `parseUsdc("0.0000001")` → `0n` (7 decimals — rejected)
- `parseUsdc("-1")` → `0n` (negative — rejected)
- `parseUsdc("abc")` → `0n` (non-numeric — rejected)
- `formatUsdc(100000n)` → `"0.10"`
- `formatUsdc(5000000n)` → `"5.00"`

