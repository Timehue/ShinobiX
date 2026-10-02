# Legacy qualification and acquisition audit — 2026-10-02

Status: historical before-fix audit. The user authorized corrections after this
report; see [resolution.md](resolution.md) for the resulting rules and validation.
The evidence and matrix here preserve the audited baseline.

The 100-path roster passes its structural checks, but acquisition and progress do not consistently follow the current game. The most material problems are missing legacy credit on successful world PvP raids, three upset paths that become impossible to qualify for after level 95 without prior proof, incomplete combat attribution, and a deterministic Sage selection that can exclude other earned choices. Later trials also impose activity requirements players cannot see before their permanent choice.

This reviews all 100 available identities. A character still accepts one legacy forever; collecting all 100 on one character is not the design.

## Question and authority

Do all 100 legacy paths have logical, reachable qualification and acquisition rules under the current game, including permanent acceptance and all four subsequent trials?

Expected behavior: server-witnessed deeds qualify the player; level 50 opens acquisition; bloodlines remain separate; the Sage offers up to three earned paths; declining is free; acceptance permanently locks one identity; fresh deeds complete four subsequent trials; rerolls provide alternate proof without exchanging the legacy.

The canonical roster is `api/_legacy-defs.ts`, qualification/selection is `api/_legacy-score.ts`, and stage objectives are `api/_legacy-core.ts`. `docs/legacy-system-plan.md` supplies design intent where current. Settlement code establishes implementation; it is not approval for every design choice. The generated roster document is stale. Existing unrelated working-tree changes are included in the inspected version and remain untouched.

No gameplay code, thresholds, permanent choices or live settings were changed. There is no `PROJECT_STATE.md` or domain `_Context.md` here; this dated report records the completed work and proposals without creating competing current-state policy.

## Coverage and evidence

- [All 100 paths](path-matrix.md): baseline qualification, an abstract selector-inclusion witness, finding tags, and both variants of all four stage trials for every identity.
- [Counter sources and actual meanings](stat-sources.md).
- [Reproducible probes](probe.mts) and [machine-readable evidence](evidence.json).
- [Focused existing tests](test-results.txt): 188 passed, zero failures or skips.
- Probes covered all 46 qualification counters and 30 trial counters, checked 269 direct qualification boundaries and generated 800 trial variants. Every identity has some abstract counter profile that makes it appear in an offer. This does not prove a real character can earn every combination or recover access after progressing further.

Tests cover definitions, scoring, Sage, acceptance/stage recovery, counter receipts, economy delivery, save ownership, signatures, permanent specialty, changed raid/mission/dungeon settlement and client legacy/report behavior. Tests needed unsandboxed execution because the sandbox blocks Node workers with `spawn EPERM`.

This is a local source audit, not a production playthrough. Live `ENABLE_LEGACY`, capability state, `shared:legacy-defs` overrides, player population, event availability and production saves were not inspected. Those can change or mask baseline problems. No required gameplay/browser check was omitted for an implementation change: this task writes audit artifacts only.

## Findings

### F01 — Successful world PvP raids skip general legacy credit

**P1 · Implementation drift · High confidence, source trace.** Owner: PvP/raid settlement.

Expected: an authorized PvP win records the winner's win/style/support/upset proof and the loser's support play once. Actual: `api/pvp/claim-rewards.ts:485` settles a successful world attacker and returns `raidProgression`. The client calls `reportPvpWin` only when `!serverClaim?.raidProgression` (`shinobij.client/src/App.tsx:6327`). The raid producer (`api/missions/_raid-progression.ts:280`) awards only `raidsCompleted: 1` and `warContribution: 500`. The sector-war producer (`api/pvp/_sector-war-continuation.ts:93`) adds war/defense proof, not general extraction. General win, kill, style, rank/upset/comeback/streak and both fighters' support credit live in the skipped `api/missions/report-pvp-win.ts:126` block.

Impact: an existing legacy sidecar can miss a genuine player-raid win even as rewards and `totalPvpKills` commit. First-touch bootstrap can partially conceal this. The defeated defender's support proof also depends on the omitted report.

Action: move general legacy extraction into authoritative terminal settlement shared by eligible PvP modes, retaining per-battle/per-fighter receipts. Keep the report as a help-forward route. Verify attacker/defender victories, disconnects and replay without double credit.

Related recovery gap: reports expire 24 hours after battle creation (`report-pvp-win.ts:92`), while the client explicitly supports a 48-hour reward replay (`lib/pvp-win-report.ts:21`) and treats the expired report as zero completions. A returning player can recover the reward while forfeiting unrecorded legacy proof. Terminal-owned delivery addresses this too.

### F02 — Three qualification routes close at level 96

**P1 · Design ambiguity / conditional reachability defect · High confidence, arithmetic and source.** Owner: legacy design/progression.

`higherLevelWins` requires an opponent at least five levels higher (`api/_legacy-pvp.ts:123`); player level is capped at 100 (`api/_xp-engine.ts:25`). At 96+, no eligible player opponent can satisfy that difference. This stat has no bootstrap or reconcile mapping.

Giant Slayer needs 10; Bloodstained Path needs 30; Duel Sovereign needs 60. A player reaching 96 without enough witnessed upset wins, or beginning legacy tracking there, cannot qualify through future normal play. Other accomplishments cannot compensate for AND floors.

Action: approve a witnessed alternative that still represents an upset at cap, such as defeating a demonstrably stronger rated opponent. Preserve existing proof. An overlay waiver is an emergency workaround, not equivalent achievement. Cover capped veterans with zero upset history.

### F03 — Current PvE fights inconsistently earn style proof

**P2 · Implementation drift / scope ambiguity · High confidence, producer trace.** Owner: combat/legacy attribution.

Combat missions record only `missionCompletions` and `pveKills` (`api/missions/claim-mission.ts:448`). General AI-fight settlement adds a specialty kill inside its 50-win legacy soft cap, but no style damage (`api/missions/report-ai-fight.ts:487`). Style damage comes only from the PvP log extractor (`api/_legacy-pvp.ts:114`). Tower, story and clan-boss combat have no equivalent style/support extraction.

Impact: 32 identities have style qualification. A specialist can finish canonical combat missions without legacy specialist victories or damage proof. A kill-based style trial has an AI route, but its damage-based reroll becomes a PvP activity. The player labels suggest specialist victories/damage generally.

Action: define eligible reward-bearing modes, then derive their actual style totals from sealed resolution events and terminal outcomes. Preserve permanent specialty attribution, practice exclusions and intended daily caps. Validate actual missions/AI/story/tower journeys rather than injecting counters.

### F04 — Healing proof misses real actions and credits overhealing

**P2 · Implementation drift · High confidence, real resolver probe and source.** Owner: combat/legacy attribution.

The extractor recognizes only `Heal: <name> restores <amount> HP.` (`api/_legacy-pvp.ts:29`). Basic Heal writes `<name> uses Basic Heal, restoring <amount> HP.` (`api/pvp/move.ts:2137`); Siphon and Lifesteal use separate “heals” formats (`move.ts:1034`, `1046`). They earn no `healingDone` through this parser.

Conversely, direct Heal logs the requested amount before clamping HP. The real `applyJutsu` probe restored **0 actual HP** to a full-health fighter but credited **225 legacy healing**. Support totals also lack a PvE producer. `damageBlocked` currently means shield absorption, rather than every form of damage prevention its broad name could imply.

Impact: 13 qualification identities and support trials depend on these proofs. Legitimate healing can give no progress, while a cast treating no injury gives progress.

Action: record actual applied healing, shield grants and absorption from structured combat events. Define other prevention explicitly. Test Basic Heal/Heal/Siphon/Lifesteal, overheal, PvE and both PvP participants with exact-once settlement.

### F05 — Actual dungeon clears do not count as “dungeons cleared”

**P2 · Implementation drift · High confidence, producer trace.** Owner: dungeon/legacy settlement.

Only Hollow Gate writes `dungeonClears`, alongside its own clear (`api/hollow-gate/settle.ts:268`). The separate dungeon's verified final settlement (`api/dungeon/_run.ts:226`, `api/dungeon/run.ts`) checks warden/card/pet proof and grants rewards but writes no legacy clear.

Dungeon Delver and Trial Conqueror qualification therefore do not advance by finishing the actual dungeon. All 12 `pve` paths eventually require fresh `dungeonClears` in Prove/Mythic; reroll retains the secondary. Those “dungeons cleared” objectives force Hollow Gate, a desktop-first activity in the progression plan.

Action: deliver one receipted dungeon clear from the committed final dungeon result. Keep `hollowGateClears` specific. Decide whether Hollow Gate should remain a subset of dungeon credit; make naming and tests agree. Cover both entry routes, abandon, incomplete proof and replay.

### F06 — Permanent choices conceal later mandatory PvP

**P2 · Design ambiguity / player information gap · High confidence, all generated trial variants.** Owner: legacy design/UI.

Twenty-three identities have no explicit PvP qualification stat but require unavoidable PvP later. This is a literal comparison, not a claim all 23 qualify solely through PvE: some support/defense proofs already have implicit PvP sources.

Examples: Table Regular qualifies with ten Chronicle wins, then Bind needs two fresh player PvP wins and Prove needs same-rank wins. Village Veteran's ten-day fallback later needs three defensive wins. Steel Apprentice's specialist victories later need same-rank player wins.

These secondary objectives appear in both reroll variants (`api/_legacy-core.ts:174`, `190`). Reroll resets progress and changes the primary, not the activity obligation. Offers preview identity/title/signature, not later required activity families (`api/_legacy-sage-roll.ts:179`, `shinobij.client/src/lib/legacy-sage-vn.ts`).

Action: decide whether these identities should require player PvP. Disclose required activity families before permanent confirmation if yes; provide coherent alternatives if no. Keep formulas/rarity hidden. The matrix and `evidence.json` list the exact 23 identities/stages.

### F07 — Declining does not restore access to other earned identities

**P1 · Design ambiguity in acquisition · High confidence, executable probes.** Owner: Sage/legacy design.

`pickSageOffers` always picks the top sorted path, an alternate category and the first basic fallback (`api/_legacy-score.ts:179`). Requirement scores cap at 2; ties preserve roster order. Decline adds a three-day cooldown without excluding/rotating previously offered identities (`api/legacy/sage.ts:128`). Randomness determines appearance, not choices.

A constructed saturated ninjutsu profile, respecting permanent specialty, qualifies for 76 paths but always receives Gate Opener, Hundred Storms and Wandering Shinobi. Changing among all four villages does not change those offers. Other specialty profiles have similar saturation. These are selector examples, not observed live-player records.

All 100 identities have some earlier abstract selector witness, so none is universally unreachable in the selector. The problem is that more accomplishments can close access to another earned identity. Decline and further play need not restore it, and permanent counters cannot be lowered.

Action: approve rotation/decline history or a way to express interest in an earned identity while retaining three offers and mystery. Ensure a qualified enabled path can eventually appear. Test many-path veterans and repeated declines, not just initial qualification.

### F08 — PvP earning ceilings and anti-farm attribution disagree

**P2 · Implementation drift plus design ambiguity · High confidence, arithmetic/source.** Owner: PvP/legacy integrity.

Lifetime per-target weighting is 1, 1, 0.5, 0.25, then zero (`api/_legacy-track.ts:174`, `347`). Without eviction, each target supplies at most 2.75 general win credits. Thus 400 wins needs at least 146 distinct eligible defeated players; 200 needs at least 73. Calendar-cadence tests do not cover this population constraint. A stable community can exhaust ordinary opponents while fresh-win trials remain.

Attribution is asymmetric: winner credit receives target/gap options (`api/missions/report-pvp-win.ts:179`), loser style/support credit gets neither (`:186`), and sector-war effects omit both (`api/pvp/_sector-war-continuation.ts:93`). Repeated losses can keep adding full support/style damage after repeated winner credit reaches zero; war proofs follow different decay rules.

Action: decide lifetime versus renewable-window decay against population expectations, then consistently apply approved opponent/actor treatment to both participants and eligible competitive producers. Preserve anti-abuse protection. Add low-population endgame and repeated support/war scenarios.

Related meaning gap: `comebackWins` checks only ending HP ≤15% (`api/_legacy-pvp.ts:106`). The probe qualifies an empty-log win based on HP alone. Decide whether these identities honor a close victory or an actual comeback; document the former or derive the latter from sealed combat history.

### F09 — Issued offers can outlive eligibility policy

**P2 · Unspecified runtime behavior · High confidence, source trace.** Owner: Sage/legacy policy.

First acceptance checks server-issued offer status, expiry and inclusion (`api/legacy/sage.ts:223`) and then permanently seals the choice. It does not reevaluate current suspicion, thresholds or the disabled list. A seven-day offer can remain acceptable after a high-tier restriction or admin disable/correction.

This is not forged client eligibility; the unresolved rule is whether old offers intentionally grandfather their original reading.

Action: document grandfathering if intended. Otherwise revalidate only first acceptance and explain invalidation to the player. Keep already-sealed acceptance replay/recovery independent of changing eligibility. Cover an issued offer followed by a disable or new suspicion flag.

### F10 — Generated documentation and liveness tests miss current contradictions

**P2 · Documentation drift / validation gap · High confidence, comparison.** Owner: legacy documentation/tooling.

`docs/legacy-roster.md` retains Hundred Storms' obsolete four-style rule; the executable definition correctly uses one ninjutsu specialty (`api/_legacy-defs.ts:150`). It also retains Sundered Seal/Endless Ascent names and older thresholds/flavor while code uses Gate Opener/Tower Climber and revised rules. Implementation-plan status banners still call some shipped signature/era/admin work deferred.

The early Hundred Storms suspicion was withdrawn after probing exported definitions: there is no current four-specialty blocker. The stale document was the contradiction.

The handwritten LIVE/MIRRORED registry (`api/_legacy-defs.test.ts:27`) and journey tests that inject every counter prove schema coverage, not actual producer correctness or feasible counter combinations.

Action: regenerate the existing canonical roster from exported definitions, reconcile shipped/deferred status, and add actual producer journeys plus constrained endgame reachability. This dated matrix is evidence, not a competing live rules source.

## Verified coherent behavior

- The required 15 basic / 50 rare / 25 legendary / 10 mythic split, IDs, badge links and title uniqueness pass.
- Level 50 opens acquisition; it does not freeze counters. Later activity can qualify a different path before acceptance.
- Bloodlines remain independent. Permanent specialty and the current Hundred Storms rule agree.
- Village affinity is intentionally a score preference, not a village-membership lock.
- Basic fallback, high-tier suspicion restrictions, fresh trial baselines, rerolls, permanent acceptance repair, exact-once stage/title/card receipts, protected save fields and Stage-3 signature ownership have focused passing coverage.
- No generated trial uses capped lifetime-best or tile-mirror stats. Rerolls keep the identity and reset baselines.
- Stage and rarity differ: a basic identity can complete Stage V without becoming a different rarity or receiving a different rarity's signature.

## Recommended correction sequence

1. Repair F01 terminal delivery and F03–F05 actual combat/dungeon attribution while preserving receipts and replay semantics.
2. Decide F02 cap-compatible upset proof and F07 access to earned choices.
3. Decide F06 mandatory activities and F08 renewable/consistent PvP proof; present commitments before acceptance.
4. Resolve F09 grandfathering; regenerate docs and add producer-backed endgame journeys.
5. Inspect live overrides, required mode availability and population before certifying production reachability.

No automatic rebalance, live waiver, migration or alteration to accepted player legacies is part of this audit. Implementation gaps above have enough evidence for correction; design alternatives remain proposals rather than silently adopted rules.
