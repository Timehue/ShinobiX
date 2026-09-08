# MMORPG behavior audit — handoff

Companion to `docs/MMORPG_BEHAVIOR_AUDIT_2026-09-08.md`, which carries the evidence and
the reasoning for each finding. This file is the resumption record: what state the work
is in, what a next session must know, and — importantly — **what this pass did not
reach**, so nobody mistakes the audit's scope for the whole game.

Branch: `claude/mmorpg-behavior-audit-783026`. Base: `9a13ff264`.
Status: **plan only. No product code was changed and nothing was pushed.**

## Disposition table

Status legend matches `docs/RPG_BEHAVIOR_HANDOFF_TRACKING.md`: `open` (recorded, not
implemented), `ruling-blocked` (cannot start until the owner decides).

| ID | Finding | Severity | Files the fix touches | Status |
|---|---|---|---|---|
| F1 | Death is a free full heal; Healer discharge makes it instant | High | `api/player/heal.ts:242-249` | **ruling-blocked** — 3 options offered, partial-vitals recommended |
| F2 | `hospitalized` enforced at 4 of ~15 entry points | Medium | new `isIncapacitated()` in `api/_elapsed-state.ts`; callers per the table in the audit | open |
| F3 | Dive entry consumed while hospitalized, then unfightable | Medium | `api/hollow-gate/start.ts` (before the `ord` reservation) | open |
| F4 | Silence bypassable via 4 public text surfaces | Medium | `api/clan/chat/send.ts`, `api/sector/trail-sign.ts`, `api/player/profile-title.ts`, `api/craft/named.ts` | open |
| F5 | No post-defeat protection online; no per-pair attack cooldown | Medium | `api/_realtime/presence-gating.ts` | open (checks) + **ruling-blocked** (cooldown) |
| F6 | No clan founder succession; client-side best-effort leave | Medium | new `api/clan/leave.ts` modelled on `api/clan/kick.ts`; `api/_clan-save-validate.ts` for succession | open (leave endpoint) + **ruling-blocked** (succession shape) |
| F7 | Inventory overflow silently destroys items | Medium | `api/save/[name].ts:1693` (step 1); ~15 grant paths (step 2) | open |
| F8 | Transfers capped per call, not in aggregate | Low | `api/player/trade.ts`, `api/player/_trade-core.ts` | **ruling-blocked** — amounts |

Four rulings gate the work: F1's option, F6's succession shape, whether F5's per-pair
cooldown is wanted, and F8's amounts. Everything marked plain `open` can start now.

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
- **F2 and F3 share a helper.** Do F3 first: it is two lines and it establishes the
  `isIncapacitated()` shape that F2 then applies broadly.
- **F7 step 1 before step 2.** Making the truncation non-destructive is the safety net
  and stops the bleeding; the at-acquisition checks are the real fix but touch 15 files.
- **Source-contract tests pin some of these files.** F2 and F5 touch handlers whose
  exact source text is asserted by `api/pvp/_pvp-contract.test.ts` and
  `api/player/heartbeat.test.ts`. Run the full root suite, not the touched files.
- **`api/**/*.test.ts` compile into the server build** (`tsc -p tsconfig.cpanel.json`),
  so a type error in a new test breaks `build:server` — run tsc, not just the tests.
- **Handler-test recipe** is in `docs/auth-and-anti-cheat-patterns.md`:
  `SHINOBIX_QA_MEMORY_KV=1` + `NODE_ENV=test`, player identity via `SESSION_SECRET` +
  `issuePlayerToken(name)`.
- **These are API-only changes**, so the two e2e suites CI gates on are not implicated
  unless a fix reaches a screen or component. F6's leave endpoint will touch
  `ClanHall.tsx`, and that one does need the e2e suites.
- **Do not re-flag the verified-correct list** in the audit doc — the UTC day-key
  duplication, the fresh-start vs. continuous vitals split, and the two-tier newcomer
  protection are all deliberate and were confirmed as such.
