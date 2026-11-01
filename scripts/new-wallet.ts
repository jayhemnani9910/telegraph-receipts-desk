// Create a fresh testnet burner wallet and write it to .env (never overwrites an existing key).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const current = existsSync(".env") ? readFileSync(".env", "utf8") : readFileSync(".env.example", "utf8");
if (/^PRIVATE_KEY=0x[0-9a-fA-F]{64}/m.test(current)) {
  const key = current.match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)![1] as `0x${string}`;
  console.log(`.env already has a wallet: ${privateKeyToAccount(key).address}`);
  process.exit(0);
}

const key = generatePrivateKey();
const next = /^PRIVATE_KEY=.*$/m.test(current)
  ? current.replace(/^PRIVATE_KEY=.*$/m, `PRIVATE_KEY=${key}`)
  : `${current.trimEnd()}\nPRIVATE_KEY=${key}\n`;
writeFileSync(".env", next, { mode: 0o600 });
console.log(`New testnet wallet: ${privateKeyToAccount(key).address}\nKey saved to .env (gitignored).`);
