# Changelog

All notable changes to this project are written down here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.3.0] - 2026-11-13

### Added

- One verdict per entity in the diligence pack: HIT, REVIEW or CLEAR, with the reasons.
- Optional birth date for people (`person:Name, dob:1952-10-07`) to rule out namesakes; it is never sent to the network.
- Near-spelling matches (one letter off in a long word) shown for review.
- Parent companies reported to GLEIF are screened against the same sanctions lists.
- A link to the node's own record of every answer (`/engine/v1/signal/<hash>`).
- Public ledger tab and `GET /api/ledger`: every payment the wallet made to Telegraph, read from Blockscout.
- Counterproof Sanctions Screener (miner 731002, another team's) as the backup sanctions miner.
- MCP server at `/api/mcp` with `diligence_pack`, `flight_refund_eligibility` and `public_ledger`. New dependencies: `@modelcontextprotocol/sdk` and `zod`.

## [0.2.0] - 2026-11-07

### Added

- A 2-minute demo video of a real run on the live site: [on X](https://x.com/jeyhemnani9/status/2118799203417854385).

### Changed

- `package.json` declares Node 20.12 or newer, which `process.loadEnvFile` needs; the docs say the same.

### Fixed

- `reconcile` prints one line instead of a stack trace when the RPC has pruned the history it needs, and refuses an `--hours` value that is not a positive number.
- `first-check` refuses anything but a 3-letter airport code before it fetches or buys anything.
- The probe's SEC request uses `SEC_USER_AGENT` from `.env`.

## [0.1.1] - 2026-11-06

### Added

- MIT license.
- Demo GIF, changelog, contributing guide, and issue and pull request templates.

### Changed

- Rewrote the README.
- `.gitignore` now covers every `.env*` file except `.env.example`.

## [0.1.0] - 2026-11-04

### Added

- Diligence pack: buys sanctions, company registry and SEC filing checks through Telegraph and compares them with the official source.
- Flight refund claim: checks a trip against the US DOT refund rule, buys airport disruption checks, compares them with the FAA feed and drafts the email.
- `flight-watch`, spend controls per call and per run, and `reconcile` for matching on-chain payments to the ledger.
- Screening against the UN, EU and UK sanctions lists, as well as OFAC.
- Hosted demo with spending limits, and a commercial summary.
- Quickstart, tutorial and the `first-check` example.
- Escrow balance in `npm run balance` and `npm run reconcile`.
- Tests that need no wallet or network.

### Changed

- Named miners are asked directly before the routed ask, and every charged failure is reported.
- Registry checks ask TxLens first.
- Bad trips and names are refused before anything is bought.
- Failed calls are described the way the x402 docs do.

### Fixed

- Empty V2 fields count as no answer, charged failures count in totals, and routing matches by Intent family.
- Rankings work with V2 Intent families.
- Clear errors when the wallet is missing or has no gas.
- `reconcile` no longer asks for blocks past the RPC head.

[Unreleased]: https://github.com/jayhemnani9910/telegraph-receipts-desk/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/jayhemnani9910/telegraph-receipts-desk/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jayhemnani9910/telegraph-receipts-desk/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/jayhemnani9910/telegraph-receipts-desk/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/jayhemnani9910/telegraph-receipts-desk/releases/tag/v0.1.0
