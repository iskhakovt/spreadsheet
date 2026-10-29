# syntax=docker/dockerfile:1

# --- Build ---
FROM mirror.gcr.io/library/node:25-slim AS build
# pnpm 12 ships as a native binary that corepack can't run, so copy it
# from the official image (https://pnpm.io/docker). Keep the tag in sync
# with `packageManager` in package.json — a mismatch makes pnpm download
# the pinned version at install time. /opt/pnpm also carries the node-gyp
# pnpm uses for native deps, so copy the directory, not just the binary.
COPY --from=ghcr.io/pnpm/pnpm:12.14.0 /opt/pnpm /opt/pnpm
RUN ln -s /opt/pnpm/pnpm /usr/local/bin/pnpm
# Explicit store so it lands on the cache mount below. pnpm 12 otherwise
# falls back to node_modules/.pnpm-store when the store and project
# can't hardlink across filesystems.
ENV pnpm_config_store_dir=/pnpm/store
WORKDIR /app

# Install dependencies (lockfile-only layer for caching)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/web/ packages/web/

RUN pnpm --filter @spreadsheet/shared build \
    && pnpm --filter @spreadsheet/web run build \
    && pnpm --filter @spreadsheet/server run build

# Deploy server with production deps only
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --filter @spreadsheet/server --prod /app/deployed

# --- Runtime (distroless — no shell, no package manager) ---
# Distroless is tracked by its nodejs24-debian13 channel rather than a
# pinned digest; the Trivy scan in publish.yml surfaces base-image CVEs.
# Scope the untagged-base warning to this FROM so DL3006 still guards any
# base image added later.
# hadolint ignore=DL3006
FROM gcr.io/distroless/nodejs24-debian13
WORKDIR /app

COPY --from=build /app/deployed/node_modules node_modules/
COPY --from=build /app/deployed/package.json ./
COPY --from=build /app/packages/server/dist/ dist/
COPY --from=build /app/packages/server/src/db/questions.yml dist/questions.yml
COPY --from=build /app/packages/server/migrations/ migrations/
COPY --from=build /app/packages/web/dist/ web/

ARG VERSION
ENV VERSION=$VERSION
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_ROOT=./web
EXPOSE 8080
EXPOSE 9090

ENTRYPOINT ["/nodejs/bin/node", "dist/main.js"]
CMD ["serve"]
