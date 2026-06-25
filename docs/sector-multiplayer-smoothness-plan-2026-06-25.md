# Sector Multiplayer Smoothness Plan — making crowded sectors feel seamless

**Date:** 2026-06-25
**Status:** Phases 1, 2, **and 2D (live peer movement) IMPLEMENTED** on branch
`claude/xenodochial-faraday-7ef952` (lint + tsc + 1493 root tests + App.size ratchet all green; not
yet owner-feel-checked live). Phase 1 committed at `73c922a6`; 2D + exit-fade in a follow-up commit.
Phases 3–6 and 2C (grounded peer look) remain PLAN ONLY.
**Scope:** The "sectors" (the 12×12 world-map grid screen) where players see each other,
are viewable, and can fight. Goal: make the experience smooth and seamless when **multiple
players are present at once** — no flicker, no teleport/pop, no jank, instant-feeling PvP entry.

### Build log (what shipped to the branch)
- **1A** — `shinobij.client/src/lib/presence-store.ts` (new external store via `useSyncExternalStore`);
  App.tsx writes the live sector roster to it (heartbeat + socket) instead of `useState`; WorldMap
  reads it with `useLiveSectorPlayers()`. Avatar prefetch rewired to a store callback so it still
  loads new peers' portraits without re-rendering App. Result: the ~1s heartbeat re-renders only the
  sector view, not all of App.
- **1B** — the `playerRoster` merge in App.tsx now returns the **same reference** when a cheap
  display-field signature is unchanged, so the per-beat `allPlayers` merge stops re-rendering App on
  the common no-change beat. Signature buckets `lastSeenAt` to 30s so the Scout overlay's 90s
  staleness check stays accurate (the one subtle correctness point).
- **2A (enter)** — peers fade+scale in on appearance, reduced-motion respected.
- **2B** — a ~2.5s per-name "linger" in the store keeps a peer visible across a momentary snapshot
  gap (kills the sub-second blink); explicit `presence:gone`/sleeper-KO and the 60s TTL still remove
  immediately.
- **2D (live peer movement)** — the presence frame now carries a within-sector `tile` (0..143),
  added identically on both transports (`api/player/heartbeat.ts` + `api/_realtime/socket.ts`),
  clamped server-side (`normalizeTile`), stored on `OnlinePlayer`, and returned by `toPlayerRecord`.
  WorldMap bridges the local player's `sectorPlayerPos` → the heartbeat via the store
  (`setLocalSectorTile`/`getLocalSectorTile`). A new `SectorPeers` overlay renders other players at
  their real tile and **glides** them between tiles via a CSS transform transition (fallback: the
  deterministic per-name tile when a peer hasn't sent one — graceful for old clients). Gated by
  `sectorPeers.v1` (localStorage, **default ON**; set `=off` to restore the old in-tile dots).
- **2A exit-fade** — now delivered: `SectorPeers` keeps a departed peer one fade-out cycle
  (`peer-map-out`) then drops it on `animationend` (immediate drop under reduced motion).
- **App-size drain** — `presenceCharacter()` moved verbatim from App.tsx to
  `lib/presence-character.ts` to keep App.tsx under the 10,134-line ratchet (now 10,108).
- **Deferred:** 2C (flag-gated grounded/aura peer look), Phase 1C (move `playerRoster` fully into the
  store), Part A Phases 3–6 (delta socket events, HTTP→fallback, crowd cap/canvas, intra-sector AOI),
  CDN `no-store`.
- **Deploy note:** `dist/` is NOT rebuilt in these commits (Railway self-builds from source for the
  live host). Run `npm run build` + commit `dist/` (root server dist + client dist force-added) before
  any **cPanel** deploy, since cPanel serves committed `dist/` verbatim.

---

## 1. What "smooth and seamless" should mean here

When two or more players share a sector, the experience should feel like a small live world:

1. **No pop-in / pop-out.** A player who is genuinely present stays visible; one who leaves
   fades out gracefully instead of vanishing and reappearing.
2. **No teleporting.** Other players' avatars glide between tiles instead of snapping a tile
   at a time when a new server snapshot lands.
3. **No jank under load.** Adding a 5th, 20th, 50th player to a sector must not stutter the
   UI or spike the frame budget for everyone else in it.
4. **Instant-feeling interactions.** Clicking a player to attack / challenge / inspect gives
   immediate visual feedback; the roster doesn't flicker between "sleeping" and "awake" or
   reorder under the cursor.
5. **Cheap.** It must not re-introduce the image-in-JSON bandwidth tax or hammer Railway with
   1s full-state polls per player.

---

## 2. How the sectors work today (baseline)

This is the current implementation, established by a read-only code map. File references are
approximate and meant as starting points for whoever implements each phase.

### Transport — dual path
- **Socket.IO (primary when connected):** `shinobij.client/src/lib/presence-socket.ts` +
  `api/_realtime/socket.ts`. Client joins a `sector:<n>` room; server pushes
  `presence:sector` (full snapshot for the room), `presence:gone` (sweep removals),
  `presence:kick` (nudge a target to beat now), and answers `presence:request` (on-demand
  snapshot after reconnect). Client ping `PING_MS = 20_000`. Server coalesces inbound
  presence to `PRESENCE_MIN_INTERVAL_MS = 1_000` per socket (leading edge instant).
- **HTTP heartbeat (always-on fallback):** `POST /api/player/heartbeat`. Cadence in
  `App.tsx` (~2915–2937): **20s** when socket connected, **15s** in village (sector 0),
  **1s** while exploring a sector / in battle / guard-queued. Returns `sectorMates`,
  `allPlayers` (capped 100), `pendingAttacker`, `pendingChallenges`, `pendingHeal`.

### Presence store (server)
- In-memory `api/_realtime/online-store.ts`, `OFFLINE_AFTER_MS = 60_000` TTL.
- Game-loop sweep `api/_realtime/game-loop.ts` every **1s**, broadcasts `presence:gone`.
- Rows are **slimmed** (`api/_realtime/presence-input.ts`): display fields only, **avatar
  and pet images stripped** (client resolves them from a name-keyed `sharedImages` cache).
  This already fixed the image-in-JSON cost: a 100-player roster is ~20–30 KB, not MBs.

### Rendering (client)
- `shinobij.client/src/screens/WorldMap.tsx` builds the per-sector roster
  (live players + up to **15** "sleeping"/offline targets, KO'd players suppressed via a
  90s tombstone) and draws players **as DOM nodes on map tiles** (`.other-players-map-stack`).
  **Not virtualized.** Iterates all 144 tiles each render.
- The **local** player walks smoothly (`SectorAvatar.tsx`, ~6.5 tiles/sec with easing +
  footstep dust). **Other players do not** — they are drawn statically on a tile and jump
  when the next snapshot changes their tile.
- Every heartbeat calls `setLiveSectorPlayers(...)` (App.tsx ~2852), which is **React state
  on the top-level App** → a **full App re-render up to once per second** in busy sectors.

### PvP entry
- Live target → `POST /api/player/attack` sets `pendingAttacker` + `kickPlayer()`; target's
  next beat/socket-kick surfaces the challenge. Sleeping target → `POST /api/player/sleeper-kill`
  (server-authoritative KO). Gates in `presence-gating.ts`: `ATTACKABLE_MIN_LEVEL = 10`,
  `ACADEMY_MIN_LEVEL = 15` (spars/pet battles exempt). Recent commits added "any-level sleeper
  attackable," an "anti-flicker tombstone," and a "fresh-on-entry roster."

### The four real bottlenecks
1. **Full-App re-render on every heartbeat** (App.tsx state holds the roster). The single
   biggest smoothness cost; gets worse as more components mount and as the roster grows.
2. **No entity interpolation for other players** — they teleport tile-to-tile and pop in/out.
3. **Full-snapshot roster replacement each tick** — the whole array is swapped, so React
   diffs/re-mounts everything; momentary drop-then-readd reads as flicker.
4. **Unvirtualized DOM avatars** — fine at today's scale, but a crowded sector (50–100+) will
   thrash layout/paint for everyone in it.

A fifth, latent issue: a **CDN/edge cache (~60s) can shadow the live roster**, which is the
documented root cause of historical pop-in/out (the 90s tombstone is a workaround for it).

---

## 3. How comparable games solve this (research distilled)

- **Area-of-Interest (AOI) / interest management.** MMOs only send a client the entities it
  "cares about," and when a single cell gets crowded they use a **fuzzy** scheme: nearest
  N players update in real time, the rest at a lower rate/fidelity. Our **sector is already the
  interest zone**, so we only need *intra-sector* fuzzing if a single sector gets very busy.
  ([AOI overview](https://dev.to/aceld/11-mmo-online-game-aoi-algorithm-l7d),
  [interest management](https://appwarps2.shephertz.com/dev-center/mmo-interest-management/))
- **Entity interpolation (render delay).** The standard fix for "other players teleport."
  The client renders remote entities **~100–250 ms in the past**, keeping the last two
  authoritative snapshots and **linearly interpolating** between them, so movement is always
  real data shown slightly late — smooth even with infrequent updates.
  ([Gabriel Gambetta — Entity Interpolation](https://www.gabrielgambetta.com/entity-interpolation.html))
- **Transport choice.** WebSockets are the recommended path for "presence, typing indicators,
  collaborative cursors, game-style interaction" (bidirectional, lowest latency). Polling is
  easiest to scale but wasteful for this. We already have Socket.IO as the primary path — the
  takeaway is to **lean on it and treat the 1s HTTP poll as a pure fallback**.
  ([RxDB transport comparison](https://rxdb.info/articles/websockets-sse-polling-webrtc-webtransport.html),
  [WebSocket vs SSE](https://websocket.org/comparisons/sse/))
- **React for high-frequency state.** Putting fast-changing data in top-level component state
  (or Context) forces the whole subtree to reconcile. The fix is an **external store** read via
  `useSyncExternalStore` (or Zustand, which wraps it) with **per-component selectors**, so only
  the roster widgets re-render when the roster changes.
  ([useSyncExternalStore — React](https://react.dev/reference/react/useSyncExternalStore),
  [Context perf trap](https://azguards.com/performance-optimization/the-propagation-penalty-bypassing-react-context-re-renders-via-usesyncexternalstore/))
- **Crowd rendering / graceful enter-leave.** Room-based social games (Habbo/Gather-style) cap
  visible avatars and show overflow as a pile/"+N", and **fade** avatars in/out rather than
  hard add/remove, which is what kills flicker perceptually.

---

## 4. The plan — phased, prioritized

Each phase is independently shippable and ordered by **impact ÷ risk**. Phases 1–2 are
client-only and touch no saves, no balance, no auth, no schema. Later phases touch the
realtime layer (still ephemeral/in-memory — **no player-save risk**) and must keep **both
the Socket.IO and HTTP-fallback paths** and **both Railway and cPanel** working.

### Phase 1 — Move the live roster into an external store (stop the full-App re-render)
**Problem:** #1 above — `setLiveSectorPlayers` on App re-renders everything ~1×/sec.
**Approach:** Introduce a small presence store in `lib/` (a module-scope store exposed via
`useSyncExternalStore`, or Zustand). The heartbeat/socket handlers **write** to the store;
the WorldMap roster components **read** it via narrow selectors (e.g. "players in *this*
sector"). App.tsx stops holding the roster in React state.
**Specifics / guardrails:**
- `subscribe` and `getSnapshot` defined at module scope; **return stable references** (don't
  build a new array each call — keep a cached snapshot and only swap it when contents change),
  to avoid the classic `useSyncExternalStore` infinite-render bug.
- Selector granularity: "is *X* in my current sector," "count in sector," "roster for sector
  N" — so a player joining sector 7 doesn't re-render someone viewing sector 3.
- This also respects the **App.tsx drain rule** (new code goes in `lib/`, not App.tsx, which
  is at its size ceiling).
**Risk:** Low–medium (it's a data-flow refactor; behavior-preserving). **Effort:** Medium.
**Win:** Removes the dominant jank source and makes everything after it cheaper.

### Phase 2 — Entity interpolation + graceful fade for other players
**Problem:** #2 — other players teleport tile-to-tile and pop in/out.
**Approach (render-only):** In the sector view, keep the **last two known positions per
player** with timestamps and render each remote avatar **~200–300 ms in the past**, easing
between tiles (reuse `SectorAvatar`'s existing walk easing so remote players walk like the
local one). On first appearance, **fade/scale in**; on leave, **fade out** over ~300–500 ms
instead of removing the DOM node instantly. Generalize the existing KO-tombstone into a single
"graceful exit" path so normal leaves and KO leaves both animate.
**Dependency:** This needs each remote player's **within-sector tile position**. If the
presence frame currently carries only `sector` (not tile x/y), add a **tiny additive field**
(two small integers) to the heartbeat/socket frame and `PRESENCE_CHAR_KEEP`. ~4–8 bytes/player,
negligible vs. the roster we already send; no image, no save impact.
**Tuning start point:** render delay 250 ms, fade-in 250 ms, fade-out 400 ms — then feel-tune.
**Risk:** Low (visual only). **Effort:** Medium.
**Win:** This is the change that actually makes a crowded sector read as "alive."

### Phase 3 — Delta roster updates over the socket (join / leave / move)
**Problem:** #3 — full-snapshot replacement each tick churns React and reads as flicker.
**Approach:** Add incremental socket events — `presence:join`, `presence:leave`,
`presence:move` — that **patch** the Phase-1 store instead of replacing the array. Send a
**full snapshot only on sector-enter / reconnect** (the `presence:request` path already
exists). Keep the HTTP `sectorMates` full list working unchanged as the fallback.
**Risk:** Medium (server changes; must preserve fallback + both hosts). **Effort:** Medium.
**Win:** Stable identities across ticks → React keeps DOM nodes → no flicker; also lighter
on the wire than re-sending the whole room every second.

### Phase 4 — Make the 1s HTTP heartbeat a true fallback only
**Problem:** The 1s full-state HTTP poll in fast sectors is the costliest server path and is
redundant whenever the socket is healthy.
**Approach:** With Phases 1+3 in place, when the socket is connected let it own presence and
drop HTTP to the existing slow reconcile (~20s). Harden socket reconnect/backoff so the 1s
fallback rarely engages. This is mostly **verifying/cementing** current behavior, not new
mechanism.
**Risk:** Low. **Effort:** Low. **Win:** Lower Railway load, fewer redundant re-renders.

### Phase 5 — Crowd rendering: cap + overflow + (optional) canvas layer
**Problem:** #4 — unvirtualized DOM avatars thrash at 50–100+ in one sector.
**Approach (in order of effort):**
1. **Cap visible avatars per tile** with a "+N" pile indicator (Habbo/Discord style); clicking
   the pile opens a scrollable list. Cheap, big perceived-stability win.
2. **Overflow as lightweight dots** for distant/lower-priority players.
3. If hot sectors become real, **move the remote-avatar layer to a single canvas** (the project
   already has a canvas critters layer to model after), drawing N sprites in one pass instead
   of N DOM nodes.
**Risk:** Medium. **Effort:** Medium–High. **Win:** Keeps frame budget flat as population grows.
**Note:** Only pursue 5.3 if real crowding occurs; 5.1 alone covers most cases.

### Phase 6 (optional / future) — Intra-sector AOI fuzzing
Only if a **single sector** routinely holds very large crowds: update the nearest N players in
real time and the rest at a reduced rate/fidelity. The sector is already the coarse interest
zone, so this is a last-mile optimization, not a day-one need.

### Cross-cutting — flicker hardening (do alongside Phase 3)
- **Confirm the roster path is uncacheable.** Pop-in/out historically traced to a ~60s edge
  cache shadowing live presence (the 90s tombstone is a band-aid). Ensure presence/roster
  responses are `no-store` and not cached by Cloudflare. **This touches CDN/cache config —
  flag for owner approval before changing** (per the hosting rules).
- **Keep TTL ≫ keepalive.** 20s ping vs 60s TTL is a safe 3× margin; keep it. Keep the
  reconnect snapshot (`presence:request`).
- **Stable PvP target state.** Ensure a target doesn't flicker between "sleeping" and "awake"
  under the cursor as snapshots arrive (Phase-1 store + Phase-3 deltas make this stable);
  optimistic, instant feedback on attack/challenge click.

---

## 5. Recommended sequence

1. **Phase 1** (external store) — unlocks everything, biggest single win, client-only.
2. **Phase 2** (interpolation + fade) — the visible "seamless" payoff, client-only.
3. **Phase 3** (delta updates) + **cross-cutting flicker hardening** — kills the last flicker.
4. **Phase 4** (HTTP→fallback) — cheap cleanup once deltas are trusted.
5. **Phase 5** (crowd cap/canvas) — when/if real crowding shows up.
6. **Phase 6** — only if a single sector gets very large.

Phases 1–2 alone will make the common case (a handful of players in a sector) feel
dramatically smoother and are low-risk. 3–4 make it robust; 5–6 make it scale.

---

## 6. Explicit non-goals / do-not-break

- **No save/schema changes.** Presence is ephemeral and in-memory; keep it that way. No
  Supabase schema edits.
- **No balance changes.** PvP gates, rewards, cooldowns, level floors stay exactly as-is.
- **Keep auth token-first.** The socket already mirrors token/password/`x-client-fp`; preserve.
- **Keep both transports and both hosts.** Socket.IO **and** HTTP fallback; Railway **and**
  cPanel. After any `api/`/`server.ts` change, rebuild + commit `dist/` (cPanel serves it
  verbatim; Railway self-builds).
- **Don't re-introduce images in the presence frame.** Avatars/pets stay client-cache-resolved.
- **No big rewrite.** Every phase is an incremental, behavior-preserving change.

---

## 7. Verification

- **Perf:** React Profiler before/after Phase 1 — confirm a heartbeat no longer re-renders the
  whole App; only roster widgets update. Watch for dropped frames with a scripted N-player
  sector.
- **Smoothness:** Two real clients in one sector — confirm the remote avatar walks (not
  teleports), fades in/out, and never flickers between sleeping/awake.
- **Scale:** Simulate 50/100 players in one sector (seed the online-store) and confirm flat
  frame time + capped DOM/overflow behavior.
- **Tests:** `npm test` (root) for any `api/`/realtime change; `npm run lint` (client) for UI.
- **Fallback:** Force socket off → confirm HTTP path still populates the sector correctly.

---

## 8. Open questions for the owner

1. **Crowd target:** what's the realistic max players-per-sector we should design for — ~15,
   ~50, or "could spike to 100+"? This decides whether Phase 5/6 are in scope now.
2. **CDN cache rule:** OK to make the presence/roster path strictly `no-store` at Cloudflare
   so we can drop the tombstone workaround? (Touches hosting config.)
3. **Walking vs. standing:** should remote players actually *walk* around their tile (full
   Phase 2), or is "smooth fade in/out + no teleport" enough for v1?
4. **Store library:** plain `useSyncExternalStore` (zero deps) vs. adding Zustand (~1.2 KB,
   ergonomic selectors). Recommendation: start with `useSyncExternalStore` to avoid a new dep.

---

### Sources
- [Gabriel Gambetta — Entity Interpolation](https://www.gabrielgambetta.com/entity-interpolation.html)
- [MMO AOI algorithm](https://dev.to/aceld/11-mmo-online-game-aoi-algorithm-l7d) ·
  [MMO interest management](https://appwarps2.shephertz.com/dev-center/mmo-interest-management/)
- [Transport comparison (RxDB)](https://rxdb.info/articles/websockets-sse-polling-webrtc-webtransport.html) ·
  [WebSocket vs SSE](https://websocket.org/comparisons/sse/)
- [useSyncExternalStore — React](https://react.dev/reference/react/useSyncExternalStore) ·
  [Context re-render trap](https://azguards.com/performance-optimization/the-propagation-penalty-bypassing-react-context-re-renders-via-usesyncexternalstore/)

---
---

# PART B — Concrete implementation plan for Phases 1 & 2

**Hard constraint for this part: zero regression.** No screen, feature, visual, balance value,
storage key, or behavior may be lost. Every change is either (a) a behavior-preserving data-flow
refactor, or (b) an additive visual that is flag-gated and **off by default** so the current look
is byte-for-byte preserved until the owner opts in. Client-only — no `api/`, no `server.ts`, no
`dist/` rebuild, no save/schema/auth/balance touch (one optional sub-step, 2D, is the sole
exception and is explicitly gated + owner-approval-required).

## B.0 — Ground truth from the code (read before implementing)

Verified against the current source so the plan matches reality, not the high-level sketch above:

- **The per-second full-App re-render is real and has two drivers**, both in the heartbeat
  (`App.tsx` `heartbeat()`, ~2776–2907):
  - `setLiveSectorPlayers(data.sectorMates)` (~2852) — fires ~1s in wild sectors. `data.sectorMates`
    is always a **fresh array** from `res.json()`, so React never bails → App re-renders.
  - `setPlayerRoster(prev => …merge… .slice(0,100))` (~2856–2868) — runs on **every beat that
    carries `allPlayers`** (most of them) and **always returns a new array**, even when nothing
    changed → App re-renders again.
  - The socket path also writes `setLiveSectorPlayers` on `presence:sector` (~2963) and filters it
    on `presence:gone` (~2967).
- **`liveSectorPlayers`** is consumed by exactly two places: the `WorldMap` prop (`App.tsx` ~8491)
  and the avatar-prefetch effect (`App.tsx` ~4599–4605, deps `[liveSectorPlayers, playerRoster, sharedImages]`).
- **`playerRoster`** is consumed by `WorldMap` **and ~15 other screens** as a prop (Arena, Hospital,
  Professions/HealerHub, HallOfLegends, ShinobiCouncilHall/ClanBattlesTab, VillageWarScreen,
  WeeklyBossArena, UserView, UserHub, AdminPanel, HealerInjuredList…). Moving it fully to a store is
  high-surface — see B.1 for why we **don't** in Phase 1.
- **⚠️ Positions are NOT transmitted.** Other players are drawn at `playerNameTile(p.name)` —
  a deterministic djb2 hash of the name → a fixed tile 0–143 (`WorldMap.tsx:74`, used at ~1313).
  Consequences for Phase 2:
  - Players already sit at a **stable tile**; they do **not** teleport between snapshots. The
    "entity interpolation / render-delay" idea from Part A **does not apply** unless we add a real
    position stream (that is sub-step **2D**, an opt-in feature, not a smoothness fix).
  - The actual flicker is **membership** churn: a player blinks out then back when a single snapshot
    momentarily omits them, and appears/disappears with a hard DOM add/remove (no transition).
  - Other players render as a small flat dot (`.other-player-map-dot`: img + name + 💤), **not** the
    rich grounded `SectorAvatar` the local player gets. Making them match is a visual upgrade (2C),
    not required for smoothness.
- **Local avatar walk to reuse:** `SectorAvatar.tsx` already does grounded billboard + eased walk
  (`WALK_TILES_PER_SEC = 6.5`), CSS-class-driven (no re-render), honors `prefers-reduced-motion`,
  `pointer-events:none`. Its easing/`paint()` math is the reference for 2C/2D.
- **Flag convention:** existing gates are `localStorage` booleans like `sectorMap.v1`, `liteFx.v1`,
  `petColiseum.v1`. New optional visuals follow the same `*.v1` pattern (default off).

---

## B.1 — Phase 1: stop the per-second full-App re-render (behavior-preserving)

**Goal:** the heartbeat stops re-rendering the whole App tree; only the sector view updates when
the live roster changes. Nothing about *what* is shown changes.

### Step 1A — Move the live sector roster into an external store (the high-churn one first)

**New file:** `shinobij.client/src/lib/presence-store.ts` — a module-scope store exposed via
`useSyncExternalStore`. Responsibilities:
- Hold `liveSectorPlayers: PlayerRecord[]` (and later, optionally, `playerRoster`).
- `setLiveSectorPlayers(next)`, `applyGone(names)`, `getLiveSnapshot()`, `subscribe(fn)`.
- **Stable snapshot rule (the #1 `useSyncExternalStore` footgun):** `getSnapshot` must return the
  **same array reference** until contents actually change. The setters cache the current array and
  only swap it when a cheap signature differs (see equality helper below), then notify subscribers.
- A `useLiveSectorPlayers()` hook = `useSyncExternalStore(subscribe, getLiveSnapshot)` with
  `subscribe`/`getSnapshot` defined at **module scope** (never inline).

**Equality helper (kills the unchanged-beat re-render):** compare by a cheap signature —
`names + sector + inBattle + travelingUntil + level` joined — not deep-equality of nested character
blobs. If the signature matches the current array's, keep the old reference and **don't notify**.

**Edits in `App.tsx` (behavior-preserving swaps):**
- Delete the `useState` for `liveSectorPlayers` (~2681). Replace its three writers:
  - `setLiveSectorPlayers(data.sectorMates)` → `presenceStore.setLiveSectorPlayers(data.sectorMates)`.
  - socket `presence:sector` handler (~2963) → same setter (keep the "only my current sector" guard).
  - socket `presence:gone` handler (~2967) → `presenceStore.applyGone(names)` (same filter semantics).
- `WorldMap` no longer receives `liveSectorPlayers` as a prop; instead `WorldMap` calls
  `useLiveSectorPlayers()` internally. (Prop removal is the only signature change; keep `playerRoster`
  as-is.) *Alternative if you want zero prop-signature change:* keep the prop but source it in App
  from the hook — **rejected**, because reading the hook in App re-introduces the App re-render. Read
  it in `WorldMap` so the re-render is scoped to the sector subtree.

**The one subtle wiring detail — avatar prefetch (must not regress):** the effect at ~4599 depends
on `liveSectorPlayers`. Once that leaves App state, the effect won't see changes. Fix without
re-rendering App: in `presence-store.ts`, call the prefetch on change — either invoke a registered
`onLiveChange` callback from inside the setter, or have a tiny module-level `subscribe` that calls
`ensureAvatarsCached(names)` (already throttled + idempotent). Net: avatars for newly-seen players
still prefetch exactly as today, but without an App-level effect. Keep `playerRoster` in the existing
effect (it's still App state after 1A), so only the `liveSectorPlayers` source moves.

### Step 1B — Short-circuit the `playerRoster` merge (cheap, no store move, no 15-file churn)

Keep `playerRoster` in App state (15 consumers, not worth moving in Phase 1), but make the merge
**return the same reference when nothing changed** so React bails out of the update on the common
"roster unchanged" beat:
- In the `setPlayerRoster(prev => …)` updater (~2856): build `merged`, then compute a cheap
  signature over `prev` vs `merged` (names + level + currentSector + village + inBattle). If equal,
  `return prev` (same ref → no re-render). Else return the new array.
- This alone removes the large majority of remaining per-beat App re-renders, because most beats
  don't change the roster. Zero behavior change (same data, same cap of 100, same merge order).

### Step 1C — (Deferred, optional) move `playerRoster` to the store too

Only if profiling after 1A+1B still shows roster-driven App re-renders that matter. It's mechanical
(convert the ~15 prop consumers to a `useRoster()` hook, or a thin context that reads the store), and
behavior-preserving, but it's the high-surface change — **defer until 1A/1B are validated.** Note the
two roster writers that must keep working: the heartbeat merge and `sleeper-kill.ts:90`
(`setPlayerRoster(prev => prev.map(... currentSector: 0 ))`) — both become store calls if 1C is done.

### Phase 1 — what stays identical (regression checklist)
- Same players shown, same sleeper/live split, same 15-sleeper cap, same 100-roster cap.
- Same socket guards (only adopt snapshot for current sector; `presence:gone` removal; kick→heartbeat).
- Same avatar prefetch behavior and throttle.
- Same `playerRoster` data reaching all 15 consumer screens (1A/1B don't touch the prop).
- No change to heartbeat cadence, attack/challenge flow, force-reload, heal, or travel guards.

---

## B.2 — Phase 2: make presence *appear/leave/sit* smoothly (additive visuals, default-preserving)

Reframed to match the code: there is no position stream, so this is about **membership smoothness**
(no pop, no flicker) and an **optional** richer look — not interpolation.

### Step 2A — Graceful enter / leave transitions (no hard pop)
- Wrap `.other-player-map-dot` mount/unmount in a fade+scale: a CSS class `is-entering`
  (opacity 0→1, scale 0.85→1, ~250ms) on first appearance, and a brief `is-leaving`
  (1→0, ~350ms) before the node is actually removed.
- Implement the exit without a heavy lib: the sector-render keeps a small **"lingering exits"** set
  (names that left this frame) and renders them one extra cycle with `is-leaving`, then drops them.
  Pure render/CSS; no store or network change.
- **Regression guard:** entering/leaving is *visual only* — membership is still decided by the
  existing roster/`presence:gone`/sleeper logic. A KO'd player still leaves immediately (the
  tombstone in `sleeper-kill.ts` still prevents re-appear); they just fade rather than vanish.

### Step 2B — Flicker-proof identity (kill the blink from a momentary snapshot gap)
- The documented pop-in/out is a player dropping from a single snapshot then returning. Add a short
  **grace/linger** in `presence-store.ts`: when a name disappears from a `sectorMates`/`presence:sector`
  update but there was **no** explicit `presence:gone` and the TTL hasn't elapsed, keep showing them
  for ~2–3s before removing. Sub-second gaps stop blinking.
- **Bounds (so we never show a ghost):** linger ≪ the 60s server TTL; an explicit `presence:gone`
  or a `sleeper-kill` removes **immediately** (bypasses linger). This complements — does not
  replace — the existing 90s struck-down tombstone and any edge-cache `no-store` work from Part A.
- **Regression guard:** linger only *delays removal of someone who was just present*; it never adds
  anyone, never blocks an authoritative removal, and never changes who is attackable.

### Step 2C — (Optional, flag-gated) give other players the grounded look
- Behind a new `localStorage` flag (e.g. `sectorPeers.v1`, **default off**), render peers with the
  same grounded presentation as `SectorAvatar` (contact shadow + subtle idle bob; reuse the existing
  `.sector-avatar-*` CSS and `cellCentre` math). Default-off means the **current flat-dot look is
  preserved exactly** until the owner flips it and feel-checks.
- Keep it `pointer-events` correct so click-to-move/attack underneath is unaffected; cap rendered
  peers per tile with a "+N" affordance if a tile stacks many (ties into Part A Phase 5).
- **Regression guard:** zero change with the flag off; nothing removed even with it on (it restyles
  the same dots, keeps name + 💤 + Lv tooltip + click target).

### Step 2D — (Optional, additive FEATURE, owner-approval required) real peer movement
- This is the only sub-step that touches the server frame, and it is a **feature add**, not a
  smoothness fix: transmit a within-sector tile so peers actually walk instead of sitting on their
  name-hash tile.
- Scope if pursued: add `tileX/tileY` (two small ints) to the heartbeat body + the socket
  `PresenceFrame`, to `PRESENCE_CHAR_KEEP` + `slimPresenceCharacter` + `toPlayerRecord`
  (`api/_realtime/presence-input.ts`) and the client `presenceCharacter()` KEEP list; render peers
  through the `SectorAvatar` eased-walk path. ~4–8 bytes/peer, no image, no save impact.
- **Why gated:** changes where peers appear (name-tile → live tile), touches both transports + both
  hosts, needs a `dist/` rebuild + commit, and is a *visible behavior change* — so it must be
  opt-in and owner-approved. **If not enabled, Phases 1, 2A, 2B, 2C deliver the full "smoother"
  win with no behavior change at all.**

### Phase 2 — what stays identical (regression checklist)
- Default build looks and behaves exactly as today (2A/2B are subtle smoothness only; 2C/2D are
  flag-gated off).
- Same tiles, same names, same 💤 sleeper badge, same Lv tooltip, same click→attack/challenge.
- Sleeper-kill tombstone, `presence:gone`, TTL, and attack gating all unchanged.

---

## B.3 — Recommended order, verification, rollback

**Order:** 1B (tiny, instant win) → 1A (store + prefetch rewire) → React-Profiler check →
2A → 2B → (owner feel-check) → optional 2C → optional 2D.

**Verification (per the project's rules):**
- `npm run lint` inside `shinobij.client/` after each step (client-only changes).
- `npm test` from repo root only if 2D is pursued (it's the only `api/` touch); 1A–2C don't need it
  but running it costs nothing.
- React DevTools Profiler before/after 1A+1B: confirm a heartbeat no longer re-renders App; only the
  sector subtree updates, and an unchanged beat renders nothing.
- Two real clients in one sector: confirm peers fade in/out (no pop), don't blink on a missed
  snapshot, and that attack/challenge/sleeper-KO still work and feel instant.
- Mobile + `prefers-reduced-motion`: confirm transitions degrade gracefully (reduced-motion = no
  fade/bob, instant — mirror `SectorAvatar`'s existing guard).
- Confirm `App.size.test.ts` still passes — **all new code lives in `lib/`, not `App.tsx`** (App is
  at its line ceiling), so the ratchet is unaffected.

**Rollback:** each step is independently revertible. 1A/1B are localized to `presence-store.ts` +
the heartbeat/socket writers; 2A–2C are CSS + render-local; 2C/2D flags can be left off in prod even
if the code ships. No data migration, so rollback is a code revert with no state cleanup.

---
---

# PART C — Detailed design specs (still plan-only; signatures + pseudocode, no app code yet)

This part nails down the contracts so Phase 1/2 can be implemented mechanically with no judgment
calls left. It is a **specification**, not source to commit — written so an implementer (human or
agent) can produce the real files without re-deriving anything.

## C.1 — `shinobij.client/src/lib/presence-store.ts` — API contract

**Imports:** `PlayerRecord` from `../types/character`; React's `useSyncExternalStore`.

**Module-private state**
```
let liveArr: PlayerRecord[] = [];      // current live-sector roster (stable ref)
let liveSig = '';                      // cheap signature of liveArr
const subs = new Set<() => void>();    // useSyncExternalStore subscribers
const lingerUntil = new Map<string, number>();  // lowercased name -> ms expiry (2B)
let prefetch: ((names: string[]) => void) | null = null;  // avatar prefetch hook (1A)
const LINGER_MS = 2500;                // 2B grace; MUST be << server TTL (60_000)
```

**Signature helper (the equality gate that stops unchanged-beat churn)**
```
// Cheap, allocation-light, order-sensitive. NOT deep equality — nested character
// blobs are irrelevant to what the sector view renders.
function signature(list: PlayerRecord[]): string
  // join over: name.toLowerCase() + '|' + currentSector + '|' + (inBattle?1:0)
  //          + '|' + (travelingUntil>now?1:0) + '|' + level
```

**Public functions**
```
setLiveSectorPlayers(next: PlayerRecord[]): void
  // 1) merge 2B linger: keep any still-lingering name that's absent from `next`
  //    (only if not explicitly gone and not expired) so a one-snapshot gap doesn't blink.
  // 2) compute signature(merged); if === liveSig -> return (NO ref swap, NO notify).
  // 3) else liveArr = merged; liveSig = sig; prefetch?.(names(merged)); notify().

applyGone(names: string[]): void
  // explicit authoritative removal (socket presence:gone). For each name:
  //   lingerUntil.delete(name)   // bypass linger — leave immediately
  // filter liveArr; if it shrank, swap ref + recompute sig + notify().

getLiveSnapshot(): PlayerRecord[]   // returns liveArr (STABLE ref between changes)

subscribe(fn: () => void): () => void   // add to subs, return unsubscribe

setPrefetch(fn: (names: string[]) => void): void   // App registers ensureAvatarsCached once
```

**React binding (hook)** — `subscribe` and `getLiveSnapshot` passed by reference, defined at module
scope (never inline), so React doesn't re-subscribe each render:
```
export function useLiveSectorPlayers(): PlayerRecord[]
  return useSyncExternalStore(subscribe, getLiveSnapshot)
```

**Invariants (enforce in review):**
- `getLiveSnapshot()` returns the **same reference** until a real content change — the single most
  common `useSyncExternalStore` bug is returning a fresh array and looping renders.
- `LINGER_MS (2500) << OFFLINE_AFTER_MS (60_000)` — linger only smooths sub-second gaps; it can
  never resurrect a genuinely-departed player.
- `applyGone` and sleeper-kill always win over linger (immediate removal).
- The store holds **only** the live sector roster in Phase 1. `playerRoster` stays in App state
  until the deferred 1C.

> **Note on `Date.now()`:** the store reads wall-clock for linger expiry. That's fine in the client
> (this is not a workflow script — the `Date.now()` restriction in the plan tooling does not apply to
> shipped client code).

## C.2 — Phase 1 edit-site map (precise, mechanical)

| # | File · anchor | Today | After |
|---|---|---|---|
| 1 | `lib/presence-store.ts` | — | **new file** per C.1 |
| 2 | `App.tsx` ~2681 | `const [liveSectorPlayers, setLiveSectorPlayers] = useState…` | **delete** (state moves to store) |
| 3 | `App.tsx` ~2852 (heartbeat) | `if (data.sectorMates) setLiveSectorPlayers(data.sectorMates)` | `if (data.sectorMates) presenceStore.setLiveSectorPlayers(data.sectorMates)` |
| 4 | `App.tsx` ~2856–2868 (heartbeat) | `setPlayerRoster(prev => …new array…)` | **1B:** compute sig(prev) vs sig(merged); `return prev` if equal, else merged |
| 5 | `App.tsx` ~2963 (socket sector) | `if (sector===cur) setLiveSectorPlayers(players)` | `if (sector===cur) presenceStore.setLiveSectorPlayers(players)` |
| 6 | `App.tsx` ~2967 (socket gone) | `setLiveSectorPlayers(prev => prev.filter(!gone))` | `presenceStore.applyGone(names)` |
| 7 | `App.tsx` ~4599–4605 (prefetch effect) | effect deps `[liveSectorPlayers, playerRoster, sharedImages]` | register `presenceStore.setPrefetch(ensureAvatarsCached)` once; keep a `playerRoster`-only effect for the roster names |
| 8 | `App.tsx` ~8491 | `liveSectorPlayers={liveSectorPlayers}` prop on `<WorldMap>` | **remove the prop** |
| 9 | `WorldMap.tsx` ~186 / ~227 | destructures `liveSectorPlayers` prop + its type | replace with `const liveSectorPlayers = useLiveSectorPlayers()` inside the component; drop the prop + type line |

Everything downstream of the `liveSectorPlayers` local in `WorldMap` (the `livePlayersHere` filter
at ~1218, the `sectorPlayers` build at ~1238) is **unchanged** — it still reads a local named
`liveSectorPlayers`, only the source differs. That's what makes this a behavior-preserving swap.

**1B signature for the roster updater** (mirror C.1's helper, roster fields):
`name|level|currentSector|village|inBattle`. If `sig(merged)===sig(prev)` → `return prev`.

## C.3 — Phase 2A/2B render + CSS spec

**Render change (WorldMap, the `.other-players-map-stack` block ~1322–1334):** key each dot by name
(already done). Add a class derived from per-name lifecycle:
- first render of a name → `is-entering` (removed after one frame / on `animationend`).
- name present in the previous render but absent now → render it **one extra cycle** with
  `is-leaving`, sourced from a render-local `Map<string, PlayerRecord>` of "last seen dots" + a
  short-lived `leaving` set; drop after the animation duration.

This "lingering exits" set is **render-local** (a `useRef<Map>` + `useState` of leaving names in
`WorldMap`), independent of the store's 2B linger. Two different concerns:
- **Store linger (2B)** = "don't even consider them gone yet" (network gap smoothing).
- **Render leaving (2A)** = "they're gone; animate the exit" (visual polish).

**CSS (new rules, additive — no existing class modified):**
```
.other-player-map-dot.is-entering { animation: peer-in 250ms ease-out; }
.other-player-map-dot.is-leaving  { animation: peer-out 350ms ease-in forwards; pointer-events: none; }
@keyframes peer-in  { from { opacity: 0; transform: scale(.85) translateY(2px); } to { opacity: 1; transform: none; } }
@keyframes peer-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(.9); } }
@media (prefers-reduced-motion: reduce) {
  .other-player-map-dot.is-entering, .other-player-map-dot.is-leaving { animation: none; }
}
```
Mirror `SectorAvatar`'s reduced-motion contract exactly (instant, no animation) so accessibility
behavior is consistent across the sector view.

**Regression guards (2A/2B):** the tooltip (`name (Lv X)`), the 💤 sleeper suffix, the click target
(`onClick={() => setSectorPlayerPos(index)}`), and the avatar/emoji fallback chain
(`sharedImages['avatar:'+name] || character.avatarImage || 🥷`) are all **untouched** — only a class
and an exit cycle are added.

## C.4 — Acceptance criteria (binary, testable)

1. **No idle re-render:** with N peers steady in a sector, React Profiler shows **0 App commits** on
   a heartbeat that changes nothing (1B), and only the sector subtree commits when the roster does
   change (1A).
2. **No pop:** a peer joining/leaving fades (250/350ms); no instant appear/disappear (2A).
3. **No blink:** dropping one `sectorMates` payload for a still-present peer does **not** remove them
   (2B); an explicit `presence:gone` or sleeper-KO **does** remove them within one frame.
4. **Parity:** same peers, tiles, names, 💤, tooltips, click→attack/challenge/sleeper-KO as before;
   all 15 `playerRoster` consumer screens still receive identical data.
5. **Caps intact:** 15-sleeper cap, 100-roster cap unchanged.
6. **Ratchet green:** `App.size.test.ts` passes (new code in `lib/`, not `App.tsx`).
7. **Lint green:** `npm run lint` in `shinobij.client/`.
8. **Reduced-motion:** transitions disabled, instant — matches `SectorAvatar`.

## C.5 — Risk register

| Risk | Likelihood | Guard |
|---|---|---|
| `getSnapshot` returns fresh ref → render loop | Med (classic bug) | C.1 stable-ref invariant + signature gate; review item #1 |
| Avatar prefetch stops firing after `liveSectorPlayers` leaves App state | Med | edit-site #7: `setPrefetch` registration; acceptance #4 verifies avatars still load |
| 2B linger shows a ghost who really left | Low | `LINGER_MS=2500 ≪ TTL`; `applyGone`/sleeper bypass linger |
| Exit animation leaks DOM nodes if a name re-enters mid-leave | Low | keyed by name; re-entry clears `leaving` + applies `is-entering` |
| Scope creep into 1C (15-file roster move) during Phase 1 | Med | explicitly deferred; Phase 1 = 1A+1B only |
| 2D mistaken for a smoothness fix and shipped unflagged | Low | 2D documented as additive feature, owner-approval + flag required, separate from the smoothness work |

## C.6 — Out of scope for Phases 1 & 2 (tracked, not done here)
Delta socket events (Part A Phase 3), HTTP→fallback demotion (Phase 4), crowd cap/canvas (Phase 5),
intra-sector AOI (Phase 6), and the CDN `no-store` change all remain in Part A and are **not** part
of this concrete plan. Phases 1+2 stand alone and deliver the "smoother with multiple players"
outcome on their own.
