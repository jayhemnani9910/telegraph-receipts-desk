# Commercial summary

Receipts Desk has two apps. Everything below is from the Ethereum Sepolia testnet using free test USDC. There are no customers or outside users yet, and we have not spoken to a buyer, so who would buy this and how often are our estimates.

## 1. Who is it for?

- **Diligence pack (Mission 04, Legal):** paralegals and compliance staff at small and mid-sized law firms, who need a record of what was checked before taking on a client. Our estimate: this comes up for each new client or matter.
- **Flight refund claim (Mission 15, Consumer Automation):** US air travellers whose flight is cancelled or moved by 3+ hours (6+ international) and who did not fly. It comes up a few times in a frequent traveller's life, so this one is more likely a feature inside a travel or card app than something people pay for on its own (our estimate).

## 2. What does it improve?

| | Today | Receipts Desk (testnet) |
|---|---|---|
| **Diligence** | The official lists and registries are free, but searched one site at a time, with the record kept by hand. Vendor research puts an average bank KYC review at [about $2,600](https://www.corporatecomplianceinsights.com/kyc-review-cost-survey-2023/). That covers far more than we do and is not law-firm data; we found no published law-firm figure. | $0.03 per company for up to 3 checks, or $0.01 per person. Each answer is compared with OFAC, UN, EU, UK, GLEIF or SEC EDGAR, with a timestamp and a receipt. |
| **Flight refund** | Writing to the airline yourself is free. Claim services charge for compensation claims, for example [AirHelp's 35%](https://www.airhelp.com/en/our-fees/), though that is mostly a different kind of claim from a US refund. | About $0.02 per claim. It checks the rule free, then drafts the email for you to send. You keep the whole refund. |

We have not measured time saved against someone doing this by hand. Answer quality is worse than the official sources, which is why every answer gets checked against them.

## 3. What does it do today?

Both apps work end to end and buy through Telegraph V2's canonical ask, with on-chain payments and receipts.

- **Run of both apps on Nov 4, 2026:** 11 checks delivered. 8 were confirmed by the official source, 2 contradicted and 1 unconfirmed. Small sample, using test names.
- **All calls from Nov 1 to 4, 2026 (`data/ledger.jsonl`, includes other Intents we tested):** 79 calls, 57 delivered. 18 returned HTTP 500, 2 returned 503 and 2 stopped at 402.
- **Cost:** $0.01 for each delivered check. A failed call's payment stays in escrow as credit, and a 200 with a bad answer is still billed.
- **Time per delivered check:** median 17 seconds, 90th percentile 24 seconds. The first run of the day can take minutes while the sanctions lists download.
- **Proof:** `npm run reconcile -- --wallet=0x64B27BdfF2119ba557b9F19c5B1229FDCA312D09 --hours=24` lists the demo wallet's payments, and works for any wallet with no key needed. Each pack and claim links every payment on Etherscan.

## 4. Why would someone adopt it?

- **Diligence:** a firm gets a dated record of what was checked, against which source, and what it cost, and a wrong answer from the network is flagged rather than passed along. Per-check pricing also suits a firm that screens too rarely to justify a subscription.
- **Flight refund:** the traveller gets a ready-to-send claim that cites the rule. The refund right does not depend on our airport check, so the draft is the main value and the receipts are supporting evidence.

Before production:
- Fuzzy name matching and following ownership, because exact-name matching can miss spelling variants.
- More reliable miners. SEC filings rely on one miner today, and registry answers vary between runs.
- Mainnet pricing, which we have not seen.
- A lawyer's review of the pack and the claim wording.
- Real users. Everything above still needs testing with people who do this work.

## 5. How can someone try it, and who maintains it?

- **Try it with no wallet:** <https://receipts-desk.vercel.app> runs both apps on the testnet, paying from a demo wallet. These runs are our own wallet's spending, so they aren't independent adoption.
- **Run it yourself:** follow the [Quickstart](../README.md#quickstart) or the [15-minute tutorial](tutorial.md). Both use only free test tokens.
- **Maintainer:** Jay Hemnani ([jayhemnani9910](https://github.com/jayhemnani9910)). Issues are welcome on the [repository](https://github.com/jayhemnani9910/telegraph-receipts-desk/issues).
