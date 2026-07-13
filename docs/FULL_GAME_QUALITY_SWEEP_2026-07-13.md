# ShinobiX full-game quality sweep

Date: 2026-07-13

Branch: `codex/gamesweep`

Scope: repository-wide architecture, gameplay transaction, UI/UX, accessibility, mobile, loading, API, realtime, security, maintainability, and regression review.

## 1. Executive summary

ShinobiX is a large, actively developed browser MMO with substantially stronger server-authority and regression coverage than its component size initially suggests. The repository has 3,065 passing unit/integration tests, server-side save locks and settlement receipts on the high-risk paths sampled, production bundle budgets, route-level lazy loading, authenticated realtime presence, and explicit launch-load gates. No new verified Priority 0 issue was found in this sweep. Several severe items described by the older July 6 audit are no longer current: AI fight rewards, mission progress, weekly-boss attempts, treasury mutations, and Hollow Gate settlement now have server-side gates or receipts.

The safest valuable fixes were concentrated in permanent-action safety and modal accessibility. Town Hall upgrades, Hollow Gate opening/extension, Hollow Gate key forging, clan exchange purchases, clan deletion, shop purchases, bank transfers/interest, profile purchases, training speed-ups, pet evolution, clan/village treasury actions, guard queue changes, festival spends, and clan battle actions now have stronger duplicate-submission and ambiguous-response handling. Clan document changes are displayed only after persistence succeeds, and guard status changes only after the server accepts them. The one-off Hollow Gate, clan exchange, shop item, and Wandering Sage overlays now use the canonical modal. The global themed alert/confirm system now traps focus and restores it on close; a cross-browser test also exposed and fixed an existing Escape-key dismissal bug. Clan benefits also stop immediately when active membership is cleared, even if an older save still contains a stale upgrade/doctrine snapshot.

The game is safer, clearer, and more polished after these changes without retuning any cost, reward, progression, cooldown, combat, or content value; the only benefit-eligibility change removes stale clan perks from clanless characters. It is not yet possible to call the whole game unrestricted-launch ready. The principal approval-required risks are the intentionally single-instance realtime architecture, the absence of disposable authenticated end-to-end/load evidence for the complete player journey, and clan-wide deletion policy. Cold boot and first-use 3D asset cost are also material, measured bottlenecks.

### Audit boundary

This was a source/static review, full automated regression run, production build audit, public landing/creator browser journey, and focused interaction verification. It was not a production penetration test and did not use real player data. No disposable authenticated staging credentials or database were supplied, so DB-backed registration, login, save restoration, combat settlement, clan boss rewards, admin mutations, presence reconnect under load, and multi-tab account races were not exercised through a real browser. Those are listed as launch-gate evidence, not silently treated as passing.

## 2. Change log

| Area | Problem | Root cause | Fix | Files | Validation | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| Global alerts and confirmations | Keyboard focus could leave a dialog, focus was not restored, and Escape failed while the alert OK button was focused. | The portal dialogs managed dismissal but had no focus lifecycle; the OK key handler also swallowed Escape. | Added a small shared focus trap with first-focus fallback and focus restoration; allowed Escape to reach the alert dismissal handler. | `shinobij.client/src/components/GameAlert.tsx` | Type-check, lint, production build, new Playwright focus/Escape test across configured viewports/browsers. | Low |
| Hollow Gate attunement | A custom overlay did not inherit canonical modal behavior; forging could queue duplicate confirmations; failure feedback and disabled-state explanations were weak. | One-off overlay and a mutation guard that began too late for rapid clicks. | Migrated to `Modal`; added a synchronous ref guard before confirmation, exact-cost/non-refundable confirmation, busy state, network/server error feedback, live status, explicit button types, and “Need X shards” labels. | `shinobij.client/src/components/HollowGateAttunement.tsx` | Settlement-gate regression test, type-check, lint, full suite, production build. | Low–medium; transaction path unchanged |
| Town Hall permanent actions | Permanent village upgrades and Hollow Gate time purchases did not state the full consequence and could open more than one prompt under rapid clicks. | No shared busy guard around the confirm-to-request interval. | Added one synchronous Town Hall mutation guard, exact before/after level and cost text, permanence/no-refund language, busy labels, disabled actions, and recoverable network feedback. | `shinobij.client/src/screens/TownHall.tsx` | Type-check, lint, full suite, production build. | Low–medium; formulas and API payloads unchanged |
| Clan/village persistence and guard queue | Clan Hall could display an unpersisted clan document, recruitment could announce success after a failed save, and guard queue requests swallowed network/HTTP failures before changing local status. | Optimistic local adoption and a fetch wrapper that discarded failures. | Made clan document saves write-first and serialized, made success feedback conditional, surfaced guard failures, and adopted guard state only after an accepted response. | `shinobij.client/src/lib/clan-api.ts`, `shinobij.client/src/screens/ClanHall.tsx`, `shinobij.client/src/screens/TownHall.tsx` | Eight focused safety regressions, type-check, lint, production build, Playwright matrix. | Low; queue and clan rules unchanged |
| Resource-spending interactions | Several bank, shop, profile, training, pet, festival, hospital, clan/village treasury, and clan-war actions relied only on React state, leaving a same-render double activation window. Some ambiguous network failures invited a blind retry. | State updates are asynchronous and economy wrappers had generic retry wording. | Added synchronous in-flight guards around the highest-value sampled actions, guaranteed guard cleanup, retained server-authoritative returned state, and changed lost-response guidance to require refresh/verification before retry. | `shinobij.client/src/components/Shop.tsx`, `shinobij.client/src/screens/{Bank,ClanBattlesTab,ClanHall,ClanSealPool,Hospital,PetYard,Profile,SunscarFestival,TownHall,Training}.tsx`, `shinobij.client/src/lib/{black-market,card-pack,player-api,player-trade,profile-settlement,sunscar-festival}.ts` | Eight focused safety regressions, type-check, lint, production build, Playwright matrix. | Low; costs, rewards, caps, and API payloads unchanged |
| Shop and Wandering Sage dialogs | Shop item details and the permanent Legacy offer used one-off portals without the canonical focus/scroll/restore lifecycle. The Legacy choice guard began after confirmation. | Local overlays and state-only in-flight handling. | Migrated both to `Modal`, prevented closing while settlement is in flight, and acquired the permanent-choice guard before confirmation. Legacy decline now closes only after a verified response. | `shinobij.client/src/components/Shop.tsx`, `shinobij.client/src/components/SageOfferModal.tsx` | Focus/mutation source regressions, type-check, lint, Playwright matrix. | Low; presentation and interaction lifecycle only |
| Clan Exchange purchases | A rapid double activation could send two valid purchases before React rendered the disabled state; custom confirmation/reveal portals lacked shared focus, Escape, scroll-lock, and focus-restoration behavior. Ambiguous request failures encouraged an unsafe blind retry. | The in-flight guard was state-only and began in a render cycle; the dialogs predated the canonical primitive. | Added a synchronous ref guard before the request, locked closing while settlement is in flight, migrated both dialogs to `Modal`/`CloseButton`, and changed ambiguous failures to require a character refresh before retry. | `shinobij.client/src/components/ClanExchange.tsx`, `shinobij.client/src/lib/player-api.ts` | Focus/mutation source regression, type-check, lint, full suite, production build. | Low; costs, rewards, limits, and endpoint behavior unchanged |
| Clan deletion | The client cleared local clan state even after a rejected DELETE or network failure, and the action had no rapid-activation guard. | The response was discarded with an empty catch before the optimistic local write. | Added a synchronous guard, disabled/busy state, verified HTTP plus `{ ok: true }` before local adoption, honest ambiguous-response guidance, and clearer confirmation of exactly which shared data is destroyed. | `shinobij.client/src/screens/ClanHall.tsx` | Mutation-order regression, type-check, lint, full suite, production build. | Low; server delete semantics unchanged |
| Clan benefit cleanup | Former or kicked members could retain upgrade and doctrine bonuses from stale character snapshots after `character.clan` was cleared. | Benefit helpers trusted the snapshot without checking active membership; leave/delete/kick did not consistently remove cached fields. | Gated every clan-derived client bonus on active membership and cleared cached upgrade/doctrine fields on leave, founder deletion, and server-authoritative kick. | `shinobij.client/src/lib/village-upgrades.ts`, `shinobij.client/src/screens/ClanHall.tsx`, `api/clan/kick.ts` | New membership-benefit regression tests, kick regression, type-check, lint, full suite, production build. | Low; intended values for active members unchanged |
| Release smoke tests | Modal focus behavior could regress; a local build without Sentry configuration produced a misleading smoke failure. | No interaction-level focus assertion; Sentry assertion assumed every local bundle was built with a DSN. | Added focus-trap/focus-restore/Escape coverage. Local non-CI Sentry assertion now skips only when the emitted bundle proves Sentry was not configured; CI still must exercise the enabled path. | `shinobij.client/e2e/release-smoke.spec.ts` | Playwright configured matrix. | Low; CI coverage is not weakened |
| Build reproducibility | A server source comment inside a parameter list made TypeScript emit a whitespace-only tracked `dist` change. | Comment placement affected emitted formatting. | Moved the comment above the function while preserving behavior. | `api/missions/_progress.ts`, generated `dist/api/missions/_progress.js` | Server type-check, root production build, `verify:dist`, `git diff --check`. | Trivial |
| Production artifacts | Source changes require matching hashed client output because this repository tracks `dist`. | Vite content hashing. | Regenerated server/client production artifacts with the normal root build and no placeholder production credentials. | `shinobij.client/dist/**`, `dist/**` | Root build, dist verification, size budget. | Generated output |

No costs, reward values, progression curves, cooldowns, combat formulas, or active-member clan benefits were changed.

## 3. Prioritized unresolved findings

### P1 — Clan territory capture is not one authoritative transaction

- **Area:** Territory ownership, clan scroll economy, role enforcement, cross-store consistency.
- **Reproduction:** `ClanHall.donateTerritoryScrolls` writes a complete territory snapshot through `saveSectorTerritory` and separately saves the clan document with one fewer Territory Control Scroll. The territory POST is fire-and-forget. The `/api/world-state` participant gate verifies identity, ownership involvement, HP deltas, and minimum clan size, but it does not atomically verify/consume the scroll, enforce the client-side leader/elder rule, or enforce the client-side one-sector cap.
- **Expected:** One authenticated server command validates role, scroll balance, member threshold, sector state, ownership cap, and cooldown under locks, then commits both the territory and clan treasury once or not at all.
- **Actual:** The two writes can split on rejection/network loss, and a crafted client can bypass several client-only preconditions. This sweep did not move those rules server-side because the intended capture authority, refund behavior, and migration of existing territory state require product approval.
- **Likely cause:** Territory state began as shared snapshot persistence while the clan treasury later became server-authoritative; capture still bridges the two models in the client.
- **Recommended fix:** Add an idempotent `/api/clan/territory/claim` settlement endpoint with per-clan/per-sector locks and a receipt/request token. Recompute every requirement from saved clan and canonical sector state, consume the scroll and write ownership atomically (or use a recoverable transaction/outbox), return both authoritative records, and make generic world-state writes reject ownership/control changes from ordinary clients.
- **Complexity:** High; cross-key failure recovery, existing claims, and world-state writer compatibility need migration tests.
- **Design input required:** Yes — eligible roles, one-sector policy, failed-write/refund semantics, and existing-territory migration.

### P1 — Clan deletion is not an atomic clan-wide dissolution

- **Area:** Permanent clan data, cross-save consistency, ownership/name recovery.
- **Reproduction:** The founder UI deletes `/api/save/clan-*`. The generic DELETE handler removes only the shared clan record. Other members' character saves retain `clan`, and the missing-clan UI offers every stale member a `Reclaim` action that can recreate the name with themselves as founder.
- **Expected:** Product policy explicitly defines whether deletion dissolves the clan, archives it, transfers ownership, or allows name recovery; every affected save reaches that state once.
- **Actual:** The shared hall/treasury/roster/upgrades are destroyed, but member pointers persist until each player manually leaves. A former member can recreate an empty clan under the deleted name. This sweep made the confirmation honest and prevents stale benefits once membership is cleared, but did not choose or rewrite the clan-wide policy.
- **Likely cause:** Clan creation/deletion uses the generic save endpoint while member removal later gained a dedicated cross-save endpoint.
- **Recommended fix:** After policy approval, add a founder-only, idempotent `/api/clan/delete` workflow: lock and snapshot the clan, write an audit/receipt or tombstone, clear every known member's clan pointer and benefit snapshots under save locks, then delete/archive the shared record. Define name-reuse ownership and cooldown explicitly and add interruption/retry tests.
- **Complexity:** Medium–high; multi-save failure recovery and migration behavior need design.
- **Design input required:** Yes — dissolution, audit retention, and name-reuse policy.

### P1 — Complete authenticated launch evidence is missing

- **Area:** QA, transactions, state synchronization, mobile, failure recovery.
- **Reproduction:** Run the browser suite or inspect `e2e/release-smoke.spec.ts`; it covers the public landing/creator surface. Compare this with the authenticated journeys and tier gates in `docs/UNRESTRICTED_LAUNCH_TESTING.md`.
- **Expected:** Disposable staging evidence covers registration/login/restore, training, missions, exploration, combat, one-time rewards, inventory/equipment, logout/return, slow and failed requests, refresh during settlement, multi-tab behavior, mobile viewports, presence reconnect, clan boss, and privileged tools.
- **Actual:** The code has broad unit/integration coverage, but the complete DB-backed journeys have not been demonstrated in a browser in this environment. The repository correctly keeps beta at 25 invited concurrent players until that evidence exists.
- **Likely cause:** Authenticated browser tests need disposable accounts, seeded data, a disposable backend, and cleanup support; production is deliberately not an acceptable destructive target.
- **Recommended fix:** Build a staging fixture/account lifecycle and add thin golden-path browser suites plus the existing presence and mutation-concurrency drills. Capture request IDs and server-side mutation counts so “rewarded once” is proven, not inferred from UI.
- **Complexity:** High (test infrastructure and operations rather than game design).
- **Design input required:** No balance input; owner approval and disposable staging resources are required.

### P1 — Realtime and hot session state are intentionally single-instance

- **Area:** Realtime presence, horizontal scaling, deployment reliability.
- **Reproduction:** `railway.json` pins `numReplicas` to 1. `api/_realtime/online-store.ts` stores presence in process memory and documents the single-process invariant. `api/_realtime/socket.ts` identifies a shared store and Socket.IO adapter as the multi-instance path.
- **Expected:** Raising the population can add application capacity without splitting presence, rooms, pending encounters, scheduled work, or hot state.
- **Actual:** One Railway replica is correct today, but adding replicas or serving the API through multiple Passenger workers would split presence and rooms. The current guard is safe; it is also a capacity ceiling and restart sensitivity.
- **Likely cause:** The realtime layer was deliberately optimized for a single always-on process before distributed coordination was needed.
- **Recommended fix:** Before scaling replicas, move presence/hot coordination behind a shared implementation (for example Redis), add a Socket.IO cross-node adapter, make scheduled jobs externally triggered or leader-locked, define sticky-session requirements, and load-test reconnect/restart behavior tier by tier.
- **Complexity:** High; migration and operational observability are required.
- **Design input required:** Architecture/operations approval, not gameplay design.

### P1 — Cold boot remains large

- **Area:** Initial load, low-end mobile CPU, slow networks.
- **Reproduction:** Run `npm run build`. The final size check reports an initial graph of **1.81 MB raw / 514.2 KB gzip across seven JS/CSS files**. Entry JS is approximately **1.08 MB** and blocking global CSS is **549.7 KB**.
- **Expected:** The public/auth shell should parse only what it needs, with authenticated runtime/story bodies and route-specific styles loaded after intent.
- **Actual:** Budgets pass, but cold visitors still parse a large integration shell and stylesheet. This is noticeable on slow phones even when transfer is compressed.
- **Likely cause:** `App.tsx` remains a broad integration root, story trigger data reaches substantial narrative code, and `index.css` contains 23,498 lines.
- **Recommended fix:** Extract a thin boot/auth router first; replace the static story graph with compact trigger metadata plus on-demand story body imports; continue route-level CSS extraction in small feature slices. Establish field p75 boot metrics before changing budget thresholds.
- **Complexity:** High and regression-prone if attempted as a mechanical split.
- **Design input required:** Architecture approval; no balance change.

### P1 — First-use pet 3D and several media assets are expensive

- **Area:** Pet Coliseum/3D entry, data use, memory, first-use delay.
- **Reproduction:** Inspect the build size report. Ten starter GLBs range from **3.09 MB to 4.63 MB each**; the Three.js vendor chunk is **956 KB**. Other notable assets include the **776.8 KB** world map, **598.1 KB** tactics diorama, and music files up to **2.47 MB**.
- **Expected:** A first-use route should load an asset tier appropriate to the device/network and avoid unnecessary geometry/texture cost.
- **Actual:** These assets are mostly deferred, so they do not inflate the initial graph, but the first relevant route can still incur a large transfer/parse/GPU spike.
- **Likely cause:** High-fidelity uncompressed or lightly compressed model/media delivery and a monolithic optional 3D dependency.
- **Recommended fix:** Prototype meshopt/Draco and KTX2 with visual comparison, add appropriate model LODs, preserve a non-3D/fallback presentation, and create responsive variants for the large 2D scenes. Measure visual quality and route-ready time before adoption.
- **Complexity:** Medium–high; asset pipeline and browser compatibility work.
- **Design input required:** Yes, art-quality and device-tier policy approval.

### P2 — Shared UI primitives have low adoption

- **Area:** Consistency, accessibility, maintainability.
- **Reproduction:** Repository scan finds roughly **1,059 raw `<button>` instances across 123 files**, while canonical `Button`, `Modal`, `CloseButton`, and related primitives exist. `App.tsx` is 8,049 lines and several screens exceed 3,800 lines. The existing route/component inventory also records many modal-like implementations.
- **Expected:** Similar actions share focus, close, busy, disabled-reason, confirmation, and error behavior.
- **Actual:** Good primitives coexist with many local patterns. This sweep additionally migrated Shop item details and the Wandering Sage offer, but broad adoption remains low. This raises regression risk and produces small behavior differences even when screens look related.
- **Likely cause:** Feature growth outpaced incremental primitive adoption.
- **Recommended fix:** Use a touched-file rule: new or materially changed dialogs use `Modal`; permanent mutations use one reviewed action lifecycle; icon-only controls use `CloseButton`/accessible names. Migrate by feature with screenshots and tests, not with a repository-wide replacement.
- **Complexity:** Medium over time; each slice is low–medium.
- **Design input required:** A short component standard is useful; no full redesign required.

### P2 — Permanent mutation feedback is not governed by one lifecycle

- **Area:** Duplicate prevention, stale state, UX wording.
- **Reproduction:** Compare the newly guarded Town Hall/Hollow Gate flows with other purchase/craft/mastery/admin flows. Many have their own state flags or server gates, but the client contract is not uniform.
- **Expected:** Every irreversible action follows: preflight → synchronous busy guard → exact consequence confirmation → server-authoritative mutation/idempotency → adopt returned version → success/error announcement → guard release.
- **Actual:** The major player-facing resource sinks sampled in this sweep now use synchronous interaction guards and safer ambiguous-response wording, but implementations still vary and require repeated manual review. The remaining issue is lifecycle consistency and coverage, not a newly verified duplicate-reward exploit.
- **Likely cause:** Mutation UIs evolved independently.
- **Recommended fix:** Inventory irreversible actions and introduce a small hook/component only after documenting the server response/version/idempotency variations. Do not hide server differences behind a generic optimistic mutation.
- **Complexity:** Medium.
- **Design input required:** Wording/confirmation policy approval is helpful.

### P2 — Bundle drift should be watched even though budgets pass

- **Area:** Performance governance.
- **Reproduction:** Compare the July 10 audit (**1.76 MB / 504.9 KB gzip; 5.48 MB product JS/CSS**) with this build (**1.81 MB / 514.2 KB; 5.62 MB**).
- **Expected:** Feature growth stays inside an explicit per-change performance budget with an owner for intentional increases.
- **Actual:** Current budgets pass, but the integration baseline grew about 50 KB raw, 9 KB gzip, and 140 KB total JS/CSS across intervening work.
- **Likely cause:** Normal feature integration without a lower review threshold than the hard failure ceiling.
- **Recommended fix:** Keep the hard ceiling and add a CI artifact showing baseline delta by entry/initial/total, requiring a short explanation above a small review threshold.
- **Complexity:** Low.
- **Design input required:** No.

## 4. UI/UX consistency report

### Repeated inconsistencies

- Dialog implementations differ in focus trapping, close behavior, viewport containment, and focus restoration. This sweep migrated Hollow Gate attunement, Clan Exchange, Shop item details, and the Wandering Sage offer, and hardened the global alert/confirm hosts; the remaining migration should be incremental.
- Permanent actions vary in confirmation detail, disabled-state explanations, busy labels, and error placement. The updated Town Hall, Hollow Gate, Clan Exchange, clan deletion, Shop, Bank, Profile, Training, pet evolution, treasury, festival, and Legacy flows are concrete reference patterns.
- Raw buttons are widespread. This is not automatically a bug—there is only one actual client `<form>` in the current scan, so accidental form submission is limited—but it makes touch size, focus appearance, and loading behavior harder to enforce globally.
- Large screen components mix networking, game state, rules, and view code. This makes small consistency changes risky and increases the chance that a modal or timer behaves differently on one route.

### Navigation and player friction

- Public landing and character creation are direct, keyboard operable, and rendered cleanly in the tested matrix. At 360 px, neither page had horizontal overflow.
- The largest remaining friction risk is not an observed broken link; it is incomplete authenticated journey evidence. Frequent-system navigation, back/forward state, filter preservation, and return-from-combat should be captured in staging browser tests before broad navigation redesign.
- Do not add confirmations to harmless navigation. Use the strengthened pattern only for expensive, irreversible, destructive, or long-cooldown commitments.

### Mobile and accessibility

- Automated public landing/creator scans report no serious/critical WCAG A/AA violations in the configured browser/viewport matrix.
- Existing touch-target regression tests cover key mobile shell actions at 44 px. Direct 360 × 800 browser verification found no horizontal overflow on landing or creation.
- Global alert/confirm dialogs now trap focus, restore the opener, support predictable Escape behavior, lock body scrolling, and announce the dialog semantically.
- Hollow Gate attunement now inherits canonical viewport sizing and modal behavior. Its success/error status is announced, and insufficient-resource buttons state the requirement.
- Clan Exchange confirmation and reveal dialogs now inherit the same focus containment, Escape handling, body scroll lock, viewport containment, and focus restoration.
- Shop item details and the Wandering Sage Legacy offer now inherit the same canonical dialog focus, Escape, scroll-lock, viewport, and focus-restoration behavior.
- Authenticated combat grids, inventory, admin, and creator tools still require real mobile browser evidence; source review is not a substitute for touch/keyboard behavior.

### Permanent-decision clarity

- Town Hall upgrades now show current and resulting level, exact Honor Seal cost, and permanence/no-refund language.
- Hollow Gate opening/extension now shows duration, exact cost, immediate commitment, and no-refund language.
- Hollow Gate key forging now shows exact shard cost and non-refundable commitment and cannot queue multiple confirmations through rapid clicks.
- Clan Exchange shows the exact Clan Point spend and reward, cannot submit twice before its disabled state renders, and tells the player to refresh before retrying an unconfirmed purchase.
- Clan deletion no longer clears local state after a rejected or unconfirmed server response and now describes the shared data actually destroyed.
- Custom titles now confirm the exact 10-shard permanent spend, and paid profile actions serialize through one synchronous guard.
- Ambiguous Shop, Bank, card-pack, transfer, training, pet-evolution, festival, clan/village treasury, and profile responses now direct the player to refresh and verify state before retrying.
- A future wording standard should require: outcome, exact spend, loss/gain, reversibility, duration/cooldown, and whether the server has committed the change.

## 5. Performance report

### Bundle and asset findings

| Measure | Start of this sweep | Final | Interpretation |
| --- | ---: | ---: | --- |
| Initial JS/CSS graph | 1.81 MB raw / 513.9 KB gzip | 1.81 MB raw / 514.2 KB gzip | Essentially unchanged; +0.3 KB gzip is the accessibility/reliability code. No speedup claimed. |
| Initial files | 7 | 7 | Unchanged. |
| Product JS/CSS | 5.62 MB | 5.62 MB | Unchanged; budget passes with warning. |
| Entry JS | ~1.08 MB | ~1.08 MB | Largest cold-boot target. |
| Global CSS | 549.7 KB | 549.7 KB | Largest blocking style target. |

The safe fixes in this sweep target reliability and clarity, not load time. They do not justify a “faster” claim. The prior July 10 work already removed several request waterfalls, introduced route intent preloading, delayed background polling, added abort bounds, and established build budgets. Its remaining thin-shell/story/CSS recommendations are still the correct high-value direction.

Large GLBs and media are deferred from cold boot, which is healthy, but remain first-use costs. Compression must be quality-tested. The build continues to optimize images and reports approximately 73% aggregate savings in the optimization pass.

### Rendering findings

- Component size is a maintainability and update-isolation risk (`App.tsx`, `Arena.tsx`, `AdminPanel.tsx`, `PetColiseum.tsx`, and `WorldMap.tsx` are particularly large), but this sweep did not find repeatable profiler evidence justifying speculative memoization.
- The direct browser journey produced no page errors on landing/creator. Continuous combat, presence, timer, and long-session memory behavior were not profiled with authenticated data.
- Recommended next evidence: React commit counts and long-task/heap traces during a 30-minute populated-sector/combat session, using the existing performance beacons to choose a real hot path before refactoring.

### API and database findings

- Sampled permanent progression paths use server settlement gates, save mutation locks, request tokens, or receipts. Tests cover combat formula parity, settlement adoption, currency locks, clan writes, anti-replay behavior, cooldowns, and legacy saves.
- The prior direct-client-write findings should not be repeated as current bugs without checking today’s implementation; several have been corrected.
- No authenticated database was available for query plans, connection-pool behavior, actual p95, rollback, cron interruption, or concurrent mutation evidence. Run the documented disposable concurrency drill before raising launch limits.
- The dependency audits for both root and client reported zero known vulnerabilities at audit time. This is not equivalent to a penetration test.

### Realtime presence findings

- Presence uses authenticated Socket.IO push with HTTP reconciliation, a 20-second client beat, a 90-second expiry tolerance, slim character snapshots, room-scoped broadcasts, and explicit cleanup/fallback behavior.
- No interval was blindly increased and no “alive” behavior was traded away in this sweep.
- The architecture is deliberately one-process. The 25-player beta cap and staged 25 → 50 → 100 → 300 evidence ladder should remain until the distributed-state decision is approved and tested.

## 6. Reusable regression checklist

### Account and progression

- [ ] New registration, login, wrong credentials, expired session, logout, and return restore the correct save.
- [ ] Character creation persists village, bloodline, avatar, and name exactly once; back/refresh cannot create a partial duplicate.
- [ ] Tutorial/first navigation explains the next action and survives refresh.
- [ ] Training start/collect is server-authoritative, timer-safe, and cannot award twice.
- [ ] Mission accept/progress/claim and exploration events persist once and show understandable empty/error states.
- [ ] Story triggers fire once when intended, choices persist, and old saves do not retrigger completed scenes.
- [ ] Bloodline and legacy choices state permanence, costs, gains, losses, and cooldowns.

### Inventory, economy, and pets

- [ ] Inventory quantities never become negative or duplicate after refresh; empty inventory is usable.
- [ ] Equipment slot validation, replace/unequip, and stat display agree before and after reload.
- [ ] Jutsu costs, AP, cooldown, range, target, and server resolution agree in every relevant combat engine.
- [ ] Shop, bank, crafting, Town Hall, Hollow Gate, Fate Shard, and other currency actions block duplicate clicks and adopt the authoritative returned save/version.
- [ ] Failed or timed-out purchases show “nothing spent” only when the server contract proves that statement.
- [ ] Pet capture/befriend, training, expedition, evolution, arena, and reward flows settle once and preserve custom/legacy pet data.

### Combat and multiplayer

- [ ] PvE/PvP combat covers move, target, invalid action, status duration, flee, defeat, victory, timeout, reconnect, refresh, and duplicate-submit behavior.
- [ ] Combat controls disable during submission and recover after a rejected/aborted request.
- [ ] Rewards display and persist once; a refresh between result and navigation cannot re-award.
- [ ] Clan boss covers party entry, simultaneous actions, boss defeat, personal/clan rewards, retry, and weekly/reset boundaries.
- [ ] Sector presence covers join, movement, sector transfer, hidden tab, disconnect, reconnect, logout, duplicate tabs, ghost expiry, and server restart.
- [ ] Clan/village war actions enforce membership/role, caps, ownership, race safety, and authoritative rewards.

### Responsive UI and accessibility

- [ ] Test 320/360/390/430 mobile, tablet portrait/landscape, 1366 laptop, desktop, and large desktop.
- [ ] No horizontal overflow, clipped modal, covered action, unreachable combat control, or hover-only requirement.
- [ ] Primary touch controls remain at least 44 × 44 px where practical and are not crowded.
- [ ] Modal focus is contained, Escape/backdrop policy is correct, body scroll is locked, and focus returns to the opener.
- [ ] Loading, empty, success, and error states are visible and announced where appropriate; color is not the only signal.
- [ ] Reduced motion, 200% zoom, keyboard-only use, and mobile keyboard form entry remain usable.

### Administration and creator tools

- [ ] Admin and creator routes reject unauthenticated, non-admin, expired, and spoofed identity requests server-side.
- [ ] Role changes, bans, grants, image uploads, and content edits require the intended authority and are auditable.
- [ ] Jutsu Builder, Bloodline Maker, Pet Editor, and visual-novel validation reject invalid references and preserve existing published content on failure.
- [ ] Uploaded filenames/types/sizes and text lengths are bounded; player/session secrets never appear in logs or client responses.

### Release gate

- [ ] Root build, dist verification, size budgets, type-check, lint, unit/integration, and cross-browser smoke all pass.
- [ ] Dependency audit and secret/config checks pass without embedding credentials into the client bundle.
- [ ] Disposable authenticated golden paths and mutation races pass.
- [ ] Presence/load tier passes before raising the concurrent-player cap.
- [ ] Rollback/schema compatibility and monitoring/error-reporting are verified in the target environment.

## 7. Final status

- **Build:** Pass — server compile, client production compile, tracked dist generation, image optimization, dist verification, and size budget.
- **Type-check:** Pass — server `tsconfig.cpanel.json` and client project build.
- **Lint:** Pass — client ESLint.
- **Unit/integration:** Pass — 3,065 passed, 0 failed, 474 suites.
- **End-to-end:** Pass — 21 passed, 7 skipped in the configured desktop/compact/mobile/tablet browser matrix. The seven skips are the production Sentry assertion outside its one applicable configured build/project. Public landing/creator rendering, responsive overflow/image/runtime checks, serious/critical Axe checks, and dialog keyboard/focus behavior passed. The Sentry-enabled production assertion remains required in CI; it is skipped locally only when the emitted bundle has no configured Sentry chunk.
- **Browser verification:** Pass for public landing → character creation at 360 × 800; no horizontal overflow, runtime page errors, or console errors observed. Other viewport coverage comes from Playwright.
- **Dependency audit:** Pass at time of review — zero known vulnerabilities reported for root and client dependency trees.
- **Known product failures:** None in the verified public surface and automated suite after fixes.
- **Not verified here:** Authenticated DB-backed full journeys, production CDN/database latency, populated realtime sectors, long-session memory, multi-tab mutation races, clan boss settlement through the browser, and live admin/creator mutations.
- **Human approval required:** Distributed realtime/scaling architecture; disposable staging and launch-load resources; cold-boot shell/story/CSS split; 3D/model/media compression quality policy; incremental UI primitive/mutation-lifecycle standard.

Overall status: **stable and safer for the current guarded beta, with no balance changes; approval-required architecture, performance, and launch-evidence work remains before unrestricted scaling.**
