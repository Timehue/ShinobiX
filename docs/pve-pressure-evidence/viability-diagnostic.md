# Ordinary viability diagnostic

This audit distinguishes deaths, living round-limit losses, fixture quality
and player policy. It led to the adopted ordinary durability change and the
corrected version-2 comparison. The probes ran offline; no live combat or
player saves were changed.

## Why the earlier aggregate is insufficient

At the synthetic L100/equal-level standard stress point, the 25 Explore cases
break down as follows. Each build faces all five roles once (seeds 0–4).

| Historical fixture | Wins | Deaths | Living round-limit losses |
| --- | ---: | ---: | ---: |
| Starter gear, mastery 10 | 0 | 5 | 0 |
| Midgame, mastery 30 | 0 | 4 | 1 |
| Offense gear, mastery 40 | 0 | 5 | 0 |
| Defense gear, mastery 40 | 0 | 2 | 3 |
| Capped stats/S-rank, mastery 50 | 1 | 0 | 4 |

The starter is a weak control, not a reasonable trained L100 build. The old
offense bot never healed, cleansed or cleared. All old bots omitted Cleanse and
useful Flicker; defense/maxed maintained defenses but broadly cleared buffs
before attacking. The four maxed standard timeouts ended with 2,518–6,194 HP,
which identifies a durability/tempo problem rather than a survival failure.
Every nonstarter weaker-L75 fixture won all five L100-player fights.

The original L50 armor and L75 Mythic hand item bypassed the effective rarity
gate. Five-element jutsu fixtures were accepted by the server's intentional
basic-element compatibility gate, but do not represent current UI acquisition:
new saves have no nature, free awakenings add one at L2 and a second at L20,
and paid rerolls replace natures. Earlier multi-element sensitivity probes
are also superseded for this acceptance question. No claim that the old kit was
rejected by the combat server is intended.

## Corrected version-2 fixtures

`scripts/pve-viability-diagnostic.ts --fixtures` validates catalog identity,
effective gear level requirements, nature ownership/cardinality, mastery rank
caps, stat cap and the earned ledger before any fight. One Earth nature is
used below L20; Earth/Wind are used from L20 onward. The eight-slot progressed
kit contains two Genjutsu Siphon attacks, two Ninjutsu attacks, Wind
Lifesteal, Earth damage/DR setup, Wind Shield/Absorb and Flicker. Exact
catalog tags are recorded in the fixture audit rather than inferred from
technique names. This
is an accessible two-nature sensitivity fixture, not a live-player copy or an
optimal solver. Players can equip more than eight techniques; this bounded
fixture does not spend their full 12-slot baseline entitlement.

L50 uses five Rare armor pieces (0.25 raw armor) and the Epic Frostbite Cleaver.
Legendary sets begin at L65; the Mythic Ashen Dragon Katana begins at L80.
No pets or consumables are assumed. A moderate B-rank fixture derives its 1.10
damage multiplier from a saved bloodline definition, with no extra bloodline
skills. The capped control uses its existing S-rank multiplier 1.20.

Nonmaxed coherent fixtures distribute exactly `earnedForLevel(level)` points
with Genjutsu/general-stat weighting within the shared per-rank stat caps
(350/700/1300/2100/2500). The L100 capped control
records its full 29,880 allocated-point ledger; L100's 29,000-point threshold
is a minimum, not a prohibition on earning the remaining cap points.

| Player level | Minimum player earned points | Historical AI curve points |
| --- | ---: | ---: |
| 10 | 1,800 | 2,735 |
| 25 | 5,002 | 7,259 |
| 50 | 10,679 | 14,799 |
| 75 | 17,711 | 22,340 |
| 100 | 29,000 | 29,880 |

The historical AI curve is deliberately frozen and predates this overhaul.
Difficulty stat scaling/rank caps still apply. This audit does not change the
global curve or any shared PvP formula.

## Actual rolls and policy controls

At L100 in the highest playable sector (66), standard fractions 0, .5 and
.999999 produce L90, L95 and L98. Weaker fractions produce L65, L75 and L84.
The upper standard interval never rolls 100 because the random fraction is
strictly below one, and the region caps it at 98. Lower sectors are easier.

Two deterministic player policies are compared. `answer` reads visible harmful
statuses, maintains useful setup, uses its equipped weapon and approaches;
it has no hidden-loadout or future-input knowledge. `planner` reuses the bounded
legal own-turn chooser on the player's side: it evaluates damage, survival,
setup and movement within AP. It does not forecast the opponent's response and
omits weapon actions, so neither policy is asserted optimal. Full and 75%
HP/chakra/stamina starts distinguish encounter viability from entering injured.

Counterfactual probes are labeled in JSON: `player-parity` uses shared
player max HP at sealed level and level-appropriate armor (0.25 below65,
0.35 from65); `eighty-percent` retains80% historical HP and caps armor0.30.
Both apply only from L36. An independent `maxDamage` flag compares five versus
six existing catalog damaging techniques. These are harness-only profile
overrides, with unchanged legal EP, AP, costs, resources, cooldowns and stats.
The resulting runtime decision is described below.

The final comparison records the full independent fixture audit before any
simulation, including item ownership and slots, effective gear gates,
learned/mastery identity, native UI access and authoritative bloodline access,
12/15-slot entitlement, rank stats/earned ledger, HP/resource pools and derived
bloodline multiplier. Fifty positive fixture records and six regression groups
pass without mutation; invalid fixtures fail before combat.

The decision retains six ordinary damaging techniques and adopts shared-player
HP/armor bounds only for classified ordinary enemies from36. The five-damage
probe remains a labeled sensitivity run. Final source-hashed results appear in
the [version-2 report](README.md); historical matrix files remain intact for
traceability. The [final Kage acceptance controls](kage-acceptance.md) test
legal twelve-slot builds with multiple player policies and link all outcomes.

## Conservative no-bloodline challenge

An additional six-fight control removes the B-rank multiplier from the trained
mastery-30 Earth/Wind eight-slot fixture. With full vitals and the public
own-turn planner, both L90 standards are wins (3,528 and 6,791 HP). At L95/98,
the bruiser causes two deaths with 897/638 enemy HP remaining; the defender
causes two living round-limit losses with 142/1,515 enemy HP remaining. This
shows the build/policy sensitivity behind the moderate-bloodline acceptance
fixture. It does not test the player's full twelve-slot capacity and is not a
proof that those encounters are unwinnable. All six outcomes remain in
[the probe JSON](v2-viability-probes.json).

The separate [twelve-slot capacity probe](ordinary-capacity-probe.json) keeps
the same 29,000 earned points, mastery 30, no bloodline bonus, Earth/Wind
ownership, full vitals and public own-turn planner. Filling the baseline twelve
slots produces six wins against the bruiser and defender at levels 90/95/98,
with at most 19 rounds and minimum observed HP 1,763. The actual sealed
bloodline multiplier is 1 in every case. This demonstrates available
counterplay for those cases; it is not a universal build guarantee and does
not replace the eight-slot failures above. The [full result table and
reproduction command](kage-acceptance.md#ordinary-viability-without-a-bloodline-bonus)
are retained with the acceptance evidence.
