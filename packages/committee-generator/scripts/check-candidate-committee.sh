#!/usr/bin/env bash
set -euo pipefail

ENV=../.env

run() {
  local start=$1
  local end=$2

  echo "========================================"
  echo "Comparing ${start} -> ${end}"
  echo "========================================"

  ENV=$ENV pnpm exec tsx compare-candidate-committee.ts "$start" "$end"

  echo ""
}

run 50000000 53000000
run 51000000 54000000
run 52000000 55000000
run 53000000 56000000
run 54000000 57000000
run 55000000 58000000
run 56000000 59000000

echo "✅ All comparisons completed"