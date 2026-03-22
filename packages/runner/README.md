# xGov Committees Runner

A systemd service that tracks [ARC-86](https://dev.algorand.co/arc-standards/arc-0086/) governance periods and spawns the committee generator to build block-header caches and compute xGov committees.

Triggered by a systemd timer every 50 minutes. See [systemd/README.md](systemd/README.md) for unit configuration.

## How it works

Per [ARC-86](https://dev.algorand.co/arc-standards/arc-0086/), an xGov Committee is selected from a governance period `(Bi, Bf)` — the block range `[Bi; Bf)` from which xGov voting power is derived. Each xGov's voting power equals the number of blocks they proposed in that range. Consecutive governance periods shift by 1M blocks: `(Bi, Bf)` → `(Bi+1M, Bf+1M)`, with `Bf - Bi = 3M` blocks (the committee selection range).

The runner tracks the last fully processed governance period and warms the cache for the next one. On each invocation the service loop evaluates three ordered cases:

1. **Catch-up** — If the chain is already past `Bf`, process the full `[Bi; Bf)` range immediately. This handles bootstrapping and periods that were missed while the service was offline.
2. **Close to period end** — If the chain is within 900 blocks of `Bf`, wait for it (plus a short buffer), then process the full range.
3. **100K warming** — If a 100K-block boundary has been crossed since the last write-cache call, run the generator over `[Bi; Bf)` with `retryOnTip=false` (tip is expected and accepted silently). This keeps the block-header cache warm so that the final committee calculation at `Bf` is fast.

After each case the loop re-evaluates, so a single invocation can catch up across multiple governance periods and then warm the cache for the current one.

### State file

The runner persists a JSON state file per network/registry pair in `STATE_DIR`:

```json
{
  "lastGovernancePeriod": { "Bi": 56000000, "Bf": 59000000 },
  "lastCacheRound": 59112478,
  "updatedAt": "2026-03-20T12:00:00.000Z"
}
```

- `lastGovernancePeriod` — the last fully processed governance period `(Bi, Bf)`.
- `lastCacheRound` — the last round at which a successful write-cache call was made.

On first run the runner bootstraps from the initial governance period `(50M, 53M)`.

## Quick start

```bash
pnpm install
pnpm run build        # compile to dist/
pnpm run typecheck    # type-check only
pnpm run lint:fix     # lint + auto-fix
pnpm run format       # format code
```

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

All variables have production defaults except Slack credentials, which are **required**.

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

## Deploy

The service expects the full monorepo at `/opt/xgov-committees/`, built from the root with `pnpm install && pnpm run build` (builds both `runner` and `committee-generator`).

**Requirements:**

- Node.js >= 20.19.0 and pnpm on the server
- A dedicated `xgov-committees-runner` system user (the service runs unprivileged)
- A `.env` file at `/opt/xgov-committees/.env` with `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID` (see [Configuration](#configuration)). Must be readable by the service user's group (`root:xgov-committees-runner`, mode `640`)
- A state directory at `/var/lib/xgov-committees-runner` owned by the service user
- The systemd units from `systemd/` installed in `/etc/systemd/system/` — see [systemd/README.md](systemd/README.md) for unit configuration details
