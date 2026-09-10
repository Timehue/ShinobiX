# Pet Colosseum: distinct effects within each loadout

The actual engine seals 945 equipped move slots across 160 pet templates. Every loadout now resolves to distinct primary effect geometry, including its signature. The audit includes breeding exclusives and starter forms. It does not claim 945 globally unique effects: recipes may be shared between different pets.

## Changes

- Added continuous fire cones and water pressure jets, horizontal electric arcs, traveling elemental blades and comets, rising stone spears, and five elemental storm presentations.
- Fire finishers rain burning fragments into a flame column. Water finishers whirl falling ice through broken mist bands. Wind finishers form a spiral funnel. Earth finishers spread branching fissures through lifting floor fragments. Lightning finishers discharge forked sky bolts with soft electric halos.
- Reserved a signature's primary silhouette before assigning regular attacks. Same-kind attacks receive different geometry, rather than different colors or random rotations. Assignments are deterministic and independent of slot ordering, pet instance IDs, power and equipment.
- Kept mechanic-specific utility effects. Rebuilt shield, barrier and protect as a curved dome, an interlocking hexagonal wall, and surrounding ward panels respectively.
- Removed the generic projectile/large explosion overlay from authored techniques so the move's own shape remains visible. Utility casts keep their mechanic effect rather than inheriting an elemental damage set-piece.
- Used the existing shared cast/contact clock and body-surface endpoints. Misses and blocked attacks cannot produce successful victim storms. Effects finish inside their action beat at either playback speed.
- Adjusted signature framing relative to the attack lane, with a higher view for ground effects and a stable launch origin during melee travel.
- Bounded the reusable renderer to at most 36 small particles and quality-scaled fragments/halos. Reduced motion retains the primary geometry while removing particle travel, moving surface noise and extra lights.

The requested Earthquake, Blizzard, Hydro Pump, Thunder and Flamethrower examples supplied the visual direction. These are original procedural effects using the game's existing palette and models.

## Verification

- `node --import tsx scripts/showdown-vfx-audit.mjs --out=docs/pet-colosseum-move-vfx-audit-2026-09-09.json`: **160 pets, 945 slots, zero repeated primary effect assignments within a loadout**.
- Roster tests repeat the check at levels 1, 30 and 100 and reverse every kit's slot ordering.
- 57 tests pass across move identity, effect envelopes, blocked/missed contact, normal/fast timing, melee routing, camera framing and postprocessing.
- Client type checking and ESLint pass. The final production bundle and distribution verification pass. Product JS/CSS is **8,181,340 bytes**, below the existing **8,200,000-byte** ceiling; the ceiling was not changed.
- Browser review covered the fire cone, water jet, blizzard, earthquake, defensive wall/wards, wind blade at 2.1× playback, low-graphics water with reduced motion, and lightning at Cinematic quality. Blocked quake and missed lightning produced no successful victim effect. No browser graphics errors were reported in the reviewed scenes.
- The optimized development harness now loads its move names/classes/kinds from the real server seal. Its review controls can play any equipped move with hit, miss or block outcomes, using the production battle renderer. The fixture and controls are excluded from the shipping app.
- Representative screenshots are in `output/pet-colosseum-move-vfx/`. Visual inspection is representative; the complete roster check is automated. This is not a hardware frame-rate certification.

No combat power, move costs, targeting rules or server damage calculations changed in this pass.

## Integration follow-up and larger finishers

The follow-up runs **5,670 actual engine casts**: all 945 equipped slots, both teams, and all three formats. Every event finds the presentation assigned to its real loadout, including reserve pets. Additional cases cover allied healing, invalid-target replacement, Guard, Rest, Protect, absorption, primary and splash dodges, and replay serialization.

Fixed these integration gaps:

- The engine now includes the resolved aim independently of the damage entries. A primary dodge no longer removes the dash/cast destination or redirects the camera and main strike to a splash victim. Older scripts fall back to a non-splash contact when one exists.
- Guard's partial damage retains the authored elemental impact. Fully blocked hits and misses do not create a successful impact on that pet.
- The body evade and DODGED cue now happen at attack contact. The later consumable beat credits the item without repeating the body dodge.
- Unknown older melee techniques select a contact-compatible effect instead of a projectile that has no flight window.

Frost Shatter now stages as a **ranged blizzard for all 10 pets that equip it**. Its existing physical damage calculation remains intact. Water and lightning signature storms cover each enemy that actually takes damage, including splash. Blocked and dodging pets retain their correct reactions while the other enemies still receive the storm.

The new storm renderer uses a planted cast, an advancing cold front, falling ice, snow, turbulent fog and frost seams for the blizzard. Lightning connects the sky to every struck enemy with large primary bolts, branching forks and soft halos. The camera widens to include the enemy formation. Generic damage explosions are suppressed on all targets covered by the authored storm.

The renderer reuses three impact stations with shared geometry and materials. At Cinematic quality it caps the blizzard at 108 instanced ice fragments and 324 small snow points for the whole team. Reduced motion retains the main shapes with six static ice fragments per struck enemy, no moving snow and no dynamic light. All transient resources are disposed when the renderer unmounts or its quality allocation changes.

**162 regression tests pass**, including the full engine, AI, replay, damage pacing and presentation checks. The refreshed roster audit still reports **160 pets, 945 slots and zero repeated assignments within any loadout**. The development review now supports actual engine rounds, not only mock outcomes. Browser evidence includes Guard chip, full Protect, a dodge during fast melee playback, and successful team-wide blizzard and lightning strikes at Cinematic quality. Review images are saved under `output/pet-colosseum-move-vfx/`.

The authored move recipes reach the live Colosseum through `PetShowdownBattle`; Arena/Ladder replay hosts reuse that component through `PetShowdownReplay`. The turn API passes engine events through without stripping the new aim field. The new event fixtures remain confined to the development QA build.

The final full production build passes server/client TypeScript, distribution verification and the unchanged size gates: **8,188,929 / 8,200,000 bytes** of product JS/CSS. Changed client files pass ESLint. Successful storm captures are `blizzard-team-engine.jpg` and `thunder-team-engine.jpg`; the earlier Frost Shatter melee-dodge timing capture predates its ranged redesign. The low/reduced-motion blizzard review confirms that a primary dodge excludes that pet while the remaining enemies still receive their storm effects. No browser rendering errors were observed. Changes remain local and are not deployed.

## Fire, earth and wind follow-up

- Removed the floating **STAB** proc label. The existing same-element damage bonus and other equipment/trait callouts remain intact.
- Extended formation-wide presentation to all five elemental signatures. Fire now raises layered flame towers with incandescent fragments, rising embers and dark smoke. Earth breaks the enemy formation into broad lifted and tilted stone slabs, with flying fragments, branching ground faults and warm dust. Wind raises tall widening tornadoes with feathered helical ribbons and lifted leaves. Frost Shatter and lightning keep their established geometry.
- Strengthened ordinary attacks: layered flame jets and a burning impact, a larger tumbling stone projectile that shatters into debris and cracks, and wider wind crescents with a curling wake. Each pet's equipped moves still use distinct primary shapes.
- All offensive signatures now cast from the pet's own position, including **Gale Render**, regardless of physical/special damage class, battle format or remaining enemies. The replay queue also normalizes historical melee signatures and splash attacks to ranged staging, without mutating the stored event or its damage. Single-target physical moves retain their dash.
- Reused the bounded three-station renderer, shared materials and instanced fragments. Particle travel and extra dynamic lighting remain disabled for reduced motion; the main geometry is retained.

The refreshed audit reports **160 pets, 945 equipped slots, zero duplicate primary assignments within a loadout**. All **164 regression tests** pass, including 5,670 real casts, all five elements' guarded/absorbed/dodged area hits, and historical replay staging. Client type checking and scoped ESLint pass. The full production build and distribution/size checks pass at **8,193,892 bytes** of product JS/CSS. This pass does not raise any build-size gate.

Browser captures of the completed fire, earth and wind signatures and regular attacks are saved as `*-team-engine.jpg` and `*-regular-engine.jpg` in `output/pet-colosseum-move-vfx/`. The development-only preview is rebuilt separately after production verification. These changes remain local, not deployed.

Reduced-motion wind was also reviewed at Performance quality in desktop and 390×844 portrait views: two landed splash victims retain their tornadoes while the dodging primary has none. The final captures are `wind-dodge-low-reduced.jpg` and `wind-dodge-mobile-low-reduced.jpg`. No browser rendering errors were reported in the reviewed scenes. The local preview is left on the successful Cinematic Gale Render round with a stationary caster.
