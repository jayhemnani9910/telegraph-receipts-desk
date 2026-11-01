// Markdown diligence pack: findings from primary sources, what the network said, and what each item cost.
import { config } from "../../src/config.ts";
import { cost, txUrl, usd, type Item } from "../../src/evidence.ts";
import type { EntityPack } from "./pack.ts";

const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const tx = (item: Item) => (txUrl(item) ? `[tx](${txUrl(item)})` : "none");

export function renderPack(generatedAt: string, payer: string, entities: EntityPack[]): string {
  const items = entities.flatMap((e) => e.items.map((item) => ({ entity: e.name, item })));
  const total = items.reduce((s, { item }) => s + BigInt(item.network.amountUusdc ?? 0), 0n);
  const contradicted = items.filter(({ item }) => item.agreement === "contradicted");
  // Every failed call that was still charged: the final answer and any earlier attempt on another miner.
  const failedButCharged = items.flatMap(({ entity, item }) => [
    ...item.failedAttempts.filter((f) => f.charged).map((f) => ({ entity, check: item.check, miner: f.miner, status: f.status, txHash: f.txHash })),
    ...(item.network.status !== 200 && item.network.charged
      ? [{ entity, check: item.check, miner: item.network.miner ?? "routed", status: item.network.status, txHash: item.network.txHash }]
      : []),
  ]);

  const out = [
    `# Diligence pack`,
    ``,
    `Generated ${generatedAt} by wallet \`${payer}\` on ${config.network} (testnet USDC).`,
    `Each finding is taken from the primary source named beside it. The Telegraph answer bought for the same check is shown with its receipt, and marked confirmed, contradicted or unconfirmed against that source.`,
    ``,
    `**${entities.length} entities, ${items.length} paid checks, ${usd(total)} total.** ${contradicted.length} network answers contradicted the primary source; ${failedButCharged.length} failed calls were still charged.`,
  ];

  for (const entity of entities) {
    out.push(``, `## ${entity.name} (${entity.kind})`, ``);
    out.push(`| Check | Finding | Source, as of | Network answer | Cost | Proof |`, `|---|---|---|---|---|---|`);
    for (const item of entity.items) {
      const said = item.network.status === 200 ? `${item.agreement} (${item.network.miner})` : `${item.agreement}: HTTP ${item.network.status}`;
      out.push(
        `| ${cell(item.check)} | ${cell(item.finding)} | ${cell(item.primary.source)}, ${item.primary.asOf} | ${cell(said)} | ${cost(item)} | ${tx(item)} |`,
      );
    }
    out.push(``, ...entity.items.map((item) => `- ${item.check}: ${item.limits}`));
  }

  out.push(``, `## Invoice`, ``, `| # | Entity | Intent | Miner | Bought at | Receipt | Cost |`, `|---|---|---|---|---|---|---|`);
  items.forEach(({ entity, item }, i) =>
    out.push(
      `| ${i + 1} | ${cell(entity)} | ${item.intent} | ${cell(item.network.miner ?? "-")} | ${item.network.at} | \`${item.network.receiptHash ?? "none"}\` | ${cost(item)} |`,
    ),
  );
  out.push(`| | | | | | **Total** | **${usd(total)}** |`);

  if (contradicted.length || failedButCharged.length) {
    out.push(``, `## Network issues found`, ``);
    for (const { entity, item } of contradicted) out.push(`- ${entity}, ${item.check}: ${item.network.miner} answered \`${cell(JSON.stringify(item.network.answer).slice(0, 200))}\`, which disagrees with the primary source.`);
    for (const f of failedButCharged) {
      out.push(`- ${f.entity}, ${f.check} (miner ${f.miner}): HTTP ${f.status} but payment settled (${f.txHash ? `[tx](${config.explorerTxUrl}${f.txHash})` : "no tx hash"}).`);
    }
  }

  out.push(``, `Machine-generated research for review, not legal advice. Verify the ledger against the chain with \`npm run reconcile\`.`, ``);
  return out.join("\n");
}
