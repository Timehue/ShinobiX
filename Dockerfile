# ─────────────────────────────────────────────────────────────────────────────
# ShinobiX / Shinobi Journey — container image for Railway, Render, Fly.io,
# or any Docker host.
#
# Runs the SAME Express server used on cPanel (server.ts → dist/server.js),
# serving both the API and the React SPA on a single port.
#
# NOTE: the cPanel entry point (app.js) is intentionally NOT used here. Its
# DNS/IPv4 hardcoding exists only for CloudLinux/CageFS (which can't resolve DNS
# or route IPv6); on a normal host it's unnecessary and would be fragile. We run
# `node dist/server.js` directly instead. cPanel is unaffected — it still uses
# app.js as before.
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
# support"), breaking every Supabase read. (engines allow >=20; 22 is current LTS.)

# ── Stage 1: builder — install everything + build the server bundle + React client ──
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install API/server dependencies first for better layer caching.
# There is no committed package-lock.json (it's .gitignored), so use
# `npm install` rather than `npm ci`.
#
# IMPORTANT: Railway (and most PaaS) set NODE_ENV=production during the build,
# which makes npm OMIT devDependencies. But the build toolchain — typescript/tsc,
# vite, sharp — lives in devDependencies, so we must force them in with
# `--include=dev` or the build dies at `tsc: not found`.
COPY package.json ./
RUN npm install --include=dev

# Install client dependencies (vite, typescript, sharp are devDependencies too —
# same --include=dev requirement as above).
COPY shinobij.client/package.json ./shinobij.client/
RUN cd shinobij.client && npm install --include=dev

# Copy the rest of the source. node_modules and the committed dist/ are excluded
# via .dockerignore, so the installs above are preserved and the build is fresh.
COPY . .

# Public client vars baked into the bundle by Vite AT BUILD TIME. Railway passes
# matching service variables as build args (you must declare ARG to receive them).
# Without these, Supabase Realtime (PvP/clan-war push) silently falls back to
# polling. Defaults are empty so a local `docker build` with no args still works.
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Build the server bundle (tsc → dist/) and the React client (vite →
# shinobij.client/dist), then run the post-build sanity check (verify:dist).
# The extra heap headroom guards the client typecheck/bundle of the large
# App.tsx against OOM on smaller builders.
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

# ── Stage 2: runtime — production deps + built output only (small final image) ──
FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only (NODE_ENV=production + --omit=dev drops the build
# toolchain — vite/three/sharp/typescript/tsx). The server (dist/server.js +
# dist/api/**) needs only these runtime packages: express, @supabase/supabase-js,
# pg, compression, dotenv, @sentry/node, socket.io, undici — all declared under
# "dependencies" (not "devDependencies").
COPY package.json ./
RUN npm install --omit=dev

# The built server + API (dist/) and the React SPA static bundle, which
# express.static serves from join(__dirname,'..','shinobij.client','dist').
# Nothing else from source is read at runtime.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shinobij.client/dist ./shinobij.client/dist

# The platform injects PORT; the server reads process.env.PORT (server.ts:456)
# and falls back to 3000 for local `docker run`.
EXPOSE 3000

# Run the compiled Express server directly (bypassing the cPanel-only app.js).
CMD ["node", "dist/server.js"]
