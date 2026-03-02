FROM node:22-slim AS base

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    systemd \
 && rm -rf /var/lib/apt/lists/*

# node:22-slim installs to /usr/local/bin/node; runner.service expects /usr/bin/node.
RUN ln -sf /usr/local/bin/node /usr/bin/node

RUN useradd --system --no-create-home xgov-committee-runner

WORKDIR /opt/xgov-committees/packages/runner
# TODO: refactor to use the workspace root lock file instead.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# ── unit-test ─────────────────────────────────────────────────────────────────
FROM base AS unit-test
CMD ["node_modules/.bin/vitest", "run", "test/unit"]

# ── integration ───────────────────────────────────────────────────────────────
FROM base AS integration

RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd-sysv \
 && rm -rf /var/lib/apt/lists/*

RUN npm run build
RUN chown -R root:xgov-committee-runner /opt/xgov-committees \
 && chmod -R u=rwX,g=rX,o= /opt/xgov-committees

RUN cp systemd/runner.service /etc/systemd/system/ \
 && cp systemd/runner.timer /etc/systemd/system/ \
 && systemctl enable runner.timer

RUN systemctl mask \
    getty@tty1.service \
    systemd-firstboot.service \
    systemd-udevd.service 2>/dev/null || true

CMD ["/sbin/init"]
