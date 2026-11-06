# Contributing

I try to reply to issues within a few days.

## Setup

You need Node 20 or newer.

```bash
git clone https://github.com/jayhemnani9910/telegraph-receipts-desk.git
cd telegraph-receipts-desk
npm install
cp .env.example .env
```

## Tests

```bash
npm run typecheck
npm test
```

Neither needs a wallet or network. The tests use a throwaway wallet and fail any network call, so they can't spend anything. CI runs both on every push and pull request.

To try a change against live data for free, use `npm run probe -- --dry` or `npm run rankings`. Anything that buys an answer needs a test wallet, see the [quickstart](README.md#run-it-yourself).

## Style

There is no linter or formatter. Match the code around your change: small functions, a short comment when the reason isn't obvious, no new dependency unless it's needed. If you fix a wrong answer from a miner or a parsing bug, add a test with the real input.

Never commit `.env`, or anything from `data/`. Both can hold a private key or a passenger's details.

## Branches and pull requests

Branch from `main` and open the pull request against `main`. Keep it to one change, say how you tested it, and make sure `npm run typecheck` and `npm test` pass.

## Bug reports

Use the [bug report template](https://github.com/jayhemnani9910/telegraph-receipts-desk/issues/new?template=bug_report.md). Include the command, what you expected, what happened, your Node version and OS. Remove your private key and personal details from anything you paste.
