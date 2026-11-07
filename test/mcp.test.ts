import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../web/mcp.ts";
import { assess, validTrip } from "../apps/flight-claim/trip.ts";

class Refused extends Error {}

async function connect(diligence: () => Promise<never>) {
  const server = buildServer(
    {
      diligence,
      flightCheck: (trip) => assess(validTrip(trip as never)),
      ledger: async () => ({ runs: [] }),
      describeError: (err) => (err instanceof Refused || (err as Error).message.includes("airport") ? (err as Error).message : null),
    },
    {} as IncomingMessage,
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const textOf = (r: any) => r.content[0].text as string;

test("agents see three tools and get the refund rule without personal details", async () => {
  const client = await connect(async () => { throw new Error("not called"); });
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name), ["diligence_pack", "flight_refund_eligibility", "public_ledger"]);
  const r = await client.callTool({ name: "flight_refund_eligibility", arguments: { from: "LAS", to: "JFK", scheduledDeparture: "2026-10-23T08:00:00-07:00", revisedDeparture: "2026-10-23T11:45:00-07:00" } });
  assert.match(textOf(r), /^Eligible\. The schedule changed by 3\.8 hours/);
  const bad = await client.callTool({ name: "flight_refund_eligibility", arguments: { from: "Las Vegas", to: "JFK", scheduledDeparture: "2026-10-23T08:00:00-07:00" } });
  assert.equal(bad.isError, true);
  assert.match(textOf(bad), /3-letter airport codes/);
});

test("a refusal reaches the agent; an unexpected error does not leak", async () => {
  const refused = await connect(async () => { throw new Refused("Limit reached"); });
  assert.equal(textOf(await refused.callTool({ name: "diligence_pack", arguments: { names: ["Tesla, Inc."] } })), "Limit reached");
  const broken = await connect(async () => { throw new Error("secret detail"); });
  const r = await broken.callTool({ name: "diligence_pack", arguments: { names: ["Tesla, Inc."] } });
  assert.equal(r.isError, true);
  assert.doesNotMatch(textOf(r), /secret/);
});
