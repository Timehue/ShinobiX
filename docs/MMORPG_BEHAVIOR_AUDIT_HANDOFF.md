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
