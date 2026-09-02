# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────────────
# ShinobiX / Shinobi Journey — active Railway container image.
# The image remains portable to other Docker hosts for recovery or migration,
# but Railway is the active deployment direction.
#
# Runs the active Express server (server.ts → dist/server.js),
# serving both the API and the React SPA on a single port.
#
# NOTE: the cPanel entry point (app.js) is intentionally NOT used here. Its
# DNS/IPv4 bypass config exists only for CloudLinux/CageFS (which can't resolve
# DNS or route IPv6); on a normal host it's unnecessary and would be fragile. We run
# `node dist/server.js` directly instead. cPanel/Passenger compatibility uses
# its separate `app.js` entry point only for rollback or data recovery; it is
# not current production.
#
# TWO-STAGE build: the `builder` stage installs ALL deps (incl. the build-only
# vite/three/sharp/typescript ≈ 0.5 GB) and builds server + client; the `runtime`
# stage ships ONLY production deps + the built output. This keeps the FINAL image
# small so Railway's image-EXPORT phase doesn't blow past its heartbeat/idle
# timeout (the old single-stage image's export ran ~18 min and intermittently
# failed). Runtime needs are exactly: dist/ + shinobij.client/dist/ + production
# node_modules + package.json — verified: no runtime reads of source files (the
# .git/HEAD read in server.ts is already gracefully optional; .git is dockerignored).
# ─────────────────────────────────────────────────────────────────────────────
# Node 22+ is required: @supabase/supabase-js's createClient() builds a Realtime
# client that needs a native global WebSocket, which only exists in Node 22+.
# On Node 20 createClient() throws ("Node.js 20 detected without native WebSocket
# support"), breaking every Supabase read. package.json engines require Node 22+.

# ── Stage 1: builder — install everything + build the server bundle + React client ──
FROM node:22.23.1-bookworm-slim AS builder

WORKDIR /app

# Install API/server dependencies first for better layer caching.
# The committed root package-lock.json makes this build reproducible; use
# `npm ci` rather than `npm install`.
#
# IMPORTANT: Railway (and most PaaS) set NODE_ENV=production during the build,
# which makes npm OMIT devDependencies. But the build toolchain — typescript/tsc,
# vite, sharp — lives in devDependencies, so we must force them in with
# `--include=dev` or the build dies at `tsc: not found`.
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=shinobix-root-npm,target=/root/.npm \
    npm ci --include=dev --prefer-offline --no-audit --no-fund

# Install client dependencies (vite, typescript, sharp are devDependencies too —
# same --include=dev requirement as above).
COPY shinobij.client/package.json shinobij.client/package-lock.json ./shinobij.client/
RUN --mount=type=cache,id=shinobix-client-npm,target=/root/.npm \
    cd shinobij.client && npm ci --include=dev --prefer-offline --no-audit --no-fund

# Copy the rest of the source. node_modules and the committed dist/ are excluded
# via .dockerignore, so the installs above are preserved and the build is fresh.
COPY . .

# Public client vars baked into the bundle by Vite AT BUILD TIME. Railway passes
# matching service variables as build args (you must declare ARG to receive them).
# Without these, Supabase Realtime (PvP/clan-war push) silently falls back to
# polling. Defaults are empty so a local `docker build` with no args still works.
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_SENTRY_DSN=""
ARG VITE_SENTRY_RELEASE=""
ARG VITE_BUILD_COMMIT=""
ARG VITE_PRODUCT_ANALYTICS_ENABLED=""
ARG VITE_PRODUCT_ANALYTICS_PROVIDER=""
ARG VITE_POSTHOG_KEY=""
ARG VITE_POSTHOG_HOST=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_RELEASE=$VITE_SENTRY_RELEASE \
    VITE_BUILD_COMMIT=$VITE_BUILD_COMMIT \
    VITE_PRODUCT_ANALYTICS_ENABLED=$VITE_PRODUCT_ANALYTICS_ENABLED \
    VITE_PRODUCT_ANALYTICS_PROVIDER=$VITE_PRODUCT_ANALYTICS_PROVIDER \
    VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY \
    VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST

# Build the server bundle (tsc → dist/) and the React client (vite →
# shinobij.client/dist), then run the post-build sanity check (verify:dist).
# The extra heap headroom guards the client typecheck/bundle of the large
# App.tsx against OOM on smaller builders. Client dependencies were installed
# from the committed lockfile immediately above; tell the wrapper not to repeat
# that npm ci merely because Railway exposes CI=true.
RUN SHINOBIX_CLIENT_DEPS_PREINSTALLED=1 \
    NODE_OPTIONS=--max-old-space-size=4096 \
    npm run build

# The client dist is dominated by already-compressed WebP, GLB, and audio
# assets. Keeping all ~363 MB in one Docker layer makes Railway's image-export
# upload a single long-lived blob and has repeatedly timed out after otherwise
# green builds. Partition the immutable output into balanced trees so BuildKit
# can export/cache several sub-85 MB linked layers independently. The final
# filesystem is byte-for-byte the same shinobij.client/dist tree.
RUN set -eux; \
    mkdir -p \
      /runtime-client/01/shinobij.client/dist \
      /runtime-client/02/shinobij.client/dist \
      /runtime-client/03/shinobij.client/dist \
      /runtime-client/04/shinobij.client/dist \
      /runtime-client/05/shinobij.client/dist \
      /runtime-client/06/shinobij.client/dist; \
    mv shinobij.client/dist/pet-models /runtime-client/01/shinobij.client/dist/; \
    mv shinobij.client/dist/chronicle /runtime-client/02/shinobij.client/dist/; \
    mv shinobij.client/dist/pet-poses shinobij.client/dist/sector-map /runtime-client/03/shinobij.client/dist/; \
    mv shinobij.client/dist/assets shinobij.client/dist/music /runtime-client/04/shinobij.client/dist/; \
    mv shinobij.client/dist/scenes shinobij.client/dist/portraits shinobij.client/dist/sfx /runtime-client/05/shinobij.client/dist/; \
    find shinobij.client/dist -mindepth 1 -maxdepth 1 \
      -exec mv {} /runtime-client/06/shinobij.client/dist/ \;

# ── Stage 2: runtime — production deps + built output only (small final image) ──
FROM node:22.23.1-bookworm-slim AS runtime

WORKDIR /app
# Railway exposes RAILWAY_GIT_COMMIT_SHA automatically at runtime. Generic
# Docker releases can pass --build-arg BUILD_COMMIT=<full sha>; server health
# accepts either source and reports the full immutable revision.
ARG BUILD_COMMIT=""
ENV NODE_ENV=production \
    BUILD_COMMIT=$BUILD_COMMIT

# Production dependencies only (NODE_ENV=production + --omit=dev drops the build
# toolchain — vite/three/sharp/typescript/tsx). The server (dist/server.js +
# dist/api/**) needs only these runtime packages: express, @supabase/supabase-js,
# pg, compression, dotenv, @sentry/node, socket.io, undici — all declared under
# "dependencies" (not "devDependencies").
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=shinobix-runtime-npm,target=/root/.npm \
    npm ci --omit=dev --prefer-offline --no-audit --no-fund

# The built server + API (dist/) and the React SPA static bundle, which
# express.static serves from join(__dirname,'..','shinobij.client','dist').
# Nothing else from source is read at runtime.
COPY --link --from=builder /app/dist ./dist

# Each linked copy is an independently exportable layer. Together they restore
# the exact client dist tree partitioned at the end of the builder stage.
COPY --link --from=builder /runtime-client/01/ ./
COPY --link --from=builder /runtime-client/02/ ./
COPY --link --from=builder /runtime-client/03/ ./
COPY --link --from=builder /runtime-client/04/ ./
COPY --link --from=builder /runtime-client/05/ ./
COPY --link --from=builder /runtime-client/06/ ./

# The platform injects PORT; the server reads process.env.PORT (server.ts:456)
# and falls back to 3000 for local `docker run`.
EXPOSE 3000

# Run the compiled Express server directly (bypassing the cPanel-only app.js).
CMD ["node", "dist/server.js"]
