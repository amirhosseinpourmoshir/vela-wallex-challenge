# Vela

A Persian, RTL Wallex spot-trading workspace: Node.js 24, Express, React/TypeScript, Tailwind and native SQLite. One process; no Docker or microservices.

[فارسی](README.md) · [Documentation](docs/README.md)

## Features

- Live quotes, official closed-candle history and incremental deduplication.
- Deterministic local engine `local-multiframe-v1`: multi-timeframe ranking, executable-price economics and risk sizing; **no LLM calls in this decision path**.
- Separate LLM analysis, supervised signals and ranked market selection.
- Per-order confirmation or explicitly authorized bounded automatic sessions.
- Order audit/reconciliation, server-side spot stop/target monitoring, independent backtesting.
- Optional document embeddings for retrieval, not training model weights.

Current challenge policy: **TMN spot only**, no leverage or naked shorts. The organizer's 345 blocked pairs are combined with package restrictions and enabled markets. Availability is discovered, not a permanent hardcoded count.

## Run

Use Node.js 24.18+ from the 24.x line.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:3000. Configure credentials locally before account access. `npm run markets:sync` discovers permitted markets and updates local configuration without placing orders.

```sh
npm test
npm run check
npm run build
```

Set `NODE_ENV=production` before `npm start`. The server binds to `127.0.0.1`; it is not an authenticated public hosting solution.

Local orders use LIMIT at a fresh quote. Native MARKET requests route to LIMIT before submission when exchange metadata disables MARKET. LIMIT may remain unfilled. An active automatic session attempts to cancel rapid LIMIT remainders after 120 seconds. Stop/target monitoring requires an active server and session. Stopping a session does not close positions. Unknown submissions must be reconciled, never blindly retried.

Account databases and operational credentials are excluded from Git. No profitability claim is made. A project-wide license has not been selected; see [third-party notices](THIRD_PARTY_NOTICES.md).
