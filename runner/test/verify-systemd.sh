#!/usr/bin/env bash

# Called from `systemd.test.ts`. Uses `Dockerfile.systemd`.
# Lint the systemd unit files using systemd-analyze verify inside Docker.
# Catches syntax errors, unknown directives, missing users, and bad ExecStart paths.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="xgov-runner-systemd-verify"

docker build -t "$IMAGE" -f "$SCRIPT_DIR/Dockerfile.systemd" "$SCRIPT_DIR"

docker run --rm \
  -v "$SCRIPT_DIR/../systemd:/units:ro" \
  "$IMAGE" \
  systemd-analyze verify --man=no /units/runner.service /units/runner.timer
