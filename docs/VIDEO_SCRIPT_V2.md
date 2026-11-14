# CommonCircle demo video, version 2 (about 3 minutes)

The screen recording is silent; the voice-over is added afterwards by an editing AI.
Each beat lists **what is on screen**, **what to do**, and the **voice-over (VO)**,
with a target length. Record on https://lightokey839-rgb.github.io/commoncircle/
(hard refresh first).

**Setup.**
- **Browser A** is your main wallet (`254edye5v.testnet`, a member of your circle; it has USDC and NEAR).
- **Browser B** is the new wallet. It needs about 0.5 testnet NEAR before you start.
- Use a fresh circle you created, so the history is clean. Or wipe the chat first with `CHAT_RESET` (see `docs/CHAT_SERVER.md`).
- Demo circle timing: a day is 60 s, so a 7-day loan is due 7 minutes after funding. Standard circles use real days.

| # | Time | On screen / do | VO |
|---|---|---|---|
| 1 | 0:00–0:12 | Title card: logo + "Ajo pays you in turn. CommonCircle is for when it isn't your turn." | "In an ajo, everyone gets the pot, but only when it's their turn. Life doesn't wait for your turn." |
| 2 | 0:12–0:25 | A: Overview, slow scroll (hero, financial overview, zero-custody card) | "CommonCircle lets people who already trust each other lend USDC directly: no interest, no pooled pot, on NEAR." |
| 3 | 0:25–0:38 | B: open the site, no wallet. The "members only" screen | "Circles are private. A stranger sees nothing about a family's circle. You get in only with an invite." |
| 4 | 0:38–0:55 | A: Invitations, Create invite link, approve, Copy. Paste the link in B; the invite box shows "Valid invite" and Join; approve | "A Trusted member makes a one-time link. The invite is checked on-chain, and joining mints a passport NFT that can't be sold or sent." |
| 5 | 0:55–1:08 | B: Sign in to chat (free signature), Set up USDC | "Sign-in is a free NEP-413 signature. Membership is checked on the blockchain for every message." |
| 6 | 1:08–1:25 | Split screen, both in Circle chat. B: "+ Ask for a loan", 1 USDC, 7 days, "school books", Post. A: Offer to lend | "Ask your circle, say why, and members offer to help. Posting costs nothing and moves no money." |
| 7 | 1:25–1:40 | B: Borrow from …, approve; the card shows the loan waiting. A: Fund 1 USDC; the "Check before you sign" dialog, confirm, approve, "View the transaction" | "The borrower picks a lender and creates the loan on-chain. The lender sees exactly what they're signing, then funds it." |
| 8 | 1:40–1:55 | A: NEAR network page: the flow diagram, contract USDC balance **0** | "The money goes from lender to borrower in one transaction. The contract checks it and keeps nothing: its balance is zero at rest, and any failed path refunds the lender." |
| 9 | 1:55–2:15 | B: My loans, Repay, approve; then My passport shows **Trusted** | "Repay on time and your passport remembers. Trusted means bigger limits, two open loans, the right to invite, and access to the treasury." |
| 10 | 2:15–2:30 | A: Treasury: "DAO verified by CommonCircle frontend trust checks", the proposals | "Each circle can have a Sputnik DAO treasury. Both stewards must approve, and stewards can't lend to themselves." |
| 11 | 2:30–2:45 | Evidence & tracks: 36 of 36 claims; open one and click its transaction | "Every claim links to a testnet transaction or an automated test, across all three tracks." |
| 12 | 2:45–2:55 | Phone view: bottom tabs; tap the moon for dark mode | "It works on the phone people actually use, in light or dark." |
| 13 | 2:55–3:05 | Overview, then the end card with the URL and repo | "Testnet today. Unsecured loans, honest limits. CommonCircle: for when it isn't your turn." |

**Editing notes for the AI editor.**
- Speed up wallet pop-ups and waiting to 2–4×.
- Blur the address bar if it shows a long invite secret. The link holds a one-time secret: show it only briefly, or use a link you won't reuse.
- Add captions for the track names when they come up: *NFTs That Do Something* (beat 9), *Social Money* (beats 6–7 and 10), *Open Innovation* (beat 8).
- Don't add claims the screen doesn't show. No "guaranteed", "secure banking", "verified identity" or "encrypted".

**Retakes.**
- If the chat says "not answering", the free server was asleep; wait a minute and cut it.
- If you repay after 7 minutes, it counts as late. Make a new loan if you want the Trusted moment.
