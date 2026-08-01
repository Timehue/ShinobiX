/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  Canonical save state-ownership manifest (P0-1).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ONE definition per save field, tagged with the ownership category it has on
 * CURRENT main and the enforcement boundaries that consume it. Every list the
 * save sanitizer / projections used to hold as a separate literal is now
 * DERIVED from this table (see the exports at the bottom), so a field's
 * ownership story lives in exactly one place.
 *
 * This module records the truth as extracted in Phase 0
 * (docs/audits/state-ownership-audit.md) — it does NOT redesign ownership.
 * Behavior parity with the pre-extraction literals is pinned by
 * _ownership-golden-master.test.ts and _state-ownership-parity.test.ts.
 *
 * How to classify a NEW field: docs/architecture/state-ownership-contract.md.
 * The short version — add exactly one entry here; the ratchet test
 * (_state-ownership-ratchet.test.ts) fails if a high-risk field ships without
 * one. Ordering note: only the `public-char` boundary is order-sensitive (it
 * drives HTTP response key order); every other derived list feeds Sets,
 * delete-loops, or copy-loops whose targets persist to Postgres jsonb, where
 * key order is not preserved — membership is the contract there.
 */

/** Who may durably change the field, per current main. */
export type OwnershipCategory =
    /** Balance/rating/progression ledger — only server domain endpoints may raise it; the sanitizer re-asserts or clamps toward stored on generic saves. */
    | 'server-ledger'
    /** Domain state written only by dedicated server endpoints; the sanitizer copies the stored value over anything a generic save sends. */
    | 'server-owned'
    /** Claim stamp / latch / receipt that gates a payout; server writes it in the same save write as the payout. */
    | 'server-payout-stamp'
    /** Client-writable but numerically clamped, floored, or delta-capped by the sanitizer (compat headroom until STRICT_RAW_SAVE_LEDGER=1). */
    | 'server-clamped'
    /** Recomputed server-side from other validated fields; the client-sent value is ignored. */
    | 'derived'
    /** Client-owned gameplay state by design (payouts are guarded elsewhere, server-side). */
    | 'client-state'
    /** Free-form player preference; moderated/normalized but client-owned. */
    | 'client-preference'
    /** Cosmetic reference (preset ids, image refs); allowlisted or entitlement-gated. */
    | 'cosmetic-ref'
    /** Admin-authored global content living on the admin1/admin2 slots. */
    | 'shared-admin-content'
    /** Player-authored personal content (forged gear, saved bloodlines) — clamped/budgeted, never shared. */
    | 'personal-authored'
    /** Retired field kept only as rollback ballast; frozen to stored. */
    | 'deprecated'
    /** Must never exist at this scope on a player save; the sanitizer deletes it outright. */
    | 'forbidden';

/** Where the field lives. `pet` = per-entry fields of character.pets[]. */
export type FieldScope = 'top' | 'character' | 'pet';

/**
 * Enforcement boundaries — each tag corresponds to one derived list consumed
 * by api/save/[name].ts. A field may sit behind several boundaries.
 */
export type SaveBoundary =
    | 'strict-ledger-char'       // copied from stored on first save always; on every save when STRICT_RAW_SAVE_LEDGER=1
    | 'always-ledger-char'       // copied from stored on EVERY save regardless of the flag
    | 'payout-char'              // claim stamps: copied from stored on every save
    | 'ledger-toplevel'          // top-level: stored copy wins on every non-first save
    | 'shared-admin-content'     // published from admin1/admin2 via the shared-content projection
    | 'public-char'              // exposed to any logged-in player (ORDER-SENSITIVE: response key order)
    | 'public-combat-toplevel'   // additionally exposed on a ?combatOnly=1 scouting read
    | 'combat-strip-char'        // removed from the owner's ?combatOnly=1 projection
    | 'combat-strip-toplevel'    // removed from the owner's ?combatOnly=1 projection (top level)
    | 'currency-zero-gain'       // per-save gain cap 0 — decreases pass, increases rejected
    | 'clan-points-char'         // server-issued clan point fields: stored copy wins
    | 'lifetime-counter-char'    // monotonic counter, client delta 0
    | 'server-mirror-char'       // copy-if-defined-else-delete from stored on every save
    | 'progression-entitlement-char' // copy-if-defined-else-delete from stored on non-first saves
    | 'server-array-ledger-char' // copy-if-array-else-delete from stored on every save
    | 'boolean-latch-char'       // kept only if stored === true
    | 'daily-claim-date-char'    // non-empty incoming must equal server UTC today, else reverted
    | 'monotonic-date-char'      // incoming may never move earlier than stored
    | 'forbidden-creator-char'   // deleted from character on every save
    | 'pet-identity';            // per-pet fields forced from the stored roster entry

export interface SaveFieldDef {
    readonly field: string;
    readonly scope: FieldScope;
    readonly category: OwnershipCategory;
    /** Domain label for humans and audits. */
    readonly domain: string;
    readonly boundaries: readonly SaveBoundary[];
    /** Why it is classified this way / which endpoint owns it, when not obvious. */
    readonly note?: string;
}

const f = (
    field: string,
    scope: FieldScope,
    category: OwnershipCategory,
    domain: string,
    boundaries: readonly SaveBoundary[],
    note?: string,
): SaveFieldDef => ({ field, scope, category, domain, boundaries, note });

/**
 * The contract. Sections are ordered so that the one order-sensitive derived
 * list (`public-char`) reads off in exactly its historical order; all other
 * derived lists inherit table order, which is not behavior (see header).
 */
export const SAVE_FIELD_CONTRACT: readonly SaveFieldDef[] = [
    // ── Identity & public profile (public-char order is load-bearing) ───────
    f('name', 'character', 'server-clamped', 'identity', ['public-char'], 'length-capped display name'),
    f('level', 'character', 'derived', 'progression', ['public-char', 'strict-ledger-char'], 'recomputed from the validated stat ledger (applyDerivedLevel); client value ignored'),
    f('village', 'character', 'server-owned', 'identity', ['public-char'], 'locked; changes cross-validated (validateClanAndVillageIdentity)'),
    f('rank', 'character', 'server-owned', 'progression', ['public-char']),
    f('avatarImage', 'character', 'cosmetic-ref', 'cosmetics', ['public-char'], 'preset/own-reference free; custom values Patreon-gated'),
    f('specialty', 'character', 'client-state', 'combat-loadout', ['public-char']),
    f('storyProgress', 'character', 'server-owned', 'story', ['public-char'], 'clamped to stored; advanced only by story/settle'),
    f('hp', 'character', 'server-clamped', 'vitals', ['public-char'], 'clamped to maxHp'),
    f('maxHp', 'character', 'derived', 'vitals', ['public-char', 'strict-ledger-char']),
    f('chakra', 'character', 'server-clamped', 'vitals', ['public-char']),
    f('maxChakra', 'character', 'derived', 'vitals', ['public-char', 'strict-ledger-char']),
    f('stamina', 'character', 'server-clamped', 'vitals', ['public-char']),
    f('maxStamina', 'character', 'derived', 'vitals', ['public-char', 'strict-ledger-char']),
    f('customTitle', 'character', 'server-owned', 'titles', ['public-char'], 'moderated on set; non-first saves frozen to stored (profile-title endpoint writes it)'),
    f('hospitalized', 'character', 'server-clamped', 'vitals', ['public-char']),
    f('hospitalizedUntil', 'character', 'server-clamped', 'vitals', ['public-char'], 'timer window validated against stored'),
    f('hospitalizedAt', 'character', 'server-clamped', 'vitals', [], 'hospital timer bookkeeping, window-validated'),
    f('lastDischargeAt', 'character', 'server-clamped', 'vitals', [], 'discharge grace-window stamp'),
    f('profession', 'character', 'server-owned', 'profession', ['public-char'], 'locked to stored; only /api/profession/choose sets it'),
    f('professionRank', 'character', 'derived', 'profession', ['public-char', 'strict-ledger-char', 'always-ledger-char'], 'recomputed from capped professionXp'),
    f('professionXp', 'character', 'server-ledger', 'profession', ['public-char', 'strict-ledger-char', 'always-ledger-char'], 'gains rejected; only server endpoints raise it'),

    // ── Wallet & currencies ─────────────────────────────────────────────────
    f('ryo', 'character', 'server-clamped', 'currency', ['strict-ledger-char', 'combat-strip-char'], 'decrease free; gain ≤1,000/save until strict flip, then frozen'),
    f('bankRyo', 'character', 'server-ledger', 'currency', ['strict-ledger-char', 'always-ledger-char', 'combat-strip-char'], 'bank endpoints only'),
    f('lastBankInterestAt', 'character', 'server-payout-stamp', 'currency', ['payout-char', 'combat-strip-char']),
    f('honorSeals', 'character', 'server-ledger', 'currency', ['strict-ledger-char', 'currency-zero-gain', 'combat-strip-char']),
    f('fateShards', 'character', 'server-ledger', 'currency', ['strict-ledger-char', 'currency-zero-gain', 'combat-strip-char']),
    f('boneCharms', 'character', 'server-ledger', 'currency', ['strict-ledger-char', 'currency-zero-gain', 'combat-strip-char']),
    f('auraStones', 'character', 'server-ledger', 'currency', ['strict-ledger-char', 'currency-zero-gain', 'combat-strip-char']),
    f('auraDust', 'character', 'server-ledger', 'currency', ['strict-ledger-char', 'currency-zero-gain', 'combat-strip-char']),
    f('mythicSeals', 'character', 'server-ledger', 'currency', ['strict-ledger-char', 'currency-zero-gain', 'combat-strip-char']),
    f('hollowShards', 'character', 'server-ledger', 'currency', ['strict-ledger-char', 'currency-zero-gain', 'combat-strip-char']),

    // ── Stats & progression ledger ──────────────────────────────────────────
    f('xp', 'character', 'deprecated', 'progression', ['strict-ledger-char'], 'XP retired game-wide; frozen to stored as rollback ballast'),
    f('experience', 'character', 'deprecated', 'progression', ['strict-ledger-char'], 'legacy alias of xp; frozen to stored'),
    f('stats', 'character', 'server-ledger', 'progression', ['strict-ledger-char'], 'spend-only via preserveStatPointEntitlement'),
    f('unspentStats', 'character', 'server-ledger', 'progression', ['strict-ledger-char'], 'entitlement pool; spend-only'),
    f('totalStatsTrained', 'character', 'server-ledger', 'progression', ['strict-ledger-char', 'lifetime-counter-char', 'combat-strip-char']),
    f('rankTitle', 'character', 'derived', 'progression', ['strict-ledger-char'], 'derived with level'),
    f('auraSphereLevel', 'character', 'server-owned', 'progression', ['strict-ledger-char', 'progression-entitlement-char'], 'aura/feed endpoint'),
    f('hollowGateAttunement', 'character', 'server-owned', 'hollow-gate', ['strict-ledger-char', 'combat-strip-char'], 'attune endpoint; ranks additionally clamped to the node catalog'),
    f('rankedRating', 'character', 'server-ledger', 'pvp', ['strict-ledger-char', 'always-ledger-char'], 'pvp/claim-rewards only; increases via save rejected'),
    f('petRankedRating', 'character', 'server-ledger', 'pets', ['strict-ledger-char', 'always-ledger-char'], 'pet/battle-result only; increases via save rejected'),
    f('serverSettlementReceipts', 'character', 'server-payout-stamp', 'receipts', ['always-ledger-char'], 'idempotency receipts written in the payout write'),
    f('patreon', 'character', 'server-owned', 'entitlements', ['always-ledger-char'], 'signature-verified webhook only'),
    f('weaponElements', 'character', 'server-owned', 'equipment', ['always-ledger-char'], 'apply-elemental-core endpoint only'),
    f('levelLedgerMigrated', 'character', 'derived', 'progression', [], 'one-time ledger-migration latch, server-managed'),
    f('createdAt', 'character', 'server-owned', 'identity', ['combat-strip-char'], 'immutable once stamped (anti-alt reference)'),

    // ── Claim stamps & payout latches ───────────────────────────────────────
    f('lastLoginRewardDate', 'character', 'server-payout-stamp', 'daily-login', ['payout-char']),
    f('loginStreak', 'character', 'server-payout-stamp', 'daily-login', ['payout-char']),
    f('academyChecklistClaimed', 'character', 'server-payout-stamp', 'academy', ['payout-char']),
    f('academyTrialClaimed', 'character', 'server-payout-stamp', 'academy', ['payout-char']),
    f('cardClashDailyWinDate', 'character', 'server-payout-stamp', 'card-clash', ['payout-char']),
    f('claimedWarCrateIds', 'character', 'server-payout-stamp', 'village-war', ['payout-char', 'server-array-ledger-char', 'combat-strip-char'], 'listed in BOTH the payout copy and the array-ledger copy — the payout copy (last) wins; duplication preserved from pre-manifest code'),
    f('claimedVillageAgendaDate', 'character', 'server-payout-stamp', 'village', ['payout-char', 'daily-claim-date-char', 'combat-strip-char'], 'date-lock also applies but the later payout copy supersedes it (preserved duplication)'),
    f('claimedMapControlDate', 'character', 'server-payout-stamp', 'village', ['payout-char', 'daily-claim-date-char', 'combat-strip-char'], 'same duplication as claimedVillageAgendaDate'),
    f('warGroundBountyDate', 'character', 'server-clamped', 'village-war', ['daily-claim-date-char'], 'date-locked to server UTC today; within-day re-mint blocked by the ryo/fateShards floor'),
    f('lastExpeditionClaimDate', 'character', 'server-payout-stamp', 'pets', ['payout-char', 'combat-strip-char']),
    f('expeditionsClaimedToday', 'character', 'server-payout-stamp', 'pets', ['payout-char', 'combat-strip-char']),
    f('petEscortBonusReady', 'character', 'server-payout-stamp', 'pets', ['payout-char', 'combat-strip-char']),
    f('dailyHonorSealsEarned', 'character', 'server-payout-stamp', 'pvp', ['payout-char', 'combat-strip-char']),
    f('dailyHonorSealsByTarget', 'character', 'server-payout-stamp', 'pvp', ['payout-char', 'combat-strip-char']),
    f('vanguardDailyResetDate', 'character', 'server-payout-stamp', 'pvp', ['payout-char', 'combat-strip-char']),
    f('dailyDonatedSeals', 'character', 'server-payout-stamp', 'clan', ['payout-char', 'combat-strip-char']),
    f('dailyDonationDate', 'character', 'server-payout-stamp', 'clan', ['payout-char', 'combat-strip-char']),
    f('pendingCombatMissionClaims', 'character', 'server-payout-stamp', 'missions', ['payout-char'], 'durable combat-win claims queued by queue-combat-claim'),
    f('battleTowerClaimedRewards', 'character', 'server-payout-stamp', 'towers', ['payout-char', 'combat-strip-char']),
    f('battleTowerAssistRewardsClaimed', 'character', 'server-payout-stamp', 'towers', ['payout-char', 'combat-strip-char']),
    f('lastTaxDate', 'character', 'server-payout-stamp', 'village', ['payout-char']),

    // ── Server-mirrored redemption ledgers & counters (copy-if-defined) ─────
    f('serverExploreDate', 'character', 'server-owned', 'exploration', ['server-mirror-char'], 'world/explore only'),
    f('serverExploresToday', 'character', 'server-owned', 'exploration', ['server-mirror-char']),
    f('redeemedSectorExplorations', 'character', 'server-payout-stamp', 'exploration', ['server-mirror-char']),
    f('serverChestDate', 'character', 'server-owned', 'exploration', ['server-mirror-char'], 'world/open-chest only'),
    f('serverChestsToday', 'character', 'server-owned', 'exploration', ['server-mirror-char']),
    f('redeemedAncientChests', 'character', 'server-payout-stamp', 'exploration', ['server-mirror-char']),
    f('unlockedAchievements', 'character', 'server-owned', 'achievements', ['server-mirror-char', 'combat-strip-char'], 'achievements/sync only'),
    f('achievementUnlockedAt', 'character', 'server-owned', 'achievements', ['server-mirror-char', 'combat-strip-char']),
    f('claimedAchievementRewards', 'character', 'server-payout-stamp', 'achievements', ['server-mirror-char']),
    f('earnedTitles', 'character', 'server-owned', 'titles', ['server-mirror-char'], 'achievement grants; feeds customTitle ownership checks'),
    f('endlessTowerRun', 'character', 'server-owned', 'endless-tower', ['server-mirror-char', 'combat-strip-char'], 'endless/run only'),
    f('endlessTowerBestWave', 'character', 'server-owned', 'endless-tower', ['server-mirror-char', 'combat-strip-char']),
    f('totalEndlessTowerWins', 'character', 'server-owned', 'endless-tower', ['server-mirror-char', 'lifetime-counter-char', 'combat-strip-char'], 'both mirrored and delta-0 clamped (mirror runs first; clamp is then a no-op) — preserved duplication'),
    f('dailyTowerXp', 'character', 'server-owned', 'endless-tower', ['server-mirror-char']),
    f('dailyEndlessRuns', 'character', 'server-owned', 'endless-tower', ['server-mirror-char']),
    f('dailyEndlessDate', 'character', 'server-owned', 'endless-tower', ['server-mirror-char']),
    f('redeemedEndlessActions', 'character', 'server-payout-stamp', 'endless-tower', ['server-mirror-char']),

    // ── Server array ledgers (copy-if-array) ────────────────────────────────
    f('redeemedTrainingTokens', 'character', 'server-payout-stamp', 'training', ['server-array-ledger-char']),
    f('redeemedJutsuTrainingActions', 'character', 'server-payout-stamp', 'training', ['server-array-ledger-char']),
    f('redeemedAiFightRewards', 'character', 'server-payout-stamp', 'missions', ['server-array-ledger-char']),
    f('redeemedShopPurchases', 'character', 'server-payout-stamp', 'shop', ['server-array-ledger-char']),
    f('redeemedShopSales', 'character', 'server-payout-stamp', 'shop', ['server-array-ledger-char']),
    f('redeemedCrafts', 'character', 'server-payout-stamp', 'crafting', ['server-array-ledger-char']),
    f('redeemedNamedForges', 'character', 'server-payout-stamp', 'crafting', ['server-array-ledger-char']),
    f('redeemedStoryBattles', 'character', 'server-payout-stamp', 'story', ['server-array-ledger-char']),
    f('redeemedPetEncounters', 'character', 'server-payout-stamp', 'pets', ['server-array-ledger-char']),
    f('claimedCreatorEvents', 'character', 'server-payout-stamp', 'events', ['server-array-ledger-char']),
    f('redeemedCardClashAiSessions', 'character', 'server-payout-stamp', 'card-clash', ['server-array-ledger-char'], 'P0-2: per-session AI-match payout receipts (card-clash/ai-move settle)'),

    // ── One-time boolean latches ────────────────────────────────────────────
    f('academySparClaimed', 'character', 'server-payout-stamp', 'academy', ['boolean-latch-char'], 'story/settle'),
    f('starterPetClaimed', 'character', 'server-payout-stamp', 'pets', ['boolean-latch-char']),
    f('starterCardsClaimed', 'character', 'server-payout-stamp', 'card-clash', ['boolean-latch-char'], 'card-clash/claim-starter'),

    // ── Progression entitlements (non-first-save stored copy) ───────────────
    f('redeemedAuraFeeds', 'character', 'server-payout-stamp', 'progression', ['progression-entitlement-char']),
    f('battleTowerAscension', 'character', 'server-owned', 'towers', ['progression-entitlement-char']),
    f('rankedSeasonsWon', 'character', 'server-owned', 'pvp', ['progression-entitlement-char']),
    f('weeklyBossKills', 'character', 'server-owned', 'weekly-boss', ['progression-entitlement-char', 'combat-strip-char']),
    f('defeatedAiIds', 'character', 'server-owned', 'missions', ['progression-entitlement-char', 'combat-strip-char']),
    f('hunterRank', 'character', 'server-owned', 'hunter-guild', ['progression-entitlement-char', 'combat-strip-char'], 'hunter/rank-up only'),
    f('redeemedHunterRanks', 'character', 'server-payout-stamp', 'hunter-guild', ['progression-entitlement-char']),
    f('apexWeekClaimed', 'character', 'server-payout-stamp', 'hunter-guild', ['progression-entitlement-char'], 'the ONLY guard on the weekly Apex purse'),
    f('element', 'character', 'server-owned', 'progression', ['progression-entitlement-char'], 'awakening rolls only'),
    f('elements', 'character', 'server-owned', 'progression', ['progression-entitlement-char']),
    f('claimedAwakenings', 'character', 'server-payout-stamp', 'progression', ['progression-entitlement-char']),
    f('redeemedAwakeningActions', 'character', 'server-payout-stamp', 'progression', ['progression-entitlement-char']),
    f('elderFocus', 'character', 'server-owned', 'village', ['progression-entitlement-char', 'combat-strip-char']),
    f('activeDungeonRun', 'character', 'server-owned', 'hollow-gate', ['progression-entitlement-char']),
    f('redeemedDungeonRuns', 'character', 'server-payout-stamp', 'hollow-gate', ['progression-entitlement-char']),
    f('redeemedHollowGateRuns', 'character', 'server-payout-stamp', 'hollow-gate', ['progression-entitlement-char']),
    f('redeemedPetBattleTokens', 'character', 'server-payout-stamp', 'pets', ['progression-entitlement-char']),
    f('redeemedPetExpeditionTokens', 'character', 'server-payout-stamp', 'pets', ['progression-entitlement-char']),
    f('claimedServerMissions', 'character', 'server-payout-stamp', 'missions', ['progression-entitlement-char'], 'per-day mission claim receipts'),
    f('redeemedPetGauntletRuns', 'character', 'server-payout-stamp', 'pets', ['progression-entitlement-char']),
    f('petGauntletRewardDate', 'character', 'server-payout-stamp', 'pets', ['progression-entitlement-char']),
    f('petGauntletRewardCount', 'character', 'server-payout-stamp', 'pets', ['progression-entitlement-char']),
    f('petGauntletPremiumDate', 'character', 'server-payout-stamp', 'pets', ['progression-entitlement-char']),
    f('petGauntletFateClaimed', 'character', 'server-payout-stamp', 'pets', ['progression-entitlement-char']),
    f('petGauntletBoneClaimed', 'character', 'server-payout-stamp', 'pets', ['progression-entitlement-char']),
    f('redeemedWandererQuests', 'character', 'server-payout-stamp', 'wanderers', ['progression-entitlement-char']),
    f('redeemedWandererAmbushes', 'character', 'server-payout-stamp', 'wanderers', ['progression-entitlement-char']),
    f('wandererAmbushRewardDate', 'character', 'server-payout-stamp', 'wanderers', ['progression-entitlement-char']),
    f('wandererAmbushRewardCount', 'character', 'server-payout-stamp', 'wanderers', ['progression-entitlement-char']),
    f('redeemedQuestbookRuns', 'character', 'server-payout-stamp', 'wanderers', ['progression-entitlement-char']),
    f('villageUpgrades', 'character', 'server-owned', 'village', ['progression-entitlement-char'], 'drives bank interest rate among others'),

    // ── Lifetime / leaderboard counters (client delta 0) ────────────────────
    f('totalPvpKills', 'character', 'server-owned', 'counters', ['lifetime-counter-char', 'combat-strip-char']),
    f('totalAiKills', 'character', 'server-owned', 'counters', ['lifetime-counter-char', 'combat-strip-char']),
    f('totalVillageRaids', 'character', 'server-owned', 'counters', ['lifetime-counter-char', 'combat-strip-char']),
    f('warsWon', 'character', 'server-owned', 'counters', ['lifetime-counter-char']),
    f('warMvpCount', 'character', 'server-owned', 'counters', ['lifetime-counter-char']),
    f('lifetimeWarDamage', 'character', 'server-owned', 'counters', ['lifetime-counter-char']),
    f('monthlyPvpKills', 'character', 'server-owned', 'counters', ['lifetime-counter-char', 'combat-strip-char']),
    f('dailyAiKills', 'character', 'server-owned', 'counters', ['lifetime-counter-char', 'combat-strip-char']),
    f('totalPetWins', 'character', 'server-owned', 'counters', ['lifetime-counter-char', 'combat-strip-char']),
    f('battleTowerBestFloor', 'character', 'server-owned', 'towers', ['lifetime-counter-char', 'combat-strip-char'], 'towers/settle only'),
    f('battleTowerRating', 'character', 'server-owned', 'towers', ['lifetime-counter-char', 'combat-strip-char']),
    f('battleTowerClearedFloors', 'character', 'server-owned', 'towers', ['combat-strip-char'], 'towers/settle only'),
    f('totalTournamentsCompleted', 'character', 'server-owned', 'counters', ['lifetime-counter-char', 'combat-strip-char']),
    f('totalTilesExplored', 'character', 'server-owned', 'exploration', ['lifetime-counter-char', 'combat-strip-char']),
    f('hollowGateWardenKills', 'character', 'server-owned', 'hollow-gate', ['lifetime-counter-char', 'combat-strip-char']),
    f('rankedWins', 'character', 'server-owned', 'pvp', ['lifetime-counter-char', 'combat-strip-char']),
    f('rankedLosses', 'character', 'server-owned', 'pvp', ['lifetime-counter-char', 'combat-strip-char']),
    f('villageWarMissionsCompleted', 'character', 'server-owned', 'village-war', ['lifetime-counter-char', 'combat-strip-char']),
    f('totalMissionsCompleted', 'character', 'server-owned', 'counters', ['lifetime-counter-char', 'combat-strip-char']),
    f('cardClashWins', 'character', 'server-owned', 'card-clash', ['lifetime-counter-char']),
    f('cardClashLosses', 'character', 'server-owned', 'card-clash', ['lifetime-counter-char']),
    f('cardClashDraws', 'character', 'server-owned', 'card-clash', ['lifetime-counter-char']),

    // ── Clan ────────────────────────────────────────────────────────────────
    f('clanPoints', 'character', 'server-owned', 'clan', ['clan-points-char', 'combat-strip-char']),
    f('weeklyClanPoints', 'character', 'server-owned', 'clan', ['clan-points-char', 'combat-strip-char']),
    f('weeklyClanPointsWeek', 'character', 'server-owned', 'clan', ['clan-points-char', 'combat-strip-char']),
    f('lifetimeClanPoints', 'character', 'server-owned', 'clan', ['clan-points-char', 'combat-strip-char']),
    f('clanPointHistory', 'character', 'server-owned', 'clan', ['clan-points-char', 'combat-strip-char']),
    f('clanExchangePurchases', 'character', 'server-payout-stamp', 'clan', ['clan-points-char', 'combat-strip-char']),
    f('clan', 'character', 'server-clamped', 'clan', [], 'cross-validated against save:clan-<slug> (validateClanAndVillageIdentity)'),
    f('clanFounder', 'character', 'server-clamped', 'clan', [], 'cross-validated; gates seal-pool distribution'),
    f('clanBattleContrib', 'character', 'server-clamped', 'clan', ['combat-strip-char'], 'monthly counter: absMax+delta caps (MONTHLY_CLAN_CONTRIB_CAPS)'),
    f('clanEventContrib', 'character', 'server-clamped', 'clan', ['combat-strip-char'], 'monthly counter caps'),
    f('clanMissionContrib', 'character', 'server-clamped', 'clan', ['combat-strip-char'], 'monthly counter caps'),
    f('clanContribMonth', 'character', 'client-state', 'clan', ['combat-strip-char'], 'month stamp for the client reset'),

    // ── Daily reset stamps & daily counters ─────────────────────────────────
    f('lastDailyReset', 'character', 'server-clamped', 'dailies', ['monotonic-date-char', 'combat-strip-char'], 'monotonic-forward; gates same-day floors'),
    f('lastHuntReset', 'character', 'server-clamped', 'dailies', ['monotonic-date-char'], 'monotonic-forward'),
    f('dailyMissionsCompleted', 'character', 'server-clamped', 'dailies', ['combat-strip-char'], 'floored at stored within the same UTC day'),
    f('dailyHuntsCompleted', 'character', 'server-clamped', 'dailies', [], 'floored at stored within the same UTC day'),
    f('dailyHollowGateRuns', 'character', 'server-clamped', 'hollow-gate', [], 'floored at stored within the same UTC day'),
    f('dailyPetWins', 'character', 'client-state', 'dailies', ['combat-strip-char']),
    f('dailyTilesExplored', 'character', 'client-state', 'dailies', ['combat-strip-char']),
    f('dailyFateSpins', 'character', 'client-state', 'dailies', ['combat-strip-char']),
    f('pvpKillMonth', 'character', 'client-state', 'pvp', ['combat-strip-char']),
    f('villageWarMissionDate', 'character', 'client-state', 'village-war', ['combat-strip-char']),
    f('villageWarRaidProgress', 'character', 'client-state', 'village-war', ['combat-strip-char']),
    f('professionChosenAt', 'character', 'server-owned', 'profession', ['combat-strip-char']),

    // ── Inventory, equipment, jutsu, pets ───────────────────────────────────
    f('inventory', 'character', 'server-clamped', 'inventory', ['combat-strip-char'], 'non-strict: presence-validated + one net-new item carve-out; strict: count-consumed from stored'),
    f('itemStacks', 'character', 'server-clamped', 'inventory', ['combat-strip-char'], 'same regime as inventory'),
    f('equipment', 'character', 'server-clamped', 'equipment', [], 'enforceEquipmentOwnership on every save: slot whitelist, ownership, slot-kind'),
    f('equippedJutsuIds', 'character', 'server-clamped', 'combat-loadout', [], 'capped at maxLoadout; strict: must be learned'),
    f('jutsuMastery', 'character', 'server-owned', 'jutsu', [], 'training endpoints only; non-strict allows ≤100 xp drip on unchanged levels'),
    f('pets', 'character', 'server-owned', 'pets', [], 'roster additions only via befriend flow; identity forced per pet-identity boundary'),
    f('activePetId', 'character', 'server-clamped', 'pets', [], 'must reference an owned pet (strict branch)'),
    f('activePetId2v2', 'character', 'server-clamped', 'pets', [], 'must reference an owned pet (strict branch)'),
    f('tileCards', 'character', 'server-owned', 'cards', ['combat-strip-char'], 'fully entitled — no new card via generic save (preserveEntitledStringArray)'),
    f('savedTileDeck', 'character', 'client-state', 'cards', ['combat-strip-char']),
    f('cardClashDeck', 'character', 'server-clamped', 'card-clash', [], 'validated against owned cards'),
    f('cardClashTutorialVersion', 'character', 'client-preference', 'card-clash', [], 'tutorial-seen marker'),
    f('savedBloodlines', 'character', 'personal-authored', 'bloodlines', [], 'legacy character-scope mirror seeded by the first-save baseline; the live copy is the TOP-LEVEL savedBloodlines'),
    f('battleHistory', 'character', 'client-state', 'combat', ['combat-strip-char'], 'size-capped'),
    f('hollowGateRun', 'character', 'server-clamped', 'hollow-gate', ['combat-strip-char'], 'in-flight run shape-bounded; run token gates ryo freeze'),
    f('hollowGateIntroSeen', 'character', 'client-preference', 'hollow-gate', ['combat-strip-char']),

    // ── Titles / legacy / server vaults ─────────────────────────────────────
    f('serverTitles', 'character', 'server-owned', 'titles', [], 'era grants; stored copy always wins'),
    f('legacy', 'character', 'server-owned', 'legacy', [], 'legacy endpoints only; stored copy always wins'),
    f('customTitleStyle', 'character', 'cosmetic-ref', 'titles', [], 'allowlisted when legacy live; non-first saves frozen to stored'),
    f('customTitleIcon', 'character', 'cosmetic-ref', 'titles', [], 'same as customTitleStyle'),
    f('masterySpec', 'character', 'server-owned', 'profession', [], 'non-first saves frozen to stored'),
    f('examsPassed', 'character', 'server-owned', 'exams', ['combat-strip-char'], 'non-first saves replaced with stored verbatim; exams/pass advances'),

    // ── Preferences & cosmetics ─────────────────────────────────────────────
    f('nindo', 'character', 'client-preference', 'profile', [], 'moderated BBCode creed'),
    f('nindoBg', 'character', 'cosmetic-ref', 'profile', [], 'allowlisted preset id'),
    f('bloodline', 'character', 'client-state', 'bloodlines', [], 'starter bloodline choice; gates the first-save starter jutsu kit'),
    f('missions', 'character', 'client-state', 'missions', ['combat-strip-char']),
    f('missionLog', 'character', 'client-state', 'missions', ['combat-strip-char']),
    f('completedMissions', 'character', 'client-state', 'missions', ['combat-strip-char']),
    f('activeMissions', 'character', 'client-state', 'missions', ['combat-strip-char']),
    f('questLog', 'character', 'client-state', 'missions', ['combat-strip-char']),
    f('bankLog', 'character', 'client-state', 'currency', ['combat-strip-char']),
    f('storyTraits', 'character', 'client-state', 'story', ['combat-strip-char']),
    f('storyTitle', 'character', 'client-state', 'story', ['combat-strip-char']),

    // ── Forbidden at character scope ────────────────────────────────────────
    f('creatorJutsus', 'character', 'forbidden', 'authored-content', ['forbidden-creator-char'], 'authored content lives on save:admin1/2, never on a player character'),
    f('creatorItems', 'character', 'forbidden', 'authored-content', ['forbidden-creator-char']),
    f('creatorAis', 'character', 'forbidden', 'authored-content', ['forbidden-creator-char']),
    f('creatorMissions', 'character', 'forbidden', 'authored-content', ['forbidden-creator-char']),
    f('creatorEvents', 'character', 'forbidden', 'authored-content', ['forbidden-creator-char']),
    f('creatorCards', 'character', 'forbidden', 'authored-content', ['forbidden-creator-char']),
    f('creatorRaids', 'character', 'forbidden', 'authored-content', ['forbidden-creator-char']),

    // ── Top-level fields ────────────────────────────────────────────────────
    f('_trainingReceipts', 'top', 'server-payout-stamp', 'training', ['ledger-toplevel']),
    f('activeTraining', 'top', 'server-owned', 'training', ['ledger-toplevel', 'combat-strip-toplevel'], 'ALSO frozen by an inline `?? null` line the list copy supersedes — preserved duplication'),
    f('activeJutsuTraining', 'top', 'server-owned', 'training', ['combat-strip-toplevel'], 'frozen inline (`existing?.activeJutsuTraining ?? null`) — deliberately NOT in ledger-toplevel; the inline rule keeps an always-present null'),
    f('activeWandererQuestSeal', 'top', 'server-payout-stamp', 'wanderers', ['ledger-toplevel']),
    f('activeStoryReckoningSeal', 'top', 'server-payout-stamp', 'story', ['ledger-toplevel']),
    f('activeRiftQuestSeal', 'top', 'server-payout-stamp', 'hollow-gate', ['ledger-toplevel']),
    f('activeQuestbookSeal', 'top', 'server-payout-stamp', 'wanderers', ['ledger-toplevel']),
    f('creatorJutsus', 'top', 'shared-admin-content', 'authored-content', ['ledger-toplevel', 'shared-admin-content', 'public-combat-toplevel'], 'players: frozen to stored (mirror); admin slots: published content'),
    f('creatorAis', 'top', 'shared-admin-content', 'authored-content', ['ledger-toplevel', 'shared-admin-content', 'combat-strip-toplevel']),
    f('creatorMissions', 'top', 'shared-admin-content', 'authored-content', ['ledger-toplevel', 'shared-admin-content', 'combat-strip-toplevel']),
    f('creatorEvents', 'top', 'shared-admin-content', 'authored-content', ['ledger-toplevel', 'shared-admin-content', 'combat-strip-toplevel']),
    f('creatorCards', 'top', 'shared-admin-content', 'authored-content', ['ledger-toplevel', 'shared-admin-content', 'combat-strip-toplevel']),
    f('creatorRaids', 'top', 'shared-admin-content', 'authored-content', ['ledger-toplevel', 'shared-admin-content', 'combat-strip-toplevel']),
    f('creatorItems', 'top', 'personal-authored', 'authored-content', ['shared-admin-content', 'public-combat-toplevel'], 'players: admin mirror + personal forged gear (budgeted, forged revived); admin slots: published content with forged gear stripped both inbound and outbound; strict mode freezes to stored'),
    f('savedBloodlines', 'top', 'personal-authored', 'bloodlines', ['public-combat-toplevel'], 'content client-authored, budget/rank-entitlement clamped (normalizeBloodlineArray)'),
    f('pendingBloodlineForges', 'top', 'server-payout-stamp', 'bloodlines', [], 'server-owned single-use purchase ledger, rebuilt each save'),
    f('editablePets', 'top', 'shared-admin-content', 'authored-content', ['shared-admin-content', 'combat-strip-toplevel'], 'admin slots only; unvalidated on the ordinary admin-slot path (P0-4 hardening target)'),
    f('petEncounterVn', 'top', 'shared-admin-content', 'authored-content', ['shared-admin-content', 'combat-strip-toplevel']),
    f('ancientChestVn', 'top', 'shared-admin-content', 'authored-content', ['shared-admin-content', 'combat-strip-toplevel']),
    f('hollowGateEventConfig', 'top', 'shared-admin-content', 'authored-content', ['shared-admin-content'], 'recency-merged across slots by consumers'),
    f('acceptedMissionIds', 'top', 'client-state', 'missions', ['combat-strip-toplevel'], 'client-owned by design; payouts guarded server-side'),
    f('missionProgress', 'top', 'client-state', 'missions', ['combat-strip-toplevel']),
    f('currentSector', 'top', 'client-state', 'world', ['combat-strip-toplevel'], 'travel lease is the authority in flight'),
    f('currentBiome', 'top', 'client-state', 'world', ['combat-strip-toplevel']),
    f('triggeredEvents', 'top', 'client-state', 'events', ['combat-strip-toplevel']),
    f('pendingAiProfileId', 'top', 'client-state', 'combat', ['combat-strip-toplevel']),
    f('worldGeoV', 'top', 'server-owned', 'world', [], 'world-geo migration stamp; stored wins, new saves stamped current'),
    f('_saveVersion', 'top', 'server-owned', 'save-meta', [], 'optimistic-concurrency stamp (_save-version.ts); never client-writable'),
    f('_saveAt', 'top', 'server-owned', 'save-meta', [], 'write timestamp'),

    // ── Per-pet identity/progression (character.pets[] entries) ─────────────
    f('id', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('rarity', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('maxLevel', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('jutsus', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('unlockedForPve', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('trait', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('element', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('evolutionStage', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('wildSpawnable', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('role', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('subRole', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('updatedAt', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('level', 'pet', 'server-owned', 'pets', ['pet-identity'], 'pet progression: dedicated pet endpoints only'),
    f('xp', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('hp', 'pet', 'server-owned', 'pets', ['pet-identity'], 'additionally ceiling-clamped by petStatCeil'),
    f('attack', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('defense', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('speed', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('happiness', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('training', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('expedition', 'pet', 'server-owned', 'pets', ['pet-identity']),
    f('nickname', 'pet', 'server-owned', 'pets', ['pet-identity'], 'renames go through the pet endpoints'),
    f('loadout', 'pet', 'server-owned', 'pets', ['pet-identity']),
];

// ── Derivation ──────────────────────────────────────────────────────────────

function fieldsFor(boundary: SaveBoundary, scope?: FieldScope): readonly string[] {
    return SAVE_FIELD_CONTRACT
        .filter((d) => d.boundaries.includes(boundary) && (scope === undefined || d.scope === scope))
        .map((d) => d.field);
}

const zeroRecord = (fields: readonly string[]): Record<string, number> =>
    Object.fromEntries(fields.map((field) => [field, 0]));

// Derived lists — same names and membership as the pre-manifest literals in
// api/save/[name].ts (parity pinned by _state-ownership-parity.test.ts).

/** ORDER-SENSITIVE: drives public-DTO response key order. */
export const PUBLIC_CHAR_FIELDS: ReadonlySet<string> = new Set(fieldsFor('public-char', 'character'));
export const PUBLIC_TOPLEVEL_FIELDS: readonly string[] = [];
export const PUBLIC_COMBAT_TOPLEVEL_FIELDS: readonly string[] = fieldsFor('public-combat-toplevel', 'top');
export const SHARED_ADMIN_CONTENT_FIELDS: readonly string[] = fieldsFor('shared-admin-content', 'top');
export const COMBAT_STRIP_CHAR_FIELDS: readonly string[] = fieldsFor('combat-strip-char', 'character');
export const COMBAT_STRIP_TOPLEVEL_FIELDS: readonly string[] = fieldsFor('combat-strip-toplevel', 'top');
export const STRICT_SERVER_LEDGER_CHARACTER_FIELDS: readonly string[] = fieldsFor('strict-ledger-char', 'character');
export const ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS: readonly string[] = fieldsFor('always-ledger-char', 'character');
export const SERVER_PAYOUT_CHARACTER_FIELDS: readonly string[] = fieldsFor('payout-char', 'character');
export const SERVER_LEDGER_TOPLEVEL_FIELDS: readonly string[] = fieldsFor('ledger-toplevel', 'top');
export const SERVER_OWNED_CLAN_POINT_FIELDS: readonly string[] = fieldsFor('clan-points-char', 'character');
export const CURRENCY_CAPS: Record<string, number> = zeroRecord(fieldsFor('currency-zero-gain', 'character'));
export const LIFETIME_COUNTERS: Record<string, number> = zeroRecord(fieldsFor('lifetime-counter-char', 'character'));
export const SERVER_MIRRORED_CHARACTER_FIELDS: readonly string[] = fieldsFor('server-mirror-char', 'character');
export const PROGRESSION_ENTITLEMENT_CHARACTER_FIELDS: readonly string[] = fieldsFor('progression-entitlement-char', 'character');
export const SERVER_ARRAY_LEDGER_CHARACTER_FIELDS: readonly string[] = fieldsFor('server-array-ledger-char', 'character');
export const BOOLEAN_LATCH_CHARACTER_FIELDS: readonly string[] = fieldsFor('boolean-latch-char', 'character');
export const DAILY_CLAIM_DATE_FIELDS: readonly string[] = fieldsFor('daily-claim-date-char', 'character');
export const MONOTONIC_DATE_CHARACTER_FIELDS: readonly string[] = fieldsFor('monotonic-date-char', 'character');
export const FORBIDDEN_CREATOR_CHARACTER_FIELDS: readonly string[] = fieldsFor('forbidden-creator-char', 'character');
export const PET_IDENTITY_FIELDS: readonly string[] = fieldsFor('pet-identity', 'pet');

/** Every classified (scope, field) pair — the ratchet test's ground truth. */
export function classifiedFieldSet(scope: FieldScope): ReadonlySet<string> {
    return new Set(SAVE_FIELD_CONTRACT.filter((d) => d.scope === scope).map((d) => d.field));
}

/** Look up a field's definitions (a name may exist at several scopes). */
export function definitionsFor(field: string): readonly SaveFieldDef[] {
    return SAVE_FIELD_CONTRACT.filter((d) => d.field === field);
}
