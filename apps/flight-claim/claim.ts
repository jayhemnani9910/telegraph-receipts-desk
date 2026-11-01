// Flight refund claim: checks the trip against the US DOT refund rule, buys a disruption report for each
// airport through Telegraph, checks it against the FAA feed, and drafts the claim with the receipts attached.
// Nothing is sent: the passenger reviews the draft and sends it. Only airport codes go to the network.
// Usage: npm run flight-claim -- apps/flight-claim/example-trip.json
import { config } from "../../src/config.ts";
import { createPayer } from "../../src/telegraph.ts";
import { spentNote } from "../../src/evidence.ts";
import { assess, draftClaim, readTrip, type Trip } from "./trip.ts";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run flight-claim -- <trip.json>   (see apps/flight-claim/example-trip.json)");
  process.exit(1);
}
let trip: Trip;
try {
  trip = readTrip(path);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const assessment = assess(trip);
console.log(assessment.reason);
if (!assessment.eligible) {
  console.log("No claim drafted and nothing bought.");
  process.exit(0);
}

const payer = createPayer();
console.log(`Paying from ${payer.address} on ${config.network}\n`);
const { dir, items } = await draftClaim(payer, trip, assessment);
console.log(`\n${spentNote(items)} Review and send: ${dir}/claim.eml  (evidence: ${dir}/claim.md)`);
