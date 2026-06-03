# Early-Game Progression — Build Plan (followable)

The concrete, sequenced runbook to implement the
[master layout](./early-progression-layout.md). Each task lists exact files,
the change, how to verify, and parity/balance notes. Grounded in a final code
read-through (June 2026) — file:line refs are current.

**House rules honored:** no new stamina/energy/currency/gate; daily caps stay the
only throttle; preserve saves; keep Vercel/cPanel in sync; run `npm run lint`
(client) for FE changes and `npm test` (repo root) for API changes.

**Verification commands:**
- Client: `cd shinobij.client && npm run lint && npm run build`
- API: `npm test` (repo root)

**Confirmed integration points (read-through):**
- `createCharacter` → `shinobij.client/src/App.tsx:2660`
- starter bloodlines → `shinobij.client/src/data/jutsu.ts:217`; **Flicker id =
  `starter-universal-flicker`** (`jutsu.ts:192`)
- save sanitizer ignores `jutsuMastery`/`equippedJutsuIds` (seed persists) →
  `api/save/[name].ts:220` ✅ verified
- Logbook component → `App.tsx:26219`; `ExamRequirement` type `:26263`;
  `renderRequirement` `:26419`; exam render block `:26438`; in-scope helpers
  `ownedElements` `:26256`, `statsTrained` `:26259`, `defeatedAiIds` `:26260`
- `Character` type → `types/character.ts:116` (add flags near
  `hollowGateIntroSeen` `:252`)
- Village nav → `screens/Village.tsx:6` (only gets `characterVillage`+`setScreen`)
- overlay pattern (template for ceremonies) → `App.tsx:9034`
- profession unlock → `api/profession/choose.ts:10` + client trigger `App.tsx:9035`
- Genin exam requirements → `App.tsx:26283`
- XP multiplier → `constants/game.ts:27`

---

## PHASE 1 — Onboarding layer (🟢 + client-only 🟡). No API, no balance, no save risk.

### Task 1.1 — Auto-learn bloodline jutsu at creation
**Goal:** new character is combat-ready instead of empty.
**File:** `shinobij.client/src/App.tsx` (`createCharacter`, ~2660).
**Change:** before the return, resolve the chosen bloodline and seed mastery:
```ts
const starterName = bloodline === "Blue Blade Eyes" ? "Ashen Eyes" : bloodline;
const bl = starterSavedBloodlines.find(b => b.name === starterName);
const blJutsuIds = bl?.jutsus.map(j => j.id) ?? [];
// in the returned object:
jutsuMastery: blJutsuIds.map(id => ({ jutsuId: id, level: 1, xp: 0 })),
equippedJutsuIds: blJutsuIds.slice(0, 3),  // pre-equip 3
```
**Note:** intentionally do **not** pre-learn `starter-universal-flicker` — leave
it at level 0 so the guided first-session sequence (Task 1.7) can have the player
free-unlock it (the "first jutsu is free" teaching beat), then equip it as the 4th
loadout slot.
**Verify:** create each of the 4 bloodlines; confirm 3 jutsu equipped + usable in
a fight; reload → mastery persists (sanitizer leaves it alone, `save/[name].ts`).
**Notes:** also mirror this seed in `replaceCharacterBloodline`
(`lib/bloodline.ts:100`) so swapping doesn't leave the player unable to fight.
Client-only — no API/cPanel work.

### Task 1.2 — Add one-time onboarding flags to the Character type
**Goal:** persist checklist/ceremony "seen" state, matching existing convention.
**File:** `shinobij.client/src/types/character.ts` (near `hollowGateIntroSeen:252`).
**Change:** add optional flat booleans:
```ts
academyChecklistClaimed?: boolean;
geninCeremonySeen?: boolean;
```
**Verify:** `npm run build` (client) typechecks. Save merge preserves unknown
fields (`api/_utils.ts:44`) — no API change.

### Task 1.3 — Academy Training checklist in the Logbook
**Goal:** fill the level 1-10 guidance gap; the Logbook becomes the "what now" home.
**File:** `shinobij.client/src/App.tsx` (`Logbook`, 26219-26460).
**Change:**
1. (Optional, recommended) extend the requirement type + renderer for one-tap nav:
   - `ExamRequirement` (`:26263`): add `goScreen?: Screen`.
   - `renderRequirement` (`:26419`): if `goScreen && !complete`, render a
     `<button onClick={() => setScreen(req.goScreen)}>Go</button>` (mirror the
     existing `aiId` "Fight" button at `:26429`).
2. Build the Academy checklist (reuse in-scope `ownedElements`, `statsTrained`):
```ts
const academy = character.academyChecklistClaimed ? null : {
  title: "Academy Training",
  requirements: [
    { label: "Awaken your first element", progress: ownedElements.length, target: 1,
      detail: ownedElements[0] ?? "Free roll at Level 2" },
    { label: "Equip your jutsu loadout", progress: character.equippedJutsuIds.length, target: 4, goScreen: "jutsuLoadout" },
    { label: "Win your first battle", progress: character.totalAiKills ?? 0, target: 1, goScreen: "battleArena" },
    { label: "Train at the grounds", progress: statsTrained, target: 5, goScreen: "training" },
    { label: "Complete your first mission", progress: character.totalMissionsCompleted ?? 0, target: 1, goScreen: "missions" },
    { label: "Sharpen a jutsu (mastery Lv 3)", progress: Math.max(0, ...(character.jutsuMastery ?? []).map(m => m.level)), target: 3 },
  ],
};
```
3. Render it **above** the Rank Exams block (`:26438`) while
   `rankFromLevel(character.level) === "Academy Student"`. When
   `requirements.every(met)`, show a one-time **"Claim Academy reward"** button →
   `updateCharacter({ ...character, academyChecklistClaimed: true })` (+ optional
   small reward — flag if added, that's the only balance touch).
**Verify:** new char sees 6 goals; completing each ticks the bar; claim hides it;
exam block still works. `npm run lint`.
**Notes:** confirm the exact `Screen` union names (`jutsuLoadout`, `battleArena`,
`training`, `missions`) against the `Screen` type before wiring `goScreen`.

### Task 1.4 — HUD "next goal" pin
**Goal:** surface the next incomplete goal without opening the Logbook.
**Files:** `shinobij.client/src/components/MobileStatusHUD.tsx` and/or the Village
save-bar (`screens/Village.tsx:26`).
**Change:** compute the first incomplete Academy requirement (or "Ready: Genin
Exam") and render a compact pill that routes to `logbook` on tap.
**Verify:** pin updates as goals complete; hidden once `academyChecklistClaimed`.

### Task 1.5 — Village progressive disclosure + empty-states
**Goal:** stop showing all 15 buttons to a level-1 player.
**File:** `shinobij.client/src/screens/Village.tsx`.
**Change:** thread `level` (or `rankTitle`) into `Village` (currently only
`characterVillage`+`setScreen`); add an `unlockLevel`/`unlockRank` to each
`locations` entry and filter (or visually de-emphasize) Clan/PvP/Ranked/etc. until
Genin. Use **existing** rank thresholds — no new gate.
**Verify:** Academy player sees the core set; Genin+ sees the rest. `npm run lint`.

### Task 1.6 — Creation blurbs + awakening reveal
**Goal:** make the bloodline/village choice legible and the auto-learn feel earned.
**Files:** `shinobij.client/src/screens/CharacterCreator.tsx`; a small reveal card
after creation (before/with `VillageLoreScreen`).
**Change:** one-line mechanical blurb per bloodline/village + stat preview; an
"You awaken the [Bloodline] — learned 4 jutsu" card listing the seeded jutsu.
**Verify:** `npm run lint`.

### Task 1.7 — Guided first-session sequence (forced, after Village Lore)
**Goal:** right after `villageLore` → `village`, walk a brand-new player through a
short forced sequence: explain the Village menu → force a stat training → force a
free jutsu unlock. Learn-by-doing (steps advance on the real action), not click-Next.
**Pattern:** a new `<OnboardingCoach>` overlay rendered in `App.tsx` beside the
`ProfessionPicker` overlay (`App.tsx:9034`), shown while
`character.onboardingStep !== "done"`. Dimmed scrim blocks all but the highlighted
target ("forced"); a small "Skip tutorial" link is recommended.
**State:** add `onboardingStep?: "tour" | "training" | "jutsu" | "done"` to
`types/character.ts` (flat field, like `hollowGateIntroSeen`). Set to `"tour"` in
`createCharacter`; migrate existing chars (`level > 1` && no field → `"done"`).
**Steps & advance triggers:**
| Step | Coach action | Advances when |
|---|---|---|
| `tour` | tour the Village buttons with a one-line `blurb` each (add `blurb` to the `locations` array, `Village.tsx:6`) | player taps through all captions |
| `training` | auto-`setScreen("training")`, highlight a stat + the 15-min timer | `activeTraining` becomes non-null |
| `jutsu` | auto-`setScreen("jutsuTraining")`, highlight the dropdown + **"Unlock Level 1 (Free)"** (`Training.tsx:339`) | a new `jutsuMastery` entry appears (e.g. Flicker) |
On `jutsu` complete → `onboardingStep = "done"`; hand off to the Academy checklist
(1.3) + HUD pin (1.4).
**Depends on:** Task 1.1 leaving Flicker unlearned (the free-unlock target); Task
1.2/1.5 (the `Village` component must receive `character` to highlight buttons).
**Verify:** new char is forced through tour → training → free jutsu, then released;
`activeTraining`/`jutsuMastery` checks fire correctly; "Skip" works; veterans never
see it. `npm run lint`.
**Notes:** pure client UI over existing screens/actions — **no new system, no API,
no balance.** Reorder steps freely; make "Skip" removable if you want it strictly
unskippable.

**Phase 1 done when:** a fresh account spawns combat-ready, is guided through the
forced first-session sequence (menu tour → training → free jutsu), then has a
6-item Academy checklist + HUD pin + focused Village — and none of it touched the
API, balance numbers, or the save schema (beyond a few optional flags).

---

## PHASE 2 — Additive logic (🟡). Small, low-risk; some touch the API → cPanel parity.

### Task 2.1 — Academy PvP-protection
**Goal:** Academy Students (level 1-14) can't be attacked.
**Files (server, source of truth):** `api/player/attack.ts`, `api/player/challenge.ts`,
`api/pvp/*` — reject when the **defender**'s rank is Academy (level < 15). **Client:**
hide/disable attack vs protected players + "protected until Genin" badge.
**Parity:** register/confirm routes in `server.ts`; keep CORS untouched.
**Verify:** `npm test`; attempt to attack a sub-15 target → rejected server-side.
**Risk note (CLAUDE.md):** additive guard, not a combat-math change — call it out
in the PR; ends at level 15 (doubles as a Genin reward).

### Task 2.2 — Jutsu-mastery requirement on the Genin exam
**Goal:** the exam teaches the jutsu system.
**File:** `App.tsx` Genin exam requirements (`:26288`).
**Change:** add `{ label: "Sharpen a jutsu (mastery Lv 3)", progress: Math.max(0, ...mastery levels), target: 3 }`.
**Verify:** `npm run lint`; combat use levels the jutsu and ticks the requirement.

### Task 2.3 — Profession unlock → Genin + ceremony
**Goal:** professions reveal at Genin (when PvP opens), as a ceremony.
**Files:** `api/profession/choose.ts:10` (`PROFESSION_UNLOCK_LEVEL` 13→15), client
trigger `App.tsx:9035` (`level >= 13` → `>= 15`); add a Genin ceremony overlay
modeled on the ProfessionPicker overlay (`App.tsx:9034`), gated by
`!geninCeremonySeen`. Sequence: ceremony → picker.
**Parity:** server + client unlock level must match.
**Verify:** `npm test` + manual: reaching Genin fires ceremony then picker.
**Optional:** keep unlock at 13 and only add the ceremony — layout works either way.

### Task 2.4 — One-time early profession respec
**Goal:** safety valve for the permanent choice.
**Files:** new/extended endpoint near `api/profession/choose.ts` (allow one reset
if `professionRank` low / before Chunin); client button in the profession UI.
**Parity:** `server.ts` route. **Verify:** `npm test`.

### Task 2.5 — Surface profession missions in the Logbook
**Goal:** unify the "next thing" home.
**Files:** `App.tsx` Logbook + `screens/DailyProfessionMissions.tsx` (reuse its
data). Render the active profession's next mission/rank under the exam block.
**Verify:** `npm run lint`.

---

## PHASE 3 — Tuning (🟠). Balance-sensitive; explicit owner sign-off + save review.

### Task 3.1 — XP multiplier decision + Genin exam re-tune (coupled)
**File:** `constants/game.ts:27` (`CHARACTER_XP_GAIN_MULTIPLIER`); Genin "Train
1000 stats" target `App.tsx:26290`; update `api/_xp-engine.test.ts` in lockstep.
**Why coupled:** stat points scale with effective XP (`statPointsEarnedFromXp`,
`App.tsx:2031`), so the exam stat count is only sane relative to the multiplier.
**Verify:** `npm test`; model time-to-Genin at the chosen value.
**Save note:** lowering the multiplier slows existing players going forward —
decide global vs grandfather vs phased.

### Task 3.2 (optional) — Smooth the first jutsu-training levels
**File:** `screens/Training.tsx:300` (`jutsuTrainingCost`). Make levels ~1-5 cheap.
**Note:** not required — auto-learn + battle-XP mastery already lets a new player
fight and grow jutsu without paying the 3,000-ryo L1→2 cost.

### Task 3.3 (optional) — Shorter hospital timer for low levels
**File:** `screens/Hospital.tsx:20` — reduce the 60s wait under ~level 10.

---

## Suggested order to actually code
1. 1.1 → 1.2 → 1.5 → 1.3 → 1.4 → 1.6 → 1.7  (ship Phase 1 as one PR: the felt win, zero balance risk. 1.7 last — it depends on 1.1's Flicker decision + 1.5's `character` prop on Village)
2. 2.2 → 2.5  (cheap UI logic)
3. 2.1 → 2.3 → 2.4  (API-touching; one PR with cPanel parity + tests)
4. 3.1  (only with sign-off) → 3.2/3.3 if desired

## Open decisions to confirm before Phase 2/3
- Profession unlock: move 13→15, or keep 13 + ceremony only? (Task 2.3)
- Genin ceremony anchor: level-15 title flip vs level-20 exam pass?
- XP multiplier target + live-player handling. (Task 3.1)
- Add the optional small Academy-completion reward? (Task 1.3)
