# syntax=docker/dockerfile:1

# --- Build ---
FROM node:24-slim AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
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

# Build all packages in order
RUN pnpm --filter @spreadsheet/shared build \
    && pnpm --filter @spreadsheet/server run typecheck \
    && pnpm --filter @spreadsheet/web run build \
    && pnpm --filter @spreadsheet/server run build

# Deploy server with production deps only
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --filter @spreadsheet/server --prod /app/deployed

# --- Runtime (distroless — no shell, no package manager) ---
FROM gcr.io/distroless/nodejs24-debian13
WORKDIR /app

COPY --from=build /app/deployed/node_modules node_modules/
COPY --from=build /app/deployed/package.json ./
COPY --from=build /app/packages/server/dist/ dist/
COPY --from=build /app/packages/web/dist/ web/

ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_ROOT=./web
EXPOSE 8080

ENTRYPOINT ["dist/main.js"]
CMD ["serve"]
