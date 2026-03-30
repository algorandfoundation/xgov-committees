# xGov Committees Runner

A systemd service that tracks [ARC-86](https://dev.algorand.co/arc-standards/arc-0086/) governance periods and spawns the `committee-generator` to build block-header caches, compute xGov committees and upload data to a public bucket.

Triggered by a systemd timer every 50 minutes. See [systemd/README.md](systemd/README.md) for unit configuration.

## How it works

Per ARC-86, an xGov Committee is selected from a governance period `(Bi, Bf)` — the block range `[Bi; Bf)` from which xGov voting power is derived. Each xGov's voting power equals the number of blocks they proposed in that range. Consecutive governance periods shift by 1M blocks: `(Bi, Bf)` → `(Bi+1M, Bf+1M)`, with `Bf - Bi = 3M` blocks (the committee selection range). Once the chain passes `Bf`, the cohort for that period can be computed and a new committee file is generated. Committee file generation is automatically handled by the `committee-generator` once a million round is surpassed.

The runner tracks the last fully processed governance period and warms the cache for the next one. On each invocation the service loop evaluates three ordered cases:

1. **Catch-up**: If the chain is past the last processed end round, process the full 3M block range immediately. This handles bootstrapping and periods that were missed while the service was offline.
2. **Close to period end**: If the chain is within 900 blocks of a million round, wait for it and process the remaining period blocks + committee file generation.
3. **100K warming**: If a 100K-block boundary has been crossed since the last write-cache call, run the `committee-generator` for the current governance period (even if not finished yet), expecting to reach the chain tip and exiting silently (`retryOnTip=false`). This keeps the block-header cache warm so that the final committee calculation at million round is fast.

After each case the loop re-evaluates, so a single invocation can catch up across multiple governance periods and then warm the cache for the current one.

### State file

The runner persists a JSON state file per network/registry pair in `STATE_DIR`:

```json
{
  "lastGovernancePeriod": { "startRound": 56000000, "endRound": 59000000 },
  "lastCacheRound": 59112478,
  "updatedAt": "2026-03-20T12:00:00.000Z"
}
```

- `lastGovernancePeriod`: the last fully processed governance period `(Bi, Bf)`.
- `lastCacheRound`: the last round at which a successful write-cache call was made.

On first run the runner bootstraps from the initial governance period `(50M, 53M)`.

## Quick start

```bash
pnpm install
pnpm run build        # compile to dist/
pnpm run typecheck    # type-check only
pnpm run lint:fix     # lint + auto-fix
pnpm run format       # format code
```

> **Note:** `.prettierrc.json` mirrors the root config except for `printWidth` (120 vs 100) and `singleQuote` (false vs true).

## Testing

```bash
pnpm test                        # unit + integration
pnpm run test:unit               # unit only
pnpm run test:integration        # integration only (needs mainnet algod)
pnpm run test:integration:slack  # integration + live Slack post (needs .env)
pnpm run test:systemd            # systemd lifecycle tests (needs Docker)
pnpm run test:systemd:slack      # systemd failure → live Slack post (needs .env + Docker)
pnpm run test:coverage           # unit + integration with v8 coverage
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for test architecture, coverage details, and sync requirements with `committee-generator`.

## Configuration

All variables have defaults except Slack credentials, which are **required**.

| Variable                   | Default                                                           | Description                      |
| -------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| `SLACK_BOT_TOKEN`          | —                                                                 | **Required.** Slack bot token    |
| `SLACK_CHANNEL_ID`         | —                                                                 | **Required.** Slack channel ID   |
| `ALGOD_SERVER`             | `https://mainnet-api.4160.nodely.dev`                             | Algod server URL                 |
| `ALGOD_PORT`               | `443`                                                             | Algod port                       |
| `ALGOD_TOKEN`              | _(empty)_                                                         | Algod API token                  |
| `REGISTRY_APP_ID`          | `3147789458`                                                      | xGov Registry app ID (mainnet)   |
| `STATE_DIR`                | `/var/lib/xgov-committees-runner`                                 | Directory for runner state files |
| `COMMITTEE_GENERATOR_PATH` | `/opt/xgov-committees/packages/committee-generator/dist/index.js` | Path to committee generator      |

Override via environment variables or an `.env` file at `/opt/xgov-committees/.env` (loaded by the systemd unit).

> For production, use the `.io` variant of the Nodely endpoint (`mainnet-api.4160.nodely.io`) with an API token.

## Deploy

- See [systemd/DEPLOY.md](systemd/DEPLOY.md) for the full deployment playbook (production and test setup).
- See [systemd/README.md](systemd/README.md) for unit configuration details.
