# Cleanup, Hardening & Performance Plan — 2026-06-18

Consolidated roadmap from the health/speed audit + the HollowGate vet. Branch
`claude/intelligent-dewdney-bfce1b` (synced to `origin/main`, which includes the
full HollowGate push).

## Guiding principle (non-negotiable)

> **No system or PvP gameplay function is removed.** Every change here is one of:
> (a) **additive** (new cache header, lazy boundary, test), (b) **behavior-preserving**
> (verbatim move, documented lint suppression, on-demand load of the same screen),
> or (c) a **forged-save-only clamp** (anti-tamper that never touches a legitimate
> save). Balance/reward numbers are not changed without explicit owner sign-off.
> HollowGate is PvE-only; none of this touches PvP, ranked, or combat formulas.

Each phase is independently committable and ends with the relevant verification.

---

## Phase 1 — Lint warnings 83 → 0 ✅ DONE (working tree, uncommitted)

Pure cleanup, zero gameplay/PvP/systems impact. Verified: lint 0, `tsc -b` 0, `vite build` 0.

| Change | File | Nature |
|--------|------|--------|
| Scope `react-refresh/only-export-components` **off** for App.tsx (intentional drain re-exports) + petvfx.tsx (dev harness); kept `'warn'` globally | `eslint.config.js` | config only |
| Drop `export` on two internal-only flag helpers | `SceneAmbience3D.tsx`, `SectorScene3D.tsx` | behavior-preserving |
| Move `isSectorMapEnabled` to sibling module, repoint import | new `sector-map-flag.ts`, `SectorMap.tsx`, `WorldMap.tsx` | verbatim move |
| Remove 3 dead `eslint-disable` directives | `AdminPanel.tsx` | comment only |
| Document 3 intentional effects (StoryBoss save + restore, TownHall kage poll) with justified `eslint-disable` — adding the flagged deps would change firing behavior | `StoryBoss.tsx:139/151`, `TownHall.tsx:175` | behavior-preserving |
| Doc corrections (verify:dist, ranked folder, Railway-live) | `CLAUDE.md` | docs |

**Status:** complete; not committed (awaiting go-ahead).

---

## Phase 2 — HollowGate fairness + safety net (no balance change)

Restores intended behavior + guards against a future softlock. Touches no legit reward math.

- **2a — Boot-refresh heal-and-resume hole.** If a player refreshes mid-fight *and* the
  arena snapshot is gone (>1h / cleared), boot hospitalizes them but leaves
  `hollowGateRun` intact with **no claw-back** ([App.tsx:3659](../shinobij.client/src/App.tsx:3659)),
  diverging from the live KO path ([App.tsx:6125](../shinobij.client/src/App.tsx:6125)).
  **Fix:** in the `arenaStory` boot-loss branch, detect a HollowGate fight and apply the
  same `clawBackHollowGateLoot(...)` + `hollowGateRun: null` as the live death path before
  routing to hospital. **Risk: LOW-MED** (touches a death path — verify the claw-back math
  matches the live path exactly). **Preserves:** the fair-death system; only closes an edge-case bypass.
- **2b — BSP generator test safety-net.** `hollow-gate-dungeon.ts:20` imports
  `HOLLOW_GATE_MAX_FLOOR` from `../App`, which pulls in `index.css` and crashes the node
  test runner — so the most-used floor generator (~⅓ of floors + universal fallback) has
  **zero** reachability coverage. **Fix:** move that one constant to `constants/game` (or
  inject it), then add `hollow-gate-dungeon.test.ts` asserting exit + target wall-reachability
  across many seeded floors. **Risk: LOW** (moving a constant + new test; no runtime behavior
  change). **Preserves:** everything — this only *adds* a regression guard.

**Verify:** `npm test` (root) incl. new test; `tsc -b`; `vite build`.

---

## Phase 3 — HollowGate anti-cheat hardening (forged-save-only) — owner-approved

All in the save sanitizer `api/save/[name].ts`. Clamps tampered saves only; a legitimate
save passes through unchanged. PvE-only.

- **A — Per-node attunement maxRank clamp.** Replace the flat 0–3 clamp
  ([api/save/[name].ts:281-289](../api/save/[name].ts:281)) with each node's catalog
  `maxRank` (Extra Dive 1, Seasoned Delver 2, Cartographer/Key-Forge 1, Greedy-Hands 3,
  Reiki 2 — mirror of [hollow-gate-attunement.ts:22-29](../shinobij.client/src/lib/hollow-gate-attunement.ts:22)),
  drop unknown ids. **Risk: LOW.** Roots the daily-run + free-keys exploits.
- **B — `hollowGateRun` shape validation.** Mirror the `endlessTowerRun` clamp
  ([api/save/[name].ts:634-639](../api/save/[name].ts:634)): clamp `entryCurrencies` to
  ≤ the existing save's balances (so the death claw-back can't be no-op'd) and clamp
  `floor`/`keys` to sane ceilings. **Risk: LOW.** Preserves legit resume.
- **C — Per-save gain cap on `hollow-gate-key`.** The item-stack sanitizer
  ([api/save/[name].ts:485-500](../api/save/[name].ts:485)) only abs-clamps to 9999 with no
  per-cycle gain cap, so a forged save mints 9999 keys with no shard spend. **Fix:**
  special-case `HOLLOW_GATE_KEY_ID` with a per-save gain cap (existing + small N; legit full
  run forges ~3). **Risk: MED** (special-case inside the generic item loop — must leave all
  other items untouched and set the cap above any legit gain).
- **D — Server-gate `dailyHollowGateRuns` (FLAGGED, higher-risk, recommend defer).** The
  daily cap is client-only. A real server gate requires locking `lastDailyReset`, which gates
  **many** daily counters (dailyAiKills, dailyPetWins, …) → broad blast radius. A+B+C already
  bound the downstream value, and ryo/xp stay capped by the rolling-window limiters. **Decision:
  ship A+B+C; treat D as a separate, carefully-scoped change later (or accept).**

**Verify:** add sanitizer unit tests for A/B/C; `npm test` (root); `npm run build`; **commit
regenerated `dist/` in the same change** (server change → cPanel parity; Railway self-builds).

---

## Phase 4 — Seamlessness nits (text / comment / dead-code clarity)

- Reword the no-key entry alert to name the real key sources — Key Forge (80 shards),
  in-run chests, story finale — instead of the wrong "Crafter" recipe ([App.tsx:6182](../shinobij.client/src/App.tsx:6182)).
- Fix the misleading `normalizeCharacter` comment about field-dropping ([App.tsx:1498](../shinobij.client/src/App.tsx:1498)).
- `BATTLE_SCREENS` ([screen-guards.ts:41](../shinobij.client/src/lib/screen-guards.ts:41)) is
  dead + mislabeled. **Per the no-removal rule, annotate** (add `hollowGateShrine` + a comment
  that the live gate is `isUnresolvedBattle`) rather than delete.
- Optional: legacy `pet_battle` torch-refill leak ([App.tsx:6680](../shinobij.client/src/App.tsx:6680))
  — legacy-only, self-resolving; drop `setTorch:10`. Optional: persist a short `hollowGateLog`
  tail so refresh keeps scrollback (cosmetic).

**Risk: LOW** (text/comments). **Verify:** lint + build.

---

## Phase 5 — Performance (additive; all screens preserved)

- **5a — Lazy-load the heavy 2D screens** (Arena ~5k, AdminPanel ~5.6k admin-only, WorldMap,
  CentralHub, PvpBattleScreen, PetArena, PetYard) via `React.lazy` + `Suspense` — same pattern
  already used for 12 screens. The current main bundle is **2.0 MB**; this moves ~500–800 KB
  off first paint. **Screens still load on demand — nothing removed.** **Risk: LOW-MED**
  (each lazy screen needs a Suspense fallback; verify no eager import drags it back in).
- **5b — Backend easy wins:** add `Cache-Control: s-maxage=10` to
  [api/village-guard/list.ts](../api/village-guard/list.ts) (currently full `kv.keys` scan, no
  cache); raise [api/game-state.ts](../api/game-state.ts) village-state cache from `s-maxage=8`
  → ~30s; single-parse the [heartbeat](../api/player/heartbeat.ts) body. **Additive.**
- **5c — CSS (medium):** the 510 KB single stylesheet — split route blocks into lazy chunks /
  dedupe (no rule removal beyond confirmed dead).
- **5d — Re-render (medium):** move heartbeat/presence into a context + `React.memo` heavy
  screens so a heartbeat doesn't re-render the whole tree.

**Verify:** `vite build` (confirm chunk split + sizes), manual smoke of each lazied screen;
`npm test` for backend changes + commit `dist/`.

---

## Phase 6 — Depth / shallow-systems (OPTIONAL, balance sign-off required)

Pure **additions** (never removals): daily/agenda streaks, Black-Market pity counter, Endless
Tower milestone badges, weekly-board themes, profession respec token. Each changes reward
pacing → explicit owner sign-off + tests before any edit. Held until Phases 1–5 land.

---

## Cross-cutting deploy/test rules

- Frontend change → `npm run lint` + `vite build`. Backend/`api` change → `npm test` (root)
  + `npm run build` + **commit `dist/`** (cPanel serves committed `dist/`; Railway self-builds).
- Root `npm test` needs root `node_modules` (not installed in this worktree) — `npm install`
  first when a phase touches `api/`.
- Client `dist/` rebuilt in a worktree diverges (rolldown-vite) — keep frontend-only commits
  **source-only**; let Railway rebuild.
