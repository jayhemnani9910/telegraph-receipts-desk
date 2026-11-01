// Everything network-specific lives here, so moving to mainnet is a .env change, not a code change.
try {
  process.loadEnvFile();
} catch {
  // no .env yet; defaults below still let free discovery calls work
}

const env = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (value === undefined) throw new Error(`Missing env var ${key} (see .env.example)`);
  return value;
};

export const config = {
  nodeUrl: env("TELEGRAPH_NODE_URL", "https://devnode.telegraphprotocol.com"),
  rpcUrl: env("RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
  chainId: Number(env("CHAIN_ID", "11155111")),
  network: env("X402_NETWORK", "eip155:11155111") as `${string}:${string}`,
  usdc: env("USDC_ADDRESS", "0xcc194e1a843B658526D0D5C431f670028582Ae17") as `0x${string}`,
  diamond: env("DIAMOND_ADDRESS", "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b") as `0x${string}`,
  explorerTxUrl: env("EXPLORER_TX_URL", "https://sepolia.etherscan.io/tx/"),
  // Spend controls, in micro-USDC (6 decimals): 10000 = $0.01
  maxPerCallUusdc: BigInt(env("MAX_PER_CALL_UUSDC", "50000")),
  maxPerRunUusdc: BigInt(env("MAX_PER_RUN_UUSDC", "1000000")),
  // SEC asks automated clients to identify themselves: "name contact-email"
  secUserAgent: env("SEC_USER_AGENT", "receipts-desk research contact@example.com"),
};

export const privateKey = () => env("PRIVATE_KEY") as `0x${string}`;
