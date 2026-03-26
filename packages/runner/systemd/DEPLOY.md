# Deployment Playbook

## Prerequisites

- Ubuntu server with Node.js >= 20.19.0 and pnpm installed
- `.env` file with all required variables (see `.env.example` at repo root)

## Production Setup

### 1. Create dedicated user

```bash
sudo useradd --system --no-create-home xgov-committees-runner
```

### 2. Deploy code

```bash
sudo git clone <repo-url> /opt/xgov-committees
cd /opt/xgov-committees
sudo pnpm install --frozen-lockfile
sudo rm -rf packages/committee-generator/dist packages/runner/dist
sudo pnpm run build
```

> All files under `/opt/xgov-committees` are root-owned. The service only needs read access. Code updates (`git pull`, `pnpm install`, `pnpm run build`) will also need `sudo`.

### 3. Create data directories

The service user can't create directories under `/var/lib/` or `/var/cache/`, so these must be done as root:

```bash
# Runner local state (persists across runs)
sudo mkdir -p /var/lib/xgov-committees-runner
sudo chown xgov-committees-runner: /var/lib/xgov-committees-runner

# Generator block cache (read + write — stores block headers, proposers, committees)
sudo mkdir -p /var/cache/xgov-committees/data
sudo chown xgov-committees-runner: /var/cache/xgov-committees/data
```

### 4. Create .env

```bash
sudo cp /opt/xgov-committees/.env.example /opt/xgov-committees/.env
# Edit with production values
sudo chmod 600 /opt/xgov-committees/.env
```

> The file is root-owned with `600` permissions. This is intentional — systemd reads `EnvironmentFile` as root before dropping privileges to the service user.

### 5. Install systemd units

Copy (not symlink) so `git pull` doesn't change the running service definition:

```bash
sudo cp /opt/xgov-committees/packages/runner/systemd/runner.service /etc/systemd/system/xgov-committees-runner.service
sudo cp /opt/xgov-committees/packages/runner/systemd/runner.timer /etc/systemd/system/xgov-committees-runner.timer
sudo systemctl daemon-reload
sudo systemctl enable --now xgov-committees-runner.timer
```

### 6. Verify

```bash
systemctl status xgov-committees-runner.timer
systemctl status xgov-committees-runner.service
systemctl list-timers | grep xgov
```

## Test Setup (run as your user, e.g. `sofi`)

### 1. Clone and build

```bash
cd ~
git clone <repo-url> xgov-committees
cd xgov-committees
pnpm install --frozen-lockfile
rm -rf packages/committee-generator/dist packages/runner/dist
pnpm run build
```

> Always `rm -rf dist` before building. `tsc` doesn't delete stale output files, so old extensionless imports or moved files can linger and cause runtime errors.

### 2. Create .env

```bash
cp .env.example .env
# Edit with your values
```

In general, replace `/opt` with `/home/<user>` in paths (e.g. `COMMITTEE_GENERATOR_PATH`, `STATE_DIR`). Set `DATA_PATH` for generator's block cache conveniently.

### 3. Install systemd units

Symlink the service and timer (symlink lets repo changes take effect immediately):

```bash
sudo ln -s ~/xgov-committees/packages/runner/systemd/runner.service /etc/systemd/system/xgov-committees-runner.service
sudo ln -s ~/xgov-committees/packages/runner/systemd/runner.timer /etc/systemd/system/xgov-committees-runner.timer
```

### 4. Create systemd override

Override paths and user to run from user's home directory:

```bash
sudo systemctl edit xgov-committees-runner.service
```

Paste:

```ini
[Service]
WorkingDirectory=/home/sofi/xgov-committees/packages/runner
EnvironmentFile=
EnvironmentFile=/home/sofi/xgov-committees/.env
ExecStart=
ExecStart=/usr/bin/node /home/sofi/xgov-committees/packages/runner/dist/index.js
ExecStopPost=
ExecStopPost=-/usr/bin/node /home/sofi/xgov-committees/packages/runner/dist/notify-slack.js --exit-status=${EXIT_STATUS} --service-result=${SERVICE_RESULT} --hostname=%H --unit-name=%n
User=sofi
SupplementaryGroups=systemd-journal
```

> The empty `ExecStart=` / `ExecStopPost=` / `EnvironmentFile=` lines clear the base unit's values before setting new ones. Without them, systemd appends and ends up with duplicate entries.

> `SupplementaryGroups=systemd-journal` grants the service process read access to the journal, required for the Slack notifier to include log tails in failure notifications. Optionally, add your user to the group too (`sudo usermod -aG systemd-journal sofi`) to tail logs without `sudo`.

### 5. Start

```bash
sudo systemctl daemon-reload
sudo systemctl start xgov-committees-runner.timer
```

## Teardown (test setup)

```bash
sudo systemctl stop xgov-committees-runner.timer
sudo systemctl stop xgov-committees-runner.service
sudo systemctl disable xgov-committees-runner.timer
sudo rm /etc/systemd/system/xgov-committees-runner.service
sudo rm /etc/systemd/system/xgov-committees-runner.timer
sudo rm -r /etc/systemd/system/xgov-committees-runner.service.d
sudo systemctl daemon-reload
```

## Operations

### View live logs

```bash
sudo journalctl -u xgov-committees-runner.service -f --output=cat
```

> Use `--output=cat` to see raw stdout without journald blob truncation.

### Check status

```bash
systemctl list-timers | grep xgov
systemctl list-units | grep xgov
```

### Stop

```bash
sudo systemctl stop xgov-committees-runner.timer
sudo systemctl stop xgov-committees-runner.service
```

### Reset (after a failed run)

```bash
sudo systemctl reset-failed xgov-committees-runner.service
```

> Clears the `failed` state so the unit shows as `inactive`. The timer can then trigger it again.

### Test Slack notifications

Send SIGKILL to simulate a crash (triggers `ExecStopPost` with non-success result):

```bash
sudo systemctl start xgov-committees-runner.service
# Wait a few seconds for it to start
sudo systemctl kill --signal=SIGKILL xgov-committees-runner.service
```

> SIGTERM (normal stop) exits cleanly with code 0 — no Slack notification (by design).
> SIGKILL exits with code 137 / `SERVICE_RESULT=signal` — Slack notification fires.

### Code update

```bash
# Stop first to prevent a run mid-build
sudo systemctl stop xgov-committees-runner.timer
sudo systemctl stop xgov-committees-runner.service

cd ~/xgov-committees  # or /opt/xgov-committees for production
git pull
pnpm install --frozen-lockfile
rm -rf packages/committee-generator/dist packages/runner/dist
pnpm run build

# For production only: update systemd unit files if they changed
# sudo cp packages/runner/systemd/runner.service /etc/systemd/system/xgov-committees-runner.service
# sudo cp packages/runner/systemd/runner.timer /etc/systemd/system/xgov-committees-runner.timer

sudo systemctl daemon-reload
sudo systemctl start xgov-committees-runner.timer
```
