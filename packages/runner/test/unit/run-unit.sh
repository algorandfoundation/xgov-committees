#!/usr/bin/env bash

# Called by `pnpm run test:unit`.
# On Linux: runs vitest natively (unix_dgram + systemd-analyze are available).
# Elsewhere: builds a Linux+Node container and runs vitest inside it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE_ROOT="$(cd "$RUNNER_DIR/../.." && pwd)"

if [ "$(uname)" = "Linux" ]; then
  cd "$RUNNER_DIR"
  exec node_modules/.bin/vitest run test/unit
else
  IMAGE="xgov-runner-test"
  docker build --target unit-test -t "$IMAGE" -f "$RUNNER_DIR/test/Dockerfile" "$WORKSPACE_ROOT"
  docker run --rm "$IMAGE"
fi
