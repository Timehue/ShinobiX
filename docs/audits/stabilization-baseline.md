# Stabilization Baseline — Phase 0 (captured 2026-07-31/08-01)

Branch: `audit/shinobix-stabilization-phase-0`, cut from `origin/main` @
`de50b3385` ("Fold gear stats into server combat, retune cafeteria meals to
percent"). Working tree clean at capture. Host: Windows 11, node + npm from the
developer machine (not CI) — Sentry/size margins can differ slightly from CI
(known local≠CI variance).

## Baseline command results (repo root)

| Command | Result | Detail |
|---|---|---|
| `npm ci` | PASS (exit 0) | clean install from `package-lock.json` |
| `npm test` | **PASS — 4302/4302 tests, 625 suites, 0 fail, 0 skipped** (269s) | see note below on a first-run artifact |
| `npm run build` | PASS (exit 0) | `build:server` (tsc) + `build:client` (vite) + `verify:dist` + `sizecheck` |
| sizecheck | PASS | initial JS/CSS graph 1.35 MB raw / **356.9 KB gzip** across 9 files; budgeted product JS/CSS 6.79 MB (WARN threshold noted, still PASS) |
| `npm run test:mission-eligibility` | PASS | "Mission eligibility catalog check passed." |
| `npm run test:release-assets` | PASS | 65 achievement references present; 165 badge PNGs decode and are square |
| `npm run check:deployment` | PASS | Railway config verified (`node dist/server.js`, healthcheck `/health`, 1 replica) |
| `npm run check:rollback-readiness` | PASS | `{ ok: true, failures: [], destructiveStatements: [] }` |
| `npm run test:backup` | PASS | 10/10 pass |
| `npm audit --audit-level=high` | PASS | **0 vulnerabilities** |

**Test-run artifact (disclosed per audit rules):** the first `npm test`
execution reported 3 failures (`pet-atlas-material.test.ts`,
`pet-glb-atlas.test.ts`, `pet-model-bounds.test.ts` — all
`ERR_MODULE_NOT_FOUND: three`). Root cause: this audit ran `npm ci` in
`shinobij.client/` **concurrently** with the root test suite; `npm ci` deletes
`node_modules` mid-run, and on Windows the install then failed on file locks
held by the running tests. After re-installing and re-running serially, the
full suite passes 4302/4302. This was an audit-process error, not a repo
defect. No pre-existing test failures were found.

## Baseline command results (shinobij.client)

| Command | Result | Detail |
|---|---|---|
| `npm ci` | PASS (exit 0, after the serial re-run noted above) | 0 vulnerabilities |
| `npm run lint` | PASS (exit 0) | **0 errors, 7 warnings** (all pre-existing; mostly react-hooks advisory warnings) |
| `npm run build` | PASS | runs inside root `npm run build` (`build:client` = `npm ci && npm run build`) |
| `npm run test:e2e` | **PASS — 29 passed, 13 skipped, 0 failed** (exit 0, ~1.0 min) | Playwright, 7 projects: chromium/firefox/webkit desktop, chromium compact+mobile, webkit mobile, chromium tablet |

**E2E coverage caveat:** the Playwright suite runs against `vite preview`
(`playwright.config.ts` webServer) — a **backend-less** static server with
`page.route()` network mocks and service workers blocked. It certifies UI
journeys and runtime-failure assertions, NOT real server settlement. There is
currently no fresh-account end-to-end certification against the real Express
server (roadmap P0-6).

## Feature-readiness table

Flag architecture (VERIFIED): no central flags module. Three layers —
(1) ad-hoc `process.env.ENABLE_*/DISABLE_*` per handler plus
`api/_release-flags.ts` (reward-integrity gates only, all default OFF);
(2) **server force-sets** at `server.ts:435` (`ENABLE_VILLAGE_WAR`) and
`server.ts:439` (`ENABLE_CLAN_BOSS`) — the enable env vars are decorative, only
`DISABLE_*=1` kill-switches matter (drift is real and documented in
`FEATURE_FLAG_RELEASE_MATRIX.md:14,16`); (3) client per-device localStorage
`.v1` keys, scattered, two default conventions (opt-out `!== "0"` vs opt-in
`=== "1"`).

| Feature | Client status | Server routes | Flags (name → default) | Settlement | Mismatches / risks |
|---|---|---|---|---|---|
| Casual PvP | Reachable (Arena) | `/pvp/*` registered (`server.ts:986-987,1297-1303`) | none | Server-side (`_reward-settlement`, receipts on unless `DISABLE_COMBAT_RECEIPTS`) | none found |
| Ranked PvP | Reachable | `/pvp/ranked-queue`, `/ranked-season` (`:1304,1335`) | none | server-side | none found |
| Battle Towers | Reachable | `/towers/*` (`:1064-1070`) | none | server-auth run tokens | none found |
| Endless Spire | Reachable | shares `/towers/*` + spire leaderboard (`:1071`); legacy `/endless/run` (`:1361`) | none | via towers settle | client mirror `lib/spire-catalog.ts` must stay in sync (guard test in `scripts/`) |
| Pet Arena / Coliseum | Reachable | `/pet/battle-*` (`:1308-1309`), `/arena/lobby` (`:1318`) | client `.v1` flags, all default ON with `"0"` kill-switches (`petArena3d.v1`, `petArenaV2.v1`, `petDuelEngine.v1`, `petPlayerControl.v1`) | server replays seeded sim (`pet/battle-result.ts`) | `petColiseumCinematic.v1` is dead-flag cruft with a stale safety comment (`pet-coliseum-flag.ts:141-157`); `petRankedChallenge.v1` hard-returns false while its routes stay callable (API refuses old local-Elo path) |
| Pet Ladder | Reachable | `/pet-ladder` (`:1321`), `/pvp/pet-ranked-queue` (`:1305`) | none | server-authoritative, live-only lockstep | none found |
| Card Clash / Chronicle | Reachable | `/card-clash/*` (`:1178-1181,1356-1357`) | none | server rules engine, validated decks | none found |
| Hollow Gate | Reachable | `/hollow-gate/*` (`:1222-1229,1364-1365`) | none (in-game timed unlock) | settle + combat-settle server-side; **fighter build is client-side** (see combat audit) | desktop-first notice only |
| Clan Boss | Reachable; `clanBoss.v1` default ON | `/clan-boss/*` (`:1214-1216`) + weekly cron | `ENABLE_CLAN_BOSS` **force-set ON** (`server.ts:439`); kill `DISABLE_CLAN_BOSS=1` | assault-settle server-side | flag drift (documented) |
| Weekly Boss | Reachable | `/weekly-boss` (`:1334`) | `ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE` → OFF; client `weeklyBossRoam.v1` → **default ON** | **server-authoritative**; legacy client `damage` action returns 503 for non-admins (`weekly-boss.ts:495-548`) | `WorldMap.tsx:781` comment says roam "default OFF" but code defaults ON; `FEATURE_FLAG_RELEASE_MATRIX.md:15` stale (claims settlement not server-auth) |
| Village War | Reachable; `villageWarMap.v1` default ON | ~15 routes (`:1096-1142`) | `ENABLE_VILLAGE_WAR` **force-set ON** (`server.ts:435`); kill `DISABLE_VILLAGE_WAR=1` | claim endpoints server-side | flag drift; neither flag in `.env.example`; `release-readiness.ts` labels it "gate/soft-launch" while it's on for everyone |
| Sector War / Warfront | Reachable (incl. `PetWarfrontMatch.tsx` — IS committed) | `/village/sector-*` (`:1111-1119`), `/pet/warfront-start` (`:1310`) | rides `ENABLE_VILLAGE_WAR` → effectively ON | sector handlers | same drift |
| Bloodline Maker | Reachable | `/bloodlines/forge` (`:1355`), `/awakening/roll` (`:1354`) | **no env gate exists** | sealed server costs (`bloodlines/_forge.ts:13-19`), PENDING_FORGE_CAP=3, admin review queue | matrix says "Gate/monitor" but there is no flag; gating = cost + moderation only |
| Player image generation | Upload always; AI-generate in maker UIs | `/generate-image` (`:1021`) | `ENABLE_PLAYER_AI_IMAGE_GENERATION` → OFF (admin always allowed) | n/a | consistent with docs; player calls 4xx until flipped (by design) |
| Creator/admin tools | Admin screens behind admin auth | `/admin/*` (`:1002-1006,1338-1348`) | admin password header | n/a | none found |
| Legacy system | Reachable; `legacy.v1` default ON | `/legacy/*`, `/hall-of-legends` (`:1284-1292`) | **`ENABLE_LEGACY === '1'` required, NOT force-set** (`api/_legacy-track.ts:19-21`) | server side-car key | enabled UI over env-gated server: if Railway drops the flag, UI silently 404s; flag absent from `.env.example`; Railway value REQUIRES LIVE VERIFICATION |
| Pet breeding | **Does not exist** (VERIFIED — no routes, screens, or code; only flavor text) | — | — | — | — |
| Anbu Vault / Infiltration | Reachable at level ≥100 (`WorldMap.tsx:3504`); `anbuInfiltration.v1` default ON | `/village/anbu-infiltration` (`:1124`) | `DISABLE_ANBU_INFILTRATION=1` kill-switch, **default ON** (`anbu-infiltration.ts:87-89`) | server-auth | memory claim "GATED OFF" is stale — on by default both sides |
| Shrine pet blessing | **Not in this tree** (uncommitted worktree elsewhere); `api/sector/shrine-offer.ts` is a pure ryo sink, "no payout path exists" | `/sector/shrine-offer` (`:1274`) | — | fail-closed lock | — |

Other route-surface notes: `/kv/:op` (dormant kv-proxy) still registered
(`server.ts:1050`), token-gated, dead surface; the Weekly Boss legacy damage
action is the model of a properly fenced dead route (503 + reason code).

## Docs inventory & doc↔code conflicts

Key docs present: root `CLAUDE.md`, `shinobij.client/CLAUDE.md`, README ×2;
repo-root release docs (`FEATURE_FLAG_RELEASE_MATRIX.md` (2026-07-07),
`RELEASE_CHECKLIST.md`, `PUBLIC_BETA_LAUNCH_RECOMMENDATION.md`,
`BETA_READINESS_HANDOFF_2026-07-14.md`, `RAILWAY_SETUP.md`,
`COMBAT_PARITY_AUDIT.md`, `MISSION_LOGIC_AUDIT.md`); `docs/` runbooks
(`auth-and-anti-cheat-patterns.md`, `RETIRE_CPANEL_RUNBOOK.md`,
`BACKUP_RESTORE_RUNBOOK.md`, `DEPLOYMENT_ROLLBACK_RUNBOOK.md`,
`EMERGENCY_LAUNCH_CONTROLS.md`, `BETA_RELEASE_CERTIFICATION.md`,
`combat-architecture.md`, `SERVER_COMBAT_MIGRATION_PLAN.md`, `SECURITY_PROGRAM.md`,
`DATA_RETENTION_POLICY.md`, ~60 feature/plan docs, `docs/archive/beta-2026-07/`
with 25 release-audit files). `docs/audits/` did not exist before this audit.
`shinobij.client/src/lib/release-readiness.ts` is a third copy of launch-state
truth (drives in-game beta notices) and drifts independently.

Conflicts found (code is source of truth; conflicts recorded):

1. `FEATURE_FLAG_RELEASE_MATRIX.md:15` stale on Weekly Boss — settlement IS
   server-authoritative now (`api/weekly-boss.ts:495-548`).
2. `WorldMap.tsx:781` comment ("default OFF") vs `weekly-boss-roam.ts:34`
   (defaults ON); `weekly-boss-roam.ts:21` still claims "nothing imports this."
3. `.env.example` omits live operational flags: `DISABLE_VILLAGE_WAR`,
   `DISABLE_CLAN_BOSS`, `ENABLE_LEGACY`, `DISABLE_ANBU_INFILTRATION`,
   `DISABLE_COMBAT_RECEIPTS`, `DISABLE_ASSET_META`, `DISABLE_CURRENCY_WINDOW`.
4. Matrix "Gate/monitor" for Bloodline Maker implies a nonexistent env gate.
5. `petColiseumCinematic.v1` self-documents as vestigial with an obsolete
   safety claim (`pet-coliseum-flag.ts:141-147`).
6. `release-readiness.ts` labels Village/Sector War "gate/soft-launch" while
   `server.ts` force-enables them for all players.

## Commands that could not run / caveats

- `npm run test:e2e:warfront` (separate config) — not run; out of scope for the
  baseline (the main suite was run).
- Anything requiring production credentials (live KV backup drill against prod,
  release:health against live) — intentionally not run (Phase 0 rule: do not
  touch production data). `test:backup` runs against local fixtures and passed.
- Production env values (`STRICT_RAW_SAVE_LEDGER`, `ENABLE_LEGACY`,
  `SESSION_SECRET` presence) — REQUIRE LIVE VERIFICATION; not provable from repo.
