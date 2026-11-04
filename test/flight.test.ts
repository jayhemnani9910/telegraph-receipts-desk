import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { assess, validTrip, type Trip } from "../apps/flight-claim/trip.ts";
import { renderEmail } from "../apps/flight-claim/render.ts";
import type { Item } from "../src/evidence.ts";

const trip = (over: Partial<Trip> = {}): Trip => ({
  passenger: "Alex Example",
  email: "alex@example.com",
  airline: "Example Air",
  airlineEmail: "refunds@example.com",
  flight: "EX123",
  booking: "ABC123",
  from: "LAS",
  to: "JFK",
  international: false,
  scheduledDeparture: "2026-10-23T08:00:00-07:00",
  cancelled: false,
  traveled: false,
  fare: "289.00",
  currency: "USD",
  ...over,
});
const moved = (time: string, over: Partial<Trip> = {}) => trip({ revisedDeparture: `2026-10-23T${time}:00-07:00`, ...over });

test("domestic: exactly 3 hours qualifies, just under does not", () => {
  assert.equal(assess(moved("11:00")).eligible, true);
  assert.equal(assess(moved("10:59")).eligible, false);
});

test("international: exactly 6 hours qualifies, just under does not", () => {
  assert.equal(assess(moved("14:00", { international: true })).eligible, true);
  assert.equal(assess(moved("13:59", { international: true })).eligible, false);
});

test("departing 3 hours earlier also qualifies", () => {
  assert.equal(assess(moved("05:00")).eligible, true);
});

test("arriving 3 hours later qualifies, arriving 3 hours earlier does not", () => {
  const arrival = { scheduledArrival: "2026-10-23T16:00:00-04:00" };
  assert.equal(assess(trip({ ...arrival, revisedArrival: "2026-10-23T19:00:00-04:00" })).eligible, true);
  assert.equal(assess(trip({ ...arrival, revisedArrival: "2026-10-23T13:00:00-04:00" })).eligible, false);
});

test("time zones are respected: the same moment written differently is no change", () => {
  assert.equal(assess(trip({ revisedDeparture: "2026-10-23T11:00:00-04:00" })).changeHours, 0);
});

test("a cancelled flight qualifies with no schedule change", () => {
  assert.equal(assess(trip({ cancelled: true })).eligible, true);
});

test("taking the flight rules out a refund, even if it was cancelled or moved", () => {
  assert.equal(assess(moved("20:00", { traveled: true })).eligible, false);
  assert.equal(assess(trip({ cancelled: true, traveled: true })).eligible, false);
});

test("validTrip names what is missing", () => {
  assert.throws(() => validTrip(trip({ airline: "", fare: "" })), /missing: airline, fare/);
});

test("validTrip refuses anything but an airport code, because those go to the network", () => {
  for (const from of ["My name is Alex", "JFKX", "J1K"]) assert.throws(() => validTrip(trip({ from })), /3-letter airport codes/);
  assert.throws(() => validTrip(trip({ to: "New York" })), /3-letter airport codes/);
  assert.equal(validTrip(trip({ from: "jfk" })).from, "jfk");
});

test("validTrip refuses a bad date in any time field", () => {
  for (const key of ["scheduledDeparture", "revisedDeparture", "scheduledArrival", "revisedArrival"] as const) {
    assert.throws(() => validTrip(trip({ [key]: "next Tuesday" })), new RegExp(`Bad date in ${key}`));
  }
});

const airport = (code: string, disrupted: boolean) =>
  ({
    check: `Disruption at ${code}`,
    finding: `Finding at ${code}`,
    primary: { value: { airport: code, disrupted, events: [], feedUpdated: "now" }, source: "faa", asOf: "now" },
    network: { receiptHash: `receipt-${code}`, txHash: null, amountUusdc: "10000", charged: true },
  }) as unknown as Item;

test("the email is a draft that cites only what the FAA shows as disrupted", () => {
  const t = moved("12:00");
  const email = renderEmail(t, assess(t), [airport("LAS", false), airport("JFK", true)]);
  assert.match(email, /^To: refunds@example.com/);
  assert.match(email, /X-Unsent: 1/);
  assert.match(email, /14 CFR Part 260/);
  assert.match(email, /receipt-JFK/);
  assert.doesNotMatch(email, /receipt-LAS/);
});

test("the email still claims the refund when no airport was disrupted", () => {
  const t = moved("12:00");
  const email = renderEmail(t, assess(t), [airport("LAS", false)]);
  assert.match(email, /requesting a refund of USD 289.00/);
  assert.doesNotMatch(email, /receipt-LAS/);
});
