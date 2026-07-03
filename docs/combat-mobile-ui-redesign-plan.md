# Combat Mobile UI Redesign — Plan

**Status:** IN PROGRESS (uncommitted, not pushed).
- ✅ **Phase 1 done + visually verified** — shared `components/FighterHpBadge.tsx`; on-board HP bars for both fighters in Arena + PvP (pet badge refactored onto it; enemy ungated). `tsc`/lint clean.
- ✅ **Phase 2a done + verified** — mobile side-HUD trim: hide the now-redundant HP line + avatar (kept chakra/stamina/shield/effects). `resource-line--hp` class on the HP line + a rule in the authoritative mobile block.
- 🛑 **Phase 2b (full `100dvh` viewport-fit) — proven NOT a quick add** by a faithful mock (real classes + real CSS at 390×844). Two blockers: (1) `index.css` already has 5+ fighting/reverted viewport-fit generations (`.arena-fullscreen` height is set to `100dvh !important` and then reverted to `auto !important` by a later rule; the board has ~6 warring height rules; a `html[data-vp=…]` JS sizing system too). (2) The content genuinely overflows a phone even bounded — a naive fit stops the page scroll but **clips the action bar + the entire jutsu grid** (overflow:hidden, not scrollable). Real fix = a coordinated compaction pass (HUD ~216→~100px, action bar 4 rows→1–2 or horizontal scroll, board, chrome) **plus** consolidating the warring CSS — a design job that must be iterated live on the real app.
**Date:** 2026-07-03
**Goals (from the request):**
1. **Kill the scrolling.** The mobile battle screen is too tall — you scroll between the board and your actions/jutsu/log mid-fight.
2. **Size things better** so a whole fight fits one phone screen.
3. **Put an HP bar on each of the two fighters** (on the board, at the unit — not only in the corner HUD).

This plan is grounded in a full read of the combat UI code plus web research on how well-built mobile tactical/turn-based games lay out combat and draw unit HP bars. It proposes a **phased, low-risk-first** approach: ship the HP bars and the biggest scroll wins first (small, contained), then do the structural viewport-fit layout, then consolidate the CSS across all three battle engines.

---

## 1. How combat UI is built today (the map)

### 1.1 Three engines, one shared shell

All battle screens render inside `.arena-fullscreen` › `.combat-layout` and reuse the same building blocks:

| Engine | File | Board render | HP display today |
|---|---|---|---|
| **PvE Arena** | `shinobij.client/src/screens/Arena.tsx` (~6k lines) | `.hex-grid-layer` + `avatar-orb` overlay | `CombatSideHud` (player), enemy HP shown **nowhere on board** |
| **PvP** | `shinobij.client/src/screens/PvpBattleScreen.tsx` | same `orbForPos` overlay (`PvpBattleScreen.tsx:1332`) | two `CombatSideHud` panels |
| **Battle Towers** | `shinobij.client/src/screens/BattleTowerFight.tsx` | same board scaler; N-actor | **already has an on-orb HP bar** (`BattleTowerFight.tsx:536-544`) + Squad/Enemy `ActorCard` rails |

Shared pieces:
- **`components/CombatSideHud.tsx`** — the tall side panel: header (name/village/Acting-Waiting), a square avatar, HP/Chakra/Stamina/(Shield) resource-lines, `MobileEffectsStrip`, and verbose Buffs/Debuffs columns.
- **`components/BattleTabBar.tsx`** + **`lib/use-battle-tabs.ts`** — the mobile **Actions | Battle-Log** segmented switch (already the single biggest vertical-space saver).
- **`lib/use-board-scale.ts`** — a `ResizeObserver` that auto-fits the fixed-logical-size grid into whatever container it's given.

### 1.2 The board is already a fit-to-space, scaled grid

`Arena.tsx:228-239`: grid is **12×10 hexes**, `HEX_W=72`, `HEX_H=42`, `X_STEP=54`, `Y_STEP=38.64`, `ORB=52`, pre-scale layer `GRID_LAYER_W≈666 × GRID_LAYER_H≈411`.

`useBoardScale()` computes `min(cw/gridW, ch/gridH)` (mobile min-scale 0.15, desktop 0.45), then `effectiveScale = clamp(0.15..2.5, boardScale + userZoomOffset)`. The layer renders with `transform: scale(effectiveScale); transform-origin: top left` inside a clip-wrapper (`Arena.tsx:5428-5457`).

**Consequence:** the board does *not* overflow — it shrinks to fit. Its **height is dictated by a fixed CSS clamp**, not by content: `clamp(280px, 46dvh, 420px)` on ≤800px, `clamp(250px, 42dvh, 360px)` on ≤520px (`index.css:19998-20005`, `:20153-20159`). So the board is a fixed ~280–420px band that sits *between* a stack of other panels.

### 1.3 The actual mobile vertical stack (why it scrolls)

Under `@media (max-width:800px)` (`index.css:19890-20151`), `.combat-layout` becomes a 2-col/2-row grid: row 1 = `[player CombatSideHud | enemy CombatSideHud]`, row 2 (spanning) = `.combat-main-area`, whose children are CSS-`order`ed (`index.css:20024-20032`) into this top-to-bottom stack:

1. `.arena-top-panel` — biome title + "Turn N | Duel" *(order 1)*
2. `.twp-strip` — terrain/weather one-liner *(order 2)*
3. `.hex-battlefield` — **the board**, ~280–420px *(order 3)*
4. `.dual-ap-panel` — player-AP | round-timer | enemy-AP *(order 4)*
5. `.hex-zoom-bar` — zoom slider row *(order 5)*
6. `<BattleTabBar>` — Actions | Log switch *(order 5)*
7. `.basic-action-bar` — Attack/Move/Heal/… *(order 5)*
8. `.combat-jutsu-bar` — equipped jutsu + item card grid, **unclamped height** *(order 5)*
9. `.combat-text-log` — battle log *(order 5)*

Above all of that sits row 1 (**two CombatSideHud panels**, ~110–150px). The `BattleTabBar` hides *either* 7–8 *or* 9, but everything else is **always present**. Net: `HUD strip (~130) + title + terrain + board (~350) + AP panel + zoom bar + tab bar + action bar + jutsu grid` regularly exceeds a ~700–800px phone, so **the whole `.center-game` column page-scrolls** (`.arena-fullscreen` has `min-height: calc(100vh - 170px)` and no height cap — `index.css:3228-3237`).

### 1.4 The CSS is "sedimentary" (a core risk)

`index.css` (~20k lines) contains **dozens** of layered `.combat-layout` / `.combat-side-hud` / `.hex-battlefield` passes written over time, many with `!important` and outside media queries. Which one actually wins is decided by a **specificity + source-order race**:
- Bare `.combat-layout` rules (1 class) at lines 3341, 4989, 5527 (`220px minmax(940px,1fr) 220px !important`), 6497 (`220px 1fr 220px !important`), etc.
- `.arena-fullscreen .combat-layout` rules (2 classes → higher specificity, these win) at 12818, 13299, and the **authoritative mobile block at 19892** (`1fr 1fr` grid), plus later 20298.

Any redesign that just adds "one more pass" inherits this fragility. **Consolidating combat layout into a single authoritative block is part of the fix, not a nice-to-have.**

### 1.5 Where HP lives today

- **Player HP:** only in `CombatSideHud` (`hp={playerHp}` / `maxHp={character.maxHp}`), rendered in-grid and portaled to a left sidebar on xl.
- **Enemy HP:** **not shown on the board at all** — `.dual-ap-panel` shows enemy *AP*, not HP; only floating damage numbers hint at it.
- **Pet HP:** the summoned pet **already** has a floating on-board bar — `petHpBadge` (`Arena.tsx:5501-5518`): a 5px rounded bar + tiny caption, absolutely positioned 16px above the pet orb, `zIndex 11`, green/amber/red by `pct` (`>50 #22c55e`, `>25 #f59e0b`, else `#ef4444`).
- **Towers:** actors already carry an on-orb HP bar (`BattleTowerFight.tsx:536-544`).

**So the per-fighter HP bar the user wants already exists twice in the codebase — just not for the two main Arena/PvP fighters.** All the data is in scope at the render point: `playerHp` (`Arena.tsx:623`), `enemyHp` (`:624`), `enemyMaxHp` (`:571`), `character.maxHp`, `playerShield` (`:637`), `enemyShield` (`:638`), `playerPos`/`enemyPos`.

---

## 2. Root causes of the two complaints

**Too much scrolling** is caused by *stacking*, not by the board:
1. Two full `CombatSideHud` panels occupy a whole grid row above the board (largely duplicating info).
2. Five always-on chrome panels around the board (title, terrain, AP, zoom slider, tab bar).
3. The board is a **fixed** 280–420px band rather than "fill the leftover height."
4. The jutsu/item grid and (in Towers) the log are unclamped/tall.
5. The root container page-scrolls instead of being height-budgeted to the viewport.

**No HP on the fighters** — player HP is off-board in the side HUD; enemy HP is not on the board anywhere. Reading either forces the eye off the two combatants (and on mobile, forces a scroll up to the HUD strip).

---

## 3. What good mobile combat UIs do (research)

Consistent guidance across mobile tactical / gacha turn-based / hex-strategy games and HUD/UX writeups:

**Layout — stop stacking, start layering into a fixed-height viewport:**
- Treat the battle screen as a single **`100dvh`** (dynamic viewport height, *not* `vh`) container in **three horizontal bands**: (1) slim top status strip, (2) a **flex-grow board** that aspect-locks and scales into whatever height is left (`minmax(0, 1fr)`), (3) a **bottom-pinned action bar** in the thumb zone, padded past the home indicator with `env(safe-area-inset-bottom)`.
- **Promote the battle log OUT of the column flow** — a 1–2 line ticker at the board's edge that taps to expand a full-height overlay, or fading toasts. A scrolling log inline is the second-biggest source of forced height.
- Distribute HUD bits to screen **edges** as small independent widgets instead of one tall monolithic HUD block.
- **Context-swap the bottom band** by phase (verbs → jutsu tray → target-confirm) so the control area never grows.
- Contain scrolling to the log only (`overflow:hidden` on the page, `overflow-y:auto` + `overscroll-behavior:contain` on the log); every flex/grid ancestor of a scroll region needs `min-height:0` or it refuses to shrink.

**Per-unit HP bars:**
- Anchor a slim bar **just above the unit's head** (not below — collides with the hex outline/next row; not only in a corner). Offset clear of the silhouette; make the bar follow the actor as it moves.
- **Traffic-light color** by health fraction (green → amber → red), pulse/alarm near death.
- **Two-layer "chip/lag" drain** (instant front fill + a slow trailing layer over ~300–500ms) so the *size* of a hit is legible in turn-based combat.
- **Hard outline / drop shadow** so the bar survives busy biome backgrounds.
- **Asymmetric detail:** show the player's exact `cur/max`; keep the enemy bar-only or bar + small number to cut clutter.
- **Side-color the frame** (blue player / red enemy) so a glance says whose bar it is.
- Co-locate a **damage flash + floating damage number** at the same head anchor (heals mirror in green).

The encouraging part: the codebase already has the primitives — `useBoardScale` (fit-to-space board, already re-fits on height change via `ResizeObserver` reading `clientHeight`, so a `flex:1` board works), `petHpBadge`/Towers bar (on-unit HP), `BattleTabBar` (the log is *already* in its own tab). This is mostly **applying patterns we already have**, plus one structural layout change.

---

## 3.5 Data-integrity guardrail — what must stay visible (verified against the code)

This section exists because the easy way to "shrink the HUD" is to delete rows — and some of those rows are the **only** place a piece of real combat data is shown. Verified at the actual call sites (`Arena.tsx:5306-5339` player, `:5861-5874` enemy, `:5368-5401` AP panel):

| Data | Where shown today | Real or decorative? | Rule for the redesign |
|---|---|---|---|
| **Player HP** | side HUD only (`hp={playerHp}`) | real | Moves onto the board badge. Keep a number (`cur/max`). |
| **Player Chakra** | side HUD only | **real, depletes; gates jutsu (combatResourcesV2)** | **Must remain visible on mobile** (HUD strip or board). Do NOT drop. |
| **Player Stamina** | side HUD only | **real, depletes; gates jutsu** | **Must remain visible.** Do NOT drop. |
| **Player Shield** | side HUD only, when `>0` | real | Keep (HUD row or a board-badge segment). |
| **Player buffs/debuffs** | side HUD `MobileEffectsStrip` only | real | **Must remain** — and you need BOTH fighters', not just the active one. |
| **Enemy HP** | enemy side HUD only (`hp={enemyHp}`) | real | Moves onto the board badge. **Keep a number** (hits-to-kill is tactical). |
| **Enemy Chakra / Stamina** | enemy side HUD | **decorative — passed `enemyMaxChakra`/`enemyMaxStamina` as BOTH current and max, always 100%** | Safe to drop on mobile (shows no real state). |
| **Enemy Shield** | enemy side HUD, when `>0` | real | Keep if `>0`. |
| **Enemy buffs/debuffs** | enemy side HUD `MobileEffectsStrip` | real | **Must remain visible.** |
| **Player/Enemy AP** | `.dual-ap-panel` only | real | Keep (the panel, or a board segment — see caveat below). |
| **Round timer / whose turn** | `.dual-ap-panel` (`CombatRoundTimer` + Acting/Waiting) + HUD turn badge + title "Turn N" | real, shown in 3 places | Redundant across HUD/AP/title — safe to thin, but the countdown ring must survive. |
| **Fighter name / village** | side HUD | name real, village flavor | Name → board-badge caption (like the pet badge). Village optional. |

**Net rule:** the only side-HUD items that are truly redundant once HP is on the board are the **HP line, the big avatar, and the turn badge**. Everything else (player chakra/stamina/shield, both fighters' effect strips) must keep a home. So the HUD gets *trimmed*, not *deleted*.

---

## 4. The plan (phased)

### Phase 1 — On-board per-fighter HP bars *(small, low-risk, delivers the HP ask)*

**Extract one shared component** so the three engines can't drift:

- New `shinobij.client/src/components/FighterHpBadge.tsx` — a slim, board-anchored HP bar built from the proven `petHpBadge` markup (`Arena.tsx:5501-5518`) and the Towers on-orb bar (`BattleTowerFight.tsx:536-544`) as reference. Props: `x, y, width, hp, maxHp, shield?, side ('player'|'enemy'|'pet'), label?, showNumbers?`.
  - Reuse the green/amber/red ramp already shared by `petHpBadge` and `CombatSideHud.tsx:117-118`.
  - Add the researched touches incrementally: side-colored border (blue/red), hard outline/shadow, optional two-layer lag drain, optional thin shield segment (data already in scope), and a name caption (so the on-board fighter is still labeled once the HUD avatar/name is trimmed).
  - **Numbers on both fighters.** Show `cur/max` for the player AND at least the enemy's current HP number. (Research suggested enemy could be bar-only, but the enemy HP number is real, tactically useful for hits-to-kill, and is shown today — do not remove it. If the enemy number is dropped from the HUD in Phase 2, the board badge becomes its only home, so it must carry it.)

- **Arena.tsx:** render it above the player orb (`playerHp`/`character.maxHp`) at ~`:5521` and above the enemy orb (`enemyHp`/`enemyMaxHp`) at ~`:5524`, using the **same** coordinate math as `orbForPos` (`x = col*X_STEP + HEX_W/2 - ORB/2`, `y = … + HEX_H*0.85 - ORB - 16`).
  - ⚠ **Critical:** the enemy orb at `:5524` is gated on `isImageAvatar(opponentAvatar)`. The **enemy HP badge must be emitted OUTSIDE that guard**, or image-less AI enemies show no HP bar. (When there's no image, the enemy avatar is an emoji inside the hex tile — the badge should still float over that tile.)

- **PvP:** same insertion in `orbForPos` (`PvpBattleScreen.tsx:1332-1338`).

- **Towers:** swap its bespoke on-orb bar for the shared component (keep behavior identical; it's the reference markup).

**Why it's safe:** these bars live **inside `.hex-grid-layer`'s local stacking context** (`zIndex 11`, above orbs at 10, below floating damage numbers at 20). They are `pointerEvents:none`, auto-scale with the board's `transform: scale()`, and glide with the fighter via the existing 280ms transition. **No page height added, no new media queries, no combat-logic change.** The full-screen-overlay overpaint hazard (nav z-1000 / side-rails) does **not** apply — do **not** portal these to `document.body`; that would break the board-scale transform and coordinate origin.

**Do NOT** reuse `PlayerNameplate` for this — it's a name/level/title chip row with no bar primitive and no board-attach positioning.

**Result of Phase 1 alone:** both fighters have always-visible HP on the board. This also *unlocks* Phase 2, because side-HUD HP becomes redundant on mobile.

### Phase 2 — Kill the scroll: viewport-fit the battle screen

Turn the page-scrolling column into a **three-band, height-budgeted** layout on mobile (research §3), leaning on primitives we already have.

1. **Make the battle root height-budgeted, not page-scrolling.** On mobile, give the battle container `height: 100dvh` (with `100svh` fallback, and `padding-bottom: env(safe-area-inset-bottom)`), lay `.combat-main-area` out as a flex column, and make the **action/jutsu area the `flex:1; min-height:0` internal-scroll region** — NOT the board.
   - **Why not `flex:1` on the board:** the hex grid is 12 columns wide, so on a portrait phone `useBoardScale` is **width-bound** (`min(cw/666, ch/411)` → ~0.56 from width on a ~375px column). Giving the board all leftover height just wraps a width-limited grid in dead vertical space; it does not grow the board. So keep the board a **bounded band** (the existing `clamp(...dvh...)`, possibly a touch smaller) and hand the leftover height to the thing players actually interact with (the jutsu tray / action content), which becomes the only scroll region.
   - Net: container = 100dvh (no page scroll) → `[thin HUD strip (auto)] [terrain+board+AP (auto/bounded)] [tab bar (auto)] [action/jutsu OR log = flex:1, min-height:0, internal scroll]`. Set `min-height:0` on every flex ancestor of that scroll region or it won't shrink. `useBoardScale` needs no JS change (it already re-fits on any resize).

2. **Trim (not delete) the mobile side HUDs.** With HP now on the board, the two `CombatSideHud` row-1 panels are the biggest fixed cost above the board — but they also hold data with no other home (§3.5). Safe reclaim, CSS-first (`index.css:19921-19995`) with no data loss:
   - **Drop the HP resource-line** (now on the board) and **the 40px avatar** (the fighter's avatar is already on the board) and the redundant turn badge.
   - **Keep** the player's Chakra + Stamina + Shield bars, and **both** fighters' `MobileEffectsStrip` (buffs/debuffs). Optionally drop the enemy's Chakra/Stamina bars only (decorative always-full, §3.5).
   - Result: each HUD becomes a compact "name + resources + effects" chip instead of a tall card — real height saved, nothing lost.
   - *Stretch (optional):* move Chakra/Stamina onto the board fighter badge as thin secondary bars so the HUD can shrink to effects-only. Deferred — research warns against occluding the unit, and 3 stacked bars over a 52px orb is cramped; keep resources in the HUD strip unless testing proves the board version reads well.

3. **The log is already tabbed — don't re-solve it.** `BattleTabBar`/`useBattleTabs` already put the log in its own **Log** tab (Actions tab = action bar + jutsu; not both stacked). The remaining height problem in the **Actions** tab is the **unclamped jutsu/item grid** (`Arena.tsx:5585-5822`): give it `min-height:0` + internal `overflow-y:auto` so it becomes the scroll region inside the fixed bottom band instead of growing the page. Optionally add a 3rd **Status** tab to house the verbose `CombatEffectsPanel` columns that are hidden on mobile today.

4. **Trim always-on chrome around the board:** fold `.arena-top-panel` title into `.twp-strip`; move `.hex-zoom-bar` into a small floating control over a board corner instead of its own row; compress `.dual-ap-panel` into a single slim row. ⚠ Do **not** simply "drop the AP panel" — it also hosts the **round-timer countdown ring** and the **enemy AP** bar. Any "AP on the fighter badge" variant must re-home the round timer (e.g. a small ring at a board corner) and keep enemy AP visible. Treat AP-on-board as an optional stretch, not part of the first ship.

5. **Pin the action bar to the bottom thumb zone** with `padding-bottom: env(safe-area-inset-bottom)` and the `viewport-fit=cover` meta (verify `index.html`).

### Phase 3 — Cross-engine parity + CSS consolidation

1. **One authoritative combat-layout block.** Replace the dozens of layered `.combat-layout`/`.combat-side-hud`/`.hex-battlefield` passes with a single, clearly-commented `.arena-fullscreen`-scoped block + one mobile media block. This is the highest-value cleanup for future-proofing; do it carefully with before/after screenshots at desktop + phone widths.
2. **Unify breakpoints.** Towers currently uses a lone `760px` (`index.css:3682`) and misses the `.arena-fullscreen` ≤800/≤520 compaction. Move all engines onto one shared combat-breakpoint set.
3. **Reconcile board sizing.** PvP/Arena use a fixed dvh clamp; Towers uses `flex:1 + min-height`. Adopt one **bounded-band** approach for all three (a shared dvh clamp), with the **action area** as the flex scroll region (per Phase 2 point 1) — since the board is width-bound on portrait, a bounded band is the right model, not `flex:1` on the board.
4. **Clamp the Towers log** (`BattleTowerFight.tsx:676`, fixed `220px`) to match the mobile treatment, or fold it behind the tab. Towers is N-actor, so keep its Squad/Enemy rails but reuse `MobileEffectsStrip` for the active player to match PvP/Arena.

---

## 5. Risks & guardrails

- **Data loss (the thing to watch).** "Shrinking the HUD" is tempting but several rows are the *only* place a real value is shown — player Chakra/Stamina/Shield and both fighters' buffs/debuffs. See **§3.5** for the verified keep/drop table. Only HP line + avatar + turn badge are safe to drop; enemy chakra/stamina are decorative and safe to drop; everything else must keep a home. Any implementation PR must be checked against §3.5.
- **Sedimentary CSS (highest risk).** The winning rules are buried deep and specificity-raced. Change the *authoritative* `.arena-fullscreen`-scoped blocks (≈`index.css:19890+`, `13299`, `20298`), not the early bare `.combat-layout` rules. Verify with the browser inspector at real widths — do not assume which rule applies.
- **Enemy `isImageAvatar` gate** — enemy HP badge must render independent of the orb guard (§4 Phase 1).
- **Three-engine parity.** Every change must be checked in Arena (PvE), PvP, and Towers. Prefer the shared `FighterHpBadge` + shared layout block so they can't drift. `server-routes.test.ts` won't catch UI drift — this is manual/visual.
- **Balance untouched.** HP bars are cosmetic readouts; the viewport work is layout-only. No AP costs, cooldowns, damage, targeting, or turn resolution change. Keep `pointerEvents:none` on all overlays so they never eat board taps.
- **`App.tsx` size ratchet.** New UI must go in its **own module** (`FighterHpBadge.tsx`), not App.tsx — the `App.size.test.ts` budget is at its ceiling.
- **`prefers-reduced-motion`.** Gate the lag-drain animation behind it (existing pattern in `battle-skin.css:946`).
- **Low-end mobile.** Respect the existing `liteFx`/`isLowEndMobile` gate — the lag animation and any glow should degrade there.
- **Deploy convention.** After any change, run `npm run build`; Railway self-builds from source, but the **cPanel committed `dist/` (root + force-added client dist)** must be rebuilt if cPanel needs to reflect it (per house convention it often lags — decide per change).

## 6. Open decisions (recommendations)

1. **Scope of first ship** — recommend **Phase 1 + the Phase-2 side-HUD collapse and board `flex:1`** as the first PR (delivers both complaints with contained risk), then Phase 3 as a follow-up cleanup PR. *(Confirm before I build.)*
2. **Mobile HUD treatment** — recommend **trim** the two HUDs (drop HP line + avatar + turn badge; keep chakra/stamina/shield + both effect strips per §3.5). *Not* a full "delete the HUD" — that would drop real data. Alternative stretch: move chakra/stamina onto the board too and shrink the HUD to effects-only.
3. **Enemy HP detail** — recommend **`cur/max` for the player and at least a current-HP number for the enemy** (both get numbers). Bar-only enemy is possible but removes hits-to-kill info that exists today, so I'd keep the number.
4. **AP on the board?** — optional: fold AP into a thin second bar on the fighter badge so `.dual-ap-panel` can drop on mobile. Slightly more work; defer unless you want it.

## 7. Test / verify checklist (when we build)

- Visual pass at real viewports: 375×812, 390×844, 360×800, plus a tablet and desktop. Confirm **no page scroll** in a fight and both HP bars visible/legible over every biome background.
- **Data-integrity check against §3.5:** with the mobile HUD trimmed, confirm player Chakra, Stamina, Shield(>0), and BOTH fighters' buffs/debuffs are still visible on a phone; confirm the enemy HP number and the round-timer countdown are still visible.
- HP bar tracks correctly through Move / Push / Pull (glide), damage, heal, KO (0 HP), and image-less AI enemy.
- All three engines (PvE Arena, PvP, Towers) verified.
- `npm run lint` in `shinobij.client/`; `npm test` at repo root; `App.size.test.ts` green.
- `npm run build` (+ commit `dist/` per cPanel decision).
