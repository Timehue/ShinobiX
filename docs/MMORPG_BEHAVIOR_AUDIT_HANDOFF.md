# MMORPG behavior audit — handoff

Companion to `docs/MMORPG_BEHAVIOR_AUDIT_2026-09-08.md`, which carries the evidence and
the reasoning for each finding. This file is the resumption record: what state the work
is in, what a next session must know, and — importantly — **what this pass did not
reach**, so nobody mistakes the audit's scope for the whole game.

Branch: `claude/mmorpg-behavior-audit-783026`. Base: `9a13ff264`.
Status: **all eight findings implemented and tested on this branch. Not pushed.**
Rulings and their reasoning: `docs/MMORPG_BEHAVIOR_RULINGS.md`.

## Disposition table

**All eight are now SHIPPED on this branch.** The four rulings the audit deferred were
researched against genre precedent and decided; the reasoning is in
`docs/MMORPG_BEHAVIOR_RULINGS.md`.

| ID | Finding | Ruling / fix | Status |
|---|---|---|---|
| F1 | Death is a free full heal | Discharge restores HP only; idle regen becomes a share of each pool (full bar in 30 min, floored at the old rate); Healer self top-up gets the existing rank-scaled cooldown | **shipped** — 2 kill switches |
| F2 | `hospitalized` enforced at 4 of ~15 entry points | Shared `isIncapacitated()` in `api/_elapsed-state.ts`, applied to every fight-committing entry point | **shipped** |
| F3 | Dive entry spent while hospitalized | Gate in `hollow-gate/start.ts` before the `ord` reservation; the replay path still resolves an already-paid run | **shipped** |
| F4 | Silence bypassable on 4 surfaces | `getActiveSilence()` on clan chat, trail signs, custom titles, named forging | **shipped** |
| F5 | No post-defeat protection online | 120 s server-owned `pvpShieldUntil`; `/api/player/attack` refuses admitted or shielded targets from the authoritative save | **shipped** |
| F6 | No clan founder succession | `POST /api/clan/leave` with computed succession (`api/clan/_succession.ts`); client wired | **shipped** — inactivity cron deferred |
| F7 | Inventory overflow destroys items | Cap is non-destructive like `PET_CAP` — never truncates below what is stored; player-initiated acquisitions refuse at the moment of gain | **shipped** — both steps |
| F8 | Transfers capped per call, not in aggregate | Rolling 24 h send-side budget with a trust tier; receiving untouched | **shipped** |

One follow-up was deliberately NOT taken and is the honest remainder:

- **F6's 30-day founder-inactivity cron.** The right long-term shape, but a server reset
  is pending, so already-orphaned clans get wiped rather than repaired. What mattered was
  stopping new ones. Worth adding before launch.

**F7 step 2 shipped afterwards** (see "Second verification pass" below). The rule that
survived review is narrower than the original plan of "capacity checks on ~15 grant
paths", and the narrowing is the interesting part:

- **Only PLAYER-INITIATED acquisition refuses** — shop, craft, named forge, clan
  exchange, key forge, event claim. The player still holds whatever would have produced
  the item, so a refusal delays it and they can retry.
- **Already-earned SETTLEMENT never refuses** — a boss drop, a mission payout, a war
  crate. The fight is over; refusing strands the reward instead of delaying it, and
  step 1 already guarantees it persists.
- **The test is GROWTH, not fullness** (`inventoryGrowthBlock`). Crafting is net-negative
  on slots — a weapon burns ~50 non-stackable `hunt-*` materials to add one — and a bag
  full of hunt materials is exactly how a bag reaches the cap, so a plain "is it full?"
  check refuses the one action that frees it.
- **Stackables are not slots.** They live in `itemStacks`, so any path that appends them
  to `inventory[]` makes a bulk buy look like +50 slots and gets refused for a bag it
  never touches.

## Verification pass (2026-09-08, after the rulings landed)

The shipped change set was re-reviewed adversarially against its own claims. Twelve
defects were found in it and fixed; four hypotheses were checked and disproved. Worth
recording because most of them were in the *seams*, not the logic — which is where this
kind of change fails.

**Found in my own work and fixed:**

| What was wrong | Why it mattered |
|---|---|
| `App.tsx` still refilled all three bars on a Healer heal | Server wrote HP only, so the client showed full chakra that the autosave ceiling clawed back — the exact falling-bars failure F1 warned about |
| `chargeOutboundBudget` ran OUTSIDE the trade locks | The check was inside them, the write was not, so pipelined calls all read a stale ledger and the 4M ryo/min ceiling stood — the budget did nothing |
| The Hospital screen promised "full restoration" in 5 more places | A player paid the discharge fee for HP only, having been told otherwise. My earlier commit claimed it was one string; it was six |
| `hollow-gate/start` returned the raw code `hospitalized` | The client's generic fallback told the player to "retry when the connection is stable" — wrong and unactionable |
| The Healer self-cooldown was claimed before the lock | A 403/400 refusal still burned the cooldown for a top-up never received |
| `sleeper-kill` wrote the shield but never read it | The offline raid door ignored Field Recovery entirely |
| The shield never dropped when its holder attacked | Lose on purpose, then raid for 120 s while un-attackable |
| `towers/start` had no incapacitation gate | Tower seals full vitals and burns a daily entry — the same argument used to gate the other three |
| Three pre-existing gates were never migrated to `isIncapacitated` | Four variants of "hospitalized" coexisted where the helper's whole point was one |
| The named-forge silence refused the forge outright | Destroyed a paid roll (token expires in 20 min, silences last days) instead of muting text. Now the forge lands and the authored name is dropped |
| `clan/leave` discarded the save version it wrote | Both parties took a save-conflict 409 whose recovery discards local progress |
| The flat anti-cheat grace got multiplied by the pooled rate | Turned a 60-point cushion into 360 per vital per save at level 100 |
| F8 capped trade but not treasury gifting | Officers and the Kage could push ~6M ryo/min to a named account beside a 1M/day cap on ordinary players |

**Also corrected: two documents gave actively harmful advice.** The flag matrix and the
rulings doc both told an operator to throw `DISABLE_POOLED_VITAL_REGEN` if players
reported vitals falling on save. That flag is read server-side only while the client
clock is unconditionally pooled, so throwing it *causes* that symptom. Both now say so.

**Checked and disproved** (recorded so nobody re-opens them): the F5 shield is *not*
bypassable via `/api/pvp/session` creation — an unsolicited create never indexes the
opponent, and session creation already refuses an unconscious fighter; the ClanHall
client flow is correct and has no dead imports; the three regen implementations agree
numerically, Aura ladder included; `pvpShieldUntil`'s lifecycle is right, and it is
correctly absent from the public DTO and present in the client's server-owned list.

**One design objection considered and declined.** The review argued the 120 s shield is
undersized because a level-100 loser needs ~28 minutes to recover chakra and is a soft
target until then. The shield is deliberately sized to cover the *exit*, not the
recovery: 60 s of hospital plus 60 s to leave the sector, after which resting happens in
town. A shield long enough to cover full recovery would make sector PvP unplayable on a
100–200 player server. What the objection did correctly identify is that the ruling doc
understated the cost of a defeat — that wording is now fixed, and the stale comment in
`_vitals-settlement.ts` that still claimed recording the spend "costs an admitted player
nothing" has been corrected.

**Owner rulings on the three open items (2026-09-08):**

1. **Road-medic wanderer — LEAVE IT.** Owner call: it is fine as is. Recorded here so a
   future pass does not "fix" it. It restores all three vitals in a wild sector
   (`api/sector/wanderer-service.ts:152-157`), but it is paid, and its cooldown key is
   `wanderer-use:<player>:<wanderer>` — per player per wanderer, so one medic cannot be
   farmed, though several different wanderers can each be used inside the 3 h window.

2. **PvE chakra — superseded by an owner ruling: OPEN-WORLD COMBAT IS CONTINUOUS.**
   "After all combat you should not be restored to the state, you should be placed back
   into your spot with the amount of hp chakra and stamina you had after your fight, pve
   and pvp, when you are in the open world" (2026-09-08).

   The route here matters, because two wrong answers came first. I diagnosed a chakra
   *refund* and fixed the settle — which was a **faucet**, because PvE seeds the actor at
   the FULL pool (`chakra: COMBAT_RESOURCES_V2 ? maxChakra : currentChakra`,
   `api/solo-pve/_ai-encounter.ts`), so its leftovers are what remains of a free bar:
   enter at 10%, finish at 60%, bank 60%. I reverted that. The ruling then fixed the real
   problem — the SEED — which makes the carry-back correct rather than a faucet.

   **Both halves ship together, and neither is safe alone.** A continuous encounter seeds
   the fighter from `currentChakra`/`currentStamina`, and settlement carries them back
   only for such an encounter. Continuity is stamped on the ENCOUNTER at creation
   (`metadata.continuousVitals`) so a settle reads it off the sealed session rather than
   trusting a request field, and `sessionUsesContinuousVitals()` is the one reader.
   The carry is additionally clamped **decrease-only**, so even a mislabelled encounter
   can only ever cost a player vitals, never mint them.

   **Scope — open world:** `explore`, `world`, `mission`, `defense`, `raidAi`
   (`OPEN_WORLD_BATTLE_KINDS`). **Fresh-start, unchanged:** practice spars, dungeon runs,
   Spire waves, Hollow Gate dives, story bosses, the Academy spar, the weekly boss and
   Tower runs — each hands the fighter a fresh pool, so carrying leftovers out would
   reopen the faucet. Sector PvP was already continuous (`useCurrentVitals`,
   `api/pvp/session.ts`; the spend is written by `_vitals-settlement.ts`), so the PvP half
   of the ruling needed no change.

   ⚠ **The boundary is a judgement call worth confirming.** Dungeon runs, Spire waves and
   Tower runs are arguably "in the world" too; I read them as instanced content and left
   them fresh-start. Widening the set is a one-line change to `OPEN_WORLD_BATTLE_KINDS`
   plus the equivalent flag on those builders.

   Kill switch `DISABLE_OPEN_WORLD_CONTINUOUS_VITALS=1`, default ON. It gates the SEED
   only — throwing it makes new fights fresh-start while a session already seeded from
   real vitals still settles the way it started, which is the correct rollback shape.
   Pinned by `api/missions/_open-world-continuous-vitals.test.ts`, including the faucet
   case and the decrease-only clamp.

3. **Inventory — HARD REFUSE, scoped.** Owner call. One authority now
   (`api/_inventory-capacity.ts`) replaces the two duplicate 500s that used to live in
   `shop/_settlement.ts` and `save/[name].ts`, and both now import it.

   The refusal is applied to **player-initiated acquisitions**, and each one refuses
   BEFORE it spends anything: the Hollow Gate key forge (keeps the shards), the builtin
   event claim (does not burn the one-time latch), weapon/armor crafting (keeps the
   materials and the ryo), and the village war-crate claim (leaves the claim open). The
   shop already did this and now shares the constant.

   It is deliberately NOT applied to **already-earned settlements** — a weekly-boss drop,
   a war reward, a dungeon relic, a story-reckoning drop. Those fights are already
   resolved, so refusing would strand a reward rather than delay it, and step 1 already
   guarantees they persist (the save validator never truncates below what is stored).
   That is the same lesson as the 2026-09-01 victory-screen incident: a settlement must
   not turn a "you get nothing" into a trap.

   Consequence to be honest about: the ratchet is bounded, not eliminated. Bulk growth
   (crafting, buying, forging, claiming) is now capped at 500; rare unique settlement
   drops can still push a veteran past it, and the validator will keep them. That is the
   intended trade — the alternative re-creates the item destruction F7 existed to fix.

   ⚠ Stackable outputs are exempt on purpose. Supply and relic recipes are
   `STACKABLE_OUTPUTS` and land in `itemStacks`, which the cap does not govern, so the
   craft gate is scoped to `kind === 'weapon' || 'armor'`. Gating stackables would refuse
   a ration craft for a bag it never touches.

## Coverage — what this pass actually examined

The request was a full-game audit, and the reading was broad, but it was not uniform.
Being precise about that is the point of this section: an unqualified "full game" claim
would let a future pass skip areas that were never really looked at.

**Examined with evidence, findings above are drawn from these:**

- Death, hospitalization, discharge, and the vitals-regeneration cursor
- PvP: attack gating, presence rules, ranked queue liveness, fighter vitals seeding,
  bounties, Vanguard reward caps, AFK forfeit
- Sleeper camps and the offline-PvP path
- Direct player-to-player trade; bank interest (read, not modelled)
- Inventory, pet, tile-card and creator-item capacity handling
- Clans: leave, dissolve, the save validator, role authority
- Moderation: bans at auth, silence records, every player-authored text surface
- Daily-reset key consistency across all ~17 helpers
- Training start/complete and offline timer durability
- Hollow Gate run start vs. combat start
- Cron job coverage (enumerated, not audited individually)

## Second verification pass (2026-09-08, on F7 step 2)

Step 2 was reviewed the same way, across four dimensions, before it was committed. It
found nine confirmed defects collapsing to four distinct ones, and every one of them was
in code I had just written to *prevent* item loss.

| What was wrong | Why it mattered |
|---|---|
| The treasury capacity check sat in `creditRecipient` | `api/_cross-key-settlement.ts` writes the source debit at :114 and sets `mutationObserved` before calling `creditRecipient` at :128. A throw after that is unrecoverable — the catch marks the journal `reconciliation-required` and never rolls back. The gift left the treasury, never arrived, and the officer was told "Nothing was sent." A **regression**: the same gift succeeded before the check existed |
| `purchaseCatalogItem` pushed stackables into `inventory[]` | All 7 bulk-purchasable items stack, so a 50-shuriken order read as +50 slots. The new gate then refused every potion, pill and shuriken to a full-bag veteran — combat consumables, i.e. the one thing a bag cap must never block. It also ratcheted the non-destructive save ceiling to 550 whenever a save landed before the client compacted |
| The refusal said "Your inventory is full." to the SENDER | A Kage with an empty bag was sent to check their own. Now named after the recipient, from their stored save name rather than the request body |
| The key forge's comment claimed it frees four slots | `dungeon-key` is stackable, so `consumeItem` drains `itemStacks` first and removes nothing from `inventory[]`. The forge is normally net **+1** |

**The lesson, and it is the same one as the first pass:** the defect is never in the rule,
it is in where the rule is applied. "Refuse before the spend" was written down in
`api/_inventory-capacity.ts` as the contract, and then broken two files over by placing
the check in a callback that a saga only reaches *after* it commits. Before adding a
capacity check to a settlement saga, read the saga's own ordering — `validateRecipient`
runs before the debit, `creditRecipient` after it, and only the first can refuse safely.

**Do not "helpfully" duplicate the check into `creditRecipient` as a second line of
defence.** A crash-resume skips the whole `sourceState === 'fresh'` block, goes straight
to the credit, and the copy would strand an already-debited item — the exact failure the
check exists to prevent. Both transfer files carry a ⛔ comment saying so.

**Not reached in this pass.** Roughly in the order I would take them next, by how much
player-visible behavior sits behind each:

1. **Sector war / village war / territory lifecycle** — the largest untouched system,
   and the one with the most cross-player consequence. Note the prior finding in
   `[[project_sector_war_game_type_routing_audit_2026_09_07]]` that self-auditing the
   garrison scoring surfaced six defects; that area rewards scrutiny.
2. **Missions and hunts** — eligibility, claim races, and reward pacing. There is a
   known open item elsewhere (`project_combat_mission_claim_persist_race`).
3. **Professions** beyond the Healer discharge perk and Vanguard rewards — caps and
   anti-abuse are noted in the roundness audit as varying by source.
4. **Pets** — breeding, showdown, ladder and coliseum lifecycles. Only capacity handling
   was checked here.
5. **Crafting and the forge economy** — sinks were not modelled.
6. **Card Clash / Chronicle / Echoes** — only its presence projection was touched.
7. **Story, First Pact, festivals, exams, awakening, bloodlines, legacy** — untouched.
8. **Achievements and leaderboards** beyond the season read endpoint.
9. **Monetization (Tebex) and admin tooling** — deliberately out of scope.

Client-side UX behavior was also out of scope by choice: this pass audited the *rules*,
and only read client code where it was the enforcement layer for a server rule (the
hospital screen pin, the clan leave flow).

## Notes for whoever picks this up

- **Every fix is additive or a refusal.** None changes an existing successful flow, so
  none can corrupt a live save. That property is worth preserving as they land.
- **F1's regen change has three mirrors that must move together**: `settleVitalsRegen`
  (api/_elapsed-state.ts), the autosave gain ceiling (api/save/[name].ts), and the
  client's idle clock (shinobij.client/src/lib/loaded-vitals.ts). If they drift, a
  high-level player's bars visibly FALL on save — worse than the bug being fixed.
  `api/_pooled-vital-regen.test.ts` pins the server/ceiling pair.
- **Per-pool regen is no longer a UNIFORM rise**, so `isIdleVitalsOnlyChange` had to stop
  requiring one. Getting that wrong autosaves on every tick, which is the 409 exchange
  that function exists to prevent.
- **Source-contract tests pin some of these files.** F2 and F5 touch handlers whose
  exact source text is asserted by `api/pvp/_pvp-contract.test.ts` and
  `api/player/heartbeat.test.ts`. Run the full root suite, not the touched files.
- **`api/**/*.test.ts` compile into the server build** (`tsc -p tsconfig.cpanel.json`),
  so a type error in a new test breaks `build:server` — run tsc, not just the tests.
- **Handler-test recipe** is in `docs/auth-and-anti-cheat-patterns.md`:
  `SHINOBIX_QA_MEMORY_KV=1` + `NODE_ENV=test`, player identity via `SESSION_SECRET` +
  `issuePlayerToken(name)`.
- **F6 touched `ClanHall.tsx`**, so both CI-gated e2e suites were required and were run.
- **The ownership golden-master snapshot was regenerated** for the one new server-owned
  field (`pvpShieldUntil`); the diff shows only that field, which is the review signal
  that test is designed to produce.
- **Do not re-flag the verified-correct list** in the audit doc — the UTC day-key
  duplication, the fresh-start vs. continuous vitals split, and the two-tier newcomer
  protection are all deliberate and were confirmed as such.
