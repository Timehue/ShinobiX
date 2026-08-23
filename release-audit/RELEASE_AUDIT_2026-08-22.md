# Shinobi Journey Corrected Behavioral Release Audit

Audit date: 2026-08-22 (America/Chicago)
Base source revision: `92896cead2ef13b63aba496baf569489cd153d63a` plus the audited blocker-fix worktree
Supersedes: the earlier version of this same dated report
Verdict: **GO for the corrected code candidate after both reproduced clan/world blockers were repaired and verified**

## Correction

The first version of this report was wrong in how it classified release risk. It treated intentional pre-launch configuration, test-coverage gaps, stale test wording, future/retired modes, and an older deployed revision as if they were broken player behavior.

Those items are retracted as defects. In particular:

- Human Ranked being disabled before launch is **not a defect**. With `ENABLE_PLAYER_RANKED_V2=1`, the targeted Ranked queue, authority, season, settlement, recovery, and client lifecycle suite passes **73/73**.
- A stale Playwright expectation is a test-maintenance issue unless the underlying player action fails.
- A screen without a dedicated browser test is an audit-coverage gap, not evidence that the screen is broken.
- A production deployment being behind `main` before launch is normal deployment timing, not a product failure.
- An intentionally unavailable future mode is not a launch defect unless it is part of the promised launch scope or traps a player inside a current progression loop.
- Total packaged asset size is not equivalent to first-load transfer size. No performance failure is claimed without runtime measurement.

This corrected audit uses a stricter standard: only a reproducible player failure, unauthorized server state transition, irreversible state corruption, or a launch-scoped flow that fails under its intended configuration can affect the verdict.

## Corrected verdict

The core game is substantially healthier than the first report stated. The cross-browser UI suite passes, core account/save/reward/combat certifications pass, and Human Ranked's launch-enabled authority path passes its targeted suite.

The two clan/world failures that legitimately blocked this candidate are now repaired in the audited worktree:

1. Territory scroll assignment is a server-authoritative, role-gated, idempotent command. Generic world-state writes can no longer change clan control score or ownership.
2. Clan deletion is now an idempotent dissolution workflow that clears every member reference, releases owned territory, and forfeits active clan wars before the clan record disappears.

Both repairs were verified through the actual Express route graph and isolated game storage. Human Ranked's pre-launch flag remains a launch switch, not a code defect.

## Resolved blocker 1: free unauthorized clan territory capture

Severity before repair: **Critical / release blocker**
Evidence: **original failure reproduced; repaired behavior verified through the real Express route graph**
Reproducer: `release-audit/verify-clan-integrity.ts`

### Player story

An ordinary clan member—not the founder, leader, or Elder—belongs to a three-member clan. The clan treasury contains zero Territory Control Scrolls. The member sends the same authenticated territory payload the client ultimately publishes.

### Expected

The server should reject the request because:

- the actor is not allowed to spend clan territory resources;
- the clan has zero Territory Control Scrolls;
- control score should be calculated from an authoritative scroll-spend command, not accepted from the client.

### Original failure

The real API returned HTTP 200 and persisted a full capture:

```json
{
  "ordinaryMember": "auditmember",
  "founder": "auditfounder",
  "clanScrollsBefore": 0,
  "status": 200,
  "ownerClan": "AuditClan",
  "controlScore": 20000,
  "clanScrollItemsAfter": []
}
```

The route correctly checks authentication, village/clan participation, capture roster size, ownership rules, HP deltas, and compare-and-set concurrency. It does not check the actor's clan role, debit scrolls, or derive `controlScore` from a permitted server action.

Relevant paths:

- UI role/resource checks and separate writes: `shinobij.client/src/screens/ClanHall.tsx:644-684`
- Fire-and-forget client world-state persistence: `shinobij.client/src/lib/world-state.ts:1095-1099`
- Server territory acceptance: `api/world-state.ts:1575-1811`

### Original normal-client failure mode

The UI publishes the territory state without awaiting the result, then separately awaits the clan treasury save that removes the scroll. That means a rejected or failed territory request can still consume clan resources while the local cache temporarily shows progress that was never persisted.

### Repair and verified result

The Clan Hall now calls `/api/clan/territory/assign-scrolls`. The command authenticates the actor; requires founder, Leader, or Officer authority; reloads the authoritative clan, treasury, roster, sector, ownership count, and cooldown; derives score and HP server-side; and commits the scroll debit and territory mutation behind ordered locks and compare-and-set writes.

The request carries a stable idempotency key across automatic retry. Its durable receipt can replay or help the operation forward, so a lost response cannot spend a second scroll. The UI keeps the existing 1-scroll and 5-scroll controls, cooldown, cost, and gains, adds only an in-progress guard against accidental double-clicks, and replaces its cache with the authoritative response.

Generic `/api/world-state` requests now reject non-admin changes to `controlScore` or `ownerClan`. The isolated HTTP verifier proves:

- an ordinary member's forged generic request returns 403 and leaves the sector unchanged;
- an ordinary member's scroll command returns 403 and spends nothing;
- a founder's valid command atomically captures at 75,000 control and spends exactly 75 scrolls;
- replaying the exact request returns the stored result and spends nothing further.

## Resolved blocker 2: clan deletion orphans members

Severity before repair: **High / release blocker**
Evidence: **original failure reproduced; repaired behavior verified through the real Express route graph**
Reproducer: `release-audit/verify-clan-integrity.ts`

### Player story

A valid clan founder deletes a three-member clan. Another member has the clan name persisted on their character.

### Expected

Clan dissolution should clear or migrate every member reference and resolve shared clan state before the clan identity disappears.

### Original failure

The delete returned HTTP 200 and removed the clan record, but the other member remained attached to `AuditClan`:

```json
{
  "status": 200,
  "response": { "ok": true },
  "clanRecordAfter": null,
  "ordinaryMemberClanAfter": "AuditClan"
}
```

This matches the current confirmation text: “Other members may need to leave the missing clan manually.” The DELETE handler's reference-detachment work is explicitly skipped for clan records.

Relevant paths:

- Player warning: `shinobij.client/src/screens/ClanHall.tsx:417-443`
- Clan deletion handler: `api/save/[name].ts:3113-3201`
- Detachment skipped for clan records: `api/save/[name].ts:3184-3193`

### Repair and verified result

Clan deletion now runs a server-owned, idempotent dissolution saga. It releases every sector owned by the clan without adding a destruction cooldown, finalizes active clan wars as a dissolution forfeit, deletes the exact clan generation, and clears every roster member's clan pointer and clan-derived fields. The founder is detached last so an interrupted operation remains safely retryable.

The outer deletion fence now remains valid for up to 120 seconds for clan records only, covering the full member/territory/war scan even for a large clan. Ordinary character deletion keeps its existing lock timing, so this correctness fence adds no normal player delay or extra interaction.

Character fields are explicitly written as JSON `null` where the partial-save merger requires a tombstone; omitted keys can no longer be resurrected from an older save. The same explicit clearing was applied to the ordinary clan-kick path.

The isolated HTTP verifier proves that deleting a three-member clan returns 200, removes all three persisted clan references, releases its territory for immediate recapture, and ends its active war with the opponent recorded as winner. The confirmation copy now tells the founder exactly what will happen; the action itself was not disabled or made more cumbersome.

## Ranked PvP: corrected result

Human Ranked is **not a blocker**.

The flag being off in a pre-launch environment is expected. The intended enabled path was checked with:

```text
ENABLE_PLAYER_RANKED_V2=1
```

Targeted result: **73 tests passed, 0 failed** across:

- queue level-band matchmaking;
- exact match proof and session binding;
- client queue lifecycle and owner fencing;
- durable challenge wiring;
- Elo/terminal journal settlement;
- duplicate and crash recovery;
- season close, drain, rewards, reset, and reopen;
- legacy-to-v2 recovery;
- kill-switch behavior;
- enabled POST/UI/runbook contract.

Launch treatment: keep Ranked in the launch checklist—enable the intended environment flag, verify the season gate is open, and run a two-account smoke—but do not list “disabled before launch” as a defect.

## Conditional product-scope observations—not defects

These are recorded so they can be compared against the actual launch feature list. They do not affect the verdict without an owner decision that they are launch content.

| Surface | Executable behavior | Classification |
| --- | --- | --- |
| Live Pet Ranked queue | Endpoint is deliberately retired/fail-closed with HTTP 410. | Intentional retired path, not automatically a defect. |
| Pet Ladder Colosseum | Defense/standings render; async Challenge CTA exists only in Tactical because comments assign Colosseum challenges to the retired live queue. | Potential current-loop dead end **only if Colosseum ladder challenges are promised at launch**. Owner scope decision required. |
| Clan War shinobi 2v2 | UI explicitly says no four-player authority exists and the mode cannot launch. | Future/unavailable mode; not a defect unless included in launch scope. |
| Standalone Tactical Arena | Runtime registry records a surface gap; Tactical pet ladder/Warfront-family behavior exists. | Naming/scope question, not a proven failure. |
| Clan Banner Sigil | Locked and labeled Coming Soon. | Intentional roadmap content, not a defect. |

## Screen-by-screen corrected audit

Status meanings:

- **Rendered pass**: directly audited in the 327-test cross-browser suite for content, artwork, clipping, control sizing, runtime errors, and/or route interaction.
- **Journey/contract pass**: underlying flow or engine has behavioral evidence; the exact screen lacks the complete visual walk.
- **Coverage gap only**: no dedicated screen walk found. This is explicitly **not** a product failure.
- **Resolved defect**: a reproduced player/server failure repaired and verified in this candidate.
- **Scope decision**: executable state is known, but whether it is a launch defect depends on the promised launch scope.

| # | Screen | Corrected status | Result |
| ---: | --- | --- | --- |
| 1 | `start` | Rendered pass | Landing, sign-in, creator, mobile and desktop smoke pass. |
| 2 | `adminLogin` | Coverage gap only | No credentialed browser walk; no failure claimed. |
| 3 | `adminPanel` | Coverage gap only | Server security contracts exist; no UI failure claimed. |
| 4 | `professionPicker` | Journey/contract pass | Onboarding flow evidence; no direct screen audit. |
| 5 | `professions` | Rendered pass | Direct UI audit passed. |
| 6 | `village` | Rendered pass | Direct/adaptive audit passed. |
| 7 | `profile` | Rendered pass | Direct/adaptive audit passed. |
| 8 | `inventory` | Rendered pass | UI and artwork checks passed. |
| 9 | `logbook` | Rendered pass | Direct UI/navigation audit passed. |
| 10 | `training` | Rendered pass | Direct UI audit passed. |
| 11 | `jutsuTraining` | Rendered pass | Direct UI audit passed. |
| 12 | `missions` | Rendered pass | UI, eligibility, and reward contracts pass. |
| 13 | `arena` | Coverage gap only | Legacy surface not directly walked; no failure claimed. |
| 14 | `battleArena` | Journey/contract pass | Authenticated Arena/PvP coverage passes. |
| 15 | `battleLog` | Coverage gap only | Contracts exist; no direct screen walk. |
| 16 | `arenaDistrict` | Rendered pass | Route renders; launch-enabled Ranked authority tests pass 73/73. |
| 17 | `bloodlineMaker` | Rendered pass | Direct UI audit passed. |
| 18 | `clan` | Rendered/behavior pass | Rendering passes; authoritative territory assignment and complete dissolution pass through the real server. |
| 19 | `worldMap` | Rendered pass | Direct/adaptive audit passed. Old wording assertion was test drift, not a game failure. |
| 20 | `townHall` | Rendered pass | Direct UI audit passed. |
| 21 | `bank` | Rendered pass | Direct UI audit passed. |
| 22 | `shop` | Rendered pass | Direct UI audit passed. |
| 23 | `grandMarketplace` | Rendered pass | Direct UI audit passed. |
| 24 | `hospital` | Rendered pass | Direct UI audit passed. |
| 25 | `cafeteria` | Rendered pass | UI audit and onboarding journey evidence pass. |
| 26 | `storyHall` | Rendered pass | UI and story asset checks pass. |
| 27 | `storyBoss` | Journey/contract pass | Authoritative Solo PvE/story combat passes. |
| 28 | `sunscarFestival` | Rendered pass | Direct UI audit passed. |
| 29 | `centralHub` | Rendered pass | Hub, central modals, and modal route exits pass. |
| 30 | `petArena` | Rendered pass | Entry/route renders and pet battle contracts exist. |
| 31 | `petShowdown` | Journey/contract pass | Showdown/combat engine coverage passes. |
| 32 | `petColiseum` | Coverage gap only | No full direct screen walk; no failure claimed. |
| 33 | `petLadder` | Scope decision | Screen renders. Colosseum challenge availability must match owner-defined launch scope. |
| 34 | `home` | Rendered pass | Pet Home visual/browser suite passes. |
| 35 | `pets` | Rendered pass | Direct UI/artwork coverage passes. |
| 36 | `shinobiTiles` | Rendered pass | Direct UI audit passed. |
| 37 | `eventPetBattle` | Coverage gap only | No direct screen walk; no failure claimed. |
| 38 | `eventTiles` | Coverage gap only | No direct screen walk; no failure claimed. |
| 39 | `dungeon` | Coverage gap only | Central dungeon modal renders; gameplay screen not walked. |
| 40 | `hunting` | Rendered pass | Direct UI audit passed. |
| 41 | `tavern` | Rendered pass | Direct UI audit passed. |
| 42 | `hallOfLegends` | Rendered pass | Direct UI audit passed under intended enabled configuration. |
| 43 | `shinobiCouncil` | Rendered pass | Direct UI audit passed. |
| 44 | `userHub` | Rendered pass | Authenticated navigation audit passed. |
| 45 | `userView` | Rendered pass | Authenticated profile-view audit passed. |
| 46 | `pvpBattle` | Journey/contract pass | Two-account authoritative lifecycle and combat layouts pass. |
| 47 | `hollowGateShrine` | Coverage gap only | Contracts exist; no direct complete screen walk. |
| 48 | `hollowGateTiles` | Coverage gap only | No direct complete screen walk. |
| 49 | `endlessTower` | Rendered pass | Modal transition and post-navigation interactivity pass. |
| 50 | `battleTowers` | Rendered pass | Route/navigation checks pass. |
| 51 | `weeklyBoss` | Rendered pass | Direct route/UI audit and contracts pass. |
| 52 | `villageWar` | Journey/contract pass | Warfront/system E2E passes. |
| 53 | `villageWarMap` | Journey/contract pass | Adaptive/Warfront coverage passes. |
| 54 | `tilecardsDuel` | Coverage gap only | Engine/contracts exist; no full screen walk. |
| 55 | `sectorCard` | Coverage gap only | No direct screen walk; no failure claimed. |
| 56 | `sectorPet` | Coverage gap only | Server contracts exist; no direct screen walk. |
| 57 | `sectorGarrison` | Journey/contract pass | Runtime authority registry marks it matched. |
| 58 | `clanWarPet` | Journey/contract pass | Server-owned pet modes have contract evidence; 2v2 scope remains owner-defined. |
| 59 | `cardClashFreePlay` | Coverage gap only | No direct screen walk; no failure claimed. |
| 60 | `guides` | Rendered pass | Direct UI audit passed. |
| 61 | `messages` | Rendered pass | Direct UI audit passed. |

## System-by-system corrected audit

| System | Corrected result | Evidence |
| --- | --- | --- |
| Registration and authentication | Pass | Real Express certification covers registration, token auth, and relogin. |
| Character creation/onboarding | Pass with stale-test maintenance | UI flow works through late onboarding; wording changed in one test. No product failure reproduced. |
| Save, refresh, concurrency | Pass in certified server environment | Clamp, save versioning, refresh, relogin, stale-write rejection, and public projection pass. |
| Wallet/rewards/progression | Pass | Forgery, reward persistence, idempotency, and authoritative Territory Control Scroll spending pass. |
| Solo PvE/story/missions | Pass | Server-owned combat and settlement certification pass. |
| Human PvP | Pass under intended launch flag | Unranked/two-account lifecycle passes; Ranked targeted suite passes 73/73 with enable flag. |
| Combat UI | Pass | Cross-browser desktop/mobile combat layout evidence passes. |
| Pets/breeding/collection | Pass core | Pet Home passes; deterministic breeding audit passes 1,000,000 rolls. |
| Pet competitive modes | Scope decision | Current executable behavior must be compared with the owner's launch list. No automatic blocker assigned. |
| Clans | Pass for the reproduced blockers | Role-gated territory spending and full member/war/territory dissolution pass through the real server. |
| Clan Boss | Pass in isolated server | 78/78 operation checks pass across solo and 1/2/4-player flows. |
| Clan War | Pass for certified modes; scope decision for unavailable 2v2 | No blanket failure assigned. |
| Territory/world ownership | Pass for the reproduced blocker | Generic forgery is rejected; the dedicated command derives and persists ownership while spending exactly once. |
| Village War/Warfront | Pass locally | Browser/system contracts pass. Real infrastructure capacity is an operations question, not a discovered game failure. |
| Marketplace/bank/shop/crafting | Render/contract pass | No end-to-end product failure reproduced. |
| Profiles/messages/presence | Render/contract pass | No end-to-end product failure reproduced. |
| Admin/moderation | Coverage gap only | No defect claimed without a credentialed walk. |
| Content/assets | Pass release gates | Achievement, badge, Pet Home, and story content checks pass. |
| Build/security/deployment | Pass candidate gates | Latest candidate CI and dependency/security gates pass. |
| Performance | Unmeasured on low-end production conditions | No failure claimed from package size alone. |
| Production operations | Separate launch-readiness work | Restore, alert, capacity, and rollback evidence should be handled in the launch runbook, not presented as game defects. |

## Evidence summary

| Check | Result |
| --- | --- |
| Full cross-browser UI suite | 340-test matrix completed across Chromium, Firefox, WebKit, desktop, compact, mobile, and tablet profiles: **220 passed, 120 intentionally skipped, 0 remaining failures**. Two stale Mission Hall rank-order assertions failed against the intended D-to-S progression, were corrected by the owning task, and passed on exact desktop/mobile rerun. Clan Hall rendered on both tested sizes. |
| Strict combat-layout gate | **20 passed, 10 intentionally skipped** with `COMBAT_LAYOUT_CAPTURE_PHASE=after` and `COMBAT_LAYOUT_STRICT=1`, including WebKit. |
| Complete server/domain/client contract suite | **7,313/7,313 passed**, including the new clan founder fence, unique-roster, and dissolution-lock contract tests. |
| Focused Clan Hall browser journey | **2/2 passed** on desktop and mobile Chromium: rejection rollback, authoritative success, rapid-repeat deduplication, accurate delete confirmation, cancel safety, single DELETE submission, first-visit tip dismissal, and mobile navigation clearance. |
| Late shared-worktree Story/Card Hall check | **13/13 focused tests passed** on the initial move, then the updated branch-aware Story archive passed **8/8** contracts; all affected source/test files passed focused lint before final handoff. |
| Late Inventory integration check | Repaired a missing imported stylesheet and a reproduced 390px category-filter overflow. **25/25 focused inventory/artwork/settlement tests passed**, focused lint passed, and the exact responsive long-content browser journey passed after the fix. |
| Final production build | Pass: server compile, story-content check, 2,622-module client build, distribution verification, and size budget. |
| Client lint | Pass. |
| Ranked launch-enabled targeted suite | **73/73 passed**. |
| Real Express release certification | **90/90 passed**. |
| Clan Boss operation certification | **78/78 passed**. |
| Pet breeding deterministic audit | **1,000,000 rolls passed**. |
| Backup tests | **16/16 passed**. |
| Current size/build gate | Pass. No runtime performance failure inferred from it. |
| Clan integrity verifier | Forged territory writes rejected; valid assignment and exact replay spend once; dissolution clears 3/3 members, territory, and active war state. Independent preview check returned HTTP 200 with populated root content, no error overlay, no runtime errors, and no failed responses. |

## Actual release exit criteria

The two product blockers established by this audit are satisfied in the corrected candidate:

1. **Satisfied:** clan territory control and Territory Control Scroll spending now use one server-authoritative, idempotent operation with adversarial and replay coverage.
2. **Satisfied:** clan dissolution now clears member references and resolves owned territory and active wars without removing the player-facing action.

Standard launch checklist, not defect remediation:

3. Enable Human Ranked using the intended launch configuration and run a two-account post-deploy smoke.
4. Confirm the owner-defined launch feature list for Pet Ranked/Colosseum, Clan War 2v2, and standalone Tactical, then make navigation/copy match that scope.
5. Deploy one chosen candidate and perform ordinary post-deploy smoke, backup, alert, and rollback checks.

## Final decision

The corrected code candidate is **GO with respect to every product blocker established by this audit**. The territory exploit and clan-orphaning failure are fixed and verified without disabling the features or adding a punitive player step.

Human Ranked being disabled before launch remains a deployment setting, not part of the defect decision. The standard post-deploy smoke and owner-defined feature-scope decisions still belong in the launch checklist.

## Audit boundaries

- No production data was mutated.
- Clan findings were reproduced on the real Express route graph using isolated in-memory storage and valid player tokens.
- Intentional pre-launch flags and future/retired content are not classified as defects.
- Browser coverage gaps are reported only as coverage gaps.
- Infrastructure readiness is separated from broken game behavior.
