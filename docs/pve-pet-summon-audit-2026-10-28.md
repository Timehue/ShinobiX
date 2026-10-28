# PvE pet summon audit — 2026-10-28

## Question and expected behavior

Does summoning use the player's selected, owned pet and correctly execute its
combat behavior in solo PvE and the shared Tower/group runtime?

The existing contract in `architecture/solo-pve-compatibility.md` specifies a
server-sealed companion, once-per-fight admission, four action phases,
automatic movement and learned abilities, happiness/gear effects, and durable
usage evidence for settlement. The owner additionally approved making Speed
improve movement while preserving duration and turn order. The accepted growth
meaning is maintained in `pet-growth-food-redesign.md`. A subsequent owner request
sets summoning to 20 AP, with a 0 AP exemption for rank-10 Pet Tamers. Both
engines seal this price at admission, reject unaffordable summons without
spending AP, and charge only after a legal summon placement succeeds. The
summon retains its existing action-slot exemption.

## Findings and corrections

| Finding | Classification | Impact and action | Evidence |
| --- | --- | --- | --- |
| Both engines classified offensive casts using `companionMoveDamage(1, move) === 0`. Low-power attacks rounded to zero. | Implementation drift | Reproduced attacks across the board. Both engines now classify support by ability kind before checking offensive range. | `api/combat-core/companion-audit.test.ts`, first two cases; `.tmp/pve-pet-audit/before.log` records both failures before correction. |
| Speed was absent from summon snapshots and movement used a fixed cost. | Matches previous design; owner-approved design change | New snapshots carry actual owned Speed. Movement receives a bounded discount; retained snapshots preserve their previous cost. Strike damage, turn order, AP budget, action cap and duration are unchanged. | `api/combat-core/companion.ts`, `api/solo-pve/_engine.ts`, `api/towers/_companion.ts`, `api/towers/_engine.ts`; actual Agility-growth regression in `companion-audit.test.ts`. |
| The hunt/group adapter paid the consumable's summon heal after the shared engine had already paid it. | Implementation drift | Reproduced 1,000 HP instead of the intended 990 from 740/1,000 HP with a 25% heal. The adapter now projects usage only; the engine remains the single heal authority. | `api/solo-pve/_hunt-combat.ts`, exact-heal assertion in `_hunt-combat.test.ts`; `.tmp/pve-pet-audit/heal-before.log`. |
| Selected identity, nickname, HP, attack-derived damage, defenses, learned progression kit and durable PvE gear reach the combat snapshot. | Matches design | Confirmed the owned pet is selected by active ID and later save changes do not replace the admitted snapshot. | `sealCompanionFromSave`; owned-pet regression in `companion-audit.test.ts`. |
| Vitality, Power, Guard and stat-granting traits affect the companion. | Matches design | HP and defenses are retained; actual hits increase with Power; Vitality does not inflate the solo counterattack baseline. Swift's existing Speed bonus now affects movement. | `companion-audit.test.ts`, `api/towers/_companion.test.ts`. |
| Eligibility, happiness, gear/consumable heal, owner lifesteal, Final Art preparation/mastery, support, expiry and consumption receipts have executable coverage. | Matches design | Existing tests run alongside the new regressions; no new reward, equipment-consumption or eligibility rule is introduced. | `api/towers/_companion.test.ts`, `api/combat-core/pet-mastery-execution.test.ts`, `api/solo-pve/_solo-pve.test.ts`, `api/missions/_ai-fight-companion-cost.test.ts`, `api/pet/_happiness-settle-wiring.test.ts`. |

## Format boundaries

Summons use the short shinobi-combat companion rules, not the standalone
Colosseum simulator. HP, attack-derived damage, defense, Speed, learned moves,
growth and stat trait bonuses carry through. Colosseum-specific stamina,
signature-meter, elemental and trait effects are not silently transplanted into
shinobi combat. Solo counterattacks against the pet are physical; group combat
also carries the pet's role-derived special defense into the shared damage path.
Pet support healing/shields target the pet; owner healing comes from the
specified PvE gear/consumable effects.

## Validation and scope

- The two range regressions failed before the correction and pass afterward.
- Eight new integration checks pass, including real Agility/Power allocations,
  both combat engines, snapshot identity and the four-phase single-use lifecycle.
- The combined companion, solo, hunt, group, Tower, mastery and settlement subset:
  290 passed, zero failed (`.tmp/pve-pet-audit/integration-final.log`).
- Full `npm test`: 18,640 passed, 30 skipped, zero failed (18,670 total;
  `.tmp/pve-pet-audit/full-unit-local.log`). The initial sandboxed dependency
  setup failed before tests started; the successful run restored dependencies
  and executed the suite with local network access.
- Final `npm run build:server`: passed (`.tmp/pve-pet-audit/build-server-final.log`).
- Scoped `git diff --check`: passed. Exact source hashes and the base commit are
  retained in `.tmp/pve-pet-audit/evidence.json` for this dirty working-tree audit.

Evidence is local executable code/test evidence, not a production deployment
claim. Changes preserve existing endpoint signatures, storage keys, reward
rules and old snapshots without Speed. No SQL migration or manual deployment
step is required beyond the normal Railway source build. No `PROJECT_STATE.md`
or `_Context.md` exists at the repository root; the existing growth note was
updated instead. Confidence is high for the tested combat and settlement paths.
The results above cover the original stats/movement audit; the AP-pricing
follow-up below has its own evidence. Production rollout remains the normal
separate release action. Revisit this evidence when the companion seal, either
combat engine, or the pet progression/gear contracts change.

## Follow-up: owner-requested summon AP price

Summoning now costs 20 AP, or 0 AP when the saved owner is a rank-10 Pet Tamer.
`shared/pet-summon.ts` owns the rule; `sealCompanionFromSave` seals the cost for
both engines. Old pending records fall back to their sealed combat owner.
Solo and Tower/group engines validate the price before placement and debit it
only after placement succeeds. Duplicate or blocked summons cannot charge or
heal. Turn availability accounts for affordability; the existing once-per-fight
action-slot exemption and four-phase duration remain unchanged. Lag/Overclock
do not alter the fixed summon price.

Both combat screens show the price and disable an unaffordable summon. The
solo adapter preserves the sealed cost, including zero. The compact mobile
command style keeps the pending summon's AP line visible.

- Focused companion, solo, hunt, Tower, adapter and pricing checks: 124 passed
  (`.tmp/pet-summon-ap/focused-final.log`).
- Full repository suite: 18,646 passed, 30 skipped, one old assertion expected
  summons to remain free (`.tmp/pet-summon-ap/full-unit-local.log`). That assertion
  was updated to verify both sealed prices under Lag; all 15 tests in its parity
  file pass (`.tmp/pet-summon-ap/parity-final.log`).
- Production build passed; the final mobile-style client rebuild passed
  (`build.log`, `build-client-final.log` in the same evidence directory).
- Final frontend lint: zero errors, 25 existing warnings (`lint-verified.log`).
- Tower automatic-turn integration checks: 3 passed (`auto-turn-final.log`).
- Summon-price browser checks: 21 passed across all seven browser/viewport
  projects (`pricing-verified.log`). They cover 19 AP rejection, 20 AP admission,
  free admission at zero AP, visible cost text, and target confirmation. Browser
  fixtures verify controls; real-engine tests above verify actual AP debits.
- Strict combat layout gate (`COMBAT_LAYOUT_CAPTURE_PHASE=after`,
  `COMBAT_LAYOUT_STRICT=1`): 20 passed, 10 intentionally skipped, including
  successful WebKit coverage (`layout-final.log`).
- Full browser smoke suite: 3,083 passed, 1,061 skipped, and two initial
  Chromium fixture failures (`smoke-final.log`, 4,146 total cases). Both were
  caused by the opening cinematic intercepting navigation before the fixture
  correction. Both pass explicitly on rerun (`smoke-rerun.log`, 2 passed).
  The final fixture waits for registration navigation and reloads before
  entering combat. No validation failure remains unresolved.
- Source/test hashes and the starting commit are retained in
  `.tmp/pet-summon-ap/source-evidence.json`; scoped `git diff --check` passed.
  Desktop and WebKit-phone pricing screenshots were visually reviewed. Final
  pricing and layout evidence is retained; superseded previews and broad
  passing smoke captures are removed after their processes stop.

No schema, storage-key, reward or auth change, and no production deployment.

## Follow-up: full summon wiring recheck

The owner explicitly approved applying the existing Pet Tamer combat bonuses
to shinobi-combat summons after the recheck found that these bonuses only
reached standalone pet battles. New companion seals now include the existing
5% + 1.5% per profession rank damage bonus, Savagery's 2% damage per mastery
rank, Toughened Hide's 4% HP per mastery rank, and Alpha Bond when unlocked.
The percentages match the existing pet-battle rules; HP and damage are sealed
once from the saved owner. Existing admitted fights retain their snapshots.

Alpha Bond restores 40% of the summoned pet's maximum HP once, including deaths
from ongoing damage. The spent flag persists through serialization. Reviving
does not refresh cooldowns, restore the pending summon, reset the duration,
or revive a pet whose four-phase lifetime has expired. Both summon engines
apply the rule; a surviving pet still cannot prevent defeat when its owner dies.
An additional regression reproduced an area-hit/knockback overlap: a defeated
pet's tile became available for displacement before Alpha Bond restored it.
Revival now resolves after the hit and splash, before displacement checks tile
occupancy. The regression passes with the owner and revived pet on distinct tiles.

The new `api/solo-pve/_summon-wiring.test.ts` covers five actual admission paths
(solo, pack hunt, wave hunt, narrative group and twin trial), rank 9 and rank 10,
and both new and retained records. Each case crosses JSON storage, the action
service, duplicate-request recovery, and the actual client presentation adapter.
It verifies the selected pet, stats, mastery HP, AP price, remaining duration,
usage receipt and revive flag. Caravan tests additionally exercise signed
production handlers, explicit pet selection, reconnect, forged request-body
pricing, and action replay. Existing settlement tests verify that gear and
consumable usage is paid once.

- Combined focused recheck: 177 passed, zero failed
  (`.tmp/pet-summon-recheck/focused-final.log`).
- Final companion regression file: 17 passed, including the new knockback case
  (`revive-displacement-after.log`).
- Final server TypeScript build passed (`build-server-last.log`).
- Final full repository suite: 18,674 passed, zero failed, 30 skipped
  (`.tmp/pet-summon-recheck/full-unit-verified.log`, 18,704 total). This run includes
  the revival-before-displacement fix and its regression test.
- Final runtime/test hashes are retained in `source-evidence-final.json` in the
  same evidence directory. Scoped `git diff --check` passed.
- No screen or frontend runtime changed in this follow-up. The previous browser
  pricing and strict layout evidence remains the UI baseline; this recheck adds
  executable coverage of the real server-to-presentation data path.

These checks cover supported companion admission paths; they do not introduce
summoning to modes that do not admit a companion. No production rollout has
been performed.
