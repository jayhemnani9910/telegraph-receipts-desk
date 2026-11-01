// Overnight diligence pack: buys sanctions, registry and filing answers through Telegraph,
// checks each against the primary source, and writes a pack with per-item cost and receipts.
// Usage: npm run diligence -- "Apple Inc." "Tesla, Inc." "person:Vladimir Putin"
import { config } from "../../src/config.ts";
import { createPayer } from "../../src/telegraph.ts";
import { spentNote } from "../../src/evidence.ts";
import { buildPack } from "./pack.ts";

const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!names.length) {
  console.error('Usage: npm run diligence -- "Apple Inc." "person:Vladimir Putin"');
  process.exit(1);
}

const payer = createPayer();
console.log(`Paying from ${payer.address} on ${config.network}, budget ${config.maxPerRunUusdc} uUSDC\n`);
const { dir, entities } = await buildPack(payer, names);
for (const pack of entities) {
  for (const item of pack.items) {
    console.log(`${pack.name.padEnd(24)} ${item.check.padEnd(32)} ${item.agreement.padEnd(15)} ${item.finding.slice(0, 70)}`);
  }
}
console.log(`\n${spentNote(entities.flatMap((e) => e.items))} Pack: ${dir}/pack.md`);
