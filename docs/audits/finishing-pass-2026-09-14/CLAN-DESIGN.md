# Clan truth and future specialization — design only

Audited base: `ecd8d6ccaba017a6791ec0ec94f822c10658984d`. Current executable code takes priority over descriptions in old plans. Nothing proposed below is implemented in this pass.

## Current system inventory

| Current capability | Executable entry/evidence | Audit implication |
|---|---|---|
| Clan Hall, creation, named doctrine, crest, recruitment/browse and join requests | `shinobij.client/src/screens/Clan.tsx`, `api/clans/list.ts`, `api/_clan-save-validate.ts` | Identity already has a home; no additional specialization page is needed. |
| Roster, founder/leadership/officer roles, contribution ordering, role overrides, kick/leave | `api/clan/kick.ts`, `api/clan/leave.ts`, clan save validator | Contributions and authority are distinct; preserve role rules. |
| Notices and clan chat | clan validator; `api/clan/chat/get.ts`, `send.ts` | Existing channels can carry voluntary identity/flavor without a new notification system. |
| Currency and item treasury, donations and leadership gifts | `api/clan/treasury/*`, `api/_treasury-stores-donate.ts` | Real cross-player economy; C5 source-receipt trust and interrupted-transfer recovery matter. |
| Clan Exchange | `api/clan/_exchange.ts`, `exchange/purchase.ts` | Personal Clan Points buy catalog currency/items/caches/War Supply with hall gates and weekly/monthly/one-time limits. C4 affects treasury-credit refunds. |
| Eight weekly missions; clan XP/level, member-scaled mission XP | `api/clan/_mission-catalog.ts`, `mission/claim.ts` | C3 can strand the shared reward while still awarding personal points. Existing activity sources should retain their identity. |
| Hall tiers: Camp 1, Dojo 7, Compound 15, Fortress 25, Citadel 40 | client clan constants/math and Exchange table | Already reinforces long-term shared identity; no new bar needed. |
| Seven upgrade buildings, funded by treasury ryo and War Supply | `api/clan/upgrade/purchase.ts`, client `lib/clan-upgrades.ts` | All cap at 50. Next level costs 2,500×(current+1) ryo and 5×(current+1) War Supply. |
| Territory, guards, scroll allocation, supply collection, reconnaissance | `api/clan/territory/*`, sector/war helpers | Shared world state and its recovery are materially valuable; do not treat collection as a cosmetic interaction. |
| Clan Wars: shinobi 1v1/2v2, card and pet integrations | `api/clan/war/*` | Distinct engines settle into an existing clan conflict; no new engine or combat buff needed. |
| Clan Boss Operations and party assaults | `api/clan-boss/*`, Tower parent orchestration | Existing coordinated support activity; staging certification remains separate from design. |
| Rankings, war standings/history and seal pool | `api/clans/list.ts`, clan war storage, `api/clan/seal-pool/*` | Already supplies public accomplishment and shared reward distribution. |
| Sensei/Student mentorship | `api/clan/mentor.ts` and mentor helpers | Up to 3 students; existing Academy/level 20 / level 40/ranked-win milestones. Do not add a second mentor system or reward another identical event twice. |
| Pet escorts and sanctuary-related custody | `api/clan/pet-escort/*`, `api/pet/sanctuary-transfer.ts`, `api/pet/sanctuary-list.ts` | Existing companion cooperation, with ownership constraints to preserve. |
| Succession, dissolution and membership-mirror cleanup | clan-save/delete paths, leave/kick handlers and clan lifecycle helpers | Historical doctrine/reward state must not leak to a later clan membership. |

## Doctrine truth and upgrade interactions

| Doctrine | Current applied contract | Reinforcing systems / overlaps | What was established |
|---|---|---|---|
| Warmonger | +100 **clan war pool HP**, not player HP/damage | War Room adds 2 HP/level (100 at 50); Scout Network, territory and guards | War declaration seeds each side from its own doctrine and upgrades. Current copy says “when your clan declares”; defender symmetry is intentional in code. No magnitude change. |
| Merchant | +5% village-shop ryo discount for members | Blacksmith 0.2%/level (10% cap); Treasury Vault 0.2%/level (10% War Supply collection); treasury/Exchange | Premium-currency purchase discounts follow their own elder-focus rules; do not extend Merchant to premium generation. Malformed stale mirror differences are not a proven reachable balance bug. |
| Scholars | +5% stat training and mission bonus | Training Grounds 0.2%/level (10% cap), missions, Sensei | Training applies doctrine already. C1: mission server mirror omitted the client's 5%; corrected with behavioral parity tests. Combat-mission ryo and field/hunt stat rules remain distinct. |
| Medics | −5% hospital cost | Medical Wing 0.3%/level (15% cap); healer/support and boss activities | Existing hospital calculation applies it. This is cost, not a shorter hospital timer, extra combat healing, or an automatic support payout. |

Pet Den is independent of these four doctrines: 0.3% pet-training XP/level (15% cap). C2 proves the displayed bonus is absent from sealed training XP; village Pet Yard is also omitted. At a 4-hour base of 400, happiness 100, each of baseline, Den level 50 and Yard level 50 sealed 460 XP. UI shows 0%, 15%, 12.5% respectively. Existing mastery, Loyal, happiness, morale, rounding and sealed old timers prevent guessing a new formula or compensating old sessions without an owner decision.

Scout Network reveals active-war enemy positions at 1, level at 15 and name at 30, only while enemies are outside their village. This is existing strategic information, not a license to expand tracking.

Doctrine name/icon/effect is visible in Clan Hall and creation, and doctrine/crest/pitch provide identity in clan browsing. A visitor can distinguish the chosen doctrine, but the doctrine label does not promise a clan's actual preferred play schedule. The backend permits a founder doctrine change while rejecting non-founder changes; it is inaccurate to call every historical choice absolutely immutable at the server boundary.

## Future proposal

Recommendation: **POST-LAUNCH** for mechanical expansion. Identity-only improvements can be considered later as a separate approved task; none is necessary for this release closeout.

| Identity | Use existing surfaces | Possible non-power option | Approval boundary |
|---|---|---|---|
| Warmonger | Clan crest/notices, war history, existing Scout/War Room context | Voluntary war-history banner and doctrine-themed crest/frame; optional existing-map annotation presets | No extra opponent disclosure, combat stats, capture speed or queue advantage. |
| Merchant | Treasury/Exchange and existing clan notices | Doctrine-themed catalog presentation or cosmetic treasury display; voluntary purchase-planning note in notices | No lower premium cost, extra currency, market, tax loophole or new spend obligation. |
| Scholars | Mission history, Training Grounds, existing mentorship | Optional named clan traditions/mission accomplishment frame; a cosmetic Sensei/student recognition variant | No new XP/stat multiplier, extra milestone grant, faster training or mandatory activity recommendation. |
| Medics | Medical Wing, existing notices and Boss history | Recovery-themed crest/record flavor; cosmetic recognition of support already recorded authoritatively | No extra combat healing, shorter hospital rule, support reward faucet or new support tracker. |

Strategic utility should be optional and attached to existing actions. If a proposed utility changes access, information, cost, timing, or competitive outcome, classify it as mechanical and obtain balance/release approval first. Do not call a numerical advantage “quality of life.” Keep established players free to choose their activity; no reminders, rotating spotlights, tutorials, or daily checklist.

## Legacy fairness for any approved future mechanical launch

1. Publish the exact old/new doctrine contract and affected systems before activation; use existing release notes/Clan Hall copy.
2. Grant each pre-expansion clan one free confirmation/reselection entitlement tied to the expansion version. No premium payment and no automatic default switch.
3. Keep the old contract active until the authorized clan leader voluntarily confirms on the existing doctrine control. Do not interrupt login or force the decision during a war/boss attempt.
4. If switching could affect active competition, apply the newly chosen mechanical contract only at the next safe activity boundary. Seal current war/run effects at start; never rewrite a running match.
5. Record clan, expansion version, old/new doctrine, authorized actor and timestamp; protect the entitlement and chosen contract from client writes; retry is idempotent. Membership changes must not duplicate a clan-level entitlement.
6. Test pre-expansion clans, newly created clans, no doctrine, leader succession, duplicate clicks, concurrent leadership actions, missed response, rollback and forward deployment. Retain the choice history through rollback; never silently charge again.

This is a design requirement, not an implemented migration. If the expansion is solely cosmetic and non-disadvantaging, a mechanics migration may be unnecessary, but the owner must verify that claim explicitly.

## Risks deliberately avoided

No new doctrine powers, currency, building, page, progression bar, marketplace, second mentor system, obligation, combat tuning or global UI change. No compensation is invented for historical missed rewards. Existing costs/caps and doctrine magnitudes are preserved. Recovery fixes must distinguish an uncommitted mutation from a committed mutation whose acknowledgement was lost; a blind refund or replay can make player losses or duplication worse.
