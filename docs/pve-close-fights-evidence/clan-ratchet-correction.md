# Clan acceptance ratchet fixture correction

The failing low-population regression was not a legal equipped-player fixture.
It imported Spire's explicit synthetic tuning knobs: 12,000 HP, 2,200 CP/SP,
handwritten 1.4 bloodline multiplier, raw DR/item bonuses, a 2,000 shield
injection and three custom EP 52/42/30 attacks without a learned catalog mastery
ledger. Its heuristic focused targets, healed low HP and reacted to some marks
and pylons, but never used Clear or Cleanse and had no setup/sustain curriculum.
Those assumptions cannot certify the user's strong, properly played build.

Only offline acceptance code changed: `clan-boss-balance-sim.ts`, its test title,
and `_pve-boss-acceptance-policy.ts`. Production damage, NPC stats, HP, encounter
scaling, rewards and participation are unchanged. All eight earlier datasets
and the standalone peer-80 dataset retain valid recorded source hashes; none
owns these acceptance-only files.

## Measured diagnosis and correction

Each row uses the original ratchet's six exact seeds, derived as
`41000 + bossIndex * 1000 + partySize * 100 + index * 17`. Raw legacy controls
were measured before the fixture correction. Archived main uses its original
heuristic; the current legacy control uses the then-current heuristic. Their
difference is not claimed as matched-policy causal isolation.

| Boss | Archived main, legacy solo progress | Current, legacy solo progress | Current, audited solo progress | Audited four-player clear / mean rounds |
| --- | --- | --- | --- | --- |
| Oni Warlord | 83.9% | 54.4% | 88.1% | 100% / 6.7 |
| Abyssal Leviathan | 65.8% | 35.7% | 61.9% | 100% / 7.5 |
| Fallen Kage | 77.9% | 16.2% | 61.1% | 100% / 7.2 |
| Ancient Stone Golem | 79.7% | 41.2% | 68.1% | 100% / 7.5 |

The corrected level-100 fixture independently passes production ownership,
gear-level, rank/resource, stat-ledger, bloodline, mastery, element and slot
gates. It has full twelve-slot Earth/Wind catalog utility/sustain, mastery 50,
an owned S-rank definition deriving 1.20, and real catalog Crimson/Ashen Dragon
equipment. There are no invented passives or named/custom gear rolls. The
policy uses public marked-tile escape, adjacent pylon disruption, Clear of
visible sustain/offense/defense buffs, Cleanse of harmful statuses including
Recoil, setup, add focus and injury-dependent recovery. Legal immediate own
action previews enforce AP/resources/cooldowns; hidden inputs and future draws
are unavailable.

The assertions were preserved: every boss must allow at least 50% average solo
slice contribution, four-player clear rate at least 80%, and mean full-party
pacing between six and sixteen rounds. All audited solos survive; only one of
the six Oni runs clears its entire slice. Contribution remains useful without
turning solo fallback into a guaranteed clear. Both existing ratchet tests pass.
Strict standalone TypeScript checking passes for the peer probe, clan sim and
new policy helper. The old CommonJS-incompatible CLI guard was also corrected
without changing combat behavior.

An additional immutable six-seed catalog control uses the preceding boss-probe
policy and actual archived/current engines: `clan-ratchet-catalog-control.json`.
It records 192 individual cases. Current attentive solo progress averages
90.8%, 64.7%, 67.9% and 73.7%, respectively. This independent control also
exceeds the unchanged 50% floor before adding the acceptance helper's more
explicit public counters. It is complementary evidence, not a substitute for
the original ratchet seeds or peer-level prepared-trio outcomes.

`clan-ratchet-correction.json` records the exact after-input seeds, fixture/audit,
aggregate controls, assertions and final source hashes. `boss-peer80.json/md`
separately demonstrates near-level prepared routes and rotation-control risks.
No production tuning was necessary to make the acceptance ratchet valid.

```powershell
node --import tsx --test scripts/clan-boss-balance-sim.test.ts
node --import tsx scripts/clan-boss-balance-sim.ts 6
```
