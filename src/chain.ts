// A wallet's payments to Telegraph, read from a public block explorer, so anyone can check them without trusting us.
import { config } from "./config.ts";

export type Payment = { at: string; tx: string; uusdc: string };
export type Run = { start: string; payments: Payment[]; uusdc: string };

const MAX_PAGES = 20;

// x402 payments are test USDC transfers from the wallet to the Diamond, newest first.
export async function paymentsToTelegraph(address: string): Promise<Payment[]> {
  const payments: Payment[] = [];
  let next: Record<string, string> | null = {};
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ type: "ERC-20", filter: "from", ...next });
    const res = await fetch(`${config.blockscoutApi}/addresses/${address}/token-transfers?${query}`);
    if (!res.ok) throw new Error(`Block explorer answered HTTP ${res.status}`);
    const body: any = await res.json();
    for (const t of body.items ?? []) {
      const token = String(t.token?.address_hash ?? t.token?.address ?? "").toLowerCase();
      if (token !== config.usdc.toLowerCase() || String(t.to?.hash).toLowerCase() !== config.diamond.toLowerCase()) continue;
      payments.push({ at: t.timestamp, tx: t.transaction_hash, uusdc: String(t.total?.value ?? "0") });
    }
    next = body.next_page_params ?? null;
  }
  return payments;
}

// Payments less than 5 minutes apart belong to one run of the app. Oldest run first.
export function groupRuns(payments: Payment[], gapMs = 5 * 60_000): Run[] {
  const runs: Run[] = [];
  for (const p of [...payments].sort((a, b) => a.at.localeCompare(b.at))) {
    const last = runs.at(-1);
    const lastAt = last ? Date.parse(last.payments.at(-1)!.at) : -Infinity;
    if (last && Date.parse(p.at) - lastAt < gapMs) last.payments.push(p);
    else runs.push({ start: p.at, payments: [p], uusdc: "0" });
  }
  for (const r of runs) r.uusdc = r.payments.reduce((s, p) => s + BigInt(p.uusdc), 0n).toString();
  return runs;
}
