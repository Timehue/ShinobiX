# Pet PvP balance and decision-depth plan

**Status:** two-player, 12-pet Pet Arena and player-controlled ranked Pet Colosseum implemented and integrated with current main for the owner-requested release; full-roster expansion remains planned. Beastfront stays AI-driven. Production rollout verification is separate from pushing main.
**Date:** October 10, 2026.
**Scope authorized:** substantially redesign pet PvP for balance and strategy, including move pools, battle control, competitive stats/allocation, and supporting PvE/NPC encounters.
**Evidence:** repository `18a6fbdbe`, current server-engine probes, and explicitly dated prior audits. No production telemetry or new human playtest evidence is available. All candidate numbers below are experimental targets, not accepted live tuning.

## Recommendation

The implemented first slice is documented in [Pet Arena](pet-tactics-prototype.md).
It reuses the cinematic renderer with an isolated competitive resolver and a
persisted two-human lifecycle. Its selected experimental rules and validation
evidence are recorded there; broader proposals below remain rollout/design gates.

Build the flagship PvP mode around **live simultaneous commands, 2v2 with two reserves, selectable four-move loadouts, and equal competitive stat budgets**. Both players must choose every round. Team composition, resource timing, targeting and switching should change the best action; an ultimate is one costly option among them. Reuse the server-owned turn resolver and existing presentation, but implement the missing two-player lifecycle rather than treating AI playback as interactive PvP.

The first version of this plan addressed burst and NPC behavior adequately but did not establish how both PvP players gain agency. This revision makes that delivery requirement explicit. Keep the four allocation attributes as the initial control surface, while rebuilding competitive stat budgets and move selection. A broader stat schema is available if the prototype proves it necessary; preserving existing formulas or the fixed kit grammar is not a requirement.

**Release outcome:** a fair roster with several viable builds, recognizable counterplay, and an adaptive player who demonstrably beats simple spam policies. Lower damage or longer fights alone do not meet the goal.

## 1. Verified problem and evidence limits

### PvP routing correction from the second review

The following table records the pre-integration baseline. New ranked admissions
now use the two-player Pet Arena lifecycle described in the implementation
specification. The automatic ranked resolver remains only for historical proofs;
Beastfront continues to use its own AI-driven runtime.

| Player-facing battle path | Verified executable behavior | Consequence for this plan |
| --- | --- | --- |
| Ordinary live PvP 1v1/2v2 | [Live host](../shinobij.client/src/components/PetDuelLiveHost.tsx) mounts the cinematic duel; [socket verification](../api/_realtime/pet-duel-socket.ts) replays the submitted lockstep log. Its input model is abilities, stances, auto and clash/break calls. | Editing Showdown alone does not change this path. Migrate the flagship casual duel to the new command lifecycle; retain old sessions for bounded completion. |
| Current ranked queue | [Ranked resolver](../api/pet/_ranked-duel.ts) calls [war resolution](../api/_pet-showdown/war-duel.ts), which calls [headless resolution](../api/_pet-showdown/headless.ts). Both sides' commands come from `chooseShowdownAiCommands`. [Ranked watch](../api/pet/ranked-watch.ts) returns the derived script. | This is a rated automatic fight, despite the registry's live-queue label. Numeric balance can improve it, but player decisions during combat require a new interactive session authority. |
| Showdown Colosseum/practice | [Turn handler](../api/pet/showdown.ts) accepts player commands and chooses the opposing AI commands. Existing `pvp` deadline support is scaffolding, not a two-human submission protocol. | Reuse the combat resolver, not the assumption that this endpoint already supports both human seats. |

These are checkout/code findings; enabled production flags and live traffic were not inspected. Older architecture prose must not override these verified call chains. The prior damage probe is **Showdown evidence**, not a measurement of cinematic live-duel damage or human PvP skill.

The second review also sealed all 161 templates through the current Showdown engine: every pet has four regular moves, exactly two special attack slots, no non-neutral off-element regular move, and a damage-kind signature. [Move sealing](../api/_pet-showdown/engine.ts) chooses one tactical move and the two strongest eligible authored attacks, generates missing attacks, and forces those attack slots to special. There is no player-selected four-move pool at this boundary. A new move pool must replace this sealing policy; editing authored move names or adding unused catalog moves cannot create strategic loadouts by itself.

Current executable owners:

| System | Implemented behavior | Source |
| --- | --- | --- |
| First signature charge | Fielded pets receive 50 passive meter each completed round before their first signature, plus combat/trait gains; signature hold is two rounds. | [Shared rules](../shared/pet-showdown-contract.ts), [round upkeep](../api/_pet-showdown/engine.ts) |
| Signature damage | Tier-derived power is 30% of the rarity power ceiling, then multiplied by 1.6. Signatures are sealed as damage moves. | [Move sealing and execution](../api/_pet-showdown/engine.ts) |
| Damage protection | Ultimate damage below 70% max HP is unchanged; excess compresses toward 90%, before Guard/shields. Ordinary technique protection fades out by level 50. | [Damage pacing](../api/_pet-showdown/damage-pacing.ts) |
| Team burst | An offensive signature hits its target and every other living field opponent at 0.72 power scale, with each victim calculated separately. | [Shared rules](../shared/pet-showdown-contract.ts), [execution](../api/_pet-showdown/engine.ts) |
| Defensive timing | Actions sort by effective speed times move priority. Guard is 1.5 and signature is 0.75; Guard is not an absolute priority bracket. | [Round order](../api/_pet-showdown/engine.ts) |
| Resource tradeoff | Signatures spend meter and bypass the ordinary stamina-cost branch. | [Signature execution](../api/_pet-showdown/engine.ts) |
| Growth | One point per level after level 1; attribute cap is half the earned budget rounded up. Core growth is 0.75%/level; Vitality/Power/Guard add 1% of immutable base per point, Agility adds 0.5%. | [Server growth](../api/pet/_growth.ts), [client growth](../shinobij.client/src/lib/pet-balance.ts) |
| NPC decisions | Tier policy prioritizes a ready ultimate before ordinary healing/move scoring; Guard mainly appears when no technique is affordable. It does not explicitly evaluate a visible enemy ultimate threat. | [NPC policy](../api/_pet-showdown/ai.ts) |

The new [response audit](../scripts/showdown-response-audit.mjs) probes all **161 current templates**, four levels, three seeds, three starting-HP bands, and Rest/Guard: **11,592 observations** through the real engine. Results are stored in [the baseline JSON](pet-battle-response-baseline-2026-10-10.json).

| Level | Mean unguarded signature damage / max HP | KO rate at 100% HP | KO rate at 75% HP | KO rate at 50% HP |
| --- | ---: | ---: | ---: | ---: |
| 1 | 86.56% | 0% | 100% | 100% |
| 25 | 85.16% | 0% | 99.38% | 100% |
| 50 | 83.12% | 0% | 98.55% | 100% |
| 100 | 76.71% | 0% | 67.91% | 99.17% |

Ordered Guard produced zero KOs in all three HP bands at these matched speeds. This does not prove that a slower defender can always Guard in time. These are neutral same-species mirrors with balanced legal growth, no traits/gear/weather/setup, artificially ready signatures, and manually set target HP. Reported damage includes potential overkill. They establish a damage problem, not a live encounter KO rate, human win rate, or earned-charge timing result.

The [September ultimate audit](pet-colosseum-ultimate-balance-2026-09-09.md) had already reported a mean drop from 6.02 to 3.42 rounds without reserves after accelerating first charge. That is historical evidence, not a new measurement. Its zero-full-health-KO gate missed the near-certain kill after modest chip damage.

**Diagnosis:** confirmed tuning problem plus validation gap. A cap near 90% prevents one specific failure while preserving most of the undesirable burst. Formation splash, simultaneous ready bars, free stamina use, and weak NPC defensive reads compound it. Whether shared stat math needs replacement remains an experiment, not a proven requirement.

## 2. Competitive format and the decision loop

**Flagship:** two active pets and two reserves per player; four distinct species locked before pairing. Start with this one rated format. Keep 1v1 as a drill/casual option; certify 3v3 separately after 2v2 works. Do not split ranked population across every format before validating the core game.

Show an open team sheet during preview: species, equipped moves/signature, battle stats, trait and competitive item. The uncertainty is the opponent's next order, not an undocumented modifier. Species, moves and allocation are locked before pairing; permit lead choice during a short simultaneous preview phase, then lock lead order before round one.

Each round:

1. Both players see the same completed state: HP, stamina, meter, protection, statuses, field effects and legal reserves.
2. Each drafts one action per living field pet: a selected move, signature, Guard, Rest or switch. Explain cost, target and likely order; switching spends the outgoing slot's action and the incoming pet does not also attack.
3. Each privately locks the whole team's orders. Neither player sees the opponent's draft, locked payload, target or action-derived order before resolution. Bind hostile targets to field slots through voluntary switches: the incoming pet takes an attack aimed at that slot. Default single-target moves fail if the chosen slot becomes empty before they execute; declare any retarget behavior explicitly rather than automatically choosing an optimal surviving victim. Reinforcements arrive at round end.
4. The server waits for both locks or the common deadline, validates both against the same start-of-round snapshot, then resolves one round and returns the authoritative events.
5. The next decision opens only from the new settled state, at a server-controlled planning-open timestamp with a common deadline. Cinematics play the recorded outcome; playback speed must not grant an individual deadline extension. Prototype a bounded shared playback/ready window and measure its effect on match duration.

Use the existing 45-second command limit as the first live prototype, with ready/lock indicators and reconnect recovery. After resolution, show actual order and explain why effects occurred. Pre-lock order hints are conditional on visible speed and the player's own draft; they must not encode the opponent's secret selected priority.

At least three distinct choices should matter in a typical contested round: create pressure, preserve a threatened pet, or spend a turn on resources/setup. Example: a ready Fire attacker threatens your Wind support. Guard protects it for the round; switching to a Water reserve trades its action for a safer matchup; focusing the weakened caster with the other field pet may deny its cast. The opponent can instead attack the partner or use the defensive turn to set up. No option should win regardless of the opponent's order.

### Two-player authority is an implementation prerequisite

Add a dedicated versioned PvP session protocol rather than passing another player's commands through the current owner-only practice handler. Seal both account identities, their normalized rosters and legal move IDs, seed, format, ruleset, round and deadline. Use a session lock to resolve each round once. A submission is bound to the authenticated seat and expected round; a locked submission is immutable. Reject foreign actors, invalid targets/moves, extra actions, stale rounds and changed loadouts.

Persist private submissions separately from public views. Return only lock status until both seats close. Missing orders use the published defensive default; repeated missed rounds follow a defined timeout/forfeit rule, not AI takeover in rated play. Reconnection restores the same round and locked choice without resetting the deadline. Process restart, concurrent locks, retries and a dropped response must not produce a second round.

The server's actual resolved rounds and terminal result own rating settlement, rewards and replay. Do not rate the match by calling today's headless `resolveRankedPetDuel` over the initial roster after humans played a different fight. Persist commands/events with their balance version. Admit the new queue under a distinct authority version; finish or safely expire old automatic-ranked tokens under their original authority. Do not change clan/sector war's intentionally automatic resolution as an incidental effect of adding interactive PvP.

## 3. Experience targets

Measure damage against an equal-level, neutral, balanced reference defender before Guard/shields, with no setup. Measure matchup/setup variants separately. Damage ranges describe ordinary results, not forced percentages of each victim's HP.

| Action | Candidate damage budget | Purpose |
| --- | --- | --- |
| Cheap basic | 8–12% max HP | Safe chip and low-resource option |
| Standard attack | 15–22% | Reliable pressure |
| Heavy attack | 25–35% | Stronger hit with visible resource/timing cost |
| Single-target offensive ultimate | 30–40% | Swing the exchange without deleting a healthy pet |
| Advantageous ultimate | 45–60% | Reward a favorable matchup |
| Ultimate with substantial setup and advantage | 60–75% | Reward invested turns; finish weakened targets |

Candidate first-ultimate opportunity: usually rounds **4–6**, never before round 4 under the proposed rules. Opportunity is not a promise of execution. Keep visible ways to deny a cast through KO, control, switching, protection, or a better threat.

Target median completed rounds by roster shape: 6–9 for an isolated 1v1 without reserves; 9–13 for 1v1 with two reserves; 8–12 for 2v2 with two reserves; 7–11 for 3v3 with two reserves. Track elapsed playback time too: more commands must not mean a tedious fight. Retain the current round-25 backstop during experiments; aim for under 1% judged finishes and under 15% of balanced bouts reaching attrition. Validate support-heavy and deliberate stall teams separately.

## 4. Ultimate and counterplay redesign

1. **Tune real power first.** Lower signature power/multiplier to the target ranges. Keep an extreme-burst safety curve temporarily, and measure how often it activates. A neutral ordinary hit should rarely rely on compression; tune its input rather than solving everything with a lower HP cap. Inspect elemental advantage, STAB, weather, synergy, mark, trait, gear and execute stacks together.
2. **Remove automatic splash from most signatures.** Most offensive signatures become single-target. Explicit spread signatures divide a fixed action budget across their victims, so adding a third opponent does not create another 72% hit. Initial spread budget: at most 1.3 times the equivalent single-target damage across identical reference defenders. Do not apply full primary damage to one target and append unlimited splash. Test heterogeneous defenses and effectiveness separately.
   **Team timing constraint:** prototype at most one signature order per team per round. Choosing which ready pet spends the team's signature opportunity is itself a decision; reject a second signature at drafting and server validation. Other pets still act normally. Meter remains per pet and signatures can recur in later rounds, so this is not a once-per-match resource. Compare this constraint against the unrestricted candidate after spread tuning, retaining it only if it adds choices without delaying fights excessively.
3. **Charge from useful participation.** Prototype 15 passive meter per completed field round before the first cast, up to 10 from a meaningful offensive/support action, and up to 10 from damage received relative to max HP, with a combined 35-per-round cap. Guarded-damage charge shares the received-damage budget. No charge per splash victim, multi-hit segment, overheal, repeated useless buff, or self-inflicted overdraft. Raise first-cast hold to three completed field rounds. Trait starting meter must obey the same earliest-cast gate. Reserves gain no passive meter and cannot reset spent/hold state by switching or reconnecting. Calibrate actual availability to rounds 4–6; later casts use combat charge, measured separately.
4. **Give the signature a resource decision.** Prototype a stamina cost of 30% of the caster's maximum pool in addition to full meter. First experiment requires sufficient stamina; an unaffordable signature remains disabled with a clear reason. Keep ordinary overexertion intact. Compare this with a meter-only candidate after damage tuning; retain the extra cost only if it improves Rest/switch timing without making the signature inaccessible.
5. **Make chosen defenses resolve reliably.** Prototype absolute ordering phases: voluntary switches, then Guard/Protect, then offensive/support actions ordered by speed and move priority. Guard still consumes the action and stamina; it remains vulnerable to resource pressure and setup. Update the projected order strip to the same rules. Test slow tanks against the fastest legal attacking builds and all existing control/cancellation cases.
6. **Expose readiness clearly.** Show enemy meter, relevant stamina, first-cast readiness, protection and setup effects. Provide server-derived damage ranges against public state; unknown opposing actions remain conditional. Do not add a competing client damage resolver or reveal the opponent's locked command. Keep the cinematic payoff even for a guarded hit or a defensive/support ultimate; spectacle should follow the action's value, not its raw damage.

The first experiment changes damage/spread only. Compare charge/timing next, then defensive ordering, then stamina cost. Do not move all four families in one tuning pass: each retained change needs measurable benefit.

## 5. Stats and allocation decision

### Equal competitive budgets

Rated PvP uses a **fixed battle level of 50 and a 49-point allocation budget for every eligible pet**, including lower-level owned pets. Competitive allocation is a separate saved build, initialized from a legal preset, not a requirement to grind the pet to level 50. Species, appearance and intended stat shape carry over; PvE level/XP/growth remain progression. Provide all legal competitive move options when entering this mode so a higher-level pet does not also buy a broader tactical menu.

Normalize species to one comparable competitive stat-and-kit budget across rarities. Remove the rarity damage ladder from this ruleset; rarity may express collection/evolution identity but cannot buy better ranked damage and bulk together. Price a fast specialist's speed, a support kit's utility, and a tank's durability in the same budget. Start with equal-budget bases and neutral role/element compensation tables for the competitive prototype, then investigate deficits through stats/kits before adding opaque multipliers. PvE keeps its own growth/rarity profile.

Equip one balanced trait and one curated competitive item per pet, available as mode-specific equivalents without spending consumable inventory. Disable consumables and profession/PvE/mastery damage bonuses in rated play. Do not carry apex-trait or rare-gear percentage advantages over unchanged. Every item should trade one useful property for an opportunity cost; test combinations, not just standalone gear. Offer free competitive respec/loadout changes between matches.

Initial allocation uses Vitality/Power/Guard/Agility with the same shared budget and concentration cap for every entrant. Display the resulting six combat axes, including physical/special splits, rather than hiding them behind role. Test Striker, Bulwark, Tempo and Balanced builds against different teams; if Power and Guard cannot support meaningful physical/special choices, author independent species axes or extend allocation. A six-stat rewrite is an available design tool, not a prerequisite or a forbidden change.

Competitive normalization is sealed server-side before combat and never overwrites the player's PvE pet stats. Casual should default to the same fair rules; any optional progression-based challenge must be labeled and kept outside this rating pool.

### Damage and growth calibration

The current unmodified damage base is `4.8 * (movePower / 100) * 52 * (offense / resistance)`. Offense/resistance use the appropriate physical or role-derived special axis. Uniform growth cancels inside their ratio while max HP continues growing. This can change same-level pacing with level; the response probes show that drift. It does not by itself establish that all progression is broken.

Keep **Vitality, Power, Guard, Agility**, earned points, and existing immutable bases for the first pass. Show players the resulting HP, physical/special offense, physical/special resistance, speed and stamina. Preserve species stat shape. Add Balanced, Striker, Bulwark and Tempo allocation presets with previews and a free balance-update respec.

Run two controlled formula candidates against the same fixtures:

- **A: retain the ratio**, but add explicit level-based damage scaling calibrated against automatic HP growth. This is the smallest intervention.
- **B: bounded resistance**, using a candidate form `D0 = K * (P / 100) * G(attackerLevel) * O / (R + C * G(defenderLevel))`, where `G(L) = 1 + 0.0075 * (L - 1)`, `O/R` are sealed offense/resistance, `C > 0` is a reference resistance, and `K` sets baseline pace. Reference constants are fixed within a ruleset, not adapted to the opponent's current HP. At matched core growth, damage and HP scale together; the additive denominator limits extreme low-resistance bursts. Apply the named matchup/setup factors afterwards, then extreme-burst pacing, Guard, and absorption in a documented order.

Choose A if it meets all pacing and build-value gates; choose B only if A still leaves unacceptable fragile-target bursts or poor defensive value. In B, Guard investment has different marginal value from Power, so reprice allocation coefficients after the formula is selected. Do not carry today's coefficients over unexamined or grant new points to compensate informally.

Decision gates: neutral pace remains inside its format band at levels 1/10/25/50/75/100; attack and defensive investment have predictable monotonic benefits; an attainable agility breakpoint has a useful action cost; no allocation preset dominates all other presets and matchups. Compare both maximum legal concentration and modest reallocations, including unspent points. Higher levels should preserve earned PvE strength, not merely inflate HP bars.

Unify NPC growth at sealing. `buildColosseumAiTeam` already uses legal allocation and immutable catalog bases; some parent encounters call the lower-level `buildShowdownAiTeam`, which pre-scales stats. Audit those paths for fallback-base/double-growth behavior before migrating them. Use one authoritative derivation with deterministic client parity, and apply traits exactly once.

Only migrate the shared PvE allocation schema if the selected four-attribute system cannot support distinct builds there. Competitive battle profiles can own additional axes without rewriting every existing pet record. Any shared migration is separately versioned with all points refunded, preserved pet IDs/levels/XP/evolution/ownership, and tests across every pet consumer. Do not hand-edit generated `_catalog.ts` or `_pet-sim` copies; change their source owners and regenerate them.

## 6. Species and move identity

### Selectable species move pools

Replace the fixed Tackle/tactical/two-special grammar with **four equipped regular moves chosen from an initial 6–10-move species pool**, plus its separate species signature. Keep a weak universal basic available as a fallback; it occupies its own fallback control and does not consume an equipped slot. Guard, Rest and switch remain universal commands. The interface must distinguish equipped moves from universal actions.

Use stable move IDs with explicit class, element, target scope, cost, timing, effect budget and stacking group. Seal selected IDs from the server-owned allowed species pool. The current sealer must stop selecting moves by authored power and forcing every attack slot to special; physical/special class belongs to the authored move. Gear loadout and combat move loadout are distinct fields.

Each pool should support at least two coherent builds, with damage, utility and opportunity costs that differ. Example pool structure: reliable own-element attack, costly burst attack, optional limited coverage, role utility, matchup utility, sustain/protection or resource disruption. This is a design checklist, not seven mandatory cloned moves for every species. Start with 12 representative species spanning roles and rarities; extend to all 161 after the interactions work.

Initial loadout legality: four distinct regular move IDs, at least one repeatable offensive option, at most one hard action-denial move, and no duplicate unique-effect stacking group. A species may offer several tactical alternatives; equipping one should exclude another useful option through the four-slot budget. Allow unusual strategies when they meet counterplay and stall gates, rather than requiring every player to select the same damage/support split.

Most damaging moves remain own-element. Selectively offer **one off-element coverage option per equipped loadout**, with lower efficiency or higher cost and a clear species rationale. Neutral basics remain a safe but weak option. Do not give every species every counter-element or the best coverage attack: switching and team composition must still matter. Test move-level effectiveness, not just pet-level element labels.

Remove dominated choices: if one attack wins on damage, cost, timing, targeting and secondary effect, reprice it or replace it. A higher-power version with a different name is not a second strategy. Do not add dozens of moves before identifying which decisions the first pool creates.

### Interaction rules and anti-spam costs

| Player plan | Useful response | Cost/limit that keeps it fair |
| --- | --- | --- |
| Commit a large hit | Guard/Protect, resist-switch, deny the caster or redirect the target | Heavy action loses tempo and spends substantial stamina; setup competes with immediate damage |
| Repeatedly Guard | Buff, weather, recovery, resource disruption or modest damage over time | Prototype escalating stamina cost or reduced mitigation on consecutive Guards; Guard is not full protection and does not grant free idle charge |
| Use full Protect | Invest in setup or pressure the other slot; punish its unavailable turn | Explicit cooldown/hold before reusing full protection; no alternate Protect loop across duplicate move IDs |
| Focus one target | Intercept/redirect, shield/heal or switch | Team protection costs an ally's action; redirectable single-target moves and spread exclusions are explicit |
| Rotate for a better matchup or stamina | Predict the incoming slot, pivot, or apply limited trapping | Switching loses the slot's action; trapping has a short duration and expiry and cannot permanently deny the bench |
| Heal or shield repeatedly | Pressure resources, timed anti-sustain or setup | Price effective recovery against incoming damage; cap stacking; a sustain loop must not outlast offense indefinitely at equal budgets |
| Lock an enemy out of actions | Cleanse, resist-switch or use immunity windows | Hard control denies at most one action, followed by a shared two-round hard-control immunity; stun/freeze cannot chain around separate status names. Store immunity outside the evictable condition cap |
| Stack weather, marks and burst | Replace weather, remove the mark, protect the threatened target or attack the setter | Multipliers have a total burst budget and setup consumes real turns; effects/cancellations are visible |

These are candidate rules. Establish their exact timing at round start, action execution and upkeep; test existing winded/switch restrictions and cancel behavior. Prefer reliable move effects with narrow damage variance. Keep random misses/critical events out of the first competitive prototype unless their explicit move budget and probability create an intentional risk decision. Do not solve a deterministic dominant strategy by adding random failures.

### Role and signature identities

Give signatures a purpose beyond a uniform damage button:

- Assassin: a single-target finisher that rewards an exposed or weakened victim.
- Defender: team protection or interception with modest damage.
- Sage: recovery, cleanse or field control with limited direct damage.
- Tracker: pressure, resource disruption or a planned switch opportunity.

Budget damage, healing, shields, control, charge and stamina together. Do not attach full offensive-ultimate damage to a full support effect. Give each prototype species at least two viable regular loadouts with a different matchup or team purpose, and a signature with a documented best use and response. Preserve authored species names and visual identity; change move semantics and event presentation deliberately. Refit shared PvE compensation tables separately after the new rules are stable.

## 7. PvE/NPC encounters

Use legal pet builds and explicit encounter rules. Difficulty should primarily change planning, team composition, resource management and permissible mistakes. Document any boss stat budget separately; ordinary NPCs must not have hidden infinite stamina, charge, immunity, or knowledge of submitted player commands.

| Encounter | Team/behavior | What the player learns |
| --- | --- | --- |
| Training | Matched progression; one mechanic at a time; readable error recovery | Guard a ready ultimate, Rest before exhaustion, switch a bad matchup |
| Scrapper | Simple coherent team, partial legal allocation, weak coordination | Win with fundamentals and a viable basic attack |
| Warrior | Full legal budget; complementary roles; moderate switching and threat reads | Timing and build choices matter |
| Champion | Legal optimized builds; coordinated focus, recovery and planned ultimate use | Respond to team plans and avoid wasted burst |
| Specialist NPC | Named weather, defensive, attrition or tempo archetype | Learn an identifiable counterstrategy |
| Boss | Explicit phases; telegraphed burst; a recovery/punish window after its major attack | Prepare a response and exploit the opening |

Replace the early ultimate preference with scored legal actions. Evaluate expected damage after resistance/protection, actual KO probability, overkill, survival risk, ally recovery, meter/resource costs, switch benefit and likely opposing threats. Coordinate allies so they do not spend several ultimates on the same defeated target. Use public pre-command state and bounded tier-specific policy; no reading player submissions. Preserve seeded determinism.

Introduce three authored drills and four specialist rosters before expanding the campaign. Run fixed low/mid/high progression fixtures, including fresh or unspent pets, rather than continually copying the player's current investment into every enemy. Sparring remains matched practice; paid opposition and campaign progression retain explicit difficulty budgets. Revisit entry frequency/rewards if longer fights noticeably lower rewards per minute, while retaining server authority and daily caps.

Hollow Gate, First Pact, world-crisis pets, natural wanderers and Dungeon Rare Beast need individual encounter checks. Showdown changes reach Showdown consumers; cinematic, Warfront and Gauntlet engines need their own passes. Architecture notes and the generated registry contain different historical migration descriptions, so confirm route, parent seal and live caller ownership from executable code before choosing any encounter migration. Do not introduce two settlement authorities for a parent run.

## 8. Validation and acceptance

Extend the existing burst, training, ultimate and balance harnesses. Keep the new response probe as a focused diagnostic; it is not a replacement for complete fights.

Required scenario matrix: all templates; every rarity/role/element; levels 1/10/25/50/75/100; same and mismatched levels/rarities; all formats; zero/two reserves; balanced/unspent/max-focus growth; relevant trait/gear/consumable extremes; weather/mark/synergy stacks; neutral/advantaged/resisted targets; healthy/wounded/Guard/Protect/shield victims. Use at least eight seeded complete bouts per standard cell and a disjoint holdout seed range. Sample team composition deliberately; a lead-species sweep does not exhaust all teams.

Record these separately by level, format, difficulty, roster and starting HP:

- Ultimate damage distribution, KO rate conditional on pre-hit HP, compression activation, overkill and total team damage per cast.
- First legal opportunity, actual execution, selection denied by action order/control, repeated casts and simultaneous team burst.
- First-KO round, survivors after the first ultimate round, total rounds, attrition/judge frequency, playback duration and reward rate.
- Guard/switch/Rest/support frequency and outcome value; adaptation should outperform pressing the highest damage button or casting every ready signature. Include Guard-spam and ultimate-bait policies so reliable defense does not become a dominant stall strategy.
- Species/role/element/build win rates, sampled encounter difficulty and failures with beginner-viable rosters.

Candidate gates: in neutral matched probes, no full-health ultimate one-shot and under 10% KO rate against a 75%-HP target; advantaged or invested setup can legitimately exceed that wounded-target rate. Guard must resolve before ordinary burst whenever legally chosen under the new ordering rule. Roles/elements aim for 45–55% aggregate under matched conditions; investigate species outside 35–65% rather than concealing them in averages. Keep existing ratchets until replacement coverage is explicit; do not loosen a gate merely to ship a candidate.

### PvP must pass strategy gates, not just damage gates

Run a cross-play policy tournament with identical legal rosters/builds and seat-swapped seeds. Include random legal play, highest immediate damage, cast-every-ready-signature, Guard spam, heal/Protect loops, focus-fire, element/switch-aware play and a bounded adaptive planner. Policies must choose from the same public pre-lock state as a player; none may inspect opposing submitted orders or use extra resources. Headless AI-versus-itself cannot establish whether a human choice matters.

Use both blind holdout seeds and held-out opposing team compositions/loadouts. Report games, paired win-rate difference and confidence intervals, not just a single percentage. Candidate gate: the adaptive policy beats each simple spam policy by at least **10 percentage points**, with a paired 95% confidence interval above zero, across the aggregate standardized sample and without a reversed advantage in a major format/build slice. This is a proposed gate, not a measured current result. Seed count alone is not sample sufficiency.

Build deterministic decision fixtures where changing one legal order changes the result: guarding a visible threat, switching into resistance, punishing a Rest, cleansing a setup condition, coordinating focus/interception, and delaying an ultimate for greater value. Include corresponding counter-fixtures where blindly choosing that defense loses value. Require at least two competitive loadouts per prototype species that each earn an advantage in some supported matchup; fail a candidate when one loadout or action is best against nearly everything.

For competitive normalization, compare a low-level and fully progressed version of the same species with the same competitive build: sealed battle stats/options must match. Swap gear acquisition history and rarity progression without introducing paid or grind-derived stat advantage. Sweep account names, challenge initiator and player/enemy seats to detect ordering bias; mirrored entrants should approach 50% over adequate independent seeds.

Human PvP acceptance requires both players to submit actual orders and finish under the same authoritative state. Conduct paired sessions using fixed rosters, then self-built teams; record build diversity, prediction/counterplay examples, repeated choices, clarity of defeats and whether player adaptation changes outcomes. Neither AI tournament success nor player surveys alone prove the release meets this goal. Balance and strategic agency both need evidence.

Run server/client growth parity, engine/AI/damage-pacing/charge/replay tests, API authority and idempotent settlement tests, plus every shared consumer affected by stat changes. Verify command legality, turn order, switching, meter/hold state, reconnects, old saves and reactive items. Visually playtest low/mid/high-level fights on desktop and mobile with human players; record whether they understood threats, found a useful response, and made a meaningful decision after the first ultimate. Simulation balance alone does not accept the feel change.

## 9. Delivery order and rollback

| Phase | Work | Exit artifact |
| --- | --- | --- |
| 0 — corrected baseline | Completed source inspection, PvP route mapping, 161 sealed-kit checks and 11,592 response probes; next capture policy/complete-bout baselines on each relevant engine. | Baseline JSON, scenario definitions and executable ownership map |
| 1 — human command prototype | Add two-private-seat submission, locks/deadlines/recovery and authoritative terminal result; mount an unpaid 2v2 test duel. | Two people finish a match by submitting actual orders; privacy/idempotency tests pass |
| 2 — strategic vertical slice | Author 12 species pools and equal-budget competitive builds. Isolate damage/spread, charge, defense timing, control/sustain and signature-cost experiments. | Playable team builder and PvP prototype; at least two useful builds per species; paired policy comparisons |
| 3 — stat/formula decision | Validate allocation value and formula A/B, competitive normalization and NPC sealing; migrate shared growth only if required. | Chosen battle profiles, coefficient report and compatibility verification |
| 4 — roster and matchup coverage | Extend pools/signatures to all species; price traits/items; sweep team/loadout combinations and human counterplay. | Reviewed move budgets, policy tournament and species/format outlier report |
| 5 — teaching encounters | Improve NPC scoring, training drills, specialist teams and boss windows using the accepted core mechanics. | Seeded encounter fixtures and progression difficulty notes |
| 6 — PvP cutover | Move new casual/rated admissions to the proven interactive authority; preserve old sessions/receipts; run complete release checks and rollout. | Human-command rated match, matching replay/settlement, accepted strategy/balance report and rollback path |

Run experiments in an unpaid practice ruleset first. Seal a **balance ruleset version** into every prototype session and relevant replay/encounter descriptor from the beginning. A dedicated competitive profile selects its stat sealing, allowed moves and combat rules; changes must not silently rewrite every existing Showdown consumer. Finish existing sessions with their original rules, or expire them safely before switching; never change damage mid-fight. Current input-derived replay descriptors can produce different outcomes after retuning, so retain an old-version resolver or store authoritative event logs for new-version history, and label legacy re-derived history honestly. Replay schema version alone does not identify numeric balance.

Use a server-selected ruleset flag and keep the prior configuration available. Keep stats migration atomic, idempotent and versioned; preserve allocations or refund them deterministically. A ruleset rollback cannot undo a save migration: retain the necessary prior save representation or provide a tested conversion. Monitor each format/level slice; rollback for unexpected healthy-target kills, inaccessible ultimates, stall spikes, impossible NPC progression, or settlement/replay drift.

No gameplay changes are implemented by this planning task. The audit is read-only apart from its requested report. Next implementation step: capture the baseline policy comparisons and build the two-player command prototype. A damage-only patch may be an interim improvement, but cannot close the PvP strategy objective.

## Reproduce the new baseline

With the repository dependencies installed:

```powershell
node --import tsx scripts/showdown-response-audit.mjs --report docs/pet-battle-response-baseline-2026-10-10.json
```

This task ran the same script under Node 24.15.0 with native TypeScript stripping and a relative `.js` to `.ts` resolution hook because this checkout has no installed `tsx`. Production build/type checks were not run for this proposal. The simulation is current local engine evidence, not a deployment claim.
