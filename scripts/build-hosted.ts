// Builds the hosted demo for Vercel into dist/hosted (Build Output API). That folder holds nothing else, so
// deploying from it can never upload .env or data/.
// Usage: npm run build:hosted, then from dist/hosted: vercel deploy --prebuilt --prod
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const output = "dist/hosted/.vercel/output";
const fn = `${output}/functions/api.func`;
rmSync(output, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });
mkdirSync(`${output}/static`, { recursive: true });

await build({
  entryPoints: ["web/hosted.ts"],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Some dependencies are CommonJS and call require.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});

copyFileSync("web/index.html", `${output}/static/index.html`);
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", maxDuration: 300 }));
writeFileSync(`${output}/config.json`, JSON.stringify({ version: 3, routes: [{ handle: "filesystem" }, { src: "/api/.*", dest: "/api" }] }));
console.log(`Built ${output}`);
