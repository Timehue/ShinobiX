# Four-Village Muster: World Boss Event Plan

**Status:** The Central destination is a World Bosses hub with the existing Weekly Boss in tab 1 and a generic Roaming Boss event in tab 2. Full admins can release Chicxulub, Murogane, or Donkaku the Hollow Maze Warden into the same event system; only one event can run at a time. The event includes queue-held roaming, large map art, Hollow Shard mining and turn-ins, a live contribution leaderboard, tiered boss weakening, and a temporary village consequence at timeout. The live event is admin-started; run-time balance and production operations still need review before scheduling.

## First-release implementation

- Separate 72-hour event record and shared HP ledger. Full admins choose a playable spawn sector and a destination village. The boss follows shortest connected roads to that village’s outskirts, then holds at the gate; at 48 hours the event enters its final-stand phase and remains there for the final 24 hours.
- World Bosses destination in Central with two tabs: Weekly Boss and Roaming Boss. The existing Weekly Boss data, schedule, combat flow, and rewards remain separate. The roaming event's admin-selectable roster is Chicxulub (Hollow Beast), Murogane (Hollow Gate bull guardian), and Donkaku the Hollow Maze Warden (minotaur).
- Public cross-village and cross-clan queue, capped at three players. A trio launches immediately; a smaller queue launches after 30 seconds, including a solo fallback.
- The roaming clock pauses while at least one player is waiting for a team, then resumes from the same position when the queue empties. The map boss art is about three to four times the player marker while sector hit targets and route coordinates stay fixed.
- Up to 60 event-only Hollow Shard veins appear on reachable rock tiles across playable sectors. Mining skill 4 and a pickaxe use the standard mining minigame. Each successful vein counts once globally and gives its miner one unsubmitted Hollow Shard.
- Players turn in held Hollow Shards from the Roaming Boss tab. Each shard awards 1,000 contribution points. Every six deposited shards fill one shared meter tier; each filled tier reduces boss damage dealt and increases damage received by 5%. Ten tiers cap both effects at 50%. A partial tier has no combat effect. Each encounter snapshots filled tiers when its team fight starts.
- The selected destination village is shown as threatened in the final stand. If the boss survives the 72-hour deadline, that same village receives 24 hours of Ashfall: 5% lower training gains and 5% longer jutsu training.
- Each boss has a different server-resolved defense: Chicxulub regenerates up to 1% of its team-fight health each round, Murogane takes half damage while any guard lives, and Donkaku gains 10% shield at each health phase up to a 25% cap. Their telegraphed signature strikes are distinct and scale with the shard weakening tier.
- Server-sealed team combat using the existing Tower engine. Damage and meaningful support actions are attributed to the player who performed them.
- Show the top 15 individual contributors live, ranked by verified damage, support, and Hollow Shard points, with those score categories broken out.
- One event reward receipt per meaningful contributor: 2,500 Ryo, 3 unspent stat points, 2 Bone Charms, one boss core, one random high-end material, and the existing boss-rate chance for a random weapon or armor item.
- When the shared HP reaches zero, close new queues and wait for already-active team fights to settle before snapshotting the individual leaderboard and granting one Hollow Beast Cache to each of its top 15 players. If a fight remains unsettled for six hours, finalize the list so an abandoned session cannot hold rewards indefinitely. The cache opens for 1,500 Ryo, 1 Bone Charm, one random high-end hunting material, and a 20% chance at a Dungeon Key. Late settlements remain on standings but cannot rewrite a finalized recipient list.
- The world map uses a transparent four-frame walk sprite for each boss in an 84 × 112 desktop display box (three times the sector marker's width and four times its height; responsive on small screens). All sprites keep their feet anchored to the existing boss sector, so the art does not change movement or route coordinates. Each boss has separate widescreen key art for the event panel and combat presentation. Donkaku's ivory maze armor carries white energy channels with red sparks, plus a pale white-red map glow.
- Cache openings share one small shaking/opening chest reveal and itemized reward list across the Hollow Beast Cache, Legendary War Crate, black-market crate, and clan exchange caches.
- Admin start/stop API; the event is not scheduled automatically. No fragment encounters, delivery tasks, village siege encounter, or permanent village damage in this release.
- Original Hollow Beast, Hollow Gate guardian, and Hollow Maze Warden artwork in the client assets. The Central entry is named World Bosses and opens the Weekly Boss and Roaming Boss tabs.

## Verification state

- The latest offline difficulty model used the shipped Tower engine, a geared level-100 player fixture, 12 deterministic seeds per boss/party/tier, and the 20-round match cap. At zero shard tiers, none of the solo, duo, or trio cases defeated any boss. At ten tiers, Chicxulub and Murogane cleared in every solo, duo, and trio run; Donkaku cleared in 75% of solo runs, 83% of duo runs, and every trio run. Full-meter Chicxulub still took about 19 of 20 rounds, and Donkaku remained the hardest, so the top tier makes the roster beatable without making every fight effortless. This is model evidence only; the fixture does not stand in for human play or lower-level loadouts.
- The story-content consistency check passed during the final review.
- Focused TypeScript checks passed for the admin controls, event screens and tabs, event start/stop handler, and stopped-match settlement changes. The scoped `git diff --check` is clean.
- This final routing pass adds server-validated admin spawn and destination fields. Five focused tests pass for every playable-sector-to-village route over real roads, selected start/midpoint/arrival positions, matchmaking pauses, and all three boss encounter defenses. ESLint passes for the changed admin, event, and combat screens; `git diff --check` is clean. A server TypeScript check passed before the final admin live-position fields; a repeat check did not complete in this environment.
- The last completed client project typecheck reported three errors in the untouched `shinobij.client/src/lib/use-sector-chat.ts` file (`status` narrowing on `SectorChatRead` and `SectorChatSent`, including one refusal assignment). No world-boss files appeared in that diagnostic output. An authenticated live event/browser pass remains unavailable here.
- The Central Hub browser check was updated for the Roaming Boss tab and empty state, but Playwright could not launch because its Chromium executable is not installed in this environment.
- Full client and server production builds did not complete in the available verification window. The standalone Vite bundle attempt reached unrelated filesystem `EPERM` errors in existing Coliseum and worker assets. Do not treat this as a passing full build.
- Both four-frame walk strips and the Hollow Gate guardian's separate key art were visually inspected. The guardian strip uses consistent frame scale, a shared hoof baseline, a transparent background, and the existing map animation treatment. The CSS step count was corrected so the walk animation samples the four cells evenly.
- Donkaku's minotaur silhouette, four-frame walk strip, flowing white-red maze energy, world-map glow, and separate Hollow Maze key art were generated and visually inspected. His marker uses the same 84 × 112 box and sector anchor as the existing bosses.
- A local Vite development server started, but the browser opened to the app's offline state because no authenticated local game/API session was available. In-engine map rendering, queue flow, mining interactions, cache reveal, and responsive layout remain unverified in this pass.
- A controlled live-event balance and operations pass is still required before production scheduling. In particular, test actual level and loadout bands, since the offline fixture represents only a geared level-100 squad.

## Recommendation

Keep the current Weekly Boss as its own feature in tab 1. Use tab 2 of the World Bosses destination for the independently managed Roaming Boss event, whose current selectable roster is Chicxulub, Murogane, and Donkaku the Hollow Maze Warden. The event has its own identity, schedule, shared-health ledger, contribution rankings, rewards, and admin controls. Players should be able to use both features over time.

The existing Weekly Boss provides proven patterns for roaming, shared-health accounting, and retryable reward settlement. Clan Boss Operations and the Tower N-actor combat engine provide a starting point for authoritative team fights. Reuse those patterns where appropriate, but do not change the Weekly Boss's current rules or point the new event at its live state or reward records.

The supplied concept describes two independent features. This plan covers the world-boss event only. The separate energy-conversion feature is not a dependency and should not be bundled into this work.

## Existing game foundations

| Existing system | What it provides | Consequence for this plan |
| --- | --- | --- |
| Weekly Boss (`api/weekly-boss.ts`, `WeeklyBossArena.tsx`) | A shared HP ledger, sealed Solo PvE sessions, server-derived damage, per-spawn identity, capped attempts, and retryable reward receipts. | Keep it unchanged. Treat it as a reference for a separate event implementation, not as the event's state or player-facing surface. |
| Boss roaming (`weekly-boss-roam.ts`) | A deterministic walk over playable sectors, with the next location telegraphed; the live hop interval is 13 minutes. | Keep the boss visible on the World Map and reuse its connected-sector movement pattern. Give the new event a separate boss identity and event state. |
| Clan Boss Operations and the Tower N-actor engine | Party lifecycle, boss phases and objectives, party scaling, and contribution fields for damage, healing, shielding, cleanses, and objectives. | Adapt these for the new event's 2–3 player fights and support scoring. Existing Clan Boss parties are clan-bound and use a longer finder flow, so the world event needs an open, fast-matching adapter. |
| Sector geography (`shared/sector-geo.ts`, `shared/sector-links.ts`) | Playable sectors, map coordinates, village outskirts, and the road graph. | Validate the admin-selected spawn, roam a deterministic 13-minute itinerary over real roads, reach the selected village gate for the final stand, and apply any timeout penalty to that village. |
| Era IV: World Boss Awakening (`api/_era-defs.ts`) | Existing story context about great beasts crossing borders and the four villages holding one line. | Make the event feel like a continuation of the game's own setting. Add new creature art and names for this game. |
| Village upgrades (`shinobij.client/src/lib/village-upgrades.ts`) | Permanent upgrades owned by individual characters, not destructible shared village buildings. | Do not apply structure-level penalties on a failed defense. |

The Weekly Boss currently has a 72-hour manually scheduled window. When its shared HP reaches zero, it becomes “Broken” and continues accepting fights and damage scores until the timer expires. Leave that behavior intact. The new event stops new starts at zero HP and lets already-started team fights settle once. Its standings may update until those in-flight fights resolve. Separate event and match records ensure its victory and closure cannot alter the Weekly Boss.

## Proposed player experience

Use a **72-hour pilot** to keep the first event compact. Treat the seven-day schedule in the reference as one possible duration, not a requirement. Start with an admin-scheduled event and a separate schedule that avoids overlapping the Weekly Boss, so the team can observe participation without crowding the existing feature.

1. **The muster begins.** A world announcement explains the threat and shows the boss, event clock, shared HP, and current sector. The next move is visible on the World Map.
2. **The hunt opens.** For the first 48 hours, players from all four villages can travel to the boss and choose **Join Hunt**. That places them in a public queue for this boss spawn. Match across villages and clans, with up to three players in a team. A full team launches as soon as the third queue ticket is accepted. While a queue is forming, hold the boss at its current sector and freeze its hop timer. Hollow Shard veins offer optional Mining 4 support across the map. Successful mining adds one shard to the miner's event reserve; turning it in awards points and fills the shared weakening meter.
3. **The last stand begins.** The boss roams a deterministic road-connected itinerary from its admin-selected spawn and increasingly favors the chosen village as the 48-hour roam window ends. It reaches the selected gate on the itinerary's final hop; if queue pauses leave it behind, final-stand positioning resolves to that gate. Everyone can still join the fight. The selected village is shown as threatened.
4. **The event resolves.** Reaching zero shared HP is a victory. Reaching the event deadline is a retreat. A retreat applies 24-hour Ashfall to the threatened village: 5% lower training gains and 5% longer jutsu lessons. Either result closes the queue to new teams. The once-per-event reward is secured after the player's first meaningful contribution; any already-started raid can still settle afterward. Victory and manual stop do not apply Ashfall.

### Matchmaking and team fights

- Use a **30-second fill window per match batch** as the initial tuning value. The clock starts with the first queue ticket. A team launches as soon as its third ticket is accepted. When the window expires, launch the waiting players as a duo or solo if fewer than three joined. This is the fallback for quiet hours, not a separate mode the player must find.
- Let players join the open event queue from the boss's current World Map sector. A queue ticket is bound to the event spawn ID and expires if the player leaves the queue or the event stops accepting fights. Reconnecting players can recover their ticket during its remaining window.
- Assemble one server-authoritative encounter for each matched team. Multiple teams may have separate fights against the event's one shared HP pool. Every player controls their own actor; a disconnect or idle turn must not cancel the whole team. Apply boss and reward scaling by the actual team size of one, two, or three, and settle each match once under the event lock.
- Keep the queue open across village and clan boundaries. A premade duo can queue together for a third player; a solo player can fill an open seat. Do not require Clan Boss membership or a clan invitation.
- Record each player's verified damage and meaningful support actions from the sealed encounter. An idle member earns no personal or group contribution. Settlement must remain idempotent for the team and for each player's reward.

This makes a 2–3 player team the normal fight while honoring the solo fallback. It also keeps the boss's roaming location relevant: players must find the current sector before joining that spawn's queue.

At the deadline, reject new encounters. A server-sealed team fight can still settle afterward, so final standings may update as those in-flight raids resolve. After a victory, reject new starts at once; only encounters that were sealed before the victory may settle. Cache recipients finalize after those active matches settle, with a six-hour recovery cutoff. This avoids forced defeats while preventing post-event farming or indefinitely pending rewards.

## Contribution and reward rules

### Current first release

- Score damage and support actions only when they come from a valid, terminal server-authoritative team session. Score Hollow Shards only from a successful, globally unique mining receipt and a server-locked turn-in receipt. Do not accept client-reported damage or points.
- Keep a live individual, village, and clan leaderboard visible during the event and after it closes. Rank by verified damage plus support score plus Hollow Shard points; show damage and shard points separately. One shard is worth 1,000 points.
- At the settlement that reduces shared HP to zero, snapshot the individual top 15 by that same point total and deterministic player-slug tie order. Grant one Hollow Beast Cache per winner with a retry-safe save receipt. Later settlements from already-started teams update the leaderboard but do not change the award list.
- The event has no separate attempt cap. The account-bound reward is once per event and requires a meaningful personal contribution: 2,500 Ryo, 3 unspent stat points, 2 Bone Charms, one boss core, one random high-end material, and the existing boss-rate chance for a random weapon or armor item. Review this proposed budget against live participation before scheduling recurring events. Do not change the Weekly Boss reward rules.
- A Hollow Beast Cache is a stackable event item. Opening one consumes it and grants 1,500 Ryo, one Bone Charm, one random high-end hunting material, and a 20% chance at a Dungeon Key.
- Include a player in the leaderboard after a verified team contribution or Hollow Shard turn-in. Keep the existing combat reward eligibility rule unchanged. Village and clan standings are recognition only and do not grant separate rewards.
- Snapshot a player's clan and village attribution on their first meaningful contribution. Keep those affiliations fixed for this event so switching groups cannot move the same score between leaderboards.
- Grant the once-per-event reward at team-match settlement using the existing receipt-based retry pattern. Offline event-end distribution is not part of the first release.

### Follow-up contribution lanes

Add activities outside the team fight only after the first event's shared-health, matchmaking, and settlement flows are stable:

- **More cooperative objectives:** expand verified heals, shields, cleanses, and objective actions after the initial team fight proves reliable. Use a world-event adapter; do not require clan membership to take part in the global event.
- **Fragment encounters:** add a small, scheduled number of short-lived encounters in existing sectors. Their rewards and event score must be bounded per player. Avoid a large breeding population, unbounded active-spawn cap, and permanent Rage growth; those add always-running simulation and can make the boss harder for players who join later.
- **Village support:** if a delivery task is added, first audit existing items and their economy role. Use atomic inventory deductions and an event-specific score receipt. Do not create another permanent currency or require players to spend premium resources to qualify.

For the first launch, retain the distinct reward package above and use contribution placement for prestige. Balance the combined schedule against the Weekly Boss so the two features remain worthwhile without flooding the economy. Tie handling is deterministic by player slug; a live balance review should validate the payout before recurring schedules are added.

## Implementation sequence

### Phase 1 — event contract and state (implemented)

Implement the event's `roaming → final-stand → victory/retreated/stopped` state, 72-hour deadline, selectable boss identity, matchmaking window, party size, fallback, eligible actions, score categories, and deterministic tie ordering. Give each event an immutable spawn ID and event-specific queue, match, state, and reward receipts. The event must not read or write the Weekly Boss's HP, attempts, contribution, or reward records.

### Phase 2 — admin-selected route and Central tabs (implemented locally)

Add the World Bosses Central entry with Weekly Boss in tab 1 and Roaming Boss in tab 2. Keep the separate map marker and event panel, public three-seat queue, 30-second fill timer, duo/solo fallback, and event-specific team encounter and settlement flow. Release any roster boss manually through full-admin controls. Preserve the Weekly Boss schedule, fight, state, and rewards.

### Phase 3 — timeout consequence (implemented locally)

At release, validate and seal the chosen playable spawn sector and destination village. Follow a deterministic 13-minute itinerary over adjacent edges in the actual road graph, explore the world early, and bias toward the selected gate late. The route reaches the gate at the end of the 48-hour roam window; queue pauses are respected, with the selected gate guaranteed for final-stand positioning. If the boss remains alive at the 72-hour deadline, apply a one-time, 24-hour Ashfall stamp to the selected destination village. Ashfall lowers training gains by 5% and lengthens jutsu training by 5%; it does not damage permanent structures. The village record stores an event receipt so retries cannot duplicate or extend the penalty.

### Phase 4 — Hollow Shard mining and tiered contribution (implemented locally)

Place up to 60 event-only Hollow Shard veins on reachable rock tiles across playable sectors. Use Mining skill 4, an equipped pickaxe, the current movement authority, daily action limit, and the existing Fracture Chain. A successful harvest adds the node ID once and stores one shard for the miner. The server consumes the reserve once on turn-in and awards 1,000 contribution points per shard. Every six deposits fill one tier for 5% less boss damage dealt and 5% more boss damage received, up to ten tiers and 50%. Encounters snapshot filled tiers at team start. The damage reduction applies to all boss damage, including fixed max-health damage from telegraphed strikes. Partial shard progress does not weaken the boss until a six-shard tier is complete. Crystals are optional and never required to enter combat.

### Phase 5 — top 15 cache rewards (implemented locally)

When verified settlement takes the event HP to zero, close new queues and wait for active team matches to settle before persisting the top 15 individual contributors using damage plus support score plus Hollow Shard points, with player slug as the deterministic tie-break. After six hours, finalize the snapshot even if a match was abandoned. Grant one stackable Hollow Beast Cache to each recipient through a retry-safe save receipt. Authenticated event views retry pending snapshot finalization and deliveries. Cache opening consumes one item under its own receipt and grants 1,500 Ryo, one Bone Charm, one random high-end hunting material, and a 20% chance at a Dungeon Key.

### Phase 6 — tune and operate (pending live review)

Run a controlled event with production-like participation before automating the schedule. Tune the shared HP once from observed participation; avoid changing it dynamically during a live event. Review completion versus retreat rate, time to defeat, participant and village distribution, repeat attempts, support share, reward spend per account, and outstanding settlements before raising the spawn cadence or reward ceiling.

## Launch acceptance criteria

- Every score entry comes from a valid server session or an audited server-side support action; duplicate requests cannot add score or rewards twice.
- Shared HP never falls below zero. Victory stops new starts, and deadline closure handles in-flight encounters without forced defeat or post-close starts.
- The boss starts at the exact admin-selected playable sector and follows adjacent edges in the real road graph on a deterministic itinerary that reaches the selected village outskirts for final stand. The player map, admin state, queue-sector validation, and timeout penalty all reflect the same sealed destination. Queue waits freeze the position and hop timer; legacy events retain their previous route behavior.
- Three players launch as soon as the third queue ticket is accepted. After 30 seconds, one or two queued players launch at the actual team size; quiet queues do not strand players.
- While queued players remain, the displayed sector and hop countdown stay fixed. Match formation, queue cancellation, timeout, event closure, and the final-stand transition all update the pause clock consistently.
- A party is capped at three, works across clans and villages, supports a premade duo filling its last seat, and survives one member disconnecting or timing out.
- Boss tuning and contribution settlement reflect the actual team size. One member cannot claim another member's damage or support credit.
- Solo participation works for players without a clan. Village and clan rankings use the event-locked affiliations and minimum contribution thresholds.
- Tied individual standings resolve consistently by player slug. Each eligible player's event reward is saved with a retry-safe receipt.
- The map boss art reads at about three to four times the player marker without changing sector hit boxes or route locations.
- Each reachable Hollow Shard vein requires Mining 4 and a pickaxe and uses the authoritative mining flow. A vein can be claimed once globally; a turn-in can score once per receipt. Every six deposits fill one 5% weakening tier, capped at 50% less boss damage dealt and 50% more damage received.
- The top 15 after pre-victory team matches settle each receive one Hollow Beast Cache. If a match remains unresolved beyond the six-hour recovery window, the cache list is frozen from settled standings and a late settlement cannot rewrite that list. Duplicate settlements cannot mint another cache, and opening consumes exactly one cache.
- A timeout applies retry-safe 24-hour Ashfall to the selected destination village: 5% lower training gains and 5% longer jutsu training. Victory and manual stop do not apply it.
- Each roster boss has a distinct server-side defense and signature strike: Chicxulub regenerates up to 1% of match HP at round end and marks a wide nova every four rounds; Murogane takes half damage while guards remain and charges a 14% slam every three rounds; Donkaku raises capped phase shields and marks a 12% volley every three rounds. Strikes are telegraphed, and their damage follows the active shard tier.
- Hollow Shards are event-held turn-in items, not a permanent currency, and the event has no paid entry requirement.
- The Central destination is named World Bosses, with the existing Weekly Boss in tab 1 and Roaming Boss in tab 2. Full admins can release any of the three roster bosses or stop the active event. The Weekly Boss schedule, combat behavior, state, and rewards remain unchanged.

## Production decisions and follow-up

1. The pilot duration is set to 72 hours, with 48 hours of roaming and a 24-hour stationary final stand. Revisit seven days only if participation data shows the shorter window excludes the roster.
2. The boss follows roads from the admin-selected spawn to the selected village outskirts, holds there on arrival, and enters final stand after 48 hours. A timeout applies temporary Ashfall to the selected village; there is no village siege encounter or permanent structure damage.
3. The queue launches a full trio immediately and releases one or two players after 30 seconds. The server also supports a solo fallback.
4. Hollow Shards are optional mid-level mining content. Each gives 1,000 points; every six fill a 5% weakening tier, with both effects capped at 50%.
5. The pilot reward package is set in code. Review the combined economy impact with the Weekly Boss before adding a recurring schedule.
6. Top 15 cache recipients are snapshotted after already-started teams settle, or after a six-hour recovery cutoff, so concurrent attackers are included when results arrive without leaving abandoned matches pending indefinitely.

## Project references

- [Weekly Boss server flow](../api/weekly-boss.ts)
- [Weekly Boss roaming rules](../shinobij.client/src/lib/weekly-boss-roam.ts)
- [Weekly Boss player screen](../shinobij.client/src/screens/WeeklyBossArena.tsx)
- [Clan Boss party contribution model](../shared/clan-boss-operation.ts)
- [Tower N-actor engine](../api/towers/_engine.ts)
- [Sector geography](../shared/sector-geo.ts) and [sector links](../shared/sector-links.ts)
- [Era definitions](../api/_era-defs.ts)
- [Village upgrade ownership](../shinobij.client/src/lib/village-upgrades.ts)
- [Donkaku walk sprite specification](visual-concepts/donkaku-walk-v1.txt) and [key art specification](visual-concepts/donkaku-key-art-v1.txt)
