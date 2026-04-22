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

> All files under `/opt/xgov-committees` are root-owned. Code updates (`git pull`, `pnpm install`, `pnpm run build`) will also need `sudo`.

### 3. Create data directories

```bash
sudo mkdir -p /var/lib/xgov-committees-runner
sudo chown xgov-committees-runner: /var/lib/xgov-committees-runner

sudo mkdir -p /var/cache/xgov-committees/data
sudo chown xgov-committees-runner: /var/cache/xgov-committees/data
```

### 4. Create .env

```bash
sudo cp /opt/xgov-committees/.env.example /opt/xgov-committees/.env
# Edit with production values
sudo chmod 600 /opt/xgov-committees/.env
```

> Root-owned with `600` — systemd reads `EnvironmentFile` as root before dropping privileges to the service user.

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
```

## Test Setup

Run as your own user (not root). Replace `<your-username>` with your actual username throughout.

### 1. Clone and build

```bash
cd ~
git clone <repo-url> xgov-committees
cd xgov-committees
pnpm install --frozen-lockfile
rm -rf packages/committee-generator/dist packages/runner/dist
pnpm run build
```

> Always `rm -rf dist` before building — `tsc` doesn't delete stale output files.

### 2. Create .env

```bash
cp .env.example .env
# Edit with your values
```

Replace `/opt` with `/home/<your-username>` in paths (`COMMITTEE_GENERATOR_PATH`, `STATE_DIR`). Set `DATA_PATH` for the generator's block cache.

### 3. Create data directories

```bash
mkdir -p ~/xgov-committees/packages/runner/state

# Use whatever path you set as DATA_PATH in .env
sudo mkdir -p /var/cache/xgov-committees/data
sudo chown "$USER": /var/cache/xgov-committees/data
```

> If you delete these to reset, re-run to restore permissions.

### 4. Install systemd units

```bash
sudo ln -s ~/xgov-committees/packages/runner/systemd/runner.service /etc/systemd/system/xgov-committees-runner.service
sudo ln -s ~/xgov-committees/packages/runner/systemd/runner.timer /etc/systemd/system/xgov-committees-runner.timer
```

### 5. Create systemd override

```bash
sudo systemctl edit xgov-committees-runner.service
```

```ini
[Service]
WorkingDirectory=/home/<your-username>/xgov-committees/packages/runner
EnvironmentFile=
EnvironmentFile=/home/<your-username>/xgov-committees/.env
ExecStart=
ExecStart=/usr/bin/node /home/<your-username>/xgov-committees/packages/runner/dist/index.js
ExecStopPost=
ExecStopPost=-/usr/bin/node /home/<your-username>/xgov-committees/packages/runner/dist/notify-slack.js --exit-status=${EXIT_STATUS} --service-result=${SERVICE_RESULT} --hostname=%H --unit-name=%n
User=<your-username>
SupplementaryGroups=systemd-journal
```

> The empty lines clear the base unit's values before setting new ones — without them, systemd appends and you get duplicates.

> `SupplementaryGroups=systemd-journal` lets the Slack notifier read the journal. Alternatively: `sudo usermod -aG systemd-journal <your-username>`.

### 6. Override runtime limits (optional)

```bash
sudo systemctl edit xgov-committees-runner.service
# Add under [Service]: RuntimeMaxSec=40min

sudo systemctl edit xgov-committees-runner.timer
# Add under [Timer]: OnUnitInactiveSec= (empty to clear) then OnUnitInactiveSec=10min
```

### 7. Start

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
sudo rm -rf /etc/systemd/system/xgov-committees-runner.service.d
sudo rm -rf /etc/systemd/system/xgov-committees-runner.timer.d
sudo systemctl daemon-reload
```

To also reset state and cache:

```bash
rm -rf ~/xgov-committees/packages/runner/state
sudo rm -rf /var/cache/xgov-committees/data
```

> After deleting these, follow step 3 to recreate them with the correct permissions before restarting.

## Operations

### View live logs

```bash
sudo journalctl -u xgov-committees-runner.service -f --output=cat
```

### Check status

```bash
systemctl status xgov-committees-runner.timer
systemctl status xgov-committees-runner.service
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

> SIGTERM exits cleanly with code 0 — no Slack notification. SIGKILL exits with `SERVICE_RESULT=signal` — Slack notification fires.

### Code update

```bash
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
