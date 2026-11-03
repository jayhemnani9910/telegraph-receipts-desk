// Free: for each Intent the probe covers, show supply, operators and the current top-ranked miners.
import { listMiners } from "../src/telegraph.ts";
import { fixtures } from "../probe/fixtures.ts";

const intents = [...new Set(fixtures.map((f) => f.intent))];
const miners: any[] = await listMiners();
// V2 names Intents within a family: FX_NOW covers FX_NOW_EUR, FX_NOW_CAD and so on.
const inFamily = (id: string, family: string) => id === family || id.startsWith(`${family}_`);

for (const intent of intents) {
  const serving = miners.filter((m) => m.supported_intents?.some((id: string) => inFamily(id, intent)));
  const operators = new Set(serving.map((m) => m.wallet_address)).size;
  const ranked = serving
    .flatMap((m) => (m.scores ?? []).filter((s: any) => inFamily(s.intent_id, intent)).map((s: any) => ({ ...s, slug: m.slug, id: m.id })))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((s) => `#${s.rank} ${s.slug}(${s.id}) ${Number(s.score).toFixed(2)}`);
  console.log(`${intent.padEnd(28)} miners ${String(serving.length).padStart(3)}  operators ${String(operators).padStart(2)}  ${ranked.join("  ")}`);
}
