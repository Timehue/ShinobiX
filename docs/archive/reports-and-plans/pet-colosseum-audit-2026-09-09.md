# Pet Colosseum training and dash audit — September 9, 2026

Training had inconsistent opposition: Sparring matched levels while rolling unrelated rarity tiers, and the ordinary AI builder still used legacy growth before the engine applied owned-pet growth again. The matching and growth errors are fixed. The follow-up also fixes low-level technique burst and repairs Crystal Bear's arm weights and forward strike. All changes are local.

## Findings and corrections

1. **Sparring matched only the level.** A mythic could draw a standard opponent, or the reverse. It now draws random species at each slot's own level and rarity, uses warrior tactics, and matches that pet's trait and number of committed Growth Points. The opponent distributes those points evenly; species kits and stat spreads still differ. Equipped gear and consumables are not mirrored.
2. **AI growth was counted twice.** The old builder scaled catalog stats with its legacy tier formula, then the combat boundary treated those already-grown numbers as the immutable base and applied core growth again. Ordinary practice and paid Colosseum opponents now carry explicit catalog bases and legal allocations through the same growth derivation as owned pets. Scrappers spend half the available points; Warriors and Champions spend the full budget, with their existing trait/gear distinctions. The separate campaign builder retains its authored difficulty curve.
3. **The audit/headless bot could heal the wrong side.** Its player-side command path inspected `session.enemy` for allies. It now inspects the team it actually controls. Both before/after audit records use this corrected policy; the earlier exploratory win-rate figures are superseded.
4. **Dash contact had extra empty space.** The former minimum/maximum separation clamp could also contradict the sum of large body and strike envelopes. Contact now uses the full envelope plus a thin seam, and the spark is anchored to the defender's facing surface. Close/coincident starts stay finite and never put the spark beyond the target. Swept routes still clear neighboring pets.
5. **Impact could freeze the wrong pose.** Entering the attack bank started a 100 ms blend at zero weight just as hit-stop slowed the clock. Its entry time was also the beginning of extension, rather than the contact pose. Showdown now explicitly cues the body extension around 54% and full action weight on impact, for both surface and outline mixers. Other hosts retain their existing animation policy.
6. **Crystal Bear's arms were not weighted to its arm bones.** Its 24,821-vertex mesh had no arm, forearm or hand influence above 0.05, and the generated punch moved backward. The repaired asset places the shoulder, elbow and wrist joints within the visible arms, binds 2,663 left-arm and 2,828 right-arm vertices predominantly to those joints, and gives the paw tips full wrist influence. The resting mesh is preserved within 0.00001 asset units. The head, central belly and feet keep their original skinning. A forward two-paw strike now extends on the 54% contact cue. Both the full model and 10,000-triangle battle LOD are regenerated and cache-versioned.
7. **Extreme low-level technique hits left no response.** Hits up to 60% of the target's maximum HP keep their damage. Above that, a smooth curve compresses excess damage toward 90% of maximum HP when both pets are level 25 or below. The adjustment fades out between levels 25 and 50 and uses the higher participant level, preserving earned level advantages. It applies equally to both sides, before Guard. Stronger moves remain stronger; wounded targets can still be finished. Damage-over-time, focus fire and overdraft can still cause a knockout within a round. The battle guide explains the rule.

## Reproducible measurements

The saved records cover **307,200 simulated bouts**, excluding exploratory tuning and unit tests. The original matching audit recorded 184,320; the burst follow-up adds 61,440 solo bouts and 30,720 bouts in each team format. All 160 catalog templates are included as leads, including starters and evolved forms; levels are 1, 25, 50 and 100. Duel runs use 24 seeds, team runs 12. Separate fresh-session probes test each initially available damaging lead move against a full-health, unguarded target.

The 1v1 diagnostic uses one pet and no reserves. Team runs carry two reserves and rotate companion species within the lead's rarity. Player fixtures have balanced Growth Points and no trait or equipment; the corrected Sparring opposition matches that investment. Both sides use the same AI policy. These are diagnostics, not human win-rate predictions or an exhaustive team-composition test.

**Level-50 Sparring, player win rate:**

| Lead rarity | Previous 1v1 | Corrected 1v1 | Corrected 2v2 | Corrected 3v3 |
|---|---:|---:|---:|---:|
| Standard | 0.9% | 51.2% | 50.0% | 43.6% |
| Rare | 6.8% | 52.1% | 46.5% | 45.3% |
| Legendary | 11.9% | 48.8% | 49.1% | 47.9% |
| Mythic | 16.9% | 44.2% | 48.9% | 47.2% |

Corrected level-50 matches average 4.2–5.6 rounds for solo pets, 9.1–12.3 for 2v2 with reserves, and 8.4–11.1 for 3v3 with reserves. Full-round focus fire must not be confused with one damaging event knocking out a full-HP pet.

**Burst follow-up:** the final same-rarity matrix covers every catalog attacker/defender pairing, with 16 seeds at levels 1, 5, 10, 20, 25 and 50. Its **1,400,000 low-level opening hits produced zero one-shots**. A further **333,480 hits with fully ready techniques and full signature meters** at levels 1, 10 and 25 also produced zero one-shots. The strongest sampled low-level opener dealt 86.5% of maximum HP; the strongest charged hit dealt 88.6%.

The training reruns likewise show zero player or AI opening one-shots at levels 1 and 25 in all three formats and all explicit tiers. Low-level solo Sparring averages 3.5–5.7 rounds across the measured rarity/level slices. Level-50 and level-100 bout records are **exactly identical** to the pre-burst records in every format. Higher-level counters can still one-shot; this change addresses low-level burst rather than promising universal survival at every level or after several attackers focus the same pet.

Final records: [solo training](pet-colosseum-training-burst-fixed-2026-09-09.json), [2v2](pet-colosseum-training-2v2-burst-fixed-2026-09-09.json), [3v3](pet-colosseum-training-3v3-burst-fixed-2026-09-09.json), [opening-hit matrix](pet-colosseum-burst-fixed-2026-09-09.json), [charged-hit matrix](pet-colosseum-charged-burst-fixed-2026-09-09.json).

Historical matching records: [legacy opponents](pet-colosseum-training-before-2026-09-09.json), [corrected opponents](pet-colosseum-training-after-2026-09-09.json), [2v2](pet-colosseum-training-2v2-2026-09-09.json), [3v3](pet-colosseum-training-3v3-2026-09-09.json). These files predate the burst curve; `--legacy` on current code switches only the opponent builder, so it does not reproduce the historical damage rules.

```sh
node --import tsx scripts/showdown-training-audit.mjs --report after.json
node --import tsx scripts/showdown-training-audit.mjs --format 2v2 --bench 2 --seeds 12 --report teams.json
node --import tsx scripts/showdown-burst-audit.mjs --levels 1,5,10,20,25,50 --seeds 16 --report openings.json
node --import tsx scripts/showdown-burst-audit.mjs --charged --levels 1,10,25 --seeds 4 --report charged.json
```

## Visual direction and research

Pokémon Stadium 2 is the requested art-direction reference: a readable creature performance in a staged 3D arena. Nintendo's [official overview](https://www.nintendo.com/au/news-and-articles/find-out-how-you-can-play-pokemon-stadium-2-and-pokemon-trading-card-game-on-nintendo-switch/) establishes that context. The StadiumBattleFX author's [attack-presentation research](https://github.com/anxiousintrovert/StadiumBattleFX/blob/main/docs/attack-cinematics.md) describes distinct body, primary-effect, and defender-impact layers. That research concerns the first Stadium, so it is a structural reference, not evidence for exact Stadium 2 timings. Riot's [clarity principles](https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/) support matching effect direction and importance while keeping silhouettes readable.

The implementation interprets those references as a short launch cue, directional travel, a precise impact, and visible recovery:

- Six small launch-dust puffs establish the planted starting point.
- Tapered trails now lie along the dash, instead of standing vertically; fixed world-space spacing avoids stretching them across long routes. They dissipate through contact instead of vanishing at arrival.
- A pressure ring faces the incoming strike. The compact contact spark and existing elemental effects remain readable beside the models; blocks retain blue shield feedback.
- Reduced motion suppresses the launch dust and speed trails. Effects use the shared presentation clock and bounded geometry.
- The development-only frame gallery now preserves four frames before each contact as well as contact and recovery frames.

Camera direction and hit/miss resolution are unchanged. Collision improvements concern presentation footprints and attack placement, not animated per-triangle physics.

## Verification

All **164 regression tests pass**: 161 combat, balance, playback, animation and asset-resolution checks, plus three tests of the actual full/LOD bear geometry. The rig tests measure rest-mesh preservation, weight normalization, paw movement relative to the chest, protected body regions and bounded deformed geometry through the strike. The repair/bake pipeline is deterministic and keeps its original source bindings for repeatable regeneration.

Browser review covers the original Balanced 3v3 cross-lane round and the repaired Crystal Bear/Moon Serpent duel at normal and fast playback, with Performance and Balanced rendering. Recorded contact frames confirm that the visible paws move forward. Transient effects clear after the round. The existing Three.js Clock deprecation warning remains; no rendering errors were observed in those samples.

The full production build passes server/client TypeScript compilation, Vite compilation, asset verification and the product bundle budget (8,158,466 bytes of product JS/CSS). Changed client files pass ESLint. The regenerated LOD retains 10,000 triangles and a minimum measured silhouette overlap of about 99.5%. [Repaired contact-frame evidence](../output/pet-colosseum-repair/crystal-bear-contact.jpg) is saved locally.

This is a representative visual review, not a new certification of all 160 animation assets. Changes are local and are not deployed by this audit.
