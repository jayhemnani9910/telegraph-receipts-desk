import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { AskResult } from "./telegraph.ts";

// One line per paid call, keyed by receipt_hash (tx_hash is shared across batched payments).
const LEDGER = "data/ledger.jsonl";

export type LedgerEntry = {
  at: string;
  label: string;
  query: string;
  status: number;
  receipt_hash: string | null;
  tx_hash: string | null;
  intent: string | null;
  miner: string | null;
  amount_uusdc: string | null;
  paid: boolean;
  duration_ms: number;
};

export function record(label: string, query: string, result: AskResult): LedgerEntry {
  const entry: LedgerEntry = {
    at: new Date().toISOString(),
    label,
    query,
    status: result.status,
    receipt_hash: result.receipt?.receipt_hash ?? null,
    tx_hash: result.receipt?.tx_hash ?? result.payment?.transaction ?? null,
    intent: result.receipt?.intent ?? result.body?.intent ?? null,
    miner: result.receipt?.miner ?? result.body?.miner_id ?? null,
    amount_uusdc: result.receipt?.amount_uusdc ?? result.payment?.amount ?? null,
    paid: Boolean(result.receipt || result.payment?.success),
    duration_ms: result.durationMs,
  };
  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, JSON.stringify(entry) + "\n");
  return entry;
}

export function readLedger(): LedgerEntry[] {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
