FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    systemd \
    systemd-sysv \
 && rm -rf /var/lib/apt/lists/*

# node:22-slim installs to /usr/local/bin/node; runner.service expects /usr/bin/node.
RUN ln -sf /usr/local/bin/node /usr/bin/node

RUN useradd --system --no-create-home xgov-committees-runner

WORKDIR /opt/xgov-committees

# Enable pnpm via corepack (Node 22 ships with corepack)
RUN corepack enable

# Install runner dependencies using the workspace root lock file.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/runner/package.json packages/runner/
RUN pnpm install --frozen-lockfile --filter xgov-committees-runner

WORKDIR /opt/xgov-committees/packages/runner
COPY packages/runner/ .

RUN pnpm run build

# Simulate the committee generator (the real one is deployed separately).
RUN mkdir -p /opt/xgov-committees/packages/committee-generator/dist
COPY packages/runner/test/fixtures/generator-default.js \
     /opt/xgov-committees/packages/committee-generator/dist/index.js
COPY packages/runner/test/fixtures/generator-graceful-exit.mjs \
     /opt/xgov-committees/packages/committee-generator/dist/generator-graceful-exit.mjs
COPY packages/runner/test/fixtures/generator-fatal.js \
     /opt/xgov-committees/packages/committee-generator/dist/generator-fatal.js

# Create a minimal .env with dummy Slack creds so EnvironmentFile= and config.ts succeed.
RUN printf 'SLACK_BOT_TOKEN=xoxb-test\nSLACK_CHANNEL_ID=C0TEST\n' > /opt/xgov-committees/.env

RUN chown -R root:xgov-committees-runner /opt/xgov-committees \
 && chmod -R u=rwX,g=rX,o= /opt/xgov-committees

# State directory (state is seeded at run time by seed-state.ts, not at build time,
# because it must be close to the current chain tip).
RUN mkdir -p /var/lib/xgov-committees-runner \
 && chown xgov-committees-runner:xgov-committees-runner /var/lib/xgov-committees-runner

RUN cp systemd/runner.service /etc/systemd/system/ \
 && cp systemd/runner.timer /etc/systemd/system/

RUN systemctl mask \
    getty@tty1.service \
    systemd-firstboot.service \
    systemd-udevd.service 2>/dev/null || true

CMD ["/sbin/init"]
