# Beastbound Warfront combat pass — 2026-09-09

The active four-pet, best-of-three Warfront simulation now uses trained speed for movement, attack windup, basic attack cadence, and recovery. HP and attack continue to use the authoritative saved pet stats; earned levels already increase those stats, so combat does not add a second level multiplier. Defense uses a continuous mitigation curve instead of giving every pet above approximately 542 defense the same protection. Warfront uses the ordinary elemental chart rather than the extra elemental amplification used by cinematic Coliseum fights.

Healing and shielding use the caster's HP and move power. Allies must be within three cells and have an unobstructed line through the shoji. Keeping a sage near its screen therefore matters, and training that sage improves its protection.

Deployment controls the opening pressure. The foremost deployed pet receives the opposing front's attention, with role breaking equal-depth ties. A sage placed ahead of its tank is exposed rather than silently moved into an automatic backline. Ranged pets preserve their committed file and advance according to their chosen rank. Both teams keep their own selected flank; the simulation no longer forces the enemy shadow onto the opposite perimeter. Hard cell reservations, target commitment, range, and cover remain in force.

The changes are confined to formation combat. Shared cinematic damage defaults are unchanged, and the server mirror is regenerated from the client source.

## Verification

- 31 tests passed across Warfront behavior, seven new growth/position regressions, cumulative health carry, authoritative replay parity, and generated-source parity.
- All 19 existing cinematic combat tests passed.
- `node --import tsx scripts/warfront-rite-harness.mts 60` sampled the real non-mythic pet roster. The harness now changes actual deployment cells rather than legacy replay-order indices and checks the current 38-second cap.

| Measurement | Observed |
| --- | ---: |
| Blue-seat match wins with identical rosters | 48.3% |
| Median clash duration | 21.4 seconds |
| 90th-percentile clash duration | 29.0 seconds |
| Clashes reaching the cap | 0% |
| Idle fighters | 0% |
| Opening-clash loser ultimately wins | 18.3% |
| Match result changes when only front/rear cells change | 46.7% |
| Durable pets forward win rate | 65.0% |
| Fragile pets forward win rate | 61.7% |
| +25% HP / +20% attack band wins | 60 / 60 |

The stronger-band result exceeds the harness's previous 70–95% target. It demonstrates a decisive stat advantage in this sample; it does not establish balance across all roster, level, or deployment combinations.

Run the focused checks with:

```powershell
node --import tsx --test shinobij.client/src/lib/pet-warfront-growth-position.test.ts shinobij.client/src/lib/pet-warfront-rite.test.ts scripts/warfront-rite-parity.test.ts scripts/pet-warfront-rite-parity.test.ts api/_pet-sim/_parity.test.ts
node --import tsx --test shinobij.client/src/lib/pet-duel-cinematic.test.ts
node --import tsx scripts/warfront-rite-harness.mts 60
```
