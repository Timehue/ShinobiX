# Battle Towers — 4-Player Squad Tower (in the Celestial Tower)

**Status:** Plan only — no code written. Researched + verified against source 2026-06-18 via a
13-agent read-only sweep (combat session/move, hex grid, realtime, rewards, battle-lock, routing,
storage, character model, roster/AI, fullscreen UI) plus an adversarial audit that cross-checked
every handoff claim against the actual code.

> **One-line summary:** Build a new **curated, server-authoritative, N-actor squad tower** that lives
> as a *second mode inside the existing Celestial Tower hub* (beside the existing Endless climb). The
> combat engine is the hard part and it is front-loaded — async "Phase 1" is **not** a lightweight
> warm-up; it already needs ~80% of the engine generalization. Live co-op (Phase 2) is then mostly a
> transport layer over an engine that already exists.

---

## 0. The single most important finding (read this first)

The handoff sequences the work as *async Phase 1 (cheap) → live co-op Phase 2 (hard netcode) → raid
Phase 3*. **The audit contradicts that risk ordering.** The repo's combat infra is:

- The **Celestial / Endless Tower today runs in `Arena.tsx`, fully client-authoritative, 1-vs-1, with
  zero server endpoints**, and loses all rewards on death (tower report; `App.tsx` `handleEndlessWin`
  ~5482, `endEndlessBattle` ~5541). It is **not** the PvP engine.
- The **only N-actor-adjacent engine is PvP (`api/pvp/move.ts` + `session.ts`), and it is hard-coded to
  exactly two fighters** — `p1`/`p2` literally everywhere (`session.ts:57-118`): `ap:{p1,p2}`,
  `cooldowns:{p1,p2}`, `activePlayer:'p1'|'p2'`, `checkWinner` only inspects `p1.hp`/`p2.hp`
  (`move.ts:829-845`), the turn scheduler is a binary flip `current==='p1'?'p2':'p1'`
  (`move.ts:850`), and **there is no `targetId` in the move body at all** — every action implicitly hits
  the single `opp` (`move.ts:934-944,1054-1055`).
- **There is no server-side shinobi AI and no deterministic shinobi sim.** The PvE AI move-picker is
  client-side React in `Arena.tsx enemyTurn()` (~3507-3640). The only sealed/deterministic server sim
  in the repo is for **pets** (`pet-arena-sim.ts`), used by the arena lobby.

So the bulk of the work — an N-actor session container, an N-way turn scheduler, explicit target
selection, team/last-standing win logic, multi-target AOE, N spawn points, a bigger grid, and
server-authoritative shared rewards — **is required by Phase 1 regardless of whether combat is live or
async.** Phase 1 should be billed honestly as *"build and prove the N-actor server-authoritative tower
engine + bigger grid."* That's the right first slice; it's just labeled backwards in the handoff.

---

## 0.5 Locked decisions (2026-06-18)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| 1 | Grid & render | **A — modest v1 grid (~20×16 ≈ 320), keep DOM tile render** | No canvas / 24×20 / pan in v1. Reuse the existing `<button>`-per-tile renderer + `useBoardScale` zoom. ~2.7× the duel board — enough for 4 spawns + pods + objectives. Canvas + bigger grid + pan deferred to a later raid-map upgrade. (Supersedes §5's "spike then decide": the only spike left is "confirm ~320 DOM tiles + 6 actors renders smoothly," expected pass.) |
| 2 | AI / authority | **B — deterministic server-authoritative shinobi sim** (mirror the pet arena sim) | Build a new seeded, reproducible shinobi combat engine. The server independently replays/validates every floor → genuine anti-cheat + trustworthy leaderboards. Heavier than "client AI + recompute," and it **moves real engine work into Phase 1** — but it is the strongest foundation, and the *same* sim powers async (Phase 1), live co-op reward-validation (Phase 2), and leaderboards. |
| 3 | Engine placement | **Self-contained `api/towers/` engine that does NOT touch live PvP** | The deterministic sim is its own module. It **shares only pure, stateless combat-formula math** with PvP (ported, not live-imported) and **never modifies `pvp/move.ts` resolution**. The only PvP-file edits end up additive + behavior-neutral (a few `export`s + strip-list entries — and §18 shows how to avoid even those by porting). Long-term payoff: one canonical, fully-tested, server-authoritative tower engine with zero PvP regression risk. |
| 4 | Live transport | **Reframed — it's turn-based, so there is no real-time-netcode problem** | See below. |

**Decision 2 + 3 — verified determinism path.** The pet sim is the right, clean template: *"seeded LCG
(no `Math.random`/`Date`), IEEE-safe math, state quantized per tick → byte-identical replays from a
seed"* (`pet-arena-sim.ts:12-13`); entry `runPetArenaMatch(blue, red, seed)` (`:985`); `makeRng(seed)`
LCG (`:256`); RNG threaded explicitly and AI planning id-stable / no-rng (`:373,415,437`). The PvP
damage resolver is **already deterministic in its math** (formula-only, `move.ts:236,253`); its *only*
combat randomness is the flee roll `Math.random()<0.2` (`move.ts:1463`) and cosmetic effect-id
generation via `Date.now()+Math.random()` (`:1294,1343`). So the tower sim **ports the pure damage math
into the pet-sim shape** — seeded RNG for any variance, deterministic counter-based effect ids, no
`Date.now()` — rather than live-importing `applyJutsu` (which would break byte-identical replay). This
keeps PvP literally untouched and the whole tower fully reproducible/auditable. **Shared pure helpers**
(stat→damage formula constants, hex distance/AOE from `_aoe.ts`) can be imported or copied; **stateful
or RNG/id paths are ported into the sim.**

**Decision 4 — rethought for a turn-based mode.** Correct: this is turn-based co-op, just with more
players, so the "low-latency socket vs polling" framing was wrong and is dropped. In a turn-based game
**only one actor acts at a time**; the other three don't need sub-second push — they need the updated
board *after each committed action*, and they're already waiting on humans to take their turns.

- **No Socket.IO battle rooms. No 100ms SSE poll.** Both solved a latency problem that does not exist here.
- **Model:** the `tower:<runId>` KV record is the single source of truth; after each committed action the
  server writes it and the squad sees the update via a **Supabase Realtime row-subscription** (already
  built — `lib/realtime.ts`, the same Tier-0 path PvP uses, ~50–80ms when available) with a **plain
  ~1–2s poll fallback** (a relaxed cadence is perfectly fine — it's turn-based).
- The only genuinely "live" concerns are **turn timer + AFK-skip** and **reconnect**, all handled
  **server-side authoritatively**: the existing 1s Railway game-loop tick advances a timed-out turn;
  reconnect just re-reads `tower:<runId>`. These are small server features, not a transport architecture.
- Net: Phase 2 "live co-op" is **turn-handoff + timer + reconnect over the authoritative session
  record** — the cheap part, exactly as the audit predicted. This **supersedes §12's two-option framing.**

**Decision 5 — Seasons: NO. Battle Towers is a PERMANENT climb (Option A), 2026-06-18 (adjustable
later).** The tower pays **one-time first-clear rewards + milestone unlocks only** — no resetting
"season", no repeatable currency faucet. This **overrides the seasonal text in §23-K, §24, §25, §26**:
- **Leaderboard (§26):** `battleTowerRating` is an **all-time best** (monotonic → fits `LIFETIME_COUNTERS`
  cleanly). **Removed:** the season-rollover cron, `tower:season:current` + archive, `battleTowerSeasonId`,
  and the season key on the scoreboard (use a single permanent `tower:scoreboard`). The score formula
  (§26.1) and the HoL tab (§26.4) are **unchanged**. §26.3-step-5 (season reset) and the §26.5 Phase-3
  season cron are **deleted**.
- **Live-ops (§23-K):** **K1 "Season Spire" removed** — all floors pay one-time first-clear + milestones.
  **K2 weekly raid boss deferred** (it's a repeatable faucet — only revisit if we later move to Option B).
  **K3 entry keys unnecessary** for the climb (one-time rewards are inherently anti-farm). **BUT the
  borrowed-ally assist cap (§9) STILL applies** — it's a repeatable reward against offline accounts
  regardless of seasons, so its daily `kv.incr` cap + per-run NX receipt stay.
- **Affixes (§23-J):** the affix *system* stays; without seasons the set is a **fixed varied pool** (or
  swapped via content patches), not season-rotated.
- **Data model (§25):** drop `battleTowerSeasonId` and the `TOWER_SEASON_DAYS` knob;
  `battleTowerClearedFloors[]` accumulates permanently; keep `battleTowerBestFloor` (lifetime) +
  `battleTowerRating` (all-time). **Net: less to build** — no cron, no seasonId plumbing, no reset edge
  cases.

---

## 1. What "Celestial Tower" is today (verified)

"Celestial Tower" is the live in-game **name for the existing Endless Tower** (`lib/endless-tower.ts:2`
header: "Endless / Celestial Tower scaling + reward math").

- **Entry:** a CentralHub tile (`CentralHub.tsx:630-635`, `🌌 Celestial Tower`) opens a **modal**
  (`showCelestialPanel`, `CentralHub.tsx:768-795`) whose `celestial-panel-options` list currently holds
  **exactly one button** → `setScreen("endlessTower")` (`CentralHub.tsx:786`).
- **Flow:** `endlessTower` screen → `EndlessTowerLobby` (`App.tsx:8909`) → `startEndlessBattle`
  (`App.tsx:5463`) → the **shared `Arena` component** with three endless props
  (`endlessBattleActive`, `endlessBattleWave`, `onEndlessWin`/`onEndlessBattleEnd`). Win →
  `handleEndlessWin` re-rolls the next wave in the same arena. Death → `endEndlessBattle` nulls
  `endlessTowerRun` (banked rewards lost).
- **Server authority:** **none.** Grep of `api/` for endless/celestial/tower returns only the generic
  `api/battle/lock.ts` (resume-only re-entry lock) and `api/save`. Rewards/scaling/milestones all run
  client-side and persist via the normal character save.
- **Scaling:** `endlessScaleFactor`/`endlessWaveReward`/`endlessTowerMilestoneReward`
  (`lib/endless-tower.ts`) + `scaleEndlessAiClone`/`pickRandomEndlessAi` (`App.tsx:5429-5461`). Endless
  **deliberately bypasses** `lib/pve-difficulty.ts` bands (`Arena.tsx:517` `isStandardPve`).

**Where Battle Towers goes:** add a **second button** to the existing `celestial-panel-options` modal
(`CentralHub.tsx:785`) — "⚔️ Battle Towers (Squad)" beside the existing "Enter Celestial Tower"
(rename that to "♾️ Endless Climb"). The Celestial Tower thus becomes the home of both modes, exactly as
requested. The new button routes to a **new `battleTowers` screen** (new lobby module), not into the
Endless flow.

---

## 2. Claim check — every handoff assumption vs source

| Handoff claim | Verdict | Evidence |
|---|---|---|
| Current arena ≈ 12×10 = 120 hexes | **CONFIRMED** | `move.ts:39-40 GRID_W=12,GRID_H=10`; `session.ts:45 pos // 0–119 for 12×10`; client dupes `Arena.tsx:179-180`, `PvpBattleScreen.tsx:112-113`. |
| 4× grid → 24×20 = 480 is feasible | **PARTIAL** | Math closes over `gridWidth/Height` and `_aoe.ts` takes `width/height` params, **but** grid size is hard-coded in **3 client copies + `move.ts` `distance/xy/axial`**, no shared config. It's net-new code in 3+ places, not a config flip. |
| Keep 100 AP turns | **CONFIRMED** (w/ caveat) | `session.ts:902 ap:{p1:100,p2:100}`; `endTurn` refreshes to 100 (`move.ts:890/906`). Caveat: stun starts a turn at 60 AP (`STUN_AP_PENALTY=40`); hard `MAX_ACTIONS=5` cap independent of AP. |
| PvP SSE polls KV every 100ms | **CONFIRMED** | `api/pvp/stream.ts:47 POLL_INTERVAL_MS=100`. (Client tries Supabase Realtime → SSE → 1s long-poll.) For 4 players this is the cost trap to avoid copying blindly. |
| cPanel multi-worker breaks in-memory presence | **CONFIRMED, verbatim** | `online-store.ts:13-22` deployment invariant; remedy `passenger_max_pool_size=1` or Redis store. |
| Single-instance Railway realtime | **CONFIRMED** | `socket.ts:24-27`, `online-store.ts:8-11`, `game-loop.ts:3-5`; **no Redis adapter installed** (only a "Phase 9" comment). |
| Reward mint-token / sealed-payout pattern exists | **CONFIRMED** | `raid-start`→`report-raid`; canonical sealed-params example is `expedition-start`→`report-pet-event`. `withKvLock(...,{failClosed:true})` at `_lock.ts:116-118`. **No generic helper** — each feature inlines it. |
| Server-driven variable grid (W×H in session) | **UNVERIFIED / net-new** | Nothing sources grid size from the session today; literals on both sides. |
| "Celestial Tower is a screen" (implied) | **CONTRADICTED** | It's a *modal* routing to the `endlessTower` *screen*; the fight is the standard `Arena`, not a bespoke engine. |
| Async Phase 1 is the low-risk first slice | **CONTRADICTED (mislabeled)** | Phase 1 still needs the N-actor engine, bigger grid, borrowed-ally server hydration, and server-authoritative shared rewards. See §0. |

---

## 3. Target design

Two coexisting modes under the Celestial Tower:

1. **Endless Climb** (existing, untouched) — solo survival, risk-bank, client-resolved. Keep exactly as
   is per CLAUDE.md "don't rewrite working systems."
2. **Battle Towers** (new) — curated, server-authoritative, squad floors with objectives, gimmicks,
   boss floors, modifiers, and one-time rewards, balanced around **4 shinobi** on a larger tactical
   grid, launched into a **fullscreen pop-out combat shell**, rewarding **every squad member** (capped
   assist rewards for borrowed/offline allies).

Combat keeps the 100 AP / jutsu / hex identity. Movement economy is **not** redesigned in v1 (per
handoff); the larger board is paced via enemy placement, pods/waves, objectives, hazards, and boss
mechanics.

---

## 4. Architecture decision — build a new N-actor tower engine (don't extend Arena, don't fork PvP wholesale)

**Recommendation:** create a new server-authoritative module set under `api/towers/` with a new
**N-actor session model**, and **reuse the PvP resolver math** (which is the battle-tested, audited
part) without inheriting its 2-actor container.

What to **reuse as-is**:
- `applyJutsu(self, opponent, …)` and its 5 damage phases (`move.ts:730`, documented `:463-481`) — the
  pairwise resolver is fine; you call it per attacker→target pair.
- `api/pvp/_aoe.ts` (`filledDiskTiles`/`spiralTiles`/`ringTiles`/`hexDistance`) — **already takes
  `width`/`height` params**, so it is grid-size-agnostic and multi-target-ready.
- `api/pvp/_tags.ts` whitelist + the `session.ts` sanitizers (`sanitizeJutsuList`, `sanitizePvpItems`,
  `clampStatsObject`, vitals clamps, `resolveEquippedLoadout`, `stripNonCombatFields`) — reuse verbatim
  to seal each fighter snapshot.
- The PvP concurrency primitives: per-session NX lock (`pvp:<id>:lock` pattern, `move.ts:987-1012`) and
  `recentMoveTokens` idempotency ring.

What to **build new** (the 2-actor assumptions that must generalize — all from move/session reports):
- **Session container:** `actors: Record<actorId, TowerFighter>` + `side: 'squad'|'enemy'|'npc'` per
  actor, instead of `{p1,p2}`. Per-actor maps for `ap`, `cooldowns`, `statuses`, `pos`.
- **Turn scheduler:** an explicit ordered **turn queue** (array of actor ids), replacing the binary
  flip and the "round advances after p2" rule (`move.ts:850-851`).
- **Targeting:** add an explicit `targetId` (and `targetTile` for ground/AOE) to the action body;
  resolve `attacker`/`target` from the actor map instead of `me`/`opp`.
- **Win check:** team/last-standing ("all squad down" = wipe; "all enemies down" = floor clear), not
  `p1.hp`/`p2.hp`.
- **Multi-target AOE:** true AOE that resolves `applyJutsu` against every actor whose `pos` is in the
  affected tile set (today AOE only ever hits the single `opp`).
- **Auth↔actor mapping:** N-way ("the caller owns actor X"), replacing the 2-fighter
  `safeName(session[role].name)===identity.name` check.
- **Spawns:** N squad spawn points + enemy/boss zones on the larger grid (replaces `P1_START=62`,
  `P2_START=33`).

**Why not extend `Arena.tsx`:** it is strictly 1-player-vs-1-`CreatorAi`/`Character` with no party
support, and `App.tsx` is at the size ratchet (see §11). A new module is cleaner and keeps the trusted
PvP/Arena paths untouched.

**Why not fork `pvp/move.ts` in place:** generalizing the live PvP handler risks regressing the most
security-sensitive, audited code in the repo (per the PvP combat audit memory). Build `api/towers/`
beside it, importing the shared resolver + sanitizers.

---

## 5. The grid (larger board)

**Verified reality:** grid math is parameterized *in principle* (helpers close over
`gridWidth`/`gridHeight`), but:
- Hard-coded in **3 client places** (`Arena.tsx:179-180`, `PvpBattleScreen.tsx:112-113`,
  `hex-path.test.ts:11-12`) + server `move.ts` `distance/xy/axial` + two `GRID_W*GRID_H` bounds checks.
  No shared grid-config module exists.
- **No pathfinder** in Arena/PvP hex code — only greedy `nextStepToward` + pure-distance range checks.
  Movement does **not** route around walls (only the destination tile is barrier-checked).
- **Render = one absolutely-positioned `<button>` per tile.** 24×20 = **480 DOM buttons** (vs 120),
  each running per-tile `distance()`/`.some()` scans; `jutsuRangeTiles` is O(W·H) called inside tile
  loops → roughly **O(tiles²)** render cost. Layer grows to ~1314×797px.
- **No panning exists** — only auto-fit zoom (`useBoardScale`) with a floor of 0.45 desktop / 0.15
  mobile, which will shrink a 4× board below playability on phones.

**Plan:**
1. **Make grid dims server-driven.** The tower session carries `map.width`/`map.height`; the new tower
   combat component reads them from the session (not literals). Extract a small shared grid-config/helper
   module so the new client board and any server math share one source.
2. **Spike render perf before committing to 24×20** (Phase 0). If DOM at 480 tiles + 6 actors is
   janky (likely on mobile), either (a) render the board on a **canvas** (the combat VFX canvas already
   exists), or (b) ship a **more modest v1 grid** (e.g. 18×14 ≈ 252 or 20×16 = 320 — still 2–2.7× the
   duel board) and grow later. Keep "4× area" as the *design aspiration*, validated by measurement.
3. **Add pan/drag** (net-new) for the larger board, plus keep the existing zoom slider; dock controls
   at the bottom on mobile.
4. **Movement stays adjacency (`move`, 30 AP) + `dash` (≤3, 30 AP)** in v1 — no AP-economy redesign.
   Pace the board with enemy/objective/hazard placement and pods/waves, per handoff.
5. **Terrain blockers + wall-aware movement** are a **Phase 3** add: reuse the existing
   `barrierTiles`/`groundZones` shapes (`Arena.tsx:598-605`) for static walls/hazards, and add a real
   **BFS over `hexNeighbors` minus blocked** when `dash` must respect walls (net-new; today nothing
   routes around obstacles).

---

## 6. Turn model

The handoff's desired rhythm (P1 100AP → P2 100AP → boss reaction → P3 100AP → P4 100AP → boss full
turn) is a **fixed-order turn queue with scripted enemy interrupts**, not a free initiative system.

**Recommendation:** model a round as an ordered list of "turn slots" the engine walks:
`[squad[0], squad[1], ENEMY_REACTION, squad[2], squad[3], ENEMY_FULL]`. Each squad slot is a normal
100-AP turn (same `MAX_ACTIONS=5`, same AP costs, same `wait`-ends-turn contract). Enemy slots are
engine-driven (reaction = light/single action; full = the enemy side acts). This:
- avoids letting the team dump 400 AP before the boss responds (the handoff's stated goal);
- is far simpler to make async/AFK-safe than a per-actor initiative ring;
- generalizes cleanly to raid "boss reaction every N player turns" in Phase 3.

**Important inherited gotcha:** the server **never auto-ends a turn at low AP** — the client must POST a
`wait` action (verified: no `pvpMinActionCost`/auto-pass anywhere in `api/`; it's all client-side in
`PvpBattleScreen.tsx`/`Arena.tsx`). The tower client must implement the same affordability/auto-end UX,
and the server must enforce turn-timer/AFK by advancing the queue when a slot times out.

---

## 7. Data model (additive, legacy-safe)

All new fields are optional (legacy saves treat missing as "never played"), matching the
`endlessTowerRun` / `hollowGateRun` / Card Clash precedents.

**`shinobij.client/src/types/character.ts`** — add near `EndlessTowerRun`:
```ts
export type BattleTowerProgress = {
  seasonId: string;                 // e.g. "2026-06"; per-season reset
  bestFloor: number;
  bankedRyo: number;                // resume bookkeeping; server-clamped on save
  bankedXp: number;
  highestMilestoneClaimed?: number;
};
```
On `Character` (all `?`-optional):
`battleTowerProgress?: BattleTowerProgress | null`, `battleTowerClearedFloors?: number[]`,
`battleTowerBestFloor?: number`, `battleTowerClaimedRewards?: string[]`,
`battleTowerAssistRewardsClaimed?: string[]`, `battleTowerSeasonId?: string`.

**Wiring (mirror the endless fields cite-for-cite):**
- `normalizeCharacter` (`App.tsx:1476-1478` style): add `?? 0` / `?? null` / `Array.isArray(...) ? : []`
  default-fills + a season-rollover reset (model on the `lastDailyReset`/`villageWarMissionDate`
  ternaries).
- `createCharacter` (`App.tsx:~1694-1697`): seed the new defaults.
- Server `LIFETIME_COUNTERS` (`api/save/[name].ts:350`): add `battleTowerBestFloor` with a **small
  delta** so it's monotonic + can't jump 0→999.
- Server in-flight clamp (`api/save/[name].ts:608-622` style, like `ET_BANKED_RYO_CAP`/`ET_WAVE_CAP`):
  clamp `battleTowerProgress.bankedRyo/bankedXp/bestFloor`.
- Server `COMBAT_STRIP_CHAR_FIELDS` (`api/save/[name].ts:60-87`): add the `battleTower*` names so they
  don't bloat PvP opponent fetches.

**Hard rule:** per CLAUDE.md, **no Supabase schema change** — saves are a single KV JSON blob, so
additive fields need no migration. The save **must not** carry per-floor combat state (1 MB body cap;
session state lives in a dedicated KV key — §8).

---

## 8. Storage keys (consistent with existing conventions)

Server-only (service_role), `safeName()` slugs, UUIDv4 run ids as capability tokens (like `pvp:`). All
on the **base Postgres store**, never the disk overlay (so atomic NX/incr/del semantics hold).

| Purpose | Key | Notes |
|---|---|---|
| Live tower session (hot-state checkpoint) | `tower:<runId>` (`runId = tower-${uuid}`) | mirrors `pvp:<battleId>`; `{ex: SESSION_TTL}`, refresh TTL on every committed mutation. |
| Fast turn RMW lock | `tower:<runId>:lock` (NX, 3s) | mirrors `move.ts:987`. |
| Currency/shared settle lock | `withKvLock('tower:<runId>', fn, {failClosed:true})` | for reward writes. |
| Per-floor one-time claim | `tower:floor-claimed:<runId>:<floor>[:<slug>]` (NX, ≥24h) | mirrors `pvp:bounty-claimed:*`. |
| Per-member exactly-once settle | `tower-paid:<runId>:<slug>` (NX, 24h) | the real exactly-once bound. |
| Borrowed-ally assist receipt | `tower-assist-paid:<runId>:<allySlug>` (NX, 24h) | per-run double-pay guard. |
| Assist daily cap | `tower-assist-count:<allySlug>:<YYYY-MM-DD>` via `kv.incr({ex:25h})` | atomic farm cap. |
| Run mint token (sealed rewards) | `tower-token:<hostSlug>:<uuid>` (`{ex:5*60}`) | consumed via atomic `kv.del`. |

Define `SESSION_TTL` **once** (PvP duplicates it across `session.ts:128` + `move.ts:50` — don't repeat
that mistake). If the 4 clients ever subscribe to `tower:<runId>` directly via Supabase Realtime, add
`tower:%` to the RLS SELECT allowlist (`supabase-schema.sql:75-83`) + `lib/realtime.ts`; otherwise keep
it server-only and poll via an authenticated GET.

---

## 9. Reward safety (server-authoritative, per squad member)

Follow the verified `expedition-start` → `report-pet-event` template (the canonical "seal params at
start, pay strictly from sealed values, atomic single-use consume" example), **not** outcome-trust.

- **`/api/towers/start`** — host calls. Auth + per-member eligibility; per-host daily mint cap via
  `kv.incr('tower-start-count:<host>:<date>', {ex:25h})`. Snapshot each member's fighter **from their
  server save** (reuse `session.ts` sanitizers + the `_lobby-core.ts` "never trust client stats"
  pattern). Mint **one** `tower-token` sealing `{host, members[], seed, floorId, sealed reward params}`.
- **`/api/towers/action`** — validated N-actor move (the engine, §4). Server validates active actor,
  AP, cooldowns, chakra/stamina, target legality, range; NX lock + idempotency ring.
- **`/api/towers/settle`** (or auto-resolve on clear) — **recompute the clear server-side** from the
  sealed `seed + rosters`, then for each member: `kv.set('tower-paid:<runId>:<slug>', …, {nx:true})`;
  if placed, credit under `withKvLock('save:<slug>', {failClosed:true})` using
  `mergePreservingImages`. Pay from **sealed** values, never the client body. Consume the run token
  last (or rely on per-member NX receipts so one slow client can't void others' payouts).
- **Borrowed/offline ally (async):** gate on **both** a per-run NX receipt **and** a daily
  `kv.incr` assist cap; assist amount sealed in the token or a server constant. Daily-limited +
  first-clear-limited so offline characters can't be farmed.
- **One-time per floor** via `tower:floor-claimed:*` / `battleTowerClaimedRewards`. Repeatable rewards
  (if any) must be deliberately economy-safe.

There is **no generic reward-token helper** — `api/towers/` inlines its own mint/consume following the
expedition shape (the only reusable helper is PvP-pair-keyed `_ranked-match-token.ts`).

---

## 10. Endpoints, routing & tests

**No auto-routing** — each handler must be imported **and** `route()`-registered in `server.ts` (one
`route('/x', h)` call serves both `/x` and `/api/x`). Helper/data/sim files use a **leading `_`** to be
exempt from the wiring test.

New files (illustrative):
- `api/towers/start.ts` → `route('/towers/start', …)`
- `api/towers/action.ts` → `route('/towers/action', …)`
- `api/towers/state.ts` (GET reconnect) → `route('/towers/state', …)`
- `api/towers/settle.ts` → `route('/towers/settle', …)`
- Phase 2 lobby: `api/towers/lobby.ts` (create/join/leave/ready) — model on `api/arena/lobby.ts`.
- `api/towers/_engine.ts` (N-actor resolver, imports `pvp/move` math + `pvp/_aoe`), `_floor-catalog.ts`,
  `_floor-validate.ts`, `_tower-session.ts` (types) — all `_`-prefixed.

`server-routes.test.ts` enforces **both directions** (client `/api/...` call ↔ registration; handler
file ↔ import) — it will fail until wiring is correct. `npm test` runs an **explicit file list**, so
every new `*.test.ts` must be **appended to the `"test"` script** in root `package.json`.

**CORS:** prefer carrying any tower token **in the JSON body** to avoid touching the
`Access-Control-Allow-Headers` allowlist. If a new custom header is unavoidable, update it in **both**
`api/_utils.ts:161` and `server.ts`.

**Tests to add** (colocated, `_`-prefixed where helpers):
- `_floor-catalog.test.ts` — catalog shape/validity (model on `_mission-catalog.test.ts`).
- reward idempotency / replay / single-use consume (model on `_ranked-match-token.test.ts`,
  `pvp/_reward-farm.test.ts`).
- assist-cap test (new; precedent `_bank-interest.test.ts` principal cap).
- larger-grid movement/range + N-actor targeting (extend `hex-path.test.ts`, `pvp-targeting.test.ts`).
- action-validation (model on `pvp/_aoe.test.ts`, `_combat-tags.test.ts`).
- route registration auto-covered by `server-routes.test.ts`.

**cPanel/dist:** Railway self-builds (live host). Per memory, commit **server `dist/`** only after
`api/`/`server.ts` changes; do **not** commit a worktree client-dist rebuild (rolldown vs rollup
divergence). Run `npm test` (root) + `npm run lint` (client).

---

## 11. Client: screen, battle-lock, fullscreen shell, mobile

**App.tsx is at the size ratchet** — `App.size.test.ts MAX_LINES=10_451`, file is ~10,450 lines (~1
line of headroom). **All new UI is its own module** under `src/screens|components|lib`; only the
`Screen` union entry, the render-guard line, the `import`, and `setScreen` wiring may touch App.tsx.

- **Screen:** add `"battleTowers"` (lobby) + e.g. `"battleTowerFight"` to the `Screen` union in
  `types/core.ts:18`. New modules: `screens/BattleTowersLobby.tsx`, `screens/BattleTowerFight.tsx`
  (fullscreen shell), `lib/tower-engine-client.ts`, `lib/battle-tower.ts` (reward/scaling math, mirror
  `lib/endless-tower.ts`).
- **screen-guards.ts:** add the fight screen to `BATTLE_SCREENS`, add an `isUnresolvedBattle` case, and
  a `BattleGuardSignals` field (mirror the `arena` case).
- **Battle lock:** mount a `BattleLockKeeper` with `kind:"battleTower"` **per participant**, sharing a
  `meta.towerSessionId` (≤2048 bytes) and distinct `battleId` — reuses `api/battle/lock.ts` unchanged.
  Add `battleResumeStateExists` + boot re-entry/loss branches (`App.tsx:3590-3681` pattern) + a context
  persister (`battleTower.context.v1.<name>`). Note the lock is **resume-only, never reward-authoritative**
  — rewards go through §9, not the lock. Add an explicit **resolve/abandon path** for a squadmate who
  rage-quits (non-clobber lock otherwise traps them for the 1h TTL).
- **Fullscreen pop-out:** render the fight screen with the existing `arena-fullscreen` root class (it
  already escapes the `.center-game` card gutters); add the screen to the `LeftProfileCard`/`SectorBanner`
  exclusion (`App.tsx:7450-7468`); add `.screen-battleTowerFight` to the mobile chrome-hide CSS rules
  (`index.css:19139-19152`); optionally JS-hide `RightMenu` for a truly chrome-free board.
- **Shell layout** (reuse Arena's classes): squad status rail (1 `CombatSideHud` per ally — net-new
  multi-card), enemy/phase panel, combat log (`.combat-text-log`), AP/action bar (`.dual-ap-panel`),
  and a **new objective/floor tracker** (none exists today — endless only passes a wave number).
- **Mobile:** responsive `100dvh` fullscreen, **pan/zoom** on the board (pan is net-new), bottom-docked
  controls (reuse `MobileNav` spacing), squad/enemy panels collapse to tabs/drawers (drawer component is
  net-new — none exists).

---

## 12. Realtime (Phase 2 — live co-op)

Two viable transports; **recommend the proven KV-session + SSE/Realtime path first**, add Socket.IO
battle rooms only if needed:

- **Reuse (lowest risk):** the PvP transport — authoritative `tower:<runId>` KV record + `/api/towers/state`
  GET reconnect + an SSE stream like `api/pvp/stream.ts`. But **do not blindly copy the 100ms poll for 4
  players** — broadcast on action-commit, and tune the SSE interval up (e.g. 250–500ms) or prefer
  Supabase Realtime row-subscription so cost stays bounded.
- **Socket.IO battle room (optional/later):** the authed handshake (`socket.ts:148-173`), `user:<name>`
  rooms, generic emitter, and the 1s `game-loop` tick **reserved for "battle-room ticks"**
  (`game-loop.ts:41`) all exist. A `battle:<runId>` room + battle events (move/turn-advance/state-sync)
  are net-new.

**Hard constraints (verified):** single Railway instance only (no Redis adapter installed), **cPanel
must never serve live tower state** (multi-worker splits in-memory rooms/presence). Hot state in the
Railway process is viable but **dies on redeploy → KV checkpoints are mandatory** (the handoff's
"checkpoints at action commits / phase changes / reconnect / final" is exactly right). Cloudflare WS
upgrade behavior is unverified in-repo (client allows polling fallback) — confirm during Phase 2.

Lobby essentials (Phase 2): create/join/leave/ready, 4 slots, server-minted seed, ownership-validated
rosters (model on `api/arena/_lobby-core.ts`), turn timer + AFK-skip (advance the turn queue on
timeout), disconnect grace + reconnect via `/api/towers/state`, shared combat log, settle **all live
participants** (§9).

---

## 13. Floor catalog & raid mechanics (Phase 3)

- **Floor catalog** = `_`-prefixed data module + validity test: per-floor `{ id, name, mapId,
  width/height, blockedTiles, hazardTiles, objectiveTiles, enemyPods, bossFloor?, modifiers,
  objective, rewards (sealed), levelReq }`. Balanced around 4 shinobi; use **pods/waves** (a few active
  enemies + objective-triggered reinforcements) rather than flooding the board, per handoff.
- **Difficulty:** decide whether floors opt **into** `lib/pve-difficulty.ts` bands (easy/med/hard/peer
  stat ×0.8/1.0/1.15/1.3 + per-hit/turn caps) or opt **out** like Endless (own curve). A curated tower
  probably wants a **bespoke per-floor curve** (opt-out), reusing `endlessScaleFactor`-style math.
- **Raid mechanics** (additive on the Phase-2 engine): boss phases at 70/40/10% HP, marked-player
  execution, danger tiles (reuse `groundZones`), adds/summons (spawn mid-fight into the actor map),
  shields broken only by Taijutsu/Bukijutsu/Ninjutsu (gate on jutsu `type`), cleanse/shield/debuff role
  pressure, objectives beyond "kill the boss" (survive N rounds, protect an NPC, kill adds first),
  boss reaction every N player turns (the turn-queue slots from §6), enrage/fail timers, terrain
  blockers + wall-aware BFS movement (§5).

---

## 14. Phasing (re-sequenced honestly)

- **Phase 0 — Spikes (small):** (a) profile board render at target grid + 6 actors → pick DOM vs
  canvas vs smaller grid; (b) prototype the N-actor session + turn queue + `targetId` against the reused
  resolver; (c) confirm borrowed-ally server hydration fields. Decides §5/§4/§9 specifics.
- **Phase 1 — N-actor engine + curated floors (solo + AI allies, async), server-authoritative:**
  the bulk. New `api/towers/` engine reusing PvP resolver math; server-driven larger grid; new
  `battleTowers` lobby + fullscreen fight shell; floor catalog; data model; battle lock; server
  rewards (mint-token + per-member settle + assist caps). AI on both sides driven client-side with
  **server recompute/seal of rewards** (no server shinobi sim yet). Validates balance, UI, catalog,
  reward settlement, larger-map combat, 4-unit encounters.
- **Phase 2 — Live 4-player co-op:** lobby create/join/ready, turn timer/AFK, reconnect, live transport
  (KV-session + SSE/Realtime first), settle all live participants. Mostly transport over the Phase-1
  engine.
- **Phase 3 — Raid mechanics:** boss phases, marks, danger tiles, adds, type-gated shields, objectives,
  enrage, terrain + wall-aware pathing.

---

## 15. Risks / landmines

1. **2-actor hard-coding everywhere** in the only N-actor-adjacent engine (PvP). The engine
   generalization is the project's core cost and lands in Phase 1.
2. **No server shinobi AI / no deterministic shinobi sim.** Async AI-ally squads have no server brain
   to replay against → Phase 1 must either ship a "trust-the-orchestrator + recompute/cap currency"
   reward model (acceptable under the mint-token pattern) **or** build a deterministic shinobi sim early
   (a hidden Phase-1 cost the handoff doesn't budget). **Decide explicitly.**
3. **Render perf at 24×20** (480 DOM nodes, ~O(tiles²) scans, no pan, mobile auto-fit floor). Spike
   first; canvas or a smaller v1 grid may be required.
4. **No pathfinder; movement ignores walls.** Wall-aware movement is net-new (Phase 3).
5. **App.tsx size ratchet** (~1 line headroom) — all new UI in new modules.
6. **Borrowed-ally combat data is stripped** from roster + foreign `?combatOnly=1` reads
   (`jutsu/jutsuMastery/equipment/stats/bloodlines` gone) — the server must hydrate ally fighters from
   raw `save:<name>`; the exact human-fighter snapshot fields are net-new (pets have `PetSnapshot`).
7. **No clan-members API** — squad-from-clan needs new plumbing (membership lives in `save:clan-<slug>`).
8. **cPanel must never serve live tower state**; single Railway instance only (no Redis adapter); hot
   state dies on redeploy → checkpoints mandatory.
9. **Don't copy the 100ms PvP SSE poll for 4 players** — broadcast on commit / use Realtime.
10. **Economy safety** — rewards to 4 members + assist rewards must be server-authoritative, idempotent
    per member, daily/first-clear-capped, and one-time-per-floor; never pay from client values.

---

## 16. Decisions for you (genuine forks — **all DECIDED 2026-06-18, see §0.5**)

1. **Grid size / render tech** — *Rec:* spike first; if 480 DOM tiles janks, ship a modest v1 grid
   (e.g. 20×16) and/or canvas render, keep 24×20 as the aspiration. Or commit up front to net-new
   pan+canvas work for the full 4× board.
2. **Engine: new `api/towers/` reusing PvP resolver math** (Rec) **vs** generalizing `pvp/move.ts` in
   place (risks the audited PvP path).
3. **AI execution in async Phase 1:** client-driven AI + server reward-recompute/cap (Rec — matches
   today's Arena, cheapest) **vs** build a deterministic server shinobi sim early (stronger anti-cheat,
   bigger cost).
4. **Turn model:** fixed-order queue with scripted enemy interrupts (Rec) **vs** per-actor initiative
   ring.
5. **Difficulty:** bespoke per-floor curve, opt out of `pve-difficulty` bands (Rec for a curated tower)
   **vs** reuse the easy/med/hard/peer bands + caps.
6. **Live transport (Phase 2):** reuse KV-session + SSE/Realtime (Rec) **vs** build Socket.IO battle
   rooms now.
7. **Squad sourcing for async allies:** friends + public roster first (Rec — simplest) **vs** also build
   clan-members plumbing now.

---

## 17. File-by-file change map (anchors)

**New (client):** `types/character.ts` (+`BattleTowerProgress`), `screens/BattleTowersLobby.tsx`,
`screens/BattleTowerFight.tsx`, `lib/battle-tower.ts` (math), `lib/tower-engine-client.ts`,
`lib/tower-grid.ts` (shared grid config), `screens/BattleTowersLobby.test.ts`-style tests.

**New (server):** `api/towers/start.ts`, `action.ts`, `state.ts`, `settle.ts`, `lobby.ts` (P2),
`_engine.ts`, `_floor-catalog.ts`, `_floor-validate.ts`, `_tower-session.ts`, + colocated `_*.test.ts`.

**Touched (small, surgical):**
- `CentralHub.tsx:785-787` — second modal button.
- `types/core.ts:18` — `Screen` union entries.
- `App.tsx` — `Screen` render-guards (~7547 block), `normalizeCharacter` (~1476), `createCharacter`
  (~1694), boot re-entry/loss branches (~3590-3681), nav-lock signals (~5636), chrome exclusion
  (~7450), battle-lock keeper wiring. **Keep additions to the import + guard + wiring lines only**
  (size ratchet).
- `lib/screen-guards.ts` — `BATTLE_SCREENS`, `isUnresolvedBattle` case, `BattleGuardSignals` field.
- `index.css` — `.screen-battleTowerFight` chrome-hide + fullscreen escape rules.
- `server.ts` — imports + `route()` for each new endpoint.
- `api/save/[name].ts` — `LIFETIME_COUNTERS`, in-flight clamp, `COMBAT_STRIP_CHAR_FIELDS`.
- `package.json` "test" — append new test files.
- (Optional) `supabase-schema.sql` RLS + `lib/realtime.ts` only if clients subscribe to `tower:%`.

**Reused unchanged (PvP resolution NOT affected — verified §18):** `api/pvp/_aoe.ts`, `api/pvp/_tags.ts`,
`api/_lock.ts`, `api/_storage.ts`, `api/battle/lock.ts`, `components/BattleLockKeeper.tsx`,
`lib/use-board-scale.ts`, `lib/hex-path.ts`. **`api/pvp/move.ts`'s damage *math* is the source for the
ported tower sim, but `move.ts` itself is not edited.** **`api/pvp/session.ts` is NOT "reused verbatim"**
— its public sanitizers (`sanitizeJutsuList`, `sanitizePvpItems`, `stripNonCombatFields`) are importable,
but `hydrateCharacterFromSave`/`clampStatsObject`/`makeFighter`/`resolveEquippedLoadout`/`sanitizeMastery`
are module-private; per Decision 3 (zero PvP impact) **port them into `api/towers/` rather than adding
`export`s** (see §18-C).

---

## 18. Cross-system impact (verified blast radius) & corrections to this plan

A second read-only audit traced what the plan actually touches. **Headline: PvP balance / damage / tag
resolution / ranked is NOT affected** — `pvp/move.ts` resolution, `_aoe.ts`, `_tags.ts`, `_lock.ts`,
`battle/lock.ts`, and `presence-gating.ts` predicates are untouched. But the "additive/isolated" claim
**breaks at specific shared edges**, and the first draft of this plan **missed three of them.**
Corrections (these are now part of the plan):

**A. Economy caps will NOT clip squad rewards — IF you use the server-`settle` path (now mandatory).**
Crediting under `withKvLock('save:<slug>', {failClosed:true})` + `mergePreservingImages` (the PvP
`claim-rewards.ts:212` / mission `claim-mission.ts:206` mechanism) **bypasses `sanitizeCharacterSave`
entirely**: the next client autosave reads the server-credited value back as its baseline → zero delta →
nothing to clip. The trap: the lazy "client credits then saves" path (what the existing Endless Tower
does) **will** be clipped by `MAX_RYO_GAIN`/`CURRENCY_CAPS`/`MAX_XP_PER_MINUTE` *and* is exploitable.
**Enforce server-settle in the start ticket.**

**B. THREE drift-prone strip lists — two are UNAUTHENTICATED leak surfaces (plan originally listed
only one).** `battleTowerProgress` nests `bankedRyo`/`bankedXp`, and the public projections are
**blacklists**, so the nested object passes silently unless explicitly added:
- `api/save/[name].ts:60` `COMBAT_STRIP_CHAR_FIELDS` — was listed (correct).
- `api/pvp/session.ts:347` `SESSION_STRIP_CHAR_FIELDS` — **WAS MISSED.** Omitting it leaks banked
  currency into the **unauthenticated** `/api/pvp/session` GET + SSE spectator feed.
- `api/player/roster.ts:49` `ROSTER_STRIP_CHAR_FIELDS` — **WAS MISSED.** Omitting it leaks banked
  currency to the **unauthenticated public roster/leaderboard** (the name-regex only inspects the
  top-level key, which passes).
→ Add the tower progress field to **all three**. **Better:** keep durable progress on the save as a
plain non-currency counter and keep banked currency **only** inside the transient `tower:<runId>`
session, sidestepping the leak surface entirely.

**C. PvP session helpers are module-private (plan mislabeled "reuse verbatim").**
`hydrateCharacterFromSave`, `clampStatsObject`, `makeFighter`, `resolveEquippedLoadout`,
`sanitizeMastery` are not exported. Per Decision 3, **port their logic into `api/towers/`** instead of
adding `export`s to the audited PvP file — so PvP is literally untouched. `sanitizeJutsuList`,
`sanitizePvpItems`, `stripNonCombatFields` are already exported and safe to import.

**D. Presence `inBattle` whitelist — WAS MISSED, and is the most likely shipped bug.** `inBattle` is
client-driven from a hard-coded screen whitelist in `App.tsx:2823` **and** `:2975`. A new
`battleTowerFight` screen is absent → a player mid-tower-fight reports `inBattle:false` and **stays
PvP-attackable/challengeable**, so a third party can pull them into a PvP session while they hold a
tower battle-lock → double-battle / lock contention. **Fix: add the tower fight screen to BOTH
whitelists.**

**E. Refresh-restore is 5+ duplicated, untested lists, and the default path is DESTRUCTIVE.** A new
battle `kind` must be wired into: `battleResumeStateExists` (`battle-save.ts:98`; unknown kind →
`false`), the boot resume branch **and the cleared-state penalty branch** (`App.tsx:3590-3683`; unknown
kind → `hp:0 + hospitalized + outcome:"loss"`), the real nav-lock `isUnresolvedBattle` switch
(`screen-guards.ts:81`; unknown → `default:false` → **player can walk out of an active fight**), the
`inBattleRef` signal wiring (`App.tsx:5637`), **and** a second ad-hoc battle-screen list at
`App.tsx:2685` (clan-war auto-launch can otherwise yank a player out of a tower fight). Note
`BATTLE_SCREENS` (`screen-guards.ts:41`) is **dead/inert** — adding your screen there does nothing.
None of these have test coverage. **Co-op specifics:** (1) refreshing during a 4-player fight must NOT
unilaterally bank a loss — the cleared-state branch needs tower-specific semantics; (2) the per-player
non-clobber battle-lock makes tower **mutually exclusive** with all other PvE/PvP per player, and a
rage-quit traps the player out of *all* combat for the 1h TTL unless the explicit resolve/abandon path
(§11) is wired.

**F. `App.tsx` is a HARD blocker, not a footnote.** ~1 line of headroom vs `MAX_LINES=10_451`, but the
unavoidable wiring (render block + boot resume/loss branches + signal wiring + the `:2685` and
`:2823`/`:2975` edits) is **~20–35 App.tsx lines**. You **must drain ≥~30 lines out of App.tsx first**
(extract a hook/helper to a module, lower `MAX_LINES`) before any tower wiring can land, or `npm test`
fails the build. **Budget this as Phase 0 prep.**

**G. Desktop chrome:** `LeftProfileCard` is hidden only for `arena`/`storyBoss`/`pvpBattle`
(`App.tsx:7452`) — add the tower fight screen there or the profile card overlaps the board on desktop.
**Reuse the `.arena-fullscreen` class** for the combat container to inherit all mobile scroll/escape
rules for free (a brand-new class gets none of them).

**Net:** PvP combat is safe; the real cross-system surface is (i) the economy must use server-settle,
(ii) two unauthenticated leak lists + the presence whitelist were missed and are now required edits,
(iii) the refresh-restore/nav-lock web is the highest-regression-risk client area and has no test gate,
and (iv) draining App.tsx is a hard prerequisite.

---

## 19. Design inspiration — G Generation Eternal "Generation Tower" + genre patterns (researched 2026-06-18)

The concept maps almost 1:1 onto G Gen Eternal's **Generation Tower** (East/West towers): you form **two
free squads**, climb floors that are single-map tactical battles, each with a **mission type**, terrain
domains, and **buff/debuff zones**; bosses start at **Floor 10**; entry is **free with unlimited
retries**; rewards are **one-time first-clear** loot + **milestone unit drops** at landmark floors; gated
behind a player rank. We adopt that skeleton, expressed through our 100-AP hex combat, and layer in
proven patterns from Spiral Abyss / HSR endgame / Slay the Spire / RAID / FFXIV.

**Adopt directly (the headline design):**
- **Free entry, unlimited retries, manual tactical puzzle** — gate by **level/rank, not stamina**. (Note:
  "no AP cost" in G Gen = no *entry energy*. We keep the **in-battle 100-AP/turn** economy untouched —
  the two are different. So: no entry cost + unlimited retries, but the same in-fight AP combat.)
- **Boss floors from a threshold** (e.g. F10). Lower floors = "defeat all" warm-ups; upper floors layer
  a named boss + one signature gimmick each.
- **A fixed menu of ~6–8 floor objective types** (enumerated below), rotated per floor.
- **Squad ≠ rarity check.** No minimum unit count, intentional empty slots allowed; the gate is *tactics
  + positioning*, not roster power.

**Floor objective catalog (the `objective` field in `_floor-catalog.ts`):**
1. Defeat all enemies. 2. Defeat the boss only (ignore trash). 3. Defeat all, then the boss.
4. Protect an NPC / "guest" shinobi (fails if it dies). 5. Kill + escort (clear while NPC survives).
6. Reach a goal tile within a round limit. 7. Break an objective across phase/HP gates.
8. Survive N rounds (boss unkillable). 9. Kill summoned adds first (boss shielded until adds die).
(Round/turn limits are tight in G Gen — 3–4 turns; for 4-player we use a **round budget** as a star tier,
not a hard fail, except on explicit timed floors.)

**Map mechanics (reuse our existing `groundZones` + `barrierTiles` primitives):**
- **Terrain domains** = our biomes (forest/water/rooftop/open/etc.) with per-shinobi aptitude affecting
  damage/accuracy (G Gen aptitude is *both* a damage and accuracy modifier — stronger than a flat ±%).
- **Buff/debuff zones** (ATK / DEF / chakra) — park DPS on attack tiles, tanks on fortified tiles; a
  squad may **start on a debuff tile** and must reposition turn 1.
- **Hazard "no-go" zones** (G Gen MAP-weapon ranges) — entering them invites a big AoE; maps include a
  safe pocket. **Mid-battle terrain mutation** (a region floods/changes domain) for upper floors.
- **Aura sources** — an allied NPC projects a buff radius the squad moves to cover.

**Layered affixes (keep curated content fresh — cheap to author, infinitely re-mixable):**
- **Field rule per floor** (unchosen) — Spiral Abyss "Ley Line Disorder": hazard (chakra drain/round),
  debuff (element-X jutsu cost +AP), or buff (taijutsu crits).
- **Drafted boon, 1-of-3 at floor entry** (Benediction/Cacophony) — squad agency keeps fixed maps
  replayable.

**Boss depth (Phase 3, but designed in now):** HP-threshold **phases** (66%/33% → new moveset / field
rule / adds) + a **turn-count enrage** (DPS check) + an **element/discipline-locked barrier** (forces
comp diversity — a pure-taijutsu team stalls) + a **marked target** each round (tank intercepts / squad
stacks) + **adds** that contest the objective hexes.

**Turn rhythm (the anti-alpha-strike answer to the handoff's P1→P2→boss→P3→P4 idea):** interleave the
boss into the round via an **AP/Speed-seeded turn queue** with scripted boss-interrupt slots; the **100-AP
per-turn cap is itself the anti-dump guard** (no one can solo-burst the boss in a turn). Author boss
mechanics that each demand a **role** (tank-buster, cleanse-only debuff, DPS-only barrier) so a 4-shinobi
squad fields tank/heal/cleanse/DPS, not 4 nukers.

**Reward structure (three zones + the primary anti-faucet) — reconciles "reward everyone" with economy
safety (§9):**
- **First-clear floors (1…N): one-time** account-progression loot (Spiral Abyss "Chamber's Bounty"
  model). Climb-to-unlock **milestone rewards** at landmark floors (G Gen's UR-unit drops) — everyone in
  the squad who clears gets it.
- **A season-resetting top "Spire" segment**: repeatable currency, leaderboard, **affix set rotates per
  season** (~biweekly–monthly, HSR's 6-week cadence is a good upper bound).
- **(Phase 3) Weekly co-op raid boss**: paid from **damage-milestone chests** (capped — past the
  milestone, more attacks give nothing), full-kill one-time doubler.
- **Primary anti-faucet = entry keys/tickets** (e.g. 1 free key/day + a weekly bundle) on the *rewarding*
  segments, **plus the borrowed-ally assist cap** (§9). Free unlimited retries apply to *clearing*, not
  to *re-earning* repeatable loot.

**Deferred-but-noted (great, but change the action economy → not v1):** G Gen's **"Chance Step"**
(killing blow → immediate bonus action) and a **Tension/momentum→crit** bar. Both are excellent fits for
a later expansion; they're out of v1 because the handoff freezes the AP/movement economy for now.

Sources: G Gen Eternal Generation Tower guides (ldplayer, vortexgaming, invenglobal, note.com, ldshop,
mumuplayer); G Gen series wikis (Overworld/World/Genesis Fandom, Wikipedia, Cross Rays Steam combat
guide); genre — Genshin Spiral Abyss, HSR endgame (Game8), Slay the Spire Ascension, Arknights I.S.,
RAID Hydra, FFXIV common mechanics. (Full URL list in the research transcript.)

---

## 20. Phase 0 — Foundations & de-risking (must finish before any Phase 1 wiring)

Two verified corrections drive Phase 0: **(a) App.tsx has exactly 1 line of headroom** (10,450 vs
`MAX_LINES=10_451`) and the unavoidable tower wiring is **~25–40 lines** (the boot resume/loss branches
are mandatory and bulky — not the ~5 a naive estimate assumes); **(b) the pet sim NEVER runs
server-side** — the server only seals seed+rosters (`resolveMatch`) and the *client* simulates. So
Decision 2 (server independently replays/validates floors) is **net-new server infrastructure**, not a
copy of an existing server replay. Phase 0 de-risks both before committing to Phase 1.

| Task | What | Verified anchors / acceptance |
|---|---|---|
| **P0.1 Drain App.tsx** | Extract `ClanWarsPanel` (~187 lines, `App.tsx:10258-10381`, already `export function`, props-only, single consumer) → `src/screens/ClanWarsPanel.tsx`; repoint `ClanHall.tsx:28` import; re-export from App for back-compat. Then **lower `MAX_LINES`** to the new count + small buffer. | Frees ~187 lines (need ~40). `npm test` green; `App.size.test.ts` re-ratcheted. Behavior-preserving verbatim move (CLAUDE.md refactor rules). Smallest alt if preferred: `useSharedNow` block (`App.tsx:846-866`, 2 consumers). |
| **P0.2 Render-perf spike** | Throwaway harness (mirror `/petvfx.html` pattern): a ~20×16 (320-tile) DOM hex board with 6 actors + range/AOE highlights; measure desktop + mid mobile. Decide final grid dims. | Go/no-go on DOM at ~320 tiles; if janky, drop to ~18×14 or move the board to the existing combat `<canvas>`. Output: a number + locked grid dims. No production code. |
| **P0.3 Deterministic-sim spike** | Stand up `api/towers/_sim.ts` skeleton: port `makeRng` LCG (`pet-arena-sim.ts:256`) + a trivial 2-actor resolve using ported `statFactor`/`EP_MULTIPLIER=32`/`MAX_STAT=2500`. Prove **node-runnable with zero client imports** and **byte-identical replay**. | `_sim.test.ts`: same `(seed, inputs)` → identical serialized result twice, under `node --import tsx --test`. De-risks Decision 2 (net-new server replay). |
| **P0.4 Leak-safe data model** | Add additive `Character` fields — **but keep banked currency only in the transient `tower:<runId>` session**; durable save fields are plain counters (`battleTowerBestFloor`, `battleTowerClearedFloors[]`, `battleTowerSeasonId`, `battleTowerClaimedRewards[]`). Add names to **all three** strip lists (`save/[name].ts:60` `COMBAT_STRIP`, `pvp/session.ts:347` `SESSION_STRIP`, `roster.ts:49` `ROSTER_STRIP`) + `LIFETIME_COUNTERS` + in-flight clamp. Wire `normalizeCharacter`/`createCharacter`. | Save round-trips; **new test** asserts no tower currency in roster/session/spectator projections (closes the §18-B leak). |
| **P0.5 Floor-catalog schema + validator** | `api/towers/_floor-catalog.ts` + `_floor-validate.ts` + `_floor-catalog.test.ts` (mirror `api/missions/_mission-catalog.ts`/`.test.ts`, incl. its inline-replica drift-detector). Encode the §19 floor/objective/map/affix/reward schema; author ~5 seed floors. Append the test to the `package.json` `"test"` list. | Catalog-validity test green; `_`-prefix auto-exempts from `server-routes.test.ts`. |

---

## 21. Phase 1 — N-actor engine + curated floors (solo + AI allies, async, server-authoritative)

Builds the whole engine + content + server authority + UI. Live co-op (Phase 2) is then transport over
this. **Group A/B are server (Node), Group C is client, Group D ships it.** File list, imports-vs-ports,
and determinism constraints are all verified in §17 + the research transcript.

**Group A — Deterministic engine (server, `api/towers/`, all `_`-prefixed → route-test-exempt):**
- **P1.A1 `_tower-session.ts`** — the N-actor session type: `actors: Record<actorId, TowerFighter>` +
  `side`, `turnQueue: actorId[]`, `activeActorId`, `round`, `apByActor`/`cooldownsByActor`/
  `statusesByActor`, `groundEffects[]`, `map{width,height,blockedTiles,hazardTiles,objectiveTiles}`,
  `objectiveState`, `phaseState`, `seed`, sealed roster, `status`/`winner`, `recentMoveTokens`,
  `rewardSettlementState`, `createdAt`/`lastActionAt`. **Port** (private in `session.ts`) `makeFighter`,
  `hydrateCharacterFromSave`, `clampStatsObject`, `resolveEquippedLoadout`, `sanitizeMastery`; **import**
  the exported `PvpFighter`/`PvpStatus`/`PvpGroundEffect` types + `sanitizeJutsuList`/`sanitizePvpItems`/
  `stripNonCombatFields`.
- **P1.A2 `_engine.ts`** — **port** all 5 resolve phases + every constant/formula from `move.ts`
  (`EP_MULTIPLIER=32`, `MAX_STAT=2500`, `K_DR=0.5`, `K_AMP=0.5`, `HEAL_FLAT/SHIELD_FLAT=750`,
  `GUARD_DEFENSE_MAX_MIT=0.5`, the inlined `statFactor` clamp, `getOffense/Defense`, `cappedPostDamage`,
  pierce clamp [100,900], etc.); **import** `_aoe.ts` (grid-param'd) + `_tags.ts` (pure). Build the
  **N-actor turn scheduler** (side/queue + boss-interrupt slots — §19), **explicit `targetId`**,
  **team/last-standing win-check**, **true multi-target AOE**, **server-driven W×H grid** + **N spawn
  placement**. **Replace** the flee `Math.random()` (`move.ts:1463`) and the `Date.now()+Math.random()`
  effect ids (`:1294/:1343`) with **seeded RNG + counter ids**.
- **P1.A3 `_sim.ts`** — deterministic AI policy (id-stable planning, seeded RNG only for variance) for
  enemies **and** async allies; `runTowerFloor(sealedRosters, floor, seed)` → result + tick/event stream
  for client replay. **This is the net-new server replay Decision 2 requires.** Honor the 5 determinism
  constraints (seeded LCG only, no `Math.random`/`Date.now`, IEEE-safe, explicit RNG threading, stable
  ids). `_sim.test.ts` = byte-identical replay.

**Group B — Server-authoritative endpoints (register each in `server.ts`, both paths; token in body → no CORS change):**
- **P1.B1 `start.ts`** → `route('/towers/start')` — auth + per-member eligibility; daily mint cap via
  `kv.incr('tower-start-count:<host>:<date>',{ex:25h})`; snapshot squad **from saves** (sanitizers);
  `crypto.randomInt(1,0x7fffffff)` seed (like `arena/lobby.ts:144`); mint `tower-token` sealing
  `{members,seed,floorId,sealed rewards}` (expedition-start shape).
- **P1.B2 `action.ts`** → `route('/towers/action')` — validate active actor / AP / cooldown / chakra /
  stamina / target legality / range; NX lock `tower:<runId>:lock` + `recentMoveTokens` ring; write
  session, refresh TTL; notify squad (Realtime row-update — §0.5 Decision 4).
- **P1.B3 `state.ts`** → `route('/towers/state')` — GET reconnect (read `tower:<runId>`, `no-store`).
- **P1.B4 `settle.ts`** → `route('/towers/settle')` — **recompute the clear server-side via `_sim`** from
  sealed seed+rosters; per-member exactly-once: `tower-paid:<runId>:<slug>` NX +
  `withKvLock('save:<slug>',{failClosed:true})` + `mergePreservingImages` (the cap-bypass path, §18-A);
  one-time floor claim ledger; **assist faucet**: `tower-assist-paid:<runId>:<ally>` NX +
  `tower-assist-count:<ally>:<date>` daily `kv.incr` cap.

**Group C — Client (new modules; App.tsx wiring lands only AFTER P0.1 drain):**
- **P1.C1 `screens/BattleTowersLobby.tsx`** — squad assembly (pick 3 allies from friends/clan/public
  roster, hydrated server-side via combat-save; **server must hydrate ally loadouts from raw
  `save:<name>`** since roster/foreign reads strip them — §17 roster); floor select; objective/affix
  preview; rank gate. Add the **second button** to the `celestial-panel-options` modal in
  `CentralHub.tsx:785`.
- **P1.C2 `screens/BattleTowerFight.tsx`** — fullscreen `.arena-fullscreen` shell (inherits mobile
  scroll/escape rules); server-driven grid; squad status rail (1 `CombatSideHud`/ally); enemy/phase
  panel; **objective/floor tracker** (net-new); combat log; AP/action bar; reuse Arena `.combat-layout`
  classes. `lib/tower-engine-client.ts` renders authoritative state / replays the `_sim` tick stream;
  Supabase Realtime subscription on `tower:<runId>` + ~1–2s poll fallback.
- **P1.C3 Integration wiring (post-drain, ~25–40 App.tsx lines + the guard modules):** `Screen` union
  (`core.ts`); render guard; `inBattleNow` whitelists **both** `App.tsx:2823` **and** `:2975`;
  `inBattleScreen` list `App.tsx:2685`; `inBattleRef` signal + deps `App.tsx:5638`; boot **resume +
  loss** branches `App.tsx:3590-3682` with **co-op semantics (a refresh must NOT unilaterally bank a
  loss)**; `screen-guards.ts` (`BATTLE_SCREENS`, `BattleGuardSignals`, `isUnresolvedBattle` case);
  `battle-save.ts:98` `battleResumeStateExists` `kind==="battleTower"` branch; per-participant
  `BattleLockKeeper kind:"battleTower"` + an explicit **resolve/abandon** path (rage-quit else locks the
  player out of all combat for 1h); `.screen-battleTowerFight` chrome-hide CSS + `LeftProfileCard`
  exclusion (`App.tsx:7452`).

**Group D — Tests & ship:**
- **P1.D1** `_engine.test.ts` (N-actor targeting, team win-check, multi-target AOE, range on the big
  grid), `_sim.test.ts` (byte-identical determinism), `_floor-catalog`/`_floor-validate`, reward
  **idempotency + replay + assist-cap**, and the **projection-leak** test (P0.4). Append each to the
  `package.json` `"test"` list (explicit, not glob).
- **P1.D2** `server-routes.test.ts` green (endpoints registered both directions); `npm test` (root) +
  `npm run lint` (client). For cPanel: `npm run build` + commit **server `dist/`** only (Railway
  self-builds; do not commit a worktree client-dist rebuild — memory).

**Phase 1 honest cost note:** Decision 2 (deterministic server sim) front-loads real engine work — the
`_sim` is net-new (the pet sim never ran server-side), and the N-actor generalization of the resolver
(Group A) is the bulk of the project. That's the right place to spend it: the same engine then powers
async (Phase 1), live co-op reward-validation (Phase 2), raid floors (Phase 3), and leaderboards.

---

## 22. Phase 2 — Live 4-player co-op (transport + lobby + timers over the Phase-1 engine)

Reframed per Decision 4: **this is turn-based, so it is NOT netcode.** Phase 2 adds a lobby, a
server-driven turn loop with a timer/AFK-skip, reconnect, and live state-sync — all over the
authoritative `tower:<runId>` record built in Phase 1. **Hard constraints (verified):** single Railway
instance only (no Redis adapter installed); **cPanel must never serve these routes** (multi-worker
splits in-memory presence/rooms); hot state is fine in the Railway process but **dies on redeploy → the
KV `tower:<runId>` checkpoint is the source of truth**, not RAM.

**Group E — Lobby (server):**
- **P2.E1 `lobby.ts`** → `route('/towers/lobby')` — create / join (4-char code) / leave / ready / start.
  Model on `api/arena/lobby.ts` + `_lobby-core.ts`: KV `tower-lobby:<code>`, `LOBBY_TTL`, state machine
  `lobby → ready → running`, 4 slots. Each member's fighter is snapshotted **server-side from their own
  `save:<name>`** (never client stats). On `start`, run the Phase-1 `start.ts` seal path
  (`crypto.randomInt` seed + sealed rosters) → produces the `tower:<runId>` session.
- **P2.E2 Entry gates** — per-member rank/level gate; reject a member who is already `inBattle`
  (presence) or holds a `battle-lock`; require all 4 `ready` before `start`.

**Group F — Live turn loop (server-authoritative):**
- **P2.F1 Multiplayer turn ownership** — extend `action.ts`: only the **active actor's owner** may act;
  on commit, advance the turn queue and write the session. (The Phase-1 engine already does N-actor
  resolution; this adds the "whose turn / who is allowed" auth layer for live humans.)
- **P2.F2 Turn timer + AFK-skip** — ride the **existing 1s game-loop tick** (`game-loop.ts:41` is
  explicitly reserved for "battle-room ticks"). Per-run turn deadline = `lastActionAt + TURN_TIMEOUT`;
  when exceeded, the server auto-advances the active actor (server-side `wait`) and increments an AFK
  counter; after N consecutive skips, that actor goes **AI-driven via the `_sim` policy** (the squad
  isn't softlocked by one absent player). This is the turn-based analog of PvP's `claim-afk-win`
  (`move.ts` consecAutoWait).
- **P2.F3 Disconnect grace + reconnect** — set presence `inBattle` while in a live tower; on disconnect,
  a grace window before AFK kicks in; reconnect just re-reads `tower:<runId>` via `state.ts`.

**Group G — Transport (turn-based → cheap):**
- **P2.G1 Broadcast-on-commit** — after each `action.ts` write, clients see the new state via the
  **Supabase Realtime row-subscription** on `tower:<runId>` (`lib/realtime.ts`, ~50–80ms) with a
  **~1–2s poll fallback**. **No 100ms poll, no Socket.IO battle rooms.** (Optional later: a Socket.IO
  "your turn" nudge to the `user:<name>` room via the existing emitter, only if Realtime latency proves
  insufficient.)
- **P2.G2 Auth on read** — unlike PvP's unauthenticated spectator stream, gate `tower:<runId>` reads to
  **run members** (it carries live co-op state); spectator mode, if ever wanted, is a separate decision.

**Group H — Settle all live participants:**
- **P2.H1** `settle.ts` pays **every live participant** the normal floor-clear reward via the per-member
  NX receipt + `withKvLock(save, failClosed)` path. The **assist cap is only for async/offline borrowed
  allies** (Phase 1) — live humans each get the full clear reward, idempotently.

**Acceptance:** a 2-client → 4-client live playthrough; turn handoff, timer/AFK-skip, disconnect+reconnect
all work; rewards settle exactly once per member; nothing runs on cPanel.

---

## 23. Phase 3 — Raid mechanics + live-ops (depth on top of the Phase-1/2 engine)

All boss/affix mechanics are **authored as data in `_floor-catalog.ts`** and **interpreted by `_engine`**
— so new floors are content, not code. Schema fields are designed in Phase 0; mechanics are implemented
here.

**Group I — Boss / raid mechanics (`_engine` + catalog schema):**
- **P3.I1 HP-threshold phases** — `phaseState`; at 66% / 33% the boss swaps moveset / adds a field rule /
  spawns adds. Each threshold demands a different response, not just bigger numbers.
- **P3.I2 Marked target** — each round the boss marks an actor; next boss turn a heavy hit lands on that
  hex unless a tank intercepts (stands adjacent/between) or the squad stacks to share it.
- **P3.I3 Discipline/element-locked barrier** — boss shield breakable **only by jutsu of type X** (gate
  on `jutsu.type` via `_tags`); a single-discipline squad stalls → forces comp diversity.
- **P3.I4 Adds / summons** — spawn into the `actors` map at thresholds; objective may require killing
  adds first (boss invulnerable until adds die); adds can contest objective hexes.
- **P3.I5 Enrage** — hard enrage (at round X the boss one-shots = DPS check) and/or soft enrage (stacking
  +damage per round / shrinking safe area).
- **P3.I6 Danger tiles / hazards / terrain blockers** — static walls (`barrierTiles`, non-expiring) +
  hazard zones (`groundZones`) authored per floor. **Wall-aware movement**: add a **BFS over
  `hexNeighbors` minus blocked** for `dash` (net-new; only needed once terrain blockers ship — today
  nothing routes around walls).
- **P3.I7 Objective mechanics** wired into `objectiveState`: survive-N-rounds, protect-NPC,
  hold-hex / tower-soak, reach-tile-in-N, kill-adds-first (schemas from Phase 0).

**Group J — Affix / modifier system:**
- **P3.J1 Field rule per floor** (unchosen) — one passive from {hazard / debuff / buff} applied each
  round (Ley Line Disorder model).
- **P3.J2 Drafted boon (1-of-3)** at floor entry — sealed into the run so the server recompute honors it.
- **P3.J3 Prestige ladder** — tower tiers add stacking modifiers (enemy +AP regen → +HP → smarter AI →
  dual-boss finale), sealed per run (Slay-the-Spire Ascension model).

**Group K — Live-ops economy (per Decision 5 = Option A, no seasons):**
- **P3.K1 ~~Season "Spire"~~ — REMOVED.** No resetting segment, no repeatable currency faucet. All floors
  pay **one-time first-clear rewards + milestone unlocks**; the leaderboard is the all-time board (§26).
- **P3.K2 ~~Weekly co-op raid boss~~ — DEFERRED.** It's a repeatable faucet; only build it if we later
  move to Option B (key-throttled permanent faucet). If revived: damage-milestone chests (capped),
  full-kill one-time doubler, weekly key throttle.
- **P3.K3 Entry keys — NOT NEEDED for the climb.** One-time first-clear rewards are inherently anti-farm
  (each floor pays once); free unlimited retries remain. **The borrowed-ally assist cap (§9) is the one
  anti-farm guard that STILL applies** — offline allies earn a small capped reward each borrow regardless
  of seasons, so its daily `kv.incr` cap + per-run NX receipt stay.

**Acceptance:** raid floors play; comp diversity is genuinely enforced (single-discipline squads stall on
barriers); season reset + leaderboard + key economy work; idempotency/cap tests prove no economy exploit.

---

## 24. Sample v1 floor catalog (concrete content — illustrative, balance TBD)

A 15-floor v1 tower (the "Spire"), boss floors at **5 / 10 / 15**, milestone rewards at 5/10/15. Uses the
real biomes (`forest/snow/volcano/shadow/central`), the §19 objective menu, and the affix layers. This
makes the abstract schema tangible; exact stats/rewards are tuning, not architecture.

| F | Objective | Biome / map | Field rule (affix) | Encounter | Boss | First-clear reward | Milestone |
|---|---|---|---|---|---|---|---|
| 1 | Defeat all | forest, open | none (tutorial) | 3 grunts, 1 pod | — | ryo + xp | — |
| 2 | Defeat all | forest, ATK/DEF zones | buff: taijutsu crit | 4 grunts | — | ryo + Bone Charms | — |
| 3 | Reach goal tile ≤6 rounds | snow, choke + hazard | hazard: chakra drain/round | 4 blockers | — | ryo + xp | — |
| 4 | Protect NPC (genin) | central, aura tile | debuff: start-tile debuff | 5 grunts, 1 pod wave R2 | — | Fate Shards | — |
| 5 | **Defeat boss** (phase 1) | volcano, MAP-hazard pocket | buff: ATK zone center | 3 grunts + **mini-boss** | HP-phase ×1, marked target | rare jutsu scroll | **Milestone: cosmetic title** |
| 6 | Defeat all except boss, then boss | shadow, debuff field | debuff: genjutsu +AP | 5 + boss-last | — | ryo + Aura | — |
| 7 | Hold-hex / tower-soak | central, 2 hold tiles | hazard: off-tile AoE/round | 4 + respawns | — | Bone Charms | — |
| 8 | Kill adds first (boss shielded) | snow, adds spawn tiles | buff: heal-on-kill (drafted 1-of-3) | boss + 3 adds | barrier until adds die | rare item | — |
| 9 | Survive 6 rounds | volcano, shrinking safe zone | soft-enrage: +dmg/round | endless adds | — | Fate Shards | — |
| 10 | **Defeat boss** (2 phases) | shadow, danger tiles | debuff: element-locked | boss + pods | phases 66/33%, **discipline-locked barrier** | UR-equivalent recipe | **Milestone: signature unlock** |
| 11 | Escort (kill + NPC survives) | forest, aura battleship | buff: drafted 1-of-3 | 6 + NPC | — | ryo + Aura Dust | — |
| 12 | Reach goal ≤5 rounds (MAP-hazard) | central, mutating terrain | hazard: terrain floods R3 | gauntlet | — | rare scroll | — |
| 13 | Defeat boss only (ignore trash) | volcano, hazard pockets | debuff: chakra +cost | trash + boss | marked + adds | Mythic Seal | — |
| 14 | Kill-adds + survive enrage | snow, hold tiles + adds | enrage at R8 | boss + waves | soft-enrage + barrier | rare item | — |
| 15 | **Defeat boss** (3 phases) finale | shadow, full mechanics | prestige modifiers stack | boss + dual-add | phases 70/40/10%, marks, barrier, **hard enrage** | top milestone reward | **Milestone: capstone cosmetic + currency** |

**Reward layer (per Decision 5 = Option A, no seasons):** **all 15 floors pay one-time first-clear
rewards + milestone unlocks** (account progression); there is no resetting "Spire" / repeatable currency.
Clearing is free + unlimited-retry; the leaderboard is the all-time Floor Clear Score board (§26).

---

## 25. Cross-cutting specs (data model, economy knobs, tests, sequencing)

**Final data model (durable on save = leak-safe counters only; volatile state in `tower:<runId>`):**
- Save (`Character`, all optional): `battleTowerBestFloor:number`, `battleTowerClearedFloors:number[]`,
  `battleTowerClaimedRewards:string[]`, `battleTowerAssistRewardsClaimed:string[]`,
  `battleTowerSeasonId:string`. **No banked currency on the save** (avoids the §18-B leak surfaces).
- Session (`tower:<runId>` KV, TTL-refreshed): `actors{}`, `side`, `turnQueue[]`, `activeActorId`,
  `round`, `apByActor`, `cooldownsByActor`, `statusesByActor`, `groundEffects[]`,
  `map{width,height,blockedTiles,hazardTiles,objectiveTiles}`, `objectiveState`, `phaseState`, `seed`,
  sealed rosters, `status`, `winner`, `recentMoveTokens`, `rewardSettlementState`, `createdAt`,
  `lastActionAt`.

**Economy tuning knobs (named server constants — set during balance, not architecture):**
`TOWER_KEYS_PER_DAY`, `TOWER_WEEKLY_KEY_BUNDLE`, `TOWER_ASSIST_CAP_PER_DAY`, `TOWER_SEASON_DAYS`
(~biweekly–monthly), `MILESTONE_FLOORS = [5,10,15]`, per-floor first-clear payouts, Spire repeatable
payout curve, raid-boss damage-milestone thresholds. All payouts flow through the server-`settle` path
(§18-A) so the save caps never clip them; the caps remain as a tamper backstop.

**Testing matrix (each colocated `_*.test.ts`, appended to `package.json` `"test"`):**
- `_sim.test.ts` — byte-identical replay from `(seed, sealed rosters, floor)`; no `Math.random`/`Date`.
- `_engine.test.ts` — N-actor targeting (`targetId`), team/last-standing win-check, true multi-target
  AOE, range/movement on the larger grid, turn-queue + boss-interrupt order.
- `_floor-catalog.test.ts` / `_floor-validate.test.ts` — every floor has a valid objective/map/affix/
  reward shape (drift-detector replica, mirror `_mission-catalog.test.ts`).
- reward tests — per-member idempotency (NX receipt), replay protection (`recentMoveTokens`),
  assist-cap (daily `kv.incr`), and the **projection-leak** test (no tower currency in roster/session/
  spectator output).
- `server-routes.test.ts` — auto-covers `start/action/state/settle/lobby` once registered both ways.

**Dependency / sequencing graph:**
`P0.1 drain` → unblocks all App.tsx wiring. `P0.3 sim spike` + `P0.4 data model` + `P0.5 catalog` →
unblock `P1.A` (engine). `P1.A` → `P1.B` (endpoints) → `P1.C` (client) → `P1.D` (tests/ship). Phase 1
complete → `P2` (live co-op is pure addition over the engine). `P2` → `P3` (raid mechanics are data +
engine extensions). Each phase is independently shippable.

**Definition of done, per phase:**
- **P0:** App.tsx drained + re-ratcheted (green); grid dims locked; `_sim` proves byte-identical replay;
  leak-safe data model round-trips with a passing projection test; floor-catalog validator green.
- **P1:** a solo+AI-ally squad clears a curated floor in the fullscreen shell; server independently
  recomputes the clear; every squad member is paid once; assist allies are capped; `npm test`+lint green;
  server `dist/` committed (Railway self-builds).
- **P2:** 4 live humans clear a floor with turn timer/AFK/reconnect; all paid once; cPanel never serves it.
- **P3:** raid floors enforce comp diversity; season reset + leaderboard + key economy live; no economy
  exploit (idempotency/cap tests green).

---

## 26. Hall of Legends — Floor Clear Score leaderboard (server-authoritative)

Goal: rank each floor clear by **speed, HP remaining, damage done, action efficiency, deaths, and
objective completion** — a graded score, surfaced in Hall of Legends. Verified against how the existing
boards actually work, so it plugs into the established patterns (the ranked-ladder flat field + the
weekly-boss dedicated store) instead of inventing a parallel system.

> **Per Decision 5 (no seasons / Option A):** the rating is an **all-time best** (monotonic). Wherever
> this section says "season" — read it as permanent. `battleTowerRating` never resets; the scoreboard key
> is just `tower:scoreboard` (no `<seasonId>`); §26.3-step-5 (season reset) and the §26.5 Phase-3 season
> cron are **dropped**. Everything else (the formula, the HoL tab, the server-authoritative write) is
> unchanged.

### 26.1 The Floor Clear Score formula (computed server-side, never client-reported)

Every metric comes from the **deterministic sim result** recomputed in `settle.ts` (Decision 2) — the
sim is the authoritative source for all of them (verified: nothing in the repo persists per-fight
damage/rounds/HP today; the sim produces them honestly, closing the hole weekly-boss leaves by trusting
client-reported damage). Inputs: `roundsUsed`, `roundBudget(floor)`, `squadHpRemaining`/`squadHpMax`,
`deaths`, `damageDealt` (+ `enemiesFelled`/`scoreTarget` on horde floors), `apSpent`, `apPar(floor)`,
`objectiveStars`.

```
speedTerm      = clamp((roundBudget - roundsUsed) / roundBudget, 0, 1)   // faster = higher; dead members…
survivalTerm   = squadHpRemaining / squadHpMax                            // …contribute 0 hp → deaths hurt
efficiencyTerm = clamp(1 - apSpent / apPar, 0, 1)                         // fewer actions/AP = higher
damageTerm     = objectiveType === 'horde'
                    ? clamp(enemiesFelled / scoreTarget, 0, 1)            // horde: total felled matters
                    : clamp(1 - overkill / max(1, damageDealt), 0, 1)     // boss: reward clean, not padded, damage
perfMult       = 1 + W.speed*speedTerm + W.survival*survivalTerm
                   + W.efficiency*efficiencyTerm + W.damage*damageTerm
score          = round( FLOOR_BASE[floor] * DIFFICULTY_MULT[floor] * perfMult )
                   + (deaths === 0 ? B.noDeath : 0) + objectiveStars * B.star
```
- Default weights `W = { speed:0.40, survival:0.35, efficiency:0.15, damage:0.10 }` — **tunable
  constants**, not architecture. `FLOOR_BASE[floor]` grows with depth so harder floors are worth more.
- **On "overall damage done":** it's in the formula as `damageTerm`, but **objective-aware on purpose** —
  on a fixed boss encounter total damage is ~capped by enemy HP, so rewarding raw damage there just
  incentivizes overkill padding; instead boss floors reward *clean* damage (low overkill) and horde/score
  floors reward total felled. This keeps "damage" meaningful without being gameable.
- **Stars (1–3)** by sub-goals (★ clear · ★ under round budget · ★ no deaths / full objective) — Spiral
  Abyss model; the leaderboard ranks by the **raw score** for finer granularity than stars.
- **Attribution:** a clear's score is the squad's; each participating member banks it as *their* best on
  that floor. A player's **season tower rating** = Σ (best score per floor cleared this season) — a
  personal climb metric (works identically for a live 4-human squad or async player+AI-allies).

### 26.2 Storage — hybrid, matching what ranked + weekly-boss actually do

- **(a) Roster-surfaced flat fields (free, ships in Phase 1 — the ranked-ladder pattern):**
  add to `Character` a flat `battleTowerRating:number` (season aggregate, the headline board) and a
  monotonic `battleTowerBestFloor:number` (lifetime "deepest floor" board). Both are single sortable
  numbers HoL ranks client-side via `sortedTop` — **zero new endpoint**, exactly like `rankedRating` /
  `totalEndlessTowerWins`. `battleTowerRating` must be **surfaced** (kept out of the strip lists, like
  `rankedRating`); the nested `battleTowerProgress` (banked currency) must be **stripped** from all three
  lists per §18-B.
- **(b) Dedicated per-floor detail board (Phase 3 — the weekly-boss pattern):** a KV object
  `tower:scoreboard:<seasonId>` = `Record<floorId, Record<slug, BestClear>>` where
  `BestClear = { slug, name, score, rounds, hpPct, damage, apSpent, deaths, stars, ts }`. Read endpoint
  `api/towers/scoreboard.ts` (GET, `s-maxage=60`, modeled on `api/ranked-season.ts`); HoL fetches it on
  tab open (the `/api/weekly-boss` dedicated-fetch pattern) and renders **server-ranked** rows + a
  per-floor sub-selector (the Professions `professionFilter` UI pattern — the only existing drill-down).
  Ship (a) first; add (b) when you want the metric-breakdown detail view.

### 26.3 Server write (in `settle.ts`, P1.B4 — where rewards already settle)

1. **Per-(run,floor,player) NX receipt** for the write: `kv.set('tower-score:<runId>:<floor>:<slug>', …,
   {nx:true, ex:24h})` — replay-safe (mirrors `pvp:ranked-rating:<slug>:<battleId>` + the §9
   `tower-paid:` receipt).
2. **MAX-merge** under `withKvLock('save:<slug>', …, {failClosed:true})`: read fresh, set
   `battleTowerRating = max(prev, recomputedSeasonRating)` and per-floor best, persist via
   `mergePreservingImages` (the §18-A cap-bypass path — so the server score isn't clipped by the autosave
   clamps).
3. **Anti-spoof backstop:** add `battleTowerBestFloor` to `LIFETIME_COUNTERS` (`save/[name].ts:350`) with
   a small per-save delta (monotonic-up, can't jump 0→999 from a tampered client POST). Guard
   `battleTowerRating` the way `rankedRating` is — written server-side only; the legitimate increment path
   is `settle.ts`, never the client save.
4. **Dedicated object (b):** RMW under `withKvLock('tower:scoreboard:<seasonId>', …)`,
   `if (candidate.score > stored[floor][slug]?.score) stored[floor][slug] = candidate` (the weekly-boss
   `damageByPlayer` lock pattern, but MAX not `+=`).
5. **Season reset:** `battleTowerRating` resets per season via a rollover job (mirror
   `api/cron/_ranked-season.ts`: archive top-N to `tower:season:archive:<id>`, soft-reset ratings under
   per-save lock) — added to the daily cron; the dedicated scoreboard resets simply by writing to the new
   `tower:scoreboard:<seasonId>` key (old ones TTL out). `battleTowerBestFloor` is lifetime (never resets).
   Per-floor cleared state resets via the `battleTowerSeasonId` rollover in `normalizeCharacter` (§7).

### 26.4 Hall of Legends wiring (verified exact steps)

1. `App.tsx:10383` — add `"battleTowers"` to the `LbTab` union.
2. `HallOfLegends.tsx:128-140` — add `{ id: "battleTowers", label: "Battle Towers", icon: "🗼" }` to `tabs`.
3. `HallOfLegends.tsx` (in `.hol-board`, after the `endless` block) — add `{tab === "battleTowers" && …}`:
   the season board via `sortedTop(c => c.battleTowerRating ?? 0)` (+ optional lifetime sub-board on
   `battleTowerBestFloor`, like the village-wars multi-board); add the dedicated-fetch per-floor detail
   later (Phase 3).
4. `StartScreen.tsx` — the `getValue`/`getSuffix`/`getLabel` `switch (t)` over `LbTab` (`:246/264/281`)
   **won't compile** until `case "battleTowers"` is added (or it's put in the no-op group). Only add it to
   the public `tabs` array if you want it pre-login.
5. `types/character.ts` — add `battleTowerRating?`, `battleTowerBestFloor?`; default-fill in
   `normalizeCharacter` / `createCharacter` (the endless-field pattern). Add the `battleTower*` nested
   currency to the three strip lists (§18-B); leave the flat `battleTowerRating`/`battleTowerBestFloor`
   surfaced.

### 26.5 Phase placement & tests

- **Phase 1:** `settle.ts` computes the score from the sim result and writes `battleTowerRating` /
  `battleTowerBestFloor`; add the **roster-surfaced HoL board (a)**. New test: **score determinism** —
  same `(seed, rosters, floor)` → identical score every time; and a **clamp/anti-spoof** test (direct
  save POST can't inflate the rating past the `LIFETIME_COUNTERS` delta).
- **Phase 3:** dedicated `tower:scoreboard:<seasonId>` store + `api/towers/scoreboard.ts` + the per-floor
  detail board + the season-rollover cron.

(Append all new tests to the `package.json` `"test"` list; the score formula constants live beside the
floor catalog so balancing is data, not code.)

---

## 27. Re-verification vs main `586f0560` (2026-06-18) — anchors refreshed, no assumption broken

A 5-agent re-sweep after fast-forwarding to main tip `586f0560` (hollow-gate work, a save-sanitizer
parity pass, the **ClanWarsPanel drain**, and a new **multi-action PvE AI** all landed). **Verdict: every
port, pattern, leak requirement, and mechanism in this plan is INTACT.** The drift is line numbers + two
real facts below; values/logic unchanged.

**A. App.tsx budget (supersedes §0.5/§11/§16-F/§20/§21):** App.tsx is now **10,228 lines**,
`MAX_LINES = 10_231` → **3 lines headroom** (the plan's "1 line / 10,451" is stale; the ClanWarsPanel
drain ratcheted the budget down). The drain prerequisite is *firmer*, not different.

**B. P0.1 drain candidate CHANGED — `ClanWarsPanel` is already drained (commit `3b2f0eb7`).** New
candidates (current lines, behavior-preserving, verified):
- **`PetArenaBattlefield`** (`App.tsx:9328-10159`, ~832 lines, props-only, ONE consumer `petvfx.tsx:10`,
  all deps are module imports) — biggest single win.
- **`adminIconOptions`** (`App.tsx:791-822`, ~32 lines, pure const, ONE consumer `AdminPanel.tsx`) — safest.
- **`useSharedNow`** (`App.tsx:848-868`, ~21 lines, 2 consumers) — small/clean.
Chosen first drain: the two small clean ones (`adminIconOptions` + `useSharedNow` ≈ 53 lines) for
low-risk high-fidelity moves with comfortable buffer; `PetArenaBattlefield` held in reserve.

**C. New reusable AI (commit `586f0560`) — a NET POSITIVE for the tower sim (P1.A3).** It added **pure,
deterministic, RNG-free** modules the server sim can PORT directly: `lib/combat-ai-tactics.ts`
(`buildPlayerRead`, `classifyPlayerAction` — pure perception, unit-tested) and `pveAiCompetence(level)` in
`lib/pve-difficulty.ts` (per-band behaviour ladder). It also made PvE enemies take **full 100-AP /
5-action multi-action turns** (Arena.tsx), confirming §6's turn model is now consistent across PvE too.
**Still 100% client-only** (no `api/**` touched) → Decision 2's "no server shinobi sim → build net-new"
finding stands; P1.A3's AI policy now has reusable pure pieces to port instead of writing from scratch.

**D. Anchor drift table (values/logic unchanged — re-anchor citations):**

| Anchor | Plan cite | Current |
|---|---|---|
| App.tsx MAX_LINES / headroom | 10_451 / ~1 | **10_231 / 3** |
| move.ts flee `Math.random` | :1463 | **:1519** |
| move.ts effect-ids | :1294/:1343 | **:1323/:1372** |
| move.ts statFactor / raw-dmg / checkWinner / turn-flip | — | **:503 / :515 / :831 / :852** (values identical) |
| session.ts SESSION_STRIP | :347 | **:361** (still strips `endlessTowerRun`) |
| session.ts private sanitizers (port) | — | hydrate :476, clampStats :549, makeFighter :636, resolveLoadout :440, sanitizeMastery :343 |
| save/[name].ts LIFETIME_COUNTERS / in-flight clamp | :350 / :608-622 | **:376 / :648-662** (hollowGateRun block :664-677) |
| roster.ts ROSTER_STRIP | :49 | **:22** (regex :97 unchanged) |
| normalizeCharacter / createCharacter | ~1476 / ~1694 | **:1412 (fills :1478-1480) / :1632 (seeds :1696-1698)** |
| character.ts EndlessTowerRun / hollowGateRun precedent | :116 | **:116-126 / :333** |
| screen-guards isUnresolvedBattle (BATTLE_SCREENS dead) | :81 | **:85-117** (hollowGate template cases :100, :110-111) |
| battle-save battleResumeStateExists | :98 | **:98-144** (hollowGateTiles kind :135-141 = template) |
| CentralHub celestial modal / button | :768 / :785 | **:768-795 / :785-790** (byte-accurate) |
| LbTab union | :10383 | **:10161** (StartScreen has THREE exhaustive switches :246/:264/:281 → tower tab = 5-site edit) |
| inBattleNow whitelists / inBattleScreen / inBattleRef | :2823,:2975 / :2685 / :5636 | **:2824,:2976 / :2686-2690 / :5542-5549** |
| boot resume / loss branches / LeftProfileCard excl. | :3590-3681 / :7450 | **:3591-3630 / :3631-3686 / :7381-7394** |
| Arena enemyTurn / isStandardPve / barrier+zones / grid | :3507 / :517 / :598-605 / :179-180 | **:3833 / :538 / :620,:627 / :181-182** (Arena now 5154 lines) |

**No `battleTower*` field exists anywhere yet — clean greenfield.** The §18-D/E co-op hazards (presence
whitelist, destructive default loss branch, clan-war yank list) are all still present and unfixed → the
plan's mitigations remain required.

---

## 28. Party size (2–4) — scalable squad (Decision 6, 2026-06-18)

Battle Towers supports a **2–4 player party as a run PARAMETER**, not a fixed count — a duo, trio, or
full squad run the same floors. This is near-free because the engine is N-actor (§4); it would have been
a painful retrofit on a 4-hardcoded engine (like the existing 2-hardcoded PvP engine).

**Shipped in P0 (tested):**
- `api/towers/_floor-catalog.ts`: floors carry an optional `balanceFor` (the party size their enemy
  counts / boss HP are tuned for; default `MAX_PARTY_SIZE = 4`). Helpers `partyScaleFactor(partySize,
  balanceFor)` (sub-linear enemy-strength multiplier, floor `PARTY_SCALE_FLOOR = 0.6`, never scales up)
  + `scaleEnemyStat(value, factor)` (HP/damage scaler, floor 1). `getFloorBalanceFor` defaults to 4.
- `api/towers/_floor-validate.ts`: validates `balanceFor ∈ [2,4]`.
- `_floor-catalog.test.ts`: full-party → 1.0, duo → 0.6, trio → 0.75, clamping, `scaleEnemyStat`.

**Design:** floors are authored at the **max party (4)**; smaller parties scale **enemy HP + damage
only** — the map, enemy positions, pods, and objective are preserved, so the tactical puzzle stays
intact (a duo faces the same board, just survivable). The 0.6 floor keeps a duo a real fight, not a
pushover. The curve is a tunable starting point for the balance pass.

**Phase 1 wiring (when those modules land):**
- `_tower-session.ts`: add `partySize: number` to the session (sealed at `start`).
- `_engine.ts` encounter builder: apply `scaleEnemyStat(stat, partyScaleFactor(session.partySize,
  getFloorBalanceFor(floor)))` to each enemy/boss when building fighters.
- `start.ts`: seal `partySize` into the run token, derived from the lobby/squad size (server-validated 2–4).
- Lobby: a party-size selector (2–4) or distinct "Duo / Squad" entries; live co-op (Phase 2) just allows 2–4 slots.
- **Leaderboard:** the Floor Clear Score already normalizes by *squad HP fraction*, so a single
  `battleTowerRating` board is roughly party-size-fair; split into per-party-size brackets only if
  stricter fairness is wanted (deferred until there's data).

**Net:** 2-player (and 3-player) towers come essentially for free from the 4-player build; the only added
cost is the balance-tuning pass on the scaling curve.

---

### Implementation status (live)

**Phase 0 COMPLETE — verified green** (`npm test` 1190/1190, client `tsc -b` clean, client lint clean,
size ratchet green):
- **P0.1** App.tsx drain (`adminIconOptions`→`data/admin-icons`, `useSharedNow`→`lib/use-shared-now`;
  10,228→10,188; `MAX_LINES` 10,231→10,191).
- **P0.3** deterministic-sim spike (`api/towers/_sim.ts` + test — byte-identical replay proven).
- **P0.4** leak-safe data model (5 additive `Character` fields; `battleTowerRating` fully
  server-authoritative via `maxDelta:0`; stripped from combat/session/roster; leak-guard test).
- **P0.5** floor catalog + validator + 5 seed floors + tests; **plus party-size 2–4 scaling (§28).**
- **P0.2** render perf — de-risked by Decision 1=A; validate when the board component is built.

**Next:** Phase 1 — `_tower-session.ts` (N-actor session, incl. `partySize`) + `_engine.ts` (port the
5-phase resolver + N-actor scheduler + `targetId` + team win-check + party scaling) → `start`/`action`/
`state`/`settle` endpoints → client lobby + fullscreen fight shell.
