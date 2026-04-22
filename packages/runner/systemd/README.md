# systemd configuration

## runner.service

### Unit

```ini
After=network-online.target
Wants=network-online.target
```

The service makes HTTP requests to algod. Both configs are needed: `Wants=` ensures the network target is activated, and `After=` ensures the service starts only after network is ready.

### Service

```ini
Type=notify
```

To accomplish a oneshot service (only one instance at a time) with systemd watchdog functionality, this is the correct type. A `Type=oneshot` service cannot use `WatchdogSec`. `Type=notify` allows the process to make pings to systemd while running. Then, the process MUST exit after completing work. The timer handles re-triggering.

```ini
NotifyAccess=all
```

The Node process uses `spawnSync("systemd-notify", ...)` (design decision) which forks a child process. `NotifyAccess=all` allows notifications from any process in the service's cgroup; without it, systemd would ignore the child's notifications.

```ini
WatchdogSec=65
```

If no `WATCHDOG=1` ping is received within 65 seconds, systemd kills the process. The Node code pings every `WATCHDOG_INTERVAL_MS` seconds, allowing a predefined number of missed pings before exiting.

```ini
WorkingDirectory=/opt/xgov-committees/packages/runner
```

Sets the cwd for the process. Required for relative path references at runtime.

```ini
EnvironmentFile=/opt/xgov-committees/.env
```

Loads environment variables from the repo root `.env` before Node starts. The file is non-optional (no `-` prefix). If it is missing, systemd fails during environment setup before `ExecStart` runs, and the unit enters `failed` state. See `.env.example` at the repo root for the full list of required variables. The `dotenv` calls in the Node source are a fallback for non-systemd invocations and are redundant when the service runs under systemd.

```ini
ExecStart=/usr/bin/node /opt/xgov-committees/packages/runner/dist/index.js
```

Absolute paths for both the Node binary and compiled entry point (no dependency on PATH). The TypeScript source MUST be compiled to JavaScript during the build step in CI/CD before deployment.

```ini
ExecStopPost=-/usr/bin/node /opt/xgov-committees/packages/runner/dist/notify-slack.js --exit-status=${EXIT_STATUS} --service-result=${SERVICE_RESULT} --hostname=%H --unit-name=%n
```

Runs after the main process exits (regardless of success or failure) and posts a Slack notification on failure. `$EXIT_STATUS` and `$SERVICE_RESULT` are systemd environment variables available in `ExecStopPost`; `%H` and `%n` are specifiers resolved to the machine hostname and unit name at unit parse time.

The `-` prefix makes this directive non-fatal: if `notify-slack` fails (e.g. Slack is down, env vars not configured), systemd ignores the non-zero exit and the unit's status reflects only the main service. Slack notifications are best-effort.

```ini
RuntimeMaxSec=3h
```

Hard ceiling on total service runtime. If the process has not exited within this time window, systemd sends `SIGTERM`.

```ini
TimeoutStopSec=90
```

Systemd default, set explicitly for clarity. After `RuntimeMaxSec` (or any other stop) sends `SIGTERM`, systemd waits this long before sending `SIGKILL`. Must be greater than `GENERATOR_SIGTERM_GRACE_MS` (`src/index.ts`), the time the Node process waits for its child to exit after receiving `SIGTERM`.

```ini
User=xgov-committees-runner
```

Runs as a dedicated unprivileged user, restricting access if the process is compromised.

```ini
SupplementaryGroups=systemd-journal
```

Grants the service read access to the systemd journal. Required so that `ExecStopPost` (`notify-slack`) can call `journalctl` to collect the log tail included in failure notifications.

### Install

Empty section, omitted. The service is triggered exclusively by the timer. `[Install]` is only needed for services enabled directly via `systemctl enable`.

## runner.timer

### Timer

```ini
OnUnitInactiveSec=50min
```

Re-triggers the service 50 minutes after its last completion. By using `OnUnitInactiveSec`, the timer only begins once the service exits (becomes inactive). This ensures a 50-minute gap between runs and eliminates overlap risk regardless of execution time (subject to the `RuntimeMaxSec` cap).

```ini
OnBootSec=0
```

Triggers immediately on boot, ensuring the first run doesn't wait the interval after the server (re)starts.

### Install

```ini
WantedBy=timers.target
```

Standard target for timer units. For this runner, the timer unit MUST be enabled via `systemctl enable`. The timer triggers on boot and automatically starts the service at regular intervals.
