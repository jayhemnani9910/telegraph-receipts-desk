// Local web page for both apps. It pays from the wallet in .env, so it listens on 127.0.0.1 only.
// Usage: npm run web   then open http://localhost:3402
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { config } from "../src/config.ts";
import { createPayer } from "../src/telegraph.ts";
import { createApi, send } from "./api.ts";

const PORT = Number(process.env.PORT ?? 3402);
const api = createApi({ hosted: false });

const server = createServer(async (req, res) => {
  // Refuse other host names, so a site that rebinds its DNS to 127.0.0.1 cannot reach this.
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? "")) return send(res, 403, { error: "Local use only" });
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(readFileSync(new URL("index.html", import.meta.url)));
  }
  await api(req, res);
});

server.listen(PORT, "127.0.0.1", () => console.log(`Open http://localhost:${PORT}  (paying from ${createPayer().address} on ${config.network})`));
