# Launch-Readiness Implementation — Handoff

Self-contained handoff so a fresh session can continue without re-reading the prior chat.

## 1. Snapshot
- **Branch:** `claude/great-swartz-b8b2a5` (feature branch off `main`). **NOT pushed.** Working tree clean.
- **Tests:** `npm test` (repo root) = **1901 passing, 0 failing**. Server typecheck (`npx tsc -p tsconfig.cpanel.json --noEmit`) clean. Client (`cd shinobij.client && npx tsc -b && npm run lint`) clean as of Wave A (client unchanged since).
- **Safety:** every balance-affecting change is behind a flag **default OFF** → byte-identical to pre-session behavior. Nothing is live until a flag is flipped.
- **dist:** committed for cPanel (server dist). Client dist committed at Wave A; **client unchanged since** (no client work landed after Wave A).

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
