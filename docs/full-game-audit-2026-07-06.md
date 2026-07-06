# ShinobiX Full Game Architecture, Reward Integrity, and Live-Ops Audit

Date: 2026-07-06
Branch/worktree: `codex/full-game-audit-20260706`

## Scope Note

This is a report-first audit, not an implementation pass. I inspected the route
map, storage/auth/lock foundations, the save sanitizer, the main reward-bearing
API paths, the largest frontend surfaces, and the current deployment/runtime
shape. Lower-risk visual and copy-only components were mapped but not treated as
proof that every pixel path is perfect. The findings below focus on the places
where live player saves, currency, combat outcomes, and operational reliability
can break.

## 1. Executive Summary

Shinobi Journey is not a loose prototype anymore. The codebase has meaningful
server authority in the places that were historically most dangerous: token-first
auth, route parity tests, PvP session hydration from authoritative saves, ranked
match tokens, pet expedition tokens, clan-boss tower settlement, Hollow Gate run
tokens, bank interest, jutsu seal spends, and a strict save-version guard.

The biggest remaining risk is not one single "everything is client trusted"
problem. It is mixed ownership. Some systems now mutate `save:*` server-side and
correctly bump `_saveVersion`, while older economy/clan/village paths still write
save rows directly without that bump. Because `/api/save/:name` now rejects stale
client saves only when `_saveVersion` changes, any server mutation that does not
bump the version can be overwritten later by an old tab that still holds the same
base version.

The second biggest risk is reward proof. Many reward paths are now
server-computed or token-gated, but AI fight rewards, weekly boss damage, built-in
field/hunt mission completion, training fallback, and broad inventory/card
entitlement still rely on client-reported progress or on the catch-all save
sanitizer. These are mostly bounded, but they are still the highest-value next
server-authority targets.

Best next move: create one shared "mutate player save under lock" helper, convert
every server-side player-save write to it, then move AI/weekly-boss reward proof
behind battle receipts. Do not start with a full combat rewrite or an infra
migration.

## 2. Codebase Map

### Runtime and routing

- `server.ts` is the production Express server for Railway and cPanel. It imports
  every Vercel-style handler and registers both bare and `/api` paths. Current
  route registration runs from `server.ts:545` through `server.ts:864`.
- `server-routes.test.ts` statically checks route parity so client-used API paths
  and handler files do not silently drift.
- `app.js` is the cPanel/Passenger entry point that loads `dist/server.js`.
- Static SPA serving and cache policy live in `server.ts:891` through
  `server.ts:957`. Hashed assets are immutable; `index.html` is no-cache.

### Backend foundations

- `api/_auth.ts` owns token-first player auth. `authedPlayer()` prefers
  `x-player-token`, then falls back to `x-player-password` when needed
  (`api/_auth.ts:174`, `api/_auth.ts:187`).
- `api/player-auth.ts` mints session tokens on register/verify/change
  (`api/player-auth.ts:208`, `api/player-auth.ts:265`) and refuses banned logins
  (`api/player-auth.ts:247`).
- `api/_storage.ts` is a KV facade over Postgres or Supabase REST, plus a disk
  overlay for heavy save/image keys. Atomic `set nx` and `incr` are backed by DB
  RPCs on the main store (`api/_storage.ts:154`, `api/_storage.ts:186`,
  `api/_storage.ts:335`, `api/_storage.ts:359`).
- `api/_lock.ts` provides `withKvLock()`. Economy paths should use
  `{ failClosed: true }`.
- `api/_receipts.ts` stores durable battle and action receipts
  (`api/_receipts.ts:117`, `api/_receipts.ts:174`, `api/_receipts.ts:360`).

### Client structure

- `shinobij.client/src/App.tsx` is still the shell and integration hub. It is
  currently 8,398 lines, under the 8,500-line ratchet in
  `shinobij.client/src/App.size.test.ts:138`.
- Major screens are now lazy-loaded with `lazyWithRetry()`, including
  `AdminPanel`, `WorldMap`, `PetArena`, `Arena`, `Missions`, and many others
  (`shinobij.client/src/App.tsx:115`, `shinobij.client/src/App.tsx:147`,
  `shinobij.client/src/App.tsx:166`, `shinobij.client/src/App.tsx:171`).
- `shinobij.client/src/index.css` is very large at about 710 KB and 25,140 lines.
- The largest remaining code files by size include `AdminPanel.tsx`,
  `Arena.tsx`, `PetColiseum.tsx`, `WorldMap.tsx`, and pet battle simulation libs.

### Reward and combat flows

- PvP: `api/pvp/session.ts`, `api/pvp/move.ts`,
  `api/pvp/claim-rewards.ts`, ranked queues, receipts, and SSE/spectate routes.
- PvE missions: `api/missions/claim-mission.ts`,
  `api/missions/report-ai-fight.ts`, `api/missions/report-raid.ts`,
  `api/missions/report-pet-event.ts`, and start/token endpoints.
- Pets: `api/pet/battle-start.ts`, `api/pet/battle-result.ts`,
  `api/pet/ranked-start.ts`, `api/pet/gauntlet.ts`, `api/pet-ladder/ladder.ts`.
- Clan/village economy: `api/clan/treasury/*`, `api/clan/seal-pool/*`,
  `api/clan/territory/collect-supply.ts`, `api/village/treasury/*`,
  `api/village/claim-*`, and `api/world-state.ts`.
- Boss systems: `api/weekly-boss.ts` and `api/clan-boss/*`.
- Training/jutsu/bank: `api/training/*`, `api/jutsu/*`,
  `api/bank/claim-interest.ts`.
- Save sanitizer and optimistic concurrency: `api/save/[name].ts`.

## 3. Logic Audit Findings

### P0: Some server economy writes bypass `_saveVersion`

Evidence:

- `/api/save/:name` now requires `_baseSaveVersion` on normal player saves and
  rejects missing/stale versions (`api/save/[name].ts:1831`,
  `api/save/[name].ts:1850`, `api/save/[name].ts:1864`,
  `api/save/[name].ts:1886`).
- Many modern endpoints correctly use `bumpSaveVersion()` and
  `mergePreservingImages()`, for example bank interest
  (`api/bank/claim-interest.ts:71`), PvP rewards
  (`api/pvp/claim-rewards.ts:182`, `api/pvp/claim-rewards.ts:313`), pet rewards
  (`api/pet/battle-result.ts:289`), and weekly boss credit
  (`api/weekly-boss.ts:352`).
- Older treasury paths write player saves directly without bumping version:
  `api/clan/treasury/donate.ts:134`,
  `api/clan/treasury/transfer.ts:175`,
  `api/clan/treasury/transfer.ts:187`,
  `api/village/treasury/donate.ts:123`,
  `api/village/treasury/transfer.ts:214`,
  `api/village/treasury/transfer.ts:245`.
- `api/clan/kick.ts:97` also writes the target player's save directly.

Why it matters:

The save-version guard only protects server-side mutations when the stored record
version changes. If a treasury endpoint debits or credits a player but leaves the
same `_saveVersion`, a stale browser tab can later pass the version check and
overwrite the mutation.

Suggested fix:

Create a shared helper such as `mutatePlayerSave(playerName, fn, options)` that:

- locks `save:<player>` with `{ failClosed: true }`,
- re-reads the current record inside the lock,
- applies the patch,
- calls `bumpSaveVersion()`,
- writes with `mergePreservingImages()`,
- returns the new `_saveVersion`.

Then convert all direct player-save `kv.set()` calls to this helper and add a
test that fails when a non-admin endpoint writes `save:*` without bumping the
version.

### P1: Two-row treasury and territory flows need a durable transaction/outbox

Evidence:

- Clan treasury donate locks the clan row, then donor row, then writes donor and
  clan state separately (`api/clan/treasury/donate.ts:108`,
  `api/clan/treasury/donate.ts:112`, `api/clan/treasury/donate.ts:134`,
  `api/clan/treasury/donate.ts:140`).
- Village treasury donate does the same shape
  (`api/village/treasury/donate.ts:102`,
  `api/village/treasury/donate.ts:105`,
  `api/village/treasury/donate.ts:123`,
  `api/village/treasury/donate.ts:129`).
- Clan territory supply intentionally debits sector supply first, then credits
  clan treasury, and logs an unreconciled loss on credit failure
  (`api/clan/territory/collect-supply.ts:90`,
  `api/clan/territory/collect-supply.ts:116`,
  `api/clan/territory/collect-supply.ts:123`,
  `api/clan/territory/collect-supply.ts:131`).
- Village war settlement moves spoils between village states under locks
  (`api/world-state.ts:577`, `api/world-state.ts:585`,
  `api/world-state.ts:589`).

Why it matters:

These paths generally prefer "lose, never duplicate", which is correct for
exploit resistance, but live operations still need reconciliation. A player or
clan can lose value if the second write fails after the first one succeeds.

Suggested fix:

Introduce a small transaction receipt/outbox for shared-economy transfers:

- reserve `economy-tx:<id>` with debit, credit, actor, resource, and state,
- apply debit and mark debit-applied,
- apply credit and mark credit-applied,
- mark complete,
- add an admin reconciliation view for stuck tx records.

This can be implemented on the existing KV/Postgres layer before any schema
migration.

### P1: AI fight rewards are bounded but still client-reported

Evidence:

- `api/missions/report-ai-fight.ts` accepts `body.xp` and `body.ryo` from the
  client and returns allowed amounts after a daily atomic counter
  (`api/missions/report-ai-fight.ts:51`, `api/missions/report-ai-fight.ts:53`,
  `api/missions/report-ai-fight.ts:75`).
- The clamp is meaningful: max 150 XP and 150 Ryo per fight, first 50 fights per
  UTC day at full value, then 25 percent
  (`api/missions/_ai-fight-reward.ts:13`,
  `api/missions/_ai-fight-reward.ts:15`,
  `api/missions/_ai-fight-reward.ts:16`,
  `api/missions/_ai-fight-reward.ts:31`).

Why it matters:

A modified client can claim AI wins up to the daily cap without proving the fight
happened. The current design limits damage, but it is still not server-authority.

Suggested fix:

Add an AI battle start endpoint that mints a short-lived receipt/token sealing
opponent id, level, reward ceiling, and seed. On completion, require the token and
either server-replay the result or consume a server-generated battle receipt.

### P1: Weekly boss rewards are crash-resumable, but damage is not authoritative

Evidence:

- Reward distribution has been hardened. It freezes `distributionSummary`, uses
  per-player `weekly-boss-credit:<weekKey>:<name>` receipts, tracks
  `creditedPlayers`, and only flips `rewardsDistributed` after all entries are
  credited (`api/weekly-boss.ts:215`, `api/weekly-boss.ts:278`,
  `api/weekly-boss.ts:318`, `api/weekly-boss.ts:386`,
  `api/weekly-boss.ts:392`).
- The `logFight` path still takes a client-reported damage `amount`, bounds it by
  saved stats and attempt caps, then adds `logged` damage
  (`api/weekly-boss.ts:539`, `api/weekly-boss.ts:546`,
  `api/weekly-boss.ts:557`, `api/weekly-boss.ts:578`,
  `api/weekly-boss.ts:597`).

Why it matters:

Leaderboard rewards are now paid reliably, but the leaderboard input is still
client-reported within a generous ceiling.

Suggested fix:

Reuse the existing battle receipt infrastructure: start a weekly boss battle
receipt, have the server compute final damage from the finished session or action
log, and let `logFight` accept only the receipt id.

### P1: Built-in field/hunt mission rewards are server-computed but progress is client-tracked

Evidence:

- `api/missions/claim-mission.ts` is explicit that combat claims are queued by
  `/api/missions/queue-combat-claim`, while field and hunt explore progress stays
  client-tracked (`api/missions/claim-mission.ts:42`,
  `api/missions/claim-mission.ts:44`, `api/missions/claim-mission.ts:155`).
- Field and hunt rewards are server-catalog based and daily/idempotency bounded
  (`api/missions/claim-mission.ts:179`, `api/missions/claim-mission.ts:187`,
  `api/missions/claim-mission.ts:215`, `api/missions/claim-mission.ts:226`,
  `api/missions/claim-mission.ts:285`).

Why it matters:

The server owns the payout amount but not the actual completion proof for some
mission categories. A tampered client can claim legitimate catalog rewards
without doing the underlying exploration/hunt work, subject to daily limits.

Suggested fix:

Move field/hunt progress counters server-side in small steps: first track
server-accepted sector explore and hunt event receipts, then make
`claim-mission` read those counters instead of trusting local progress.

### P1: Inventory and tile-card entitlement still rely too much on save shape

Evidence:

- The save sanitizer caps legacy `inventory[]` length at 500
  (`api/save/[name].ts:713`, `api/save/[name].ts:716`).
- `itemStacks` are structurally cleaned and counted, with special delta handling
  for Hollow Gate keys, but most item ids are not entitlement-checked
  (`api/save/[name].ts:719`, `api/save/[name].ts:728`,
  `api/save/[name].ts:736`, `api/save/[name].ts:750`).
- Tile cards are length-capped but not entitlement-checked in the save sanitizer
  (`api/save/[name].ts:1040`).
- Combat loadouts resolve equipped items from the saved inventory/equipment
  (`api/pvp/session.ts:575`, `api/pvp/session.ts:679`,
  `api/pvp/session.ts:734`), so forged ownership can matter if an item id is
  accepted elsewhere.

Why it matters:

The sanitizer prevents absurd payload sizes and some currency/stat escalation,
but valuable item/card ownership should be a grant ledger, not arbitrary client
state. This is especially important for legendary caches, premium materials, and
PvP-relevant equipment.

Suggested fix:

Do not break old saves immediately. First classify item ids by risk:

- safe cosmetic/local ids,
- catalog consumables/materials,
- combat gear,
- premium/cache rewards,
- tile cards.

Then migrate high-risk grants to server endpoints with receipts and make the save
sanitizer preserve existing high-risk ids but reject new unreceipted additions.

### P2: Hollow Gate settlement avoids duplicates but can lose a reward on write failure

Evidence:

- `api/hollow-gate/settle.ts` reserves `hg-settled:<player>:<token>`, then
  deletes the run token before writing the save (`api/hollow-gate/settle.ts:72`,
  `api/hollow-gate/settle.ts:74`, `api/hollow-gate/settle.ts:84`,
  `api/hollow-gate/settle.ts:113`).

Why it matters:

This is good against duplication, but if the save write fails after the token is
deleted, retry recovery is weak. The player may get a no-duplicate failure mode
that needs support intervention.

Suggested fix:

Store a pending settlement record before consuming the run token, or consume the
token inside a transaction/outbox that can retry save credit until complete.

### P2: Training stats have a deliberate fallback that weakens authority

Evidence:

- `api/training/start.ts` mints sealed training tokens and applies a daily cap
  (`api/training/start.ts:81`).
- `api/training/complete.ts` consumes the token and returns sealed gain
  (`api/training/complete.ts:78`).

Why it matters:

The token path is good, but comments and client compatibility keep training as a
soft-authority system when the token path is unavailable. Since stats are
game-power, this should become stricter for higher tiers after no-token fallback
usage is measured.

Suggested fix:

Keep low-level compatibility for now. Add telemetry for token-missing completions,
then require tokens for late-game tiers first.

### P2: Realtime and cron are good for one process, but need a scale guard

Evidence:

- The server attaches Socket.IO and starts the 1-second in-memory game loop and
  in-process cron on startup (`server.ts:993`, `server.ts:1000`,
  `server.ts:1004`).
- The cron scheduler runs save snapshots, ranked rollover, clan boss weekly
  settlement, village war daily pass, and era unlocks
  (`api/cron/_scheduler.ts:18`, `api/cron/_scheduler.ts:55`,
  `api/cron/_scheduler.ts:74`, `api/cron/_scheduler.ts:79`).

Why it matters:

This is fine for a single Railway instance. If Railway scales horizontally, cron
and in-memory presence need leader election, an external scheduler, or a
single-replica policy.

Suggested fix:

For now, document "one web replica" as a production invariant. Before scaling out,
add a KV leader lock around each cron pass and move presence semantics to either
sticky sessions or shared state.

## 4. Reward Integrity Findings

| Reward path | Current source of truth | Duplicate risk | Partial-save risk | Priority | Fix |
| --- | --- | --- | --- | --- | --- |
| Player auth/session | `api/_auth.ts`, `api/player-auth.ts`, client `authFetch.ts` | Low | Low | Keep | Preserve token-first fallback. |
| Normal `/api/save` progression | Client save plus server sanitizer/version guard | Medium | Medium | P1 | Keep, but drain high-value rewards into endpoints. |
| PvP ranked/base rewards | `pvp/session`, `pvp/move`, `pvp/claim-rewards`, receipts | Low for ranked/base | Low | Keep | Continue moving legacy casual paths to `baseRewards`. |
| PvP casual non-`baseRewards` | Client local grant gated by NX claim | Medium during KV reserve failure | Low | P2 | Retire this path after all clients stamp `baseRewards`. |
| Pet expeditions | `expedition-start` token plus `report-pet-event` sealed values | Low | Low | Keep | Good pattern. |
| Pet casual battle | `battle-start` token plus `battle-result` | Medium outcome trust, low duplicate | Low | P2 | Later server-replay pet duels. |
| Pet ranked | `pet/ranked-start` match token plus `battle-result` | Low | Low | Keep | Good pattern. |
| Pet gauntlet | Sealed run token, daily cap, server-bounded premium buys | Medium leaderboard replay trust | Low | P2 | Later port full board replay to server. |
| AI fight rewards | Client-reported XP/Ryo clamped server-side | Medium | Low | P1 | Add AI fight start token/receipt. |
| Built-in field/hunt missions | Server catalog payout, client progress | Medium | Low | P1 | Server-side progress receipts. |
| Combat missions | Queued claim token/pending flag | Low | Low | Keep | Good enough. |
| AI raids | `raid-start` / `report-raid` token or PvP session proof | Low | Low | Keep | Good pattern. |
| Weekly boss | Server distribution receipts, client-reported stat-capped damage | Medium | Low | P1 | Damage from battle receipt. |
| Clan boss | Tower engine session result | Low | Low | Keep | Strong design. |
| Bank interest | Server clock/save lock | Low | Low | Keep | Good pattern. |
| Jutsu seals | Server save lock and recomputed cost | Low | Low | Keep | Good pattern. |
| Training stats | Sealed token with fallback | Medium | Low | P2 | Require token for late-game tiers. |
| Clan/village treasury transfer | Server locks, direct save writes | Low duplicate, medium overwrite | Medium | P0 | Save helper + outbox. |
| Territory supply collection | Server locks, loss audit on credit fail | Low duplicate | Medium | P1 | Outbox/reconciliation. |
| Inventory/cards | Client save sanitized by size/shape | Medium | Medium | P1 | Entitlement receipts for high-risk ids. |
| Hollow Gate | Sealed run token and ceiling | Low duplicate | Medium loss-on-failure | P2 | Pending settlement/outbox. |

Consistent settlement pattern to standardize on:

1. Start or reserve: server mints a token/receipt sealing the actor, scope,
   reward ceiling, seed, and expiry.
2. Resolve: server recomputes outcome, or consumes a battle/action receipt.
3. Lock: acquire every touched `save:*` or shared row key in deterministic order
   with `{ failClosed: true }`.
4. Idempotency: reserve an NX claim key or consume the single-use token only once.
5. Mutate: use a shared save mutation helper that bumps `_saveVersion`.
6. Record: write an audit/economy receipt after successful mutation.
7. Retry: if a multi-row operation is possible, record an outbox state so support
   can resume or reconcile.

## 5. Seamlessness / Player Experience Findings

The login and auth flow is now structurally solid. The client sends token-only
once a token exists and clears durable plaintext password storage
(`shinobij.client/src/authFetch.ts:95`, `shinobij.client/src/authFetch.ts:196`,
`shinobij.client/src/authFetch.ts:338`). The one friction point is expiry after
the password has been purged: users may need a clear "session expired, sign in
again" recovery path, which the code already anticipates around
`shinobij.client/src/authFetch.ts:359`.

The game loop is connected, but dense. Village, world map, missions, clans,
pets, training, story, and admin tools all exist, but the player can be presented
with many parallel systems before one "next best action" is obvious. The safest
UX improvement is a lightweight daily/weekly objective rail that points into
existing systems without creating new reward math.

Battle recovery is better than typical browser RPG code. `api/battle/lock.ts`
provides PvE anti-refresh state, PvP has SSE/receipt paths, and clan boss reuses
Battle Towers. The weak spot is not recovery UI as much as inconsistent proof for
older PvE systems.

Clan and village systems are meaningful. They touch treasuries, territory,
village war, clan boss, daily agenda, map control, clan missions, and seal pools.
The player-facing design is coherent, but server transaction consistency should
be tightened before adding more clan currencies or exchanges.

Performance is actively improving. `App.tsx` is under its ratchet and many heavy
screens are lazy-loaded. The next frontend wins are not "split everything"; they
are targeted:

- keep draining integration logic from `App.tsx` without regrowing it,
- break up `index.css` by screen/system,
- keep `AdminPanel`, `Arena`, `PetColiseum`, and `WorldMap` as lazy chunks and
  reduce shared imports that pull their dependencies into the main chunk,
- image-optimize the largest assets in `shinobij.client/src/assets`, especially
  multi-MB coliseum/sector art,
- add a few Playwright smoke journeys after the reward fixes: login, first save,
  mission claim, PvP session, clan treasury, mobile world map.

UI flows that likely need polish:

- first 10 minutes: one guided path from creation to village to first mission to
  first safe fight,
- mission/hunt proof: make progress feel server-backed, not "the client says so",
- reward reveal: consistent server-returned reward modal/toast for all endpoints,
- retry states: show "reserved, retrying credit" for outbox-backed rewards,
- clan treasuries: explain pending/reconciled states if outbox is added,
- mobile: prioritize one-column critical actions in Arena, World Map, Clan Hall,
  Pet Coliseum, and Admin views.

## 6. Infrastructure Recommendation

| Service/system | Recommendation | Why | Files/systems affected | Risk/cost |
| --- | --- | --- | --- | --- |
| Supabase/Postgres | Now: keep and deepen use for KV atomic ops, receipts, and eventually ledger tables | Already the storage backbone; atomic NX/incr are present | `api/_storage.ts`, future receipt/outbox modules | Low if added incrementally |
| Cloudflare CDN/cache | Now/Later: use for static SPA assets and `/api/img` cache rules | Server cache headers are already prepared | `server.ts:891`, `api/img.ts`, Cloudflare config | Low |
| Cloudflare R2/object storage | Later | Useful when generated/shared images outgrow KV/disk overlay | `api/images.ts`, `api/img.ts`, client image loaders | Medium migration risk |
| Cloudflare Workers | Later | Useful for edge redirects, bot screening, or lightweight CDN glue, not core game logic | Domain/edge config | Medium complexity |
| Turnstile/anti-bot | Later, or Now if signup/login abuse appears | Protects auth and creator/admin submissions, not reward integrity | Login/register UI, `player-auth`, rate limit layer | Low/medium |
| Redis/KV | Not needed now as a new service | Current KV facade already has NX/incr/locks; adding Redis only helps if latency/contention demands it | `api/_storage.ts`, lock layer | Medium ops cost |
| Queue/outbox | Now for shared economy writes | Solves partial debit/credit and reward retry/reconcile | New `api/_economy-tx.ts`, treasury/territory/village war | Medium, high value |
| WebSockets | Now: keep limited to presence/push | Socket.IO is attached with HTTP fallback and auth | `api/_realtime/*`, `server.ts` | Low while single-instance |
| Cron jobs | Now: keep, but document single replica | In-process cron is right for Railway single server | `api/cron/_scheduler.ts`, Railway config | Low now, medium if scaling |
| Error tracking | Now | Need production stack traces for reward/write failures | Server and client bootstrap | Low cost, high ops value |
| Analytics/economy telemetry | Now/Later: continue economy audit and add funnel events | Reward bugs and player friction need facts | `api/_economy.ts`, `api/admin/economy.ts`, client telemetry | Low/medium |

What should stay on current stack:

- Railway as live always-on server.
- cPanel/Passenger as maintained fallback.
- Express + Vercel-style handler shape.
- Supabase/Postgres-backed KV facade.
- Disk overlay for large save/image data until object storage is justified.

What should not move yet:

- Do not split the backend into microservices.
- Do not move core combat to Workers.
- Do not replace the save model wholesale before reward endpoints are drained.
- Do not add Redis unless lock/contention metrics prove the current facade is too
  slow.

## 7. Priority Roadmap

### Immediate fixes

1. Build the shared save mutation helper and convert direct player-save writes in
   clan/village treasury and clan kick paths.
2. Add a static or targeted test that detects non-admin `kv.set(save*)` writes
   without `bumpSaveVersion`.
3. Add outbox/transaction receipts for clan/village treasury transfer/donate and
   territory supply collection.
4. Retire or fail-closed the remaining casual PvP non-`baseRewards` reward path
   after confirming the client always stamps `baseRewards`.

### Next 1-2 days

1. Add AI fight start/complete proof so `report-ai-fight` no longer accepts raw
   client XP/Ryo as the only proof.
2. Convert weekly boss `logFight` to consume a battle receipt instead of raw
   damage.
3. Start server-side field/hunt progress receipts for built-in missions.
4. Add admin visibility for unreconciled economy transactions.
5. Add telemetry for training completions missing a valid token.

### Next week

1. Classify item ids by entitlement risk and block new unreceipted high-risk
   inventory/card grants.
2. Move premium/cache/item roll rewards through server endpoints.
3. Split `index.css` by screen/system and keep lowering the App ratchet only when
   code is actually drained.
4. Add Playwright smoke tests for the main player journeys.
5. Add Sentry or equivalent error tracking on server and client.

### Later

1. Full server-side PvE simulation or deterministic transcript replay for all
   rewardful PvE fights.
2. R2/object storage migration for shared/generated images.
3. Leader election for cron/realtime if Railway scales past one web replica.
4. Relational ledger tables for long-term economy analytics.
5. Turnstile or stronger anti-bot gates if registration/login abuse appears.

Build/lint/test recommendations:

- Report-only/doc changes: run `git diff --check`.
- Backend/API changes: run `npm test` from the repo root.
- Frontend changes: run `npm run lint` inside `shinobij.client/`.
- API or `server.ts` changes destined for cPanel: run `npm run build` and commit
  regenerated `dist/` and `shinobij.client/dist/`.
- Add targeted tests next to each fix before relying on the full suite:
  save-version helper, treasury conversion, economy outbox, AI fight receipt,
  weekly boss receipt, inventory entitlement guard.

## 8. Exact Implementation Prompts

### Prompt 1: standardize player-save mutations

Create a helper for server-side player-save mutations, then convert the risky
direct writes.

Requirements:

- Add a helper under `api/save/` that accepts `playerName` and a mutation callback.
- It must lock `save:<player>` with `{ failClosed: true }`, re-read inside the
  lock, call `bumpSaveVersion()`, write through `mergePreservingImages()`, and
  return the updated record plus `_saveVersion`.
- Convert these first:
  `api/clan/treasury/donate.ts`,
  `api/clan/treasury/transfer.ts`,
  `api/village/treasury/donate.ts`,
  `api/village/treasury/transfer.ts`,
  `api/clan/kick.ts`.
- Preserve existing behavior and response bodies except add `_saveVersion` where
  useful.
- Add focused tests proving a stale `/api/save/:name` cannot overwrite a server
  treasury mutation.
- Run `npm test`.

### Prompt 2: add economy transaction receipts for two-row transfers

Implement a small economy transaction/outbox layer for shared treasury and
territory transfers.

Requirements:

- Add `api/_economy-tx.ts` with receipt states: `reserved`, `debit-applied`,
  `credit-applied`, `complete`, `needs-reconcile`.
- Use NX transaction ids to make retries idempotent.
- Convert clan treasury donate/transfer, village treasury donate/transfer, and
  clan territory supply collection.
- Keep the current "never mint on failure" invariant, but make losses visible and
  retryable/reconcilable.
- Add admin-readable audit output for stuck transactions.
- Run `npm test`.

### Prompt 3: make AI fight rewards proof-backed

Replace raw client-reported AI fight reward proof with a start/complete receipt.

Requirements:

- Add `/api/missions/ai-fight-start` to mint a short-lived single-use token
  sealing player, opponent id/type, seed, reward ceiling, and expiry.
- Update `report-ai-fight` to require the token for non-admin rewards.
- Keep current daily soft cap from `api/missions/_ai-fight-reward.ts`.
- During migration, allow old clients to receive zero reward with a clear reason
  rather than a 500.
- Add tests for token reuse, expired token, wrong player, and daily cap.
- Run `npm test`.

### Prompt 4: make weekly boss damage receipt-backed

Move weekly boss `logFight` from client-reported damage to battle receipt damage.

Requirements:

- Start weekly boss arena fights with a server-side receipt id.
- On finish, compute damage from the server-known battle result/action receipts.
- Update `api/weekly-boss.ts` so `logFight` accepts a receipt id and rejects raw
  damage for normal players.
- Keep existing distribution summary, per-player credit receipts, and crash
  recovery behavior.
- Add tests for double-submit, invalid receipt, over-cap damage, and distribution
  resume.
- Run `npm test`.

### Prompt 5: start inventory entitlement hardening

Add an entitlement guard for high-value inventory and tile-card grants without
breaking old saves.

Requirements:

- Classify catalog ids into low-risk, material/consumable, combat gear, premium
  cache, and tile card.
- Add a server-side grant receipt format for high-risk ids.
- Update the save sanitizer to preserve existing high-risk ids but reject new
  unreceipted additions for selected pilot categories.
- Start with legendary/epic caches, premium materials, and PvP-relevant gear.
- Add tests for old-save preservation, new forged id rejection, and legitimate
  endpoint grant.
- Run `npm test` and client inventory tests.

## 9. Do Not Do Yet

- Do not rewrite all combat in one pass. Start with rewardful PvE receipt proof.
- Do not remove the catch-all save endpoint before replacement endpoints cover
  old saves and offline-like autosave behavior.
- Do not add new currencies, caches, or clan exchanges until inventory and
  treasury settlement are tighter.
- Do not migrate everything to a new database schema without approval. Use the
  existing KV/Postgres layer for receipts/outbox first.
- Do not remove Railway or cPanel support.
- Do not move the game to Cloudflare Workers.
- Do not introduce Redis just because locks exist. Measure contention first.
- Do not split `App.tsx` mechanically if it pulls shared imports into the initial
  chunk or changes player behavior.
- Do not break no-token auth fallback while `SESSION_SECRET` can be unset.
- Do not trust admin/client creator tools to be harmless. Keep catalog approval,
  moderation, and admin-only image prefixes intact.

