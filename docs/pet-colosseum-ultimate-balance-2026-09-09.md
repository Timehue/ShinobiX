# Pet Colosseum: first ultimate availability and damage

Every one of the 160 pet loadouts still has distinct primary move presentations. The roster checks cover all 945 equipped slots at levels 1, 30 and 100, including reversed slot ordering. Integration checks execute all slots on both teams in 1v1, 2v2 and 3v3. Effects can be shared between different pets; none repeat within one sealed loadout.

## Final rules

- Each living field pet earns 50 base meter per completed round until its first signature executes. Combat and trait charge still apply. A pet that stays on the field has its first ultimate ready after two rounds, for selection in round three, even when guarding or using support moves.
- Reserves do not receive this passive charge while benched. Spending the signature permanently ends the bonus, including when the attack is dodged or blocked. Switching and JSON session reloads cannot reset it. Later signatures earn meter through combat.
- Ultimate damage up to 70% of the victim's maximum HP is unchanged. Damage above that point is smoothly compressed toward 90%, at every level and on every hit, including splash. This calculation happens before Guard and absorption. Wounded victims can still be finished. Normal attacks keep their existing pacing and calculations.
- The same charge and damage rules apply to both teams. No extra speed priority, immunity, damage bonus or player-only advantage was added.

## Measurements

The paired availability audit uses 30,720 fights before and after: all 160 templates, levels 1/25/50/100, every format, all three AI tiers plus matched Sparring, and four seeds. Player growth is balanced; generated opponents retain the traits/gear of their selected tier. The simulated player follows the AI policy until an ultimate is legal, then deliberately selects it.

| Metric | Before | Final |
| --- | ---: | ---: |
| Player gets a legal ultimate opportunity | 38.29% | 96.33% |
| Player actually executes an ultimate | 24.74% | 76.12% |
| Either team executes an ultimate | 51.43% | 95.62% |
| Both teams execute an ultimate | 5.53% | 44.36% |
| Mean rounds, without reserves | 6.02 | 3.42 |

A further 61,440 fights use eight seeds and two reserves per team. Player ultimate availability is **99.73%**, actual execution is **91.50%**, both teams execute one in **77.53%**, and mean fight length is **8.06 rounds**. Availability is not a promise that a chosen attack cannot be interrupted: KO, stun, freeze, confusion and a fight ending first remain valid outcomes. Every surviving field pet's two-round charge is tested directly.

Giving everyone a round-two ultimate was rejected: it reduced unbenched 3v3 to about 2.07 rounds. The first damage curve was also revised after one species fell below the existing balance band; the final 70–90% curve passes the original limits without loosening them.

Separate damage probes compare each signature against every same-rarity opponent at four levels: **30,000 unguarded hits** and **30,000 with Guard ordered**. Previously 4,359 of 7,500 level-50 unguarded probes were full-health knockouts (58.12%); 2,124 level-100 probes were knockouts (28.32%). The final tuning produces **zero full-health knockouts across all 60,000 probes**. Guard retains real turn order in this audit, so a faster attacker can land before the defender's Guard resolves. Engine tests separately verify that an active Guard halves the paced primary and splash hits.

## Verification and artifacts

**181 regression tests pass**, including existing role/element/species balance bands for all rarities and formats, first-charge/bench/serialization rules, live damage, replay determinism, command handling, and VFX routing. Existing input-only replays re-derive fights using current balance; these tests do not assert historical outcomes remain identical after retuning.

The full production `npm run build` passes server/client type checks, bundling, distribution verification and size checks. Budgeted product JS/CSS is 8,194,842 bytes; the existing bundle-size warning remains below the enforced limit. Scoped lint also passes. Build and test logs are under `output/showdown-ultimate-production-build.log` and `output/showdown-ultimate-final-tests.log`.

- `scripts/showdown-ultimate-audit.mjs` generates the availability reports. `--ready-round` is labelled as a tuning probe and is not a production setting.
- `scripts/showdown-burst-audit.mjs --ultimates-only` generates isolated damage reports; `--guarded` adds actual Guard orders.
- `pet-colosseum-ultimates-before-2026-09-09.json`, `pet-colosseum-ultimates-after-2026-09-09.json`, and `pet-colosseum-ultimates-reserves-2026-09-09.json` preserve the fight measurements.
- `pet-colosseum-ultimate-damage[-before]-2026-09-09.json` and `pet-colosseum-ultimate-guard[-before]-2026-09-09.json` preserve the damage probes.
- The development `ultimate-charge` review starts with zero meter, resolves two real Guard rounds, then casts the earned ultimate and continues through a real engine outcome. It uses the production battle UI.
- Browser verification followed the actual command UI from zero meter: round two showed 50% and a disabled ultimate; round three showed `Cinder Devour READY`. Selecting it executed the cast, left the guarding opponent at 58% health, and returned to round four with 10% combat-earned meter and the ultimate disabled. Nine animation frames were captured and there were no browser console errors. Ready/cast screenshots are in `output/pet-colosseum-move-vfx/ultimate-ready-round3.jpg` and `ultimate-earned-cast.jpg`.

Changes are local and are not deployed.
