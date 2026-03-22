# Contributing

## Test architecture

Tests are split into three suites:

| Suite           | Location            | Requirements     |
| --------------- | ------------------- | ---------------- |
| **unit**        | `test/unit/`        | Nothing external |
| **integration** | `test/integration/` | Mainnet algod    |
| **systemd**     | `test/systemd/`     | Docker           |

All suites share test fixtures in `test/fixtures/`.

**Unit** — isolated logic with all dependencies mocked.

**Integration** — spawns the runner as a child process. Fakes `systemd-notify` with a no-op script. Tests exit codes, signal handling (SIGTERM/SIGKILL escalation), child process cleanup, state bootstrapping, and error paths. No Docker, no systemd.

**Systemd** — boots a privileged Docker container with systemd as PID 1. Five scenarios via `run-test-container.sh <scenario>`:

| Scenario  | What it tests                                                                |
| --------- | ---------------------------------------------------------------------------- |
| `verify`  | Static lint of `.service` and `.timer` unit files (`systemd-analyze verify`) |
| `boot`    | Timer triggers on boot, `Type=notify` + `READY=1` handshake, clean exit      |
| `stop`    | `systemctl stop` → SIGTERM → runner and child exit cleanly                   |
| `failure` | Fatal generator exit → `ExecStopPost` runs `notify-slack`                    |
| `no-env`  | Missing `.env` causes a hard failure, not a silent skip                      |

`pnpm test` runs unit + integration only. Systemd tests need privileged Docker — run them with `pnpm run test:systemd`.

## Coverage

`pnpm run test:coverage` runs unit + integration with v8 coverage. All source files reach 100% except `index.ts` (the process entry point). v8 can't instrument it because integration tests spawn it as a subprocess, but those tests cover all its paths.

## Keeping in sync with committee-generator

The runner spawns the committee generator as a child process. They share no build-time dependencies, but the runner hard-codes parts of the generator's interface:

| What                                              | Runner location                               | Generator source                                                                      |
| ------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Exit codes (`SUCCESS`, `FATAL`, `EXPECTED_TIP`)   | `src/service.ts` → `GENERATOR_EXIT_CODE`      | `src/exit-codes.ts` → `ExitCode`                                                      |
| CLI args (`--mode`, `--from-block`, `--to-block`) | `src/service.ts` → `spawnWriteCache`          | Generator's CLI arg parser                                                            |
| SIGTERM grace period                              | `src/index.ts` → `GENERATOR_SIGTERM_GRACE_MS` | Generator's SIGTERM handler — grace period must exceed the generator's max flush time |

## Testing notify-slack locally

The `notify-slack.js` script posts a Slack notification when the runner service fails. To test locally add credentials to `.env` at the **workspace root** (loaded by `src/env.ts` via dotenv):

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C...
```

Build and run:

```bash
pnpm run build

# Success — no Slack message
node dist/notify-slack.js --exit-status 0 --service-result success --hostname local

# Failure — posts to Slack
node dist/notify-slack.js --exit-status 1 --service-result exit-code --hostname local

# Other failure types
node dist/notify-slack.js --exit-status 0 --service-result timeout --hostname local
node dist/notify-slack.js --exit-status 0 --service-result watchdog --hostname local
```
