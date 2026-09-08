import {
    CURRENCY_CAPS,
    SERVER_OWNED_CLAN_POINT_FIELDS,
    SERVER_ARRAY_LEDGER_CHARACTER_FIELDS,
    SERVER_MIRRORED_CHARACTER_FIELDS,
    BOOLEAN_LATCH_CHARACTER_FIELDS,
    PROGRESSION_ENTITLEMENT_CHARACTER_FIELDS,
    LIFETIME_COUNTERS,
} from './_state-ownership.js';
import { STAT_CAP_FIELDS } from '../combat-core/formulas.js';
import { preserveStatPointEntitlement } from './_stat-entitlement.js';
import { earnedStatPoints, earnedForLevel, applyDerivedLevel } from '../_xp-engine.js';
import { parseStoryFieldRecords } from '../../shared/story-field-work.js';
import { auraRegenBonus } from '../_elapsed-state.js';
import {
    strictRawSaveLedgerEnabled,
    rankFromXp,
    LEVEL_CAP,
    VITALS_GAIN_GRACE_SEC,
    type VitalKey,
    CLIENT_CONSUMABLE_VITAL_CREDITS,
    countOwnedItem,
    VITAL_KEYS,
} from './_sanitize-ledger.js';

export function sanitizeProgression(
    char: Record<string, unknown>,
    exChar: Record<string, unknown>,
    inChar: Record<string, unknown>,
    existing: Record<string, unknown> | null | undefined,
    isFirstSave: boolean,
    opts: { adminContentSlot?: boolean; now?: number },
) {

    const strictLedger = strictRawSaveLedgerEnabled();

    // Character XP is retired (leveling-without-xp map): `xp` is FROZEN — always
    // re-asserted from the stored save (kept only as pre-wipe rollback ballast) —
    // and `level` is no longer client-writable AT ALL: it is recomputed
    // server-side from the validated stat ledger after the stat-entitlement step
    // below. The old +5-levels / +100-xp per-save allowances are gone with the
    // trust surface they bounded.
    char.xp = Math.max(0, Number(exChar.xp ?? 0));
    if (exChar.experience !== undefined) {
        char.experience = Math.max(0, Number(exChar.experience) || 0);
    } else delete char.experience;

    // Wallet values may decrease through existing client-side sinks, but all
    // increases must already exist in the stored save from a domain command.
    // This is intentionally unconditional. The old compatibility window
    // allowed a client-originated positive ryo delta when
    // STRICT_RAW_SAVE_LEDGER was absent; that made a deployment flag part of
    // the security boundary. Generic saves are now never a currency faucet.
    const exRyo = Math.max(0, Number(exChar.ryo ?? 0));
    const inRyo = Math.max(0, Number(char.ryo ?? 0));
    char.ryo = isFirstSave ? inRyo : Math.min(inRyo, exRyo);

    // Bank principal and its interest clock are server-owned. Deposits,
    // withdrawals, and interest claims all mutate the versioned save under its
    // lock, so an ordinary autosave may only re-assert the stored values.
    char.bankRyo = Math.max(0, Math.floor(Number(exChar.bankRyo) || 0));
    char.lastBankInterestAt = Math.max(0, Math.floor(Number(exChar.lastBankInterestAt) || 0));

    // Premium/material currencies: decreases pass, increases do not.
    for (const [key, maxGain] of Object.entries(CURRENCY_CAPS)) {
        const exVal = Math.max(0, Number(exChar[key] ?? 0));
        const inVal = Math.max(0, Number(char[key] ?? 0));
        char[key] = Math.min(inVal, exVal + maxGain);
    }

    // Personal Clan Points are server-issued only. Activity endpoints and the
    // Clan Exchange purchase path write these fields under the save lock and
    // bump _saveVersion; normal player autosaves may only re-assert the stored
    // values. This prevents both minting and stale autosaves erasing a reward.
    for (const field of SERVER_OWNED_CLAN_POINT_FIELDS) {
        if (exChar[field] !== undefined) char[field] = exChar[field];
        else delete char[field];
    }

    // Hollow Gate Shrine Attunement: node ranks. Anti-tamper — clamp every rank
    // to its catalog maxRank (mirrors ATTUNEMENT_NODES in
    // shinobij.client/src/lib/hollow-gate-attunement.ts) and drop unknown node
    // ids, so a forged save can't over-rank a node (e.g. Extra Dive past its +1
    // daily run, or Seasoned Delver past its +2 starting keys). Keep this map in
    // sync if a node's maxRank changes in the catalog.
    if (char.hollowGateAttunement && typeof char.hollowGateAttunement === 'object') {
        const HG_ATTUNEMENT_MAX_RANK: Record<string, number> = {
            'seasoned-delver': 2, 'reiki-reserves': 2, 'cartographer': 1,
            'greedy-hands': 3, 'extra-dive': 1, 'key-forge': 1,
        };
        const att = char.hollowGateAttunement as Record<string, unknown>;
        const clamped: Record<string, number> = {};
        for (const k of Object.keys(att)) {
            const max = HG_ATTUNEMENT_MAX_RANK[k];
            if (max === undefined) continue; // unknown node — drop it
            const v = Math.max(0, Math.min(max, Math.floor(Number(att[k]) || 0)));
            if (v > 0) clamped[k] = v;
        }
        char.hollowGateAttunement = clamped;
    }

    // Account creation timestamp — backfill if missing so anti-alt checks
    // have a stable reference. Existing characters get a "now" stamp the
    // first time they save after this lands; new characters set it client-
    // side at creation.
    if (!exChar.createdAt && !char.createdAt) {
        char.createdAt = Date.now();
    } else if (exChar.createdAt) {
        // Once stamped, the value is immutable — clients can't claim a fake old age.
        char.createdAt = exChar.createdAt;
    }

    // Profession: lock the profession choice (the server-side picker and its
    // one-time respec flow write it via /api/profession/choose), reject client
    // XP gains, and recompute rank from XP so a malicious client can't claim a
    // higher rank than its XP earns.
    //
    // Two-state lockdown:
    //   • exChar HAS a profession  → preserve it (only the dedicated endpoint
    //     may spend the one-time change and replace it).
    //   • exChar has NO profession → ALSO preserve `undefined`. The dedicated
    //     /api/profession/choose endpoint is the only path that may set the
    //     initial value. Without this branch a fresh-account save POST could
    //     self-grant `profession: 'vanguard'` and immediately unlock the
    //     Vanguard discount path on jutsu/speedup / train-with-seals, or
    //     profession: 'healer' to unlock cross-village healing, etc.
    char.profession = exChar.profession;
    const exProfXp = Math.max(0, Number(exChar.professionXp ?? 0));
    const inProfXp = Math.max(0, Number(char.professionXp ?? 0));
    const cappedProfXp = Math.min(inProfXp, exProfXp);
    char.professionXp = cappedProfXp;
    if (char.profession) {
        char.professionRank = rankFromXp(char.profession, cappedProfXp);
    } else {
        // No profession yet → strip any client-supplied rank too.
        char.professionRank = 0;
    }

    // Profession mastery: clamp the allocation to the budget the player's mastery
    // LEVEL allows (derived from profession XP past rank 10), legal node ranks, and
    // satisfied capstone gates. Anti-tamper — a forged masterySpec can't grant
    // unearned capstones or over-spend. PvE/utility effects only.
    //
    // (#17 ordering) This MUST run AFTER char.profession is locked to exChar's
    // value and char.professionXp is capped above — otherwise masteryBudget()
    // would see the still-raw client professionXp and validate an over-spent
    // tree (or a forged profession). Reads char.professionXp (the capped value).
    if (!isFirstSave) {
        if (exChar.masterySpec !== undefined) char.masterySpec = exChar.masterySpec;
        else delete char.masterySpec;
    }
    if (!isFirstSave) {
        for (const field of ['customTitle', 'customTitleStyle', 'customTitleIcon'] as const) {
            if (exChar[field] !== undefined) char[field] = exChar[field]; else delete char[field];
        }
    }

    // Stat points are an entitlement, not a client-authored gain. Ordinary
    // saves may spend the stored unspent pool or perform the paid full respec,
    // but training/combat must credit new points directly to the stored save.
    const existingStatKeys = exChar.stats && typeof exChar.stats === 'object'
        ? Object.keys(exChar.stats as Record<string, unknown>)
        : [];
    if (!strictLedger && existingStatKeys.length < STAT_CAP_FIELDS.length) {
        char.stats = inChar.stats;
        char.unspentStats = Math.max(0, Math.min(Number(inChar.unspentStats) || 0, Number(exChar.unspentStats) || 0));
    } else {
        const statEntitlement = preserveStatPointEntitlement(char, exChar);
        char.stats = statEntitlement.stats;
        char.unspentStats = statEntitlement.unspentStats;
    }
    // ── Stat-derived level (leveling-without-xp map) ────────────────────────
    // One-time ledger migration: an XP-era save whose earned points don't yet
    // cover its stored level gets the difference as pool points, so nobody
    // de-levels and nobody's progress silently stalls until earned catches up.
    // Computed from the STORED level + the entitlement-validated ledger only.
    if (!exChar.levelLedgerMigrated) {
        const storedLevel = Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(exChar.level) || 1)));
        const earnedNow = earnedStatPoints(char);
        const need = earnedForLevel(storedLevel);
        if (earnedNow < need) {
            char.unspentStats = Math.max(0, Math.floor(Number(char.unspentStats) || 0)) + (need - earnedNow);
        }
    }
    // The migration only "sticks" when its effect does. Under strictLedger,
    // enforceRawSaveLedgerBoundary re-copies level/stats/unspentStats from the
    // stored save further down and throws the top-up away — so latching the flag
    // here would burn the one-time migration without ever applying it, stalling
    // that player's leveling permanently.
    char.levelLedgerMigrated = strictLedger ? exChar.levelLedgerMigrated === true : true;
    // Level is a pure function of the validated ledger, clamped by the exam
    // holds; the client-supplied level is ignored entirely (forge-proof). The
    // rise-only recompute is seeded from the STORED level, so a save write can
    // only move level the way the server's own grant endpoints would.
    {
        // SECURITY: seed the exam list from the STORED save, never from `char`.
        // `char` is still the raw client body here — examsPassed is not validated
        // until the exam block ~440 lines below — and examLevelCap() reads it to
        // decide the level ceiling. Seeding from `char` would let a forged
        // `examsPassed: ['genin','chunin']` mint a level past both exam holds,
        // and because the recompute is rise-only that level would then be
        // permanent even after the honest exam list is restored.
        const seeded = {
            ...char,
            examsPassed: Array.isArray(exChar.examsPassed) ? exChar.examsPassed : [],
            level: Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(exChar.level) || 1))),
        };
        const derived = applyDerivedLevel(seeded) as Record<string, unknown>;
        char.level = derived.level;
        char.rankTitle = derived.rankTitle ?? char.rankTitle;
        char.maxHp = derived.maxHp ?? char.maxHp;
        char.maxChakra = derived.maxChakra ?? char.maxChakra;
        char.maxStamina = derived.maxStamina ?? char.maxStamina;
        char.hp = derived.hp ?? char.hp;
        char.chakra = derived.chakra ?? char.chakra;
        char.stamina = derived.stamina ?? char.stamina;
    }
    char.totalStatsTrained = Math.max(0, Math.floor(Number(exChar.totalStatsTrained) || 0));
    // Server-owned redemption ledgers (idempotency receipts): the stored array
    // always wins — a generic save can neither clear nor forge one. Advanced
    // only by their domain endpoints (training, shop, craft, story, pets, …).
    for (const field of SERVER_ARRAY_LEDGER_CHARACTER_FIELDS) {
        if (Array.isArray(exChar[field])) char[field] = exChar[field];
        else delete char[field];
    }
    // Server-mirrored domain state (exploration/chest daily caps, achievements,
    // Endless Tower): copy-if-defined from stored on every save. Advanced only
    // by /api/world/explore, /api/world/open-chest, /api/achievements/sync,
    // /api/endless/run respectively.
    for (const field of SERVER_MIRRORED_CHARACTER_FIELDS) {
        if (exChar[field] !== undefined) char[field] = exChar[field];
        else delete char[field];
    }
    // Main-story progression and its redemption ledger are advanced only by
    // /api/story/settle after an exact next-boss AI token is consumed. Generic
    // saves may reassert UI state but cannot skip chapters or replay rewards.
    char.storyProgress = Math.max(0, Math.min(9, Math.floor(Number(exChar.storyProgress) || 0)));
    // One-time payout latches (Academy spar via /api/story/settle, starter pet,
    // Chronicle Scribe codex via /api/card-clash/claim-starter): kept only when
    // the STORED save says true.
    for (const field of BOOLEAN_LATCH_CHARACTER_FIELDS) {
        if (exChar[field] === true) char[field] = true;
        else delete char[field];
    }
    // These progression fields are written by dedicated, proof-bearing server
    // flows. Generic saves may mirror them but cannot mint achievement or combat
    // entitlement by increasing them.
    if (!isFirstSave) {
        // 'apexWeekClaimed' is the ONLY thing stopping a Hunter-Rank-5 player from
        // re-claiming the 8,000-ryo Apex purse every save: claim-mission stamps it
        // with the settled ISO week, so a client-writable copy could just be reset.
        for (const field of PROGRESSION_ENTITLEMENT_CHARACTER_FIELDS) {
            if (exChar[field] !== undefined) char[field] = exChar[field];
            else delete char[field];
        }
    }
    if (!isFirstSave && exChar.storyFieldRecords !== undefined) char.storyFieldRecords = parseStoryFieldRecords(exChar.storyFieldRecords);
    else delete char.storyFieldRecords;
    // Jutsu mastery is advanced only by server training endpoints. The retired
    // client per-cast XP path is not trusted by generic saves. Character creation
    // may seed level-one rows, but cannot bootstrap trained levels or stored XP.
    if (isFirstSave) {
        const seen = new Set<string>();
        char.jutsuMastery = (Array.isArray(inChar.jutsuMastery) ? inChar.jutsuMastery : [])
            .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
            .map((row) => String(row.jutsuId ?? '').trim().toLowerCase())
            .filter((id) => /^[a-z0-9][a-z0-9-]{1,63}$/.test(id) && !seen.has(id) && Boolean(seen.add(id)))
            .slice(0, 100)
            .map((jutsuId) => ({ jutsuId, level: 1, xp: 0 }));
    } else {
        const storedMastery = Array.isArray(exChar.jutsuMastery)
            ? exChar.jutsuMastery as Array<Record<string, unknown>>
            : [];
        const requestedMastery = Array.isArray(char.jutsuMastery)
            ? char.jutsuMastery as Array<Record<string, unknown>>
            : [];
        const requestedById = new Map(requestedMastery.map((row) => [String(row?.jutsuId ?? ''), row]));
        char.jutsuMastery = storedMastery.map((storedRow) => {
            if (strictLedger) return storedRow;
            const proposed = requestedById.get(String(storedRow?.jutsuId ?? ''));
            const sameLevel = Number(proposed?.level) === Number(storedRow.level);
            const xpGain = Number(proposed?.xp) - Number(storedRow.xp ?? 0);
            return proposed && sameLevel && xpGain >= 0 && xpGain <= 100
                ? { ...storedRow, xp: Number(proposed.xp) }
                : storedRow;
        });
    }

    // HP / chakra / stamina must not exceed their own max fields.
    if (Number(char.hp ?? 0) > Number(char.maxHp ?? char.hp)) char.hp = char.maxHp;
    if (Number(char.chakra ?? 0) > Number(char.maxChakra ?? char.chakra)) char.chakra = char.maxChakra;
    if (Number(char.stamina ?? 0) > Number(char.maxStamina ?? char.stamina)) char.stamina = char.maxStamina;

    // ── Vitals gain cap ──────────────────────────────────────────────────
    // The max clamp above still let a client jump hp/chakra/stamina straight to
    // full on every autosave — a free heal between fights. The only ways vitals
    // legitimately RISE on the client are the 1/s idle regen (+ Aura Sphere
    // bonus — the very rate api/_elapsed-state.ts settles offline) and the two
    // client-applied pills (Inventory.tsx: Soldier Pill +25 stamina, Chakra Pill
    // +25 chakra). Every other heal — hospital (player/heal), cafeteria, mission
    // stamina (claim-mission), combat settlement, the level-up refill
    // (applyDerivedLevel above) — is written to the STORED save by the server
    // before the client ever echoes it, so the stored value already carries it.
    //
    // So an incoming vital may not exceed: stored + the regen that could have
    // elapsed since the stored `_saveAt` + a grace window (clock/round-trip
    // slack, and the small client-only sector "Recover" / creator-event stamina
    // grants) + credit for pills consumed in this same save. A level-up in this
    // save refilled vitals server-side a few lines up, so the cap is skipped for
    // it; it is also skipped when the stored record carries no `_saveAt` (its
    // age is unknowable — never clamp a legitimate long-idle regen).
    {
        const storedAt = Math.floor(Number(existing?._saveAt) || 0);
        const levelRose = Math.floor(Number(char.level) || 1) > Math.floor(Number(exChar.level) || 1);
        if (!isFirstSave && storedAt > 0 && !levelRose) {
            const now = Math.max(storedAt, Math.floor(Number(opts.now ?? Date.now())));
            const perSecond = 1 + auraRegenBonus(exChar);
            const regenAllowance = Math.ceil(((now - storedAt) / 1000 + VITALS_GAIN_GRACE_SEC) * perSecond);
            const credits: Record<VitalKey, number> = { hp: 0, chakra: 0, stamina: 0 };
            for (const [itemId, credit] of Object.entries(CLIENT_CONSUMABLE_VITAL_CREDITS)) {
                const consumed = countOwnedItem(exChar, itemId) - countOwnedItem(char, itemId);
                if (consumed > 0) credits[credit.vital] += credit.amount * consumed;
            }
            for (const [key, maxKey] of VITAL_KEYS) {
                const stored = Number(exChar[key]);
                const incoming = Number(char[key]);
                if (!Number.isFinite(stored) || !Number.isFinite(incoming)) continue;
                const ceiling = Math.max(0, Math.floor(stored)) + regenAllowance + credits[key];
                if (incoming > ceiling) {
                    const max = Number(char[maxKey]);
                    char[key] = Number.isFinite(max) ? Math.min(ceiling, Math.max(0, Math.floor(max))) : ceiling;
                }
            }
        }
    }

    // Lifetime / leaderboard counters: per-save delta cap. Hall of Legends
    // and achievement gates read these directly, so a tampered client could
    // jump `totalPvpKills` from 0 → 999999 in one save. Cap each at a
    // generous-but-bounded delta per save cycle. The 60s rolling-window
    // limiter further bounds aggregate growth. Counters can never decrease
    // (clients legitimately don't reset these).
    // LIFETIME_COUNTERS (all zero-delta) derives from the ownership manifest
    // ('lifetime-counter-char'); per-counter rationale lives on the entries.
    for (const [field, maxDelta] of Object.entries(LIFETIME_COUNTERS)) {
        const inV = Math.max(0, Number((char as Record<string, unknown>)[field] ?? 0));
        const exV = Math.max(0, Number((exChar as Record<string, unknown>)[field] ?? 0));
        // Disallow shrinking the counter, and clamp growth to maxDelta.
        const clamped = Math.max(exV, Math.min(inV, exV + maxDelta));
        (char as Record<string, unknown>)[field] = clamped;
    }

    // ── Monthly clan contribution counters ─────────────────────────────────
    // clanBattleContrib / clanEventContrib / clanMissionContrib feed the
    // clan-roster leaderboard and the "Clan Patriot" achievement (500 battle
    // contrib), so a tampered save could otherwise jump 0 → 999K in one POST.
    // These are MONTHLY counters (the client resets them when clanContribMonth
    // ticks over), so we cannot disallow decreases like the lifetime counters
    // above — instead we clamp the absolute value to a generous monthly max
    // AND cap upward delta per save. A new-month reset arrives as a DECREASE
    // (handled), and within a month the value can only grow by maxDelta/save.
    const MONTHLY_CLAN_CONTRIB_CAPS: Record<string, { absMax: number; maxDelta: number }> = {
        // +1 per PvP win → 30 days × 20 fights/day = 600/month upper bound;
        // 1500 leaves comfortable headroom for the most-active legit player.
        clanBattleContrib: { absMax: 1500, maxDelta: 0 },
        // Treasury donations can grant variable amounts (ryo / 1000 or 1-per-
        // donation depending on currency) — a bit higher cap and delta.
        clanEventContrib:  { absMax: 5000, maxDelta: 0 },
        // +1 per completed clan mission; ~5/save tracks the totalMissionsCompleted pacing.
        clanMissionContrib: { absMax: 1000, maxDelta: 0 },
    };
    for (const [field, { absMax, maxDelta }] of Object.entries(MONTHLY_CLAN_CONTRIB_CAPS)) {
        const inV = Math.max(0, Number((char as Record<string, unknown>)[field] ?? 0));
        const exV = Math.max(0, Number((exChar as Record<string, unknown>)[field] ?? 0));
        // Allow decreases freely (monthly reset). On the way up, cap at
        // min(absMax, exV + maxDelta).
        const upperBound = Math.min(absMax, exV + maxDelta);
        const clamped = inV <= exV ? Math.min(inV, absMax) : Math.min(inV, upperBound);
        (char as Record<string, unknown>)[field] = clamped;
    }

    // ── rankedRating / petRankedRating: server-authoritative ──────────────
    // (audit #7 / Stage 3, final step.) These ratings are now credited ONLY by
    // the server — pvp/claim-rewards (player) and pet/battle-result (pet) — under
    // the SAME lock:save:<name> the autosave takes, so by the time an updated
    // client's autosave runs the stored value already reflects the credit and
    // the autosave is a no-op RE-ASSERT. The read-back client only displays +
    // re-asserts the returned value; it no longer mints the delta. So a
    // client-driven INCREASE via the save blob is illegitimate (the old ±200
    // swing clamp merely rate-limited minting — it didn't stop it). Reject
    // increases by reverting to the stored value; allow a re-assert (equal) and
    // a DECREASE (the server lowers a loser's rating, and a stale tab
    // re-asserting an older/lower value is harmless — the next server credit
    // re-raises it). Admin saves skip this whole sanitizer (the `!isAdminSave`
    // gate at the call site), so admin tooling can still set ratings directly.
    // NOTE: assumes the read-back client is live — a pre-activation client that
    // self-applied a win WITHOUT the server crediting will have that increase
    // reverted here and must refresh to the current client.
    for (const ratingField of ['rankedRating', 'petRankedRating'] as const) {
        const inV = Number((char as Record<string, unknown>)[ratingField] ?? 1000);
        const exV = Number((exChar as Record<string, unknown>)[ratingField] ?? 1000);
        if (Number.isFinite(inV) && Number.isFinite(exV)) {
            (char as Record<string, unknown>)[ratingField] = inV > exV ? exV : inV;
        }
    }
    return strictLedger;
}
