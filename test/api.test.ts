import "./setup.ts";
import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createApi, createRunLimiter } from "../web/api.ts";

test("the limiter allows the limit and no more, including runs sent together", () => {
  const allow = createRunLimiter(5, 1000);
  const results = Array.from({ length: 6 }, () => allow("visitor", 0));
  assert.deepEqual(results, [true, true, true, true, true, false]);
});

test("the limiter counts each visitor separately", () => {
  const allow = createRunLimiter(1, 1000);
  assert.equal(allow("a", 0), true);
  assert.equal(allow("b", 0), true);
  assert.equal(allow("a", 1), false);
});

test("the limiter frees up when the window passes, and refused tries don't extend it", () => {
  const allow = createRunLimiter(1, 1000);
  assert.equal(allow("a", 0), true);
  assert.equal(allow("a", 999), false);
  assert.equal(allow("a", 1000), true);
});

// These must all be refused before any purchase: setup.ts makes any network call fail with a 500.
let server: Server;
let base: string;
before(async () => {
  server = createServer(createApi({ hosted: true }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

// Plain http, because setup.ts blocks fetch.
const post = (path: string, body: string, type = "application/json") =>
  new Promise<{ status: number; error: string }>((resolve, reject) => {
    const req = request(`${base}${path}`, { method: "POST", headers: { "Content-Type": type } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode!, error: JSON.parse(text).error }));
    });
    req.on("error", reject);
    req.end(body);
  });

const names = (...list: string[]) => JSON.stringify({ names: list });
const trip = { passenger: "A", email: "a@example.com", airline: "X", airlineEmail: "r@example.com", flight: "X1", booking: "B", from: "LAS", to: "JFK", scheduledDeparture: "2026-10-23T08:00:00-07:00", fare: "1", currency: "USD", international: false, cancelled: false, traveled: false };

test("hosted refuses more than 3 names", async () => {
  assert.deepEqual(await post("/api/diligence", names("a", "b", "c", "d")), { status: 400, error: "At most 3 names per run" });
});

test("no names, or a blank or very long name, is refused", async () => {
  assert.equal((await post("/api/diligence", names())).status, 400);
  assert.equal((await post("/api/diligence", names("   "))).status, 400);
  assert.match((await post("/api/diligence", names("person:"))).error, /1 to 200 characters/);
  assert.match((await post("/api/diligence", names("x".repeat(201)))).error, /1 to 200 characters/);
});

test("only JSON is accepted", async () => {
  assert.deepEqual(await post("/api/diligence", names("a"), "text/plain"), { status: 400, error: "Send JSON" });
  assert.deepEqual(await post("/api/diligence", "{not json"), { status: 400, error: "Invalid JSON" });
});

test("a bad trip gets a clear 400", async () => {
  assert.match((await post("/api/flight/check", JSON.stringify({ trip: {} }))).error, /Trip is missing/);
  assert.match((await post("/api/flight/check", JSON.stringify({ trip: { ...trip, from: "Las Vegas" } }))).error, /airport codes/);
  const badDate = await post("/api/flight/check", JSON.stringify({ trip: { ...trip, revisedDeparture: "soon" } }));
  assert.equal(badDate.status, 400);
  assert.match(badDate.error, /Bad date in revisedDeparture/);
});

test("a flight that does not qualify buys nothing", async () => {
  const res = await post("/api/flight/claim", JSON.stringify({ trip }));
  assert.equal(res.status, 400);
  assert.match(res.error, /under the 3-hour threshold.*Nothing bought/);
});

test("an unknown path is a 404", async () => {
  assert.deepEqual(await post("/api/nope", "{}"), { status: 404, error: "Not found" });
});
