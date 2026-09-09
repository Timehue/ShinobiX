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
| F7 | Inventory overflow destroys items | Cap is non-destructive like `PET_CAP` — never truncates below what is stored | **shipped** — step 2 (at-acquisition checks) still open |
| F8 | Transfers capped per call, not in aggregate | Rolling 24 h send-side budget with a trust tier; receiving untouched | **shipped** |

Two follow-ups were deliberately NOT taken and are the honest remainder:

- **F6's 30-day founder-inactivity cron.** The right long-term shape, but a server reset
  is pending, so already-orphaned clans get wiped rather than repaired. What mattered was
  stopping new ones. Worth adding before launch.
- **F7 step 2 — at-acquisition capacity checks on ~15 grant paths.** The save layer no
  longer eats items, which stops the bleeding; telling the player "inventory full" at the
  moment it happens is the real fix and touches 15 files.

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

**Still open, deliberately:** the road-medic wanderer (`api/sector/wanderer-service.ts`)
is a paid but repeatable full three-bar restore whose cooldown is per-wanderer rather
than per-player — the last remaining full chakra refill, and an owner call on price
rather than a bug. **PvE chakra persistence is unverified and should be checked before anyone
relies on the new rule in PvE.** `applyAiFightOutcomeToCharacter` writes HP back from
the sealed actor and leaves chakra/stamina at their STORED (pre-fight) values, and its
input is the save's character, not the client's post-fight one. Whether a mission
fight's chakra spend actually sticks therefore depends on the client's own autosave
landing — and on which of the two writes lands last. If the server write wins, PvE
combat silently refunds its chakra while PvP does not, which would make "exhaustion is
rested off" a PvP-only rule by accident. I did not settle this; it needs a live trace,
not more reading. And the non-destructive
inventory cap is now a one-way ratchet with no upper bound.

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
