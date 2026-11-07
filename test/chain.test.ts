import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../src/config.ts";
import { groupRuns, paymentsToTelegraph } from "../src/chain.ts";

const transfer = (at: string, to: string, token: string, value = "10000") => ({
  timestamp: at,
  transaction_hash: `0x${at.replace(/\D/g, "")}`,
  to: { hash: to },
  token: { address_hash: token },
  total: { value },
});

test("only test USDC sent to Telegraph counts, across every page", async () => {
  const pages = [
    { items: [transfer("2026-11-07T00:09:00Z", config.diamond, config.usdc), transfer("2026-11-07T00:08:00Z", "0xother", config.usdc)], next_page_params: { block_number: "1" } },
    { items: [transfer("2026-11-04T10:56:00Z", config.diamond.toLowerCase(), "0xothertoken")], next_page_params: null },
  ];
  const saved = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    return new Response(JSON.stringify(pages[asked.length - 1]));
  }) as typeof fetch;
  try {
    const payments = await paymentsToTelegraph("0xabc");
    assert.deepEqual(payments.map((p) => p.at), ["2026-11-07T00:09:00Z"]);
    assert.equal(asked.length, 2);
    assert.match(asked[1], /block_number=1/);
  } finally {
    globalThis.fetch = saved;
  }
});

test("payments less than 5 minutes apart are one run", () => {
  const p = (at: string) => ({ at, tx: at, uusdc: "10000" });
  const runs = groupRuns([p("2026-11-04T10:59:00Z"), p("2026-11-04T10:56:00Z"), p("2026-11-04T11:10:00Z")]);
  assert.deepEqual(runs.map((r) => [r.start, r.payments.length, r.uusdc]), [["2026-11-04T10:56:00Z", 2, "20000"], ["2026-11-04T11:10:00Z", 1, "10000"]]);
});
