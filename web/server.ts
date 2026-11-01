// Local web page for both apps. It pays from the wallet in .env, so it listens on 127.0.0.1 only.
// Usage: npm run web   then open http://localhost:3402
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { config } from "../src/config.ts";
import { createPayer } from "../src/telegraph.ts";
import { chargedWithoutAmount, settled } from "../src/evidence.ts";
import { buildPack } from "../apps/legal/pack.ts";
import { assess, draftClaim, validTrip, type Trip } from "../apps/flight-claim/trip.ts";

const PORT = Number(process.env.PORT ?? 3402);
const MAX_ENTITIES = 5;
const address = createPayer().address;
const chain = createPublicClient({ transport: http(config.rpcUrl) });

class BadRequest extends Error {}

const send = (res: ServerResponse, status: number, body: unknown) => {
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

const routes: Record<string, (req: IncomingMessage) => Promise<unknown>> = {
  "GET /api/wallet": async () => {
    const usdc = await chain.readContract({ address: config.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] });
    return { address, usdc: formatUnits(usdc, 6), network: config.network, explorerTxUrl: config.explorerTxUrl };
  },

  "POST /api/diligence": async (req) => {
    const names: string[] = ((await readJson(req)).names ?? []).map((n: unknown) => String(n).trim()).filter(Boolean);
    if (!names.length) throw new BadRequest("Add at least one name");
    if (names.length > MAX_ENTITIES) throw new BadRequest(`At most ${MAX_ENTITIES} names per run`);
    const payer = createPayer();
    const { dir, entities } = await buildPack(payer, names);
    const items = entities.flatMap((e) => e.items);
    return { dir, entities, spent: settled(items).toString(), chargedWithoutAmount: chargedWithoutAmount(items), markdown: readFileSync(`${dir}/pack.md`, "utf8") };
  },

  // Free: the refund rule only, nothing bought.
  "POST /api/flight/check": async (req) => ({ assessment: assess(tripFrom(await readJson(req))) }),

  "POST /api/flight/claim": async (req) => {
    const trip = tripFrom(await readJson(req));
    const assessment = assess(trip);
    if (!assessment.eligible) throw new BadRequest(`${assessment.reason} Nothing bought.`);
    const payer = createPayer();
    const { dir, items } = await draftClaim(payer, trip, assessment);
    return {
      dir,
      assessment,
      items,
      spent: settled(items).toString(),
      chargedWithoutAmount: chargedWithoutAmount(items),
      email: readFileSync(`${dir}/claim.eml`, "utf8"),
      report: readFileSync(`${dir}/claim.md`, "utf8"),
    };
  },
};

const server = createServer(async (req, res) => {
  // Refuse other host names, so a site that rebinds its DNS to 127.0.0.1 cannot reach this.
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? "")) return send(res, 403, { error: "Local use only" });
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(readFileSync(new URL("index.html", import.meta.url)));
  }
  const route = routes[`${req.method} ${req.url}`];
  if (!route) return send(res, 404, { error: "Not found" });
  try {
    send(res, 200, await route(req));
  } catch (err) {
    send(res, err instanceof BadRequest ? 400 : 500, { error: (err as Error).message });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}  (paying from ${address} on ${config.network})`));
