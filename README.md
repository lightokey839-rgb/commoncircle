# CommonCircle

**Ajo pays you in turn. CommonCircle is for when it isn't your turn.**

Zero-interest, unsecured USDC loans between people who already trust each other
(family, friends), on NEAR testnet. Each member holds a non-transferable passport
NFT that remembers who paid back, and the loan contract never holds the money: a
loan goes from the lender to the borrower inside one transaction.

> **Testnet only: no real money.** Loans are unsecured; repayment cannot be forced.
> Chat is access-controlled, not end-to-end encrypted. Loan terms, account ids and
> passport history are public on-chain. Every limit is listed under
> [Honest limits](#honest-limits).

| | |
| --- | --- |
| **Live app (judges' link, no wallet needed)** | https://lightokey839-rgb.github.io/commoncircle/?demo=1 |
| Chat server | https://commoncircle-chat.onrender.com/health (free hosting: it sleeps, so the first request can take about a minute) |
| Contract | [`commoncircle-light.testnet`](https://testnet.nearblocks.io/address/commoncircle-light.testnet), interface 1.1.1 |
| Demo circle | Circle 3 "The Dogs (DEMO)", treasury DAO `dogs-dao.commoncircle-light.testnet` |
| Tracks entered | NFTs That Do Something · Social Money · Open Innovation |
| Evidence | 36 claims (7 / 12 / 17), re-read from testnet and checked in CI on every push |

## Try it in 60 seconds (no wallet)

1. Open **https://lightokey839-rgb.github.io/commoncircle/?demo=1**. It opens the
   public demo circle with live testnet data: members, loans, and a card that
   reads **"Loan contract USDC balance: 0 USDC"** straight from the token contract.
2. Click **My passport** in the menu. Pick a Trusted member: the card shows the
   tier, the on-time and late counts, and what the tier unlocks. That tier was
   written by a repayment, not by an admin.
3. Click **Treasury**: a Sputnik DAO with no access keys, its proposals, and the
   two steward approvals that paid a loan.
4. Click **Evidence & tracks**: the 36 claims, grouped by track, each with its
   transaction, contract view or test.

Without `?demo=1` the app opens with no circle shown: circles are private to
their members, and the public demo opens only when you ask for it.

With a wallet (Meteor or MyNearWallet, **testnet**, allow pop-ups): open an invite
link, join, sign in with a free NEP-413 signature, chat, ask for a loan, fund,
repay. The two-browser walkthrough is in [`docs/VIDEO_SCRIPT_V3.md`](docs/VIDEO_SCRIPT_V3.md).

## Check it yourself, from a terminal

These need Node 24 and nothing else: no wallet, no keys, no install.

```bash
node contracts/scripts/check-testnet.mjs
```

It reads testnet over FastNEAR and checks:

- the code hash and interface version;
- that the contract holds 0 USDC;
- that the three demo circles are readable;
- that a passport turned Trusted by an on-time repayment, as its NFT metadata shows.

It also reports the full-access key that remains on the contract account.

Read any transaction below receipt by receipt (gas at each hop, refunds, events,
storage paid against storage used):

```bash
node contracts/scripts/near-tx.mjs <tx_hash> <signer_account_id>
```

Re-read every evidence row from the chain into `evidence/snapshots/`, then compare
each one with what the claim expects:

```bash
node contracts/scripts/build-evidence.mjs && npm run claims
```

**For automated reviewers:** the NearBlocks explorer sits behind a bot check and
answers scripts with HTTP 403. The links below are for people; the three commands
above read the same transactions over RPC and need no browser.

## The problem

In a rotating savings group (ajo, esusu, chama) you get money when it is your
turn, not when you need it. Outside the group, people with no credit file have
no way to show that they repay. CommonCircle lets a member ask their own circle
when the need is now, and turns actual repayment behaviour into a record the
circle can use.

## How it works

1. A founder creates a circle; members join by a private, one-time invite link.
2. A member asks for a loan: in the circle chat (amount, days and a reason;
   any member can offer to lend and the borrower picks one) or directly to a
   chosen member. The loan is created on-chain naming that lender.
3. The lender funds it from the web app. The USDC goes from the lender, through
   the contract's check, to the borrower **in the same transaction**.
4. The borrower repays from the web app before the due time. The money goes
   straight back to the lender.
5. Qualifying on-time repayments are written into the borrower's passport NFT.
   Enough of them (from enough different lenders) make it **Trusted**: a higher
   limit, two open loans, the right to invite, and access to the circle's
   Sputnik DAO treasury.

### The loan lifecycle

`Open` (waiting for the named lender, until the funding window ends) →
`Funded` (money with the borrower; the due time starts) → `Repaid` (on time or
late). A borrower can cancel an `Open` request; an unfunded request lapses.
An overdue loan pauses Trusted perks until it is repaid or the DAO clears the
flag by vote.

### Why the passport NFT matters

It is a non-transferable NEP-171 token (one per member per circle). Nobody can
buy it or move it; only repayments change its tier. The tier sets the credit
limit, the number of open loans, who may invite and who may borrow from the
treasury. Its card art is drawn by the contract from the circle's theme and the
member's record, so it changes in the wallet when the tier changes.

### Why the loan contract holds no pooled money

There is no pot to steal or mismanage. Funding is an `ft_transfer_call` that
the contract forwards to the borrower at once; every failure path (borrower not
set up for USDC, wrong lender, wrong token, wrong amount, too little gas)
refunds the lender in the same transaction. The contract's USDC balance is 0
at rest, and the web app shows that balance live, apart from the DAO's balance.

## Tracks

Only these three are entered. A track counts only when `npm run claims` passes
its rows in [`evidence/evidence.json`](evidence/evidence.json).

| Track | What it does here | Start with this proof |
| --- | --- | --- |
| **NFTs That Do Something** | The passport is a NEP-171 token that cannot be transferred. Its tier is written by repayments, not by anyone's say-so: an on-time repayment upgrades it, and an overdue loan pauses its Trusted perks. The circle's admin can suspend or revoke it, and the card shows that too. It gates real credit (loan caps by tier) and the DAO treasury. Each circle styles its card on-chain (colours, pattern, a 12 KiB emblem), and the art changes in the wallet when the tier changes. | Repayment that emits `tier_changed` Member → Trusted: [`2d42VciE…J1Q`](https://testnet.nearblocks.io/txns/2d42VciE6yCvsXmZ4SPBkrGqnezaseEgv8eYHn8HJv1Q); the same from the web app: [`FVVgaWmN…7vw`](https://testnet.nearblocks.io/txns/FVVgaWmNE8fYwLbUNJSDTr55bWDbTVgcN93fPH5pU7vw); transfer refused: test `try_nft_transfer_on_a_passport`. Rows `f1-*` (7). |
| **Social Money** | Members ask their circle in a members-only chat, any member can offer, and the borrower chooses. A Sputnik DAO is the circle's admin and treasury. Lending from it is reputation-based access: only a Trusted member who is not a steward can ask, and only when the circle has at least 2 stewards. The stewards approve by proposal, and can forgive a late mark by vote. | The vote that paid a treasury loan: [`3dYZEiVp…je1r`](https://testnet.nearblocks.io/txns/3dYZEiVpvXFGRPjte9TvCFsKPhPstqJTS4th8Cv8je1r); repaid to the DAO: [`BtakkTRf…xC5r`](https://testnet.nearblocks.io/txns/BtakkTRfz1iEgJEHoz4YRG39K4PBrJVMfKwzG1C3xC5r); a steward's own request refused: [`J7XZHt17…uMd`](https://testnet.nearblocks.io/txns/J7XZHt17De96uBniiMWwHdzoA8tSc2X7cDJ8PxdRmuMd). Rows `f2-*` (12). |
| **Open Innovation** | Loans that never rest in a contract. Every failure path refunds in the same transaction, and the circle's USDC balance is zero after every scenario. | A failed funding that refunds the lender: [`9eRRis9r…B9K`](https://testnet.nearblocks.io/txns/9eRRis9rGq1QFjYWdAr7E627HXvtHvEjmnQEwjJQ9B2K); too little gas, refused and refunded with real testnet USDC: [`DiMweYz7…MuNj`](https://testnet.nearblocks.io/txns/DiMweYz7TbTGGVdraXFcjZm3y7352J2LBFPop3hsMuNj); lender funds from their own browser: [`FKSPKia8…Gt4`](https://testnet.nearblocks.io/txns/FKSPKia8YGvc6jh8zv5rvesPjHQS4mrWqQb6qwYtDGt4). Rows `f0-*` (17). |

<!-- COMMONCIRCLE_TRACK_TABLE_START -->
<!-- Generated by `npm run claims`; do not edit this table manually. -->
| Track | Feature | Evidence status |
| --- | --- | --- |
| Open Innovation | Loans that never rest in the contract; every failure refunds | PASS |
| NFTs That Do Something | Passport NFT written by repayments; gates credit | PASS |
| Social Money | Sputnik DAO treasury lends to Trusted members by proposal | PASS |
<!-- COMMONCIRCLE_TRACK_TABLE_END -->

## Honest limits

- **Testnet only.** No real money has moved. Nothing has run on mainnet.
- **Loans are unsecured.** No collateral, no interest, no debt collection.
  Repayment cannot be forced; a borrower may not repay.
- **The contract is not locked.** Its account still holds a full-access key, so
  the builder can still upgrade this testnet contract. Nothing here claims
  "locked code".
- **DAO identity is checked by the web app, not by the contract.** After
  `attach_dao`, the DAO account is the circle's admin and treasury, and the
  contract does not check that this account really is a DAO. The web app does:
  it enables the treasury only when the account runs the pinned Sputnik code
  hash **and** has no access keys; otherwise it shows a red warning and hides
  every treasury button (`web/dao.ts`, tested in `tests/treasury.test.ts`).
- **Two stewards means two accounts, not two people.** Treasury lending needs
  two steward passports, but one operator may run both. In the testnet demo
  that is the case: the builder controls every demo account (founder, stewards,
  borrowers), including both wallets in the two-wallet web test.
- **Reputation is per circle and can be farmed.** It records repayments between
  members of one circle and never leaves that circle. Two NEAR accounts are not
  two people: cooperating accounts can lend to each other to raise their tier.
  The qualifying minimums and `min_distinct_lenders` (2 by default) slow this
  but do not stop it. There is no identity check and no Sybil resistance.
  Demo circles need one loan to reach Trusted; the defaults are 3 qualifying
  loans from 2 lenders.
- **Chat is not end-to-end encrypted.** Messages and loan-request reasons live
  on the chat server, not on-chain; the server operator can read them. The
  server checks membership on-chain for every call, never signs anything and
  never moves money.
- **Not built: vault, gas sponsorship, account recovery, yield.** The circle
  trusts a pinned vault account to name the lender honestly, but the vault
  contract is not built. The relayer in `server/relayer.ts` has allowlist and
  cap logic with unit tests but does not submit sponsored transactions, so a
  new member needs a little NEAR to join. Account recovery is switched off
  (`features.recovery = false`). There is no interest and no yield anywhere.
- **Before a DAO is attached, the founder is the circle's admin.** The founder
  can appoint stewards, suspend or revoke members, clear flags and change the
  card design. Join a circle only if you trust its founder.
- **A lender can block repayment** by leaving the token (unregistering from
  USDC): the repayment would bounce back to the borrower. The web app checks
  the lender's USDC registration before a repayment and, if it is missing,
  offers to pay their registration (0.00125 NEAR, a NEP-145 storage deposit)
  first, with that cost shown before signing; then it repays. This route has
  unit tests but has not been run on testnet. If the borrower declines, the
  stewards can still clear the resulting late flag.
- **Card art is chosen by each circle** and is not moderated. Images are
  limited to 12 KiB raster files; SVG uploads are refused.
- **Who tested it.** Every wallet in the evidence is run by the builder. This
  repository holds no evidence of use by anyone else.

The full red-team review, with every finding and its status, is in
[`docs/REDTEAM_GATE1.md`](docs/REDTEAM_GATE1.md). The evidence ledger is
[`docs/VERIFICATION.md`](docs/VERIFICATION.md). The final review of this
submission is [`docs/SCREENER_REPORT.md`](docs/SCREENER_REPORT.md).

## Status (testnet only)

| | |
| --- | --- |
| Network | NEAR **testnet**. Nothing has run on mainnet. |
| Circle contract | [`commoncircle-light.testnet`](https://testnet.nearblocks.io/address/commoncircle-light.testnet) |
| Interface | 1.1.1 ([`docs/CIRCLE_INTERFACE.md`](docs/CIRCLE_INTERFACE.md); changes in [`docs/SPEC_DEVIATIONS.md`](docs/SPEC_DEVIATIONS.md)) |
| Code hash on chain | `J4X6efoAqFoKVYxaSNtpDYUTyKrKDzrqa2vPZxvMLxGr`: the reproducible Docker build that CI built **and** tested (run `43059776368`). The contract also publishes NEP-330 source metadata. |
| Token | Circle testnet USDC `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` |
| Upgradeability | **The builder can still upgrade this testnet contract.** Its account holds a full-access key. |
| Demo circles | Labelled DEMO, and the app shows a "Demo settings" note on them: 60-second "days", a 1-hour funding window, and one on-time loan from one lender reaches Trusted. The standard rules (the contract defaults) are 3 qualifying loans from 2 different lenders, real days and a 72-hour window; the app's "new circle" form offers both, clearly labelled. |
| Web app | `web/` (TypeScript, Vite), NEAR Wallet Selector 10.1.4 with Meteor and MyNearWallet. Pages: Overview, Circle chat, Members, Invitations, Loans, Direct loans, My loans, My passport, Treasury, Activity, Evidence & tracks, NEAR network, Advanced tools, Account & network. Hosted on GitHub Pages. |
| Chat and loan requests | `server/` (Node 24, PostgreSQL), hosted on Render's free plan: NEP-413 sign-in, members-only (checked on-chain for every call), polling every 3 seconds, not end-to-end encrypted. See [`docs/CHAT_SERVER.md`](docs/CHAT_SERVER.md). If the server is asleep or down, the app says so and everything on-chain keeps working. |

Done from the web app on testnet, verified over FastNEAR (`docs/VERIFICATION.md`):

- 12 Nov 2026: a new Meteor wallet joined by invite, signed in, chatted, set up
  USDC, asked, cancelled, asked again and repaid on time; its card turned Trusted
  (rows `f0-web-*`, `f1-web-*`; that lender funded from the CLI).
- 13 Nov 2026: **both sides in the web app**. The borrower posted a request card
  in the chat, a second wallet offered and **funded from its own browser**, and
  the borrower repaid (rows `f0-web-peer-*`). That repayment landed 26 seconds
  after the due time, so it counts as late, and the passport's late count is 1.
  Both wallets are run by the builder.

## Do X, see Y

Each row links a testnet transaction or a test that CI runs on every push
(workflow "CommonCircle Gate 1"). Rows marked *not built* are not claimed.

Testnet rows come from interface 1.1.1, circle 3 "The Dogs (DEMO)", whose
admin and treasury is a Sputnik DAO.

| Do | See | Proof |
| --- | --- | --- |
| Fund a loan to a borrower who is not registered with USDC | The forward fails, the lender gets every unit back, the loan contract still holds 0 | testnet [`9eRRis9r…B9K`](https://testnet.nearblocks.io/txns/9eRRis9rGq1QFjYWdAr7E627HXvtHvEjmnQEwjJQ9B2K): `loan_funding_failed`, then `ft_transfer` memo `refund`; sandbox `fund_to_an_unregistered_borrower` |
| Fund it again after the borrower registers | `loan_funded`; the borrower receives 1 USDC in the same transaction | testnet [`CyYFrPZW…xKn`](https://testnet.nearblocks.io/txns/CyYFrPZW2P8iaWKKzFEa3e6wrYfsJJT8HDzzjtRnDxKn) |
| Repay on time | `loan_repaid` on time; `tier_changed` Member → Trusted; the card art changes | testnet [`2d42VciE…J1Q`](https://testnet.nearblocks.io/txns/2d42VciE6yCvsXmZ4SPBkrGqnezaseEgv8eYHn8HJv1Q); token `3:commoncircle-light-borrower3.testnet` |
| Create a circle, invite, or loan | The caller pays for the storage it adds; the contract does not subsidise it | testnet [`9bR1fvUP…Azr8`](https://testnet.nearblocks.io/txns/9bR1fvUPNYqvAgg18uuYhpiNSNt4akvcGygxVjuHAzr8): 0.03428 NEAR kept for 3,428 bytes added (`near-tx.mjs` shows both); red-team `rt_contract_never_subsidises_storage`, `rt_underpaid_storage_is_rejected` |
| Create a loan naming a non-member | Rejected (`E11_LENDER_NO_PASSPORT`; a borrower without a passport gets `E10`) | sandbox `create_a_loan_naming_a_non_member` |
| Fund a loan from an account that is not the named lender | Refunded | sandbox `fund_a_loan_from_an_account_that_is_not_the_named_lender` |
| Send a different token to the contract | Refunded | sandbox `send_a_different_token_to_the_contract` |
| Fund with too little gas | Refused early and refunded | testnet with real USDC [`DiMweYz7…MuNj`](https://testnet.nearblocks.io/txns/DiMweYz7TbTGGVdraXFcjZm3y7352J2LBFPop3hsMuNj): 40 Tgas attached, the circle received 20.5 Tgas and refused (`E60_LOW_GAS`), memo `refund`, lender balance unchanged; sandbox `f0_low_gas_fails_early_and_is_refunded` |
| Let a loan pass its due date | Overdue flag, Trusted perks paused | sandbox `let_a_loan_pass_its_due_date` |
| Try `nft_transfer` on a passport | Fails (`E40_NON_TRANSFERABLE`) | sandbox `try_nft_transfer_on_a_passport` |
| Redeem an invite twice, or as the wrong account | Rejected | sandbox `redeem_an_invite_twice_or_with_the_wrong_account_for_a_named_invite`; red-team `rt_invite_signature_cannot_be_replayed_by_another_account` |
| A Sputnik DAO proposal funds a loan to a Trusted member | The member files the request; both stewards approve; the DAO pays the borrower through the circle in the same transaction | testnet: DAO [`dogs-dao.commoncircle-light.testnet`](https://testnet.nearblocks.io/address/dogs-dao.commoncircle-light.testnet), proposal 3, executing vote [`3dYZEiVp…je1r`](https://testnet.nearblocks.io/txns/3dYZEiVpvXFGRPjte9TvCFsKPhPstqJTS4th8Cv8je1r): `loan_funded`, `funded_via: Treasury`; the circle received 128.5 Tgas; sandbox `sputnik_function_call_proposal_funds_a_treasury_loan` |
| Repay a treasury loan | The money goes back to the DAO | testnet [`BtakkTRf…xC5r`](https://testnet.nearblocks.io/txns/BtakkTRfz1iEgJEHoz4YRG39K4PBrJVMfKwzG1C3xC5r): loan 6 `Repaid` on time; DAO back to 2 USDC |
| The DAO cannot be bypassed | It runs the fixed Sputnik code (global hash `Ea8tHX…RpgD`) and nobody holds a key to it | `node contracts/scripts/near-view.mjs dogs-dao.commoncircle-light.testnet view_account` → `global_contract_hash`, `key_count: 0` (keys deleted in [`6nXfe4gr…b4TM`](https://testnet.nearblocks.io/txns/6nXfe4grVpHEhAHwe35hMrmDPoc13PNFmnoCXE8Ub6Qc)) |
| Treasury loan for a steward, or with fewer than 2 stewards | Rejected (`E19_TREASURY_RULES`) | testnet [`J7XZHt17…uMd`](https://testnet.nearblocks.io/txns/J7XZHt17De96uBniiMWwHdzoA8tSc2X7cDJ8PxdRmuMd) (a steward asks: refused); sandbox `treasury_loan_for_a_steward_or_with_fewer_than_two_stewards` |
| Approve a treasury loan for a member who has since gone overdue | The vote passes, but the circle refuses the money and returns it to the DAO | testnet [`AmBADVeL…v3qpvQ`](https://testnet.nearblocks.io/txns/AmBADVeLJJqM66KSP1eRjGhqH8cHQD5zRNz5WPv3qpvQ): `transfer_refunded` reason `E19_TREASURY_RULES`, memo `refund` |
| The stewards forgive a late flag | The DAO clears it by proposal; the late count drops | testnet [`43mAx3pT…VtTk`](https://testnet.nearblocks.io/txns/43mAx3pTTjTDFDVfpZrGBVwfDSJZHZ12xoUDuA3HVtTk): `flag_cleared`, `late_count_reduced: true` |
| The DAO account tries to take a passport and count as a steward | Rejected (`E37_TREASURY_NO_PASSPORT`) | red-team `rt_dao_cannot_take_a_passport_or_count_as_steward` |
| Ask the sign-in server for a challenge naming another site | Refused (HTTP 400) | `tests/chat-server.test.ts` "only issues challenges naming this app"; live: `POST /nonce` with a foreign `recipient` |
| Ask the relayer to sponsor a call outside the allowlist | Refused | *not built* as a live service (relayer unit tests only) |
| Join with an account that never bought NEAR | Joining and first repayment work | *not built* (no gas sponsorship) |
| List the access keys on the contract account | Empty | *not done*: one full-access key remains, so the contract is not locked |
| Put a wrong hash in `evidence/evidence.json`, run `npm run claims` | The row fails and the track is dropped | `npm run claims:test` |

## Run it

Windows PowerShell, macOS or Linux, Node 24 (`.nvmrc`). Install with
`--ignore-scripts`, as CI does: a leftover development tool from the earlier
LoanBook app (Foundry) has an install script that fails on Windows, and nothing
in CommonCircle needs it.

```bash
npm ci --ignore-scripts
npm run build
npm run preview          # http://localhost:5173/?demo=1
# in a second terminal, only if you want chat on your own machine:
npm run auth             # sign-in, chat and loan requests on http://localhost:3001
```

A local build talks to a chat server on `localhost:3001` unless `VITE_AUTH_URL`
is set at build time. Everything on-chain works without it.

## Test it

```bash
npm ci --ignore-scripts
npm run typecheck        # web, server and tests
npm run lint
npm test                 # vitest
npm run test:db          # chat store on a throwaway local PostgreSQL
npm run build
npm run claims:test      # the claims checker rejects a wrong hash
npm run claims           # compare evidence/evidence.json with its snapshots
```

Contracts (Rust): CI runs them on Ubuntu on every push. The suites are:

- unit tests;
- near-workspaces sandbox scenarios (`tests/sandbox_f0.rs`);
- red-team attack tests (`tests/redteam.rs`);
- the README rows (`tests/readme_checks.rs`);
- Sputnik treasury loans (`tests/sandbox_sputnik.rs`);
- a reproducible Docker build of the wasm, with the sandbox suites re-run on that exact file.

To run them locally on Linux, use `contracts/scripts/build-wasm.sh`, then
`contracts/scripts/test.sh`.

Latest contract run (`43108982043`): unit 49/49, sandbox 13/13, red-team 8/8,
README rows 9/9 (8 rows for later gates still red, as expected),
Sputnik treasury loans 2/2. The deployed wasm was built and tested in run
`43059776368` from the same contract source.

## How this differs from pot-rotation circles

| | Pot-rotation circle (contract holds a pot) | CommonCircle |
| --- | --- | --- |
| Where money sits | In the contract between contributions and payouts | Nowhere: the loan contract's balance is zero at rest |
| Who gets money, and when | Fixed rotation | Whoever a lender (or the circle's DAO) chooses, when a member asks |
| What a default hits | The pot | One lender and one capped loan, plus a flag and paused perks on the passport |
| Memory | Often none | Non-transferable passport with tiers and on-time and late counts |
| Admin | A collector, or a contract with an admin key | The circle's founder until a DAO is attached, then the DAO, which acts only by proposal |
| Proof | A demo | Testnet transactions above, re-checkable with one command |

## Our other entry

Rule Q-015 asks each README to name the builder's other entry. The same builder
also entered **[NEAR Intents Thesis Engine](https://github.com/lightokey839-rgb/Near-thesis-)**
in the **Investment Thesis** track: a reproducible, data-pinned thesis on NEAR
Intents demand, fee capture and value accrual, with its own dashboard. It is a
separate, independent project: the two share no code, data or contracts.

## Prior work and new work

This repository continues the builder's earlier app, LoanBook (Arc, EVM). The
baseline is the annotated tag `baseline-loanbook-port` at `940099e`
(1 Nov 2026). Everything after it was written during the hackathon; the list
is in [`NEW_FILES.md`](NEW_FILES.md).

- **New:** the NEAR contracts under `contracts/` (circle, mock token, vault
  scaffold), the CommonCircle web client under `web/`, the chat server, relayer
  logic and NEP-413 sign-in under `server/`, and the evidence harness and checks
  under `scripts/` and `contracts/scripts/`.
- **Carried over:** the LoanBook app's source under `src/` (no longer served;
  `npm run dev` now serves the CommonCircle app from `web/`) and its EVM
  contract.
- **Built with AI coding agents.** The code was written and reviewed by AI
  coding agents (OpenAI Codex and Anthropic's Claude Code), directed by the
  builder under written gates: a frozen contract interface, a red-team pass,
  and an evidence file that CI re-checks against testnet on every push. The
  commit history shows the steps.
- **Libraries:**
  - contracts: near-sdk 5.30.1, near-workspaces 0.24.0, cargo-near 0.23.0;
  - DAO: Sputnik DAO v2 (`sputnikdao2`), the global contract code on testnet;
  - web: Vite, NEAR Wallet Selector 10.1.4 (MyNearWallet, Meteor), `@near-js/transactions` 2.5.1.

## Roadmap

1. Lock the contract: delete its full-access key (see `docs/SHIP_CHECKLIST.md`).
2. Move the DAO check into the contract, and let stewards invite.
3. Build the vault and a live relayer, so a new member can join without buying NEAR.
4. Pilot one real circle with the standard rules and people who are not the builder.

## Risk and privacy

Loans are unsecured; repayment cannot be forced. Chat is access-controlled, not
end-to-end encrypted. Loan terms, account ids and passport history are public
on-chain. There is no interest, no collateral and no debt collection of any
kind.
