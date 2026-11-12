# CommonCircle

**Ajo pays you in turn. CommonCircle is for when it isn't your turn.**

Zero-interest, unsecured USDC loans between people who already trust each
other, on NEAR. Each member holds a non-transferable passport NFT that
remembers who paid back. On-time repayments move a member from Member to
Trusted. Trusted unlocks bigger loans and the circle's DAO treasury.
The loan contract never holds the money: a loan goes from the lender to the
borrower inside one transaction, and the contract's USDC balance is zero at rest.

> Loans are unsecured; repayment cannot be forced. Chat is access-controlled,
> not end-to-end encrypted. Loan terms, account ids and passport history are
> public on-chain.

## Status (testnet only)

| | |
| --- | --- |
| Network | NEAR **testnet**. Nothing has run on mainnet. |
| Circle contract | [`commoncircle-light.testnet`](https://testnet.nearblocks.io/address/commoncircle-light.testnet) |
| Interface | 1.1.1 ([`docs/CIRCLE_INTERFACE.md`](docs/CIRCLE_INTERFACE.md); changes in [`docs/SPEC_DEVIATIONS.md`](docs/SPEC_DEVIATIONS.md)) |
| Code hash on chain | `J4X6efoAqFoKVYxaSNtpDYUTyKrKDzrqa2vPZxvMLxGr`: the reproducible Docker build that CI built **and** tested (run `43059776368`). The contract also publishes NEP-330 source metadata. |
| Token | Circle testnet USDC `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` |
| Upgradeability | **The builder can still upgrade this testnet contract.** Its account holds a full-access key until the keys are deleted at ship. Until then, nothing here claims "locked code". |
| Demo circles | Labelled DEMO. They use 60-second "days" and need one on-time loan to reach Trusted (the defaults are 3 qualifying loans from 2 lenders). |

## Check it yourself, without a wallet

```bash
node contracts/scripts/check-testnet.mjs
```

This needs Node 24 and nothing else. It reads testnet over FastNEAR and checks:

- the code hash and interface version;
- that the contract holds 0 USDC;
- that the three demo circles are readable;
- that a passport turned Trusted by an on-time repayment, as its NFT metadata shows.

It also reports the full-access key that remains on the contract account.

Any transaction below can be read receipt by receipt (gas at each hop, refunds,
events, storage paid against storage used):

```bash
node contracts/scripts/near-tx.mjs <tx_hash> <signer_account_id>
```

To re-check every claim against the chain (32 rows across the three tracks),
re-read each transaction and view into `evidence/snapshots/`, then compare:

```bash
node contracts/scripts/build-evidence.mjs && npm run claims
```

The web app runs locally with `npm ci && npm run dev`, then
`http://localhost:5173/`. It opens on circle 3 "The Dogs (DEMO)" with no wallet:
member cards, the DAO trust check and the treasury's proposals, all read from
testnet. With a MyNearWallet or Meteor testnet wallet, a Trusted member can ask
the treasury and a steward can approve. On 12 Nov 2026 a new Meteor testnet
wallet did the whole member loop from the web app: join by invite, sign in and
chat, set up USDC, ask, cancel, ask again, repay on time, and its card turned
Trusted (rows `f0-web-*` and `f1-web-*`; the lender funded from the CLI). A hosted copy (GitHub Pages) goes live
when the repository is made public at ship; Pages cannot serve it while the
repository is private.

## Do X, see Y

Each row links a testnet transaction or a test that CI runs on every push
(workflow "CommonCircle Gate 1"). Rows marked *not yet* are not claimed.

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
| Ask the relayer to sponsor a call outside the allowlist | Refused | *not yet* (relayer unit tests only) |
| Join with an account that never bought NEAR | Joining and first repayment work | *not yet* |
| List the access keys on the contract account | Empty | *not yet*: done last, at ship |
| Put a wrong hash in `evidence/evidence.json`, run `npm run claims` | The row fails and the track is dropped | `npm run claims:test` |

## Run the tests

JavaScript (any OS):

```bash
npm ci
npm test
npm run claims:test
npm run claims
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
README rows 9/9 (8 rows for later gates still red, as expected), Sputnik
treasury loans 2/2. The deployed wasm was built and tested in run
`43059776368` from the same contract source.

## Tracks

Only these three are entered. A track counts only when `npm run claims` passes
its rows in [`evidence/evidence.json`](evidence/evidence.json).

| Track | What it does here |
| --- | --- |
| **NFTs That Do Something** | The passport is a NEP-171 token that cannot be transferred. Its tier is written by repayments, not by anyone's say-so: an on-time repayment upgrades it, and an overdue loan pauses its Trusted perks. The circle's admin can suspend or revoke it, and the card shows that too. It gates real credit (loan caps by tier) and the DAO treasury. Each circle styles its card on-chain (colours, pattern, a 12 KiB emblem), and the art changes in the wallet when the tier changes. |
| **Social Money** | A Sputnik DAO is the circle's admin and treasury. Lending from it is reputation-based access: only a Trusted member who is not a steward can ask, and only when the circle has at least 2 stewards. The stewards approve by proposal. |
| **Open Innovation** | Loans that never rest in a contract. Every failure path refunds in the same transaction, and the circle's USDC balance is zero after every scenario. |

<!-- COMMONCIRCLE_TRACK_TABLE_START -->
<!-- Generated by `npm run claims`; do not edit this table manually. -->
| Track | Feature | Evidence status |
| --- | --- | --- |
| Open Innovation | Loans that never rest in the contract; every failure refunds | PASS |
| NFTs That Do Something | Passport NFT written by repayments; gates credit | PASS |
| Social Money | Sputnik DAO treasury lends to Trusted members by proposal | PASS |
<!-- COMMONCIRCLE_TRACK_TABLE_END -->

## How this differs from pot-rotation circles

| | Pot-rotation circle (contract holds a pot) | CommonCircle |
| --- | --- | --- |
| Where money sits | In the contract between contributions and payouts | Nowhere: the loan contract's balance is zero at rest |
| Who gets money, and when | Fixed rotation | Whoever a lender (or the circle's DAO) chooses, when a member asks |
| What a default hits | The pot | One lender and one capped loan, plus a flag and paused perks on the passport |
| Memory | Often none | Non-transferable passport with tiers and on-time and late counts |
| Admin | A collector, or a contract with an admin key | The circle's founder until a DAO is attached, then the DAO, which acts only by proposal |
| Proof | A demo | Testnet transactions above, re-checkable with one command |

## Trust assumptions and limits

- **Before a DAO is attached, the founder is the circle's admin.** The founder
  can appoint stewards, suspend or revoke members, clear flags and change the
  card design. Join a circle only if you trust its founder.
- **After `attach_dao`, the DAO account is the admin and the treasury.** The
  contract does not check that this account really is a DAO. The web app
  does: it shows "Sputnik DAO · no keys" and enables the treasury only when the
  account runs the pinned Sputnik code hash **and** has no access keys;
  otherwise it shows a red warning and hides every treasury button
  (`web/dao.ts`, tested in `tests/treasury.test.ts`). The demo DAO passes.
- **Two stewards means two accounts.** Treasury lending needs two steward
  passports, but those could belong to one person. In the testnet demo they
  do: the builder controls every demo account (founder, steward, borrowers).
- **Reputation is local, and a colluding circle can farm it.** It records
  repayments between members of one circle and never leaves that circle. Demo
  circles need one loan to reach Trusted; the defaults are 3 qualifying loans
  from 2 lenders.
- **A lender can block repayment** by leaving the token. The borrower keeps
  the money, and the stewards can clear the resulting late flag.
- **Card art is chosen by each circle** and is not moderated. Images are
  limited to 12 KiB raster files; SVG uploads are refused.
- **Vault.** The circle trusts the pinned vault account to name the lender
  honestly. The vault contract is not built yet.
- **Testnet.** No real money has moved. The builder can upgrade the testnet
  contract until its keys are deleted at ship.

The full red-team review, with every finding and its status, is in
[`docs/REDTEAM_GATE1.md`](docs/REDTEAM_GATE1.md). The evidence ledger is
[`docs/VERIFICATION.md`](docs/VERIFICATION.md).

## Prior work and new work

This repository continues the builder's earlier app, LoanBook (Arc, EVM). The
baseline is the annotated tag `baseline-loanbook-port` at `940099e`
(1 Nov 2026). Everything after it was written during the hackathon; the list
is in [`NEW_FILES.md`](NEW_FILES.md).

- **New:** the NEAR contracts under `contracts/` (circle, mock token, vault
  scaffold), the CommonCircle web client under `web/`, the relayer and NEP-413
  sign-in under `server/`, and the evidence harness and checks under `scripts/`
  and `contracts/scripts/`.
- **Carried over:** the LoanBook app's source under `src/` (no longer served;
  `npm run dev` now serves the CommonCircle app from `web/`) and its EVM
  contract.
- **Libraries:**
  - contracts: near-sdk 5.30.1, near-workspaces 0.24.0, cargo-near 0.23.0;
  - DAO: Sputnik DAO v2 (`sputnikdao2`), the global contract code on testnet;
  - web: Vite, NEAR Wallet Selector 10.1.4 (MyNearWallet, Meteor), `@near-js/transactions` 2.5.1.

## Risk and privacy

Loans are unsecured; repayment cannot be forced. Chat is access-controlled, not
end-to-end encrypted. Loan terms, account ids and passport history are public
on-chain. There is no interest, no collateral and no debt collection of any
kind.
