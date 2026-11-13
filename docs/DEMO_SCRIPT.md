# CommonCircle demo video (about 2 minutes, under 2:20)

Record at 1920x1080 in Chrome, app at `http://localhost:5173/?circle_id=3`, both servers
running (`npm run preview`, `npm run auth`). Wallet A = a Trusted member, wallet B = a
member with test USDC, each in its own Chrome profile. Say "testnet" once, early.

| Time | Screen | Say (plain words) |
| --- | --- | --- |
| 0:00 | Overview, not connected | "Ajo pays you in turn. CommonCircle is for when it isn't your turn. People who already trust each other lend USDC straight to one another on NEAR testnet." |
| 0:12 | Point at the zero-custody box (0 USDC) | "The lending contract never holds a pot. Money goes from lender to borrower in one transaction. This is its live balance: zero." |
| 0:22 | Chat (wallet A), press +, 1 USDC, 7 days, reason | "I ask my circle and say why. Every member sees this card. Posting is free." |
| 0:35 | Switch to wallet B: Offer to lend | "Anyone in the circle can offer." |
| 0:42 | Wallet A: Borrow from B, approve in Meteor | "I pick who lends. My wallet signs the loan, naming them." |
| 0:52 | Wallet B: Fund 1 USDC, the summary box, approve | "The lender checks the summary and sends. It goes straight to me." |
| 1:05 | Wallet A: Repay before the countdown ends | "Demo days are 60 seconds, so I have 7 minutes. I repay on time." |
| 1:15 | My Passport | "This passport NFT can't be sold or sent. My on-time repayment is written into it. Trusted raises my limit and opens the treasury." |
| 1:35 | Treasury | "The circle's treasury is a Sputnik DAO. Only Trusted members who are not stewards can ask, and both stewards must approve." |
| 1:50 | Evidence & Tracks | "Every claim here is a testnet transaction you can open: NFTs That Do Something, Social Money, Open Innovation." |
| 2:05 | Overview | "CommonCircle: borrow when you need it, build trust when you repay." |

Screenshots to take: Overview (zero custody), a request card with an offer in Chat,
My Passport (Trusted), Evidence & Tracks.

Draft X post (under 280 characters):

> CommonCircle, built at NEAR HACKATHON: friends lend USDC straight to each other, no pot in
> the contract. Repay on time and your non-transferable passport NFT turns Trusted, unlocking
> a DAO treasury. Testnet demo ↓ @NEARProtocol #NEARHackathon

Honesty notes for the voice-over: say "testnet"; don't say the two wallets are two
different people if one person controls both; don't call the contract immutable.
