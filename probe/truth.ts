import { createPublicClient, http, erc20Abi } from "viem";
import { config } from "../src/config.ts";

// Free, independent sources used to check what Telegraph miners answer.

export async function eurUsd(): Promise<number> {
  const res = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD");
  return (await res.json()).rates.USD;
}

export async function ethUsd(): Promise<number> {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
  return (await res.json()).ethereum.usd;
}

export async function usdcTotalSupply(): Promise<number> {
  const client = createPublicClient({ transport: http(config.rpcUrl) });
  const raw = await client.readContract({ address: config.usdc, abi: erc20Abi, functionName: "totalSupply" });
  return Number(raw) / 1e6;
}

export async function appleLatest10K(): Promise<string> {
  const res = await fetch("https://data.sec.gov/submissions/CIK0000320193.json", {
    headers: { "User-Agent": config.secUserAgent },
  });
  const recent = (await res.json()).filings.recent;
  const i = recent.form.indexOf("10-K");
  return recent.filingDate[i];
}

export async function githubUp(): Promise<boolean> {
  const res = await fetch("https://github.com", { method: "HEAD" });
  return res.ok;
}
