# Gate 1 red-team report

Date: Wed 11 Nov 2026. Reviewer: the lead session (which also wrote the
contract, so treat "safe" verdicts with that bias in mind). Scope: everything
Gate 1 produced, attacked as a security reviewer, a judge and an AI screener
would. Every finding is marked **CONFIRMED** (reproduced: test, CI run, RPC or
transaction) or **SUSPECTED** (reasoned only).

Evidence sources: CI runs on branch `audit/gate1-redteam` (`43056988857` on
`8613fd1` before the fixes; the D-009 run is recorded at the end of this file),
`contracts/circle/tests/redteam.rs`, FastNEAR testnet RPC, the official page
nearhackathon.com (read 11 Nov), and `https://nearhunt.xyz/api/projects?q=`.

## 1. What the official page says (read directly)

- Judging: "Claude Code & Codex screen every project first: they check that it
  runs and does what the README says. The human judges above make the
  decisions. Previous NEAR hackathons evaluated technical implementation,
  design, impact, originality and sustainability."
- 13 tracks, each with 1st ($10K), 2nd ($3K), 3rd ($2K); one $55K grand prize;
  paid in NEAR. One submission per project; select every track that fits.
- Submit: public repository, public demo post on X (tag @NEARProtocol and
  #NEARHackathon, video or screenshots), form with name, team lead, **email**,
  team size, tracks, **NEAR wallet address** for the prize, repo link, post
  link, 20 to 2,000 character description. Deadline 14 Nov 2026 23:59 UTC.
- Track wording:
  - **NFTs That Do Something** — "What comes after the JPEG. Build NFTs as
    accounts — assets that own money, earn royalties, hold inventory, carry
    credentials, memberships or access rights. Ownership with behavior."
    Tags: DYNAMIC NFTS, NEP-171, SUB-ACCOUNTS.
  - **Social Money** — "Coordinate value together. Build shared budgets,
    programmable rewards, collective ownership and reputation-based access on
    top of Sputnik DAO and Trezu. Don't rebuild the multisig — build what
    communities do with it." Tags: SPUTNIK DAO, TREZU, NAMED ACCOUNTS.
  - **Open Innovation** — "Something we haven't seen. Have an idea that refuses
    to fit a category? Explore new ways for money, intelligence and ownership
    to work together."

## 2. Findings (most severe first)

| ID | Sev | Status | Finding | Evidence | Fix | Contract change | Hours |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | Critical | CONFIRMED, fixed in D-009 (not yet deployed) | **Storage was never charged.** near-sdk `store` collections flush after the method body, so `charge_storage` measured no growth and refunded the whole deposit. Anyone could grow state for gas alone until the contract's NEAR could not cover storage; then state-growing calls fail, including the callback that commits `Funded`, which would strand a loan in `Funding` after the money has moved | Testnet: `create_circle` `6PwNu7dfT4ZujncoiTzZseGhSTjhageK9XJaDEAb3eU3` attached 0.029 NEAR, refunded 0.029; `register_invite` `GkWBK471ew1gQGXTNRHyYvJzWBTteUsPpcWhAhCD5kuu` refunded in full; `create_loan` `2ihs24UettsERCFG2nBZqqZwnu6iAkp3rMg54kAXN5Eb` kept only the 256-byte reserve. Sandbox: `rt_contract_never_subsidises_storage` failed on run `43056988857` (free balance fell 0.01617 NEAR) | `flush_all()` before each measurement | Yes (done) | 0.5 + redeploy |
| F-02 | Critical | CONFIRMED | **The README is stale and undersells and misstates the project.** It says "The contract lane has not yet compiled or tested that interface", calls the user a member of a "savings circle" (v4 forbids this), lists the dropped Real-World Money and Autonomous Business rows, has no "do X, see Y" steps, no contract address, no test counts, and its quickstart ends in `npm run verify:usdc`, which fails without RPC environment variables. The AI screeners judge "does what the README says" | `README.md` lines 10 to 15, 19, 43 to 51, 62 to 75 | Rewrite (section 5 has the outline) | No | 3 |
| F-03 | High | CONFIRMED | **There is no working end-to-end web app.** `npm run dev` serves the old LoanBook (Arc, EVM) app at `/`; the CommonCircle page is only at `/web/index.html`. Transactions and sign-in depend on `window.commonCircleWallet`, an adapter nothing provides: there is no wallet selector, so sign-in, join, fund and repay cannot be done from the page. The **read-only demo does work**: opened in a browser in this session, it loaded live testnet data and drew both "The Dogs (DEMO)" cards (Member and Trusted) with no console errors | `index.html` title "LoanBook … Repay on Arc", `vite.config.ts`, `web/README.md` ("A wallet adapter is injected…", "This is a scaffold") | Add a real NEAR wallet connection, make CommonCircle the root app, host the read-only demo (a Pages workflow already exists) | No | 6 to 8 |
| F-04 | High | CONFIRMED | **The web lane's 10 new commits had never been through CI, and one test fails.** `tests/relayer.test.ts` "enforces per-account and total daily caps" fails: it charges `carol` 150 against a 100 per-account cap, so `RELAYER_ACCOUNT_CAP` fires before the total cap. The cap logic is right; the test is wrong. 24 of 25 tests pass | CI run `43056988857`, job "npm tests…", `server/relayer.ts:183`, `tests/relayer.test.ts:110` | Fix the test (use a third account for the total-cap case); push `lane/web` so CI runs on every commit | No | 0.5 |
| F-05 | High | CONFIRMED | **The claims harness cannot check the chain.** `scripts/claims.mjs` only compares committed JSON snapshots with `expected`; there is no online mode, though v4 requires one. A hand-written snapshot would pass, so "claims green" would prove nothing to a careful judge | `scripts/claims.mjs` lines 49 to 58 | Add `npm run claims -- --online` (FastNEAR `tx` and `query`), keep snapshots as the offline copy, run online in CI | No | 3 |
| F-06 | High | CONFIRMED | **`attach_dao` accepts any account.** The contract cannot tell a Sputnik DAO from an ordinary account, so a founder can attach an account they control and present it as "the treasury". Members who contribute would be sending money to that person | The existing sandbox test attaches a plain dev account as the DAO and it works (`treasury_loan_for_a_steward_or_with_fewer_than_two_stewards`) | Web app: before showing "DAO attached" or a contribute button, read the DAO account's code hash and compare it with the pinned Sputnik hash; show a red warning otherwise. Gate 2 must use a real Sputnik DAO. State it in the README | No | 1.5 |
| F-07 | Medium | CONFIRMED | **The trust assumption for the admin bootstrap was never written down** (Gate 1 phase 1D asked for it). Before `attach_dao` the founder alone can appoint stewards, suspend or revoke members, clear flags and restyle cards. The "at least 2 stewards" rule counts accounts, not people: one person with two accounts passes it | `grep` over docs: no trust-assumption text | Add section 6 of this report to the README and `docs/SPEC_DEVIATIONS.md` | No | 0.5 |
| F-08 | Medium | CONFIRMED, fixed in D-009 | **The DAO account could take a passport**, make itself a steward and satisfy the 2-steward rule with one human steward | Run `43056988857`, `redteam_dao_passport.json`: all six steps true | `mint_passport` rejects the circle treasury (`E37_TREASURY_NO_PASSPORT`) | Yes (done) | 0.3 |
| F-09 | Medium | CONFIRMED, accepted | **A lender can make an honest borrower late.** If the lender unregisters from USDC, repayments bounce (the borrower keeps the money), the loan goes overdue, Trusted perks pause, and the eventual repayment counts as late | `rt_lender_unregistering_makes_an_honest_borrower_late_known_issue`: overdue true, late count 1, and 0 after the admin's `clear_flag` | Keep: the admin (DAO) can clear the flag, which the test proves. Web app: when a repayment bounces, tell the borrower why and offer "ask stewards to clear the flag". README: say so | No | 1 |
| F-10 | Medium | CONFIRMED | **The live testnet contract is upgradeable by the builder.** `commoncircle-light.testnet` and `vault.commoncircle-light.testnet` each hold a full-access key, and the code was swapped in place on 11 Nov. Any "no admin", "no upgrade path" or "locked code" wording is false for the live deployment until those keys are deleted | `view_access_key_list` (1 FullAccess key); redeploy tx `2XexKj5twYfM3dTE48q52UThHGtmHu7hLZzksHP3UXXd` | Say "upgradeable until keys are deleted at ship" in the README now. At Gate 4, after the last deploy, delete the keys and show the empty key list (this turns the README check "list access keys → empty" green). Irreversible: do it last | No | 0.3 |
| F-11 | Medium | CONFIRMED, accepted | **Emblem dimensions are not checked.** A 33-byte file declaring a 30000 x 30000 PNG is accepted; a real image of that shape could exhaust memory in a viewer. Only people who open that attacker's own circle cards are exposed | `rt_png_with_huge_declared_dimensions_is_accepted_known_issue` | Accept for the hackathon and document. A proper fix parses PNG, GIF, JPEG and WebP headers in the contract (about 60 lines); a wrong parser would reject good uploads on demo day, so it is not worth the risk now | Optional | 2 |
| F-12 | Medium | SUSPECTED | **Track fit for NFTs That Do Something is partial, and "non-transferable passport" is not unique.** The track leads with "NFTs as accounts … own money, earn royalties, hold inventory"; ours fits "credentials, memberships or access rights" and DYNAMIC NFTS. Other entries already pitch soulbound or passport NFTs (Boundora "soulbound… membership card", Merit "carry your achievements", Satchel, Lot Passport, Release Passport, a "Skill Passport") | Official track text; NEAR Hunt descriptions (descriptions only; repositories not opened) | Lead with what the passport **does**: it is written only by money moving (repayments), it gates real credit and a DAO treasury, and its community-styled art changes in the wallet. Never say "first" or "only" | No | 1 |
| F-13 | Medium | CONFIRMED | **Trusted can be farmed at the demo settings.** With N = 1 and one lender, a founder and one other account reach Trusted by passing 1 USDC back and forth; the testnet proof does exactly this | Testnet proof run (`tier_changed` after one 1 USDC loan) | Label demo circles DEMO in the UI and README; state the defaults (N = 3, 2 lenders, 3-day minimum) and that reputation never leaves its circle | No | 0.3 |
| F-14 | Low | CONFIRMED, fixed in D-009 | **Invisible and direction-changing characters were accepted in circle names and taglines** and reached the card and the token title (useful for imitating another circle). The SVG itself was never breakable | `redteam_name_chars.json` on run `43056988857`: accepted, bidi reaches the SVG | Rejected with `E04_BAD_PARAMS` | Yes (done) | 0.3 |
| F-15 | Low | CONFIRMED | **The evidence ledger and STATUS had stale rows** saying BLOCKED or NOT RUN for things that later passed, including "Testnet deploy … NOT RUN" | `docs/VERIFICATION.md`, `STATUS.md` | Done in this pass: a "current state at a glance" table, and old STATUS sections moved under "History (superseded)" | No | done |
| F-16 | Low | SUSPECTED | **Low-gas refusal is proven only against the mock token.** With real Circle USDC only the 150 Tgas path has run | Sandbox `f0_low_gas_fails_early_and_is_refunded`; testnet runs at 150 Tgas | One testnet call with about 40 Tgas attached; record the result | No | 0.3 |
| F-17 | Low | CONFIRMED | Small leftovers: the event `version` string is still `1.0.0`; `set_steward`, `attach_dao` and `set_passport_expiry` take 1 yoctoNEAR and can add a few dozen uncharged bytes; `nft_tokens` can return 2.4 MB in the worst case; anyone can name any member as lender, which lists an unfunded loan under that lender | Code; `redteam_enumeration.json` | Document; no action | No | — |

### Leads that turned out safe (all CONFIRMED)

- **NFT enumeration under attack works.** 50 circles with 12 KiB emblems:
  `nft_tokens(limit 50)` and `nft_tokens_for_owner(limit 50)` both answer
  (2,378,633 bytes, about 47.5 KB per token). Lead 4 is refuted.
- **The contract publishes NEP-330 source metadata.** `contract_source_metadata`
  on testnet returns the commit `3a4f386`, the pinned Docker image digest and
  the build command. Lead 5 is refuted. Once the repository is public,
  explorers can verify the code.
- **The build is reproducible.** A second, independent Docker build of commit
  `3a4f386` (run `43042449897`, attempt 2) produced the identical wasm:
  sha256 `a6657716eb49b87f8716a16ac9f15104d84270002f9eef73ed64c5de428ee174`.
- **No SVG or XML injection.** Every text field is escaped, colours are parsed
  to bytes and re-printed, the emblem is base64 with a MIME type chosen by the
  contract, and SVG uploads are refused.
- **An invite signature cannot be reused by another account**, even for an
  open invite (`rt_invite_signature_cannot_be_replayed_by_another_account`).
- **Money paths.** Zero USDC at rest after every scenario, double funding
  refused, failed forwards refunded, callbacks private, callbacks use about
  2 Tgas of a 25 Tgas reserve (sandbox and testnet).
- **Secrets.** Six secret patterns across all 88 commits on every branch: 0
  hits; gitleaks full-history job green. The key exposed in chat on 11 Nov was
  never in the repository and has been rotated.
- **Web safety.** No `innerHTML` or similar; cards are shown through
  `<img src="blob:…">`, where scripts cannot run; the invite signature
  encoding bug is fixed (`3e40483`).

## 3. Track scorecard

Scores are my estimate out of 10 today, and what would raise them most.

| Track | Technical | Design | Impact | Originality | Sustainability | Biggest weakness a judge sees | Single best move |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **NFTs That Do Something** (lead track) | 7: on-chain dynamic art, gates enforced in the contract, wallet renders | 7: themed square cards; no app screen shows them yet | 4: no real users | 6: behaviour-written, community-styled; soulbound passes exist elsewhere | 6 | The NFT is shown in a wallet, but no app shows it doing something | A 30-second clip: repay, the card flips to Trusted in the wallet; press Send, it fails; the same account now gets a bigger loan |
| **Social Money** | 3 today: hooks only, no DAO has ever been attached on testnet | 3 | 3 | 7: "reputation-based access" to a DAO treasury is the track's own phrase | 6 | Nothing uses Sputnik DAO yet, and the track says to build on it | Gate 2: a real Sputnik DAO proposal funds a loan to a Trusted member, and a steward's own request is refused |
| **Open Innovation** | 8: refund proofs on testnet with real USDC, reproducible build, zero custody | 4 | 4 | 5: no "intelligence" element; lending is a familiar category | 6 | Reads as a lending app; README currently says nothing works | The README's "do X, see Y" table with one command per row, each answering from testnet |

Across all three, the same two things cost the most points: the README
(F-02) and the lack of a usable app (F-03).

## 4. The ten highest-leverage actions

Ordered by (track impact × chance of finishing) ÷ hours.

| # | Action | Lane | Hours | By |
| --- | --- | --- | --- | --- |
| 1 | Approve D-009, redeploy testnet in place, rerun the refund proof | builder + contracts | 0.5 | now |
| 2 | Rewrite the README: true status, "do X, see Y" table, keyless quickstart (`npm ci`, `npm test`, `npm run claims`, a read-only testnet check script), contract address and hash, trust assumptions, "how this differs from pot-rotation circles", DEMO labelling | lead + web | 3 | Gate 2 |
| 3 | Real wallet connection, CommonCircle as the root app, hosted read-only demo showing "The Dogs (DEMO)" cards | web | 6 to 8 | Gate 2 |
| 4 | Real Sputnik DAO on testnet: `attach_dao`, a proposal funds a treasury loan, a steward's request is refused | contracts | 4 to 6 | Gate 2 |
| 5 | Claims harness online mode, Tier A evidence rows and snapshots (drafts in section 7) | web + lead | 3 | Gate 2 |
| 6 | Fix the relayer test; push `lane/web` after every commit so CI runs | web | 0.5 | now |
| 7 | DAO code-hash check and red warning in the web app; trust assumptions in the README | web + lead | 1.5 | Gate 2 |
| 8 | Demo script and recording on testnet: join by invite, fund, refund on purpose, repay, card flips, Send fails, DAO proposal funds a loan | lead + builder | 3 | Gate 3 |
| 9 | Card gallery page (every member's card from `passports_in_circle` and `card_svg`) and a share image | web | 2 | Gate 3 |
| 10 | Ship list: delete the testnet contract keys after the last deploy and show the empty key list; public repository; secret scan; X post under 2:20; form with email and a NEAR wallet for the prize | builder | 1 | Gate 4 |

## 5. README outline (for action 2)

1. One-line pitch (v4): "ajo pays you in turn; CommonCircle is for when it
   isn't your turn." Never "savings circle" or "ROSCA".
2. Status box: testnet only; contract id, interface version, code hash; "the
   builder can still upgrade this testnet contract until keys are deleted".
3. Try it without a wallet: the hosted demo link and one command that reads
   testnet.
4. "Do X, see Y" table: each row has a command or a transaction link.
5. Run the tests: `npm ci`, `npm test`, `npm run claims`; contract tests run in
   CI (link) or with `contracts/scripts/test.sh` on Linux.
6. Tracks table generated by `npm run claims` (only Open Innovation, NFTs That
   Do Something, Social Money).
7. How this differs from pot-rotation circles (v4 table, no names).
8. Trust assumptions and limits (section 6 below).
9. Baseline disclosure, `NEW_FILES.md`, libraries.
10. Risk and privacy language (verbatim from v4).

## 6. Trust assumptions and limits (text for the README)

- **Founder before a DAO is attached.** The founder is the circle's admin: they
  can appoint stewards, suspend or revoke members, clear flags and change the
  card design. Join a circle only if you trust its founder.
- **After `attach_dao`.** The DAO account is the admin and the treasury. The
  contract does not check that the account really is a DAO; the app does, by
  comparing its code hash, and warns if it is not.
- **Two stewards.** Treasury lending needs two steward passports. That is two
  accounts, not necessarily two people.
- **Reputation is local and can be farmed inside a colluding circle.** It
  records repayments between members of one circle and never leaves it. Demo
  circles use N = 1; the defaults are 3 qualifying loans from 2 lenders.
- **A lender can block repayment** by leaving the token; the borrower keeps
  the money and the stewards can clear the resulting flag.
- **Card art is chosen by each circle** and is not moderated. Images are
  limited to 12 KiB raster files.
- **Vault.** The circle trusts the pinned vault account to name the lender
  honestly. The vault contract is not built yet.
- **Testnet.** No real money has moved. The testnet contract is upgradeable
  by the builder until its keys are deleted at ship.

## 7. Draft Tier A evidence rows (not yet in `evidence/evidence.json`)

After the D-009 redeploy, re-take these from the new proof run so every row
points at the final code.

| id | track | kind | reference | expected |
| --- | --- | --- | --- | --- |
| `f0-refund` | Open Innovation | tx | `HZTwyVYhigBoUsambrdrTbYVZndWtqXZ8QNnnhhkJa5r` | success, events `loan_funding_failed` and nep141 `ft_transfer` memo `refund` |
| `f0-fund` | Open Innovation | tx | `GjMCruQpw1Mv5p7nbtqjcEFum8F2p1Nu9tJnH6tcBDVd` | event `loan_funded`, loan 2 |
| `f0-repay` | Open Innovation | tx | `8Qw6WzK2hYiFqoXE19yLHJnJ7kFr1nCxgHu1SnFK39Gu` | event `loan_repaid`, `on_time: true` |
| `f0-zero-balance` | Open Innovation | view | USDC `ft_balance_of(commoncircle-light.testnet)` | `"0"` |
| `f0-code-hash` | Open Innovation | view | `view_account(commoncircle-light.testnet).code_hash` | the reproducible build's hash |
| `f1-tier-flip` | NFTs That Do Something | tx | `8Qw6WzK2hYiFqoXE19yLHJnJ7kFr1nCxgHu1SnFK39Gu` | event `tier_changed` Member → Trusted |
| `f1-card` | NFTs That Do Something | view | `nft_token("2:commoncircle-light-borrower2.testnet")` | title "The Dogs (DEMO) Passport", description contains "Tier: Trusted" |
| `f1-non-transferable` | NFTs That Do Something | test, plus a testnet tx at Gate 2 | `try_nft_transfer_on_a_passport` | fails with `E40_NON_TRANSFERABLE` |
| `f1-gate` | NFTs That Do Something | test | `create_a_loan_naming_a_non_member` | `E10` / `E11` |
| `f2-proposal`, `f2-treasury-loan`, `f2-steward-refused` | Social Money | tx | Gate 2 | — |

## 8. Competitors read (NEAR Hunt descriptions only; no repository opened)

| Entry | Tracks | What it says it does | Holds funds? | Overlap with us |
| --- | --- | --- | --- | --- |
| AJO ON NEAR | realworld | "a smart contract holds the pot and pays each member in turn" | Yes, the pot | Different model (rotation) |
| Ajo Onchain | realworld, social | rotating savings (ajo/esusu) | not stated | Same audience, different model |
| Contri | privacy, realworld, nfts | ajo savings groups | not stated | Same audience; has the NFT tag |
| Rota | privacy, security, realworld, open | pot in a locked contract; an AI treasurer whose key can only call settle | Yes | "locked contract" framing |
| Kring | realworld, social | freelancers cover each other's sick pay; "Zero-key NEAR account, no admin"; testnet | deposits stay in each member's own pot | Mutual-aid circle; "no admin" |
| AllTogether | social | a Sputnik DAO votes to match budgets; pledge or refund | pledges | Uses Sputnik DAO |
| Sputnik Settlement Ledger | realworld, social | nets 17 debts into 4 transfers in one Sputnik proposal | no | Uses Sputnik proposals |
| Merit | nfts, social | NFT that "own[s] money, carr[ies] your achievements" | not stated | Reputation NFT |
| Boundora | nfts | "soulbound" membership pass in a game | no | Soulbound membership |
| Satchel | nfts | each NFT card is a NEAR account that holds revenue; transferable | Yes | NFT-as-account (the track's lead idea) |
| Lot Passport / Release Passport | nfts | USDC or a bond locked in an NFT until a check passes | Yes | "Passport" naming |
| Grind District | games, open | self-attested "Skill Passport" on testnet | no | "Passport" naming |
| setllend / Loca | defi | fixed-rate USDC order book on mainnet; agent credit | Yes | Lending |

What still looks distinctive after this read, stated without "first" or "only":
loans that never rest in the contract; a passport whose tier is written only by
repayments and that gates credit and a DAO treasury; card art that each circle
styles and that changes on-chain. Re-check by opening the repositories of
Merit, Boundora, Kring and Contri before the README comparison is written.

## 9. What was not checked

- The web app's wallet flows (no wallet adapter exists) and any screen on a
  phone. Only the read-only demo was run in a browser.
- Wallet rendering of a 12 KiB emblem; NearBlocks token page; marketplaces.
- Low-gas refusal against real USDC (F-16).
- Competitor repositories and on-chain activity.
- Anything on mainnet. Nothing in this project has touched mainnet.
- The worst-case callback with 50 distinct lenders (reasoned to add about
  0.1 Tgas; not measured).

## 10. D-009 verification

CI run `43059776368` on commit `2e45eef` (branch `audit/gate1-redteam`), after the D-009 fixes:

| Check | Result |
| --- | --- |
| Unit tests | 49/49 |
| F0 sandbox | 13/13 |
| Red-team tests (`tests/redteam.rs`) | 8/8, including `rt_contract_never_subsidises_storage` (free balance now rises by 0.00606 NEAR over a lifecycle instead of falling), `rt_underpaid_storage_is_rejected` (E02 for circle, invite and loan), `rt_dao_cannot_take_a_passport_or_count_as_steward` (E37; steward count stays 1; treasury loan refused) and `rt_bidi_and_control_characters_in_circle_name` (rejected) |
| Contract README rows | 9/9 (8 later-gate rows red, as before) |
| Same suites on the reproducible wasm | sandbox 13/13, README rows 9/9 |
| Callback gas | unchanged: 1.9 to 2.5 Tgas |
| gitleaks | green |
| npm job | red only because of F-04 (the relayer test) |
| **New deploy artifact (interface 1.1.1)** | sha256 `fd7d73903294bd371b79452861c243c7722cb0386a2a9c1fdcf80b410032526b`, code hash `J4X6efoAqFoKVYxaSNtpDYUTyKrKDzrqa2vPZxvMLxGr`, source tree `c6daa1d066d041420597f932bf9dc51b404930a8`. **Not deployed.** Testnet still runs 1.1.0 (`CCYR2EZ…whm`), which has F-01, F-08 and F-14 |

Deploying it is an in-place redeploy (state is kept). Because deposits are now
really charged, clients must attach `storage_costs()` amounts, as the interface
always said.
