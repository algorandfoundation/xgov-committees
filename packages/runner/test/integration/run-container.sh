#!/usr/bin/env bash

# Called from integration.test.ts.
# Builds a privileged systemd+Node.js container, starts it with systemd as PID 1,
# and verifies runner.service is triggered by the timer on boot, sends READY=1, and exits cleanly.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE="xgov-runner-integration"
CONTAINER="xgov-runner-integration-$$"

# Dump service logs and status — always called on exit for debugging.
dump_service_logs() {
  echo "=== systemctl status ==="
  docker exec "$CONTAINER" systemctl status runner.service --no-pager 2>&1 || true
  echo "=== journalctl ==="
  docker exec "$CONTAINER" journalctl -u runner.service --no-pager 2>&1 || true
  echo "===================="
}

cleanup() {
  dump_service_logs
  docker rm -f "$CONTAINER" 2>/dev/null || true
}
trap cleanup EXIT

docker build --target integration -t "$IMAGE" \
  -f "$SCRIPT_DIR/../Dockerfile" \
  "$RUNNER_DIR" 2>&1

docker run -d \
  --name "$CONTAINER" \
  --privileged \
  --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  "$IMAGE" \
  /sbin/init

# Wait for systemd to be ready (up to 30s).
echo "Waiting for systemd..."
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" systemctl is-system-running 2>/dev/null | grep -qE "^(running|degraded)$"; then
    echo "systemd ready"
    break
  fi
  [ "$i" -eq 30 ] && { echo "Timeout waiting for systemd"; exit 1; }
  sleep 1
done

# OnBootSec=0: the timer fires immediately on boot. Poll until the service completes (up to 30s).
echo "Waiting for runner.service to complete..."
for i in $(seq 1 30); do
  result=$(docker exec "$CONTAINER" systemctl show -p Result runner.service 2>/dev/null | cut -d= -f2)
  if [ "$result" = "success" ] || [ "$result" = "failed" ]; then break; fi
  [ "$i" -eq 30 ] && { echo "Timeout waiting for runner.service to complete"; exit 1; }
  sleep 1
done

# Verify: service result must be success.
result=$(docker exec "$CONTAINER" systemctl show -p Result runner.service | cut -d= -f2)
if [ "$result" != "success" ]; then
  echo "FAIL: service Result='$result' (expected 'success')"
  exit 1
fi

# Verify: expected log banner is present.
if ! docker exec "$CONTAINER" journalctl -u runner.service --no-pager 2>&1 | grep -q "Runner started successfully"; then
  echo "FAIL: expected log line not found"
  exit 1
fi

echo "Integration test passed."
