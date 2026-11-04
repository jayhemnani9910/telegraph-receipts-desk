// The trip, the US DOT refund rule, and drafting the claim. Shared by the one-off claim and the watcher.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "../../src/config.ts";
import type { createPayer } from "../../src/telegraph.ts";
import { buyChecked, type Item } from "../../src/evidence.ts";
import { DISRUPTED_KEYS, flagValue } from "../../src/answers.ts";
import { faaAirportStatus } from "../../src/primary.ts";
import { renderEmail, renderReport } from "./render.ts";

export type Trip = {
  passenger: string;
  email: string;
  airline: string;
  airlineEmail: string;
  flight: string;
  booking: string;
  from: string;
  to: string;
  international: boolean;
  scheduledDeparture: string;
  revisedDeparture?: string;
  scheduledArrival?: string;
  revisedArrival?: string;
  cancelled: boolean;
  traveled: boolean;
  fare: string;
  currency: string;
};

export type Assessment = { eligible: boolean; reason: string; changeHours: number; thresholdHours: number };

// Asked directly before the routed ask (checked 2026-11-01: routing picked an aircraft-traffic feed, and the
// FAA-based miners failed upstream). A miner that is gone or cannot take the request costs nothing.
const TRAVEL_MINERS = ["7602"]; // TravelWire Travel Disruption

const AIRPORT_CODE = /^[A-Za-z]{3}$/;
const TIMES = ["scheduledDeparture", "revisedDeparture", "scheduledArrival", "revisedArrival"] as const;

const REQUIRED = ["passenger", "email", "airline", "airlineEmail", "flight", "booking", "from", "to", "scheduledDeparture", "fare", "currency"] as const;

export const readTrip = (path: string): Trip => validTrip(JSON.parse(readFileSync(path, "utf8")));

export function validTrip(trip: Trip): Trip {
  const missing = REQUIRED.filter((k) => !trip[k]);
  if (missing.length) throw new Error(`Trip is missing: ${missing.join(", ")}`);
  // These two go to the network, so nothing else may be typed here.
  if (![trip.from, trip.to].every((code) => AIRPORT_CODE.test(code))) throw new Error("From and To must be 3-letter airport codes, e.g. JFK");
  const badTime = TIMES.find((k) => trip[k] && Number.isNaN(Date.parse(trip[k]!)));
  if (badTime) throw new Error(`Bad date in ${badTime}: ${trip[badTime]} (use ISO 8601 with offset, e.g. 2026-10-23T08:00:00-07:00)`);
  return trip;
}

export const airportsOf = (trip: Trip) => [...new Set([trip.from, trip.to].map((a) => a.toUpperCase()))];

const hoursBetween = (from?: string, to?: string) => {
  if (!from || !to) return 0;
  return (Date.parse(to) - Date.parse(from)) / 3_600_000;
};

// 14 CFR Part 260: refund due when the carrier cancels or significantly changes the flight and the
// passenger does not accept the change. Significant: departs 3h+ earlier or later, or arrives 3h+ later
// (6h for international). The cause does not matter.
export function assess(trip: Trip): Assessment {
  const thresholdHours = trip.international ? 6 : 3;
  const changeHours = Math.max(Math.abs(hoursBetween(trip.scheduledDeparture, trip.revisedDeparture)), hoursBetween(trip.scheduledArrival, trip.revisedArrival));
  const kind = trip.international ? "international" : "domestic";
  if (trip.traveled) return { eligible: false, changeHours, thresholdHours, reason: "You took the flight, which counts as accepting the change, so the refund rule does not apply." };
  if (trip.cancelled) return { eligible: true, changeHours, thresholdHours, reason: "The carrier cancelled the flight." };
  if (changeHours >= thresholdHours) {
    return { eligible: true, changeHours, thresholdHours, reason: `The schedule changed by ${changeHours.toFixed(1)} hours, at or over the ${thresholdHours}-hour threshold for ${kind} flights.` };
  }
  return { eligible: false, changeHours, thresholdHours, reason: `The schedule changed by ${changeHours.toFixed(1)} hours, under the ${thresholdHours}-hour threshold for ${kind} flights.` };
}

// Buys a disruption report per airport, checks it against the FAA feed, and writes the draft. Returns its folder and the checks.
export async function draftClaim(payer: ReturnType<typeof createPayer>, trip: Trip, assessment: Assessment) {
  const items: Item[] = await Promise.all(
    airportsOf(trip).map(async (code) => {
      const faa = await faaAirportStatus(code);
      const { disrupted, events } = faa.value;
      return buyChecked(payer, "flight-claim", {
        check: `Disruption at ${code}`,
        intent: "TRAVEL_DISRUPTION_GENERAL",
        query: `Is air travel disrupted at ${code} airport right now?`,
        params: { route_or_flight: code },
        miners: TRAVEL_MINERS,
        primary: faa,
        finding: events.length
          ? events.map((e) => `${e.type}: ${e.reason}${e.detail ? ` (${e.detail})` : ""}`).join("; ") + (disrupted ? "" : ". General aviation only; airline flights not affected.")
          : "No delay, ground stop or closure reported.",
        limits: "FAA status at the time of the check, US airports only. It shows airport-wide disruption, not the status of this flight.",
        compare: (answer) => {
          const said = flagValue(answer, DISRUPTED_KEYS);
          return said === null ? "unconfirmed" : said === disrupted ? "confirmed" : "contradicted";
        },
      });
    }),
  );

  for (const item of items) console.log(`${item.check.padEnd(18)} ${item.agreement.padEnd(15)} ${item.finding.slice(0, 90)}`);

  const generatedAt = new Date().toISOString();
  const dir = `${config.dataDir}/claims/${generatedAt.replaceAll(":", "-")}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/claim.json`, JSON.stringify({ generatedAt, payer: payer.address, network: config.network, trip, assessment, items }, null, 2));
  writeFileSync(`${dir}/claim.md`, renderReport(generatedAt, payer.address, trip, assessment, items));
  writeFileSync(`${dir}/claim.eml`, renderEmail(trip, assessment, items));
  return { dir, items };
}
