---
type: system-design
project: Shinobi Journey
domain: Clans
feature: Clan meaning and clan war improvements
status: review
canonical: true
owner: Game design / Tyler
validation: mixed
last_reviewed: 2026-10-13
---

# Clans and clan wars improvement plan

This document owns the overall clan improvement plan. Tyler asked to build on the existing foundation, polish it and give it more meaning, then authorized completing and balancing the entire overhaul on October 13, 2026. The baseline is implemented in this worktree. The [clan war overhaul design](clan-war-overhaul-design.md) owns the detailed war rules; the [working state](handoffs/clan-overhaul-work-state.md) records verification and its limits. Nothing has been deployed.

## Confirmed direction and scope

Clans should give members a shared identity, useful contributions, recurring goals and satisfying rivalries. Improve existing membership, Clan Hall, treasury, upgrades, doctrines, mentoring, cooperative bosses and battle modes incrementally.

Tyler accepted ideas 1–10 from the initial discussion, then simplified the war design on October 13: a Clan War page with opposing-clan queues for pet battles, card battles, shinobi 2v2 and shinobi 1v1, plus a randomly appearing golden shrine for bonus fights whose mode is randomly pet, card or combat. Any eligible clan can be declared on. The earlier compound raid, ward capture and AI-defense proposals are no longer the direction.

Idea 11, organizing village-war participation through clans, remains deferred. Existing dependencies must be respected, but adding village-war integration is outside the plan. Reusing the golden shrine's presentation and physical entrance is permitted; village-war scoring and participation rules do not become clan-war rules.

| Accepted direction | Intended player value |
| --- | --- |
| Planned clan campaigns | Clear preparation, conflict and result instead of a prolonged HP grind. |
| Shared golden shrine | A physical bonus battleground with a random shinobi, pet or Chronicle battle mode. |
| Tactical leadership choices | Queue coordination, partner selection, loadouts and preparing for shrine appearances. |
| Coordinated team encounters | Shared ready checks and shinobi 2v2 victories. Pet Showdown remains 1v1. |
| Fair participation | Small clans and members with limited playtime can meaningfully compete. |
| Recurring shared contracts | Members have a reason to cooperate outside wars. |
| Shared projects | Professions, materials and cooperative activity support clan growth. |
| Updated doctrines and war upgrades | Clan identity and investments remain useful under revised scoring. |
| Member assignments | Team organizers, fighters, shrine scouts, quartermasters and mentors receive recognition. |
| Prestige and Clan Hall improvements | Shared goals, open parties, war records and earned identity are easy to see. |

Acceptance is of these directions and Tyler's later explicit corrections, not of every illustrative duration, reward or scoring value. The latest queue-and-shrine design controls where it differs from the initial brainstorm.

## Existing foundation and observed gaps

These are observations of the inherited foundation that motivated the overhaul. Legacy HP wars retain their rules; new campaigns use the implementation below. This is not a claim about the deployed game.

| Foundation | Source evidence | Implication for the plan |
| --- | --- | --- |
| Hall with treasury, upgrades, missions, bosses, territory, notices, mentoring and chat | [Clan Hall](../shinobij.client/src/screens/ClanHall.tsx), [clan types](../shinobij.client/src/types/clan.ts) | Improve orientation and connect existing features around shared goals. |
| Four doctrines and seven upgrade buildings | [doctrines](../shinobij.client/src/lib/clan-doctrines.ts), [upgrades](../shinobij.client/src/lib/clan-upgrades.ts) | Refine identity and repurpose war effects instead of adding a parallel progression tree. |
| Shinobi 1v1/2v2, pet 1v1/2v2 and Chronicle war challenges | [war storage](../api/clan/war/_storage.ts), [2v2 admission](../api/clan/war/_challenge-admission.ts) | Reuse mode-specific battle authorities. Shinobi 2v2 is currently admitted unless its emergency switch disables it; older architecture notes describing permanent retirement are stale. |
| Base war HP of 1,000; 14-day maximum; a seven-day rematch cooldown | [war storage](../api/clan/war/_storage.ts) | Revisit pacing and victory together. Do not merely rename HP as points. |
| An unaccepted pending challenge expires after one hour and applies five HP damage to the defender | [expiry rules](../api/clan/war/_storage.ts) | Replace inbox neglect as a source of war damage with a deliberate participation design. |
| War Room adds starting HP; Warmonger adds another starting HP bonus | [declaration](../api/clan/war/declare.ts), [upgrades](../shinobij.client/src/lib/clan-upgrades.ts) | Existing investments need a meaningful equivalent if HP stops deciding victory. |
| Existing missions recur weekly; several progress values use generic contribution totals or proxies | [mission claim](../api/clan/mission/claim.ts), [mission catalog](../api/clan/_mission-catalog.ts) | Preserve their earned progress while adding a smaller selection with exact verified activity. |
| Cooperative Clan Boss parties already support up to four members | [party contract](../shared/clan-boss-operation.ts) | Use an existing cooperative activity and party foundation in the clan's weekly loop. |
| Clan territory requires ten members, allows one sector and respects village ownership | [territory assignment](../api/clan/territory/_assign-core.ts) | Separate basic clan participation and war access from owning a world sector. Territorial eligibility remains an independent decision. |

## Implemented plan: strengthen the foundation

The completion request authorizes these directions. The baseline below is implemented in this worktree; the working state records the completed checks and remaining player-validation limits.

### 1. Give the existing Clan Hall a clear purpose

The opening view should answer: what are we working toward, where can I help, and what is happening next? Use the existing notices, missions, boss parties and war state to show a shared goal, open activities and the next war phase.

Member assignments sit alongside existing ranks and permissions. A scout or quartermaster assignment describes a contribution; it does not silently grant treasury or leadership authority. Allow members to volunteer and leaders to coordinate. Recognize useful activity beyond kills.

The first recurring selection uses completed scored clan-war matches of any specialty and banked Clan Boss assaults with at least two active clanmates and positive damage. Wipes can still represent useful boss progress. The server reads actual battle/assault records rather than generic contribution proxies. Each contract grants shared Clan XP once per UTC ISO week; existing personal battle payouts remain separate. Members can choose the activity that suits them. Earned verified completion can be claimed while an activity's admission switch is disabled.

The weekly Hall restoration project consumes common gathering materials and caps each member's contribution. Completion grants shared Clan XP; completing four weekly projects earns a lasting Restored Hall decoration. Materials are consumed directly by the project, so treasury gifts cannot circulate them into repeatable progress. There is no personal Clan Point payment for donations and no new currency. Retained payment requests preserve their original week and can finish after departure; definite uncommitted fresh credit failure restores the spent materials. [Shared program rules](../shared/clan-program.ts) own the targets, caps and rewards; [server funding/claims](../api/clan/_program.ts) and its registered debit saga own settlement.

Hall Overview is the default opening tab. It shows the shared goals, activity doors, current campaign, pinned notices, own mentoring status and member assignments. Members volunteer for themselves; existing leadership can coordinate another current member. Assignments confer recognition without granting leadership, treasury or battle permissions. Explicit Exchange and Wars navigation hints remain supported.

### 2. Give clan wars a clear queue and shrine loop

Follow the [clan war overhaul design](clan-war-overhaul-design.md) for declaration, eligibility, preparation, queues, shrine appearances, scoring, defenses and rewards. It identifies Tyler's confirmed mechanics and delegated implementation defaults.

The queues organize real opposing clan members into matches. Shrine fights require physical entry by members of the two clans and use the appearance's randomly selected mode. There are no defended compound objectives, AI copies, objective capture states or offline point sources in the current plan.

Member coordination remains meaningful through ready partners, battle specialties, queue availability and shrine travel. Current automatic clan pet resolution remains the existing battle authority; interactive pet commands would be a separate change.

### 3. Make identity and rewards last

Existing doctrine and building investments remain. War Room grants capped campaign Clan XP growth, Warmonger discounts the declaration fee, and Scout Network grants earlier shrine intelligence. The detailed war design owns those implemented replacements; legacy wars retain their HP treatment.

War summaries explain score, battle specialties, member participation and shrine bonus points. Server-owned rivalry history retains recent campaign instances and MVPs. Quarterly UTC seasons grant three prestige for a played campaign victory and one for a draw; empty and service-canceled campaigns grant none. Three seasonal victories earn a permanent clan crest banner. Current-season and lifetime campaign standings use earned prestige; equal records share a rank. Hall power and roster size do not break competitive ties. [Campaign history](../shared/clan-campaign-history.ts) and [standings](../shared/clan-campaign-standings.ts) own these records and projections.

Completed scored matches grant personal Clan Points after a loss or draw; victories add their own bonus. Clan XP, personal CP and crates settle separately using existing authorities. The detailed war design owns the amounts and frozen eligibility. No new currency is added.

## Resolved implementation baseline

Tyler owns the confirmed direction. The completion request delegates these concrete defaults; they can be tuned after measured playtesting.

| ID | Decision | Implemented starting point | What it affects |
| --- | --- | --- | --- |
| CW-01 | Declaration eligibility | Any eligible clan; seven-day clan age, four eligible level-15 members, 48-hour membership and seven-day activity; three-day recovery and seven-day pair cooldown. | Availability and repeated targeting. |
| CW-02 | Access and battle hosts | War page queues and a physically entered random golden shrine: confirmed. | Reuse of existing interfaces and shrine presentation. |
| CW-03 | Victory and scoring | 100 per singles win, 200 per winning 2v2 team; 20 normal player slots per clan/day, five per member/day. Shrine wins grant 100 with separate limits. | Clan size, activity and specialist value. |
| CW-04 | Schedule | 24-hour preparation, 72-hour conflict; six randomized two-hour shrine windows in twelve-hour blocks. | Member availability and war frequency. |
| CW-05 | Defenses | Live opposing clan members through queues and shrine attendance: confirmed direction. AI defense is excluded. | No points when an opponent does not participate. |
| CW-06 | Scouting | Normal notice 30 minutes; Scout levels 1/15 reveal location/both at 60 minutes; level 30 reveals both at 90 minutes. | Upgrade value and preparation. |
| CL-01 | Contracts and projects | Eight campaign matches → 300 Clan XP; three cooperative boss assaults → 450. Forty common materials/week, ten/member → 500 Clan XP; four projects earn Hall decoration. | Weekly burden, professions and progression. |
| CL-02 | Existing investment and reward treatment | Preserve purchased levels and legacy wars; convert obsolete effects for campaigns; frozen participant rewards survive departure. | Upgrades, doctrines, active wars, currencies and historical rewards. |
| CL-03 | Recognition and seasonal prestige | Voluntary assignments, 24-instance rivalry history, quarterly prestige 3/win and 1/draw, permanent banner after three seasonal wins. | Identity, season cadence and rewards. |

## Boundaries and validation

The Exchange now uses one shared catalog for server authority and storefront copy. New prices improve the value of higher Hall shelves under the existing 1,000-CP weekly earn cap: Chūnin War Chest 350 CP, Honor Seals 650 CP, weapon cache 1,800 CP, armor cache 2,200 CP and Kage's Coffer 1,500 CP; since the 2026-10 economy rebalance the Aura Stone shelves are Kaguya Aura Stones (5 for 400 CP, twice a week) and Kaguya Aura Trove (12 for 900 CP, once a week). Cache rarity selection, the 20% gear-step opportunity, current tier eligibility, Hall gates and purchase limits remain intact. Currency amounts and existing equipment are preserved. Retained paid recovery requests use their original sealed definitions; these prices apply to new purchases. The 500-CP Clan Banner Sigil is a completed permanent crest-frame cosmetic, recorded in the server-owned one-time purchase ledger.

Existing sector and village war owners retain their rules. Do not introduce a second mechanism that changes village sector ownership. Existing stores, territory, save, currency, settlement and battle authorities are dependencies to account for, not systems to rewrite as part of this plan.

Before a behavior change, define what happens to active wars, accepted challenges, spent resources and existing investments. Before recurrent rewards, require verified progress and repeat-safe settlement. Before changing membership during a campaign, define entry, departure, kicks and replacements.

Success should be observable: a new member can find a useful next action; contracts record the activity they advertise; both clans have the same scored-match allowance; personal limits bound repeated activity; every battle specialty has useful score value; and the result explains why the clan won or lost.

This document describes the authorized implementation baseline and source ownership. Final backend tests passed 15,040 cases with 24 database-dependent skips. Builds, lint, assets and the strict combat matrix passed. Desktop/mobile live two-clan journeys, affected realtime field/sector-war journeys and clan/Exchange browser coverage passed. The working state records the full responsive run and isolated rechecks, including screenshot-save failures. Human sessions still need to measure queue population, scheduling, matchup balance and enjoyment; automated checks cannot establish those.

## Working state

- **Goal:** Polish clans and clan wars and give existing systems more meaning.
- **Completed:** Campaign implementation, existing battle-host integration, physical shrine, authoritative rewards and lifecycle, Hall goals/projects/assignments, history/prestige, investment conversion and Exchange balancing/cosmetic delivery.
- **Confirmed decisions:** Build incrementally; focus on clans and clan wars; allow declaration against any eligible clan; use the four requested queues; use a random shrine with a random pet/card/combat mode; defer village-war integration.
- **Source owners:** Detailed war design and linked shared/API/frontend modules; the working state owns exact verification results.
- **Player validation:** Measure queue population, scheduling, matchup balance and enjoyment with real clans; use those observations to tune the documented starting values.
- **Next step:** Review the implemented baseline and its verification record. Deployment is a separate action.

## Review record — 2026-10-13

- **Scope authority:** Tyler's planning request, acceptance of initial directions, and subsequent explicit simplification to queues plus a random golden shrine; village-war integration deferred.
- **Evidence:** Local source, final backend tests, release builds, responsive browser coverage, strict combat checks and authoritative desktop/mobile clan journeys. Exact outcomes and rechecks are recorded in the working state; no deployed-state verification.
- **Review outcome:** Implemented baseline ready for owner review. Pacing and fun require player evidence.
- **Canonical boundary:** This document owns the plan and confirmed planning scope, not current live gameplay rules.
