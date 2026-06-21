# Handoff — Combat hex-board memoization / extraction (mobile perf)

**Status:** Not started. This is the deferred "next step" after the mobile combat
smoothness pass that shipped in `9c8f796b`
(*perf(combat): smooth mobile PvP/PvE — isolate turn timer, memoize log, fix
orphaned enemy-turn timer*).

**Goal:** Stop the ~120-tile hex board from doing a full rebuild on **every** combat
state commit, so PvE/PvP combat stops stuttering and freezing on mobile
(reported on Huawei P13 / Android and iPhone).

**Scope discipline:** This is a **render-perf refactor only.** Do NOT change any
combat behavior — AP costs, targeting, cooldowns, damage, turn resolution, or
balance must be byte-for-byte identical. PvP is server-authoritative; PvE is
client-side. Both are balance-sensitive.

---

## Why this exists / what's already done

Mobile players reported combat is "laggy, glitchy, stuttering," "freezes when I do
a jutsu," and outright "freezes the phone." A read-only audit found the costs were
continuous + per-action whole-board re-renders (plus one leaked timer chain).

Already shipped in `9c8f796b` (do **not** redo these):

- **Isolated turn countdown** → `shinobij.client/src/components/CombatRoundTimer.tsx`.
  The 45s timer used to live in each battle screen's state, so its 1s tick
  re-rendered the whole board every second. Now only the timer element ticks.
  Wired into `PvpBattleScreen.tsx` and `Arena.tsx`.
- **Memoized battle log line** → `BattleLogLine.tsx` is now `React.memo`. Existing
  log lines no longer re-render on every action.
- **Orphaned enemy-turn timer fixed** (Arena) → the recursive `setTimeout` enemy
  AI chain is now tracked in `enemyTurnTimerRef` and cancelled on unmount.
- **Towers poll gated** → `BattleTowerFight.tsx` skips its 2.5s poll while hidden.

**What remains (this doc):** the board itself. Even with the timer isolated, the
hex grid + its per-tile range/AOE highlight Sets are rebuilt on every re-render,
and combat still commits state often — worst in **PvE**, where the enemy's
multi-action turn fires ~5 state commits ~850ms apart, each forcing a full board
rebuild. That burst is the leading remaining cause of the per-action freeze on a
budget phone.

---

## The two render hotspots

### PvE — `shinobij.client/src/screens/Arena.tsx`
1. **Four range/AOE highlight Sets**, rebuilt in the render body each render
   (search for these `const`s — they call the functions below over all 120 tiles):
   - `activeJutsuRangeTiles`, `activeJutsuAoeTiles`, `activeWeaponRangeTiles`,
     `activeGroundAffectedTiles`
   - The underlying functions: `jutsuRangeTiles`, `jutsuAoeTiles`,
     `groundAffectedTiles`, `weaponRangeTiles` — each does
     `Array.from({length:120}).filter(t => distance(playerPos, t) <= range)`.
   - These Sets are **display-only** — consumed in the tile `.map` to compute the
     `isJutsuRangeTile` / `isJutsuAoeTile` / `isGroundAffectedTile` CSS classes.
2. **The 120-tile grid render**: `Array.from({length:10}).map(row => Array.from({length:12}).map(col => …))`.
   Each tile recomputes `barrierTiles.some()`, `groundZones.some(z => z.tiles.includes(i))`,
   several `distance()` calls, `hexNeighbors(hoveredBattleTile).includes(i)`, etc.

The enemy turn (`enemyTurn` → `afterEnemyAction` → `enemyContinue`, an 850ms chain)
commits `setEnemyHp`/`setPlayerHp`/`setEnemyAp`/`addCombatLog`/`setEnemyStatuses`
~5× per turn. **None of those changes affect the board structure**, yet each one
re-runs all of the above.

### PvP — `shinobij.client/src/screens/PvpBattleScreen.tsx`
Same pattern, lighter: `dashRangeTiles`, `jutsuRangeTiles`, `groundJutsuTiles`,
`groundJutsuAffectedTiles`, `weaponRangeTilesSet`, `basicAttackRangeTiles` are
`new Set(allTiles.filter(...))` in the render body. **Most are empty unless the
player is actively aiming**, and PvP has no multi-action enemy burst (it's one
server push per opponent action), so PvP is the lower priority. Fix PvE first; only
mirror into PvP if on-device testing still shows PvP stutter.

---

## ⚠️ The trap that blocked the first attempt (read this)

`Arena.tsx` is **hook-fragile**. The board render lives *after* conditional early
returns (`if (!battleStarted) { … return <lobby> }`, then the battle `return`).
There is an in-file comment near the mid-battle-persistence block that literally
warns: *"Previous two attempts added hooks DIRECTLY to Arena and tripped
[rules-of-hooks]."* That's why mid-battle persistence was pulled into its own
isolated component.

Consequence: **you cannot add `useMemo`/`useCallback` next to the board render** —
it's past the early return, so any hook there throws
`react-hooks/rules-of-hooks` ("Hook called conditionally"). The first attempt at
memoizing the 4 Sets did exactly this and had to be reverted.

**Hooks must be added before the first early return.** The good news: all the
inputs are already in scope up there —
- positions: `playerPos`, `enemyPos` (useState, near the top)
- targeting: `pendingTargetJutsu` (resolved const, well above the lobby return),
  `pendingTargetWeapon`, `hoveredBattleTile`
- the tile functions (`jutsuRangeTiles` etc.) are top-level function declarations
  (hoisted), defined before the lobby return.

A valid placement for the Set `useMemo`s is **right after `weaponRangeTiles` is
defined** (between it and `nextStepToward`), which is comfortably before any early
return.

Also note: this file has `/* eslint-disable react-hooks/exhaustive-deps,
react-hooks/set-state-in-effect */` at the top, so **the linter will NOT catch a
missing memo dep.** You must hand-verify deps. A stale Set = wrong tile highlights
(and, if a click handler ever gates on a Set, a wrong/blocked action). Confirm the
click/hover handlers read **live** state, not the memoized Sets — they should, but
verify.

---

## Recommended plan (incremental — verify each step on-device)

### Step 1 — Memoize the 4 Arena range Sets (low risk, do first)
Move the four `active*Tiles` computations to `useMemo` declared **before the lobby
early return** (after `weaponRangeTiles`). Suggested deps (be conservative — extra
deps only cost a recompute; a missing one causes staleness):
- `activeJutsuRangeTiles`: `[pendingTargetJutsu, playerPos]`
- `activeJutsuAoeTiles`: `[pendingTargetJutsu, playerPos, enemyPos]`
- `activeWeaponRangeTiles`: `[pendingTargetWeapon, playerPos]`
- `activeGroundAffectedTiles`: `[pendingTargetJutsu, hoveredBattleTile, playerPos]`

These inputs don't change while the **enemy** is acting, so during the enemy burst
all four are computed once and reused. Keep the `const activeJutsuRangeTiles = …`
names so the board `.map` is unchanged. Verify highlights still update correctly
when the player selects a jutsu/weapon and moves.

### Step 2 — Extract the board grid into a `React.memo` child (the big win)
Pull the `Array.from(...).map(...)` grid into e.g.
`shinobij.client/src/components/CombatHexBoard.tsx`, `React.memo`'d, taking its
inputs as props: positions, `groundZones`, `barrierTiles`, the 4 highlight Sets,
`hoveredBattleTile`, board scale, and the per-tile **handlers**. Then a re-render
caused by HP/AP/log changes skips the board entirely (props unchanged).

Critical for this to actually help:
- **Stabilize the handlers** the tiles use (`onClick`/`onMouseEnter`/etc.) with
  `useCallback` — declared before the early return — or `React.memo` will always
  see new function props and never skip. This is the make-or-break detail.
- Pass primitive/stable props where possible; if you pass the highlight Sets, they
  must be the memoized ones from Step 1 (stable identity).
- The same hook-placement rule applies: any `useCallback`/`useMemo` for the board's
  props goes **before** the lobby early return.
- Behavior-preserving: the extracted component is pure presentation + event
  forwarding. No combat logic moves into it.

### Step 3 — Mirror into PvP only if needed
Repeat the board extraction for `PvpBattleScreen.tsx` *only if* on-device testing
still shows PvP stutter after Steps 1–2. PvP's Sets are mostly empty off-turn, so
it may not be worth the risk.

---

## Verification (required)

1. `cd shinobij.client && npx tsc -b` → clean.
2. `cd shinobij.client && npm run lint` → clean (note: `eslint`'s hook-dep rule is
   disabled in these files, so **manually** re-read every memo/callback dep list).
3. **React DevTools Profiler** (desktop is fine for this part): start a PvE fight,
   trigger an enemy multi-action turn, and confirm the board component does **not**
   re-render on the HP/AP/log commits — only when positions/zones/targeting change.
4. **On real devices** (the whole point): Huawei P13 + iPhone. Run several PvE
   fights with multi-action enemies and cast jutsu repeatedly; confirm no stutter
   on the enemy burst and no freeze on cast. Then PvP.
5. Behavior regression check: targeting highlights (jutsu range, AOE ring, ground
   target, weapon range, dash range) must light up/clear exactly as before;
   movement, casting, and turn flow unchanged.

## Deploy notes
- Client-only change → **Railway rebuilds from source on push to main**; no `dist/`
  rebuild needed. Do **not** rebuild/commit `shinobij.client/dist` from a worktree
  (it diverges from the committed rolldown bundle). cPanel is not serving live
  traffic.
- Keep changes small and incremental; land Step 1, observe, then Step 2.

## Quick reference (symbols, since line numbers drift)
- `Arena.tsx`: `jutsuRangeTiles` / `jutsuAoeTiles` / `groundAffectedTiles` /
  `weaponRangeTiles` (defs), `activeJutsuRangeTiles` (+3) (render-body consumers),
  the `Array.from({length:10}).map(... {length:12} ...)` grid, `enemyTurn` /
  `afterEnemyAction` / `enemyContinue` (the 850ms burst), and the
  `if (!battleStarted)` lobby early return.
- `PvpBattleScreen.tsx`: `dashRangeTiles` / `jutsuRangeTiles` / `groundJutsuTiles`
  / `groundJutsuAffectedTiles` / `weaponRangeTilesSet` / `basicAttackRangeTiles`.
- Shipped reference for the "isolate a hot sub-render into its own component"
  pattern: `components/CombatRoundTimer.tsx` (and how it's wired in both screens).
