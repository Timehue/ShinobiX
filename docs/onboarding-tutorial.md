# Onboarding & Tutorial Plan

Detailed, implementation-ready plan for the new-player tutorial/onboarding,
including **auto-learning the chosen bloodline's jutsu at character creation**.
Drills into §3 of [`early-progression.md`](./early-progression.md); follows the
research principles documented there (teach-by-doing, progressive disclosure,
always-show-the-next-thing, win the first 60s). Competitor evidence for these
choices is in [`competitor-early-game.md`](./competitor-early-game.md) — notably
that ShinobiX's two closest genre twins (the genre leader, Ninpocho) both give new
players starter jutsu, making the auto-learn feature (§1) the genre norm.

> **Status:** proposal / not yet implemented.
> **Headline:** the whole flow is achievable as a **client-only** change. The
> save sanitizer (`api/save/[name].ts`) does not validate or strip
> `jutsuMastery`/`equippedJutsuIds`, so seeding starter jutsu at creation
> persists with no Vercel/cPanel API work (verified — see §1.4).

---

## 1. Feature A — Auto-learn the bloodline's jutsu at creation

### 1.1 Why nothing works today

A new character (`createCharacter`, `App.tsx:2660`) ships with
`equippedJutsuIds: []`, `jutsuMastery: []`, `elements: []`. They have *access* to
their bloodline's jutsu already — `canEquipElementJutsu` short-circuits `true`
for bloodline jutsu regardless of owned elements (`lib/bloodline.ts:87`). The
**only** thing blocking them is the loadout's `mastery.level >= 1` filter
(`App.tsx:27011`) and the equip guard (`App.tsx:26717`). So the fix is simply:
**give the chosen bloodline's jutsu mastery level 1 at creation.**

### 1.2 The starter bloodlines (data is fixed and small)

Each of the 4 starter bloodlines (`data/jutsu.ts:217`) has exactly **4 jutsu**
(3 damage + 1 utility), with stable IDs:

| Bloodline (offense) | Special element | Jutsu IDs |
|---|---|---|
| Ashen Eyes (Genjutsu) | Blood | `ashen-eyes-blood-gaze`, `ashen-eyes-crimson-hall`, `ashen-eyes-vein-mirror`, `ashen-eyes-hematoma-veil` |
| Inferno Cataclysm (Ninjutsu) | Lava | `inferno-cataclysm-lava-burst`, `inferno-cataclysm-molten-rain`, `inferno-cataclysm-crater-lance`, `inferno-cataclysm-obsidian-afterglow` |
| Shadow Lotus (Bukijutsu) | Shadow | `shadow-lotus-umbra-senbon`, `shadow-lotus-night-petal`, `shadow-lotus-eclipse-wire`, `shadow-lotus-black-petal-guard` |
| Iron Fang (Taijutsu) | Iron | `iron-fang-ferrous-crash`, `iron-fang-steel-maw`, `iron-fang-magnet-knuckle`, `iron-fang-anvil-breath` |

`getCharacterBloodlines` already resolves the starter by `character.bloodline`
name (with the `"Blue Blade Eyes" → "Ashen Eyes"` legacy alias,
`lib/bloodline.ts:37`), so we reuse that same lookup — no new data, no hardcoded
ID lists in `createCharacter`.

### 1.3 The change (in `createCharacter`, `App.tsx:2660`)

`createCharacter(name, village, specialty, bloodline)` already receives the
bloodline name and lives in the same module as `starterSavedBloodlines`. No
signature change. Resolve the bloodline → seed mastery → pre-equip:

```ts
// inside createCharacter, before the return
const starterName = bloodline === "Blue Blade Eyes" ? "Ashen Eyes" : bloodline;
const bl = starterSavedBloodlines.find((b) => b.name === starterName);
const learnedIds = [
  ...(bl?.jutsus.map((j) => j.id) ?? []),
  FLICKER_JUTSU_ID, // universal movement jutsu — confirm exact id in data/jutsu.ts
];
// ...
return {
  // ...existing fields...
  jutsuMastery: learnedIds.map((id) => ({ jutsuId: id, level: 1, xp: 0 })),
  equippedJutsuIds: learnedIds.slice(0, 4), // 4 bloodline jutsu (within the 15 cap)
};
```

**Tunables:**
- **Equip all 4 vs leave one** — pre-equipping all 4 makes the first fight fully
  loaded; leaving the 4th un-equipped creates a natural teach-by-doing "equip
  your last jutsu" step (§3, step 4). Recommend: learn all 4, **pre-equip 3**,
  teach the 4th.
- **Flicker** — include the universal Flicker movement jutsu so the player can
  reposition (bloodline jutsu are range 4). Confirm its ID in `data/jutsu.ts`
  (the non-bloodline list around line 200) before wiring.

### 1.4 Persistence — verified client-only (no API/cPanel change)

`sanitizeCharacterSave` (`api/save/[name].ts:220`) clamps level, ryo, currencies,
profession, per-stat + total stat gain, lifetime counters, pet cap (5),
inventory cap (500, absolute), and `examsPassed`. It **does not touch
`jutsuMastery` or `equippedJutsuIds`** — they pass through and are stored. The
`FIRST_SAVE_BASELINE_CHARACTER.jutsuMastery: []` baseline (line 216) is only used
for *diff-based* numeric clamps; there is no mastery diff/strip. So seeded
bloodline mastery survives the first sync.
- ✅ No new endpoint, no `server.ts` route, no parity work, no test changes in
  `api/`.
- ⚠️ Confirm `equippedJutsuIds` isn't separately capped below 4 anywhere on
  load (it's `slice(0, 15)` at `App.tsx:2465` — fine for 4).

### 1.5 Interaction: bloodline swap

`replaceCharacterBloodline` (`lib/bloodline.ts:100`) strips the old bloodline's
jutsu from `equippedJutsuIds` + `jutsuMastery` and **does not seed the new
one's** — so a swap currently leaves the player having to re-train. For
consistency with auto-learn, the swap path should **seed the incoming
bloodline's jutsu at level 1** (mirror §1.3). Flag for the same PR or a
follow-up; note it's a (mild) balance touch since it grants free level-1s on
swap.

### 1.6 The payoff moment

Right after creation (before/with the village-lore screen,
`VillageLoreScreen.tsx`), show an **"Awakening"** card: *"You awaken the
{Bloodline}. You've learned 4 jutsu:"* listing the 4 with their tags. This makes
the bloodline choice feel consequential (investment hook) and teaches that jutsu
= your kit. This is the first onboarding step (§3, step 1).

---

### 1.7 Judging jutsu "mastery" (for the Genin objective)

"Mastery" is not fuzzy — it's the per-jutsu **`mastery.level` (0-50)** in
`character.jutsuMastery` (`lib/jutsu-scaling.ts:32`). Two paths raise it:
- **Ryo training** (Jutsu Hall) → levels 1-30, but expensive/timed (3,000 ryo +
  10 min for 1→2). **Not** the criterion — it'd gate the objective behind a ryo
  grind.
- **Battle use** → **+20 jutsu XP per cast** (+40 in arena),
  `jutsuXpNeeded(level) = level × 50` (`jutsu-scaling.ts:27`). This rewards
  *playing*.

From the auto-learned level 1, casts to reach a level (PvE / arena):
level 2 = ~3/2 · **level 3 = ~8/4** · level 4 = ~15/8 · level 5 = ~25/13.

**Recommendation:** judge by `mastery.level`; set the Genin objective to a
combat-reachable threshold (**level 3** on the bloodline starter jutsu, ~8 casts
each). Keep it a **soft teach-by-doing goal** (Next-Goals breadcrumb + small
reward), not a hard wall (owner dislikes gates). If ever made a true gate, it
attaches cleanly to the existing level-20 Genin exam (`App.tsx:2060`).

### 1.8 Academy-Student PvP protection (owner-confirmed)

New players (Academy rank = level 1-14, `rankFromLevel`, `lib/stats.ts:130`)
cannot be targeted in PvP. Scope:
- **Server-side** is the source of truth: reject attacks where the *defender* is
  Academy rank in the PvP entry points (`api/player/attack.ts`,
  `api/player/challenge.ts`, `api/pvp/*`). ⚠️ Touches PvP/attack logic — additive
  (protect newbies) and low-risk, but per CLAUDE.md call out the change and keep
  Vercel/cPanel (`server.ts`) behavior in sync.
- **Client** hides/disables the "attack" affordance against protected players and
  shows a "protected until Genin" badge.
- Protection ends when the player reaches level 15 (Genin) — which also reads as
  a meaningful rank-up reward ("you can now duel / be dueled").

---

## 2. Onboarding state model

Add a single persisted field to the `Character` type (`types/character.ts`):

```ts
onboarding?: {
  step: OnboardingStep;        // current step in the linear flow
  skipped?: boolean;           // player chose "Skip intro"
  completedFirstBattle?: boolean;
  completedFirstMission?: boolean;
  version: number;             // bump to re-trigger / migrate
};
```

- **Why on the character (saved):** the flow must resume across sessions/devices
  and survive logout. The sanitizer merges unknown object fields through
  (`_utils.ts:44`), so a new `onboarding` object persists without server changes.
  (Confirm: no allow-list strips unknown character fields — the merge in
  `sanitizeCharacterSave` returns `char` built from `inChar`, preserving extras.)
- **Advance-by-doing:** each step's completion is driven by **existing
  state/counters**, not just a "Next" click, so the player learns by acting:
  - equipped a jutsu → `equippedJutsuIds.length > 0`
  - won first battle → `totalAiKills >= 1` (or `onboarding.completedFirstBattle`)
  - first mission → `totalMissionsCompleted >= 1` (`App.tsx:2702`)
  - chose profession → `profession != null`
  - trained a stat → `totalStatsTrained >= 1`
  - reached Genin → `level >= 15`
- **Skippable:** a persistent "Skip intro" sets `skipped: true` and jumps to the
  post-tutorial "Next Goals" state (§4). Never trap the player.
- **Idempotent/migration-safe:** existing live characters get
  `onboarding: { step: 'done', skipped: true }` on load (don't replay the
  tutorial for veterans) — gate on `createdAt` or absence of the field +
  `level > 1`.

---

## 3. The tutorial script

Linear, ~8–10 minutes, each step gated only by the previous, each advanced by a
real action. All steps skippable.

| # | Step | Teaches | Advance trigger | UI anchor |
|---|---|---|---|---|
| 0 | **Create** | Bloodline/village *mechanical* blurbs + stat preview | submit | `CharacterCreator.tsx` |
| 1 | **Awakening** | "You learned 4 jutsu" reveal (§1.6) | dismiss | new card after creation |
| 2 | **First battle** | AP, picking a jutsu, targeting, winning | battle won (`totalAiKills≥1`) | scripted spar / first encounter (see open decision) |
| 3 | **Stats** | Spend 2 of the 20 starting points | `unspentStats` decreases | Training/Profile coach mark |
| 4 | **Loadout** | Equip the 4th jutsu; what a loadout is | `equippedJutsuIds.length≥4` | Jutsu loadout coach mark |
| 5 | **First mission** | Mission loop + reward | `totalMissionsCompleted≥1` | Mission Hall coach mark |
| 6 | **Profession + dailies** | Pick a path; daily quests revealed (celebrated) | `profession!=null` | profession picker |
| 7 | **Shop** | One affordable upgrade with earned ryo | a purchase, or dismiss | curated shop view |
| 8 | **Hook** | Hand off to "Next Goals" (Reach Genin / win 3 / daily) | — | Next Goals panel |

**First-battle sourcing (open decision):** options are (a) a **dedicated
"Academy Sparring Match"** vs. a deliberately weak AI reachable directly from the
step — guarantees a sub-60s win, no explore-gating; (b) **reuse story beat 1**
(`getCurrentStory`, `App.tsx:2655`) if it's already a simple winnable fight;
(c) the wild-boar hunt — *not* recommended for step 2 because it requires
exploring sector 25 ×3 first (`App.tsx:3256`). Recommend (a) for a clean,
guaranteed first win.

---

## 4. UX architecture

- **CoachMark component** (`components/CoachMark.tsx`, new): a positioned tooltip
  + optional dimming/spotlight that points at a target by a stable
  `data-coach="<id>"` attribute. Add those attributes to the relevant nav
  targets in `Village.tsx`, `MobileNav.tsx`, `RightMenu.tsx`. One callout
  visible at a time; "Next" / "Skip intro" controls.
- **Driver hook** (`lib/onboarding.ts`, new): pure mapping `step → { text,
  targetCoachId, advanceWhen(character) }` + a selector for the current step.
  Keeps the step logic out of the `App.tsx` monolith (consistent with the
  ongoing lib/ extraction effort).
- **Next Goals panel** (from `early-progression.md` §5): the post-tutorial
  breadcrumb; the tutorial hands off to it at step 8. Reads existing counters,
  never empty.
- **Empty-state CTAs** double as guidance even if the player skips: empty loadout
  → "Unlock your first jutsu free →"; Village → "Recommended for new players."
- **Mobile:** callouts must anchor to `MobileNav`/`MobileStatusHUD` targets;
  keep one-at-a-time and non-blocking. Respect the project's mobile-responsive
  rule (no overlapping side panels).
- **a11y:** focus-trap the active callout, `Esc` = skip, ARIA labels on
  Next/Skip.

---

## 5. Instrumentation

Log the last `onboarding.step` reached before drop-off (cheap, highest
diagnostic ROI per the research). v1 can piggyback on the existing save blob
(the `onboarding.step` field is already persisted) so funnel analysis needs no
new telemetry endpoint; a dedicated event log can come later.

---

## 6. Phased build plan

**Phase 1 — Auto-learn bloodline jutsu (small, isolated, high-impact):**
- `createCharacter` seeds `jutsuMastery` + `equippedJutsuIds` (§1.3); confirm
  Flicker ID.
- Awakening reveal card (§1.6).
- (Optional, same PR) seed jutsu in `replaceCharacterBloodline` (§1.5).
- Verify in-app: create one of each bloodline, confirm 4 jutsu equipped + usable
  in a battle; reload to confirm persistence. Run `npm run lint` (client).
- **No `api/` or `server.ts` changes.**

**Phase 2 — Onboarding flow:**
- `onboarding` field on `Character` (`types/character.ts`); veteran-skip
  migration on load (§2).
- `CoachMark` component + `data-coach` anchors; `lib/onboarding.ts` driver.
- Creation-screen blurbs + stat preview (step 0).
- Wire steps 1–8; "Skip intro" everywhere.
- `npm run lint`. If `onboarding` field touches anything tested, `npm test`.

**Phase 3 — Supporting pieces (overlap with `early-progression.md`):**
- Dedicated "Academy Sparring Match" encounter (if option (a) chosen).
- Next Goals panel + new-player daily scaffold (the daily scaffold is the one
  piece that needs server work + `server.ts` parity — tracked in
  `early-progression.md` §6/§10).
- Funnel instrumentation (§5).

**Cross-cutting:** preserve existing saves (veteran-skip); keep Vercel/cPanel
consistent (only Phase 3 dailies touch the API); colocate any new `*.test.ts`.

---

## 7. Open decisions

1. **First-battle source** — dedicated sparring encounter (recommended) vs. reuse
   story beat 1. (§3)
2. **Pre-equip 3 or 4** bloodline jutsu (teach-by-doing vs. fully loaded). (§1.3)
3. **Seed jutsu on bloodline swap** now or later (mild balance touch). (§1.5)
4. **`onboarding` field on the save shape** — OK to add? (§2)
5. **Replay policy** for existing players (default: skip veterans). (§2)
