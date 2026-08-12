# Shinobi Journey — Full Game Cohesion and Polish Pass

**Audit date:** 2026-08-10

**Finalized:** 2026-08-11

**Original verification base:** d76a1e7e5d07aab1ac2dce3156e469c9984685c3

**Branch at start:** main

**Original integration base:** 0e1fd8e63d8e65ec8b96dafe0dac857d8e82187a

**Original implementation commit:** 7791631cb6669ce4cd1f1cd4e6acb47771c15793

**PR #53 merge on main:** a452329354f054475405d2bc5b90e9aff952b209

**Prior origin/main tip (recertification parent):** 67f39c7e34f6ba1dc5203468bf22d1b834e9fff2

**Immutable recertification candidate:** 259383f66bb00d14dab2f0097407b23932024396

**Implementation state:** cohesion pass already merged to main; post-Tower generated tooling-handoff drift repaired; immutable candidate fully recertified locally

## 1. Executive summary

This pass audited the current product before changing it, reproduced the highest-impact authority, preservation, recovery, combat-clarity, accessibility, onboarding, and release-evidence defects, and repaired them with focused regressions at the same boundaries. It did not add a currency, remove a mode, weaken a release gate, or represent local evidence as staging or production health.

The initial highest-impact finding was that advertised Supporter benefits were not uniformly authoritative. A normal save or combat path could make lapsed overflow usable, a Base account could upload a custom avatar, custom bloodline storage did not safely enforce the 1/2 active limit, some pet paths trusted incomplete or redacted data, and Patreon relinking was not a sound one-to-one operation. The finished implementation derives benefits from authoritative stored state, preserves paid data non-destructively after lapse, and clamps current use to the exact Base/Supporter values: 12/15 equipped jutsu, 4/6 active carried pets, 1/2 active custom bloodlines, and Supporter-only new custom avatar uploads.

The deeper follow-up found cross-row, lost-acknowledgement, lock-expiry, and mixed-worker gaps in mission combat claims, common Solo PvE item and companion usage, Hollow Gate, Weekly Boss, mission AI fights, bounties, ranked play, Vanguard payouts, and stat training. Those paths now use exact compare-and-set boundaries, durable journals or save-atomic markers, explicit recovery horizons, and fail-closed old/new-worker compatibility where required. Battle Towers received a corresponding server-authority, party, action-idempotency, story-eligibility, tactical-UI, and art pass.

Ordinary Solo combat now translates every canonical action rejection into useful player language, Academy coaching advances only after a server-applied action, and the shared combat layout uses the semantic battle-log component. Daily Briefing and Next Goal consume the same Activity Spine recommendation, the mobile map inspects before travel, ordinary-combat statuses expose meaningful semantics, and high-traffic mobile controls meet the documented touch contract.

Ranked availability is intentionally narrower than ranked implementation:

- The private pet-ranked server engine is implemented behind ENABLE_PET_RANKED_SERVER_V1=1. Public presentation and public direct challenges have separate exact-positive flags and remain disabled by default.
- Player Ranked V2 admissions are implemented but default-off behind ENABLE_PLAYER_RANKED_V2=1. Existing terminal authority can recover while fresh admissions are disabled.
- Generic/casual Vanguard V2 payouts are separately default-off behind ENABLE_VANGUARD_REWARD_V2=1. Exact Player Ranked V2 terminals always require the durable Vanguard protocol.

The requested port was already complete, not stranded or stale: PR #53 merged the cohesion pass to main as a452329354f054475405d2bc5b90e9aff952b209, and the later main tip 67f39c7e34f6ba1dc5203468bf22d1b834e9fff2 descends directly from it. A semantic re-audit of all 15 original overlap paths found no authority or UX regression. Thirteen remained unchanged after the PR merge; server.ts and shinobij.client/src/App.tsx changed only to add Tower PvP routing and authoritative match recovery. The post-Tower pass did expose stale generated design-token handoff data. Refreshing only docs/generated/design-tokens.json produced immutable candidate 259383f66bb00d14dab2f0097407b23932024396. That exact candidate passed the fresh root, client, release, built-Express, cross-browser, combat-layout, Warfront, and live Tower-harness matrix recorded below. External staging, real Postgres restore, Patreon consent, and public ranked promotion remain separate evidence gates.

## 2. Exact base, main publication, and post-Tower recertification

At task start, fetch and comparison established:

    HEAD:        d76a1e7e5d07aab1ac2dce3156e469c9984685c3
    origin/main: d76a1e7e5d07aab1ac2dce3156e469c9984685c3
    branch:      main

During verification, origin/main advanced through:

- d6be53563e8476fddaa594c21af09a195d429485 — Upgrade Hollow Warfront to AAA quality
- 0e1fd8e63d8e65ec8b96dafe0dac857d8e82187a — Stabilize Clan Boss operation certification

The upstream delta changes 115 paths. Fifteen overlap the current working delta:

- api/_storage.ts
- api/arena/lobby.ts
- api/pet/battle-result.ts
- api/pet/warfront-start.ts
- api/player/challenge.ts
- api/save/_first-save-baseline.ts
- api/save/_ownership-golden-master.snapshot.json
- api/save/_state-ownership-parity.test.ts
- api/save/_state-ownership.ts
- api/save/_version-echo-coverage.test.ts
- server.ts
- shinobij.client/src/App.tsx
- shinobij.client/src/components/ArenaCoopLobby.tsx
- shinobij.client/src/screens/Arena.tsx
- shinobij.client/src/screens/PetArena.tsx

Historically, the locked implementation was committed as 7791631cb6669ce4cd1f1cd4e6acb47771c15793 and semantically integrated with 0e1fd8e63d8e65ec8b96dafe0dac857d8e82187a before PR #53 merged the completed result to main as a452329354f054475405d2bc5b90e9aff952b209. The requested implementation therefore did not require another cherry-pick or replay onto 67f39c7e34f6ba1dc5203468bf22d1b834e9fff2.

All 15 original overlap paths were re-audited at 67f39c7e34f6ba1dc5203468bf22d1b834e9fff2. Thirteen are unchanged from a452329354f054475405d2bc5b90e9aff952b209. The two changed overlaps preserve the validated union: server.ts adds four Tower PvP endpoints, while shinobij.client/src/App.tsx restores Tower PvP matches through the existing server-owned battle-lock path. No entitlement, save-ownership, ranked, busy-state, Warfront, combat-authority, or validated UX behavior regressed. Route/import and ownership-manifest entries remain singular rather than duplicated.

The remaining post-Tower defect was tooling-handoff drift in docs/generated/design-tokens.json. Canonical regeneration added the Tower lobby's 430 px breakpoint and refreshed five Tower CSS source-line references without changing runtime code. That repair produced immutable candidate 259383f66bb00d14dab2f0097407b23932024396 directly on 67f39c7e34f6ba1dc5203468bf22d1b834e9fff2.

The repository was already dirty at task start. Modified combat-layout PNG/measurement artifacts under docs/screenshots/combat-layout/after/ and untracked output/ and tools/ trees predated the task. They were neither cleaned nor treated as pass deliverables; the isolated integration worktree prevented them from entering the release commit.

## 3. Current product truth discovered

- Shinobi Journey is a public-beta browser MMORPG; ShinobiX is the repository/backend identity. The audited stack is React 19/Vite, Express/TypeScript, Railway deployment configuration, Supabase/Postgres persistence, and Socket.IO realtime transport.
- Character creation has six explicit stages: welcome, village, bloodline, avatar, preview, and identity.
- The canonical Academy sequence is academyIntro → starter → companionIntro → training → jutsu → jutsuLoadout → inventory → academySpar → cafeteria → firstMission → logbook → sectorReturn → done.
- Starter readiness is four equipped jutsu and two starter gear pieces.
- Rank bands are Academy, Genin at 15, Chunin at 30, Jonin at 50, and Special Jonin at 80. Only the level-20 and level-39 stat-derived progression holds block advancement; later ceremonies are optional prestige.
- Level is derived from the validated stat ledger. Character XP is frozen rollback ballast, not live level authority.
- Daily Briefing and the persistent Next Goal pin consume the same server Activity Spine recommendation. Logbook is an explicit offline/error fallback and permanent checklist, not a second live recommendation authority.
- During Academy onboarding, the compact Next Goal is suppressed and the full Daily Briefing is gated until tutorial completion and level 5.
- Ordinary PvP and Solo PvE share the action-plan/rules boundary. Towers use the common combat rules in an N-actor shell; pet and Chronicle combat intentionally remain separate engines.
- Battle Towers support server-owned 2–4-player ready rooms for live squads, with legacy AI assists represented separately rather than impersonating full members.
- Village/Sector War and Clan Boss are enabled by default unless emergency-disabled. Legacy remains explicitly gated by ENABLE_LEGACY=1.
- Base/Supporter limits are exactly 12/15 equipped jutsu, 4/6 active carried pets, and 1/2 active custom bloodlines. New custom avatar upload is a Supporter benefit.
- Story choice persistence already works in all four village arcs: choices persist, derive traits, reload, and activate meaningful later requireTrait callbacks.
- Pet-ranked private authority, pet-ranked public presentation, pet-ranked public challenges, Player Ranked V2 admissions, and generic Vanguard V2 payouts are distinct rollout decisions. All are default-off unless their exact positive flag is set.
- The production build keeps Three.js, Sentry, and optional-mode code lazy; neither Three.js nor the Sentry SDK is on the healthy startup path.

Canonical product-truth sources include docs/LIVE_PRODUCT_STATUS.md, shared/progression-holds.ts, shinobij.client/src/lib/onboarding-step.ts, api/save/[name].ts, the state-ownership manifest, ranked rollout documents, and the server route/launch-control registration.

## 4. Verified problems

### Supporter and preservation authority

- Base accounts could POST a custom avatar despite the Supporter-only upload promise.
- Mixed-case and punctuation aliases could evade a naive avatar category check or create multiple logical records.
- Generic saves could erase omitted owned pets or reactivate lapsed overflow.
- Realtime exhibition duels trusted client-supplied pet objects, stats, doctrine, and loadouts.
- The public roster removed Patreon before the client derived pet capacity, reducing every remote Supporter projection to four pets.
- PvP could seal 15 stored jutsu for a lapsed account entitled to 12.
- Custom bloodline storage did not faithfully enforce 1/2 active slots and could either reactivate overflow or drop records.
- Patreon relinking was neither atomic nor one-to-one; paid/admin-comp transitions could retain stale source or expiry state.
- Sanctuary retries could leave a legitimate pet indexed but hidden by stale metadata.

### Combat, onboarding, and UI

- Solo PvE showed raw rejection codes.
- Academy spar coaching could advance after a rejected action.
- Ordinary combat emitted plain log rows instead of the semantic battle-log presentation.
- Compact Next Goal, landing, policy, and storage-notice controls missed the 44 px mobile target contract.
- Mobile map markers could commit travel before presenting sector detail.
- Status chips did not consistently expose polarity, source, magnitude, duration, or removal behavior.
- Daily Briefing and Next Goal could disagree because they derived recommendations independently.

### Durable authority and rolling deploys

- Mission combat claim authority had old/new-worker windows around token deletion, payout commitment, post-effects, and successor publication.
- Solo PvE item and companion costs could be separated from terminal reward recovery.
- Weekly Boss start stamina, combat usage, payout, reset, and same-week respawn needed exact instance identity and save/boss acknowledgement ordering.
- Hollow Gate needed exact player/token/run binding, lost-ack readback, stale-owner takeover, and old/new-worker overwrite protection.
- Mission AI-fight daily reward counting needed to coexist safely with the legacy scalar INCR worker.
- Bounty PLACE/CLAIM mutated a board row and a player save without one durable cross-row recovery instruction.
- Pet-ranked and player-ranked flows needed private server outcome authority, exact session mutation, durable terminal journals, season-close fences, and independent rollout controls.
- Vanguard reward receipts could become separated from the winner save write.
- Stat training start passed a proposed record as the expected save-CAS predecessor after the versioned-write contract hardened, so a fresh start could conflict with its own write. Completion replay also used the body token rather than the resolved legacy redemption token, and broad cache deletion could remove a successor lease.

### Product truth and operational contracts

- Live product documentation contained stale commit/date, progression, and launch-state claims.
- Historical proposals could be mistaken for current implementation.
- The ownership manifest claimed generic-save Ryo growth that runtime rejected.
- Analytics inventory and Supporter funnel/failure observations were incomplete.
- Staging integrity, Patreon, restart/realtime, and restore work needed explicit target identity guards so local tooling could not be mistaken for authorization to touch production.

## 5. Rejected false or stale findings

- “Village story choices are not remembered.” Rejected. Persistence and meaningful callbacks already exist in all four arcs.
- “All combat should be consolidated into one engine.” Rejected. Ordinary combat shares rules; Tower, pet, and Chronicle shells have different actor and information models.
- “Jonin and Special Jonin exams block level progress.” Rejected. Only the level-20 and level-39 holds are live.
- “XP is the current level authority.” Rejected. Stats and the validated ledger derive level.
- “Village War, Clan Boss, Chronicle, pets, Towers, or Hollow Gate are prelaunch.” Rejected as stale, subject to eligibility and emergency controls.
- “No mobile combat matrix exists.” Rejected. The current matrix covers phone, tablet, desktop, zoom/DPR, reduced motion, and horizontal overflow.
- “A new story callback must be authored per village.” Rejected. Existing executable callbacks already exceed the acceptance criterion.
- “The private pet-ranked server engine still needs implementing.” Rejected. It is implemented and fail-closed; deployed private certification and public presentation promotion remain incomplete.
- “Player Ranked V2 can be enabled in a mixed d76a worker pool.” Rejected. Old move workers do not understand the exact-CAS close fence; the documented deploy-and-drain stage is mandatory.

## 6. Changes implemented

The task-scoped delta expanded substantially beyond the first Supporter snapshot. Because several agents worked in one already-dirty shared tree, this report does not present a misleading task-only file count. The major areas are:

| Area | Principal files/directories |
|---|---|
| Entitlement/save authority | api/_entitlements*, api/save/[name].ts, save ownership/integrity/budget tests, client entitlement/loadout helpers |
| Patreon, pets, Sanctuary, realtime | api/patreon/*, api/pet/*, pet ladder, roster/challenge entrypoints, realtime pet socket, Pet Yard/Sanctuary/Arena surfaces |
| Mission combat claim saga | api/missions/_combat-claim-authority.ts, claim/queue handlers, mission saga tests, client claim outbox/wiring |
| Common PvE/AI/Weekly/Hollow | api/solo-pve/* authority helpers, Weekly Boss start/usage/payout authority, Hollow v4 settlement authority, AI redemption authority |
| Bounty and storage CAS | api/pvp/_bounty-saga.ts, bounty handler/tests, api/_storage.ts, compare-set migration |
| Ranked and Vanguard | pet-ranked engine/preparation/journal/settlement, player-ranked rollout/session/journal/terminal effects, season recovery, Vanguard V2 |
| Stat training | api/training/start.ts, complete.ts, authority and start/complete CAS tests |
| Battle Towers | api/towers/*, party/entry/action/lease/settlement tests, ready-room/tactical client UI, Tower-only art manifest and pipeline |
| Combat and Academy clarity | Solo rejection presenter, MissionArenaFight, BattleLogLine, combat status semantics, Academy spar wiring |
| Activity/mobile/accessibility | Activity Spine, Next Goal, map inspector, touch regressions, adaptive/Veiled Steel styles |
| Operations and evidence | integrity/Patreon scripts and runbook, staging resilience harness/runbook, backup/restore guards, first-session and realtime built-Express specs |

### Supporter authority and preservation

- Added shared server/client entitlement helpers for exact 12/15, 4/6, and 1/2 policies.
- Enforced entitlements after authoritative stored-state sanitization rather than trusting incoming Patreon flags.
- Preserved dormant jutsu preferences, overflow pets, and overflow bloodlines without allowing current use above entitlement.
- Canonicalized avatar IDs and gated non-grandfathered custom writes to active Supporters.
- Rebuilt Patreon linking around serialized atomic bidirectional ownership and canonical paid/admin-comp state.
- Made realtime pet selections ID-only and reloaded both authoritative rosters at accept.
- Made Sanctuary deposit, withdraw, and release share the pet-battle lease and recover lost save-write acknowledgements.

### Mission, common-mode, and economy authority

- Mission combat claims now progress through exact server-combat, server-combat-paying, and server-combat-spent authority. The no-TTL payment reservation pins the run, reward, and profession-sensitive result before the first payout write.
- combatMissionClaimSettlements is committed in the reward save write. Exact active pointer, binding, terminal session, and save evidence can recover both old-first and new-first worker failures without reopening a paid run.
- Mission post-effects are independently marked and must finish before a successor claim can publish. The client uses a per-account outbox and adopts the authoritative returned save.
- Common Solo PvE companion and item usage uses action-time intents, leases, and dedicated save-atomic receipts. Terminal reward paths repair these costs before paying.
- Weekly Boss uses spawn-bound start, usage, and payout markers. Stamina/item use commits before shared damage is distributable; player credit commits before the boss acknowledges that contributor.
- Hollow Gate v4 preparation binds account, token, binding, run, settlement session, and receipt. Its legacy tripwire makes old v2 workers fail closed; exact save/run CAS and liveness-bounded takeover prevent stale overwrites.
- AI-fight redemption reserves a token-bound UTC-day ordinal against the same scalar used by old workers. Ambiguous counter acknowledgement burns an ordinal rather than risking duplicate ownership.
- Bounty PLACE/CLAIM uses an immutable cross-row journal, a save-atomic bountySagaStamp, and per-target board CAS that preserves unrelated bounties.
- Strict settlement arrays are full-replace fields, preventing positional merge from copying terminal fields into a newly prepended pending marker.

### Ranked and Vanguard authority

- Pet-ranked private authority derives the reciprocal pairing, entitled roster, selected pets, server seed, outcome, ratings, and item effects. An immutable journal and recovery pointers precede both save stamps; client-reported outcome is ignored.
- Pet-ranked public presentation and public direct challenges remain separately default-off. The current public client must not be promoted until the documented replay-safe presentation checklist passes in deployed staging.
- Player Ranked V2 uses an exact season gate, admission, namespaced capability, and session CAS. V2 sessions are deliberately legacy reward-inert with ranked false, baseRewards false, and playerRankedAuthorityVersion 2.
- Player Ranked V2 disables consumables and thrown weapons on server and client and zeroes every authoritative equipped-item key so an old worker also rejects use.
- Its terminal saga confirms empty item effects, both Elo sides, exact Vanguard outcome, bounded session replay TTL, and admission retirement. Move, claim, queue, and season-close traffic help incomplete phases forward.
- The kill switch blocks fresh admission but preserves exact recovery. Existing legacy sessions retain their established drain path.
- Vanguard V2 uses an exact external intent and save-atomic vanguardRewardSettlementStamp. Ranked evidence is retained for 400 days; generic/casual V2 remains separately gated until old workers drain.

### Stat training CAS

- Training start now uses one stable per-request token, the exact predecessor save, and an activeTraining next-record patch.
- Save-version conflicts reread and recompute from the successor with a bounded four-attempt loop. Exact-token readback recovers a committed write with a lost acknowledgement.
- Compatibility token/active caches publish only after the durable save commit and while the save lock is still held; cache failure cannot turn a committed start into an HTTP 500.
- Completion atomically applies the grant, appends the resolved token to _trainingReceipts, and clears activeTraining. Replay/readback includes tokenless legacy sessions through their server-owned redemption marker.
- Token deletion happens only after the durable receipt. Active-cache cleanup compare-replaces only the observed token with a one-second tombstone and cannot delete a successor.

### Battle Towers, UI, and operational safety

- Battle Towers gained server-owned ready rooms, roster/readiness binding, story eligibility, first-clear entry reservation and compensation, battle leases, exact action idempotency/CAS, settlement projection, borrowed-AI privacy, telemetry, and reconnect-safe client state.
- Added a tactical combat presentation, resilient lobby/ready-room UX, and a versioned Tower-only art manifest and key-art pipeline.
- Unified Daily Briefing and Next Goal on Activity Spine, added inspect-before-travel, and made ordinary status controls semantic and keyboard accessible.
- Added target-identity and deny-list guards to staging integrity, Patreon, resilience, and isolated-restore tools. These mechanisms were locally tested; no staging or production mutation was performed.

## 7. Player-facing before/after behavior

| Before | After |
|---|---|
| Solo combat exposed raw rejection codes. | Every canonical rejection has a concise actionable explanation. |
| A rejected Academy action could teach the next step. | Coaching advances only when the server reports applied. |
| Shared combat showed plain log text and opaque statuses. | Semantic logs and accessible status popovers expose category, source, magnitude, duration, and removal behavior. |
| Lapsed paid capacity could remain active or omitted data could disappear. | Ownership/preferences remain stored; current use is clamped to Base capacity. |
| Some pet surfaces disagreed about 4/6 capacity and remote roster eligibility. | Audited combat boundaries consume authoritative active eligibility and safe roster projections. |
| A forged realtime pet could replace stored combat data. | The network carries IDs; the server seals current stored pets at challenge and accept. |
| Mission payout retries crossed token, save, and post-effect gaps. | The exact run-bound saga replays the same payout and completes effects before a successor. |
| Common PvE reward and item/companion charges could recover separately. | Save-atomic usage receipts are repaired before terminal reward. |
| Weekly/Hollow/AI old/new workers could disagree about ownership. | Exact instance journals, CAS, and explicit compatibility rules decide one owner. |
| Bounty board and wallet writes could separate. | An immutable saga plus save stamp repairs either partial order exactly once. |
| Ranked pet logic accepted client-shaped authority or was simply disabled. | A private server engine exists, while public promotion stays truthfully disabled. |
| Player ranked terminal work was not one recoverable transaction. | V2 journals both ratings, items, Vanguard, session TTL, and admission removal; fresh admission is default-off. |
| Training could conflict with its own CAS or delete successor cache state. | Exact predecessor/replay semantics preserve one durable session and one completion grant. |
| Compact controls and mobile travel were easy to misactivate. | High-traffic controls meet the touch contract and map travel requires explicit confirmation. |

## 8. Supporter-entitlement verification

| Benefit | Base | Active Shinobi Supporter | Lapsed behavior |
|---|---:|---:|---|
| Equipped jutsu usable in combat | 12 | 15 | Slots 13–15 remain stored as dormant preferences; combat seals 12. |
| Active carried pets | 3 | 5 | Extra owned pets remain preserved; active combat projection is 3. |
| Active custom bloodlines | 1 | 2 | Overflow records remain stored/read-only and cannot be equipped. |
| New custom avatar upload | No | Yes | Existing/grandfathered image remains readable/removable; no new write. |

Additional verified contracts:

- Patreon is server-owned in the save manifest; normal saves cannot forge it.
- Caps derive from stored state after sanitization.
- Active-pet order is deterministic and equipment-aware.
- Sanctuary is the deliberate promotion/deposit path rather than a destructive migration.
- The public roster exposes only whitelisted eligible-pet fields and never Patreon.
- Avatar aliases canonicalize to one storage key while legacy aliases remain readable/removable.
- Webhook/OAuth refresh requires forward and reverse link agreement; a displaced identity fails closed.
- Strategic Supporter benefits were preserved exactly and were not converted to cosmetics.

Historical entitlement-focused subruns remain useful evidence, but the authoritative frozen-tree aggregate and focused matrices are recorded in section 13.

## 9. Combat verification

- No damage, hit, AP, cooldown, range, scaling, status, or ordinary combat reward formula was rebalanced by this pass.
- Ordinary PvP and Solo PvE continue through their shared action-plan boundary.
- Academy coaching is source-guarded on an applied server result.
- PvP seals only the currently entitled 12/15 jutsu.
- Reward-bearing Solo/PvE companion sealing projects active 4/6 entitlement and rejects breeding, training, expedition, duplicate, unknown, or otherwise busy pets.
- Common item and companion usage must become durable before terminal reward.
- Player Ranked V2 deliberately disables consumables and thrown weapons; this does not change legacy ordinary-PvP item behavior.
- Pet-ranked private resolution uses the server roster, seed, simulation, outcome, and rating deltas. Public gameplay remains disabled.
- Ordinary statuses communicate Buff/Debuff/Control/Shield/Neutral category, source, magnitude/stacks, full or minimum–maximum duration, and Clear/Cleanse/natural-expiry behavior.
- The responsive matrix covers phone, tablet, desktop, zoom/DPR, reduced motion, and horizontal overflow.

## 10. Save and reward-authority verification

| Domain | Current authority | Evidence/result |
|---|---|---|
| Stats and level | Server ledger; level derived | Client level is ignored; validated stats derive stored level. |
| Stat training | Exact save CAS plus _trainingReceipts | Start debit/session and completion grant/receipt are atomic and replayable. |
| Character XP | Frozen compatibility data | Cannot drive live level progression. |
| Ryo and currencies | Generic save may spend/decrease; increases require domain command | Ownership manifest and ratchet tests match runtime. |
| Jutsu mastery | Server training; narrow compatibility while strict cutover is off | Credentialed strict-ledger scan remains external release work. |
| Equipped jutsu | Client-selected, ownership and entitlement bounded | Full preferences persist; active use is 12/15. |
| Mission combat | Run-bound token/payment/receipt/post-effect saga | Old/new-worker, crash, lost-response, and successor ordering are exact. |
| Solo items/companions | Action intent/lease plus save-atomic usage marker | Reward cannot outrun authoritative resource cost. |
| Mission AI fights | Token-bound daily ordinal and save receipt | Mixed legacy/new counters cannot own one predecessor. |
| Weekly Boss | Spawn-bound start, usage, and payout journals | Cost precedes damage; save credit precedes boss acknowledgement. |
| Hollow Gate | V4 exact preparation plus save/run CAS | Lost acknowledgement, orphan takeover, and rolling workers fail safely. |
| Bounties | Immutable cross-row journal plus wallet-atomic stamp | PLACE/CLAIM repair either partial ordering exactly once. |
| Pets | Server-owned progression; active use projected 4/6 | Omitted/stale saves preserve ownership. |
| Sanctuary | Versioned mutation under shared pet-battle lease | Lost writes replay without ownership loss. |
| Pet Warfront | Server-owned match seal and settlement | Seed, hidden outcome, and reward are not client-authored. |
| Pet ranked | Private server engine, immutable journal, two save stamps | Client result is ignored; public surfaces remain off. |
| Player Ranked V2 | Default-off admission/session/terminal saga | Exact CAS, two Elo sides, Vanguard, season fences, and recovery. |
| Vanguard | Exact intent plus save-atomic settlement marker | Ranked retention is 400 days; generic V2 has a separate rollout flag. |
| Battle Towers | Server-bound party, entry, action, lease, and settlement | Lost response and stale actor writes are fenced. |
| Clan Boss | Progress lock plus settled side record | Banking remains exactly-once at the audited boundary. |
| Village/Sector War | Finished server state decides territory | Client reports cannot flip ownership. |
| Chronicle | Server-owned match/AI and payout receipt | Deployed timeout/hidden-information proof remains external. |
| Patreon | Signature/OAuth reconciliation plus atomic bidirectional linking | Normal saves cannot forge benefits; stale mappings fail closed. |

The storage compare-set contract is implemented across local and Postgres-backed paths, with a dedicated Supabase compare-set migration. Strict settlement fields are protected from generic saves and from structural merge contamination.

No functional P0 mint, duplicate settlement, irreversible ownership loss, or entitlement forgery remained reproduced after the completed focused and aggregate gates. The upstream port is complete and on main. This does not claim the strict-ledger cutover or external staging integrations are complete.

## 11. UI, mobile, and accessibility verification

- Veiled Steel remains the design authority; shared Button, ProgressBar, semantic tokens, and combat components were reused.
- Next Goal controls have at least 44 px targets, visible focus, responsive containment, and reduced-motion behavior.
- Mobile sector markers open a focus-safe inspector; only its explicit Travel action commits the request.
- Status chips are native semantic controls with accessible popovers and honest legacy-source fallback.
- Locked Supporter slots are accessible explanation buttons rather than dead text.
- Base/Supporter capacity copy is explicit in jutsu, Arena, Yard, and Sanctuary contexts.
- Pet Yard distinguishes active carried capacity from total preserved ownership and keeps completed overflow work collectible.
- Battle Towers expose authoritative party size, readiness, binding, reconnect, tactical objective, and action state without presenting AI assists as live players.
- Active combat retains the battle-focus shell and suppresses ordinary navigation.
- The original 390×844 manual DOM check reported no horizontal overflow, broken images, or visible sub-44 px target after the entry-path repair. Final automated responsive evidence is in section 13.

## 12. Performance measurements

The size threshold was not raised. An early implementation measured 7,265,371 budgeted bytes, 371 bytes over the ceiling; duplicate and nonessential code/styles were removed instead of weakening the gate.

| Metric | Immutable-candidate measurement | Gate/result |
|---|---:|---|
| Initial JS/CSS raw graph | 1.32 MB across 10 files | Below 1.50 MB — pass |
| Initial graph gzip | 355.2 KB | Below 385.0 KB — pass |
| Budgeted product JS/CSS | 6.83 MB | Below the unchanged gate — pass |
| All emitted JS/CSS | 6.91 MB | Informational; includes lazy Sentry |
| Lazy Sentry vendor | 81.4 KB | Below 100.0 KB — pass |
| Lazy Three.js raw | 1,011.6 KB | Below 1,100.0 KB — pass |
| Lazy Three.js gzip | 266.8 KB | Below 300.0 KB — pass |

The pass added substantial safety and test code without moving the performance gates. Optional-mode asset/code pressure remains a P2 concern.

## 13. Commands run and exact results

These are fresh local results for immutable candidate 259383f66bb00d14dab2f0097407b23932024396, whose parent is prior main tip 67f39c7e34f6ba1dc5203468bf22d1b834e9fff2. Results from the earlier 0e1fd8e63/a45232935 integration are historical evidence and are not silently reused here. “Production build” means the built artifact and does not mean a production deployment was observed.

### Final required gates

| Command | Fresh immutable-candidate result |
|---|---|
| Root npm ci | Pass in 18.0 s: 174 packages installed, 175 audited, 0 vulnerabilities. |
| Client npm ci | Pass in 20.6 s: 319 packages installed, 320 audited, 0 vulnerabilities. |
| npm test | 6,157/6,157 passed, 874 suites, 0 failed/cancelled/skipped/todo; runner 586,387.0856 ms, wall 605.3 s including a clean 18 s client install. |
| npx tsc -p tsconfig.cpanel.json --noEmit --pretty false | Pass in 14.2 s. |
| Client npx tsc -p tsconfig.app.json --noEmit --pretty false | Pass in 49.8 s. |
| Exact CI-environment npm run build | Pass in 104.8 s with CI=1 and the workflow Sentry/release/SHA variables: server/client TypeScript, Vite production build of 2,325 modules, distribution verification, and size gate. |
| Client npm run build | Pass in 58.2 s through the same exact CI-environment client boundary; 2,325 modules. |
| npm run sizecheck | Pass: 6.83 MB budgeted product JS/CSS, 6.91 MB all emitted; initial graph 1.32 MB raw / 355.2 KB gzip; lazy Sentry 81.4 KB and lazy Three.js 1,011.6 KB raw / 266.8 KB gzip remain outside the healthy startup graph. |
| Client npm run lint | Pass in 76.6 s with no diagnostics; only the informational Babel large-file note. |
| npx playwright install chromium firefox webkit | Pass; all three required engines available. |
| Client CI=1 npm run test:e2e | 95 passed, 80 explicitly configured non-applicable cases skipped, 0 failed, no retries reported; 223.5 s command wall (Playwright 3.7 min). |
| Client npm run test:e2e:release-journeys | 2/2 passed in 68.7 s against built Express. |
| Client npm run test:e2e:combat-layout | 12/12 passed in 169.6 s across Solo and PvP on Chromium, DPR 1.25/1.5/2, Firefox, and WebKit. |
| Client CI=1 npm run test:e2e:warfront | 20 passed, 52 intentionally non-applicable DPR/capture cases skipped, 0 failed in 394.5 s against a fresh HTTP Vite server. |
| npm run certify:release | 87/87 passed in 17.8 s against built dist/server.js and isolated in-memory storage. |
| npm run certify:clan-boss-operation | 78/78 passed in 4.7 s against the real Express route graph for 1-, 2-, and 4-player parties plus disabled-party solo compatibility. |
| npm run audit:clan-boss-balance | Pass across 12 deterministic seeds for every 1-, 2-, and 4-player boss/party combination; human pacing remains a staging observation. |
| npm run check:deployment | Pass; checked deployment contract remains valid. |
| npm run check:rollback-readiness | Pass. |
| npm run test:backup | 15/15 passed. This proves helper/guard behavior, not a real database restore. |
| npm run test:mission-eligibility | Pass. |
| npm run test:release-assets | Pass: 65 achievement references, 165 badge PNGs, and 21 Pet Home WebPs verified. |
| npm run check:tooling-handoffs | Pass on 259383f66; generated artifacts are current after the canonical one-file Tower token refresh. |
| npm run soak:smoke | Pass: 24/24 virtual players, 179 calls, 0 errors, 11.1 req/s, health p95 1 ms. Local in-memory responsiveness only. |
| Root/client npm audit --audit-level=high | Both pass with 0 vulnerabilities. |
| git diff --check | Pass for the immutable candidate and the report-only closeout delta; no whitespace errors. |

### Focused authority evidence from the PR #53 campaign

The following standalone focused-run counts are historical PR #53 evidence. Their tests are included again in the fresh 6,157-test root suite, but the standalone matrices were not rerun as separate commands for 259383f66. The counts overlap and must not be summed:

| Focus | Result |
|---|---|
| Frozen ranked server/client matrix | 202/202 server and 22/22 client passed. |
| Ranked adversarial terminal/rollout matrix | 136/136 passed; independent re-audit 85/85 passed. |
| Mission matrix | 221/221 passed, including 34/34 mission claim saga tests; client outbox/wiring 25/25 passed. |
| Common unique authority matrix | 589/589 unique tests passed. A parallel attempt had three shared-environment isolation collisions; the exact three then passed 3/3 in isolation. |
| Common selected matrix | 127/127 passed. |
| Ownership/golden/utils | 72/72 passed. |
| Hollow/save focused set | 14/14 passed. |
| Vanguard authority | 12/12 passed. |
| Training adjacent authority suite | 34/34 passed in 0.504 s. |
| Training dedicated start/complete CAS matrix | 11/11 passed in 0.409 s; server TypeScript and diff check also passed. |
| Integrated Warfront/Arena/ranked authority matrix | 143/143 passed after semantic upstream reconciliation. |
| Integrated cross-worker storage authority | 53/53 passed, including widened war, mission, Tower, clan, ranked, Sanctuary, and progression no-cache boundaries. |
| Integrated Spire identity/parity/balance boundary | 64/64 passed after excluding three incomplete future bosses and retaining the certified four-boss v2 balance. |
| Integrated client recovery/Warfront/entitlement matrix | 70/70 passed; client TypeScript and scoped lint also passed. |

### Attempt accounting

Fresh recertification attempt accounting:

- A sandboxed clean install and the first sandboxed root-suite launch were blocked by Windows `spawn EPERM`; the latter failed all 790 file-worker launches before any assertion ran. The unchanged commands were rerun outside the sandbox, where both clean installs and all 6,157 assertions passed. These environment launch failures are not presented as code failures.
- The first exact-main tooling-handoff check at 67f39c7e failed honestly because Tower CSS changes had left docs/generated/design-tokens.json stale. The canonical exporter changed only that generated file; the resulting immutable candidate 259383f66 passed the drift check and every subsequent gate.
- The first live gut-check used HTTP against Vite's default local-HTTPS mode and received `ERR_EMPTY_RESPONSE`. It was restarted with the same `VITE_SKIP_HTTPS=1` setting as the Warfront browser config. The landing and Tower harness then returned 200 with no framework overlay or page exception; the isolated Tower PvP harness had 48 interactive controls and zero console/resource errors. The client-only landing's expected `/api/player/capabilities` 404 was not represented as built-Express health.
- The fresh Warfront command exited 0 across its 72-test project matrix. Its line-reporter tail was obscured by expected Vite performance/deprecation warnings in captured stdout; project enumeration and the executable skip guards confirm 20 applicable passes and 52 configured skips.

The bullets below describe the original PR #53 integration campaign. They remain useful historical evidence but are not fresh standalone attempts against 259383f66:

- One broad E2E attempt set CI=1 after using a client artifact built without VITE_SENTRY_DSN. Playwright previews static dist and cannot inject Vite build variables afterward, so the CI-only release-Sentry smoke correctly failed. The client was rebuilt with the exact workflow VITE_SENTRY_DSN, VITE_SENTRY_RELEASE, and VITE_BUILD_COMMIT environment; the isolated Sentry smoke then passed 1/1 in 5.3 s, TypeScript and targeted ESLint passed, and the final general matrix passed 95/95 applicable cases.
- The first combined release-journey attempt exposed a test-timing issue around the application’s semantic Notice modal. The harness was strengthened to wait for and dismiss the named alertdialog and to pin server milestones before advancing. The final built-Express release-journey run passed 2/2.
- The first final combat-layout attempt passed all six Solo projects and failed all six PvP projects because the fixture wrote a legacy ownerless session breadcrumb. The application correctly rejected that unsafe cross-account shape. The fixture now uses the canonical authenticated account owner and asserts the restored owner, battle ID, and role; the unchanged product guard then passed the complete 12/12 matrix.
- The first integrated Warfront browser attempt found one test-only race. A Council 1 locator became visible with both RED and BLUE rows, then a redundant second assertion ran after the intentionally ephemeral 4.5-second feed window replaced those rows with Council 2. The test now makes one atomic web-first assertion for both visible Council 1 rows. The focused case passed 1/1 and the fresh-server full matrix passed 20 applicable cases with 52 configured skips and zero failures.
- The first final general browser matrix passed only after retrying the Battle Towers product-truth case. Trace evidence showed healthy navigation followed by a malformed test fixture for `/api/towers/party`: its generic 200 response omitted the required `party` and `invitations` fields, so the asynchronous Ready Room poll tripped the screen boundary. The fixture now returns the exact empty Ready Room envelope. The focused case passed without retry and visibly rendered the Tower lobby; a fresh full matrix then passed 95/95 applicable cases with 80 configured skips, zero failures, and no retries.
- The controlled upstream merge also found and repaired a real Warfront contract mismatch: authorization tokens now seal the bounded Ryo reward required by settlement. End-to-end prepare/authorize/settle tests and the integrated 143-test authority matrix validate that union.
- A parallel common-authority attempt produced three collisions from shared process environment, not functional assertion failures. Running those exact cases in isolation passed 3/3; the unique frozen set passed 589/589.
- Historical aggregates of 5,271, 5,290, 5,316, and 6,031 tests remain intermediate or prior-candidate evidence only. The authoritative fresh root result for 259383f66 is 6,157/6,157.

## 14. Browser flows completed

| Flow | Evidence class | Result | Evidence/limits |
|---|---|---|---|
| Full persisted Academy first session | Local production-built Express, Playwright | Pass | New account, companion, stat training, free jutsu, 4-jutsu loadout, starter gear, tactical spar, healing, trial, Logbook, sector visit/return, hard reloads, mobile inspector, logout, and clean second-session login. |
| Two-account realtime resilience | Local production-built Express, Playwright | Pass | Two independently authenticated Socket.IO accounts became reciprocally visible, moved, lost transport, reconnected, and restored cross-visibility. |
| Release-journey command | Local production-built Express, Playwright | 2/2 passed in 68.7 s | Isolated in-memory storage; no deployed restart or external database. |
| General adaptive/product matrix | Immutable local CI artifact with controlled fixtures | 95 passed / 80 configured skips / 0 failed / no retries reported in 223.5 s | Chromium, Firefox, WebKit, compact/mobile/tablet/desktop, and release smoke. |
| Ordinary combat layout matrix | Local production-built Express, Playwright | 12/12 passed in 169.6 s | Solo and PvP across Chromium/DPR variants, Firefox, and WebKit; evidence regenerated under test-results/combat-layout. |
| Warfront browser matrix | Fresh local CI-mode server, Playwright | 20 passed / 52 configured skips / 0 failed in 394.5 s | Co-op recovery, authored Warfront lifecycle, Council recap, renderer/DPR, mobile controls, accessibility, context-loss, and missing-model fallback. |
| Live landing and Tower PvP harness | Local HTTP Vite, headless Chromium | Pass | Both returned 200 with substantive content and no overlay/page exception. The isolated Tower harness rendered 48 interactive controls with zero console/resource errors; the client-only landing emitted the expected capabilities 404 because Express was not attached. |
| Original manual creator/Academy journey | Historical local built-Express observation | Pass | Completed onboardingStep done, Sector 0 return, four jutsu, starter gear, trial, and sector-visit latch. |
| Base/Supporter/lapsed through real Patreon consent | Not tested | Blocked | Requires disposable deployed accounts and real provider consent/callback. |
| Deployed two-account realtime and worker restart | Not tested | Blocked | The local two-account transport test does not prove replacement-worker recovery. |
| Real isolated database restore and capacity | Not tested | Blocked | Helper tests and in-memory soak are not Postgres restore/capacity proof. |
| Production health or production data | Not tested | Not attempted | No production account, mutation, restart, restore, or health claim was made. |

Evidence taxonomy:

- Local production-built Express proof: dist/server.js with isolated in-memory QA storage.
- Disposable staging proof: a deployed non-production candidate with disposable accounts and target-identity guards.
- Production proof: an explicitly observed production flow.
- Not tested: no inference from unit tests, source inspection, or local harness capability.

## 15. Screenshots and artifact retention

Playwright outputs are ignored and transient. A later default project can clean a preceding project’s directory, so this report does not claim a local artifact remains merely because a test created it.

- npm run test:e2e:combat-layout regenerates its local capture directory.
- CI is configured to upload the combat-layout evidence directory for 14 days, including failed runs.
- General screenshots, traces, live-express output, and playwright-report are diagnostic local artifacts and are not durable release records unless explicitly copied by the release owner.
- The modified public documentation screenshots under docs/screenshots/combat-layout/after/ predated this task and are not claimed as new deliverables.
- The pre-existing output/ and tools/ trees are likewise excluded.

## 16. Closed follow-ups and remaining risks

### Closed on the locked base

- Exact Base/Supporter entitlement and non-destructive lapse behavior.
- Atomic Patreon link ownership and canonical paid/admin-comp refresh.
- Sanctuary/pet-battle mutual exclusion and lost-write replay.
- Shared Activity Spine recommendation and inspect-before-travel.
- Semantic combat status/log presentation and mobile touch targets.
- Mission claim token/payment/save/post-effect recovery plus per-account client outbox.
- Common Solo PvE companion/item cost authority before reward.
- Weekly Boss start/usage/payout authority with spawn identity.
- Hollow v4 exact binding, lost-ack recovery, and mixed-worker fences.
- AI-fight daily ordinal ownership across legacy/new workers.
- Bounty cross-row PLACE/CLAIM saga.
- Private pet-ranked server authority.
- Default-off Player Ranked V2 terminal/season recovery.
- Exact Vanguard terminal reward authority.
- Stat training start/completion exact CAS and successor-safe cache cleanup.
- Battle Towers party, entry, action, settlement, tactical UI, and art contracts.
- Local integrity/Patreon/resilience/restore safety tooling and runbooks.

### Post-main status and remaining release risks

- **Main status:** PR #53 is already merged as a452329354f054475405d2bc5b90e9aff952b209 and is an ancestor of prior origin/main tip 67f39c7e34f6ba1dc5203468bf22d1b834e9fff2. The cohesion pass is not waiting to be ported. Candidate 259383f66bb00d14dab2f0097407b23932024396 is the one-file post-main generated-handoff repair and passed the complete fresh local matrix. Repository CI on the final pushed report closeout remains a separate remote result.
- **Strict-ledger and forged registry:** credentialed staging scans/backfill must complete before STRICT_RAW_SAVE_LEDGER cutover.
- **Patreon deployed proof:** fixture automation does not replace real consent, callback, relink, lapse/reactivation, and restart proof with two disposable identities.
- **Pet-ranked public availability:** private authority is implemented, but public presentation/challenges remain off pending the promotion checklist and deployed evidence.
- **Player-ranked rollout:** every old worker must deploy and drain before generic Vanguard V2 and then Player Ranked V2 admissions are enabled. Do not roll back to d76a while V2 authority remains.
- **Environment proof:** deployed two-account realtime, replacement-worker restart, real isolated restore, measured RPO/RTO, backup freshness, low-population behavior, and Chronicle timing remain untested externally.
- **Training daily cap:** the daily start counter remains a pre-validation attempt reservation. It is bounded and non-economic, but improving that ordering is a P2 follow-up.

## 17. Deferred work ranked P0/P1/P2

### P0

No functional P0 remains reproduced in the semantic post-main audit or the complete immutable-candidate matrix. All fresh local root, client, release, and browser gates passed. Any failure in repository CI on the final pushed closeout remains release-blocking and must not be waived.

### P1

- Run complete credentialed staging integrity scans and required additive backfill.
- Run Patreon staging fixtures plus two-identity real consent/relink/lapse/reactivation/restart proof.
- Certify the private pet-ranked engine in deployed disposable staging; keep both public gates off until presentation/replay requirements pass.
- Execute the documented all-worker drain, generic Vanguard V2 cutover, and Player Ranked V2 admission rollout.
- Run deployed realtime/restart resilience and a real isolated database restore with measured RPO/RTO.
- Complete broader low-population and Chronicle hidden-information/timeout verification.

### P2

- Continue draining optional-mode code/assets without raising size gates.
- Move lower-risk social DM, friend, block, and chat-list read/modify/write keys onto the same cross-worker no-cache or atomic-mutation discipline used by gameplay authority.
- Improve training daily-cap reservation ordering so invalid attempts do not consume a bounded attempt slot.
- Add explicit Player Ranked V2 Seals/XP response copy.
- Let the direct draw-claim path help terminal recovery forward, as move/queue/season already do.
- Isolate a corrupt ranked admission so one row cannot fail-close an entire global sweep.
- Polish the cosmetic draw-role label and add the remaining direct recovery tests.
- Extend built-Express acceptance coverage where it adds a distinct authority boundary.
- Continue Veiled Steel migration on lower-traffic screens.

## 18. Post-main release status

**The cohesion pass is already on main, not stale work awaiting another port.** PR #53 landed as a452329354f054475405d2bc5b90e9aff952b209, and prior main tip 67f39c7e34f6ba1dc5203468bf22d1b834e9fff2 descends directly from it. The 15-overlap semantic audit found no regression in validated authority or UX behavior. The only post-Tower correction was regenerated design-token handoff metadata, captured by immutable candidate 259383f66bb00d14dab2f0097407b23932024396.

**GO for publishing 259383f66bb00d14dab2f0097407b23932024396 as the post-Tower follow-up.** The fresh 6,157-test root suite, root/client types and builds, lint, size, release certifications, deployment/rollback/backup/assets/audits, local soak, four automated browser matrices, and live Tower harness are green. No second cohesion cherry-pick or port is recommended. The report closeout is documentation-only and does not alter the certified runtime tree.

**This is not evidence that external staging or production infrastructure was exercised.** The locally certified post-Tower follow-up is approved for main; enabling default-off public ranked/Vanguard gates, running credentialed repair, or claiming deployed restart/restore/provider health still requires its own operational evidence.

Post-main operational work remains:

1. Confirm repository CI on the final pushed report closeout and verify remote main contains both a452329354f054475405d2bc5b90e9aff952b209 and the generated-handoff repair 259383f66bb00d14dab2f0097407b23932024396.
2. Produce clean credentialed staging integrity/backfill evidence before any strict-ledger cutover.
3. Run Patreon staging fixtures and real two-identity consent/relink/lapse/reactivation/restart evidence.
4. Run deployed realtime/restart and an isolated real-database restore with measured RPO/RTO.
5. Keep pet-ranked public presentation/challenges off until their checklist passes; enable generic Vanguard V2 and Player Ranked V2 only after the documented worker drain.

Local tests validated code paths, safety guards, production-built Express behavior, and isolated in-memory recovery. They did not execute a deployed staging restart, real Postgres/Supabase restore, credentialed data repair, Patreon consent flow, public ranked promotion, or production health check. The new staging tools and runbooks are locally tested mechanisms, not evidence that their external acceptance gates have run.

Engineering decisions deliberately left to the release owner:

- When credentialed backfill is safe and STRICT_RAW_SAVE_LEDGER may be enabled.
- When private pet-ranked evidence is sufficient to fund and promote public presentation.
- When the worker drain permits generic Vanguard V2 and Player Ranked V2 admissions.
- Whether and when Legacy is enabled in production.
- Production rollout, rollback window, monitoring, and evidence-retention ownership.
