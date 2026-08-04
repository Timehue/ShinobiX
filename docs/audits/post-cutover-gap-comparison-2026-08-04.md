# Post-cutover gap comparison

Date: 2026-08-04
ShinobiX baseline: `b815be4fe0088735df444fd7a1464c5e0c3bfa48`
ShinobiX comparison point: `4b53964abf13fe5a1a792d1d3b5871d0d1e5fb27`
TheNinjaRPG reference: `df6dcd0d7d4b23d9cf309ea3a0159f366f764869`

The reference SHA was fetched from `origin/main` immediately before this pass.
This is a capability comparison only. No reference implementation, formula,
schema, content, asset, or writing was copied.

## Source evidence

TheNinjaRPG's central server combat is visible in
`app/src/server/api/routers/combat.ts`, `app/src/libs/combat/actions.ts`, and
`app/src/libs/combat/process.ts`. Its data-driven AI schema/executor are in
`app/src/validators/ai.ts` and `app/src/libs/combat/ai_v2.ts`. Ranked rules,
raids, clans/villages/Kage, world sectors, and persistent battle records are
represented by `app/src/libs/ranked_pvp.ts`,
`app/src/server/api/routers/raids.ts`, the clan/village/Kage routers, and
`app/drizzle/schema.ts`.

ShinobiX evidence is the executable runtime inventory plus the referenced
files in the table below. “Implemented but unverified” means real code and tests
exist but the complete production-facing adoption or journey is not yet proven.

## Classification

| Capability | Classification | ShinobiX evidence and exact gap |
|---|---|---|
| Solo-PvE authority | Equivalent but different | `api/solo-pve/`, all migrated mode bindings, and `scripts/combat-runtime-inventory.mjs` provide a dedicated versioned/idempotent one-human runtime. The reference uses its unified combat model instead. |
| PvP authority | Equivalent but different | `api/pvp/session.ts`, `api/pvp/move.ts`, and PvP settlement keep server-sealed fighters, moves, winner, history, and rewards. This cutover intentionally did not rewrite it. |
| Ranked fairness | Equivalent but different | `api/pvp/ranked-queue.ts`, `_ranked-match-token.ts`, `_ranked-rating.ts`, season cron, and sealed PvP settlement cover queue/rating/replay safety. The reference has a different Elo/loadout-restriction model. |
| Group PvP | Lower priority for a 100-player beta | ShinobiX has server PvP duels with sector consequences, but not a permanent general 2v2/3v3 shinobi queue comparable to the reference MPvP structures. Adding another low-population queue would fragment the beta. |
| Cooperative raids | Equivalent but different | `api/clan-boss/` plus the Tower N-actor runtime provide party assaults, contribution, retryable settlement, and clan receipts. Field raids are a separate mission system. |
| Data-driven AI authoring | Implemented but unverified | `api/combat-core/ai-authoring.ts`, canonical admin dual-read, atomic publish validation, AdminPanel controls, and Solo execution are real. Tower ally/objective/threat evaluation and a deployed admin-to-fight browser journey remain unverified. |
| Boss encounter authoring | Equivalent but different | Tower floor catalogs, Clan Boss weeks, Weekly Boss guard phases, and the Hollow Gate combat director are server-authored. They are several deliberate mode vocabularies rather than one universal boss DSL. |
| Combat event telemetry | Implemented but unverified | `api/combat-core/events.ts` is emitted by ordered Solo events and records normalized raw/resolved damage, resource, status, movement, item, lifecycle, objective, flee, and outcome facts. Other runtimes and downstream consumers are not yet adapted. |
| Clan and village integration | Equivalent but different | `api/clan-boss/`, village treasury/upgrades/agenda/leadership, guard queue, ANBU, and war endpoints are substantial player systems rather than placeholders. |
| Sector war | Equivalent but different | `_sector-war.ts`, `api/village/sector-war.ts`, sector card/pet contests, mercenaries, terrain, structures, and win conditions provide a ShinobiX-specific territory model. |
| World consequences | Equivalent but different | Sector ownership, village treasury/structures/debuffs, war crates, map control, Hollow Gate unlock state, and story reckoning persist consequences. The reference models villages/shrines/townhall consequences differently. |
| Kage/leadership integration | Equivalent but different | `api/village/kage*.ts`, ANBU appointments, elder focus, treasury, terrain, challenges, and client leadership state are executable. Staffing and production social-policy verification remain operational risks. |
| Late-game guidance | Already stronger | The level 50–100 spine links story, A/S missions, Towers/Spire, professions, Hollow Gate, Legacy, clan/village leadership, Weekly Boss, and ranked goals. Balance depth still needs live beta data. |
| Queue fragmentation | Lower priority for a 100-player beta | Existing PvP/ranked/pet/Tower/clan/war surfaces are already numerous. The verified recommendation is to avoid new permanent queues and staff/schedule high-impact modes. |
| Mobile usability | Equivalent but different | Responsive combat CSS, compact/mobile/tablet Playwright projects, touch-target tests, and mobile navigation coverage exist. Hollow Gate remains desktop-first product positioning pending live-device evidence. |
| Live operations | Equivalent but different | Release flags/kill switches, beta metrics/reporting, admin diagnostics, economy reconciliation, health checks, rollback/runbooks, Sentry builds, and certification scripts support a controlled beta. |
| Economy safety | Already stronger | Fail-closed locks, one-time receipts, entitlement tests, economy transactions/audits, settlement recovery, and mutation-tested reward guards cover the high-risk ShinobiX paths reviewed here. This is a safety comparison, not a claim about economy balance. |
| Content publishing | Already stronger | `api/admin/content-publish.ts` provides per-field locking, optimistic versions, conflict response, canonical storage, compatibility mirror, forged-item stripping, and atomic creator-AI program/reference validation. The remaining risk is deployment/moderation operations, not an unlocked write path. |

## Verified conclusions

The cutover closed the highest-risk gap: rewarding normal Solo modes no longer
depend on client outcome/vitals/enemy/reward truth or use Tower merely to obtain
server authority. Published compatibility moved from 12 known unsupported
ground/movement jutsu in the starting Solo engine to zero unsupported across
217 jutsu, 164 items, and 71 built-in AI profiles.

The source comparison confirmed two high-leverage gaps and they now have
original ShinobiX-native foundations:

1. validated server AI programs with canonical publication and a real Solo
   executor; and
2. a runtime-neutral, bounded authoritative combat-event contract emitted by
   the live Solo runtime.

Neither foundation should be overclaimed. The next verified gap is adoption:

1. **Highest player/operational value, medium risk:** connect the normalized
   event contract to battle history, achievements/logbook/mission progress,
   clan/village contribution, balance analytics, dispute support, and
   anti-cheat, then add PvP/Tower adapters.
2. **Medium value, medium-high risk:** implement a Tower AI adapter that
   evaluates the declared ally/add, objective, threat, summon, hold-objective,
   and multi-actor selectors against sealed Tower state.
3. **High design cost, low 100-player-beta value:** general group PvP. Defer
   until population evidence supports another queue.

No new currencies, permanent queues, raid rewrite, or copied reference design
is recommended by this comparison.
