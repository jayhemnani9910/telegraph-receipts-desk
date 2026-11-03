// Free: match every USDC transfer out of the wallet on-chain against the ledger.
// Flags money that left with no receipt, and receipts whose transfer is not on-chain (yet).
// With --wallet, lists any wallet's payments to Telegraph instead (no key or ledger needed), to check against your own logs.
// Usage: npm run reconcile [-- --hours=1]   |   npm run reconcile -- --wallet=0x... [--hours=24]
import { createPublicClient, http, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits } from "viem";
import { config, privateKey } from "../src/config.ts";
import { escrowBalance } from "../src/telegraph.ts";
import { readLedger } from "../src/ledger.ts";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const hours = Number(arg("hours") ?? 1);
const otherWallet = arg("wallet") as `0x${string}` | undefined;
const address = otherWallet ?? privateKeyToAccount(privateKey()).address;
const client = createPublicClient({ transport: http(config.rpcUrl) });

const latest = await client.getBlock();
const since = Number(latest.timestamp) - hours * 3600;

// First block at or after `since`. Block times change, so search instead of estimating;
// the lower bound assumes at most 10 blocks a second and stays clear of pruned history.
let lo = latest.number - BigInt(hours * 36000);
let hi = latest.number;
while (lo < hi) {
  const mid = (lo + hi) / 2n;
  if (Number((await client.getBlock({ blockNumber: mid })).timestamp) < since) lo = mid + 1n;
  else hi = mid;
}

// The public RPC allows 200 blocks per eth_getLogs call; run 10 at a time.
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ranges: [bigint, bigint][] = [];
for (let from = lo; from <= latest.number; from += 200n) ranges.push([from, from + 199n < latest.number ? from + 199n : latest.number]);
const onchain: { tx: string; to: string; value: bigint; block: bigint }[] = [];
for (let i = 0; i < ranges.length; i += 10) {
  const batches = await Promise.all(
    ranges.slice(i, i + 10).map(([fromBlock, toBlock]) =>
      client.getLogs({ address: config.usdc, event: transfer, args: { from: address }, fromBlock, toBlock }),
    ),
  );
  onchain.push(...batches.flat().map((l) => ({ tx: l.transactionHash, to: l.args.to!, value: l.args.value!, block: l.blockNumber })));
}

if (otherWallet) {
  // x402 payments are USDC transfers to the Diamond.
  const paid = onchain.filter((t) => t.to.toLowerCase() === config.diamond.toLowerCase());
  console.log(`Last ${hours}h  wallet ${address}: ${paid.length} payments to Telegraph, ${paid.reduce((s, t) => s + t.value, 0n)} uUSDC`);
  for (const t of paid) {
    const { timestamp } = await client.getBlock({ blockNumber: t.block });
    console.log(`${new Date(Number(timestamp) * 1000).toISOString()}  ${t.value} uUSDC  ${config.explorerTxUrl}${t.tx}`);
  }
  console.log(`Escrow balance ${formatUnits(await escrowBalance(address), 6)} USDC. x402 payments land there: delivered calls are charged at the next epoch close, failed ones stay.`);
  process.exit(0);
}

const ledger = readLedger().filter((e) => Date.parse(e.at) / 1000 >= since);
const ledgerTx = new Set(ledger.map((e) => e.tx_hash).filter(Boolean));
const chainTx = new Set(onchain.map((t) => t.tx));

const unreceipted = onchain.filter((t) => !ledgerTx.has(t.tx));
const unsettled = ledger.filter((e) => e.paid && e.tx_hash && !chainTx.has(e.tx_hash));
const chargedOnFailure = ledger.filter((e) => e.status !== 200 && e.paid);
const total = onchain.reduce((s, t) => s + t.value, 0n);

console.log(`Last ${hours}h  wallet ${address}`);
console.log(`on-chain transfers ${onchain.length} (${total} uUSDC)  ledger calls ${ledger.length}  matched ${onchain.length - unreceipted.length}`);
for (const t of unreceipted) console.log(`NO RECEIPT   ${t.value} uUSDC to ${t.to}  ${config.explorerTxUrl}${t.tx}`);
for (const e of unsettled) console.log(`NOT ON-CHAIN ${e.label}  ${e.receipt_hash}  ${e.tx_hash}`);
for (const e of chargedOnFailure) console.log(`PAID ON ERROR ${e.status} ${e.label}  ${config.explorerTxUrl}${e.tx_hash}`);
if (!unreceipted.length && !unsettled.length && !chargedOnFailure.length) console.log("All transfers match the ledger.");
console.log(`Escrow balance ${formatUnits(await escrowBalance(address), 6)} USDC (failed calls stay there; recent delivered calls until the next epoch close).`);
