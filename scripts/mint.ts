// Mints free test USDC to the wallet. On the Telegraph V2 testnet anyone can mint it; the wallet needs Sepolia ETH for gas.
// Usage: npm run mint [-- 20]   (USDC, default 10)
import { createPublicClient, createWalletClient, formatUnits, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config, privateKey } from "../src/config.ts";

const amount = parseUnits(process.argv[2] ?? "10", 6);
const account = privateKeyToAccount(privateKey());
const abi = parseAbi(["function mint(address to, uint256 amount)", "function balanceOf(address) view returns (uint256)"]);
const transport = http(config.rpcUrl);
const chain = { ...sepolia, id: config.chainId };

const hash = await createWalletClient({ account, chain, transport }).writeContract({ address: config.usdc, abi, functionName: "mint", args: [account.address, amount] });
const client = createPublicClient({ chain, transport });
await client.waitForTransactionReceipt({ hash });
const balance = await client.readContract({ address: config.usdc, abi, functionName: "balanceOf", args: [account.address] });
console.log(`Minted ${formatUnits(amount, 6)} USDC: ${config.explorerTxUrl}${hash}\nBalance: ${formatUnits(balance, 6)} USDC`);
