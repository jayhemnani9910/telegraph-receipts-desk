// The same checks as the page, as MCP tools any agent can call: POST /api/mcp (Streamable HTTP, stateless).
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Assessment } from "../apps/flight-claim/trip.ts";

type Core = {
  diligence: (names: unknown, req: IncomingMessage) => Promise<{ entities: unknown[]; spent: string; markdown: string }>;
  flightCheck: (trip: unknown) => Assessment;
  ledger: () => Promise<unknown>;
  // The message to show for a refusal or bad input; null for anything unexpected.
  describeError: (err: unknown) => string | null;
};

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const run = async (work: () => Promise<{ content: { type: "text"; text: string }[] }>, describeError: Core["describeError"]) => {
  try {
    return await work();
  } catch (err) {
    return { ...text(describeError(err) ?? "The check failed on the server. Nothing more was bought. Try again later."), isError: true };
  }
};

export function buildServer(core: Core, req: IncomingMessage) {
  const server = new McpServer({ name: "receipts-desk", version: "0.3.0" });

  server.registerTool(
    "diligence_pack",
    {
      title: "Diligence pack",
      description:
        "Screens companies and people. Each check is bought from a Telegraph miner for $0.01 in test USDC (paid by the demo wallet, Ethereum Sepolia) and compared with the official source: OFAC, UN, EU and UK sanctions lists, GLEIF and SEC EDGAR. Returns a Markdown pack with each finding, whether the miner agreed, the cost and the on-chain receipt. Up to 3 names per call, 5 paid runs per 10 minutes. Names are sent to Telegraph miners, so don't send private data. Not legal advice.",
      inputSchema: {
        names: z
          .array(z.string())
          .min(1)
          .describe('Exact legal names of companies, or "person:Full Name" for people, e.g. ["Tesla, Inc.", "person:Vladimir Putin"]'),
      },
    },
    ({ names }) => run(async () => text((await core.diligence(names, req)).markdown), core.describeError),
  );

  server.registerTool(
    "flight_refund_eligibility",
    {
      title: "US flight refund eligibility",
      description:
        "Free, nothing is bought. Checks a US flight change against the DOT refund rule (14 CFR Part 260): a refund is due when the airline cancels or moves the flight by 3 hours or more (domestic) or 6 hours or more (international) and the passenger did not travel. No personal details needed.",
      inputSchema: {
        from: z.string().describe("Departure airport, 3-letter code, e.g. LAS"),
        to: z.string().describe("Arrival airport, 3-letter code, e.g. JFK"),
        scheduledDeparture: z.string().describe("ISO 8601 with offset, e.g. 2026-10-23T08:00:00-07:00"),
        revisedDeparture: z.string().optional(),
        scheduledArrival: z.string().optional(),
        revisedArrival: z.string().optional(),
        international: z.boolean().default(false),
        cancelled: z.boolean().default(false),
        traveled: z.boolean().default(false).describe("True if the passenger took the changed flight"),
      },
    },
    (input) =>
      run(async () => {
        // The rule needs none of the claim's personal fields; placeholders let the same check run.
        const placeholders = { passenger: "-", email: "-", airline: "-", airlineEmail: "-", flight: "-", booking: "-", fare: "0", currency: "USD" };
        const a = core.flightCheck({ ...placeholders, ...input });
        return text(`${a.eligible ? "Eligible" : "Not eligible"}. ${a.reason}`);
      }, core.describeError),
  );

  server.registerTool(
    "public_ledger",
    {
      title: "Public ledger",
      description: "Free. Every payment the demo wallet made to Telegraph, read from the public block explorer and grouped into runs.",
      inputSchema: {},
    },
    () => run(async () => text(JSON.stringify(await core.ledger(), null, 2)), core.describeError),
  );

  return server;
}

export function createMcpHandler(core: Core) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST", "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Use POST with an MCP client" }));
    }
    // Stateless: a fresh server and transport per request, so it works on serverless.
    const server = buildServer(core, req);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };
}
