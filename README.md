# Receipts Desk

Agent workflows that buy ranked intelligence through [Telegraph](https://docs.telegraphprotocol.com) and keep a receipt for every input. Telegraph Hackathon Season II, Apps & Agents track.

Network: **Ethereum Sepolia testnet** (chain 11155111, Telegraph V2). All payments use free test USDC.

## Setup

Requires Node 20+.

```bash
npm install
cp .env.example .env
npm run wallet:new     # creates a burner wallet in .env and prints its address
```

Send the printed address a little Sepolia ETH from any public Sepolia faucet (gas for minting only), then mint free test USDC. x402 payments themselves are gasless for the payer.

```bash
npm run mint           # mints 10 test USDC to the wallet (amount: npm run mint -- 20)
```

```bash
npm run balance        # ETH + USDC of the wallet
```

## Commands

| Command | Cost | What it does |
|---|---|---|
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

Each answer is checked against the primary source (US Treasury OFAC SDN list, GLEIF, SEC EDGAR) and marked `confirmed`, `contradicted`, `unconfirmed` or `network failed`. Findings in the pack always come from the primary source, with its URL and timestamp.

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

## Failed calls and escrow

On V2 an x402 payment settles on-chain before the miner is called, and lands in your escrow balance on the Diamond. Delivered calls are charged against it at the next epoch close, so what stays is the amount of the calls that failed. Those show on-chain with no receipt, and are not lost: spend them with the escrow payment scheme, or withdraw them with `requestWithdraw` and `executeWithdraw`. `npm run balance` and `npm run reconcile` show the balance; right after a run it also includes that run's delivered calls until the epoch closes.

A miner that answers 200 with a useless answer counts as delivered and is billed, which is why every answer here is checked against the official source.

## Spend controls

Set in `.env`, in micro-USDC (`10000` = $0.01):
- `MAX_PER_CALL_UUSDC`: the client refuses to sign any single payment above this.
- `MAX_PER_RUN_UUSDC`: the client stops paying once a run reaches this total.

## Mainnet

Chain ID, token address, node URL and explorer are configuration only (`.env`), not code.
