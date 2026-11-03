// Buy one answer through Telegraph, then check it against the official source. Walkthrough: docs/tutorial.md
// Usage: npm run first-check -- JFK
import { config } from "../src/config.ts";
import { record } from "../src/ledger.ts";
import { faaAirportStatus } from "../src/primary.ts";
import { createPayer } from "../src/telegraph.ts";

const airport = (process.argv[2] ?? "JFK").toUpperCase();
const intent = "TRAVEL_DISRUPTION_GENERAL";

// 1. The official answer, free, from the FAA.
const official = (await faaAirportStatus(airport)).value;
console.log(`FAA says:       ${airport} ${official.disrupted ? "disrupted" : "not disrupted"} (feed updated ${official.feedUpdated})`);

// 2. The same question, bought through Telegraph. Naming the Intent and its params means a bad request is
// refused before any payment, and the answer comes back in the Intent's own shape, whichever miner serves it.
const payer = createPayer();
const result = await payer.askIntent(intent, { route_or_flight: airport });
record(`first-check:${intent}`, airport, result);

if (result.status !== 200) {
  console.log(`Telegraph said: HTTP ${result.status} ${JSON.stringify(result.body).slice(0, 200)}`);
  if (result.status === 402) console.log("Nothing was paid. Usually this means no test USDC on this chain: npm run balance, then npm run mint.");
  if (result.payment) console.log(`Your payment is not lost: it stays in escrow. ${config.explorerTxUrl}${result.payment.transaction}`);
  process.exit(1);
}

const { miner_name, result: answer, result_shape, field_status, signal_hash } = result.body;
console.log(`Telegraph said: ${JSON.stringify(answer).slice(0, 300)}`);
console.log(`Served by:      ${miner_name} (result_shape: ${result_shape})`);
if (field_status) console.log(`Field status:   ${JSON.stringify(field_status)}`);

// 3. Compare. A 200 only means something was delivered: an empty field is no answer, not a "no".
const said = result_shape === "intent" ? answer.disrupted : null;
const verdict = said === null || said === undefined ? "UNCONFIRMED: no yes/no in the answer" : said === official.disrupted ? "CONFIRMED by the FAA" : "CONTRADICTED by the FAA";
console.log(`Verdict:        ${verdict}`);

// 4. The proof you keep.
console.log(`Receipt:        ${result.receipt?.receipt_hash ?? "none"}`);
console.log(`Payment:        ${config.explorerTxUrl}${result.receipt?.tx_hash ?? result.payment?.transaction}`);
console.log(`Raw answer:     ${config.nodeUrl}/engine/v1/signal/${signal_hash}`);
