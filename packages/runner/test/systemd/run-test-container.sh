#!/usr/bin/env bash

# Builds a privileged systemd+Node.js container, starts it with systemd as PID 1,
# and runs the requested test scenario.
#
# Usage: run-test-container.sh [boot|stop|failure]

set -euo pipefail

TEST_SCENARIO="${1:-boot}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
IMAGE="xgov-runner-systemd-test"
CONTAINER="xgov-runner-systemd-test-$$"

# ── Helpers ───────────────────────────────────────────────────────────────────

exec_container() { docker exec "$CONTAINER" "$@"; }

# Poll a systemd property until it matches one of the expected values.
# Usage: wait_for PROPERTY "val1|val2" [TIMEOUT=30]
wait_for() {
  local prop=$1 expected=$2 timeout=${3:-30}
  echo "Waiting for $prop to be $expected..."
  for i in $(seq 1 "$timeout"); do
    local val
    val=$(exec_container systemctl show -p "$prop" runner.service 2>/dev/null | cut -d= -f2)
    if echo "$val" | grep -qE "^($expected)$"; then return 0; fi
    [ "$i" -eq "$timeout" ] && { echo "Timeout waiting for $prop=$expected (got '$val')"; exit 1; }
    sleep 1
  done
}

assert_result() {
  local result
  result=$(exec_container systemctl show -p Result runner.service | cut -d= -f2)
  if [ "$result" != "success" ]; then
    echo "FAIL: service Result='$result' (expected 'success')"
    exit 1
  fi
}

assert_failed() {
  local result
  result=$(exec_container systemctl show -p Result runner.service | cut -d= -f2)
  if [ "$result" = "success" ]; then
    echo "FAIL: service Result='$result' (expected a failure result)"
    exit 1
  fi
}

assert_log() {
  if ! exec_container journalctl -u runner.service --no-pager 2>&1 | grep -q "$1"; then
    echo "FAIL: expected log line '$1' not found"
    exit 1
  fi
}

dump_service_logs() {
  echo "=== systemctl status ==="
  exec_container systemctl status runner.service --no-pager 2>&1 || true
  echo "=== journalctl ==="
  exec_container journalctl -u runner.service --no-pager 2>&1 || true
  echo "===================="
}

cleanup() {
  dump_service_logs
  docker rm -f "$CONTAINER" 2>/dev/null || true
}
trap cleanup EXIT

# ── Container setup ───────────────────────────────────────────────────────────

docker build --target systemd-integration -t "$IMAGE" \
  -f "$SCRIPT_DIR/../Dockerfile" \
  "$WORKSPACE_ROOT" 2>&1

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
  if exec_container systemctl is-system-running 2>/dev/null | grep -qE "^(running|degraded)$"; then
    echo "systemd ready"
    break
  fi
  [ "$i" -eq 30 ] && { echo "Timeout waiting for systemd"; exit 1; }
  sleep 1
done

# ── Test scenarios ────────────────────────────────────────────────────────────

case "$TEST_SCENARIO" in
  boot)
    exec_container systemctl start runner.timer
    wait_for Result "success|failed" 30
    assert_result
    assert_log "Runner started successfully"
    echo "Boot test passed."
    ;;

  stop)
    # Override generator with the long-running graceful-exit fixture.
    exec_container mkdir -p /etc/systemd/system/runner.service.d
    exec_container sh -c \
      'printf "[Service]\nEnvironment=COMMITTEE_GENERATOR_PATH=/opt/xgov-committees/packages/committee-generator/dist/generator-graceful-exit.mjs\n" > /etc/systemd/system/runner.service.d/override.conf'
    exec_container systemctl daemon-reload

    exec_container systemctl start runner.service
    wait_for ActiveState active 15
    exec_container systemctl stop runner.service
    wait_for ActiveState "inactive|failed" 30
    assert_result
    assert_log "Shutting down (SIGTERM)"
    echo "Stop test passed."
    ;;

  failure)
    # Override generator with the fatal fixture to force the service to fail.
    exec_container mkdir -p /etc/systemd/system/runner.service.d
    exec_container sh -c \
      'printf "[Service]\nEnvironment=COMMITTEE_GENERATOR_PATH=/opt/xgov-committees/packages/committee-generator/dist/generator-fatal.js\nEnvironmentFile=-/etc/xgov-committees-runner.env\n" \
      > /etc/systemd/system/runner.service.d/override.conf'

    # Write Slack credentials into the container's env file if provided by the caller.
    # exec_container doesn't support -e; using docker exec directly to avoid shell-escaping the secrets.
    if [ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "${SLACK_CHANNEL_ID:-}" ]; then
      docker exec \
        -e SLACK_BOT_TOKEN="$SLACK_BOT_TOKEN" \
        -e SLACK_CHANNEL_ID="$SLACK_CHANNEL_ID" \
        "$CONTAINER" sh -c \
        'printf "SLACK_BOT_TOKEN=%s\nSLACK_CHANNEL_ID=%s\n" "$SLACK_BOT_TOKEN" "$SLACK_CHANNEL_ID" \
        > /etc/xgov-committees-runner.env'
    fi

    exec_container systemctl daemon-reload

    exec_container systemctl start runner.service || true  # expected to fail; || true prevents set -e from exiting if start itself returns non-zero
    wait_for ActiveState "inactive|failed" 30
    assert_failed

    # ExecStopPost ran notify-slack; assert behaviour based on whether creds were provided.
    if [ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "${SLACK_CHANNEL_ID:-}" ]; then
      assert_log "notify-slack: notification posted"
    else
      assert_log "skipping notification"
    fi

    echo "Failure test passed."
    ;;

  *)
    echo "Usage: $0 [boot|stop|failure]"
    exit 1
    ;;
esac
