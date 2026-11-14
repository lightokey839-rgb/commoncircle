# CommonCircle demo video, version 3 (2:30 to 3:00)

A silent screen recording with two browsers. Another AI adds the voice-over (VO)
afterwards from the lines in the table. Everything shown is the live app on NEAR
**testnet**: no mock screens, no real money.

Site: https://lightokey839-rgb.github.io/commoncircle/

The story in one line: *someone needs money before their turn comes, their circle
lends it, and paying it back on time changes their passport.* Live proof is on
screen by 0:15.

## Who is who

| | Browser A: the lender | Browser B: the new member |
|---|---|---|
| Browser | Your normal Chrome | Edge, or a second Chrome profile (not the same profile as A) |
| Wallet | Meteor, `254edye5v.testnet`. It is **Trusted** in "The Dogs (DEMO)" | A **new** Meteor testnet wallet |
| Needs | At least 1 test USDC to lend, and a little NEAR | About 0.5 testnet NEAR. It needs no USDC: the loan gives it 1 USDC and it pays 1 USDC back |
| Role in the video | Invites, offers, funds | Joins, asks, repays, turns Trusted |

Record in the circle **The Dogs (DEMO)**. It already has a Sputnik DAO treasury
and past proposals, which a new circle would not have.

## Setup checklist (before you press record)

1. Wake the chat server: open https://commoncircle-chat.onrender.com/health and
   wait until it shows `"ok":true`. It sleeps when idle, and the first answer can
   take about a minute.
2. In both browsers open the site and press **Ctrl+Shift+R** (hard refresh).
3. Browser A: connect Meteor. The top bar must show `254edye5v` with its USDC and
   NEAR balance. If USDC is below 1, stop and top it up first.
4. Browser B: have the new wallet created and funded with about 0.5 testnet NEAR,
   but **do not connect it to the site yet**. The video shows that moment.
5. Both browsers: zoom 100 %, bookmarks bar hidden, other tabs closed, light
   theme (the moon button switches it; you switch to dark on camera in row 13).
6. Browser B: allow pop-ups for the site (the wallet opens in a pop-up).
7. Never show a seed phrase or private key. If Meteor shows one, stop recording.
8. Optional, for a clean chat: the chat room may hold old test messages. They are
   real, so leaving them is fine. To wipe them, see `CHAT_RESET` in
   `server/auth.ts` (it needs your Render dashboard).

## Timing you must respect

- In this demo circle a "day" is **60 seconds**. A 7-day loan is due **7 minutes
  after it is funded**. Standard circles use real days.
- A request can be funded for **1 hour** after it is created.
- So: once A presses **Send 1 USDC** (row 8), B must finish repaying (row 10)
  within 7 minutes. Do rows 8 to 10 without a break. The repay box now shows how
  much time is left; if it says under 1:00, expect it to land late.
- If the repayment lands late, the passport records "late" and does **not** turn
  Trusted. That is real behaviour. Make a new 1 USDC request and repeat rows 6 to 10.

## The recording, row by row

Times are for the **finished** video after speeding up the waits. The raw
recording will be 8 to 10 minutes.

| # | Time | Browser | What is on screen | Exact clicks | VO line |
|---|---|---|---|---|---|
| 1 | 0:00–0:10 | B (no wallet) | The site's first screen: "Welcome to CommonCircle" and the tagline | Open the site. Do not click. Hold still for 3 seconds | "In an ajo, everyone gets the pot, but only when it's their turn. Life doesn't wait for your turn." |
| 2 | 0:10–0:22 | B | The strip "See it working in one minute, no wallet needed": **0 USDC** held by the loan contract, **36 of 36** evidence claims | Move the mouse slowly over "0 USDC", then over "36 of 36" | "CommonCircle lets people who already trust each other lend USDC to one another on NEAR. No interest. No shared pot: the loan contract is holding zero right now, read live from the chain." |
| 3 | 0:22–0:32 | B | Menu → **Members**: the "Members only" screen | Click **Members** in the left menu. Then click **Overview** | "Circles are private. Without an invite you see nothing about a family's circle." |
| 4 | 0:32–0:48 | A, then B | A: **Invitations** page, the new link and its QR code. B: the invite box says "Valid invite from 254edye5v" | A: **Invitations** → leave the account box empty → **Create invite link** → approve in Meteor → **Copy link**. B: paste the link in the address bar, press Enter | "A Trusted member makes a one-time link. The app checks the invite on-chain before you sign anything." |
| 5 | 0:48–1:05 | B | Meteor pop-up, then "Welcome to the circle!", then steps 3 and 4 turning green | B: **Connect Meteor** → approve → **Join The Dogs (DEMO)** → approve. Then step 3 **Sign in** → sign. Then step 4 **Set up USDC** → approve | "Joining mints a passport NFT for this circle. It can't be sold or sent. Sign-in is a free signature: no fee, no password." |
| 6 | 1:05–1:22 | A and B side by side | **Circle chat** in both. B's request card appears in A's chat within a few seconds | B: **Circle chat** → **Ask for a loan** → amount `1`, days `7`, reason `School books` → **Post request**. A: **Circle chat** → on the card click **Offer to lend** | "She asks her circle, and says why. Asking is free and moves no money. Anyone in the circle can offer." *(caption: Social Money)* |
| 7 | 1:22–1:35 | B | The card now shows "Loan #… names 254edye5v as lender" and a countdown | B: on the card click **Borrow from 254edye5v** → approve in Meteor | "She picks who to borrow from. Only now is the loan written on-chain, naming that lender." |
| 8 | 1:35–1:52 | A | The box "Check before you sign: Fund loan #…", then the green result with **View the transaction** | A: on the card click **Fund 1 USDC** → read the box for 2 seconds → **Send 1 USDC** → approve in Meteor → click **View the transaction** (a new tab; show it for 2 seconds, then come back) | "The lender sees exactly what he is signing. The money goes from him, through the contract's checks, straight to her, in one transaction." |
| 9 | 1:52–2:02 | A | **NEAR network** page: the three-step flow and "Loan contract USDC: 0 USDC" | A: left menu → **NEAR network**. Point at the flow, then at "0 USDC" | "And the contract is still holding zero. If any check had failed, the money would have gone straight back to him." *(caption: Open Innovation)* |
| 10 | 2:02–2:20 | B | The repay box with the time left, then "Repaid on time", then **My passport** showing **Trusted** | B: **My loans** → **Repay 1 USDC** → **Pay 1 USDC** → approve in Meteor → **Done**. Then left menu → **My passport** | "She pays it back on time, and her passport changes: Member becomes Trusted. Nobody granted that. The repayment did." *(caption: NFTs That Do Something)* |
| 11 | 2:20–2:32 | B | **My passport**: the card picture, "What this passport unlocks" | Scroll slowly down the passport page | "Trusted means a higher limit, two open loans, the right to invite, and access to the circle's treasury." |
| 12 | 2:32–2:44 | A | **Treasury**: "DAO verified by CommonCircle frontend trust checks", proposals marked Approved "2 of 2 approvals" | A: left menu → **Treasury**. Scroll to "Proposals and votes" | "The treasury is a Sputnik DAO with no keys. Both stewards must approve, and stewards cannot borrow from it." |
| 13 | 2:44–2:54 | A | **Evidence & tracks**: three tracks, each PASS; one claim opened; then dark mode | A: left menu → **Evidence & tracks** → click the claim `f0-refund` to open it → click the moon button (top right) | "Every claim links to a testnet transaction or a test, including a failed loan that refunded the lender." |
| 14 | 2:54–3:00 | A | **Overview**, scrolled to "Good to know before you lend or borrow" | A: left menu → **Overview** → scroll to the bottom card | "Testnet today. Loans are unsecured, and we say so. CommonCircle: for when it isn't your turn." |

## One clear moment per track

| Track | The moment | Row |
|---|---|---|
| Social Money | A request card appears in the other person's chat, an offer is made, a lender is chosen | 6 and 7 |
| Open Innovation | Funded in one transaction, and the contract still shows 0 USDC | 8 and 9 |
| NFTs That Do Something | The passport changes from Member to Trusted right after the repayment | 10 |

## Notes for the editor (the AI that cuts and voices it)

- **Speed-ups.** Play wallet pop-ups and "Updating from testnet…" waits at 3× to
  4×. Never speed up a result line (the green box, the Trusted badge): hold each
  for at least 1.5 seconds at normal speed.
- **Blur the invite secret.** In row 4 the invite link is in A's text box and in
  B's address bar. Everything after `#invite_secret=` is a one-time secret. Blur
  the address bar and the link box whenever that part is readable. (The link is
  used up in row 5, but blur it anyway.)
- **Captions.** Show the track name as a small caption in rows 6, 9 and 10, as
  marked. Add one fixed caption for the whole video: "NEAR testnet · no real money".
- **Do not add claims.** Use only the VO lines above. Never say "guaranteed",
  "secure", "bank-grade", "verified identity", "encrypted" or "private chat".
  The chat is members-only, not encrypted; if the VO mentions the chat, it says
  "members-only".
- **Account names.** `254edye5v` is the lender's testnet account. Do not invent
  names or relationships for the two people. "She" and "he" in the VO are only
  a way to tell the two browsers apart; change them to "the borrower" and "the
  lender" if you prefer.
- **Both wallets belong to the builder.** Do not say or imply that two different
  people recorded this.
- **Length.** If the cut runs over 3:00, drop row 11 first, then row 3.

## If something goes wrong (common retakes)

| What you see | Why | What to do |
|---|---|---|
| Chat says the server is "not answering" | The free server was asleep | Wait about a minute, press **Try again**. Cut the wait out |
| B's Join fails with "This wallet has … NEAR. Joining needs about …" | The new wallet has too little NEAR | Send it more testnet NEAR, press Join again |
| "This invite was already used or does not exist" | The link was used, or copied incompletely | A: **Make another link**, copy the whole link |
| "…is already a member of this circle" | You pasted the link into browser A | Paste it into browser B |
| Fund refused: "not set up to receive USDC yet, so nothing was sent" | B skipped **Set up USDC** in row 5 | B does step 4, then A presses Fund again. No money moved |
| The request shows "Expired" | More than 1 hour passed between rows 7 and 8 | B asks again (row 6) |
| "Repaid, but late" and the passport stays Member | The repayment landed after the 7 minutes | Real behaviour. New 1 USDC request, repeat rows 6 to 10 without pauses |
| The wallet pop-up never appears | The browser blocked it | Allow pop-ups for the site, press the button again |
| A yellow bar says the data is stale | Testnet RPC did not answer | Wait; it retries by itself. Money buttons stay off until a fresh read works |
| The "View the transaction" tab shows a "verifying you are human" page | The explorer's bot check | Wait a few seconds. Cut it out |

## After recording

1. Watch the raw file once. Check that no seed phrase, private key or other
   account's secret is visible anywhere.
2. Hand the editor this file and the raw recording.
3. The finished video goes into your public X post for the hackathon. The post
   must say it was built at NEAR HACKATHON, tag `@NEARProtocol` and include
   `#NEARHackathon` (see `docs/SCREENER_REPORT.md`, "What you must do by hand").
