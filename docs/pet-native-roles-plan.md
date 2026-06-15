# Native Pet Roles — design + implementation plan

**Status:** Phases 0–3 BUILT + green (uncommitted). **Date:** 2026-06-14.

## Implementation status (2026-06-14)

**Done + tested (836 tests + lint + typecheck green; not committed/deployed):**
- New `shinobij.client/src/lib/pet-roles.ts` — the role taxonomy: `PetRole`,
  `PetSubRole`, archetype↔role map, `ROLE_RANGE`, role+sub-role stat lean,
  `derivePetRole` (even %4 role cycle + starter/mythic overrides), legacy
  `petTemplateArchetype` shim.
- `Pet` type gains `role?`/`subRole?`.
- `pet-balance.ts`: `balanceBuiltInPetTemplate` derives role/sub-role, themes the
  kit by sub-role (Sage pinned to `support` → always carries an ally heal), and
  applies the budget-neutral base-stat lean to **all tiers incl. mythics**;
  `capPetStats` backfills role/sub-role for old saves (the chokepoint — **no
  App.tsx growth**).
- **Mythics + starters audited** so kit + stats + role agree. Mythic spread is
  **3 defender / 3 assassin / 2 tracker / 2 sage**: defenders Frost Titan/Ryujin/
  Colossus (taunt/barrier, hp ~496–535/def ~49–53); assassins Worldstorm/Oni/Raijin
  (mark/wound/dot, hp ~354–389/atk ~62–75); trackers Solar Stag/Turtle Duck (debuff/
  mark zoner); **sages Vermillion Suzaku (phoenix) + Eclipse Kitsune** — the latter
  REWORKED from assassin to a support kit (`buff/damage/barrier/heal/absorb/move` +
  its mythic mech changed mark→haste "Eclipse Veil"), atk leaned to 39. Both sage
  mythics carry a heal. Starters already lean correctly (tank tankiest, assassins
  glassiest, sage has the heal) — left as authored.
- AI reads native roles: tactical arena `autoRoleTeam` → `pet.role`; grid-battle
  `petArchetypeFor` → `pet.subRole` (which also drives `archetypeMoveRange`, the
  per-turn range computed during fights).
- Distribution VERIFIED even: pool ≈ Def 33 / Trk 33 / Asn 33 / Sage 41 (each
  ~24–29%); 5 starters cover all 4 roles (Assassin doubles: Cinder Cub striker +
  Spark Pup assassin). New `pet-roles.test.ts` guards distribution + starter
  coverage + determinism + stat/range leans.

**Balance harness + tuning (NEW):**
- `scripts/pet-role-balance.ts` (new) — role-vs-role win-rate Monte-Carlo over the
  LIVE 1v1 engine (`runPetArenaBattle`). First draft of the lean was badly skewed
  (assassin ~70% / tracker ~25%); the round engine over-rewards attack. Tuned
  `ROLE_STAT_MULT` to: **assassin 62.5% / defender 57.9% / sage 53.5% / tracker
  28.7%**. Tracker left intentionally low in 1v1 (owner: it's meant to excel in the
  tactical arena instead); assassin nudged down from 70%, not over-corrected.

**Resolved since last pass:**
- Sage ally-heal — ALREADY WORKS in every engine (round 2v2 `runPetArenaParty`
  heals lowest-HP ally incl. partner, `pet-battle-sim.ts:2008`; the 1203 self-heal is
  the 1v1 path where self IS the only ally). No fix needed.
- Arena `ROLE_CFG` — DECISION: keep as-is. The tactical arena is a stylized mode
  where strong role identity is the point; the native lean adds only ~mild extra
  distinction; the live PvE/PvP engines have NO `ROLE_CFG` (they use the leaned +
  trained stats directly, honoring "trained stats authoritative"). Not a blind
  re-tune.

**Still open:**
- Balance validated for 1v1 only — NOT yet for 2v2 (`runPetArenaParty`), the tactical
  arena (capture dynamics — where tracker should win), or the duel sim. Trait/gear/
  level interactions with the lean unmeasured (harness is level-1, no traits/gear).
- Server arena lobby (`api/arena/_lobby-core.ts autoArenaRoles`) still force-assigns
  a balanced one-of-each comp by stat profile — does NOT use native `pet.role`. Solo
  arena uses native roles → inconsistency. Design decision (fair comps vs authentic).
- No UI surfaces a pet's role/sub-role anywhere.
- Rebuild + commit `dist/` for cPanel when shipping (Railway self-builds).

---

**Original plan below.** **Date:** 2026-06-14.

## Goal

Give every pet an **intrinsic, native role** (one of the four arena roles —
**Defender / Tracker / Assassin / Sage**) baked into the pet data model instead
of being re-derived at runtime by the tactical arena. The role determines the
pet's **base stats** and **moveset**; the existing **training timers** still let
players push stats however they want *on top of* that role baseline.

Decisions locked in with the owner:

- **Use all of them.** Two-tier taxonomy: the 4 roles are the coarse combat
  identity; the existing 7 archetypes (`tank/bruiser/striker/kite/control/
  support/assassin` in `pet-balance.ts`) nest **underneath** as *sub-roles*. The
  archetype moveset themer is reused, not discarded.
- **Global re-tune.** The role/sub-role shapes the pet's actual base stats and
  jutsu kit, so it shows in *every* engine (battle-sim, duel-sim, PvE, PvP,
  arena) — not arena-only. This is balance-sensitive and save-facing.
- **Role fixed, training free.** Role + sub-role are auto-determined and fixed
  per pet; they set the baseline. Players keep training freely via the existing
  timers.
- **Trained stats are authoritative in battle.** Both pet-battle modes use the
  pet's **live trained** stats (base + all training), *not* a role template
  recomputed at battle time. The role only sets the starting/base values;
  training is what's actually fought with. This also resolves the base/trained
  tension — see §7 — so the schema split (old Phase 4) is **not needed**.
- **Sage heals allies.** The Sage role must be able to heal *other* pets (not
  just itself) in party battles, across every engine.

## 1. The taxonomy (role ← sub-role mapping)

Each of the 7 archetypes belongs to exactly one of the 4 roles. Within a role,
the two sub-roles tilt the stat spread (owner's example: a **tank**-Defender has
higher DEF than a **bruiser**-Defender, but the bruiser-Defender has more ATK).

| Role | Sub-roles (archetype) | Identity |
|------|----------------------|----------|
| **Defender** | `tank`, `bruiser` | Frontline. Tank = armored wall (max DEF, mitigation); Bruiser = beefy brawler (high HP **and** ATK, less armor). |
| **Assassin** | `assassin`, `striker` | Burst. Assassin = glass-cannon dive; Striker = faster, slightly sturdier skirmisher. |
| **Tracker** | `kite`, `control` | Sustained ranged pressure. Kite = evasive poke; Control = zoner (slows/peels). |
| **Sage** | `support`, `control` | Backline support. Support = heals/shields; Control(sustain) = defensive zone control. |

### The `control` swing sub-role

`control` is the only archetype the owner listed under **two** roles (Tracker
*and* Sage). Resolve it deterministically by element lean (no new data needed):

- `control` + **Water** → **Sage** (Water = the defensive/sustain element).
- `control` + Wind / Earth / Lightning / None → **Tracker** (offensive zoning).

`support` always → Sage; `kite` always → Tracker. This honors the dual listing
without ambiguity and stays deterministic (required for ranked replays).

> **Open question (low stakes):** confirm the Water-vs-rest split for `control`,
> or pick a different signal (e.g. kit lean). Easy to change — one lookup.

## 2. Data-model changes (`shinobij.client/src/types/pet.ts`)

Add two optional fields to `Pet` (optional = save-safe; old saves backfill on
load):

```ts
role?: PetRole;          // "defender" | "tracker" | "assassin" | "sage"
subRole?: PetTemplateArchetype;   // existing 7-archetype union, re-exported
```

- Reuse the arena's `ArenaRole` union as the canonical `PetRole` (export it from
  a shared module — see §6 — so `types/pet.ts` doesn't import the arena sim).
- `subRole` reuses the existing `PetTemplateArchetype` from `pet-balance.ts`.
- Both are **derived, not authored** — so they never need to be in starter/admin
  templates by hand; the balance pass fills them.

## 3. Stat model — role profile + sub-role tilt (budget-neutral)

**Principle: redistribute, don't inflate.** Today every tier shares a fixed
per-rarity stat budget (`balancedPetBaseStats` in `pet-stats.ts`) and the code is
deliberate about keeping tiers in line (no tier dominates). The role/sub-role
profile **re-weights** that budget into HP/ATK/DEF/SPD — it does **not** add to
the total. This keeps PvP/PvE tier parity intact and avoids power creep when the
re-tune goes global.

Concretely, add a profile table (new `pet-roles.ts`, see §6):

```
ROLE_STAT_WEIGHT[role]      → relative HP/ATK/DEF/SPD/jutsuPower weighting
SUBROLE_STAT_TILT[subRole]  → small +/- shift inside the role's budget
```

Proposed starting weights (tunable by the sim in §10 — **not** final numbers):

| Role | HP | ATK | DEF | SPD | jutsuPwr |
|------|----|----|----|----|---------|
| Defender | ↑↑ | ↓ | ↑↑ | ↓ | – |
| Tracker | – | ↑ | ↓ | ↑ | ↑ |
| Assassin | ↓↓ | ↑↑ | ↓ | ↑ | – |
| Sage | – | ↓↓ | – | – | ↑↑ |

Sub-role tilt within the role budget:

- Defender·tank: +DEF −ATK (armored wall — mitigation, less HP) · Defender·bruiser:
  +ATK **+HP** −DEF (beefy brawler — owner: bruiser gets HP **as well as** ATK, not
  just ATK; it trades armor/DEF for raw HP-bulk + damage)
- Assassin·assassin: +ATK −HP · Assassin·striker: +SPD +HP −peakATK
- Tracker·kite: +SPD −DEF · Tracker·control: +jutsuPwr +DEF −SPD
- Sage·support: +jutsuPwr −ATK · Sage·control: +DEF +HP (sustain)

Implementation: fold the weighting into `balanceBuiltInPetTemplate`
(`pet-balance.ts:379`) right where it already computes `hp/attack/defense/speed`
from `base + variant − kitBonus`. The role/sub-role is resolved from
`element + variant` (same inputs the archetype themer already uses), so it is
deterministic and free. `capPetStats` still clamps to the per-rarity ceiling.

## 4. Moveset model — align the kit to role + sub-role

The archetype themer (`applyArchetypeKit`, `pet-balance.ts:315`) already rewrites
a non-mythic pet's utility slots to its archetype's palette. This is exactly the
"moveset supports the role" machinery — we make it role-aware:

1. **Pick the sub-role to match the role taxonomy.** Today
   `petTemplateArchetype(element, variant)` can return any of the 7 freely. Keep
   that, but the role is now the *parent* of whatever it returns, so kit and role
   are guaranteed consistent (a `tank` pet is a Defender, etc.). The
   `elementArchetypeRotation` stays — every element still spans roles.
2. **Guarantee a role-signature slot.** Each role gets one signature mechanic
   that always appears (Defender→`taunt`, Tracker→`mark`/`slow`, Assassin→burst
   finisher, Sage→`heal`/`shield`) — most already exist in `ARCHETYPE_KIT`;
   ensure the role's defining mechanic is never budgeted out at low rarity.
   **Sage specifically must carry an ally-target `heal`** (the `support` palette
   already has `Mend`; make it mandatory for every Sage, both sub-roles, at every
   rarity) — see §9 for the engine-side ally-targeting status.
3. **Mythics** keep hand-crafted kits; their `mythicMechByName` entry already
   encodes a role-flavored mechanic — just map each mythic's existing mech to its
   role for the field, no kit change.

No change to slot **count/order/damage/move slots** — that's what keeps the
positional save-merge (`mergePetJutsuSlots`) grandfathering existing pets.

## 5. Derivation (auto-assign, deterministic)

One pure function, `derivePetRole(pet) → { role, subRole }`:

- Resolve `element` (from pet or `petElementByName`) and `variant`
  (`petVariantIndex`), exactly as `balanceBuiltInPetTemplate` already does.
- `subRole = petTemplateArchetype(element, variant)` (existing).
- `role = ROLE_OF_ARCHETYPE[subRole]`, with the `control`→Water/rest split.
- Lives in the new `pet-roles.ts` lib; **pure, deterministic, no rng/Date** (so
  ranked replays stay byte-identical and both clients agree).

## 6. Where the code lives (App.tsx ratchet constraint)

`App.tsx` is **at its size ratchet ceiling** (`App.size.test.ts`) — any net new
line there fails the build. So:

- New module **`shinobij.client/src/lib/pet-roles.ts`**: `PetRole`,
  `ROLE_OF_ARCHETYPE`, the swing-`control` rule, `derivePetRole`,
  `ROLE_STAT_WEIGHT`, `SUBROLE_STAT_TILT`. Re-export `PetRole` for `types/pet.ts`.
- Wire the role/sub-role assignment **inside** `balanceBuiltInPetTemplate` and
  `resolvePetTemplateJutsus` (both in `pet-balance.ts`, a lib) so `normalizePet`
  in App.tsx gets `role`/`subRole` populated **without adding lines to App.tsx**
  (the template it merges from already carries them; `...baseTemplate`/`...pet`
  spreads bring them through). Verify no App.tsx growth before committing.

## 7. Migration & save-safety — the crux

`normalizePet` (`App.tsx:895`) merges saved stats against the template with
**`Math.max`** (template = floor), and stats are stored **absolute** on the pet
with **no base/trained split**. Consequences:

- **New pets** (freshly acquired/spawned from the pool) are built by
  `balanceBuiltInPetTemplate` → role-shaped stats + kit apply **fully and
  immediately**. ✅
- **Existing saved pets**: the floor rises where the role raises a stat
  (additive, no nerf) and the new utility kit flows in via the existing
  positional slot-merge. Where the role *lowers* a base stat, `Math.max` keeps
  the player's higher trained value — so an existing pet is **never nerfed**, but
  its stat *spread* won't fully reshape downward until the role floors catch up.

**Owner decision: trained stats are what battles use.** Because both pet-battle
modes fight with the pet's *live* stats (base + training), and training is meant
to be free-form, the **additive floor model is exactly right** — there is no need
to ever lower an existing pet's stat. The role sets the starting point; whatever
the player trains into is what shows up in battle. So we ship **A only**:

- **A — additive floor (the model).** Matches the codebase's no-nerf convention
  and the Hard Rules. New pets are fully role-shaped at acquisition; existing pets
  get raised floors + the role kit; nobody loses trained investment. Role identity
  is strongest at acquisition and softens as the player customizes via training —
  which is the intended "train it how you want" behavior.
- **B — base/trained schema split — DROPPED.** Previously considered to allow
  reshaping existing pets *downward*. The owner's "trained stats are what's used"
  call makes this unnecessary: there is no downward reshape, so no `trainedDelta`
  field, no save migration, no schema change. (Kept here only as a record of the
  decision.)

> Server note: `api/player/roster.ts:63` already relies on the client's
> `normalizePet` to backfill missing pet fields — so `role/subRole` backfill
> happens client-side on load with no server change required for Phase A.

## 8. Arena integration (consume the native role)

- `autoRoleTeam` (`PetArena.tsx:35`) currently derives the role from stats at
  match start. Change it to **read `pet.role`** (falling back to `derivePetRole`
  for any pet without one — defensive, though `normalizePet` should always set
  it). Less code, and the arena now agrees with every other screen.
- **Use the pet's trained stats faithfully (owner decision).** The arena's own
  `ROLE_CFG` stat multipliers (`pet-arena-sim.ts:57` — `hpMul 1.75`, `dmgMul
  1.55`, …) were written to *create* role identity from flat stats. Now that (a)
  base stats are already role-shaped and (b) the arena must fight with the pet's
  **live trained** stats, those multipliers both *double-count* the identity and
  *distort* the trained numbers (a 1.75× HP mult means trained HP isn't what's
  actually used). Re-tune `ROLE_CFG` toward `1.0` so the trained stats carry
  through, keep only a mild arena-local exaggeration if desired, and **re-run the
  arena sim** (`scripts/arena-ai-stats.ts`) to confirm win-rates stay balanced.
  This is the main arena balance task.
- Optional enhancement (the earlier "moveset should reflect role" idea): drive
  the arena's role ability flavor/power from the pet's actual role-signature
  jutsu instead of a fixed constant. Nice-to-have, not required.

## 9. Other engines + Sage ally-heal status

`pet-duel-sim.ts` and `pet-battle-sim.ts` already read the full `jutsus[]` kit,
`element`, and `trait` — so the **re-themed moveset flows through automatically**
once the template changes; no engine edits needed for moves. Stat changes flow
through because they read the pet's live `hp/attack/defense/speed` (the trained
values — exactly what the owner wants used). The only deliberate balance step is
re-running the existing PvP balance sims (`scripts/`) after the stat re-weight.

**Sage ally-heal — current state of each engine** (owner: "give Sage the ability
to heal other pets as well"):

| Engine | Heal targets… | Status |
|--------|---------------|--------|
| **Arena** (`pet-arena-sim.ts`, `mend`) | lowest-HP **ally** (`lowestHpAlly`) | ✅ already heals other pets |
| **Duel** (`pet-duel-sim.ts`, `castSupport`→`pickAlly`) | most-hurt **ally** on the team (partner in 2v2; self in 1v1) | ✅ already heals other pets |
| **Battle-sim** (`pet-battle-sim.ts:1203`, round autobattler) | the **caster only** — `nextActor`/`player`/`enemy` self-heal | ⚠️ self-only; the one gap |

So Sage already heals allies in the two "live combat" modes. The single change
needed is the **round-based battle-sim**: when the caster is a Sage (or any
support with a partner) and a teammate is more hurt, retarget the `heal` to the
wounded ally instead of self. Mirror the duel sim's `pickAlly` (lowest HP-frac on
the team), keep it deterministic, and guard the 1v1 path (ally == self there, so
behavior is unchanged for solo fights). Add a test.

## 10. Balance validation (gating)

Because this is global and balance-sensitive:

1. **Per-tier budget check** (unit test): assert each pet's post-balance stat
   *total* stays within the old per-rarity envelope (proves redistribution, not
   inflation).
2. **Arena win-rate sim**: `scripts/arena-ai-stats.ts` across role match-ups —
   no role should dominate; target rough parity.
3. **PvP/duel Monte-Carlo**: the existing `scripts/` balance sims — compare
   win-rate distributions before/after; flag any matchup that swings hard.
4. **Determinism**: re-run `pet-arena-sim.test.ts` / `pet-duel-sim` tests —
   replays must stay byte-identical (role is now stored & derived purely).

## 11. Phasing / rollout

- **Phase 0 — taxonomy + types (inert).** Add `pet-roles.ts`, `PetRole`/`subRole`
  on `Pet`, `derivePetRole`. No behavior change. Tests for the mapping.
- **Phase 1 — moveset alignment.** Make the archetype themer role-consistent +
  guarantee the role-signature slot. Flows through existing save-merge. Run
  `pet-balance.test.ts`.
- **Phase 2 — stat re-weight (additive, §7-A).** Fold role/sub-role weighting
  into `balanceBuiltInPetTemplate`, budget-neutral. Add the per-tier budget test.
  Run PvP/duel sims.
- **Phase 3 — arena consumes native role + uses trained stats.** `autoRoleTeam`
  reads `pet.role`; re-tune `ROLE_CFG` toward 1.0 so the pet's trained stats carry
  through; re-run arena sim. Behind the existing arena flag.
- **Phase 4 — Sage ally-heal in the round battle-sim.** Retarget the `heal` kind
  to the most-hurt teammate (mirror duel-sim `pickAlly`); 1v1 unchanged. Test.

Each phase is independently shippable and **all are save-safe** (no schema change,
no nerf). The previously-considered base/trained schema split is **dropped** per
the owner's "trained stats are what battles use" decision (§7).

## 12. File-by-file change list

| File | Change |
|------|--------|
| `shinobij.client/src/lib/pet-roles.ts` | **New.** Role union, archetype→role map, control split, `derivePetRole`, stat weight/tilt tables. |
| `shinobij.client/src/types/pet.ts` | Add `role?`, `subRole?` to `Pet`; import `PetRole` from `pet-roles`. |
| `shinobij.client/src/lib/pet-balance.ts` | Set `role/subRole` in `balanceBuiltInPetTemplate` + template resolver; apply budget-neutral stat weighting; ensure role-signature kit slot. |
| `shinobij.client/src/screens/PetArena.tsx` | `autoRoleTeam` reads `pet.role` (fallback `derivePetRole`). |
| `shinobij.client/src/lib/pet-arena-sim.ts` | Re-tune `ROLE_CFG` multipliers toward 1.0 (avoid double-count + let trained stats carry through); optional signature-driven ability. |
| `shinobij.client/src/lib/pet-battle-sim.ts` | Sage/support `heal` (line ~1203) retargets to the most-hurt teammate in party fights (mirror duel-sim `pickAlly`); 1v1 self-heal unchanged. |
| `scripts/arena-ai-stats.ts` + `scripts/` PvP sims | Re-run for balance; no code change unless a knob needs tuning. |
| Tests: `pet-balance.test.ts`, `pet-arena-sim.test.ts`, new `pet-roles.test.ts` | Mapping, budget-neutrality, determinism, migration grandfathering. |
| `App.tsx` | **No net new lines** (ratchet) — role flows through the template spread in `normalizePet`. Verify. |

## 13. Risks & open questions

- **Balance ripple (global).** The re-weight touches live PvP/PvE. Mitigate with
  budget-neutrality + the sims in §10; ship behind phases; watch for complaints.
- **Role identity softens with training (by design).** Since battles use trained
  stats and training is free-form, a player can train a Defender's ATK high, etc.
  This is the intended "train it how you want" behavior, not a bug — role shapes
  acquisition, the player shapes the rest. No schema split; additive only.
- **Arena double-count.** Must re-tune `ROLE_CFG` or roles will be doubly
  exaggerated in the arena.
- **`control` split** (§1) — confirm the Water-vs-rest rule.
- **App.tsx ratchet** — keep role wiring in libs; verify no growth.
- **Determinism** — role must stay pure/derived; no rng/Date in `pet-roles.ts`.

## 14. Verification checklist (per CLAUDE.md)

- `npm test` (repo root) — API/unit.
- Inside `shinobij.client/`: `npm run lint`, `npm run build`, and the pet/arena
  test suites green; `App.size.test.ts` passes.
- Balance sims re-run and reviewed before any global stat change ships.
- If anything in `api/`/`server.ts` changes (not expected here), rebuild + commit
  `dist/` for cPanel.
