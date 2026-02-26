FROM ubuntu:24.04 AS base

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    systemd ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --system --no-create-home xgov-committee-runner

WORKDIR /opt/xgov-committees/packages/runner
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
