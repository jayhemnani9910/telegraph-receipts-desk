// The claim email the passenger sends, and the evidence report behind it.
import { config } from "../../src/config.ts";
import { cost, txUrl, usd, type Item } from "../../src/evidence.ts";
import type { Assessment, Trip } from "./trip.ts";

const RULE =
  "Under the US Department of Transportation refund rule (14 CFR Part 260), a passenger is entitled to a refund to the original form of payment when a carrier cancels a flight or significantly changes it (a change of 3 hours or more for a domestic flight, 6 hours or more for an international flight) and the passenger does not accept the change or the alternative offered.";

const whatHappened = (trip: Trip) =>
  trip.cancelled
    ? "The flight was cancelled."
    : [
        trip.revisedDeparture && `The departure was moved from ${trip.scheduledDeparture} to ${trip.revisedDeparture}.`,
        trip.revisedArrival && `The arrival was moved from ${trip.scheduledArrival} to ${trip.revisedArrival}.`,
      ].filter(Boolean).join(" ");

const feedTime = (item: Item) => (item.primary.value as { feedUpdated: string }).feedUpdated;

export function renderEmail(trip: Trip, assessment: Assessment, items: Item[]): string {
  // Only airport disruptions confirmed by the FAA feed are cited; the refund right does not depend on them.
  const evidence = items.filter((i) => (i.primary.value as { disrupted: boolean }).disrupted);
  const body = [
    `Dear ${trip.airline} Customer Relations,`,
    ``,
    `I am requesting a refund of ${trip.currency} ${trip.fare} for booking ${trip.booking}, flight ${trip.flight} from ${trip.from} to ${trip.to}, scheduled to depart ${trip.scheduledDeparture}.`,
    ``,
    `${whatHappened(trip)} ${assessment.reason} I did not travel on the changed flight and did not accept alternative transportation or a travel credit.`,
    ``,
    RULE,
    ...(evidence.length
      ? [
          ``,
          `Supporting evidence, from the FAA National Airspace System status feed:`,
          ...evidence.map(
            (i) =>
              `- ${i.check}: ${i.finding} (feed updated ${feedTime(i)}). Independent check bought through Telegraph: ${i.agreement}, receipt ${i.network.receiptHash ?? "none"}${txUrl(i) ? `, payment ${txUrl(i)}` : ""}.`,
          ),
        ]
      : []),
    ``,
    `Please refund the fare to my original form of payment. The rule requires this within 7 business days for card purchases and 20 days for other forms of payment.`,
    ``,
    `Regards,`,
    trip.passenger,
    trip.email,
  ];
  return [
    `To: ${trip.airlineEmail}`,
    `From: ${trip.email}`,
    `Subject: Refund request: flight ${trip.flight}, booking ${trip.booking}`,
    `X-Unsent: 1`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    ...body,
    ``,
  ].join("\r\n");
}

export function renderReport(generatedAt: string, payer: string, trip: Trip, assessment: Assessment, items: Item[]): string {
  const total = items.reduce((s, i) => s + BigInt(i.network.amountUusdc ?? 0), 0n);
  return [
    `# Refund claim evidence: ${trip.flight}, ${trip.from} to ${trip.to}`,
    ``,
    `Generated ${generatedAt} by wallet \`${payer}\` on ${config.network} (testnet USDC). Draft only: nothing was sent.`,
    ``,
    `## Eligibility`,
    ``,
    `${whatHappened(trip)} ${assessment.reason}`,
    ``,
    RULE,
    ``,
    `## Airport checks`,
    ``,
    `| Check | FAA finding | Feed updated | Network answer | Cost | Receipt | Proof |`,
    `|---|---|---|---|---|---|---|`,
    ...items.map(
      (i) =>
        `| ${i.check} | ${i.finding.replaceAll("|", "\\|")} | ${feedTime(i)} | ${i.agreement} (${i.network.miner ?? `HTTP ${i.network.status}`}) | ${cost(i)} | \`${i.network.receiptHash ?? "none"}\` | ${txUrl(i) ? `[tx](${txUrl(i)})` : "none"} |`,
    ),
    ``,
    `Total: ${usd(total)}.`,
    ``,
    ...items.map((i) => `- ${i.check}: ${i.limits}`),
    ``,
    `Only airport codes were sent to the network; passenger details stay in this file.`,
    `Automated draft for the passenger to review, not legal advice. Verify the payments with \`npm run reconcile\`.`,
    ``,
  ].join("\n");
}
