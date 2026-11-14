# CommonCircle: final screener report (14 Nov 2026)

Written by the reviewing agent (Claude Code) on the day of the deadline
(14 Nov 2026, 23:59 UTC). It covers: the rival scan, a feature-by-feature check of
the live app, the bugs fixed today, a mock judging panel, the pitch pack, what is
still worth doing, and the list of things only the builder can do.

**No contract change, no key deleted, no mainnet, no testnet transaction was sent
in this pass.** Anything not checked is marked "unverified" or "needs a wallet".

Live app: https://lightokey839-rgb.github.io/commoncircle/?demo=1 ·
repo: https://github.com/lightokey839-rgb/commoncircle

## 1. The three things that mattered most

1. **CI had been red for three commits, and the Evidence page was out of date.**
   The public repo showed a failing check. One evidence row
   (`f1-web-passport`) expected the builder wallet's passport to show exactly 1
   on-time repayment; that wallet repaid another loan on time on 13 Nov, so the
   chain said 2. The app still showed "36 of 36" from an older run while the
   live re-check said 35 of 36. Fixed (section 4, bug 1): the row now asserts
   only the lasting facts, and all 36 rows were re-read from testnet.
2. **`npm ci` fails on Windows.** A leftover development tool from the earlier
   LoanBook app (Foundry) has an install script written for Linux. CI uses
   `npm ci --ignore-scripts`; the README told readers to run plain `npm ci`.
   A judge on Windows following the README would have stopped there. The
   README now gives the command CI uses.
3. **The first screen showed a judge almost nothing.** Circles are private, so
   a visitor with no wallet saw a welcome text and a small "View the public
   demo circle" button. Now the first screen shows two facts read live (the loan
   contract holds 0 USDC; 36 of 36 claims pass) and one clear button, and the
   link `?demo=1` opens the demo circle directly.

## 2. Competitor scan

Source: the official directory at `https://nearhackathon.com/api/projects`
(1,175 submissions on 14 Nov), plus GitHub and each project's README. For each
rival the demo URL was requested once (HTTP status only; nobody clicked through
the apps) and, where an account name was given, `view_account` was called to see
whether contract code is there ("RPC ok"). Test counts and transaction lists are
**the rivals' own README claims, not re-run**. X posts could not be read.
Coverage: about 25 of 118 entries in `nfts`, 30 of 121 in `social`, and only the
theme-adjacent part of 276 in `open`. Other teams' pages were treated as data;
none of their code, text or design was copied.

**Headline.** Savings circles (ajo, susu, ROSCA) are a crowded niche: at least
13 entries. None of the entries opened does what CommonCircle does:
member-to-member loans on request, with tiers written by repayment. The nearest
are PasanakuDAO (on-time payment → reputation → tier, but for a rotating pot)
and CareFund (loans, but paid to a hospital against milestones).

### NFTs That Do Something (118 entries)

| Rival | Idea in one line | Live | What is on-chain | Strongest point |
|---|---|---|---|---|
| Contri | Ajo circle where each turn is an NEP-171 seat NFT carrying the right to the pot | contri.ng/demo, 200 | **Mainnet**, `circles.contring.near` RPC ok; README says locked, with a real-USDT circle | Mainnet with real money |
| NearSeat | Season-membership NFTs that own keyless accounts and earn | 200 | Testnet, `nearseat.testnet` RPC ok | 96 unit + 15 sandbox tests claimed |
| Pusaka | NFTs holding native Bitcoin through Chain Signatures, with inheritance and lending | 200 | Testnet, `pusaka-btc.testnet` RPC ok | Deepest engineering seen |
| NearThrift | ROSCA where each seat is a tradable NFT with a keyless USDC sub-account | 200 | Testnet, unverified | Follows the track prompt closely |
| Ajo (snr-demz1) | ROSCA with collateral and soulbound reputation that orders payouts | none found | Testnet, `ajo-26192.testnet` RPC ok | Soulbound reputation with tiers and slashing |
| Cowrie | Completing a savings circle mints a non-transferable credential that lowers future collateral | HTTP 402 when checked | Testnet, unverified | A credential with an economic effect |
| Society Treasury | Student-society treasury with a non-transferable membership pass and voting | 200 | Testnet, RPC ok | Email sign-in; same three tracks as us |
| CrewPass | Ambassador pass NFTs whose tier (Bronze → Platinum) updates on-chain | 200 | Testnet, RPC ok | Dynamic tier metadata |
| Satchel (ChrisTu117) | Club membership cards that are real NEAR accounts | 200 | Testnet, RPC ok | Clean build of the track's example |
| Retr0 Academy | A course whose soulbound certificate unlocks holder-only content | 200 | **Mainnet**, RPC ok | Soulbound credential on mainnet |

### Social Money (121 entries)

| Rival | Idea in one line | Live | What is on-chain | Strongest point |
|---|---|---|---|---|
| Njangi | Each savings circle gets its own Sputnik DAO; the contract pays out automatically; reputation gate | 200 | Testnet, `njangi-app.testnet` RPC ok | Unmodified Sputnik DAO as treasury, exactly the track's ask |
| PasanakuDAO | USDC ROSCA: on-time payments raise reputation, which unlocks larger tiers; Sputnik + Trezu | none found | Testnet, RPC ok | Nearly our mechanic, applied to a pot |
| Koperasi | Member-owned co-op on an unmodified Sputnik DAO; earned-trust tiers; disputes | 200 | Testnet, unverified | A one-command verifier and 19 refused attacks claimed |
| Saving Circles (Bread Cooperative) | Port of an existing co-op savings-circle product | 200 | Testnet, RPC ok | An established team |
| Passpot | ROSCA where the pot sits in its own Sputnik DAO | 200 | Testnet, RPC ok | No-wallet demo with an on-page Verify view |
| Pot | Group money app; each Pot is a Sputnik DAO; spending limits grow with track record | 200 | Testnet, unverified | The most consumer-polished product seen |
| Hat Tip | Peer thanks paid as Sputnik DAO proposals | 200 | Testnet, unverified | README maps the track prompt line by line |
| Tideover | Private hardship fund as a module on a Sputnik DAO | no hosted copy | Testnet, unverified | Closest to a family-emergency use |
| Kring | Invite-only freelancer sick-pay circle | 200 | Testnet, RPC ok | A private trusted circle with vote and veto |
| Admit | Community pools guarantee hospital deposits; members get credit limits | none found | Testnet, RPC ok | The only other "credit limit" design; 171 tests claimed |

### Open Innovation (276 entries; only theme-adjacent ones were opened)

| Rival | Idea in one line | Live | What is on-chain | Strongest point |
|---|---|---|---|---|
| SusuChain | ROSCA with collateral, random payout order and a portable savings record | 200 | Testnet, RPC ok | One-click testnet account and seeded circles |
| Pusaka | (as above) | 200 | Testnet, RPC ok | Technical depth |
| Society Treasury | (as above) | 200 | Testnet, RPC ok | Same three tracks as us |
| CareFund | Community grants and loans paid to the hospital, with a verifier stake | 200 | Testnet, RPC ok | The only other entry seen that lends |
| circlehub | Community treasuries on Sputnik DAO with an AI assistant | 200 | Not stated; app data in Supabase | Broad product surface |
| RSVPay | Wedding gift envelopes as NFTs that hold money | not checked | Testnet, unverified | Polished |
| Daykeeper | A public treasury whose daily keeper is auctioned and gets scoped keys | not checked | Testnet, unverified | Novel use of access keys |
| Logen | Membership NFT with a keyless wallet and revenue share | 200 | Testnet, unverified | An "Attack Lab" demo page |

Most of this track is agent, security and privacy work that was not assessed.
That is the largest gap in this scan.

### Comparison on the five criteria

These are **desk estimates from READMEs and HTTP checks**, on the weights the
builder asked for (Execution 30, Launch potential 25, Originality 20, Craft & UX
15, Vibecoding leverage 10). They are a decision aid, not a prediction. Rivals'
apps were not used, so their Execution and Craft scores are the least certain.
The NEAR HACKATHON guide publishes **no scoring rubric**; its FAQ says earlier
NEAR hackathons looked at "technical implementation, design, impact, originality
and sustainability".

| Project | Execution | Launch potential | Originality | Craft & UX | Vibecoding | Total /100 |
|---|---|---|---|---|---|---|
| Contri | 9 | 8 | 6 | 7 | 6 | 76 |
| Pusaka | 9 | 5 | 9 | 6 | 7 | 73.5 |
| NearSeat | 8 | 6 | 6 | 7 | 7 | 68.5 |
| Njangi | 7 | 7 | 6 | 7 | 6 | 67 |
| Pot | 7 | 7 | 6 | 8 | 6 | 68.5 |
| Koperasi | 7 | 6 | 7 | 6 | 7 | 66.5 |
| SusuChain | 7 | 6 | 5 | 7 | 6 | 62.5 |
| PasanakuDAO | 6 | 6 | 6 | 4 | 6 | 57.5 |
| **CommonCircle** | **7** | **5** | **7** | **6** | **7** | **63.5** |

### The three biggest threats per track, and what beats each

**NFTs That Do Something**

1. **Contri** (mainnet, real money, locked). We cannot match mainnet today. What
   beats it: our NFT *changes because of what its holder did*, and that change
   gates credit. Show the tier flip live in the video and link the
   `tier_changed` transaction. Be exact that we are testnet.
2. **NearSeat** (test volume). What beats it: 36 evidence rows that CI re-reads
   from testnet on every push, a red-team file, and one keyless command. This
   only works while CI is green, which is why bug 1 mattered.
3. **Pusaka** (depth). We do not win on depth. What beats it for a judge who
   weighs usefulness: a complete human loop (ask, lend, repay, tier) that a
   family could follow.

**Social Money**

1. **Njangi** (a Sputnik DAO per circle, automatic payouts). What beats it: the
   track says "don't rebuild the multisig, build what communities do with it".
   Ours lends on need, not on a schedule, and gates the treasury by earned
   reputation. Show the steward's own request refused and the late mark
   forgiven by vote.
2. **PasanakuDAO** (the same repayment → tier idea). No hosted demo was found
   for it. What beats it: a live app and two-wallet web evidence.
3. **Koperasi** (verifier script, refused attacks). What beats it: lead the
   README with our own one-command check and the red-team results. Done.

**Open Innovation**

1. **SusuChain** (one-click demo account). This is our real weakness: joining
   needs an invite, some NEAR and a USDC setup. What narrows it: the `?demo=1`
   link and the first-screen proof strip. What would beat it: gas sponsorship
   (not built).
2. **Pusaka** (depth), as above.
3. **Society Treasury** (same three tracks, email sign-in). What beats it: our
   money flow is the novel part (zero custody with refunds proven on testnet),
   not the membership pass.

## 3. Feature verification

Checked on the **live** site (the build before today's fixes, from commit
`0213b9a`) in the browser pane, and by read-only testnet views. Viewports:
1366×900, 390×844 and 320×640 (the pane rendered the last one as 328×656).
"Needs a wallet" means the path was read in the code and is covered by unit
tests, but nobody clicked it today.

| # | Feature | Result | How it was checked |
|---|---|---|---|
| 1 | Page load, console errors | PASS | Fresh storage, 1366×900: Overview loads, 0 console messages, on every page |
| 2 | Testnet status pill | PASS | Shows "Testnet live" |
| 3 | Stale-data banner | PASS | RPC requests were made to fail inside the page: pill became "Stale · time", the banner said money actions stay off, old data stayed on screen labelled, and it cleared after recovery |
| 4 | Non-members see no circle data | PASS | No wallet: Chat, Members, Loans, Direct loans, My loans, My passport, Treasury and Activity each show only "for circle members"; Overview shows no numbers |
| 5 | Invite link: on-chain check | PASS | Junk text → "That is not an invite link". A well-formed link with an unknown key → "This invite was already used or does not exist" |
| 6 | Invite link: Join button, NEAR-cost warning, "already a member" | Needs a wallet | Code read (`joinInvite`). **FAIL found and fixed:** the toast said "Invite found" before the check, and two texts gave different costs (0.009 and 0.01 NEAR) |
| 7 | Chat server `/health` | PASS | HTTP 200: postgres store, shared, durable, "encryption: none" |
| 8 | Chat server CORS | PASS | Preflight from the app's origin is allowed; from another origin no allow header is returned |
| 9 | `/nonce` refuses a foreign recipient | PASS | `recipient: evil.example` → HTTP 400 "does not accept that recipient"; the app's own host → 200; chat without a token → 401 |
| 10 | Chat UI gate | PASS | No wallet: "Connect your wallet to open the chat", composer hidden |
| 11 | Chat polling | Needs a wallet | Code read: 3 s while open, 15 s in the background, one timer |
| 12 | Ask → offer → choose → link | Needs a wallet | Code read end to end (`postAsk`, `requestAction`, `chooseLender`) plus `tests/requests.test.ts`. A retry links the existing on-chain loan and does not create a second one |
| 13 | Direct loan form | PASS (no-wallet state); other states need a wallet | No wallet: a full "Connect your wallet" state with the "Check before you sign" notes |
| 14 | "Check before you sign" dialogs | PASS by code review; live needs a wallet | `money()` re-reads the loan from testnet, refuses stale data, checks the state for fund, repay and cancel, and opens the summary; `runMoney` never throws and reports refunds as failures with the transaction link. **Improved:** the repay box now shows the time left |
| 15 | Passport page: My vs Member labels | PASS, with one **FAIL fixed** | A visitor sees "Member passport" and "Viewing another member (read-only)". But the treasury line said "You are Trusted…" on someone else's passport. "My passport" itself needs a wallet |
| 16 | Treasury page | PASS, with one **improvement** | DAO, balance, stewards, trust-check text and proposals load. Open votes for cancelled loans gave no hint that they are dead; they now say so |
| 17 | Steward-only badge | PASS for a visitor (hidden); for a steward: unverified | The steward accounts are command-line accounts, not browser wallets. **FAIL fixed:** Members showed "Steward Steward" (two badges) |
| 18 | Zero custody | PASS | `ft_balance_of(commoncircle-light.testnet)` = 0 by direct RPC call; the DAO holds 2 USDC, shown on its own tile |
| 19 | Evidence page: 36 claims | PASS after the fix | 36 rows shown in three tracks. **FAIL fixed:** see section 1, point 1 |
| 20 | Evidence links open | Unverified from here | The 19 explorer links are well-formed, but NearBlocks answers automated browsers with a bot check (HTTP 403), which was not bypassed. The same 19 transactions were re-read over RPC by `build-evidence.mjs` |
| 21 | Top-bar wallet balance | Needs a wallet | Code read |
| 22 | Invitations paste box | PASS | Same checks as row 5, from the Invitations page |
| 23 | Phone tab bar and More drawer | PASS by page structure | At 390 px the five tabs are visible; More opens the drawer and Escape closes it. The slide animation could not be watched because the pane was hidden |
| 24 | Dark theme | PASS, with one **FAIL fixed** | It switches and is remembered. White text on the green buttons had contrast 3.15:1 in dark and 4.32:1 in light (the guideline is 4.5:1) |
| 25 | No horizontal overflow | PASS | 14 pages at 1366, 390 and 320: no element wider than the screen |
| 26 | Contract facts | PASS | Code hash `J4X6efo…LxGr`, interface 1.1.1, one full-access key on the contract (disclosed), DAO on the pinned Sputnik hash with 0 keys |
| 27 | `node contracts/scripts/check-testnet.mjs` | PASS | All 10 checks pass |

### Local commands

| Command | Result |
|---|---|
| `npm ci` | **FAIL on Windows** (Foundry install script). First attempt also failed because an old local preview server was holding a file; that server was stopped |
| `npm ci --ignore-scripts` (what CI runs) | PASS: 1,199 packages, 21 minutes on this PC |
| `npm run typecheck` | PASS (clean) |
| `npm run lint` | PASS (clean) |
| `npm test` | PASS: 168 passed, 1 skipped (the PostgreSQL suite, which needs a database) |
| `npm run build` | PASS |
| `npm run claims:test` | PASS |
| `node contracts/scripts/build-evidence.mjs && npm run claims` | PASS: 36 of 36, every row re-read from testnet on 14 Nov |
| `npm run test:db` | Not run locally in this pass (no server code changed); CI runs it on every push |

### Wallet steps (for the builder, in two browsers)

Browser A is `254edye5v.testnet`; browser B is the new wallet. Each step is one
action and one thing to look for. Steps 5 to 12 are the video, so recording and
testing can be the same run.

1. **A:** connect Meteor. *Look for:* your account, USDC and NEAR balance in the top bar.
2. **A:** open **My passport**. *Look for:* the title "My passport", "Your account", Trusted.
3. **A:** on that page pick another member in "Viewing". *Look for:* "Member passport" and "These are …'s numbers, not yours", and the treasury line no longer says "You".
4. **A:** **Invitations** → **Create invite link**. *Look for:* a link and a QR code. Copy it.
5. **A:** paste the link into A's own "Got an invite link?" box → **Join**. *Look for:* a message that this wallet is already a member. Then press **Use a different link**.
6. **B (no wallet yet):** open the link. *Look for:* "Valid invite from 254edye5v" and the cost "about 0.01 NEAR".
7. **B:** connect the wallet → **Join The Dogs (DEMO)**. *Look for:* "Welcome to the circle!" and a passport picture.
8. **B:** step 3 **Sign in**, then step 4 **Set up USDC**. *Look for:* "No fee was charged", then "lenders can now send you USDC".
9. **A and B:** open **Circle chat**; B sends "hello". *Look for:* it appears in A within about 3 seconds.
10. **B:** **Ask for a loan** (1 USDC, 7 days, a reason) → **Post request**. **A:** **Offer to lend**. **B:** **Borrow from 254edye5v**. *Look for:* the card says "Loan #… names 254edye5v as lender".
11. **A:** **Fund 1 USDC** → **Send 1 USDC**. *Look for:* the "Check before you sign" box, then a green line with "View the transaction".
12. **B, within 7 minutes:** **My loans** → **Repay 1 USDC** → **Pay 1 USDC**. *Look for:* the time left in the box, "Repaid on time", and **My passport** showing Trusted.
13. **A:** **Direct loans**. *Look for:* a form with a member picker and your limit.
14. **A:** **Treasury**. *Look for:* an "ask the treasury" form (A is Trusted and not a steward) and no number badge on the Treasury menu item.
15. **Phone:** open the site on a real phone. *Look for:* the bottom tabs, and the menu sliding in from **More**.

If any step shows something else, note the step number and the exact words on screen.

## 4. Bugs fixed today

All in commit `6cd6819` (web, tests, evidence) and the docs commit that follows
it (README, this report, the video script). The contract was not touched.

| # | Severity | What was wrong | Root cause | Fix | Test |
|---|---|---|---|---|---|
| 1 | High | CI red on the last three commits; the app showed "36 of 36" while the live re-check gave 35 of 36 | Row `f1-web-passport` asserted `on_time_count: 1` on a wallet that is still in use; loan 21 made it 2 | The row asserts `tier: Trusted, status: Active`; the repayment that earned the tier is still proven by `f1-web-repay-tier`. All rows re-read from testnet | CI "Online claims" step |
| 2 | High | README install command fails on Windows | Foundry's install script uses Linux syntax; CI already used `--ignore-scripts` | README now says `npm ci --ignore-scripts` and explains why | Run by hand |
| 3 | Medium | A judge with no wallet saw nothing live on the first screen | Circles are private, and the demo was behind a small button | A proof strip (live 0 USDC, claims count, one button) and the `?demo=1` link. It shows only public facts and stays hidden for anyone with an invite | `overview.test.ts`: `wantsPublicDemo`, `evidenceTotals` |
| 4 | Medium | Members showed "Steward Steward" | The display tier of a steward is already "Steward", and a second badge was added | One badge | Browser check |
| 5 | Medium | Another member's passport said "You are Trusted… you can ask the treasury" | One text for both cases | Third person when the passport is not yours | `overview.test.ts` |
| 6 | Medium | "Invite found" appeared before the invite was checked, and the cost was given as 0.009 in one place and 0.01 in another | Text written before the on-chain check existed | "Invite link read… being checked"; one cost text (0.009 storage plus a small fee) | Browser check |
| 7 | Low | With no circle open, the hero said "Viewing a circle" and step 2 said "Join The Dogs (DEMO)" | The demo circle is loaded in the background and its name leaked into the text | The name appears only when the circle is open to you or you were invited to it | Browser check |
| 8 | Low | A repayment could land seconds late with no warning (it happened: loan 19, 26 s late) | The box said "counts as on time" without the time left | The box shows the time left when it opened | `money.test.ts` |
| 9 | Low | Open votes for cancelled loans looked live | The DAO keeps them "InProgress" until they expire | A plain note: "loan #13 was cancelled, so this vote can no longer pay it" | `treasury.test.ts` |
| 10 | Low | White text on green buttons was under the contrast guideline | Accent colour too light (light theme) and much too light (dark theme) | Slightly darker green in light; dark text on the green in dark | Contrast computed: about 5:1 and 6:1 |
| 11 | Low | The public repo description said "private until Gate 4" and had no app link | Never updated | Description and homepage set on GitHub | — |
| 12 | Info | README said chat "runs on the local sign-in server" and listed hosting as future work | Written before the Render deployment | README rewritten (section 6) | — |

### Future work (would need a contract change, so not done)

- Check the DAO's code hash and key count in the contract, not only in the web app.
- Let stewards invite.
- Stop a lender from blocking repayment by unregistering from USDC.
- Check emblem image dimensions on-chain.
- Lock the contract (delete the full-access key). This needs no code change but
  cannot be undone, so it is the builder's decision.

## 5. The judging panel

Eight mock judges, each strict, each with about three minutes. Scores are 1 to
10 on the builder's weights: **Execution 30, Launch potential 25, Originality 20,
Craft & UX 15, Vibecoding leverage 10**. These are the reviewing agent's own
estimates **after** today's fixes. Nobody can know the real jury's view, and the
hackathon publishes no rubric.

| Judge | Exec | Launch | Orig | Craft | Vibe | Total /100 | Track fit |
|---|---|---|---|---|---|---|---|
| AI screener | 8 | 5 | 7 | 7 | 8 | 69 | — |
| NEAR protocol engineer | 8 | 5 | 7 | 6 | 7 | 66.5 | — |
| Fintech product judge | 6 | 4 | 7 | 6 | 6 | 57 | — |
| Design / UX judge | 7 | 5 | 6 | 6 | 6 | 60.5 | — |
| Track: NFTs That Do Something | 7 | 5 | 7 | 6 | 7 | 63.5 | 8 |
| Track: Social Money | 7 | 5 | 6 | 6 | 7 | 61.5 | 8 |
| Track: Open Innovation | 7 | 5 | 6 | 6 | 7 | 61.5 | 6 |
| Skeptic | 6 | 4 | 6 | 6 | 6 | 55 | — |
| **Average** | | | | | | **61.8** | |

**1. AI screener.**
Best: one keyless command passes; every claim has a transaction, view or test; README reads as "do X, see Y".
Worst: plain `npm ci` broke on Windows until today; the repo carries the old LoanBook app (`src/`, Foundry, Supabase) beside the new one; no LICENSE file.
Hard question: "Which files are the hackathon work, and can I build only those?"

**2. NEAR protocol engineer.**
Best: `ft_transfer_call` with a refund on every failure path, proven on testnet including the low-gas case; reproducible wasm whose hash matches the chain; storage paid by the caller.
Worst: the full-access key is still on the contract; the DAO check lives in the web app; a lender can block repayment by unregistering.
Hard question: "Why should I trust the treasury if the contract will accept any account as the DAO?"

**3. Fintech product judge.**
Best: a real gap (need-based borrowing inside a savings culture); zero interest and zero custody remove the two usual objections; limits are stated plainly.
Worst: no outside user has touched it; nothing but a flag happens on default; a new member needs NEAR, an invite and a USDC setup before borrowing.
Hard question: "Who lends a second time after the first default, and why?"

**4. Design / UX judge.**
Best: a "check before you sign" box on every money action; honest empty and stale states; works at phone width with a tab bar.
Worst: fourteen menu items is a dashboard, not a family app; account names like `…light-borrower3` are not human; the passport card is the only warm visual.
Hard question: "Could your aunt use this without you in the room?"

**5a. NFTs That Do Something.**
Best: the NFT changes because of behaviour, not a button; it gates real limits and treasury access; it cannot be transferred, tested.
Worst: demo circles turn Trusted after one loan from one lender; reputation does not leave the circle; the admin can revoke.
Hard question: "What stops two of my own accounts from making each other Trusted?" (Nothing does; the README says so.)

**5b. Social Money.**
Best: an unmodified, keyless Sputnik DAO as treasury; stewards cannot borrow, proven by a refused transaction; a late mark forgiven by vote.
Worst: both stewards are one operator in the demo; the chat is off-chain on a free server that sleeps; the niche is crowded with Sputnik savings circles.
Hard question: "What does your community do with the DAO that Njangi's does not?"

**5c. Open Innovation.**
Best: "the contract holds zero" is a simple, checkable idea; a failed funding refunds in the same transaction; evidence is re-read from the chain in CI.
Worst: the idea is a careful use of a known pattern, not a new primitive; no agents, intents or chain abstraction, which this track's field is full of; testnet only.
Hard question: "What here could not have been built two years ago?"

**6. Skeptic.**
Best: the limits section is long and specific; "36 of 36" is now true again and CI proves it; nothing claims mainnet, users or encryption.
Worst: every wallet in the evidence is the builder's; the Evidence page showed a stale "36 of 36" for a day; "family and friends" is a framing, since nobody's relationship is checked.
Hard question: "Show me one transaction signed by someone who is not you."

### Where this would place, honestly

- **NFTs That Do Something (118 entries, 3 prizes).** The strongest fit. A
  reasonable guess is the top fifth; a prize needs the video to land the tier
  flip and a judge to value behaviour-driven NFTs over mainnet entries like
  Contri. Possible, not likely.
- **Social Money (121 entries, 3 prizes).** A good fit in a crowded niche.
  Probably the top quarter. A prize is unlikely unless judges read "loans on
  need" as clearly different from the many savings pots.
- **Open Innovation (276 entries, 3 prizes).** The weakest fit and the largest
  field, most of it not assessed here. Treat it as a long shot.

The scan covered a minority of each track, so these ranges are soft.

## 6. Pitch pack

### Taglines

1. **Ajo pays you in turn. CommonCircle is for when it isn't your turn.**
2. Borrow from the people who already trust you. Repay, and your passport remembers.
3. No interest. No pot. Just your circle, and a passport that remembers you paid back.
4. When it isn't your turn in the ajo, ask your circle.
5. Loans between people who trust each other, with a record that repayment writes.

**Best: number 1, kept.** It names a specific gap in a practice millions of
people already use, in fourteen words, and promises nothing technical that could
be false. Its one weakness is that a judge who does not know "ajo" loses the
meaning, so the app's opening paragraph now explains it ("In an ajo, a rotating
savings group, you get the pot when your turn comes…"). Number 2 is the best
plain-language backup for places with no room for an explanation.

### Two sentences

CommonCircle lets people who already trust each other lend USDC to one another
on NEAR with no interest and no shared pot: the money goes from lender to
borrower in one transaction and the contract holds nothing. Paying back on time
is written into a passport NFT that cannot be sold or sent, and that passport
sets how much you can borrow next and whether the circle's treasury will lend to you.

### Thirty seconds

In a savings circle like ajo you get the pot when it is your turn. Life does not
wait for your turn. CommonCircle is a private circle on NEAR where a member asks,
another member offers, and USDC goes straight from one to the other: no interest,
and no pot sitting in a contract. If anything fails, the lender gets the money
back in the same transaction. Pay back on time and your passport, an NFT nobody
can buy or move, turns Trusted: a higher limit, the right to invite, and access
to the circle's treasury, a Sputnik DAO where both stewards must approve. It is
on testnet today, the loans are unsecured, and every claim links to a
transaction you can check.

### Why each track

**NFTs That Do Something.** The passport is a NEP-171 token that refuses
transfer and changes only when its holder repays. The transaction
[`2d42VciE…J1Q`](https://testnet.nearblocks.io/txns/2d42VciE6yCvsXmZ4SPBkrGqnezaseEgv8eYHn8HJv1Q)
is a repayment that emits `tier_changed` Member → Trusted, and
[`FVVgaWmN…7vw`](https://testnet.nearblocks.io/txns/FVVgaWmNE8fYwLbUNJSDTr55bWDbTVgcN93fPH5pU7vw)
is the same thing done from the web app. The tier then does something: it sets
the loan cap, the number of open loans, who may invite and who may borrow from
the treasury (test `create_a_loan_naming_a_non_member`, rows `f1-*`). Transfer
is refused (test `try_nft_transfer_on_a_passport`). See it on the **My passport** page.

**Social Money.** The track asks for what communities do with a treasury, not
another multisig. Here a keyless, unmodified Sputnik DAO lends only to members
who earned Trusted, never to its own stewards: a steward's request is refused
in [`J7XZHt17…uMd`](https://testnet.nearblocks.io/txns/J7XZHt17De96uBniiMWwHdzoA8tSc2X7cDJ8PxdRmuMd),
the vote that paid a member's loan is
[`3dYZEiVp…je1r`](https://testnet.nearblocks.io/txns/3dYZEiVpvXFGRPjte9TvCFsKPhPstqJTS4th8Cv8je1r),
and the stewards forgave a late mark by vote in
[`43mAx3pT…VtTk`](https://testnet.nearblocks.io/txns/43mAx3pTTjTDFDVfpZrGBVwfDSJZHZ12xoUDuA3HVtTk).
Between members, a request posted in the chat was offered and funded from a
second browser (rows `f0-web-peer-*`). See it on the **Treasury** and **Circle chat** pages.

**Open Innovation.** The experiment is a lending product whose contract never
holds the money. `ft_balance_of` for the contract returns 0, read live in the
app. A funding that could not be delivered refunded the lender in the same
transaction ([`9eRRis9r…B9K`](https://testnet.nearblocks.io/txns/9eRRis9rGq1QFjYWdAr7E627HXvtHvEjmnQEwjJQ9B2K)),
and so did one sent with too little gas, with real testnet USDC
([`DiMweYz7…MuNj`](https://testnet.nearblocks.io/txns/DiMweYz7TbTGGVdraXFcjZm3y7352J2LBFPop3hsMuNj)).
The evidence itself is part of the experiment: 36 claims that CI re-reads from
the chain on every push, so a claim that stops being true turns the build red.
That happened on 13 Nov and is described in section 1.

### Judge FAQ: the eight hardest questions

1. **Is this on mainnet? Has real money moved?**
   No. Testnet only, test USDC only. The builder's budget did not cover a mainnet deployment.
2. **Did anyone other than you use it?**
   The repository holds no evidence of that. Every wallet in the evidence is run by the builder, including both sides of the two-wallet test.
3. **What happens if a borrower does not repay?**
   The lender loses that loan. The borrower's passport is flagged, Trusted perks pause, and the open-loan limit blocks new borrowing. Nothing is seized and nobody is chased. It only fits people who already trust each other.
4. **Can I farm Trusted with two of my own accounts?**
   Yes. Two accounts are not two people. The defaults (3 qualifying loans from 2 different lenders) slow it down; the demo circle needs only 1 loan from 1 lender. Reputation stays inside one circle, which limits what farming buys.
5. **Can you change the contract under users?**
   Yes, today. The contract account still holds a full-access key. The code hash on chain matches the reproducible build that CI tested, but the builder could deploy a different one.
6. **Why trust the DAO treasury?**
   The contract does not check that the attached account is a DAO. The web app does (pinned Sputnik code hash, zero access keys, a policy that needs the stewards) and hides the treasury if the check fails. In the demo both stewards are one operator.
7. **Is the chat private?**
   It is members-only: the server checks membership on-chain for every call. It is not end-to-end encrypted, and the server operator can read messages. It runs on a free plan that sleeps when idle.
8. **Why NEAR, and why does this need a blockchain at all?**
   Three things here lean on NEAR: `ft_transfer_call`, which lets the contract check a loan and pass the money on in one transaction with a built-in refund; named accounts and cheap storage, which make a per-member passport practical; and Sputnik DAO as a ready, keyless treasury. A spreadsheet can record who paid; it cannot stop the organiser from holding the money.

### Text for the submission form's "idea" field (under 2000 characters)

> CommonCircle offers zero-interest, unsecured USDC loans between people who
> already trust each other, on NEAR testnet. In a rotating savings group (ajo,
> esusu) you get money when it is your turn, not when you need it; CommonCircle
> is for when it isn't your turn. A member asks in a members-only circle chat or
> asks one member directly, a lender funds with ft_transfer_call, and the USDC
> goes from lender to borrower in one transaction. The contract never holds a
> pot: its USDC balance is 0 at rest, and every failure path refunds the lender
> (proven on testnet). Each member holds a non-transferable NEP-171 passport.
> On-time repayments move it from Member to Trusted, which raises the loan
> limit, allows invites and opens the circle's Sputnik DAO treasury, where both
> stewards must approve and stewards cannot borrow. NEAR is used for
> ft_transfer_call with refunds, NEP-171, NEP-413 sign-in and Sputnik DAO.
> 36 evidence claims are re-read from testnet in CI. Limits, stated plainly:
> testnet only; loans are unsecured; the contract is not locked; the DAO is
> checked by the web app, not the contract; reputation is per circle and can be
> farmed; chat is not end-to-end encrypted; all demo wallets are the builder's.

## 7. Top 10 remaining improvements (most points per hour first)

| # | What | Time | Why it earns points | Who |
|---|---|---|---|---|
| 1 | Add a LICENSE file | 5 min | The guide says "add a LICENSE file"; an AI screener checks for it | Builder decides the licence; the agent can add it |
| 2 | Make the thesis repo public | 2 min | The README links it for rule Q-015; today the link is a 404 for judges | Builder |
| 3 | Record and post the V3 video | 1–2 h | The X post with a video is required, and it is most of what a human judge will see | Builder |
| 4 | Submit on nearhackathon.com | 15 min | Without it nothing is judged. One attempt only | Builder |
| 5 | One person who is not the builder joins and borrows 1 USDC | 1 h | Answers the skeptic's question with a transaction | Builder + a friend |
| 6 | Keep the chat server awake through 25 Nov (a free uptime pinger on `/health`) | 10 min | A judge who opens the chat should not wait a minute | Builder (own account) |
| 7 | Delete the contract's full-access key | 10 min, **cannot be undone** | Turns "not locked" into "locked", the engineer's first objection. But no bug in the contract could ever be fixed | Builder decides |
| 8 | Move the old LoanBook app (`src/`, Foundry, Supabase, EVM packages) out of the default branch | 2 h | A cleaner repo for reviewers, and plain `npm ci` would work. Risky on deadline day | After judging |
| 9 | Friendly names for members (stored on the chat server) | 2 h | `…light-borrower3` is the weakest part of the "family" story | Later |
| 10 | Gas sponsorship so a new member needs no NEAR | 1–2 days | The biggest onboarding obstacle; needs the relayer finished | Later |

## 8. What you must do by hand

In this order. Each one needs your accounts, so the agent did not do it.

1. **Decide on a licence** and say which (your thesis repo uses MIT). The agent adds the file.
2. **Make `Near-thesis-` public** (GitHub → the repo → Settings → Danger Zone → Change visibility), or tell the agent to do it. It must be public by 23:59 UTC.
3. **Run the wallet steps** in section 3 with two browsers. It is the same run as the video.
4. **Record the video** with `docs/VIDEO_SCRIPT_V3.md`, and have it edited and voiced.
5. **Post on X** from your account: say it was built at NEAR HACKATHON, tag `@NEARProtocol`, include `#NEARHackathon`, attach the video, link the app and the repo. Copy the post's URL.
6. **Submit at https://nearhackathon.com/#apply**. You get **one** attempt per repo; a saved submission cannot be edited. Have ready: project name, your name, email, team size, tracks (`nfts`, `social`, `open`), your **mainnet** NEAR account for the payout, the repo URL, the X post URL, and the description (section 6 has a draft). Read the consent line yourself before ticking it. Do the same for the thesis entry (track `thesis`).
7. **Render:** nothing to change. If you want the chat to answer at once for judges, add a free uptime pinger on `/health` and keep the service until at least 25 Nov.
8. **Do not** paste a seed phrase, private key or `.env` value anywhere, including into a chat with an AI. If one ever appears on screen while recording, delete the recording and rotate that key.
