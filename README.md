# Receipts Desk

Agents that buy answers through [Telegraph](https://anjoman.ai/docs), check each one against the official source, and keep a receipt for every call. Telegraph Hackathon Season II, Apps & Agents track, Missions 04 (Legal) and 15 (Consumer Automation).

- **Diligence pack:** sanctions, company registry and SEC filing checks, each compared with the official OFAC, UN, EU and UK lists, GLEIF or SEC EDGAR, with an invoice of receipts.
- **Flight refund claim:** checks a trip against the US DOT refund rule, buys airport disruption checks, compares them with the FAA feed, and drafts the refund email. Nothing is sent automatically.

Network: **Ethereum Sepolia testnet** (chain 11155111, Telegraph V2). All payments use free test USDC; nothing here spends real money.

**Try it now, no wallet needed:** <https://receipts-desk.vercel.app>. It's the same two apps, paying from a demo wallet on the testnet; see [Hosted demo](#hosted-demo) for its limits.

**New to Telegraph?** Follow the [tutorial](docs/tutorial.md): your first paid answer, checked and on-chain, in about 15 minutes.

## Quickstart

Requires Node 20+.

```bash
git clone https://github.com/jayhemnani9910/telegraph-receipts-desk.git
cd telegraph-receipts-desk
npm install
cp .env.example .env
npm run wallet:new     # creates a test wallet in .env and prints its address
```

Fund it, both free:
1. Send the address a little Sepolia ETH from <https://sepolia-faucet.pk910.de> (gas for minting only; about a minute of mining).
2. Mint test USDC, then buy your first answer:

```bash
npm run mint                 # 10 test USDC (amount: npm run mint -- 20)
npm run first-check -- JFK   # $0.01
```

Expected result (the miner and answer can differ, because the network routes each call):

```
FAA says:       JFK not disrupted (feed updated Tue Nov 3 14:13:43 2026 GMT)
Telegraph said: {"route_or_flight":"JFK","disrupted":false,"status":null,"delay_minutes":null,"reason":null}
Served by:      FAA NAS Airport Disruption Status (result_shape: intent)
Verdict:        CONFIRMED by the FAA
Receipt:        0x844c0b8e579c...
Payment:        https://sepolia.etherscan.io/tx/0x9bd5dc269c07...
```

Then try the apps:

```bash
npm run diligence -- "Apple Inc." "person:Vladimir Putin"       # about $0.04
npm run flight-claim -- apps/flight-claim/example-trip.json     # about $0.02
npm run web                                                     # both in the browser at http://localhost:3402
```

Problems? See [Troubleshooting](docs/tutorial.md#troubleshooting).

## Known limitations

From our runs on the V2 testnet in November 2026:
- **Answer quality varies.** In a run of both apps on Nov 4, all 11 checks were delivered: 8 confirmed by the official source, 2 contradicted and 1 unconfirmed. The same registry miner returned the right Tesla on one run and a French company called TESLA on the next; the check caught it. A wrong answer is reported as `contradicted`, and one with no usable yes/no as `unconfirmed`, rather than guessing.
- **SEC filings rely on one miner.** Filing Window (77131) answered correctly for Apple and Tesla. Routing alone still reaches miners with empty or off-topic answers.
- **Named miners can change.** Both apps ask a few known-good miners first, then fall back to routing. A miner that has gone is refused for free.
- **Airport-level only.** The flight app checks airport disruption from the FAA, not your specific flight, and US airports only. You enter your flight's new times yourself. The refund right does not depend on the airport check.
- **Exact-name matching.** The sanctions and registry checks can miss spelling variants, a name match alone does not prove it is the same person or company, and ownership is not followed.
- **List dates differ.** Sanctions lists are downloaded once a day and each pack shows the date on each list. The EU file was dated Oct 23 when we fetched it on Nov 4. A list that cannot be read is reported as not checked.
- **Renumbered flights.** The US DOT is [not enforcing](https://www.federalregister.gov/documents/2026/07/07/2026-13675/airline-refunds-and-other-consumer-protections) the refund rule until July 7, 2027 when a flight only gets a new number and has no significant change or delay. Don't tick "cancelled" for that case; the app can't tell.
- **Not legal advice.** Packs and claims are drafts for a person to review.

## Commands

| Command | Cost | What it does |
|---|---|---|
| `npm run first-check -- JFK` | $0.01 | Buys one answer and checks it against the FAA; the [tutorial](docs/tutorial.md) walks through it |
| `npm run balance` | free | ETH, test USDC and escrow balance of the wallet |
| `npm run rankings` | free | Supply, operators and top-ranked miners for every Intent the probe covers |
| `npm run probe -- --dry` | free | Fetches the independent truth values only |
| `npm run probe` | ~$0.20 testnet USDC | Asks every known-answer question through Telegraph, grades it, saves receipts |
| `npm run probe -- --mission=legal` | ~$0.08 testnet USDC | Same, one mission only |
| `npm run probe -- --regrade=data/probe/<file>.json` | free | Grades a saved run again |
| `npm run reconcile -- --hours=1` | free | Matches every on-chain USDC transfer from the wallet to a ledger entry; flags transfers with no receipt and failed calls whose payment stays in escrow |
| `npm run reconcile -- --wallet=0x... --hours=24` | free | Lists any wallet's payments to Telegraph with time and tx link, plus its escrow balance; no key needed |

Outputs:
- `data/ledger.jsonl`: one line per paid call, keyed by `receipt_hash`; `tx_hash` falls back to the x402 settlement when Telegraph sends no receipt
- `data/probe/<time>.json`: full answers, receipts and Etherscan links

## Legal: diligence pack

```bash
npm run diligence -- "Apple Inc." "Tesla, Inc." "person:Vladimir Putin"
```

For each entity the agent buys, through Telegraph:
- sanctions screening (`SANCTIONS_SCREENING_MATCH_GENERAL`)
- for companies, an LEI registry lookup (`CORPORATE_REGISTRY_LOOKUP_GENERAL`) and, for SEC registrants, the latest annual report (`REGULATORY_FILING_MONITOR_GENERAL`)

Each call names the Intent and its typed params (V2 canonical ask), so it is checked before any payment and the answer comes back in the Intent's own shape.

Each answer is checked against the primary source (US OFAC SDN, UN Security Council, EU and UK sanctions lists, GLEIF, SEC EDGAR) and marked `confirmed`, `contradicted`, `unconfirmed` or `network failed`. Findings in the pack always come from the primary source, with its URL and timestamp.

Output in `data/packs/<time>/`:
- `pack.md`: findings per entity, the limits of each check, an invoice with every receipt and Etherscan link, and a list of network answers that were wrong, and failed calls that took a payment
- `pack.json`: the same, with the full network answers

Costs about $0.01 testnet USDC per check, up to 3 checks per company.

## Consumer Automation: flight refund claim

```bash
cp apps/flight-claim/example-trip.json data/my-trip.json   # data/ is gitignored; edit your flight details
npm run flight-claim -- data/my-trip.json
```

1. Checks the trip against the US DOT refund rule (14 CFR Part 260): cancelled, or moved 3+ hours (6+ international), and you did not fly. If not eligible it stops and buys nothing.
2. For the departure and arrival airports it buys a disruption report through Telegraph (`TRAVEL_DISRUPTION_GENERAL`, param `route_or_flight`) and checks it against the FAA National Airspace System status feed.
3. Writes to `data/claims/<time>/`:
   - `claim.eml`: the refund request to the airline, citing FAA-confirmed disruptions with their Telegraph receipts. Open it in your mail app, review, send.
   - `claim.md`: eligibility, every airport check, cost, receipt and Etherscan link
   - `claim.json`: everything, including the full network answers

Nothing is sent automatically. Only airport codes go to the network; your name and booking stay local. About $0.02 testnet USDC per claim.

### Watch a trip until it qualifies

```bash
npm run flight-watch -- data/my-trip.json --every=5   # minutes between checks
```

Every round is free: it re-reads the trip file and the FAA feed and prints one status line. When the airline changes your flight, update `revisedDeparture`, `revisedArrival` or `cancelled` in the file. The moment the change crosses the threshold it buys the evidence, drafts the claim as above, and stops. If `traveled` becomes true it stops without buying.

## Web page

```bash
npm run web   # then open http://localhost:3402
```

Both apps in the browser: the diligence pack, and the flight refund (eligibility check free, then buy and draft). Shows each finding, the network's answer, cost, receipt and Etherscan link, with downloads for the pack, `claim.eml` and the evidence. It pays from the wallet in `.env`, so it listens on 127.0.0.1 only, accepts JSON only and refuses other host names.

## Hosted demo

<https://receipts-desk.vercel.app> runs the same page (`web/hosted.ts`) on Vercel's free tier so someone can try it with no wallet. It pays from a [separate demo wallet](https://sepolia.etherscan.io/address/0x64B27BdfF2119ba557b9F19c5B1229FDCA312D09) holding only test USDC, which is the hard limit on what it can spend. It also allows 3 names per run and 5 paid runs per 10 minutes per visitor, and deletes each draft after the response.

To deploy your own:

```bash
npm run build:hosted   # writes only the build to dist/hosted
cd dist/hosted
vercel link --yes --project receipts-desk
vercel env add PRIVATE_KEY production --sensitive   # a separate test wallet, never your main one
printf '/tmp/receipts' | vercel env add DATA_DIR production
printf '150000' | vercel env add MAX_PER_RUN_UUSDC production
vercel deploy --prebuilt --prod
```

## Failed calls and escrow

On V2 an x402 payment settles on-chain before the miner is called, and lands in your escrow balance on the Diamond. Delivered calls are charged against it at the next epoch close, so what stays is the amount of the calls that failed. Those show on-chain with no receipt, and are not lost: spend them with the escrow payment scheme, or withdraw them with `requestWithdraw` and `executeWithdraw`. `npm run balance` and `npm run reconcile` show the balance; right after a run it also includes that run's delivered calls until the epoch closes.

A miner that answers 200 with a useless answer counts as delivered and is billed, which is why every answer here is checked against the official source.

## Spend controls

Set in `.env`, in micro-USDC (`10000` = $0.01):
- `MAX_PER_CALL_UUSDC`: the client refuses to sign any single payment above this.
- `MAX_PER_RUN_UUSDC`: the client stops paying once a run reaches this total.

## Who it's for

See the [commercial summary](docs/commercial-summary.md): buyers, costs, measured results and what remains before production.

## Evaluation material

We also contribute truth sources and question pairs to Telegraph's evaluation pool for the Intents these apps use. Telegraph asks contributors not to publish test questions, so that material and its generator are not in this repository.

## Help improve this

- Tried the quickstart or tutorial? [Open an issue](https://github.com/jayhemnani9910/telegraph-receipts-desk/issues) with what worked and what did not.
- Want to build on Telegraph? Its [bounty board](https://github.com/telegraphprotocol/bounties/issues) lists missing providers and evaluation work, and the SEC filings gap above is one place a better miner would help straight away.

## Mainnet

Chain ID, token address, node URL and explorer are configuration only (`.env`), not code.
