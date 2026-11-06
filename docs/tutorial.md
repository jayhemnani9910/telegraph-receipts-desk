# Buy an answer through Telegraph, and check it before you trust it

Time: about 15 minutes. Cost: free test tokens only. You need Node 20.12+ and a terminal.

By the end you will have:
- looked up what a Telegraph Intent expects, for free
- paid for an answer over x402 from a throwaway wallet
- compared that answer with an official source
- kept the receipt, and found the payment on-chain
- changed the example to check something else

Everything below was run from a clean clone on Ethereum Sepolia in November 2026. Your miner names and answers may differ, because the network chooses the miner and its rankings move.

## The idea

[Telegraph](https://anjoman.ai/docs) is a market for machine intelligence. You ask for something by **Intent** (a capability such as `TRAVEL_DISRUPTION_GENERAL`), the node routes you to a miner, and you pay per call.

A paid answer is not automatically a right answer. A `200` means something was delivered. So this tutorial treats every answer as a claim and checks it against a source you trust.

## 1. Set up a throwaway wallet

```bash
git clone https://github.com/jayhemnani9910/telegraph-receipts-desk.git
cd telegraph-receipts-desk
npm install
cp .env.example .env
npm run wallet:new
```

`wallet:new` writes a new key to `.env` (gitignored) and prints the address. Use this wallet for testing only.

## 2. Get test tokens

Payments use a test USDC that anyone can mint. Minting is an on-chain transaction, so it needs a little Sepolia ETH for gas. Paying for calls does not: x402 payments are gasless for the payer.

1. Open <https://sepolia-faucet.pk910.de>, paste your address and mine until you reach the 0.05 SepETH minimum, then claim. It took us about a minute; speed depends on your machine.
2. Mint and check:

```bash
npm run mint       # 10 test USDC
npm run balance
```

```
ETH  0.05
USDC 10  (~1000 calls at $0.01)
Escrow 0  (failed calls stay here; delivered calls are charged at the next epoch close)
```

## 3. See what an Intent expects, for free

```bash
curl -s https://devnode.telegraphprotocol.com/engine/v1/intents/TRAVEL_DISRUPTION_GENERAL
```

The useful parts of the response:

```
request params:  route_or_flight (string, required)
response fields: route_or_flight, disrupted, status, delay_minutes, reason
```

Whichever miner serves this Intent, the answer comes back with those keys.

A bad request is refused before any payment, so you can test your request shape for nothing:

```bash
curl -s -X POST https://devnode.telegraphprotocol.com/engine/v1/ask \
  -H 'Content-Type: application/json' \
  -d '{"intent":"TRAVEL_DISRUPTION_GENERAL","params":{"airport":"JFK"}}'
```

```
{"error":"invalid_params", ... "message":"route_or_flight is required (string); unknown param \"airport\"; this intent takes: route_or_flight" ...}
```

With the right param you get `402 Payment Required` instead. That is the signal that your request is valid and the node is waiting for payment.

## 4. Buy your first answer

```bash
npm run first-check -- JFK
```

```
FAA says:       JFK not disrupted (feed updated Tue Nov 3 14:13:43 2026 GMT)
Telegraph said: {"route_or_flight":"JFK","disrupted":false,"status":null,"delay_minutes":null,"reason":null}
Served by:      FAA NAS Airport Disruption Status (result_shape: intent)
Field status:   {"route_or_flight":"ok","disrupted":"ok","status":"rejected","delay_minutes":"missing","reason":"missing"}
Verdict:        CONFIRMED by the FAA
Receipt:        0x844c0b8e579c...
Payment:        https://sepolia.etherscan.io/tx/0x9bd5dc269c07...
Raw answer:     https://devnode.telegraphprotocol.com/engine/v1/signal/0x031e5614b653...
```

The whole program is short: [`examples/first-check.ts`](../examples/first-check.ts). It does four things.

**Get the official answer.** Free, from the FAA:

```ts
const official = (await faaAirportStatus(airport)).value;
```

**Buy the same answer.** `createPayer()` wraps `fetch` so the 402 challenge is signed and retried for you. It also enforces the spend caps in `.env`.

```ts
const payer = createPayer();
const result = await payer.askIntent("TRAVEL_DISRUPTION_GENERAL", { route_or_flight: airport });
```

**Compare, and treat empty as no answer.**

```ts
const said = result_shape === "intent" ? answer.disrupted : null;
const verdict = said === null || said === undefined ? "UNCONFIRMED: no yes/no in the answer"
  : said === official.disrupted ? "CONFIRMED by the FAA" : "CONTRADICTED by the FAA";
```

**Keep the proof.** The receipt, the payment transaction and the raw answer's hash.

## 5. Now see why the check matters

```bash
npm run first-check -- LAS
```

When we ran this, the call was delivered and paid for, but it gave no usable yes/no:

```
FAA says:       LAS not disrupted (feed updated Tue Nov 3 14:15:47 2026 GMT)
Telegraph said: {"route_or_flight":"LAS","disrupted":null,"status":"disruption_active","delay_minutes":null,"reason":null}
Field status:   {"route_or_flight":"ok","disrupted":"rejected","status":"ok","delay_minutes":"missing","reason":"missing"}
Verdict:        UNCONFIRMED: no yes/no in the answer
```

Two things to notice:

- `field_status` tells you which fields you can trust. `ok` was read from the answer. `missing` and `rejected` mean the field is `null`.
- `null` is not `false`. An early version of this project read an empty `disrupted` as "not disrupted" and reported a false match. Check for empty values first.

The FAA feed listed a closure at LAS at the time, but only for private planes, so airline flights were not affected. Reading that detail correctly takes a source you trust.

## 6. Find your payment

```bash
npm run reconcile -- --hours=1
```

```
on-chain transfers 2 (20000 uUSDC)  ledger calls 2  matched 2
All transfers match the ledger.
Escrow balance 0.02 USDC (failed calls stay there; recent delivered calls until the next epoch close).
```

This matches every USDC transfer from your wallet on-chain against `data/ledger.jsonl`, the local record of each paid call. It costs nothing.

**Where the money goes.** An x402 payment settles on-chain before the miner is called, and lands in your escrow balance on the Telegraph contract:

- A delivered call is charged against it at the next epoch close.
- A failed call is never charged, so its amount stays there as credit. It shows on-chain with no receipt, which looks alarming but is expected.
- A `200` with a useless answer counts as delivered, and is billed.

So escrow rises right after a run and falls after the epoch closes. Spend what remains with the escrow payment scheme, or withdraw it. See [Pay per Request](https://anjoman.ai/docs/using/x402-inference) and [Pay from Escrow](https://anjoman.ai/docs/using/escrow-inference).

## 7. Check something else

Copy the example and change three things: the official source, the Intent and params, and the field you compare. For a sanctions screen against the US Treasury list:

```ts
import { ofacScreen } from "../src/primary.ts";

const name = process.argv[2] ?? "Vladimir Putin";
const official = (await ofacScreen(name)).value.length > 0;

const payer = createPayer();
const result = await payer.askIntentAt("4433", "SANCTIONS_SCREENING_MATCH_GENERAL", { name });

const said = result.body?.result?.matched;
console.log(said === null || said === undefined ? "UNCONFIRMED" : said === official ? "CONFIRMED" : "CONTRADICTED");
```

```
OFAC says:      Vladimir Putin listed
Telegraph said: HTTP 200 {"name":"Vladimir Putin","matched":true,"matches":null,"lists":["OFAC SDN"],"match_score":1}
CONFIRMED
```

`askIntentAt` asks one named miner instead of letting the node route. We use it where routing gave poor answers. Miner IDs can change, so look them up with `curl https://devnode.telegraphprotocol.com/engine/v1/intents/<INTENT>/miners`. A miner that cannot take your request is refused with a 503 before any payment, so trying one costs nothing.

To see the same pattern in a full workflow, read [`apps/legal/pack.ts`](../apps/legal/pack.ts) (diligence pack) and [`apps/flight-claim/trip.ts`](../apps/flight-claim/trip.ts) (refund claim).

## Troubleshooting

These all came up in our own runs.

| You see | What it means | What to do |
|---|---|---|
| `No wallet in .env` | You have not created one yet | `npm run wallet:new` |
| `has no Sepolia ETH for gas` | Minting needs a little gas | Step 2, the faucet |
| `HTTP 402` from `first-check`, or `network failed` with status 402 in `data/ledger.jsonl` | Nothing was paid, usually because the wallet has no test USDC | `npm run balance`, then `npm run mint`. We also saw it once from a funded wallet on one named miner; try again or let the node route |
| `400 invalid_params` | Your params do not match the Intent. Free | Read the Intent schema in step 3 |
| `503 no_compatible_miner` | That miner cannot take this request. Free | Try another miner, or drop the miner ID |
| `HTTP 500` and a transaction on-chain with no receipt | The miner failed after the payment settled | Not lost: it stays in escrow. See step 6 |
| `200`, but fields are `null` | Delivered, with little or nothing usable. Billed | Read `field_status`, and treat it as unconfirmed |
| Escrow went up after a successful run | Normal until the epoch closes | Check again later |
| `UND_ERR_CONNECT_TIMEOUT` before anything is bought | An official source timed out | Run it again |

## Where to go next

- Run the full apps: see the [README](../README.md).
- Browse what the network can do: `curl https://devnode.telegraphprotocol.com/engine/v1/intents`
- Help improve the network: Telegraph's [bounty board](https://github.com/telegraphprotocol/bounties/issues) lists missing providers and evaluation work. Pick an open issue and comment `/claim`.
- Found a problem in this tutorial? [Open an issue](https://github.com/jayhemnani9910/telegraph-receipts-desk/issues). A report that a step failed for you is exactly what helps.
