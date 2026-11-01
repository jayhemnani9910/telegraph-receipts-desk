// One paid Telegraph answer, recorded in the ledger and compared with a primary source.
import { config } from "./config.ts";
import { record } from "./ledger.ts";
import type { AskResult, createPayer } from "./telegraph.ts";
import type { Sourced } from "./primary.ts";

// confirmed: the paid answer agrees with the primary source; contradicted: it disagrees;
// unconfirmed: it could not be compared; network failed: no usable answer was returned.
export type Agreement = "confirmed" | "contradicted" | "unconfirmed" | "network failed";

export type Item = {
  check: string;
  intent: string;
  finding: string;
  primary: Sourced<unknown>;
  limits: string;
  query: string;
  params?: Record<string, string>;
  miners?: string[];
  agreement: Agreement;
  network: {
    status: number;
    miner: string | null;
    answer: unknown;
    receiptHash: string | null;
    txHash: string | null;
    amountUusdc: string | null;
    charged: boolean;
    at: string;
  };
  // Earlier attempts that failed before the one above answered (or the last one failed).
  failedAttempts: { miner: string; status: number; charged: boolean; txHash: string | null; at: string }[];
};

export type CheckSpec = {
  check: string;
  intent: string;
  query: string;
  // With params the call names the Intent and its typed inputs (V2 canonical ask); without, the query is routed.
  params?: Record<string, string>;
  // Miners to ask directly first, best first. The routed ask is the fallback.
  miners?: string[];
  primary: Sourced<unknown>;
  finding: string;
  limits: string;
  compare: (answer: unknown, query: string) => Agreement;
};

// Failed calls can still be charged, so stop trying other miners after this many charged failures.
const MAX_CHARGED_FAILURES = 2;

const attempt = async (payer: ReturnType<typeof createPayer>, spec: CheckSpec, miner: string | null): Promise<AskResult> => {
  try {
    if (miner && spec.params) return await payer.askIntentAt(miner, spec.intent, spec.params);
    return await (spec.params ? payer.askIntent(spec.intent, spec.params, spec.query) : payer.ask(spec.query));
  } catch (err) {
    // Spend cap hit or payment refused before anything was paid.
    return { status: 0, body: { error: (err as Error).message }, receipt: null, payment: null, durationMs: 0 };
  }
};

export async function buyChecked(payer: ReturnType<typeof createPayer>, label: string, spec: CheckSpec): Promise<Item> {
  const failedAttempts: Item["failedAttempts"] = [];
  // Routing on V2 often picks a miner that cannot answer, so named miners go first; a miner that cannot
  // take the request is refused before payment and costs nothing.
  const candidates = [...(spec.params ? (spec.miners ?? []) : []), null];
  let at = new Date().toISOString();
  let result = await attempt(payer, spec, candidates[0]);
  let entry = record(`${label}:${spec.intent}`, spec.query, result);
  for (const next of candidates.slice(1)) {
    if (result.status === 200 || failedAttempts.filter((f) => f.charged).length + Number(entry.paid) >= MAX_CHARGED_FAILURES) break;
    failedAttempts.push({ miner: candidates[failedAttempts.length] ?? "routed", status: result.status, charged: entry.paid, txHash: entry.tx_hash, at });
    at = new Date().toISOString();
    result = await attempt(payer, spec, next);
    entry = record(`${label}:${spec.intent}`, spec.query, result);
  }
  const answer = result.body?.result ?? result.body;
  const { compare, ...rest } = spec;
  return {
    ...rest,
    agreement: result.status === 200 ? compare(answer, spec.query) : "network failed",
    network: {
      status: result.status,
      miner: result.body?.miner_name ?? entry.miner,
      answer,
      receiptHash: entry.receipt_hash,
      txHash: entry.tx_hash,
      amountUusdc: entry.amount_uusdc,
      charged: entry.paid,
      at,
    },
    failedAttempts,
  };
}

// What actually settled: the payer's own counter also counts payments that were signed but refused.
export const settled = (items: Item[]) => items.reduce((s, i) => s + (i.network.charged ? BigInt(i.network.amountUusdc ?? 0) : 0n), 0n);

// Failed calls that were still charged come back with no amount; count them so the total is not understated.
export const chargedWithoutAmount = (items: Item[]) =>
  items.reduce((n, i) => n + Number(i.network.charged && !i.network.amountUusdc) + i.failedAttempts.filter((f) => f.charged).length, 0);

export const spentNote = (items: Item[]) => {
  const n = chargedWithoutAmount(items);
  return `Spent ${settled(items)} uUSDC${n ? `, plus ${n} failed call${n > 1 ? "s" : ""} charged with no amount reported (npm run reconcile shows each)` : ""}.`;
};

export const usd = (uusdc: bigint) => `$${(Number(uusdc) / 1e6).toFixed(2)}`;

export const txUrl = (item: Item) => (item.network.txHash ? `${config.explorerTxUrl}${item.network.txHash}` : null);

export const cost = (item: Item) =>
  item.network.amountUusdc ? usd(BigInt(item.network.amountUusdc)) : item.network.charged ? "charged, amount not reported" : "$0.00";
