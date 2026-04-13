#!/usr/bin/env bash
# Run visual regression tests inside the official Playwright Docker image
# for deterministic screenshots across dev machines and CI.
#
# Usage:
#   pnpm test:visual:docker                  # verify against baselines
#   pnpm test:visual:docker:update           # regenerate all baselines
#   pnpm test:visual:docker -- --grep "landing"  # pass extra args
#
# Prerequisites: Docker, a built packages/web/dist (runs SKIP_E2E_BUILD=1).
# Build first with: pnpm build
set -euo pipefail

# Pin to the same version as @playwright/test in package.json.
IMAGE="mcr.microsoft.com/playwright:v1.59.1-noble"

# Run as the host user so files written to bind-mounts (test-results,
# playwright-report, snapshot updates) aren't owned by root.
# Add the docker socket's group so testcontainers can still talk to Docker.
DOCKER_GID="$(ls -ln /var/run/docker.sock 2>/dev/null | awk '{print $4}')"
DOCKER_GID="${DOCKER_GID:-0}"

exec docker run --rm --init --ipc=host \
  --network=host \
  --user "$(id -u):$(id -g)" \
  --group-add "$DOCKER_GID" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$(pwd)":/work \
  -w /work \
  -e SKIP_E2E_BUILD=1 \
  -e TESTCONTAINERS_RYUK_DISABLED="${TESTCONTAINERS_RYUK_DISABLED:-true}" \
  "$IMAGE" \
  npx playwright test --project=visual-desktop --project=visual-mobile "$@"
