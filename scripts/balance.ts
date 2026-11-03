import { createPublicClient, http, erc20Abi, formatEther, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config, privateKey } from "../src/config.ts";
import { escrowBalance } from "../src/telegraph.ts";

const address = privateKeyToAccount(privateKey()).address;
const client = createPublicClient({ transport: http(config.rpcUrl) });
const [eth, usdc, escrow] = await Promise.all([
  client.getBalance({ address }),
  client.readContract({ address: config.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  escrowBalance(address),
]);
console.log(`${address}\nETH  ${formatEther(eth)}\nUSDC ${formatUnits(usdc, 6)}  (~${Number(usdc) / 10000} calls at $0.01)\nEscrow ${formatUnits(escrow, 6)}  (failed calls stay here; delivered calls are charged at the next epoch close)`);
