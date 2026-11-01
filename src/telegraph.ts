import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { config, privateKey } from "./config.ts";

export type Receipt = {
  receipt_hash: string;
  rail: string;
  payer: string;
  miner: string;
  intent: string;
  amount_uusdc: string;
  epoch_id: number;
  settlement: string;
  chain: string;
  tx_hash?: string;
  timestamp: number;
};

export type AskResult = {
  status: number;
  body: any;
  receipt: Receipt | null;
  // x402 settlement, present whenever the payment was settled (even if the call itself failed).
  payment: ReturnType<typeof decodePaymentResponseHeader> | null;
  durationMs: number;
};

const getJson = async (path: string) => {
  const res = await fetch(`${config.nodeUrl}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
};

// Free discovery
export const listIntents = () => getJson("/engine/v1/intents");
export const intentMiners = (intent: string) => getJson(`/engine/v1/intents/${intent}/miners`);
export const listMiners = (intent?: string) =>
  getJson(`/api/miners?status=active&limit=5000${intent ? `&intent=${intent}` : ""}`);

const decodeHeader = (value: string | null) =>
  value ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) : null;

// Paid client: x402 "exact" scheme only, with a per-call cap and a per-run budget.
export function createPayer() {
  const account = privateKeyToAccount(privateKey());
  let spent = 0n;

  const client = x402Client.fromConfig({
    schemes: [{ network: config.network, client: new ExactEvmScheme(toClientEvmSigner(account)) }],
    spendControls: {
      maxAmountPerPayment: false,
      allowedAssets: [{ network: config.network, asset: config.usdc, maxAmountPerPayment: config.maxPerCallUusdc.toString() }],
    },
  });
  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    const amount = BigInt(selectedRequirements.amount);
    if (spent + amount > config.maxPerRunUusdc) {
      return { abort: true, reason: `run budget ${config.maxPerRunUusdc} uUSDC would be exceeded` };
    }
    spent += amount;
  });

  const paidFetch = wrapFetchWithPayment(fetch, client);

  const post = async (path: string, body: unknown): Promise<AskResult> => {
    const started = Date.now();
    const res = await paidFetch(`${config.nodeUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const paymentHeader = res.headers.get("payment-response");
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep raw text
    }
    return {
      status: res.status,
      body: parsed,
      receipt: decodeHeader(res.headers.get("x-telegraph-receipt")),
      payment: paymentHeader ? decodePaymentResponseHeader(paymentHeader) : null,
      durationMs: Date.now() - started,
    };
  };

  return {
    address: account.address,
    spent: () => spent,
    // Auto-routed: the node classifies the query into an Intent and picks a ranked miner.
    ask: (query: string, context?: object) => post("/engine/v1/ask", context ? { query, context } : { query }),
    // Canonical (V2): name the Intent and its typed params. Checked against the Intent's schema before payment,
    // and the answer comes back in the Intent's own shape whichever miner serves it.
    askIntent: (intent: string, params: Record<string, string>, query?: string) =>
      post("/engine/v1/ask", query ? { intent, params, query } : { intent, params }),
    // Direct: a specific miner and endpoint from its YAML.
    askMiner: (minerId: string, method: string, endpoint: string, payload: object) =>
      post(`/engine/v1/ask/${minerId}`, { method, endpoint, payload }),
  };
}
