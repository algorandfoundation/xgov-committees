# xGov Committees

Monorepo for automating Algorand [xGov](https://xgov.algorand.co) [committee file](https://arc.algorand.foundation/ARCs/arc-0086#representation) generation. Produces the xGov committee file for each governance period using an archival node, based on block proposer data and subscribed xGovs in the [xGov Registry](https://docs.xgov.algorand.co/specs/xgov-registry).

The committee declaration on the xGov Registry is out of scope of this monorepo and is handled by a cron CI job on [algorandfoundation/xgov-beta-sc](https://github.com/algorandfoundation/xgov-beta-sc) repository.

## Packages

### committee-generator

Fetches block headers from an archival node, aggregates proposer data, and produces ARC-86 committee files. Uploads data to a public S3-like bucket.

See [`packages/committee-generator`](packages/committee-generator/README.md).

### runner

Systemd service that tracks governance periods and automatically drives the committee generator. Handles bootstrapping from an empty bucket, incremental cache warming, and Slack failure notifications.

See [`packages/runner`](packages/runner/README.md).

## Setup

```bash
pnpm install
pnpm run build
pnpm test
```

## Deploy

See [`packages/runner/systemd/DEPLOY.md`](packages/runner/systemd/DEPLOY.md).
