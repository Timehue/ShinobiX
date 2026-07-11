# Anbu Vault Infiltration — design plan

**Status: SHIPPED to main and LIVE by default.** Full stack built (§18–19). No
opt-in flag: the server runs unless `DISABLE_ANBU_INFILTRATION=1` (emergency kill
switch), decoupled from `ENABLE_VILLAGE_WAR`; the client is on unless
`localStorage anbuInfiltration.v1 = "0"`. Runs on the base war map — an unseeded
sector falls back to its home village, and a village with no appointed Anbu
defends with its seated Kage.

A level-100 daily **sector-attrition** activity. A player infiltrates an
enemy-held war sector's base — navigating a reskinned Hollow Gate dungeon to the
supply vault — where a full-strength AI snapshot of one of that village's
appointed **Anbu** defends it. Beating the Anbu skims 1% of the sector's/village's
war economy into **cache items**, which the raider turns in to their clan or
village for standing points. **It never captures territory** — conquest stays with
Kage-declared sector wars.

All numbers below are **PROPOSED and pending balance sign-off** (per the
game-balance rules). The feature is gated so it can't affect live players until
flipped on at the L100 endgame.

---

## 1. What it is / isn't

- **Is:** a repeatable, hard, solo endgame raid that *weakens* an enemy village's
  war economy and *rewards the raider with clan/village standing*.
- **Isn't:** conquest. No Control-HP, no sector flip, no capture. That is the
  exclusive job of `api/village/sector-war.ts` and stays untouched.
- **Separate mode.** Reuses the Hollow Gate *dungeon primitives* only; shares **no
  mutable state** with the Hollow Gate progression (see §4).

## 2. Access & gating

- **Level 100** required.
- **Storyline complete → Kage systems active.** Once true, the activity is live
  free-form (no mission needed).
- Target must be an **enemy-held war sector** (not the raider's own village).
- **Missions are optional wrappers**, not the gate — an **Anbu daily mission**, a
  **clan mission**, and a generic **L100 daily** all *subscribe* to a raid-success
  event for their own progress (same pattern as `vanguard-raids` firing on raid
  completion). The raid pays out regardless of whether a mission is active.

## 3. Player loop

1. Pick an enemy-held war sector from the map.
2. Enter its **2.5D base** — advance room-to-room toward the vault (reskinned
   Hollow Gate dungeon).
3. At the vault, fight the **defending Anbu snapshot** on the tactical grid —
   full strength, boss-grade AI, defender home-terrain edge. Meant to be hard.
4. **Win:** roll a currency skim → receive cache item(s) in inventory. **Lose:**
   nothing; the Anbu held.
5. Later, **turn caches in** at the clan or village for points (§8).

## 4. Navigable base — reuse Hollow Gate as a SEPARATE mode

Reuse the Hollow Gate *dungeon stack* (all verified present):

- **Generation:** `hollow-gate-generate.ts` + `hollow-gate-maze.ts` +
  `hollow-gate-bsp.ts` + `hollow-gate-path.ts` (rooms, corridors, guaranteed
  connectivity).
- **Traversal + render:** `use-hollow-gate-walk.ts` + `HollowGateShrineView.tsx`.
- **Server-authoritative run loop:** `hollow-gate-run.ts` / `hollow-gate-server.ts`
  (behind `hollowGateServer.v1`). Required-on for this mode because the reward is
  currency and "reached the vault" must be server-verified, never client-claimed.
- **Theme hook:** `hollow-gate-variant.ts` / `hollow-gate-wings.ts`.

**Separation boundary — the two modes share only stateless map-drawing code:**

| Shared (pure primitives) | Infiltration-only (forked, never Hollow Gate) |
| --- | --- |
| generate / maze / bsp / path, walk hook, render view | own entry/screen (not the shrine) |
| | own run records (`infil-run:*`) |
| | boss = Anbu snapshot, **not** the warden |
| | **does not** bump `hollowGateWardenKills`, shards, augments, attunement, wings |
| | reward = cache items (§7), **no shards** |
| | own tile atlas (regenerated art), own flag `anbuInfiltration.v1` |

- If any primitive is currently entangled with Hollow Gate state, **extract the
  pure core into a shared module and keep Hollow Gate calling it via a
  behavior-preserving wrapper** (per the repo's refactoring rules) — do not
  copy-paste or entangle.
- **Preserve the entry-bundle code-split** (`rift-run.ts` keeps dungeon/VN data
  out of the entry bundle — a hard perf ratchet). The new mode stays lazy-loaded
  the same way.

## 5. The Anbu defender

- **Roster:** one of the target village's `anbuAppointees` (`game:village-state:<village>`,
  15 slots) — verified in `api/_war-role.ts`.
- **Snapshot:** `sealTowerFighter(char, rec, loadout)` (the Battle Towers sealer,
  `api/towers/_seal.ts`) — full equipped jutsu / bloodline / stats, "identical to a
  PvP fighter."
- **Lifecycle:** frozen at Anbu appointment, **re-sealed daily** (a daily job
  writes `anbuGarrison` snapshots into village-state).
- **AI:** the strongest available — the weekly-boss / PvE-phases-0-4 reactive,
  multi-action tier. **No band-matching, no down-scaling** — elite endgame, hard by
  design.
- **Home terrain:** the sector's terrain seals into the fight for the +10%
  home-school bonus (same mechanic sector wars already use).
- **No defender reward.** Repelling raids is the Anbu's job.
- **Selection (default, tunable):** rotate by least-recently-defended so the whole
  roster gets used and one player isn't the perpetual wall.

## 6. Reward — the drain

On a **verified win**, the server rolls one of three outcomes and computes all
amounts server-side from authoritative balances:

1. **1% of the sector's `warSupply`** (per-sector clan income).
2. **1% of the enemy village's `warResources`** (village-wide war budget).
3. **Both** (1% of each) — the rare "jackpot" roll.

Plus a **personal ryo** reward on any success (server-computed, daily-capped).

**Two independent 50%/day loss floors (both, so nothing is drained to nothing):**

- **`warSupply` ledger — per SECTOR:** cumulative daily loss caps at 50% of the
  sector's opening balance; every skim clamps ≥ 0.
- **`warResources` ledger — per VILLAGE:** caps at 50% of the village's opening WR
  that day; clamp ≥ 0. (Because WR is village-wide, this is one global shield — no
  matter how many of a village's sectors are raided, its war budget can't drop
  below half in a day.)
- **Floored-pool behavior (default):** if the rolled pool already hit its cap for
  the day, that slice pays 0; personal ryo is still granted.

> **Pool facts (verified):** `warSupply` accrues per owned sector at
> `TERRITORY_DAILY_WAR_SUPPLY = 100`/day on `world:territory:<sector>`, collected
> into the **clan** treasury (`api/_territory-supply.ts`, `collect-supply.ts`).
> `warResources` is a single **village** pool (0..`WR_POOL_CAP`), earned by the
> daily war-pass, spent on declaring sector wars / mercs / village structures
> (`api/_war-state.ts`). A sector does **not** generate WR — the raid drains the
> owning village's central pool *via* the sector base.

## 7. Caches — the inventory item

- Two item types: **War Resource cache** and **War Supply cache**.
- Land in the **event section** of inventory as **stackable** entries →
  `itemStacks[]` (the counted-stack store; stays an array), **not** `inventory[]`.
- **Stack cap: 9,999** each.
- **Denomination: 1 cache per 1 unit skimmed** (so a 40-unit skim = 40 caches; the
  enemy pool drops 40, subject to the daily floor).

## 8. Turn-in — type-locked (decision B)

- **War Supply cache → CLAN → clan points, 2:1** (2 caches = 1 clan point).
- **War Resource cache → VILLAGE → prestige / contribution points, 1:1**
  (1 cache = 1 point).
- Each cache type has a fixed home; village standing is the cheaper conversion,
  clan points cost double — a deliberate fork (ratios are a balance knob).

**Point targets (verify exact fields at build):**
- Village prestige/contribution → the village-state `contributionPoints` credited
  in `api/village/claim-map-control.ts` (server-owned; client mirrors the server
  value).
- Clan points → the clan-XP / clan-points leveling faucet.

## 9. Anti-cheat / server-authoritative flow (hard rules)

- `infiltration-start` mints a **single-use token** sealing: target sector, the
  chosen Anbu ref, the base seed/layout, and the reward params.
- Base progression is **server-validated step-by-step** (no skipping to the vault).
- The Anbu fight resolves as an **authoritative session** (tower/PvP-style), never a
  client claim.
- `infiltration-report` (settle) verifies the Anbu was beaten + vault reached,
  **rolls and computes amounts server-side**, applies both daily-loss ledgers,
  debits the enemy pool(s) and **mints caches** into the raider's save under
  `withKvLock(save:*)` via the `_economy-tx` reserve→debit→credit path ("lose,
  never duplicate"), atomically consuming the token.
- **Caches are server-minted only.** The **save sanitizer allow-lists** them to
  increase solely via the raid path and **blocks save-blob self-minting** (same
  shape that already blocks `treasury.warSupply` inflation).
- **Turn-in is its own server-authoritative endpoint** — consumes N caches
  atomically, credits clan/village points at the ratio.

## 10. Endpoints (create the `api/**` handler AND `route()`-register in `server.ts`)

- `POST /api/village/infiltration-start` — gate checks, pick + seal Anbu, seal base
  + reward params, mint run token.
- `POST /api/village/infiltration-step` — validate each room/zone advance.
- `POST /api/village/infiltration-report` — verify + roll + ledgers + mint caches +
  ryo.
- `POST /api/village/caches-turn-in` — clan (2:1) or village (1:1) redemption
  (type-locked by cache).
- Update `server-routes.test.ts` (client-call ↔ registration ↔ handler-file
  parity, both ways).

## 11. Storage keys

- `world:territory:<sector>` — add a per-sector `warSupply` daily-loss ledger
  (opening balance + cumulative loss + UTC date).
- village-war record (`game:village-war:<village>` via `villageWarKey`) — add a
  per-village `warResources` daily-loss ledger.
- `game:village-state:<village>.anbuGarrison` — sealed Anbu snapshots + `sealedAt`
  (daily re-seal).
- `infil-run:<player>:<uuid>` — single-use run record (layout, Anbu ref, sealed
  reward, progress), short TTL.
- player save `itemStacks[]` — the two cache items (server-minted, sanitizer
  allow-listed).
- `shared:img:sector-base:<sector>:*`, `shared:img:cache-*` — generated art.

## 12. Feature flags

- Behind `ENABLE_VILLAGE_WAR` **and** new `anbuInfiltration.v1` (OFF).
- Depends on the Hollow Gate server-auth run spine (`hollowGateServer.v1`) being on
  for this mode, or carrying an equivalent.

## 13. Reuse vs. genuinely new

| Reused (shipping today) | Actually new |
| --- | --- |
| Hollow Gate generator / maze / bsp / path, walk, render, server-auth run loop; `sealTowerFighter`; boss-tier AI; terrain seal; `_economy-tx` drain; mint-token; `itemStacks`; save sanitizer; mission-subscribe; `gen-asset` pipeline; `anbuAppointees` roster | navigable base **reskin** + Anbu-as-boss wiring · dual-pool 1% roll + two daily-loss ledgers · 2 cache items + turn-in ratios · 5 endpoints · daily Anbu re-seal job · 3 generated art sets |

## 14. Art to generate (paid external API — confirm count/prompts before running)

Via `gen-asset` (gpt-image-1) or Fal → WebP → `shared:img:*`:

1. **War Resource cache** icon.
2. **War Supply cache** icon.
3. **Sector-base tileset** — the reskinned Hollow Gate tiles
   (`scripts/gen-hollow-gate-tiles.mjs` re-run with sector-base prompts, keyed by
   sector + terrain).

## 15. Test surface

- Pure cores unit-tested off storage: the dual-pool roll, both 50%/day ledgers
  (floor + clamp-≥0), the 1%-and-cache denomination, turn-in ratios (2:1 / 1:1).
- `server-routes.test.ts` parity for the 5 new routes.
- Save-sanitizer tests: caches rejected via save blob, accepted via the raid path.
- Separation test: an infiltration run does **not** touch any Hollow Gate counter
  (shards / warden / attunement / wings).

## 16. Rollout phases

1. Server-auth run + Anbu fight + reward + ledgers + caches (headless, testable),
   flag OFF.
2. Turn-in endpoints + points wiring.
3. Reskinned navigable base (client) + generated tiles.
4. Cache-item art + mission wrappers.
5. Balance pass at L100, then flip `anbuInfiltration.v1`.

## 17. Balance knobs — all pending sign-off

All live in `api/_anbu-infiltration.ts` as named constants:

- Roll weights: both = 0.10 (rare jackpot), supply = 0.45, wr = 0.45.
- `SKIM_PCT` = 1; `DAILY_LOSS_CAP_PCT` = 50 (per-sector supply + per-village WR).
- `RAID_RYO_REWARD` = 500 flat (daily ceiling = attempts cap × 500).
- `MAX_RAID_ATTEMPTS_PER_DAY` = 8 (counts starts, like raid-start's mint cap).
- Turn-in: `CLAN_CACHES_PER_POINT` = 2, `VILLAGE_CACHES_PER_POINT` = 1; clan side
  also bounded by the existing clan-points pipe (250/award, 1 000/week);
  `VILLAGE_TURNIN_MAX_POINTS` = 250/call mirrors it.
- Anbu selection: least-recently-defended rotation (ties by slug).
- Floored-pool behavior: 0 slice, ryo still paid.
- `CACHE_STACK_CAP` = 9 999.

## 18. BUILD STATUS (Phase 1 — headless server backend, 2026-07-10)

Implemented, tested (43 new tests), type-checked, route-registered:

- **`api/_anbu-infiltration.ts`** — pure economy core: roll bands, both 50%/day
  ledgers (`rolloverLedger`/`applySkim`: clamp ≥ 0, tapped→0, new-day re-anchor),
  cache denomination, type-locked turn-in ratios, all balance constants.
- **`api/_anbu-infiltration-encounter.ts`** — the vault fight as a Battle Towers
  session: the raider (live human squad actor) vs the SEALED Anbu as the AI boss
  actor (`boss:true`, `aiTargetMode:'lowest-hp'`) on a synthetic floor id 9101
  (never in the public catalog), sector terrain → biome for the home edge.
  Integration-tested: the engine runs the sealed actor to termination and it
  deals damage — no template lookup, no engine changes.
- **`api/_anbu-infiltration-store.ts`** — settlement + persistence (injectable
  kv/lock/now, tower-store pattern): NX paid receipt (idempotent settle), roll →
  per-pool skim recomputed INSIDE each failClosed lock from the fresh balance,
  lazy-accrual materialization via `collectTerritorySupply` before the supply
  skim, economy-tx reserve→debit-applied→complete with "lose, never duplicate",
  caches + ryo minted under the save lock (9 999 clamp, overflow lost), turn-in
  clamps points to destination caps BEFORE consuming caches, Anbu roster load /
  least-recently-defended pick / lazy daily seal cache.
- **`api/village/anbu-infiltration.ts`** — ONE route, action switch (sector-war
  shape): `start` / `act` / `state` / `report` / `turn-in`. Registered in
  `server.ts`; route-parity green.
- **`api/save/_entitlement-guard.ts`** — both cache ids added to
  `SERVER_OWNED_ITEM_IDS` (imported from the core, no drift): a client save can
  spend caches, never mint them.

Deliberate deviations from the plan above (all safer):

1. **One route with an action switch**, not 4 separate endpoints (§10) — matches
   `sector-war.ts`, fewer registration surfaces.
2. **Daily-loss ledgers live in their own keys** (`infil-loss:supply:<sector>`,
   `infil-loss:wr:<villageSlug>`), NOT as new fields on `world:territory:*` /
   the village-war record (§11) — `normalizeVillageWarRecord` whitelists fields
   and would silently drop them; separate keys mean zero shared-schema change.
3. **Anbu re-seal is lazy** (`infil-anbu-seal:<village>:<slug>:<utcDate>`,
   sealed on first raid of the day, 25 h TTL) — no cron job needed (§11's
   "daily re-seal job" is realized without one).
4. **The supply skim materializes lazy accrual first** — stored `warSupply` is
   usually 0 between collects; the settle computes the true collectible via
   `collectTerritorySupply` inside the territory lock, skims 1% of THAT, and
   writes back the remainder with the advanced `lastSupplyAt`.

## 19. BUILD STATUS (Phases 2–4 — art + client, 2026-07-10, same session)

**Art (§14) — GENERATED + PLACED (10 gpt-image-1 assets, owner-approved spend):**
- `warvault` room theme (5 terrain tiles + 2 decos) **published live** under
  `shrine:icon-theme-warvault-*` (unused keys until the flag flips). The theme is
  deliberately NOT in `HOLLOW_GATE_THEMES`, so a real Hollow Gate run can never
  roll it — only the infiltration mode stamps it.
- Vault landmark → `shinobij.client/public/landmarks/anbu-vault.webp`.
- Cache icons → `shinobij.client/public/items/war-{supply,resource}-cache.webp`.
- Generator: `shinobij.client/scripts/gen-anbu-vault-art.mjs` (idempotent,
  `--dry-run` / `--only` / `--publish`, mirrors gen-hollow-gate-tiles.mjs).

**Client (flag `anbuInfiltration.v1`, localStorage, default OFF):**
- `src/lib/anbu-infiltration-api.ts` — flag helper + typed wrappers over the one
  server route (start / act / state / report / turn-in); fight types reuse
  towers-api (same engine shapes).
- `src/features/anbuInfiltration/AnbuVaultRaid.tsx` — the raid screen:
  traverse (lean navigable war-vault reusing ONLY the pure HG primitives —
  generate/path/visibility — every room stamped 'warvault'; strict hooks-lints
  clean, no HG state touched) → fight (reuses the WHOLE `BattleTowerFight` via
  the new optional `actionFn` prop + `settleFn`, the Clan Boss pattern) →
  result (spoils panel; mirrors caches+ryo locally via FUNCTIONAL updates).
- `src/screens/BattleTowerFight.tsx` — added optional `actionFn` override
  (defaults to `submitTowerAction`; behavior-preserving).
- `src/screens/WorldMap.tsx` — the vault **landmark structure** renders inside
  every enemy-held sector for L100 players (flag-gated), click → Infiltrate /
  Retreat prompt → the raid, both portaled to body @ z-index 1000000 (the
  overlay-portal pattern); the raid chunk is lazy-loaded so WorldMap's bundle
  doesn't grow.
- Inventory: caches registered in `stackableItemIds` (pet-config), the **Event
  tab** (`EVENT_ITEM_IDS`, item-category), and `starter-items.ts` (names,
  descriptions, generated icons via `image:`).
- Turn-in: `src/features/anbuInfiltration/WarCacheTurnIn.tsx` mounted in
  **ClanHall** (supply → clan 2:1) and **TownHall** (resource → merit 1:1);
  server-authoritative conversion, local mirror via functional updates.

**Verified:** client lint clean, `tsc -b` clean, `npm run build` green, root
suite **2662/2662** (true exit code checked — an earlier piped run masked a
failure). Adding the cache items to client `starter-items.ts` broke the
server↔client item-catalog lock-step; fixed the correct way by regenerating
`api/pvp/_item-catalog.ts` via `scripts/item-catalog-gen.mjs` (never hand-edit
it). A new parity test pins the client cache ids to the server's
`CACHE_ITEM_IDS`. In-browser E2E deliberately deferred: the route 404s until
`ENABLE_VILLAGE_WAR=1` + `ENABLE_ANBU_INFILTRATION=1` are set, so the full flow
is exercised at the QA/balance pass with envs on + seeded world state.

**Mission wrappers (§9) — BUILT (same session):** a verified raid win now fires
best-effort hooks AFTER the authoritative settle (a hook failure never unwinds
the paid reward):
- Vanguards progress their `vanguard-raids` daily missions
  (`reportMissionEvent`; completions + XP returned in the report response).
- Legacy credits `raidsCompleted: 1` + `warContribution: 500` and the era's
  `warBattles` — identical to sector-war's resolve credit (L100's real system).
- The raider's clan gets **+1 `eventContrib`** under the clan lock, which feeds
  the EXISTING clan 'raid' mission (progress = eventContrib / 3) and 'training'
  — no new clan-mission catalog entries needed.

The client↔server cache-id KEEP-IN-SYNC guard is a STATIC text parity test
(api/_anbu-infiltration.test.ts) — importing the client module from a server
test crosses module systems (nodenext vs bundler) and breaks the cpanel tsc.

**Boss room + per-village Anbu avatars — BUILT (same session):** the vault tile
is now a confrontation, not an auto-start. The four war villages
(Moonshadow/owl, Stormveil/hawk, Ashen Leaf/fox, Frostfang/wolf) each get a
generated **masked Anbu standee** — Anbu are anonymous, so the mask is the face
you see while the real appointee's loadout still drives combat (and the
defending player stays anonymous). Assets: `public/anbu/{moonshadow,stormveil,
ashenleaf,frostfang}.webp` (4 more gpt-image-1 images, owner-approved). Wiring:
`anbuAvatarForVillage` / `anbuDisplayName` in anbu-infiltration-api.ts; in
AnbuVaultRaid the Anbu holds the vault tile (you can't stand on them — reaching
it opens a **Challenge / Retreat** modal), and `maskSession()` overrides the
enemy actor's name + avatar so the mask carries into the shared fight screen.
Balance knobs (§17) reviewed and signed off by the owner.

Still to build: traversal hazard beats (optional flavor), env/flag flip, and the
QA pass E2E (needs a test environment with `ENABLE_VILLAGE_WAR=1` +
`ENABLE_ANBU_INFILTRATION=1` + seeded sectors/Anbu — the route 404s everywhere
else by design).
