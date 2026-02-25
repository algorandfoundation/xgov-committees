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

To accomplish a oneshot service (only one intance at a time) + systemd watchgod functionality this is the correct type. A `Type=oneshot` service cannot use `WatchdogSec`. `Type=notify` allows the process to make pings to systemd while running. Then, the process MUST exit after completing work. The timer handles re-triggering.

```ini
NotifyAccess=all
```

The Node process uses `spawnSync("systemd-notify", ...)` (design decision) which forks a child process. `NotifyAccess=all` allows notifications from any process in the service's cgroup; without it, systemd would ignore the child's notifications.

```ini
WatchdogSec=65
```

systemd kills the process if no `WATCHDOG=1` ping is received within 65 seconds. The Node code pings every `WATCHDOG_INTERVAL_MS` seconds, allowing a predefined number of missed pings before exiting.

```ini
WorkingDirectory=/opt/xgov-committees/runner
```

Sets the cwd for the process. Needed for `dotenv` to resolve `.env` files and relative path references.

```ini
ExecStart=/usr/bin/node /opt/xgov-committees/runner/dist/index.js
```

Absolute paths for both the node binary and compiled entry point — no dependency on PATH. The TypeScript source MUST be compiled to JavaScript during the build step in CI/CD before deployment.

```ini
User=xgov-committee-runner
```

Runs as a dedicated unprivileged user, restricting access if the process is compromised.

### Install

Empty section, omitted. The service is triggered exclusively by the timer. `[Install]` is only needed for services enabled directly via `systemctl enable`. Since only the timer is enabled, an `[Install]` section on the service would be dead configuration.

## runner.timer

### Timer

```ini
OnUnitInactiveSec=50min
```

Re-triggers the service 50 minutes after its completion. Combined with an expected ~10 minute run time, this produces a ~60 minute cycle.

```ini
OnBootSec=0
```

Triggers immediately on boot, ensuring the first run doesn't wait the interval after the server (re)starts.

### Install

```ini
WantedBy=timers.target
```

Standard target for timer units. For this runner, the timer MUST be the `systemctl enable`d unit. The timer triggers on boot and automatically starts the service at regular intervals.
