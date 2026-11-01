// Ask every fixture through Telegraph (auto-routed, paid with testnet USDC) and grade the answers.
// Usage: npm run probe                              -> paid run
//        npm run probe -- --dry                     -> free: only fetch the independent truth values
//        npm run probe -- --regrade=data/probe/x.json -> free: grade a saved run again
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "../src/config.ts";
import { createPayer } from "../src/telegraph.ts";
import { record } from "../src/ledger.ts";
import { fixtures, type Fixture } from "./fixtures.ts";

const dry = process.argv.includes("--dry");
const only = process.argv.find((a) => a.startsWith("--mission="))?.split("=")[1];
const regrade = process.argv.find((a) => a.startsWith("--regrade="))?.split("=")[1];
const selected = fixtures.filter((f) => !only || f.mission.toLowerCase() === only.toLowerCase());

const grade = (f: Fixture, status: number, result: unknown, expected: unknown) =>
  status !== 200 ? "error" : f.check === "manual" ? "manual" : f.check(result, expected, f.query) ? "pass" : "fail";

if (regrade) {
  const saved: Record<string, any>[] = JSON.parse(readFileSync(regrade, "utf8"));
  for (const row of saved) {
    const f = fixtures.find((x) => x.query === row.query);
    const verdict = f ? grade(f, row.status, row.response?.result ?? row.response, row.expected) : "no fixture";
    console.log(`${verdict.padEnd(10)} was ${String(row.verdict).padEnd(6)} ${row.intent}`);
  }
  process.exit(0);
}

const payer = dry ? null : createPayer();
if (payer) console.log(`Paying from ${payer.address}, budget ${config.maxPerRunUusdc} uUSDC\n`);

const rows: Record<string, any>[] = [];
for (const f of selected) {
  let expected: unknown;
  try {
    expected = f.truth ? await f.truth() : undefined;
  } catch (err) {
    expected = `truth source failed: ${(err as Error).message}`;
  }

  if (!payer) {
    console.log(`${f.intent.padEnd(28)} truth=${JSON.stringify(expected ?? "-")}`);
    continue;
  }

  let row: Record<string, any>;
  try {
    const result = await payer.ask(f.query);
    const entry = record(`probe:${f.intent}`, f.query, result);
    const verdict = grade(f, result.status, result.body?.result ?? result.body, expected);
    row = {
      ...f,
      truth: undefined,
      check: undefined,
      expected,
      verdict,
      routedIntent: entry.intent,
      intentMatch: entry.intent === f.intent,
      miner: result.body?.miner_name ?? entry.miner,
      status: result.status,
      costUsd: result.body?.cost_usd,
      paid: entry.paid,
      receipt: result.receipt,
      payment: result.payment,
      txUrl: entry.tx_hash ? config.explorerTxUrl + entry.tx_hash : null,
      response: result.body,
    };
  } catch (err) {
    row = { ...f, truth: undefined, check: undefined, expected, verdict: "error", error: (err as Error).message };
  }
  rows.push(row);
  console.log(
    `${row.verdict.padEnd(6)} ${f.intent.padEnd(28)} -> ${String(row.routedIntent ?? "?").padEnd(28)} ${String(row.miner ?? row.error ?? "").slice(0, 40)}`,
  );
}

if (payer) {
  mkdirSync("data/probe", { recursive: true });
  const file = `data/probe/${new Date().toISOString().replaceAll(":", "-")}.json`;
  writeFileSync(file, JSON.stringify(rows, null, 2));
  const count = (v: string) => rows.filter((r) => r.verdict === v).length;
  console.log(
    `\npass ${count("pass")}  fail ${count("fail")}  manual ${count("manual")}  error ${count("error")}` +
      `  | routed to expected intent ${rows.filter((r) => r.intentMatch).length}/${rows.length}` +
      `  | spent ${payer.spent()} uUSDC\nSaved ${file}`,
  );
}
