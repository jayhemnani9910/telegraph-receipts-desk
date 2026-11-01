import * as truth from "./truth.ts";
import { leaves, mentions, flagValue, SANCTIONED_KEYS, texts } from "../src/answers.ts";

// Known-answer questions per Intent, grouped by the mission that would buy them.
// check: "manual" = no free independent source; read the saved answer by hand.

export type Fixture = {
  mission: string;
  intent: string;
  query: string;
  truth?: () => Promise<unknown>;
  check: ((result: unknown, truth: any, query: string) => boolean) | "manual";
};

const has = (...words: string[]) => (result: unknown, _truth: unknown, query: string) => mentions(result, query, ...words);

// Pass if any number in the answer is within `pct` percent of the truth.
const near = (pct: number) => (result: unknown, expected: number, query: string) =>
  [
    ...leaves(result).flatMap(([, v]) => (typeof v === "number" ? [v] : [])),
    ...texts(result, query).flatMap((t) => (t.replaceAll(",", "").match(/-?\d+(\.\d+)?/g) ?? []).map(Number)),
  ].some((n) => Math.abs(n - expected) <= Math.abs(expected) * (pct / 100));

// Pass if the answer has at least one of these fields and all of them equal `want`.
const flag = (want: boolean, keys: string[]) => (result: unknown) => flagValue(result, keys) === want;

const UP = ["up", "is_up", "online", "reachable", "available"];
const httpOk = (result: unknown) =>
  leaves(result).some(([k, v]) => ["status", "status_code", "http_status", "statuscode"].includes(k.toLowerCase()) && Number(v) === 200);

export const fixtures: Fixture[] = [
  // Legal
  {
    mission: "Legal",
    intent: "SANCTIONS_SCREENING_MATCH",
    query: "Is Vladimir Vladimirovich Putin on the OFAC SDN sanctions list?",
    check: flag(true, SANCTIONED_KEYS),
  },
  {
    mission: "Legal",
    intent: "SANCTIONS_SCREENING_MATCH",
    query: "Is Tobias Lindqvist-Arendt on the OFAC SDN sanctions list?",
    check: flag(false, SANCTIONED_KEYS),
  },
  {
    mission: "Legal",
    intent: "CORPORATE_REGISTRY_LOOKUP",
    query: "Look up Apple Inc. in the global LEI corporate registry. What is its LEI code?",
    check: has("HWUPKR0MPOU8FGXBT394"),
  },
  {
    mission: "Legal",
    intent: "REGULATORY_FILING_MONITOR",
    query: "What is the filing date of Apple Inc.'s (CIK 0000320193) most recent 10-K on SEC EDGAR?",
    truth: truth.appleLatest10K,
    check: (result, date, query) => has(date)(result, date, query),
  },
  {
    mission: "Legal",
    intent: "WEB_SEARCH",
    query: "Search the web: which country won the 2022 FIFA World Cup?",
    check: has("argentina"),
  },
  {
    mission: "Legal",
    intent: "FACT_CHECK",
    query: "Fact check this claim: the Eiffel Tower is located in Berlin.",
    check: has("false", "incorrect", "inaccurate", "misleading"),
  },
  {
    mission: "Legal",
    intent: "LANGUAGE_TRANSLATION",
    query: "Translate 'good morning' into Spanish.",
    check: has("buenos días", "buenos dias"),
  },
  {
    mission: "Legal",
    intent: "TEXT_SUMMARIZATION",
    query: "Summarize in one sentence: The SEC adopted rules requiring public companies to disclose material cybersecurity incidents within four business days.",
    check: has("cyber"),
  },

  // Exchange
  {
    mission: "Exchange",
    intent: "SMART_CONTRACT_AUDIT",
    query: "Audit the Ethereum mainnet contract 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D (Uniswap V2 Router 02). Is the source verified and are there honeypot risks?",
    check: "manual",
  },
  {
    mission: "Exchange",
    intent: "TOKEN_TOTAL_SUPPLY_VERIFY",
    query: "What is the total supply of the USDC token 0xcc194e1a843B658526D0D5C431f670028582Ae17 on Ethereum Sepolia?",
    truth: truth.usdcTotalSupply,
    check: near(1),
  },
  {
    mission: "Exchange",
    intent: "CRYPTO_PRICE",
    query: "What is the current price of Ethereum in USD?",
    truth: truth.ethUsd,
    check: near(3),
  },
  {
    mission: "Exchange",
    intent: "LIQUIDITY_DEPTH_VERIFY",
    query: "What is the order book depth within 1% of mid price for BTC/USD on Kraken right now?",
    check: "manual",
  },
  {
    mission: "Exchange",
    intent: "WASH_TRADING_DETECTION",
    query: "Is there evidence of wash trading in the PEPE/WETH pool on Uniswap over the last 24 hours?",
    check: "manual",
  },
  {
    mission: "Exchange",
    intent: "SOCIAL_BOT_DETECTION",
    query: "Estimate what share of the X/Twitter followers of @pepecoineth are bots.",
    check: "manual",
  },

  // Commodities
  {
    mission: "Commodities",
    intent: "VESSEL_TELEMETRY_VERIFY",
    query: "What is the latest reported position and speed of the vessel Ever Given (IMO 9811000, MMSI 353136000)?",
    check: "manual",
  },
  {
    mission: "Commodities",
    intent: "LIVE_PORT_CONGESTION",
    query: "How congested is the Port of Rotterdam right now? How many vessels are waiting at anchor?",
    check: "manual",
  },
  {
    mission: "Commodities",
    intent: "FX_NOW",
    query: "What is the current EUR to USD exchange rate?",
    truth: truth.eurUsd,
    check: near(1),
  },

  // Consumer Automation
  {
    mission: "Consumer Automation",
    intent: "TRAVEL_DISRUPTION",
    query: "Are there any current FAA ground stops or ground delays at major US airports?",
    check: "manual",
  },
  {
    mission: "Consumer Automation",
    intent: "SERVER_UPTIME_MONITOR",
    query: "Is https://github.com up right now? What HTTP status does it return?",
    truth: truth.githubUp,
    check: (result, up) => (up ? httpOk(result) || flag(true, UP)(result) : flag(false, UP)(result)),
  },
  {
    mission: "Consumer Automation",
    intent: "LIVE_SHELF_PRICE",
    query: "What is the current price of the Apple AirPods Pro 2 on Amazon US?",
    check: "manual",
  },
];
