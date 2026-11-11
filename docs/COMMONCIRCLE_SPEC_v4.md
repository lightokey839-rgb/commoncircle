# CommonCircle on NEAR: Feature Spec (v4)

*v4, November 11, 2026. Supersedes v3. Deadline: Saturday 14 November 2026, 23:59 UTC (from the public rules summary; confirm on the official page). v4 changes the positioning and the claim set after a scan of NEAR Hunt. The contracts frozen at Gate 1 are unchanged, except that the vault loses its keeper-tip logic. The last section lists what changed.*

Private lending circles on NEAR. Zero-interest, unsecured USDC loans between people who already trust each other, gated by a membership NFT that records how each member behaves.

**One-line pitch:** ajo pays you in turn; CommonCircle is for when it isn't your turn. Zero-interest loans between people who already trust each other, and a passport that remembers who paid back.

**Positioning rule:** never call the product a savings circle or a ROSCA. It holds no pot and has no rotation.

## Where this sits in the field (NEAR Hunt scan, 11 November)

NEAR Hunt is a community directory of the hackathon's submissions. Its upvotes are community signals, not judging, and the top project had 4, so votes are ignored here. It listed 498 projects on 11 November. Its categories look like the official tracks (confirm on the rules page).

| Track | Listings | Visible leaders and overlaps | v4 decision |
| --- | --- | --- | --- |
| Open Innovation | 97 | Grind District (testnet "Skill Passport", self-attested), Crownfall | Keep; F0 with refund proof |
| NFTs That Do Something | 43 | Ashes of the Ninth Heaven and Afterlight (game NFTs). Contri and Lot Pass also carry the NFT tag; not read | Lead track; F1 |
| Social Money | 46 | AllTogether (a Sputnik DAO matches budgets; pledge or refund). Ajo Onchain and Kring are also tagged Social; not read | Keep; F2 must show lending by public proposal, not just a shared treasury |
| Real-World Money | 106 | NEARPORTAL, CareRail, AJO ON NEAR (in its builder's words, a contract holds the pot and pays each member in turn). Ajo Onchain, Kring, Rota, Contri and Bolsillos look like community-money tools by name and tags; not read | Keep only with the mainnet pilot |
| Agent Economy | 226 | NEARPORTAL, Ballast. NEAR Hunt's own agent guide says dozens of entries are spending limits for an agent's wallet, which is the pattern F5's vault follows | F5 demoted to Tier C |
| Unstoppable DeFi | 83 | Ballast, Credence; CareRail uses NEAR Intents | F3 stays stretch |

**What this changes**

- The product is not a savings circle. Two entries have "ajo" in the name and at least five more look like community-money tools. A pitch that opens with the rotating savings circle puts CommonCircle in that pile. The pitch is now the complement: ajo pays in turn; CommonCircle is for when it isn't your turn.
- Say what is structurally different, without naming anyone:

| | Pot-rotation circle (ROSCA contract) | CommonCircle |
| --- | --- | --- |
| Where money sits | In the contract between contributions and payouts | Nowhere: the loan contract's balance is zero at rest; only opt-in set-asides sit in the vault |
| Who gets money, and when | Fixed rotation | Whoever the lender chooses, when the member asks |
| What a default hits | The pot | One lender, one capped loan, plus a flag and paused perks on the passport |
| Memory | Often none | Non-transferable passport with tiers and on-time and late counts |
| Admin | A collector, replaced by a contract or an admin key | No platform admin; the circle's DAO votes on revokes, flags and treasury |
| Proof | A demo | `npm run claims` and mainnet pilot hashes |

This compares two models, not named entries. Only one rival (AJO ON NEAR) was opened, from a short description, so nothing in the README says "only" or "first" until the competitor read in Open items is done.

## Strategy: how this wins

One product, one pilot circle, one demo. Every track is a thin layer over the same contracts, not a separate build. No spec can promise a win on every track, and a thin claim puts the strong ones at risk, so v3 makes every claim checkable.

- **Claims are earned.** A track reaches the README only when its evidence row has working links. A script builds the README track table from `evidence/evidence.json` and fails if a claimed row does not verify (see Evidence harness). AI tools screen every project first to check that it runs and does what its README says, so this makes the README true by construction.
- **Aim first where the product fits and the field is thinner.** The event leans toward AI agents and cross-chain payments, and Agent Economy is the largest track this product could enter (226 listings on NEAR Hunt). NFTs That Do Something (43) and Social Money (46) fit this product best, though at least two savings-circle entries are tagged Social. Make F0 to F2 excellent before adding anything else.
- **Tiers set what is cut first; gates set the order of work.** A missed gate cuts the next tier down. Gates are never extended.

| Tier | Features | Tracks it can support |
| --- | --- | --- |
| A: the product | F0 loan loop, F1 passport, F2 treasury | Open Innovation, NFTs That Do Something, Social Money |
| B: makes it real | F4 onboarding and pilot | Real-World Money |
| C: stretch, in this order | F5 agent and vault (auto-repay and drafts), then F3 cross-chain funding | Agent Economy, Unstoppable DeFi |

- **Scoring map.** Earlier NEAR hackathons scored the five criteria below. Confirm them on the rules page.

| Criterion | What earns it here | Proof |
| --- | --- | --- |
| Technical implementation | Refund paths, zero balance at rest, private callbacks, locked code, same wasm on both networks, sandbox tests | Claims script output, explorer |
| Design | One-screen flows, card art that changes live, plain failure messages | Demo, README screenshots |
| Impact | A real pilot with repayments; joining with no NEAR | Pilot hashes, participant quote |
| Originality | Non-transferable behaviour passport, circle DAO, vault rules (if F5 ships) | Tier flip, treasury loan, auto-repay |
| Sustainability | No admin, who-pays table, measured cost per loan, stated relayer budget | README economics section |

## Prior work (disclosure)

Ported from LoanBook (Arc, EVM). Baseline: circles, chat, and the request, interest and lender-selection loop. Everything marked **NEW** is built during the hackathon window. The rules count code written since the announcement, so anything older is disclosed here as baseline.

- Tag the baseline commit (`baseline-loanbook-port`, annotated) and push it before any NEW work. Put its SHA and date in the README.
- If NEW work has already started, tag the last commit made before it and say so. Commit history, not the tag date, is the evidence.
- `NEW_FILES.md` comes from `git diff --name-status baseline-loanbook-port..HEAD` and is linked from the README. The README also lists libraries, carried-over UI components, and which contracts are new.

## Principles

- **No interest, no collateral, no platform admin.** Circle-level powers (revoke, clear a flag, appoint stewards) exist, but only through that circle's DAO vote.
- **No custody of loan principal.** The loan contract forwards funds in the same transaction and its token balance is zero at rest. The only balances held anywhere are opt-in set-asides in a separate vault contract (F5), withdrawable by their owner at any time.
- **Locked code.** After the final deploy, delete every full-access key on the contract accounts. README shows the key-deletion transaction and an empty `view_access_key_list`. Before deleting, register each contract account with the USDC token and fund it with what it needs and no more: NEAR left on a locked account cannot be withdrawn, though anyone can top it up. Where Docker is available, use a reproducible build and show that the on-chain code hash matches.
- **On-chain state wins.** The server mirrors contract events and never writes a claim the chain has not confirmed.
- **Exact money.** Integer base units (USDC has 6 decimals), `U128` strings across the API, no floating point anywhere.
- **Every time rule is a parameter.** Funding window, qualifying duration, recovery lock and DAO proposal period are set when a circle and its DAO are created, within floors fixed at init (zero on testnet, real values on mainnet). Testnet demo circles use minutes and are labelled DEMO in the UI; the mainnet pilot uses real values; sandbox tests fast-forward.
- **The agent has no privileges.** Every limit is enforced by a contract; the agent can only draft and crank.
- **Public and secret-free.** Judges cannot open private repositories, so the repo goes public before submission. Keys live in a gitignored `.env`, and a secret scan runs before the repo is made public.
- **Plain risk language:** “Loans are unsecured; repayment cannot be forced.”
- **Plain privacy language:** chat is access-controlled, not end-to-end encrypted. Loan terms, addresses and passport history are public on-chain.

## Architecture

| Piece | Role |
| --- | --- |
| `circle` contract | Circles, passports (NFT), invites, loans, events |
| `vault` contract | Opt-in set-asides and auto-lend rules (F5) |
| Sputnik DAO per circle | Circle admin and treasury (F2), deployed from a global contract by hash |
| Server | Chat, off-chain requests, event mirror |
| Relayer | Own account and budget; sponsors gas and USDC registration for invite holders (F4) |
| Agent | Own NEAR account; its key can only call the vault's two execute methods |
| Evidence harness | `evidence/evidence.json` and the claims script |

Config pins the USDC token account ID per network and the vault account ID. Both are set at init and immutable. The same wasm runs on testnet and mainnet; only init arguments differ.

- Mainnet USDC: `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`
- Testnet USDC: `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`
- A wrong ID at init cannot be fixed. Check both with an `ft_metadata` view (symbol USDC, 6 decimals) and against Circle's published list before any immutable init.

All state changes emit NEP-297 events; the server indexes those and nothing else.

**Who pays for what**

| Cost | Paid by | Note |
| --- | --- | --- |
| Loan and passport storage | The caller | Borrower for loans, joiner for the passport |
| Gas for members | Relayer | Per-account and total daily caps. For the hackathon the builder funds it and the README states the amount. A circle DAO voting to top up its own members' allowance is documented, not built |
| USDC registration | Relayer | One-time per member |
| Contract accounts | Builder, once | Pre-funded before key deletion |
| Agent gas | Agent account | Builder-funded for the hackathon; the README states the amount |

README publishes the measured NEAR cost of one full loan lifecycle (create, fund, repay) on mainnet.

## Features

### F0. Core loan loop (Open Innovation) \[Tier A\]

1. Sign in with a NEAR wallet (NEP-413). The signed message carries a server nonce, the recipient domain and an expiry; nonces are single-use. NEP-413 has no expiry field, so the expiry goes in the message text and the server checks it.
2. Create a circle, share an invite, join, chat.
3. Borrower posts an off-chain request (amount, days, note). Members tap “I'm interested”. Borrower picks one lender.
4. `create_loan(circle_id, lender, amount, duration_days)` locks the terms on-chain. Borrower pays the storage for the record.
5. Lender funds with `ft_transfer_call`; the contract forwards to the borrower. Repayment is the same in reverse.
6. Borrower can cancel while Open.

**Loan states**

| State | Enters when | Leaves when |
| --- | --- | --- |
| Open | `create_loan` | Funded, cancelled, or funding window (default 72 h) lapses |
| Funding / Repaying | A transfer is in flight | Callback resolves (blocks double-funding) |
| Funded | Forward to borrower confirmed | Repaid in full |
| Repaid | Total repaid equals principal | Final |
| Cancelled | Borrower cancels or window lapses | Final |
| Written off | DAO proposal on a treasury loan overdue 30 days or more | Stays payable; a full repayment moves it to Repaid (late) |

Overdue is not a stored state. It is derived in views from `due_at`, so nothing needs a cron job.

**Rules**

- The term starts at funding, not creation. `due_at = funded_at + duration`.
- `ft_on_transfer` accepts only the pinned USDC contract as caller, only the named lender (or the vault on the lender's behalf, or the circle's treasury account) for funding, and only the exact principal.
- Repayment may come from anyone, in parts. Excess is returned as the unused amount. “On time” means fully repaid by `due_at`.
- State changes commit in the callback, never before the forward succeeds. Callbacks are `#[private]`.
- If a forward fails (for example, the receiver is not registered with the token), `ft_on_transfer` resolves to the full amount as unused, so the token contract refunds the sender. Proven on testnet before it is claimed.
- Document the gas attached to `ft_transfer_call` and test the out-of-gas path.
- Bounds per circle: min and max amount, max duration, one open loan per borrower at Member tier. Hackathon mainnet deploy caps any loan at 50 USDC, since there is no pause switch.

### F1. Passport NFT (NFTs That Do Something) \[Tier A\] **NEW**

One passport per member per circle. NEP-171/177/181 views so wallets display it; `nft_transfer` always fails, because reputation that can be sold is worthless.

- **Mint:** only by redeeming an invite, and the invite lives on-chain. An inviter (a founder or a Trusted member) calls `register_invite(circle_id, invite_key, expires_at, invitee?)` and pays the storage. The link carries the invite's secret key. The invitee calls `redeem_invite`, which verifies an ed25519 signature over circle, caller and invite key, checks expiry, deletes the invite and mints. A named invite can be redeemed only by that account; an open invite goes to the first redeemer, so the UI defaults to named. A contract cannot read which keys an account holds, which is why the key is registered first; checking invites on the server would make the server an admin.
- **Gate for chat:** the server returns messages only after a signature check and an on-chain `check_access`. Access is re-checked at most every 60 seconds and open sockets are dropped on revoke.
- **Gate for loans:** `create_loan` and funding both fail unless borrower and lender hold active passports in that circle. The one exception is the circle's treasury account (F2), which may lend without a passport.
- **Tiers and what they unlock** (this is the part that makes the NFT do something):

| Tier | Earned by | Unlocks |
| --- | --- | --- |
| Member | Joining | Chat, 1 open loan, base amount cap |
| Trusted | N on-time repayments (circle setting, default 3) | Higher cap, 2 open loans, treasury loans, can invite |
| Steward | DAO vote | Votes on treasury, flags and revocations |

- **Authority:** voting power comes from the DAO policy; the Steward tier on the passport is the matching badge and the signal the contract uses to enable treasury lending. The app files both proposals together as one appoint-steward flow, and a view lists any drift between them.
- **Anti-farming:** a repayment counts toward Trusted only if the loan met the circle's minimum amount and ran at least the circle's minimum qualifying duration (default 3 days), and the N loans came from at least 2 different lenders. The pilot circle uses N = 1 and a 1-day minimum so a tier change can happen inside the window; the README says so.
- **Behaviour:** on-time and late counts live on the passport. An overdue loan pauses Trusted perks until repaid; a late repayment restores perks but the late count stays. The DAO can clear a wrong flag.
- **Revoke, suspend, expire:** chat and new agreements stop; open loans stay payable.
- **Recovery (cut first if late):** owner starts a move to a new account, 72 h time-lock (a parameter), cancellable from the old account. The old token is burned and tier and history are reissued.
- **Card art:** SVG generated on-chain from tier and status and returned as a data URI in token metadata, so it changes without a server. No personal data. Check that it renders in two NEAR wallets or explorers; if one will not show data URIs, the web app renders the same SVG from a view call and the README says so.

### F2. Circle treasury (Social Money) \[Tier A\] **NEW**

- Each circle gets a Sputnik DAO, set as circle admin. Deploy it from a global contract by hash: the standard factory takes a 6 NEAR deposit, which breaks the no-NEAR story and costs real money on mainnet, and deploying by hash fixes the DAO code, which fits Locked code. `sputnikv2.testnet` stays as the testnet fallback. Confirm both paths in Gate 0.
- **Council and quorum:** the council mirrors the Steward list. The policy uses a strict-majority ratio, so 1 of 1, 2 of 2, 2 of 3, 3 of 4 (confirm the threshold math in the DAO version you deploy). A new circle can start with one steward, who can pass the proposal that adds the second. Treasury lending turns on only while the circle has at least 2 Steward passports, so a lone founder can never lend treasury money. Set a short proposal period and a low proposal bond at creation (check the defaults in the DAO version you deploy).
- **Funding:** voluntary member contributions to the DAO, which is registered with USDC first. Say so plainly: the treasury is pooled money held by the DAO, not by CommonCircle contracts, and contributions rest on trust in the stewards. The contribute button stays off until the circle has 2 stewards, and the steward count sits beside it.
- **Lending:** the DAO account is the circle's `treasury` account. It cannot hold a member passport, so the circle contract allows it as a lender, only for Trusted borrowers who are not stewards (no self-dealing). A passed proposal funds the loan: a Transfer proposal with a `msg` makes the DAO call `ft_transfer_call` itself. Test that the gas Sputnik attaches covers the full funding flow; if it does not, use a FunctionCall proposal with explicit gas.
- **Default:** a treasury loan overdue by 30 days can be written off by proposal; the borrower's flag stays.
- **Rewards:** a badge on the passport card for repaid treasury loans, capped per member per month. Cash rewards are out of scope.

### F3. Cross-chain funding (Unstoppable DeFi) \[Tier C\] **NEW**

- Lender pays from another chain through NEAR Intents and receives USDC in their own NEAR account, then funds the loan with the normal `ft_transfer_call`. Two steps, one screen. This keeps the passport check and the refund path identical to F0.
- Request an exact-output quote so the lender ends up with at least the principal. If the swap lands short or the quote expires, nothing reaches the loan and the origin-chain refund address is used.
- The lender still needs a NEAR account and an active passport.
- No testnet exists for this, so demo amounts are tiny and real. README pairs the origin-chain hash with the NEAR funding hash.
- Read the Intents docs for how deposits are delivered before building; do not assume a `msg` can be passed straight to the loan contract.
- Go or no-go at Gate 2, and only if every Gate 2 item is green. The window is Gate 2 to the feature freeze, with a hard stop. If F3 is cut, the Unstoppable DeFi row is claimed only if the track's wording fits the locked-code evidence from F0 (confirm in Gate 0); otherwise it is dropped.

### F4. Real-world access (Real-World Money) \[Tier B\] **NEW**

- **Onboarding without buying NEAR.** A relayer sponsors gas (meta-transactions, NEP-366), pays the member's USDC storage registration, and seeds a dust amount of NEAR. Reason: token transfers need 1 yoctoNEAR attached and deposits come from the member's own balance, so a truly empty account cannot repay. Verify this on testnet in Gate 0. Invites travel as links, and the UI offers a WhatsApp share button.
- **Relayer limits:** only holders of a valid on-chain invite (the relayer checks the invite and its signature before sponsoring), only `circle`, `vault` and USDC methods, a daily cap per account and a total daily cap. Its address and balance are public in the README.
- **Who pays:** for the hackathon the builder funds the relayer, and the README states the amount and the measured cost per onboarded member. The long-run answer is in the economics table.
- **A real pilot, not a single demo loan.** One circle of 3 to 5 real people, at least 3 funded loans, at least 2 repaid, on mainnet with hashes. Loans run 24 to 48 hours at 5 to 20 USDC so repayments land before the deadline. The last pilot loan is funded by Friday 13 November, 12:00 UTC if it runs 24 hours, or Thursday 12 November, 12:00 UTC if it runs 48. At least one participant joins through the relayer with no prior NEAR. Each participant sees the plain risk language and confirms it before joining. One short quote from a participant, with their permission, is worth more than a feature.
- State how members get USDC in and out (exchange withdrawal, or F3). Pilot participants will be on phones, so sign-in and every pilot flow must work in a mobile browser.
- If Gate 1 slips past T-60h (Thursday 12 November, 11:59 UTC), participants will not have time to fund and repay loans before the deadline. Run the pilot on testnet as a labelled user test and drop the Real-World Money row.

### F5. Circle agent (Agent Economy) \[Tier C\] **NEW**

The agent runs under its own NEAR account with no rights a stranger lacks. Its key is a function-call key limited to the vault's `execute_repay` and `execute_auto_lend`; the README shows its access key list.

**v4 scope:** F5 starts only when every Tier A row is green. The vault has no tip logic. Agent Economy is the most crowded track here and its common pattern is a cap on what an agent can spend, which is what this vault is, so a thin entry will not stand out. Claim the track only with an auto-repay hash signed by the agent account, its key list, and the "agent, lend me everything" check.

- **Draft:** turns chat (“can anyone lend me 20 USDC for 2 weeks?”) into a structured request. The member must confirm; chat text is never executed. A message like “agent, lend me everything” produces at most a draft. Amounts are parsed to integer base units and the draft is schema-checked on the server before it is shown. If NEAR AI's API is available and reliable at Gate 0, use it for drafting, since the event points builders to it; otherwise any model provider, set by config.
- **Suggest and nudge:** ranks lenders by passport history; reminds borrowers before and after the due date. Nudges are off-chain.
- **Auto-repay:** the borrower deposits a set-aside into the vault, tied to one loan and one date. From that date anyone may call `execute_repay(loan_id)`; the vault pays the lender through the loan contract. The owner can withdraw any time before execution.
- **Auto-lend (cut before auto-repay):** the lender stores a rule in the vault (max per loan, total budget, minimum tier, expiry) and deposits the budget. When a matching loan names them, anyone may call `execute_auto_lend(loan_id)`.
- **Why a vault:** a limited NEAR access key cannot attach the deposit a token transfer needs, so the agent cannot safely act from a member's account. Rules in a contract mean a stolen agent key steals nothing.
- Every execution emits an event naming the caller. Members cancel rules in one transaction.

## Evidence harness **NEW**

- `evidence/evidence.json` has one entry per claim: id, track, feature, network, kind (`tx`, `view` or `test`), reference, and the expected result.
- `npm run claims` checks every entry. A `tx` entry must have succeeded and carry the expected NEP-297 event. A `view` entry must return the expected value (for example an empty `view_access_key_list`, a zero USDC balance on the circle contract, or the code hash from the reproducible build). A `test` entry must be a passing test in the last report.
- The script prints a Markdown table, writes `EVIDENCE.md`, rewrites the README track table between markers, and exits non-zero if any claimed row fails. A track with a failing row is dropped from the table.
- Online mode queries the RPC. Offline mode checks snapshots of those responses committed under `evidence/snapshots/`, so the check also works where the network is blocked.
- Tests are named after the README checks, so a reader can follow a claim to a test or a hash in one step.
- CI clones the repo into an empty directory and runs the README quickstart word for word. The quickstart needs no secrets. The web app also has a read-only demo mode that needs no wallet and reads the deployed testnet contracts, so a reviewer can see real data.

## Threats and answers

| Threat | Answer |
| --- | --- |
| Double-funding during an in-flight transfer | Funding state blocks re-entry |
| Fake token contract calls `ft_on_transfer` | Caller must equal pinned USDC ID |
| Wrong USDC ID at init | `ft_metadata` check on both networks before the immutable init; the harness compares the pinned ID with the README |
| Selling or renting reputation | Passport is non-transferable |
| Farming Trusted with tiny loans | Minimum amount, duration, 2 lenders |
| Invite link leaks or is raced | Registered on-chain, single-use, expiring; named invites bind to one account |
| Signature replay at login | Nonce, recipient, expiry |
| Prompt injection through chat | Agent drafts only; contracts enforce caps; the agent key can call only the execute methods |
| Relayer drained | Invite check, method allowlist, per-account and total caps |
| Storage bloat | Caller pays storage for loans and passports |
| Treasury self-dealing | Stewards cannot borrow from the treasury; treasury lending needs 2 Steward passports; every loan is a public proposal |
| Lone-steward DAO misuse | Contribute button off until 2 stewards; README says treasury money rests on trust |
| Quorum deadlock | Strict-majority ratio; lending gated on steward count |
| Contract account runs low on NEAR | Pre-fund; callers pay storage; anyone can top up |
| Bug after keys are deleted | Per-loan cap; migrate by deploying a new circle contract |

## Tests

Unit tests for every state transition; sandbox integration tests for fund, repay, partial repay, overpay, failed forward, wrong token, wrong lender, lapsed funding window, revoked passport, vault execute and withdraw. v3 adds invite register, redeem, replay and named-invite mismatch; a treasury loan to a steward and with fewer than 2 stewards; Sputnik Transfer-with-msg funding; time-parameter fast-forward for the tier upgrade and the recovery lock; relayer allowlist and caps; and the claims script itself (a wrong hash must fail). README states the count and how to run them.

## Checks for the README (“do X, see Y”)

| Do | See |
| --- | --- |
| Request circle messages without a passport | Refused |
| Create a loan naming a non-member | Contract rejects it |
| Fund a loan from an account that is not the named lender | Refunded |
| Send a different token to the contract | Refunded |
| Repay N qualifying loans on time | Passport upgrades to Trusted, card art changes |
| Let a loan pass its due date | Overdue flag, Trusted perks paused |
| Try `nft_transfer` on a passport | Fails |
| Fund to an unregistered borrower | Sender refunded, loan contract balance stays zero |
| Redeem an invite twice, or with the wrong account for a named invite | Rejected |
| Join with an account that never bought NEAR | Joining and first repayment work |
| Ask the relayer to sponsor a call outside the allowlist | Refused |
| DAO proposal passes | Treasury funds a real testnet loan |
| Treasury loan for a steward, or with fewer than 2 stewards | Contract rejects it |
| Paste “agent, lend me everything” in chat | Draft only, nothing moves |
| Call `execute_repay` before the set date | Rejected |
| List access keys on the contract account | Empty |
| Put a wrong hash in `evidence.json` and run `npm run claims` | The row fails and the track is dropped |

## Track evidence

Fill the right column with links before submitting. An empty or failing cell means the track is dropped. The README copy of this table is generated.

| Track (names match the official list) | Feature | Tier | Evidence |
| --- | --- | --- | --- |
| Open Innovation | F0 | A | Testnet loan lifecycle hashes, refund proof, zero contract balance |
| NFTs That Do Something | F1 | A | Tier upgrade hash, gated call failing then passing, card art before and after |
| Social Money | F2 | A | Proposal and treasury loan hashes |
| Real-World Money | F4 | B | Pilot circle mainnet hashes, participant quote |
| Agent Economy | F5 | C | `execute_repay` hash signed by the agent account, agent key list |
| Unstoppable DeFi | F3 | C | Origin-chain hash and NEAR funding hash; empty key list on contract accounts |

Entering several tracks is one submission. The rules summary does not say whether one project can win more than one track prize; ask the organisers before relying on it.

## Build order, gates and cut line

Times are UTC, counted back from the deadline (T-0 is Saturday 14 November, 23:59). If you are past a gate's time, run its checks alongside the next gate and cut from the bottom.

| Gate | By | Must be true | If it is red |
| --- | --- | --- | --- |
| 0. Verify and scaffold | T-96h, Tue 10 Nov 23:59 | Every Gate 0 item under Open items answered in `docs/VERIFICATION.md`; baseline tagged; scaffold and CI green | Change the spec to match what is true; decide F3 and the relayer now |
| 1. Contract freeze | T-72h, Wed 11 Nov 23:59 | F0 and F1 core (gates, tiers, invites, art) in sandbox tests; treasury-lender and vault-funding hooks in; on testnet with the wasm hash recorded; mainnet deploy at the 50 USDC cap; relayer live; pilot circle created and invites sent | Cut F1 recovery. If F0 refunds are not proven, nothing else proceeds. Past T-60h, see F4 |
| 2. Tier A proof | T-48h, Thu 12 Nov 23:59 | F2 treasury loan by proposal on testnet; web app has sign-in, chat gate, request-to-fund flow and card; Tier A evidence rows green; first pilot loan funded; F5 go or no-go (go only if every Tier A row is green); F3 is a no-go unless F5 is already green | Cut F2 write-off and badge; F5 and F3 are no-gos |
| 3. Pilot proof, feature freeze | T-24h, Fri 13 Nov 23:59 | Pilot has 3 funded loans and 1 repaid; if F5 was a go, vault and agent on testnet with an auto-repay hash signed by the agent, and chat drafts; F3 hashes if it was a go; full demo recorded on testnet as the backup | Cut auto-lend, then F5 |
| 4. Ship | T-6h, Sat 14 Nov 17:59 | README done, claims script green, secret scan clean, repo public, mainnet key-deletion transaction, X post live, form submitted | Drop every track whose rows fail |

The contracts freeze at Gate 1, so everything after it is the DAO, vault, server, relayer, agent and UI. The vault is a separate contract for that reason.

Order: F0 with refunds and tests, F1, then F2. Start the pilot clock as soon as Gate 1 is green, because real repayments take real days. Then F5, then F3. Nothing else matters if F0 breaks on stage.

Cut from the bottom: F3, F5 auto-lend, F5 itself, F2 write-off, F1 recovery. Never cut the F0 refund proofs, the F1 gates, non-transferability, the claims script or an accurate README. Four tracks done properly beat six done thinly, and a broken claim costs more than a missing one.

## Demo (3 minutes)

1. The problem in one sentence ("ajo pays you in turn; what do you do when it isn't your turn?"), then a new member joins from an invite with no NEAR (20 s).
2. Chat request becomes a draft, lender funds, explorer shows the contract balance at zero (45 s).
3. Repay; passport flips to Trusted and the card changes live (30 s).
4. Show a failure on purpose: non-member loan rejected, unregistered receiver refunded (25 s).
5. A DAO proposal funds a loan; if F5 shipped, auto-repay fires from the vault (30 s).
6. Pilot numbers, the empty access-key list and `npm run claims` all green (30 s).

A cut feature's beat is replaced by a recorded clip of something that did ship, never skipped silently. Record the full run on testnet at Gate 3 as the backup. Cut a version under 2 minutes 20 seconds for X; standard accounts cap video length near that (check yours).

## Submission checklist

- **Public repo with a clear README:** quickstart, claims output, track table, baseline disclosure, risk and privacy language, relayer address and balance, transaction hashes, and a short "How this differs from pot-rotation circles" section (no competitor names, nothing unverified).
- **Public demo post on X:** says it was built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, and shows the video or screenshots. Draft it at Gate 3 and make sure it fits your account's character limit with the tags.
- **Form on nearhackathon.com:** project name, team lead, team size, tracks, NEAR wallet address for prizes, repo link, post link, and a description of 20 to 2,000 characters. Prizes are paid in NEAR to that address, so check it twice.
- **Timing:** submit by T-6h. A Request changes form exists for corrections but is reviewed by hand, so do not plan on it.

## Out of scope

Investment Thesis, Games With Real Economies, AI Swarms and Privacy & Private AI. Interest and collateral. Funds pooled inside CommonCircle contracts. End-to-end encryption. Reputation that carries between circles. Debt collection of any kind. Cash rewards. A pot-rotation (ROSCA) mode. Keeper tips and the Autonomous Business track. Anything not in Tiers A to C.

## Open items

**Gate 0 (answer in `docs/VERIFICATION.md`)**

- Rules page (nearhackathon.com): exact wording of each track, the judging criteria, prior-work rules, the deadline and submission format. Ask the organisers whether one project can win more than one track prize; the rules summary does not say.
- USDC: `ft_metadata` on both IDs, plus Circle's published list.
- Meta-transaction onboarding: a new account holding dust NEAR joins and repays.
- Sputnik: global-contract DAO deploy on testnet and its cost; the policy defaults to override; the threshold math; the gas a Transfer with msg attaches.
- Intents: how the destination deposit is delivered, whether exact output is supported, and the refund address.
- Event mirror: pick one indexer (Lake framework or a hosted one), confirm it is currently available, and read one NEP-297 event with it.
- Sign-in (NEP-413) works from a phone browser with at least one mobile wallet.

**By Gate 1**

- Card art renders in two wallets or explorers.
- The mainnet deploy checklist is done: USDC registration, funding, init arguments, wasm hash recorded.

**By Gate 3 (before the README's comparison section is written)**

- Competitor read: open the description, repository and links of the closest NEAR Hunt entries (AJO ON NEAR, Ajo Onchain, Kring, Rota, Contri, Bolsillos, Marks, and the entry whose name starts "NEAR Rep"). `GET https://nearhunt.xyz/api/projects?q=<name>` returns them. If one already shows something the README calls distinctive (a non-transferable tiered passport, treasury loans by proposal, joining with no NEAR), reword the claim to what is provable and keep the feature.
- One line per entry read in `docs/VERIFICATION.md`: what it does, what it holds, and whether it has a mainnet transaction.

**Always**

- Claim a track only when its evidence exists; drop it otherwise.
- Check whether lending between community members is regulated where you and the participants live before using real money.

## Changes from v3

- **Positioning:** the pitch no longer opens with the rotating savings circle. A NEAR Hunt scan found two entries with "ajo" in the name and at least five more community-money tools, all tagged Real world or Social. New pitch: ajo pays in turn; CommonCircle is for when it isn't your turn. New section "Where this sits in the field", with a model-level comparison.
- **Claim set:** Autonomous Business and keeper tips are dropped. F5 moves from Tier B to Tier C, ahead of F3, and starts only when Tier A is green, because Agent Economy has 226 listings and the vault follows the most common pattern in it.
- **Gates:** Gate 2 decides F5 and F3 separately; Gate 3 puts the pilot first.
- **Docs:** a competitor read before the README's comparison section; the README gets a short "how this differs" section with no competitor names.
- **Unchanged:** F0, F1, F2, F4, the evidence harness, and every contract frozen at Gate 1. The vault loses its tip logic.

## Changes from v2

- **Clock and gates:** UTC times counted back from the deadline; F2 now follows F1; the pilot starts at Gate 1; the F3 go or no-go moved to Gate 2.
- **Tracks:** seven rows (Agent Economy and Autonomous Business are separate tracks), tiers, and a generated README table; unproven rows drop out.
- **New:** strategy and scoring map, evidence harness, who-pays table, time parameters, keeper tip, cut order, submission checklist, backup demo.
- **Review fixes:** quorum no longer deadlocks; the treasury can lend without a passport; invites are registered on-chain; relayer funding is stated; the DAO deploys from a global contract; full USDC IDs; a Transfer with msg funds treasury loans.
- **Loan states:** Written off added.
- **Scope cuts:** cash rewards out; F1 recovery marked cut-first.
- **Baseline:** annotated tag, SHA and date in the README, generated `NEW_FILES.md`.
