# Game Loading Performance Audit

Date: 2026-07-10
Scope: cold boot, session restore, screen transitions, route chunks, image manifests, polling, and high-cost battle renderers.

## Executive summary

The loading screens were being extended by two different classes of work:

1. A large startup shell: the initial dependency graph is 1.76 MB raw / 504.9 KB gzip across seven JS/CSS files. The entry module alone is 1.07 MB raw, and global CSS is 507.9 KB.
2. Avoidable work around transitions: duplicate image-manifest requests, broad cache invalidation, redundant password verification, early background polls, late route preloads, and optional request waterfalls.

This change removes the avoidable transition work and adds accurate transition measurements and enforceable bundle budgets. It intentionally does not perform a risky rewrite of the large application shell; that is the main remaining startup optimization.

## Baseline findings

| Priority | Finding | User-visible effect |
| --- | --- | --- |
| P0 | `App.tsx` imports the story trigger graph, which statically reaches roughly 638 KB of storyline/interlude/epilogue source. | Every cold visit parses narrative content before the player asks for it. |
| P0 | The initial entry is about 1.07 MB raw and the blocking global stylesheet is about 509 KB. | Cold boot remains CPU- and transfer-heavy on slower devices. |
| P1 | Login fetched the save with an explicit password header after authentication had already issued a session token. | The server could perform the expensive password hash verification twice. |
| P1 | Login/restore and shared-admin refresh paths invalidated image state and reloaded many categories; concurrent callers were not deduplicated. | Bursts of duplicate `/api/images` requests continued after the route was ready. |
| P1 | Ten image categories were globally requested after login instead of the categories consumed by the active route. | Network contention delayed the content the player was actually waiting for. |
| P1 | World/game/heartbeat polling could start before a usable character existed, overlap, or remain stuck behind a hung request. | Background traffic competed with screen data and could stop refreshing indefinitely. |
| P1 | Navigation preloading covered only part of the Village and began mostly on pointer-down. | Lazy JS often started downloading at the same moment the loading screen appeared. |
| P1 | The first Pet Coliseum/Tactical fight reaches a roughly 956 KB Three.js vendor chunk plus renderer/scene code and large art. | First battle entry is substantially slower than later cached fights. |
| P1 | Performance telemetry measured time spent on the previous screen, not navigation intent to visible destination content. | Existing numbers could not identify slow loading screens accurately. |
| P2 | Leaderboard and war-map primary data waited on optional/independent responses. | A slow secondary endpoint held the main screen open. |
| P2 | Badge, card, and inventory grids eagerly requested off-screen images. | Image-heavy tabs generated unnecessary first-paint traffic. |
| P2 | Weekly boss and pet ladder could show a loading or stale-data state after an error/mode switch. | Some perceived loading was a state bug rather than active work. |

Healthy controls already present: hashed assets receive immutable caching, image manifests use URL mode rather than bulk base64, build-time image optimization is enabled, and fonts are not a material bottleneck.

## Implemented improvements

### Faster route entry

- Added hover, focus, and pointer intent preloading for all Village destinations and common right-menu destinations.
- Expanded the preload registry to the arena, story, shop, town hall, bank, clan, hospital, cafeteria, cards, hub, pets, and Hall of Legends routes.
- Cached successful route import promises and allowed failed imports to retry.
- Warmed the shared Pet Coliseum renderer during the existing five-second pre-roll and valid battle setup; failed speculative loads are safely ignored so the real lazy loader can retry.

### Less network work while loading

- Switched the post-auth save read to the session-token path, retaining the existing password fallback when no token exists.
- Added single-flight image-category loading so concurrent callers share one request.
- Preserved valid manifest/cache data during ordinary snapshots and shared-content refreshes instead of clearing and reloading every category.
- Replaced the ten-category global preload with a tested screen-to-category map, including direct-restore battle routes and visual-novel overlays.
- Delayed world/game polls until a logged-in character is restored and the tab is visible.
- Added overlap guards and 12-second abort bounds to world state, game state, heartbeat, and force-reload follow-up requests.
- Limited the large leadership-image request to Town Hall/Admin while visible.
- Decoupled optional tournament metadata from the public leaderboard and fetched war-map/world-state data concurrently.

### More accurate loading behavior

- Added an outer-Suspense ready probe. Transition timing now starts at navigation intent (or committed screen fallback) and ends when real destination content commits.
- Corrected React effect ordering with layout effects so direct `setScreen` transitions and refresh boot type are recorded before child ready effects.
- Added long-task and slow-transition summaries to the existing anonymous performance beacon.
- Fixed weekly-boss failure/empty states and added retry.
- Prevented stale Pet Ladder content from appearing during mode changes and ignored superseded responses.

### Asset and budget controls

- Moved Pet Expedition result-modal CSS from the blocking global stylesheet into the lazy pet stylesheet.
- Added native lazy loading to achievement badges, card collection images, and inventory-grid images.
- Added build failures for an oversized entry file, oversized initial raw/gzip graph, and excessive total JS/CSS. The final graph passes at 1.76 MB raw / 504.9 KB gzip; total JS/CSS remains a warned 5.48 MB after integration with the latest intro-cinematic release.

## Expected impact

- Login removes one redundant expensive password-verification path.
- Ordinary restore no longer schedules the previous eight-category reload pattern.
- Shared-admin refresh no longer triggers six broad category invalidations/reloads.
- Initial image traffic is now active-route-specific and deduplicated.
- Hover/focus time is used to fetch route chunks before the loading fallback mounts.
- Pet battle renderer parsing overlaps the countdown/setup instead of beginning after it.
- Production telemetry can now rank actual intent-to-ready screen durations rather than prior-screen dwell time.

These are deterministic request/critical-path reductions. Real percentile latency improvement should be evaluated from the corrected performance beacon after deployment; local preview cannot reproduce production database/CDN latency.

## Remaining high-value work

1. Split a thin boot/auth router from the authenticated game runtime. This is the largest cold-start win.
2. Break the static story trigger dependency: load compact trigger metadata initially and dynamically import chapter/interlude bodies on demand.
3. Continue route-level CSS extraction from `index.css`; avoid another monolithic stylesheet rewrite.
4. Externalize or sprite the 182 small jutsu FX frames and split optional post-processing from the core Three.js vendor chunk.
5. Add responsive variants for the 777 KB world map and 598 KB tactics diorama, then virtualize or paginate the largest image grids.
6. Abort timed-out restore work rather than merely releasing the UI gate, and remove the remaining non-critical navigation waits/retry sleeps.

## Verification

- `npm run lint` — pass.
- React/TypeScript performance review — pass; no remaining blockers.
- Focused performance/ratchet tests — pass.
- Full test suite — 2,609 passed, 0 failed.
- `npm run build` — pass (server compile, client compile, dist verification, image optimization, and size budgets).
- Production preview — the latest-main landing page and character-creation transition rendered from the freshly combined hashed assets.
