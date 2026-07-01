# Launch-Readiness Implementation — Handoff

Self-contained handoff so a fresh session can continue without re-reading the prior chat.

## 1. Snapshot  (updated 2026-06-30 — see §10 for the latest session)
- **Branch:** `claude/great-swartz-b8b2a5` (feature branch off `main`). **NOT pushed.** Working tree clean. Tip `c2bcba59`.
- **Tests:** `npm test` (repo root) = **1917 passing, 0 failing**. Server typecheck (`npx tsc -p tsconfig.cpanel.json --noEmit`) clean. Client (`cd shinobij.client && npx tsc -b && npm run lint`) clean. Both dists rebuilt + committed.
- **Safety:** every balance-affecting change is behind a flag **default OFF** → byte-identical to pre-session behavior. Nothing is live until a flag is flipped.
- **Status:** the entire server-side anti-fabrication / ceiling-enforcement / lock-hardening backbone is DONE. Only VISUAL (P0.5) + SIGN-OFF-gated balance (HEAL, P0.3b) items remain — see §10. Sections §2–§9 below are historical; §10 is the authoritative current state.

## 2. Commits this session (6)
| Hash | Summary |
|---|---|
| `62bb8132` | **Wave A** — P0.4 fail-closed locks + mentor reorder; P0.3a EP clamp 600→60 + amp-tag dedup; P0.2a per-minute currency window; P0.6 heartbeat slim; TD.1 dead-code; P0.5 Central nav; P0.1-sub4 pet jutsu-power ceiling |
| `dbae0953` | P0.1 **sub-2** — server-stamp bloodline rank for correct caps |
| `14446f31` | P0.1 **sub-3 + sub-1** — bloodline rank entitlement + point budget (**Critical C1 closed**) |
| `bf970348` | P0.1 **sub-5** — custom-item bonus budget |
| `306646dc` | **P0.2b server foundation** — daily-soft-capped AI-fight reward endpoint |
| `2a312291` | P0.2b endpoint → **return-only** (race-free) |

## 3. Flags
**Already ACTIVE (Wave A — not flagged; byte-identical for honest players, tamper-defense/QoL):** fail-closed currency/war locks, PvP EP clamp + amp-tag dedup, heartbeat slim, Central Hub nav, dead-code removal, pet jutsu-power ceiling, per-minute currency window (disable with `DISABLE_CURRENCY_WINDOW=1`).

**Flag-gated, default OFF (flip to activate — these are the balance changes):**
- `BLOODLINE_RANK_ENTITLEMENT` (env) — sub-3
- `BLOODLINE_RANK_CAPS` (env) — sub-2
- `BLOODLINE_BUDGET_SERVER` (env) — sub-1
- `ITEM_BONUS_BUDGET` (env) — sub-5
- `aiFightServerAuth.v1` (client localStorage) — P0.2b (needs the client rewire below first)

**Enable sequence (when ready):**
1. **One-off save audit first:** scan `save:*` for `savedBloodlines` with `rank` `A Rank`/`S Rank` and count them — so flipping entitlement doesn't clamp a legit holder to B (a wiped/migrated save lacking the bloodline would re-baseline to B).
2. `BLOODLINE_RANK_ENTITLEMENT=1` first (clamps forged ranks down).
3. then `BLOODLINE_RANK_CAPS=1` + `BLOODLINE_BUDGET_SERVER=1`.
4. optionally `ITEM_BONUS_BUDGET=1`.
5. Set env flags on **both Railway AND cPanel** (must match, like `SESSION_SECRET`). Restart needed.
6. Budget/rank values are the exact client ports (parity-tested) — no tuning needed. For P0.2b tune `AI_FIGHT_SOFT_CAP_PER_DAY` (50) / `AI_FIGHT_REDUCED_MULT` (0.25) in `api/missions/_ai-fight-reward.ts` before flipping.

## 4. IMMEDIATE NEXT TASK — P0.2b client rewire
The server side is done (`api/missions/report-ai-fight.ts`, **return-only**, race-free). Contract:
`POST /api/missions/report-ai-fight { playerName, xp, ryo }` → `{ ok, xp, ryo, capped, dailyCount }` — returns the soft-capped allowed XP/ryo; the **client applies them** (server credits nothing).

**Rewire `shinobij.client/src/screens/Arena.tsx` `winBattle` AI-grant (~lines 2386–2454):**
- Hazards (why it's delicate — it's on a path hit every PvE fight): `winBattle` is **synchronous**, called from 5 sites (don't make it async — breaks flag-off); `updateCharacter` takes a **value not an updater** (stale-closure in a `.then`); the grant has **side effects** (`damageSectorTerritory`, `recordVillageWarRaid`) interleaved with the reward assembly.
- **Recommended design:**
  1. Write a **characterization test** first that pins the current `winCharacter` for a sample AI win, so the refactor is provably flag-off-identical.
  2. Compute the side-effecting bits (`villageWarRaid`, `territoryRaidDamage`) and battle-end UI **once, synchronously** (as today).
  3. Extract a pure `buildWin(effXp, effRyo)` closure: `gainXp({...base,hp:playerHp}, effXp)` → `grantTerritoryScrolls` → assemble `winCharacter` with `ryo: rewarded.ryo + effRyo + bounty…` (everything else captured from the once-computed values).
  4. **flag-OFF:** `updateCharacter(maybeMarkMission(buildWin(xpGain, ryoGain)))` synchronously — identical to today.
  5. **flag-ON:** `authFetch('/api/missions/report-ai-fight', { playerName, xp: xpGain, ryo: ryoGain })` → `.then(r => updateCharacter(maybeMarkMission(buildWin(r.xp, r.ryo))))` → `.catch(() => updateCharacter(maybeMarkMission(buildWin(xpGain, ryoGain))))` (degraded fallback grants locally on network failure).
- Add the flag in `shinobij.client/src/lib/pet-coliseum-flag.ts` style: `localStorage 'aiFightServerAuth.v1'`, default OFF (`=== "1"`).
- **Then:** `cd shinobij.client && npm run build` (client dist rebuild — commit `.js/.css/.html`; watch image churn, was 0 last build) + `npm run lint`. Add the characterization test to the `package.json` test list.

## 5. Remaining roadmap (after P0.2b client)
- **P0.2c** — mint-token high-value PvE/Hollow-Gate drops + war crate (largest; App.tsx/Arena.tsx grant-site rewiring; per-surface flags). Grant sites enumerated in `docs/milestone-1-foundation-tickets.md` (P0.2c). Depends on P0.4 (done).
- **Deferred (do last, per user):**
  - P0.4 tilecards.ts + village/sector-card.ts `failClosed` — add only to the genuine WRITE-action locks; locks at `tilecards.ts:266/274` are opportunistic auto-resolve inside a *state READ* — blanket fail-closed would 500 routine polls. Flag-gated/inert systems.
  - P0.5 Village-map Central marker (`Village.tsx`) — needs a bespoke pixel-art icon to match the webp set + on-map placement verified at a real viewport.

## 6. Build / test / commit mechanics (gotchas)
- **`npm test` is an explicit FILE LIST** in `package.json` `scripts.test` — a new `*.test.ts` MUST be appended there or it's silently skipped.
- **Root dist churn:** `npm run build:server` (tsc) rewrites ~all dist line-endings. Stage only real changes with `git -c core.autocrlf=true add dist/` (excludes CRLF/LF churn); confirm with `git -c core.autocrlf=true diff --numstat dist/ | awk '($1+$2)>0'`. After a failed build that followed a client import, delete any stray `dist/shinobij.client/`.
- **Bracketed files** (`api/save/[name].ts`): brackets are git pathspec globs — stage via directory add (`git add -A api/`), not explicit bracketed paths.
- **Parity tests that IMPORT a client module** (e.g. `_jutsu-points-parity.test.ts`) must be in `tsconfig.cpanel.json` `exclude` (precedent: `_card-catalog.test.ts`) or `build:server` fails on the client's extensionless imports. They still run under tsx.
- After any `api/`/`server.ts` change → rebuild + commit dist (cPanel serves committed dist; Railway self-builds). Worktree needed `npm install --no-package-lock` in both root and `shinobij.client/`.
- New endpoint → create `api/**` handler AND `route()`-register in `server.ts` (route-parity test enforces). Keep CORS (`_utils.ts` ⇄ `server.ts`) synced.

## 7. Design pillar (READ before any balance/economy change)
**Balanced PvP is the foundation. Combat power is gated by skill + tight restrictions, NEVER bought/grinded/RNG'd** ("ceiling, not speed"). Full detail in memory `feedback_balanced_pvp_design_pillar.md`. Rewards from seasons/endgame/events/market must be **prestige/cosmetics/collection/currency-sinks — never PvP power**.
**Confirmed INTENTIONAL — do NOT "fix":** Mythic-Seal lock / S-rank unobtainable; `statFactor` 1.85 cap (no stat-grind-to-win); identical legendary gear (anti-BiS); flat heal 750 (max even at L100); 40-AP utility / 60-AP damage split; jutsu mastery 40-50 PvP/seal gate; elements-via-weather (already a balanced axis); easy PvE band to L30.

## 8. Reference (in repo + memory)
- `docs/milestone-1-foundation-tickets.md`, `docs/p0.1-ceiling-enforcement-spec.md`, `docs/cosmetic-economy-design.md` (cosmetic economy is a future flagship — not started).
- Memory: `project_launch_readiness_waves_impl.md` (live status), `feedback_balanced_pvp_design_pillar.md` (the pillar).
- The full systems audit, Game-Director review, and master roadmap live in the prior chat transcript (not saved as docs).

## 9. P0.2c — design (scoped 2026-06-30, build not started)

P0.2b client landed (commits `a461d8f0` + dist `9e614423`). P0.2c was then deeply
scoped; this is the agreed design so the build executes cleanly.

**Scope decision (user: "do what's best — seamless and reliable"): ITEMS-ONLY, reuse existing server-auth infra.**
- The PvE/HG **currency** drops (ryo, fateShards, auraDust, boneCharms, hollowShards,
  honorSeals, …) are ALREADY double-capped by the save sanitizer (`api/save/[name].ts`
  per-save `CURRENCY_CAPS` + per-minute `MAX_CURRENCY_PER_MINUTE`). Re-plumbing each
  currency grant through a mint-token adds a round-trip + save-concurrency risk on every
  boss kill for little real anti-fabrication gain → **DO NOT do the currency grants.**
- The genuinely UNPROTECTED high-value targets are **items** (no per-item sanitizer cap,
  only the blanket `INVENTORY_CAP=500`): `DUNGEON_LEGENDARY_FRAGMENT_ID` (HG boss, REPEATABLE
  = highest leverage), `LEGENDARY_WAR_CRATE_ID` (war crate), and the rare one-time PvE items
  `HOLLOW_GATE_KEY_ID` / `AURA_SPHERE_ITEM_ID` (story-gated → lowest leverage, do last/optional).

**Anti-fabrication note:** server-pay-under-lock moves GRANT authority (closes the "fake a
win report" vector). It does NOT stop a tampered client writing the item straight into
`inventory` via `/api/save` — that needs a per-item ENTITLEMENT clamp in the sanitizer (today
only `INVENTORY_CAP` exists). That sanitizer hardening is a SEPARATE future ticket (hot-path,
risk-flagged) — out of scope for the grant-authority move, note it but don't bundle it.

**Save-concurrency model (the reliability crux):** server credits the item under
`withKvLock(save:<player>, { failClosed:true })` (re-read → append → `bumpSaveVersion` →
`mergePreservingImages`), and RETURNS the credited result; the client MIRRORS it into local
state so its own next `/api/save` is an idempotent overwrite that already contains the item
(no two-writer clobber). This is exactly the proven pattern in `api/hollow-gate/settle.ts`
(currencies) + `api/missions/report-raid.ts` (bonus ryo/seals). Reuse it verbatim.

**Surface 1 — HG item — DONE (server-only, byte-identical, no client change).**
The Dungeon Legendary Fragment (a counted `itemStacks` entry) is CLAMPED at settle, NOT
deferred: `start.ts` seals `entryFragments`; `settle.ts` clamps the run's GAIN
(current − sealed entry) to `maxFragmentsForDepth(depth)` — the SAME shape as the currency
ceiling (`clampFragmentTotal` mirrors `settleCurrency`). Legit hauls sit under the ceiling so
it's a no-op (byte-identical) → no flag + no client change; the client keeps its inline boss-drop
grant, so there's NO reliability regression (a defer-to-settle design would risk losing a legit
fragment on an un-settled run). The earlier "does the fragment survive death?" question resolved
by behavior preservation: it does (inline grant kept; the clamp only claws back a crafted client's
excess). Enforces only while `hollowGateServer.v1` is on (settle runs then); a never-settled run is
bounded by the per-save itemStacks caps — exactly the currency ceiling's own not-settled property.
(Superseded the earlier "credit reported items" foundation, which had a death-strip flaw + would
have deferred the grant.)

**Surface 2 — war crate: SERVER ENDPOINT DONE (inert) — commit <this>. Client rewire remains.**
`api/village/claim-war-crate.ts` (POST `{playerName, warCrateId}` → `{ok, granted, reason}`),
route-registered. Validates the crate against the AUTHORITATIVE `world:war:<id>` record — which is
genuinely server-stamped: world-state.ts only sets `winnerVillage` when the enemy village's persisted
HP is actually 0 AND the winner is the actor's own village, stamps `warCrateId=war-crate-<id>` at war
creation, and FREEZES the record once ended (a losing Kage can't self-declare; HP is delta-capped).
So reading `winnerVillage`/`endedAt`/`warCrateId` is a real anti-fab check. Grants LEGENDARY_WAR_CRATE_ID
under `withKvLock(save, failClosed)` + `claimedWarCrateIds` idempotency. Pure helpers
`parseWarCrateWarId` + `warCrateClaimDecision` (7-case test `api/village/_war-crate.test.ts`). Inert:
nothing calls it yet, and it only ever grants a legitimately-won crate, so exposing it is safe.
Scope: VILLAGE winner crate only (the winBattle vector). Clan-war crate (`winnerClan`, clan/war
records) + loser/MVP crates are follow-ups.
- **CLIENT REWIRE (remaining, the delicate part):** winBattle already fires ONE async grant (P0.2b
  aiFight). Adding the war-crate call makes TWO async writers race on `updateCharacter`. Do NOT bolt a
  second independent `.then(updateCharacter)` on — restructure so a raidPlayer win resolves both server
  replies then does ONE `updateCharacter`. Design: `deferWarCrate = warCrateServerAuthEnabled() &&
  villageWarRaid.warCrate && !!villageWarRaid.warCrateId`; buildWin EXCLUDES the crate when
  deferWarCrate; after the win, POST claim-war-crate and fold the result into the SAME updateCharacter
  as P0.2b (add the crate on `granted`; on network/5xx failure fall back to adding it locally so a legit
  crate is never lost; on a definitive `granted:false` reason leave it off). Add flag `warCrateServerAuth.v1`
  (localStorage, default OFF, like `ai-fight-flag.ts`). Then also route `claimPendingWarCrates` (login
  sweep, sync→async) village-winner crates through the endpoint. Needs client dist rebuild.
  - **SECOND race to handle — war-END propagation:** `recordVillageWarRaid` fire-and-forgets the
    world-state write that stamps `winnerVillage` server-side. If the crate claim reaches the endpoint
    before that settles, the authoritative record shows no winner yet → `no-won-war`/`not-winner` for a
    LEGIT crate. Don't treat those reasons as a hard decline in the winBattle path: sequence the claim
    AFTER the war-end write resolves (and/or retry once on `no-won-war`, and fall back to a local grant
    on persistent lag) so a legit crate is never lost to propagation timing. The recommended shape:
    `applyWin()` = await aiFight (P0.2b) → await war-crate claim → ONE `updateCharacter(buildWin(effXp,
    effRyo, includeCrate))`; keep a fully-synchronous flag-OFF fast path for byte-identical behavior.

**Surface 3 — rare one-time PvE items (optional, lowest leverage):** `HOLLOW_GATE_KEY_ID` (Kage
finale) + `AURA_SPHERE_ITEM_ID` (VN). Story-gated one-time grants; low fabrication value. Only do
if completeness wanted.

Each surface = its own green commit (server + client + flag + test + BOTH dists). Tests: token→
credit once, double-report pays nothing, ceiling clamps, odds unchanged, route-parity + CORS + lint.

## 10. 2026-06-30 session — authoritative current state

**9 commits `a461d8f0`..`c2bcba59` on `claude/great-swartz-b8b2a5` (NOT pushed). 1917 tests green;
both tsc + lint clean; both dists rebuilt/committed; working tree clean. All flags default OFF →
byte-identical until flipped.** This section supersedes §4/§5's "next task" framing.

**DONE this session:**
- **P0.2b client** (`a461d8f0` + dist `9e614423`) — Arena.winBattle `buildWin(effXp,effRyo)` refactor;
  flag `aiFightServerAuth.v1` (localStorage, OFF). Also FIXED a pre-existing partial client-dist commit
  (was 28/84 JS chunks, index.html→untracked chunk; now 84/84).
- **P0.2c HG item** (`2371e307`→`661ade86`) — Dungeon Legendary Fragment CLAMPED at settle
  (start seals entryFragments; settle clamps run-gain to maxFragmentsForDepth). Byte-identical, no flag,
  no client change, no reliability regression (kept the inline grant). Rides existing hollowGateServer.v1.
- **P0.2c war crate** (`fcae0a41`, `d794db19`, `34c0520f`) — `api/village/claim-war-crate.ts` (DUAL-MODE:
  village `world:war` + clan `clan-war`, validates the server-stamped winner vs the claimant's village/clan);
  client claims via the post-poll sweep `claimServerWarCrates` (race-free), both inline sites gated on
  `warCrateServerAuth.v1` (OFF). MVP crate intentionally left inline (shared dedup id with a currency bonus →
  needs a save migration; rare + currency capped).
- **P0.4** (`c2bcba59`) — failClosed the card-duel ACTION-handler RMWs (tilecards.ts + sector-card.ts);
  poll auto-resolve locks + guarded/already-failClosed settlements left open.

**ENABLE SEQUENCE (unchanged core + new client flags):** env — run the one-off `save:*` A/S bloodline
audit, then `BLOODLINE_RANK_ENTITLEMENT=1` → `BLOODLINE_RANK_CAPS=1` + `BLOODLINE_BUDGET_SERVER=1`
(+ optional `ITEM_BONUS_BUDGET=1`) on BOTH Railway + cPanel. Client localStorage flags (per-device, flip to
test then roll out): `aiFightServerAuth.v1='1'` (tune `AI_FIGHT_SOFT_CAP_PER_DAY`/`REDUCED_MULT` first),
`warCrateServerAuth.v1='1'`. HG item clamp + P0.4 are already-on (byte-identical, no flag).

**REMAINING (need the USER — can't finish autonomously):**
- **P0.5 Village-map "Central" marker** — VISUAL/ASSET: bespoke pixel-art icon (match the webp set) + on-map
  placement in the App.tsx village screen (no dedicated Village.tsx) + verify at a real viewport + App.tsx
  line-budget. The NAV button already shipped Wave A (GiPortal). Needs viewport + visual review → build-together.
- **HEAL mastery-ramp + P0.3b wound/control caps** — BALANCE changes; need explicit numeric SIGN-OFF before
  touching combat constants (hard rule). Heal-ramp direction pre-approved; final impl not.
- **P0.2c PvE items** (HG Key finale / Aura Sphere) — rare one-time story grants; low leverage; documented skip.
- **Cosmetic economy** — future flagship (docs/cosmetic-economy-design.md); large, not a "fix".
