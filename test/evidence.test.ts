import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../src/config.ts";
import { buyChecked, chargedWithoutAmount, settled, signalUrl, type CheckSpec } from "../src/evidence.ts";
import type { AskResult, createPayer } from "../src/telegraph.ts";

const spec: CheckSpec = {
  check: "Check",
  intent: "TEST_INTENT",
  query: "question",
  params: { name: "x" },
  miners: ["1", "2"],
  primary: { value: null, source: "s", asOf: "now" },
  finding: "f",
  limits: "l",
  compare: () => "confirmed",
};

const delivered: AskResult = { status: 200, body: { result: { ok: true }, miner_name: "M", signal_hash: "0xabc" }, receipt: { receipt_hash: "r", tx_hash: "t", amount_uusdc: "10000", miner: "m", intent: "TEST_INTENT" } as AskResult["receipt"], payment: null, durationMs: 1 };
const refusedFree: AskResult = { status: 503, body: { error: "no_compatible_miner" }, receipt: null, payment: null, durationMs: 1 };
const failedCharged: AskResult = { status: 500, body: { error: "upstream" }, receipt: null, payment: { success: true, transaction: "t2" } as AskResult["payment"], durationMs: 1 };

// A payer that plays back answers and records who was asked: a miner ID, or "routed".
const fakePayer = (...answers: (AskResult | Error)[]) => {
  const asked: string[] = [];
  const next = async (who: string) => {
    asked.push(who);
    const answer = answers.shift();
    if (!answer) throw new Error("Asked too many times");
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const payer = { askIntentAt: (miner: string) => next(miner), askIntent: () => next("routed"), ask: () => next("routed") };
  return { asked, payer: payer as unknown as ReturnType<typeof createPayer> };
};

test("the first named miner answers, so nobody else is asked", async () => {
  const { asked, payer } = fakePayer(delivered);
  const item = await buyChecked(payer, "test", spec);
  assert.deepEqual(asked, ["1"]);
  assert.equal(item.agreement, "confirmed");
  assert.deepEqual(item.network.answer, { ok: true });
});

test("a free refusal moves on to the next miner, then to routing", async () => {
  const { asked, payer } = fakePayer(refusedFree, refusedFree, delivered);
  const item = await buyChecked(payer, "test", spec);
  assert.deepEqual(asked, ["1", "2", "routed"]);
  assert.equal(item.agreement, "confirmed");
  assert.deepEqual(item.failedAttempts.map((f) => [f.miner, f.charged]), [["1", false], ["2", false]]);
});

test("a charged failure is recorded and the next miner is tried", async () => {
  const { asked, payer } = fakePayer(failedCharged, delivered);
  const item = await buyChecked(payer, "test", spec);
  assert.deepEqual(asked, ["1", "2"]);
  assert.equal(chargedWithoutAmount([item]), 1);
  assert.equal(settled([item]), 10000n);
});

test("it stops after two charged failures, to avoid tying up more funds", async () => {
  const { asked, payer } = fakePayer(failedCharged, failedCharged, delivered);
  const item = await buyChecked(payer, "test", spec);
  assert.deepEqual(asked, ["1", "2"]);
  assert.equal(item.agreement, "network failed");
  assert.equal(chargedWithoutAmount([item]), 2);
  assert.equal(settled([item]), 0n);
});

test("a wrong answer is still reported, not retried, because a 200 is billed", async () => {
  const { asked, payer } = fakePayer(delivered);
  const item = await buyChecked(payer, "test", { ...spec, compare: () => "contradicted" });
  assert.deepEqual(asked, ["1"]);
  assert.equal(item.agreement, "contradicted");
});

test("a refused payment counts as a failure and costs nothing", async () => {
  const { asked, payer } = fakePayer(new Error("run budget exceeded"), new Error("run budget exceeded"), new Error("run budget exceeded"));
  const item = await buyChecked(payer, "test", spec);
  assert.deepEqual(asked, ["1", "2", "routed"]);
  assert.equal(item.agreement, "network failed");
  assert.equal(item.network.charged, false);
  assert.equal(settled([item]), 0n);
});

test("with no typed params the query is routed, and named miners are skipped", async () => {
  const { asked, payer } = fakePayer(delivered);
  await buyChecked(payer, "test", { ...spec, params: undefined });
  assert.deepEqual(asked, ["routed"]);
});

test("a delivered answer links to the node's own record of it; a failed one has none", async () => {
  const ok = await buyChecked(fakePayer(delivered).payer, "test", spec);
  assert.equal(signalUrl(ok), `${config.nodeUrl}/engine/v1/signal/0xabc`);
  const failed = await buyChecked(fakePayer(failedCharged, failedCharged).payer, "test", spec);
  assert.equal(signalUrl(failed), null);
});
