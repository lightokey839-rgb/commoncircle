# CommonCircle demo recording script (two browsers)

Silent screen recording; the voice-over is added later. Each scene has **what to
click** and a **voice-over line** to hand to the editing AI. Total about 4–5 minutes.

Site: https://lightokey839-rgb.github.io/commoncircle/ (hard refresh first: Ctrl+Shift+R)

## Before you press record

| | Browser A (the lender) | Browser B (the new friend) |
|---|---|---|
| Browser | Your normal Chrome | Edge, or a Chrome profile/incognito window |
| Wallet | Meteor, `254edye5v.testnet` (Trusted in The Dogs) | A **new** testnet wallet (Meteor or MyNearWallet) |
| Needs | Some test USDC (to lend 1 USDC) and a little NEAR | About 0.1 testnet NEAR (from a testnet faucet) for storage fees |

- Pick **The Dogs (DEMO)** in "Your circles" in browser A.
- Demo circle timing: a "day" is 60 seconds. A 7-day loan is due **7 minutes** after it is funded, and a request can be funded for 1 hour. Do scenes 8–10 without long pauses.
- Close other tabs, set zoom to 100 %, hide bookmarks. Never show a seed phrase or private key on screen.

## Scenes

1. **Opening (A, Overview).** Scroll slowly: hero, financial overview, zero-custody card, trust summary.
   *Voice-over:* "Ajo pays you in turn. CommonCircle is for when it isn't your turn: zero-interest USDC loans between people who already trust each other, on NEAR."
2. **New person arrives (B).** Open the site in browser B and connect the new wallet. Point at the yellow note: "not a member here… public history".
   *VO:* "A new wallet sees the circle's public, on-chain history, clearly marked as not theirs. To take part you need an invite."
3. **Make an invite (A).** Invitations → leave the account empty (or type B's account) → Create invite link → approve in the wallet → Copy link.
   *VO:* "Only the founder or Trusted members can invite. The link holds a one-time secret that never leaves the browser."
4. **Join (B).** Paste the link into browser B's address bar (or Invitations → "Got an invite link?") → Overview → Join the circle → approve.
   *VO:* "Joining mints a passport NFT for this circle. It can't be sold or sent."
5. **Get ready (B).** Steps: Sign in (free signature, no fee) → Set up USDC (0.00125 NEAR).
   *VO:* "Sign-in is a NEP-413 signature, free. Setting up USDC lets lenders send money to you."
6. **Chat (A and B side by side).** Both open Circle chat. B: "Hi everyone!". A answers.
   *VO:* "Each circle has a members-only chat. Membership is checked on the blockchain. It is private to members, not end-to-end encrypted."
7. **Ask your circle (B).** In the chat press + / Ask for a loan → 1 USDC, 7 days, reason "School books" → Post request.
   *VO:* "Asking is free and moves no money. Everyone in the circle sees the request."
8. **Offer (A).** On the card press **Offer to lend**.
   *VO:* "Any member can offer to lend."
9. **Choose who to borrow from (B).** Press **Borrow from 254edye5v** → approve in the wallet. The card shows "Loan #… waiting for funding".
   *VO:* "Now the loan is created on-chain, naming the chosen lender. Only they can fund it."
10. **Fund (A).** On the card (or Overview → Requests for you) press **Fund 1 USDC** → read the "Check before you sign" box → confirm → approve → click "View the transaction".
    *VO:* "The lender's USDC goes through the contract's checks straight to the borrower in one transaction. The contract keeps no pooled pot; its balance stays at zero."
11. **Repay on time (B), within 7 minutes.** My loans (or the card) → Repay 1 USDC → confirm → approve. Then open My passport.
    *VO:* "Repaying on time is written into the passport. In this demo circle one on-time repayment turns Member into Trusted: a higher limit, two open loans, invites and treasury access."
12. **Proof (A).** Show Activity, Treasury (point at "DAO verified by CommonCircle frontend trust checks"), NEAR network (contract balance 0 USDC), Evidence & tracks (36 of 36 claims; open one claim).
    *VO:* "Every claim links to a testnet transaction or test. The treasury is a Sputnik DAO; both stewards must approve."
13. **Phone and dark mode.** Narrow the window (or show a phone): bottom tabs Home / Chat / Loans / Passport / More. Press the moon button for dark mode.
    *VO:* "It works on a phone, and in dark mode."
14. **Close (A, Overview).**
    *VO:* "Testnet only. Loans are unsecured and repayment can't be forced. CommonCircle: for when it isn't your turn."

## If something goes wrong while recording

- Chat says "not answering": the free server was asleep; wait about a minute, press Try again (cut this out later).
- Funding refused "not set up to receive USDC": B skipped scene 5.
- Loan "Expired": more than 1 hour passed before funding; ask again.
- Repaid after 7 minutes: it counts as late (that is real behaviour; redo with a new loan if you want the Trusted moment).
