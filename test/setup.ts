// Import first. Tests use a throwaway wallet and folder, and any network call fails, so they can never spend.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "receipts-desk-test-"));
process.env.PRIVATE_KEY = generatePrivateKey();
globalThis.fetch = async (input) => {
  throw new Error(`Network call in a test: ${input}`);
};
