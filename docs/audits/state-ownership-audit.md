# State-Ownership Audit — Phase 0 (2026-07-31)

> **P0-1 status (2026-08-01):** the scattered ownership lists this audit
> inventoried are now DERIVED from one canonical manifest,
> `api/save/_state-ownership.ts` (branch `refactor/state-ownership-p0-1`), with
> golden-master, parity, and ratchet tests
> (`api/save/_ownership-golden-master.test.ts`,
> `_state-ownership-parity.test.ts`, `_state-ownership-ratchet.test.ts`).
> Behavior is unchanged — the line numbers below refer to pre-extraction
> `api/save/[name].ts` @ de50b3385 and remain the historical record. The
> `?signal=1` auth boundary was re-verified during P0-1 (admin auth required;
> 401 otherwise) — the remaining `?signal=1` risk is locking/version
> consistency, still P0-4. Durable reference:
> `docs/architecture/state-ownership-contract.md`.

Baseline: `origin/main` @ `de50b3385` on branch `audit/shinobix-stabilization-phase-0`.
Every claim is tagged **VERIFIED** (read directly from current code) or **INFERRED**
(consistent with current code but not opened line-by-line). Live-data questions are
listed at the end and are NOT presented as verified.

## Summary

Player state lives in whole-JSON blobs at `save:<name>` in Supabase (`kv_store`,
via the `kv` adapter in `api/_storage.ts`). The generic save endpoint
(`api/save/[name].ts`) is **not** a trusting pass-through: it runs a large
sanitizer (`sanitizeCharacterSave`, ~lines 760–2169) inside a
`withKvLock('save:<name>', { failClosed: true })` critical section, with an
optimistic-concurrency version gate (`_saveVersion` / `_baseSaveVersion`,
`api/save/_save-version.ts`). Server-granted state (currency, pets, achievements,
receipts, claim stamps, ratings, admin content) is re-asserted from the stored
copy on every save, so a stale autosave that somehow passed the version gate
still cannot clobber it. The remaining softness is deliberate compatibility
headroom that disappears when `STRICT_RAW_SAVE_LEDGER=1` is flipped in
production (currently pending).

## Ownership matrix

Format: domain | canonical location | ownership | mutators | stale-autosave-overwritable? | atomic/lock | risk

| Domain | Canonical location | Ownership | Mutators | Stale-autosave risk | Lock | Risk |
|---|---|---|---|---|---|---|
| Character identity | `save:<name>.character` | MIXED (name capped; village LOCKED; clan cross-validated vs `save:clan-<slug>`) | generic save + clan flow | No | withKvLock | LOW |
| Auth/session | `auth:<name>` (scrypt), `auth-session:<name>` (epoch); HMAC token | SERVER | `/api/player-auth` only | N/A | n/a | LOW |
| Level / rank | `character.level`, `rankTitle` | SERVER — level recomputed via `applyDerivedLevel` from validated stat ledger | sanitizer + grant endpoints | No | lock | LOW |
| XP | `character.xp` — FROZEN dead field (XP removal verified) | SERVER | none | No | lock | LOW |
| Stats / unspentStats | `character.stats` | SERVER-entitled — spend-only via `preserveStatPointEntitlement` | training/complete, stat-respec | No | lock | LOW |
| Ryo | `character.ryo` | MIXED — decrease free; gain ≤1,000/save non-strict (`[name].ts:937`), 5M/min window; strict = frozen | claim endpoints, shop | Version guard blocks; re-assert lower value possible | lock | **MEDIUM** until strict flip |
| Bank | `character.bankRyo`, `lastBankInterestAt` | SERVER (`ALWAYS_SERVER_LEDGER`, `:942`) | bank/transfer, bank/claim-interest | No | lock | LOW |
| Other currencies (fateShards, boneCharms, auraStones, auraDust, mythicSeals, honorSeals, hollowShards) | character fields | SERVER — `CURRENCY_CAPS` all-zero gain (`:230-238`) + per-minute windows (`:291`) | domain endpoints | No | lock | LOW |
| Inventory / itemStacks | `character.inventory` / `.itemStacks` | SERVER-LEDGER — `preserveOwnedItems` conserves combined stored counts in all modes; net-new items require an authoritative endpoint | shop, craft, drops | No mint; drops = spend semantics | lock | LOW |
| Equipped items | `character.equipment` | MIXED — `enforceEquipmentOwnership` (`:547`): slot whitelist, ownership, slot-kind | generic save | No unowned equips | lock | LOW |
| creatorItems (personal forged) | TOP-LEVEL `creatorItems`, ids `named-(weapon\|armor)-<uuid>` (`FORGED_ITEM_ID`, `:432`) | MIXED — numerics clamped (`:2033-2098`); revived if omitted (`preserveForgedItems`, `:470`); stripped from admin slots | craft/named.ts mints | No (revival guard) | lock | LOW |
| Admin-authored content | `save:admin1` / `save:admin2` root fields (`SHARED_ADMIN_CONTENT_FIELDS`, `:97`) | ADMIN — deleted from player `character.*` (`:1852-1858`); top-level `creator*` frozen (`SERVER_LEDGER_TOPLEVEL_FIELDS`, `:397`) | admin save path (`?signal=1`) | No | admin-lock signal, NOT withKvLock | MEDIUM |
| Jutsu mastery / equipped / training | `character.jutsuMastery`, `equippedJutsuIds`, top-level `activeJutsuTraining` | SERVER — mastery stored-only (≤100 xp drip non-strict, `:1185-1193`); queue frozen (`:2145`) | training endpoints | No | lock | LOW |
| Bloodlines | `savedBloodlines`, `pendingBloodlineForges` (top-level) | MIXED — content client-authored, budget/rank clamped (`:1586-1698`); rank mint requires server forge entitlement (`:2146-2148`) | bloodlines/forge | No rank mint | lock | LOW |
| Legacies | `character.legacy`, `serverTitles` | SERVER — stored always wins (`:890`, `:857`) | legacy/sage, legacy/trial, admin/legacy | No | lock | LOW |
| Pets | `character.pets`, `activePetId` | SERVER — see caveat below | pet/befriend, choose-starter, progress, evolve, battle-result | Removal only | lock | LOW |
| Mission accept/progress | TOP-LEVEL `acceptedMissionIds`, `missionProgress`, `currentSector`, `triggeredEvents` | **CLIENT** pass-through by design; payouts guarded server-side | generic save | Yes (by design) | lock | LOW |
| Daily/weekly mission state | `dailyMissionsCompleted`, `lastDailyReset`, `lastHuntReset`, `apexWeekClaimed` | SERVER-floored — monotonic dates (`:1934`), same-day floors (`:1949-1958`), `apexWeekClaimed` frozen (`:1161`) | claim-mission | No reset | lock | LOW |
| Story progress | `character.storyProgress`, `redeemedStoryBattles` | SERVER — clamped to stored (`:1137`) | story/settle | No | lock | LOW |
| Exams | `character.examsPassed` | SERVER — replaced with stored list on non-first saves (`:1530`) | exams/pass | No | lock | LOW |
| Exploration | `serverExploreDate`, `serverExploresToday`, `redeemedSectorExplorations`, `totalTilesExplored` | SERVER (`:1106`, `LIFETIME_COUNTERS`) | world/explore | No | lock | LOW |
| Towers (Battle Towers / Endless Spire) | `battleTower*` (delta-0, `:1227-1228`), `endlessTowerRun` frozen (`:1130`) | SERVER | towers/settle, endless/run | No | lock | LOW |
| Hollow Gate | `hollowGateWardenKills` (delta-0, `:1236`), `hollowGateAttunement` (`ALWAYS_SERVER`, `:368` + `:967`) | SERVER | hollow-gate/* | No | lock | LOW |
| Clan membership | `character.clan` cross-checked vs `save:clan-<slug>.members` (`:2237-2280`) | SERVER-validated | clan join flow | No forge | lock | LOW |
| Clan points / treasury | points frozen (`SERVER_OWNED_CLAN_POINT_FIELDS`, `:239`); treasury `save:clan-<slug>` | SERVER | clan/treasury/donate\|transfer (dual-lock, escrow) | No | dual withKvLock | LOW |
| Clan shared record | `save:clan-<slug>` | SHARED — `validateClanSaveWrite` field-level role gating; NO version stamp (excluded, `:2709`) | clan members | Last-writer-wins on unguarded fields | lock | MEDIUM |
| Village state / war | `world-state.ts` keys + character merit fields (delta-0) | SERVER | village/* | No | lock | LOW (key internals INFERRED) |
| Sector state | `world:travel-lease:*`, presence keys; client `currentSector` | MIXED — lease server-auth; `currentSector` client | travel-lease | `currentSector` yes (by design) | lock on lease | LOW |
| Cards / packs | `character.tileCards` — fully entitled (`preserveEntitledStringArray`, `:1792`); `cardClashDeck` validated vs owned | SERVER | card-clash/open-pack, claim-starter | No | lock | LOW |
| Crafting / named forging | `redeemedCrafts` / `redeemedNamedForges` frozen (`:1118-1121`) | SERVER | craft/*, craft/named | No | lock | LOW |
| Titles | `customTitle` moderated + frozen to stored on non-first saves (`:1031-1035`); `serverTitles` / `earnedTitles` frozen | SERVER | player/profile-title | No | lock | LOW |
| Achievements | `unlockedAchievements`, `achievementUnlockedAt`, `claimedAchievementRewards`, `earnedTitles` frozen (`:1124-1127`) | SERVER — only `/api/achievements/sync` writes (b9a5b4b6a protections VERIFIED) | achievements/sync | No | lock | LOW |
| Daily claim stamps | `claimedVillageAgendaDate` etc. in `SERVER_PAYOUT_CHARACTER_FIELDS` (`:386`) + date-locked (`:1874`) | SERVER | claim endpoints | No backdate | lock | LOW |
| Pending rewards / receipts | `pendingCombatMissionClaims` (`:1538`), `serverSettlementReceipts` (`:373`), `_trainingReceipts` (`:398`), quest seals (`:399-400`) | SERVER | domain endpoints | No | lock | LOW |
| Preferences / cosmetics | nindo, nindoBg, avatarImage | CLIENT (moderated; avatar Patreon-gated `:2129`) | generic save | Yes (harmless) | lock | LOW |
| Shared images | `shared:img:<id>`, `img-owner:<id>`, manifests `shared:images:<cat>` / `shared:imgfields:<cat>` (`api/images.ts:131-143,310,500`) | SERVER (owner-tracked) | /api/images | N/A | INFERRED | LOW |
| Patreon flag, weaponElements, ranked ratings | character | SERVER (`ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS`, `:371-384`; ratings rise-rejected `:1310`) | webhook / dedicated endpoints | No | lock | LOW |

## Key mechanisms (VERIFIED)

### Sanitizer freeze lists — `api/save/[name].ts`

`sanitizeCharacterSave` (`:760-2169`), applied to every non-admin player save at `:2581`:

- `ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS` (`:371-384`) — bankRyo, rankedRating,
  petRankedRating, professionXp/Rank, serverSettlementReceipts, patreon,
  weaponElements — copied from stored on EVERY save (`enforceRawSaveLedgerBoundary`, `:597`).
- `SERVER_PAYOUT_CHARACTER_FIELDS` (`:386-395`) — 19 claim-stamp/latch fields, always
  copied from stored (`:598`).
- `STRICT_SERVER_LEDGER_CHARACTER_FIELDS` (`:362-369`) — level/xp/ryo/all
  currencies/stats/maxes/attunement/ratings — applied on first save always
  (`:601`) and on ALL saves only when `STRICT_RAW_SAVE_LEDGER=1` (`:630`).
  **The flag is not yet flipped on Railway** (REQUIRES LIVE-DATA VERIFICATION for
  the actual env value), so the live boundary today is the softer per-field clamps.
- `SERVER_LEDGER_TOPLEVEL_FIELDS` (`:397-403`) — `_trainingReceipts`,
  `activeTraining`, quest seals, all `creator*` top-level — stored copy wins (`:2156-2159`).
- Inline freezes: xp `:926`, ryo-gain cap `:937`, bankRyo `:942`, currencies
  `:946`, clan points `:956`, legacy `:890`, serverTitles `:857`, masterySpec
  `:1028`, customTitle `:1031`, redeemed*/server* ledgers `:1098-1151`,
  achievements `:1124`, endless tower `:1130`, storyProgress `:1137`, 32-field
  frozen list `:1161`, jutsuMastery `:1185`, `LIFETIME_COUNTERS` delta-0 map
  `:1207-1262`, ratings `:1310`, pets `:1345`, tileCards `:1792`, examsPassed
  `:1530`, hospital timer `:1975-2018`, character-level `creator*` deleted
  `:1852`, activeTraining/activeJutsuTraining `:2144-2145`,
  pendingBloodlineForges `:2148`, worldGeoV `:2165`.
- CLIENT-owned pass-throughs (NOT frozen, by design): top-level
  `acceptedMissionIds`, `missionProgress`, `currentSector`, `triggeredEvents`,
  `currentBiome`, `pendingAiProfileId` (only in `COMBAT_STRIP_TOPLEVEL_FIELDS`
  `:192-198`, a read projection); hp/chakra/stamina (≤max, `:1197`),
  equippedJutsuIds (capped), nindo, battleHistory (size-capped `:1830`),
  in-flight `endlessTowerRun`/`hollowGateRun` shape (clamped only).

### Stale-write protection

Stored `_saveVersion` + client-echoed `_baseSaveVersion`:

- Missing stamp on a player save → 426 reject (`isVersionlessPlayerSave`,
  `[name].ts:2725`, `_save-version.ts:66`).
- `baseVersion < storedVersion` → 409 (`:2735`); every successful write bumps
  (`nextSaveVersion`, `:2741`); every server credit bumps too (`bumpSaveVersion`,
  `_save-version.ts:96` — the comment documents the original clobber root cause).
- Client: `App.tsx:3625` echoes the version; `:3632`/`:4500` handle 409 via
  `refetchAfterSaveConflict` (`:4463`); `lib/save-flight.ts` serializes
  concurrent autosave triggers.
- GET-side elapsed-state settle persists (and bumps) only for the OWNER
  (`:2336-2338`), preventing foreign-read-induced 409s.
- **Nit (VERIFIED):** a `baseVersion` GREATER than stored is accepted (only `<`
  rejected). Harmless for state (sanitizer clamps), but a forged high version
  does not error.
- **Clan saves have NO version guard** (excluded at `:2709`) — field-delta
  validation only; last-writer-wins on unguarded clan fields.

### mutatePlayerSave

`api/save/_mutate-player-save.ts` — wraps
`withKvLock('save:<name>', { failClosed: true })` + `writeVersionedPlayerSave`
(version bump + `mergePreservingImages`). ~66 non-test endpoints import it
(bank, achievements, shops, training, story, pets, cards, craft, clan treasury,
exams, endless, dungeon, hollow-gate, world, weapons, village, missions,
bloodlines, aura, awakening, events, hunter, pvp vanguard rewards, stat-respec,
profile-title, cafeteria, professions, festival, war, shrine, profile settle,
inventory, war-mission, jutsu training, travel-lease). A second cohort
hand-rolls the identical pattern (withKvLock + bumpSaveVersion):
`pvp/claim-rewards.ts` (`:63,:197,:279,:394`), `missions/claim-mission.ts`
(`:219,:284,:474`), `pet/battle-result.ts` (dual-lock `:334,:381`),
`legacy/sage.ts` (`:306,:318`), `_elapsed-state.ts` settle (`:296,:309-310`) —
all VERIFIED locked+versioned. Remaining `kv.set(save:...)` writers (~40 files,
e.g. sector/wanderer-*, village/claim-*, missions/report-raid,
player/daily-login) are INFERRED to follow the pattern (guard tests
`_versioned-save-writes.test.ts`, `_version-echo-coverage.test.ts` exist) but
were not opened per-file.

### Pet roster (historical failure class: befriended pets vanish)

VERIFIED protected, with one caveat. `[name].ts:1329-1373`: a submitted pet id
not in the stored roster is DROPPED whenever `strictLedger ||
existingPets.length > 0` (`:1348`). For existing pets, `PET_IDENTITY_FIELDS`
(`:1333-1341`) are forced from stored — a generic save can remove a pet but not
train/rename/fabricate one. Canonical add path: `api/pet/befriend.ts`
(mutatePlayerSave). **Caveat:** legacy carve-out — a save whose stored roster is
EMPTY (non-strict) may add one bounded pet (stats 1–100, no jutsus/level/xp,
`:1349-1354`).

### Whole-save writes without a lock

None found on critical currency paths. The generic save POST runs inside
`withKvLock('save:<name>', { failClosed: true })` (`[name].ts:2543, 2786`);
LockContendedError → 429 (`:2793`). Two verified exceptions:

1. **Admin save path** (`?signal=1`, `[name].ts:2800-2826`) — reads/writes
   `save:<name>` with NO withKvLock. It sets `admin-lock:<name>` (concurrent
   player autosaves return `persisted:false`), but the lock is set before its
   own read, so a player-locked write in flight at that instant can interleave.
   Admin-only, version-bumped; low practical risk but the odd one out.
2. **Gains-window** (`ratelimit:save:<name>:gains`) and no-version telemetry are
   non-atomic read-modify-write — acknowledged best-effort in comments
   (`:2199`, `:303-321`).

### Residual by-design softness (until `STRICT_RAW_SAVE_LEDGER=1`)

- Ryo mintable ≤1,000/save, ≤5M/min window (`:937`, `:281`).
- Jutsu XP drip ≤100/save (`:1190`).
- One net-new non-server-owned inventory item per save (`:1462`).
- Non-strict inventory/itemStacks presence-checked, not count-consumed, for
  equipment (`:511-537` comment).
- Empty-roster pet carve-out (above).

### Storage & auth context

- `api/_storage.ts`: `kv` adapter over Supabase `public.kv_store`, with a 10s
  in-process LRU read cache — `save:` keys ARE cached 10s; cross-instance
  staleness is bounded by the lock + version guard.
- `api/_auth.ts`: token-first (`x-player-token` HMAC vs `SESSION_SECRET`, epoch
  revocation via `auth-session:<name>`); client `authFetch.ts` keeps the token
  in localStorage, password memory-only once a token exists.
- Foreign reads get an allowlist DTO (`buildPublicSaveDTO` `:112`,
  `PUBLIC_CHAR_FIELDS` `:54`, empty top-level `:66`) with the admin-slot
  shared-content exception (`:97`) and a forged-item strip on the way out (`:140`).

## Requires live-data verification

- Actual production value of `STRICT_RAW_SAVE_LEDGER` on Railway.
- Whether any live saves still carry pre-version-stamp state (426 path traffic).
- Existing corrupted/duplicated live records (pets, inventory, receipts).
- Whether the empty-roster pet carve-out is still exercised by real accounts.
