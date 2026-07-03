# Shinobi Journey Performance, Scalability, and Health Audit

Date: 2026-07-03
Repo: `C:\Users\Tyler R\source\repos\NinjaK`
Remote: `https://github.com/Timehue/ShinobiX.git`

## 1. Executive Summary

Overall health score: 7/10.

The game is healthier than a typical hobby browser MMO of this size. The build passes, lint passes, 2107 tests pass, the API has rate limits and auth checks on important paths, static files are cache-controlled, hot poll payloads have already been slimmed, and the heartbeat path no longer writes presence to the database every second.

The main risks are not "one obvious broken endpoint." They are production scaling risks:

- The client shell is still very large: `App.tsx` is 625 KB / 9681 lines, `index.css` is 683 KB / 21236 lines, and the production entry chunk built at about 1.43 MB raw.
- Runtime presence is intentionally in-memory and single-process. That is fast today, but it is a hard deployment invariant.
- The built client directory is about 121 MB locally when ignored pet GLB models are present in `public/`, and those files were being copied into Docker builds before this audit.
- Hot polling is much improved, but fallback HTTP heartbeat can still run every second while exploring/combat, and several world/roster frames are all-player or all-key scans on cache miss.
- Large admin/gameplay files still suppress React hook lint rules file-wide, which slows future audits and raises stale-closure risk.

Best quick wins:

- Keep draining `App.tsx` and `index.css` into screen-local chunks.
- Keep pet GLBs out of `public/` until they are actually runtime-loaded and optimized/CDN-hosted.
- Add sector indexing to the online store before real concurrency grows.
- Paginate/summarize roster and admin player APIs before the save registry grows into the thousands.
- Keep Docker context clean; applied in this audit.

## 2. Critical Issues

### CRITICAL: Live presence only works correctly on one API process

Location: `api/_realtime/online-store.ts:8`

Issue: `onlineStore` is a process-local `Map`. The file clearly documents that player API traffic must run on one process, and that cPanel/Passenger multi-worker hosting would split presence across workers.

Impact: If heartbeat lands on worker A and attack/roster reads worker B, players can appear offline, sector peers can vanish, and challenges/attacks can fail under real users.

Fix risk: Medium to high. Requires either a Redis/shared presence store or an enforced single-worker deployment.

Safest fix: Before scaling horizontally, implement the existing `OnlineStateStore` interface with Redis/Upstash or Socket.IO adapter storage. Short-term, add a startup warning/health check that refuses live player APIs when known multi-worker hosting is detected.

Applied: Not applied. This is an architecture/infra change, not a safe quick patch.

### CRITICAL: No verified active critical runtime failure

Build, server typecheck, client build, lint, dist verification, and the full test suite all passed during this audit. The critical item above is conditional on deployment topology.

## 3. High Priority Issues

### HIGH: Client entry shell is still too large

Location: `shinobij.client/src/App.tsx:127`, `shinobij.client/src/index.css`

Issue: `App.tsx` has an anti-regrowth test and has been heavily drained, but it is still 625 KB / 9681 lines. The production build created `index-*.js` at about 1.43 MB raw, plus `index.css` at about 569 KB raw / 104 KB gzip.

Why it matters: Slow first load on mobile, longer parse/compile time, slower hot reload, harder audits, and higher chance of unrelated state changes re-rendering broad app surfaces.

Fix risk: Medium. Needs staged extraction, not a rewrite.

Safest fix: Continue extracting App-local systems into hooks (`useHeartbeat`, `useAutosave`, `useWorldPolls`, `usePvpSessionRestore`) and move screen-only styles into screen CSS modules or lazily imported CSS.

Applied: Not applied. Broad refactor risk is too high for a first audit pass.

### HIGH: Large unused/local 3D assets can enter production builds

Location: `shinobij.client/public/pet-models/`, `.gitignore`, `.dockerignore`

Issue: Ten ignored GLB files total about 38 MB and are not referenced by runtime source. Vite copies all files under `public/` into `dist`, so local builds included them.

Why it matters: Slower Docker context transfer, slower client builds, larger deploy artifacts, and avoidable hosting/CDN storage.

Fix risk: Low for Docker context; medium if deleting assets.

Safest fix: Keep these assets outside `public/` until wired, optimized, compressed, and loaded on demand. Use CDN or `public/optional-assets` copied only by explicit script.

Applied: Partially applied. `.dockerignore` now excludes `shinobij.client/public/pet-models/`, `*.pdf`, `*.zip`, and the local `Shinobi Journey/` folder from Docker context.

### HIGH: Hot heartbeat path is O(active players) per beat

Location: `api/player/heartbeat.ts:126`, `api/_realtime/online-store.ts:86`, `shinobij.client/src/App.tsx:2851`

Issue: Heartbeat stores presence in memory and returns sector mates, but each beat currently lists all active players and filters by sector. Fallback HTTP heartbeat runs every 1s while exploring sectors or in combat when Socket.IO is disconnected.

Why it matters: Fine for dozens of players, but at hundreds/thousands this becomes avoidable CPU work and response payload pressure.

Fix risk: Medium.

Safest fix: Add sector-indexed presence in `MemoryOnlineStateStore` (`Map<sector, Set<playerId>>`) so heartbeat can return sector mates without scanning everyone. Keep `list()` for admin/roster.

Applied: Not applied. Needs tests and careful update/remove/sweep semantics.

### HIGH: Public roster still batches every registered save on cache miss

Location: `api/player/roster.ts:157`

Issue: The roster endpoint is much improved versus a full `save:*` scan, but cache misses still `hgetall` the registry, `mget` all save keys, settle each save record, project each character, sort, and return all players.

Why it matters: This becomes costly as the player base grows. It also creates larger public payloads over time.

Fix risk: Medium.

Safest fix: Split into `/api/player/roster/summary?limit=&cursor=` for public discovery and a targeted `/api/player/profile?name=` for full projected profiles. Cache summary separately.

Applied: Not applied. API/client contract change.

## 4. Medium Priority Issues

### MEDIUM: Global CSS bundle is large and all-screen

Location: `shinobij.client/src/index.css`

Issue: `index.css` is 683 KB source and built to about 569 KB raw. This ships as global styling even for first screens that do not need most rules.

Why it matters: CSS parse/style cost and maintenance cost grow with every screen.

Fix risk: Medium.

Safest fix: Move styles for Admin, Arena, PetColiseum, WorldMap, and feature-heavy screens into lazy screen CSS files. Keep only tokens/base layout global.

Applied: Not applied.

### MEDIUM: KV key scans are cached, but still broad on cache miss

Location: `api/game-state.ts:50`, `api/world-state.ts:640`, `api/_storage.ts:196`

Issue: `game-state` scans `game:village-state:*` and `game:clan-pet-battle:*`; `world-state` scans territory/war/standing-style data; storage `keys(pattern)` uses prefix-friendly indexing, but broad keyspace scans remain a scaling ceiling.

Why it matters: Good enough with current sizes, but cost grows with each saved village/clan/war feature.

Fix risk: Medium.

Safest fix: Maintain compact index keys for hot collections, such as `game:village-state:index`, `world:war:index`, and update them transactionally on writes.

Applied: Not applied.

### MEDIUM: Admin and combat files remain very large with hook lint suppressions

Location: `shinobij.client/src/screens/AdminPanel.tsx:1`, `shinobij.client/src/screens/Arena.tsx:1`, `shinobij.client/src/screens/WorldMap.tsx:1`

Issue: Several heavy screens disable `react-hooks/exhaustive-deps` and/or `set-state-in-effect` at file scope. AdminPanel is 433 KB, Arena is 348 KB, WorldMap is 213 KB.

Why it matters: In large React components, file-wide suppressions hide stale closure and accidental re-render bugs.

Fix risk: Medium.

Safest fix: Pay down one screen at a time: extract pure render sections, re-enable hook lint per file, and add narrow one-line suppressions only where intentional.

Applied: Not applied.

### MEDIUM: Build config allowed server JS emit on TypeScript errors

Location: `tsconfig.cpanel.json:14`

Issue: `noEmitOnError` was `false`, so a server build could emit JS even if TypeScript found errors.

Why it matters: Bad deploys can produce stale or partially unsafe server output.

Fix risk: Low because the server currently typechecks cleanly.

Safest fix: Set `noEmitOnError` to `true`.

Applied: Yes.

### MEDIUM: Auth still keeps password fallback in browser storage

Location: `shinobij.client/src/authFetch.ts:24`

Issue: The app supports session tokens but still documents and supports password fallback in `localStorage`/`sessionStorage`.

Why it matters: Any XSS would expose credentials. The code has strong content handling in several places, but this is still a production security surface.

Fix risk: Medium.

Safest fix: Finish token-only migration, reduce password persistence lifetime, and clear legacy password keys after a token is issued.

Applied: Not applied.

## 5. Low Priority Cleanup

- Remove or archive local root artifacts (`shinobix-frontend.zip`, PDFs, local `Shinobi Journey/`) outside the repo when not needed.
- Consider lowering `App.size.test.ts` budget if App is now comfortably under the guard.
- Consider a bundle-size CI budget for built `index-*.js`, `index.css`, and total `dist`.
- Normalize mojibake comments over time when editing nearby files; do not churn the whole repo just for text encoding.
- Add a short perf runbook with current accepted polling intervals, cache TTLs, and target payload ceilings.

## 6. Frontend Performance Findings

Strong points:

- Many screens are already lazy-loaded through `lazyWithRetry`.
- React and Three are manually chunked in Vite.
- Presence updates are pushed into an external store so 1s sector updates do not re-render the entire App tree.
- Tab visibility pauses major polls.
- Images are optimized during Vite build.

Weak points:

- Initial app chunk remains large despite lazy loading.
- Global CSS is very large.
- WorldMap, Arena, AdminPanel, PetColiseum, and App are still large enough to slow dev/build/audit cycles.
- Ten large GLB files are local-only today but can be copied by public-dir builds if present.
- `three-vendor` is about 979 KB raw. It is chunked, which is good, but 3D screens must remain strictly lazy and mobile-gated.

## 7. Backend/API Findings

Strong points:

- Server compression is registered before routes.
- JSON body limits are smaller on default routes and larger only for image/admin-like routes.
- Static assets have correct cache headers for hashed assets and fixed media.
- Heartbeat is authenticated and rate-limited.
- Roster, image, game-state, and world-state endpoints show serious prior optimization work.

Weak points:

- Presence depends on single-process runtime.
- Heartbeat sector lookup scans all active players.
- Roster returns all players, not paginated summaries.
- Some hot endpoints rely on CDN/process cache rather than data-model indexes.

## 8. Database/Supabase Findings

Strong points:

- `kv_store.key` is primary key.
- `expires_at` and `key text_pattern_ops` indexes exist.
- Atomic RPCs exist for `kv_set_nx`, `kv_incr`, `kv_hset`, and `kv_hdel`.
- Server storage has an in-process read cache for repeated keys.
- `mget` is used in several hot paths.

Weak points:

- Supabase fallback `keys(pattern)` and `mget` filter expiry client-side in some paths.
- A single JSONB KV table is flexible but eventually becomes a bottleneck for feed-like or leaderboard-like queries.
- Broad JSON payload reads/writes make payload discipline critical as saves grow.

## 9. Game Systems Health

Combat:

- Server-authoritative PvP and battle-lock tests are strong. Large Arena/PvpBattle files remain maintenance risks.

Sectors/world map:

- Movement/presence flow is optimized versus older DB presence, but sector indexing should come before larger real-user concurrency.

Training:

- Training parity tests pass and autosave has dirty/flush handling.

Missions/hunts:

- Mission tests are broad. Watch for client-side completion paths that still rely on autosave timing.

Pets:

- Pet combat simulation coverage is extensive. Asset payload is the bigger risk than logic.

Inventory/economy:

- Economy and save-sanitize tests are strong. Continue moving reward grants server-side.

VN/story:

- VN flow tests exist; asset loading is separated through shared images.

Admin/editor:

- Very capable but large. AdminPanel should be split into tab modules to lower render and audit risk.

## 10. Fixes Applied

Files changed:

- `.dockerignore`
- `tsconfig.cpanel.json`

Changes:

- Added Docker ignores for root PDFs/zips, local `Shinobi Journey/`, and `shinobij.client/public/pet-models/`.
- Changed server TypeScript `noEmitOnError` from `false` to `true`.

Why safe:

- Docker ignore changes affect build context only and exclude artifacts already local/untracked or documented as local-only.
- Server TypeScript currently passes cleanly, so `noEmitOnError: true` does not change emitted code today; it only prevents future bad emits.

## 11. Fixes Recommended But Not Applied

- Redis/shared presence store: not applied because it is an architecture change.
- Sector-indexed online store: not applied because it needs focused tests around update/remove/sweep and socket notifications.
- Roster pagination/profile split: not applied because it changes API/client contracts.
- App/CSS large-scale split: not applied because broad refactors are risky without profiling and screenshots.
- Token-only auth cleanup: not applied because it needs migration handling for existing sessions.
- Removing local GLB assets: not applied because they are user/local artifacts and may be needed for future art work.

## 12. Final Action Plan

Immediate fixes:

- Keep the two applied fixes.
- Move local GLB models out of `public/` or keep them excluded from Docker until runtime-loaded.
- Add CI bundle-size checks for entry JS, global CSS, total `dist`, and public media.

This week:

- Implement sector-indexed `MemoryOnlineStateStore`.
- Split `useHeartbeat`, `useWorldPolls`, and `useAutosave` out of `App.tsx`.
- Start AdminPanel tab extraction.
- Add a paginated roster summary endpoint.

Later polish:

- Split global CSS by screen.
- Add Lighthouse/mobile traces for first load, WorldMap, Arena, PetArena, AdminPanel.
- Add route-level skeletons/preload hints only where measured.

Long-term scaling upgrades:

- Move presence to Redis or an equivalent shared realtime store before multi-instance API hosting.
- Replace broad KV scans with maintained collection index keys.
- Move media and generated art to CDN/object storage with explicit cache/version policy.
- Introduce production metrics for endpoint latency, payload sizes, active players, heartbeat rate, and cache hit ratio.

## Verification Run

- `npm run build:server`: passed.
- `npm run build:client`: passed.
- `npm run lint` in `shinobij.client`: passed.
- `npm test`: 2107 passing, 0 failing.
- `npm run verify:dist`: passed.
- `npx tsc -p tsconfig.cpanel.json --noEmit`: passed after the config change.
