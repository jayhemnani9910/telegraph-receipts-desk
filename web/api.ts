// The JSON API behind the web page. Local and hosted runs share it; hosted adds limits and keeps no drafts.
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, rmSync } from "node:fs";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { config } from "../src/config.ts";
import { createPayer, escrowBalance } from "../src/telegraph.ts";
import { chargedWithoutAmount, settled } from "../src/evidence.ts";
import { buildPack } from "../apps/legal/pack.ts";
import { assess, draftClaim, validTrip, type Trip } from "../apps/flight-claim/trip.ts";

const HOSTED_MAX_ENTITIES = 3;
const LOCAL_MAX_ENTITIES = 5;
const HOSTED_RUNS_PER_WINDOW = 5;
const HOSTED_WINDOW_MS = 10 * 60_000;
const HOSTED_MIN_USDC = 200_000n; // $0.20: enough for the largest run, with failed calls
const MAX_NAME_LENGTH = 200;

class BadRequest extends Error {}
class Refused extends Error {}

export const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readJson(req: IncomingMessage) {
  // JSON only: a page on another site cannot send this without a CORS preflight, which is never answered.
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new BadRequest("Send JSON");
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 100_000) throw new BadRequest("Request too large");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest("Invalid JSON");
  }
}

function tripFrom(body: any): Trip {
  try {
    return validTrip(body.trip ?? {});
  } catch (err) {
    throw new BadRequest((err as Error).message);
  }
}

// Per server instance, so a soft limit. Synchronous, so requests sent together can't all pass it.
export function createRunLimiter(maxRuns: number, windowMs: number) {
  const recent = new Map<string, number[]>();
  return (visitor: string, now = Date.now()) => {
    const runs = (recent.get(visitor) ?? []).filter((at) => now - at < windowMs);
    const allowed = runs.length < maxRuns;
    recent.set(visitor, allowed ? [...runs, now] : runs);
    return allowed;
  };
}

export function createApi({ hosted }: { hosted: boolean }) {
  const address = createPayer().address;
  const chain = createPublicClient({ transport: http(config.rpcUrl) });
  const maxEntities = hosted ? HOSTED_MAX_ENTITIES : LOCAL_MAX_ENTITIES;
  const usdcBalance = () => chain.readContract({ address: config.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] });

  // The hard limit is what the demo wallet holds.
  const underLimit = createRunLimiter(HOSTED_RUNS_PER_WINDOW, HOSTED_WINDOW_MS);
  const allowPaidRun = async (req: IncomingMessage) => {
    if (!hosted) return;
    const ip = String(req.headers["x-forwarded-for"] ?? "unknown").split(",")[0];
    if (!underLimit(ip)) throw new Refused(`Limit reached: ${HOSTED_RUNS_PER_WINDOW} paid runs per 10 minutes. Nothing bought. Try again later, or run it yourself from the repository.`);
    if ((await usdcBalance()) < HOSTED_MIN_USDC) throw new Refused("The demo wallet is out of test USDC. Nothing bought. Run it yourself from the repository with a free wallet.");
  };

  // Hosted: drafts can hold what someone typed, so they leave with the response and nothing stays on disk.
  const readAndClear = (dir: string, names: string[]) => {
    const files = names.map((name) => readFileSync(`${dir}/${name}`, "utf8"));
    if (hosted) rmSync(dir, { recursive: true, force: true });
    return { dir: hosted ? null : dir, files };
  };

  const routes: Record<string, (req: IncomingMessage) => Promise<unknown>> = {
    "GET /api/wallet": async () => ({
      address,
      hosted,
      maxEntities,
      usdc: formatUnits(await usdcBalance(), 6),
      escrow: formatUnits(await escrowBalance(address), 6),
      network: config.network,
      explorerTxUrl: config.explorerTxUrl,
    }),

    "POST /api/diligence": async (req) => {
      const names: string[] = ((await readJson(req)).names ?? []).map((n: unknown) => String(n).trim()).filter(Boolean);
      if (!names.length) throw new BadRequest("Add at least one name");
      if (names.length > maxEntities) throw new BadRequest(`At most ${maxEntities} names per run`);
      if (names.some((n) => !n.replace(/^(person|company):/, "").trim() || n.length > MAX_NAME_LENGTH)) throw new BadRequest(`Each name must be 1 to ${MAX_NAME_LENGTH} characters`);
      await allowPaidRun(req);
      const { dir, entities } = await buildPack(createPayer(), names);
      const items = entities.flatMap((e) => e.items);
      const saved = readAndClear(dir, ["pack.md"]);
      return { dir: saved.dir, entities, spent: settled(items).toString(), chargedWithoutAmount: chargedWithoutAmount(items), markdown: saved.files[0] };
    },

    // Free: the refund rule only, nothing bought.
    "POST /api/flight/check": async (req) => ({ assessment: assess(tripFrom(await readJson(req))) }),

    "POST /api/flight/claim": async (req) => {
      const trip = tripFrom(await readJson(req));
      const assessment = assess(trip);
      if (!assessment.eligible) throw new BadRequest(`${assessment.reason} Nothing bought.`);
      await allowPaidRun(req);
      const { dir, items } = await draftClaim(createPayer(), trip, assessment);
      const saved = readAndClear(dir, ["claim.eml", "claim.md"]);
      return { dir: saved.dir, assessment, items, spent: settled(items).toString(), chargedWithoutAmount: chargedWithoutAmount(items), email: saved.files[0], report: saved.files[1] };
    },
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    const route = routes[`${req.method} ${req.url?.split("?")[0]}`];
    if (!route) return send(res, 404, { error: "Not found" });
    try {
      send(res, 200, await route(req));
    } catch (err) {
      const status = err instanceof BadRequest ? 400 : err instanceof Refused ? 429 : 500;
      send(res, status, { error: (err as Error).message });
    }
  };
}
