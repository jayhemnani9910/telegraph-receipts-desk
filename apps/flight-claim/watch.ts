// Watches a trip until it qualifies for a refund, then drafts the claim once. Each check is free: it re-reads
// the trip file (update revisedDeparture/revisedArrival/cancelled as the airline notifies you) and the FAA feed.
// It pays only when the DOT threshold is crossed, then stops.
// Usage: npm run flight-watch -- data/my-trip.json [--every=5]   (minutes between checks)
import { setTimeout as sleep } from "node:timers/promises";
import { config } from "../../src/config.ts";
import { createPayer } from "../../src/telegraph.ts";
import { faaAirportStatus } from "../../src/primary.ts";
import { spentNote } from "../../src/evidence.ts";
import { airportsOf, assess, draftClaim, readTrip } from "./trip.ts";

const path = process.argv.slice(2).find((a) => !a.startsWith("--"));
const everyMinutes = Number(process.argv.find((a) => a.startsWith("--every="))?.split("=")[1] ?? 5);
if (!path || !(everyMinutes > 0)) {
  console.error("Usage: npm run flight-watch -- <trip.json> [--every=5]");
  process.exit(1);
}

// Fail now on a missing or broken file; later read errors (a half-saved edit) are retried.
try {
  readTrip(path);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const payer = createPayer();
console.log(`Watching ${path} every ${everyMinutes} min. Pays from ${payer.address} on ${config.network} only once eligible. Ctrl+C to stop.\n`);

const airportLine = async (code: string) => {
  try {
    const { disrupted, events } = (await faaAirportStatus(code)).value;
    if (!events.length) return `${code} clear`;
    return `${code} ${disrupted ? "" : "GA only: "}${events.map((e) => `${e.type}${e.detail ? ` (${e.detail})` : ""}`).join("; ")}`;
  } catch (err) {
    return `${code} FAA feed unavailable (${(err as Error).message})`;
  }
};

while (true) {
  const time = new Date().toISOString().slice(11, 16);
  try {
    // Re-read every time so schedule changes made while watching are picked up.
    const trip = readTrip(path);
    const assessment = assess(trip);
    const airports = await Promise.all(airportsOf(trip).map(airportLine));
    console.log(`${time}  ${trip.flight} changed ${assessment.changeHours.toFixed(1)}h of ${assessment.thresholdHours}h${trip.cancelled ? ", cancelled" : ""}  |  ${airports.join("  |  ")}`);

    if (trip.traveled) {
      console.log(`\n${assessment.reason} Stopped; nothing bought.`);
      break;
    }
    if (assessment.eligible) {
      console.log(`\n${assessment.reason} Buying evidence and drafting the claim.\n`);
      const { dir, items } = await draftClaim(payer, trip, assessment);
      console.log(`\n${spentNote(items)} Review and send: ${dir}/claim.eml  (evidence: ${dir}/claim.md)`);
      break;
    }
  } catch (err) {
    // A half-saved or bad trip file: say so and try again next round.
    console.log(`${time}  ${(err as Error).message}`);
  }
  await sleep(everyMinutes * 60_000);
}
