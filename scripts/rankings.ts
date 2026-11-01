// Free: for each Intent the probe covers, show supply, operators and the current top-ranked miners.
import { listMiners } from "../src/telegraph.ts";
import { fixtures } from "../probe/fixtures.ts";

const intents = [...new Set(fixtures.map((f) => f.intent))];
const miners: any[] = await listMiners();

for (const intent of intents) {
  const serving = miners.filter((m) => m.supported_intents?.includes(intent));
  const operators = new Set(serving.map((m) => m.wallet_address)).size;
  const ranked = serving
    .flatMap((m) => (m.scores ?? []).filter((s: any) => s.intent_id === intent).map((s: any) => ({ ...s, slug: m.slug, id: m.id })))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((s) => `#${s.rank} ${s.slug}(${s.id}) ${Number(s.score).toFixed(2)}`);
  console.log(`${intent.padEnd(28)} miners ${String(serving.length).padStart(3)}  operators ${String(operators).padStart(2)}  ${ranked.join("  ")}`);
}
