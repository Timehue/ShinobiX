import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { petStatCeil } from '../_pet-stat-ceil.js';
import { enforceBloodlineBudget, bloodlinePoints, type RawJutsu } from '../_jutsu-points.js';
import { budgetItemBonuses } from '../_item-budget.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { verifyPlayerPassword } from '../player-auth.js';
import { authedPlayerOrAdmin, isAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { validateClanSaveWrite } from '../_clan-save-validate.js';
import { sanitizeUserText, isCleanText, TEXT_LIMITS } from '../_text-moderation.js';
import { KNOWN_TAG_NAMES, canonicalTagName } from '../pvp/_tags.js';
import { masteryBudget, sanitizeMasterySpec } from '../_profession-mastery.js';
import { combatMissionByKey } from '../missions/_mission-catalog.js';
import { parseBaseSaveVersion, saveVersionTelemetryKey, isVersionlessPlayerSave } from './_save-version.js';
import { shouldWriteRegistry } from './_registry-throttle.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { settleSaveRecordForRead } from '../_elapsed-state.js';

// Fields stripped from character objects when a non-owner reads another player's save.
// Prevents ryo farming (reading other players' wallets) and inventory snooping.
const PRIVATE_CHAR_FIELDS = [
    'ryo', 'bankedRyo', 'inventory', 'itemStacks', 'missions', 'missionLog',
    'completedMissions', 'activeMissions', 'questLog', 'bankLog',
] as const;

// Public-safe subset used when ANY player reads another player's save.
// Avoids leaking PvP loadout (jutsu, equipment, computed combat multipliers)
// which an attacker could use to scout opponents and metagame them.
const PUBLIC_CHAR_FIELDS = new Set<string>([
    'name', 'level', 'village', 'rank', 'avatarImage', 'specialty', 'storyProgress',
    'hp', 'maxHp', 'chakra', 'maxChakra', 'stamina', 'maxStamina',
    'customTitle', 'hospitalized', 'hospitalizedUntil',
    // Profession identity / progression — public so Hall of Legends and
    // profile-view screens can render rank/XP for other players.
    'profession', 'professionRank', 'professionXp',
]);

function publicProjection(data: Record<string, unknown>): Record<string, unknown> {
    const char = data.character as Record<string, unknown> | undefined;
    if (!char || typeof char !== 'object') return data;
    const projected: Record<string, unknown> = {};
    for (const k of PUBLIC_CHAR_FIELDS) {
        if (k in char) projected[k] = char[k];
    }
    return { ...data, character: projected };
}

function stripPrivateFields(data: Record<string, unknown>): Record<string, unknown> {
    const char = data.character as Record<string, unknown> | undefined;
    if (!char || typeof char !== 'object') return data;
    const sanitized = { ...char };
    for (const field of PRIVATE_CHAR_FIELDS) delete sanitized[field];
    // _saveVersion / _saveAt are server bookkeeping for the multi-tab autosave
    // guard. Owners need to see them (so they can echo `_baseSaveVersion`
    // back on the next POST), but non-owners shouldn't get internal metadata.
    const stripped: Record<string, unknown> = { ...data, character: sanitized };
    delete stripped._saveVersion;
    delete stripped._saveAt;
    return stripped;
}

// Character-level fields stripped under ?combatOnly=1 — none of these affect
// combat resolution (only meta progression / cosmetic / lifetime counters).
// Whitelisting was considered but a blacklist is safer here since combat
// touches many character fields and a missed whitelist entry would silently
// break opponent rendering.
const COMBAT_STRIP_CHAR_FIELDS = [
    'inventory', 'itemStacks', 'tileCards', 'savedTileDeck',
    'missions', 'missionLog', 'completedMissions', 'activeMissions', 'questLog', 'bankLog',
    'storyTraits', 'storyTitle',
    'weeklyBossKills', 'claimedWarCrateIds',
    'unlockedAchievements', 'achievementUnlockedAt',
    'hollowGateRun', 'hollowGateWardenKills', 'hollowGateIntroSeen', 'hollowGateAttunement',
    'endlessTowerRun', 'endlessTowerBestWave',
    'battleTowerBestFloor', 'battleTowerRating', 'battleTowerClearedFloors',
    'battleTowerClaimedRewards', 'battleTowerAssistRewardsClaimed',
    'totalStatsTrained', 'totalMissionsCompleted', 'totalAiKills', 'totalVillageRaids',
    'totalTilesExplored', 'totalTournamentsCompleted', 'totalEndlessTowerWins', 'totalPetWins',
    'totalPvpKills', 'monthlyPvpKills', 'pvpKillMonth',
    'dailyAiKills', 'dailyPetWins', 'dailyTilesExplored', 'dailyMissionsCompleted',
    'dailyFateSpins', 'lastDailyReset',
    'claimedVillageAgendaDate', 'claimedMapControlDate',
    'defeatedAiIds', 'elderFocus', 'examsPassed',
    'lastBankInterestAt', 'bankRyo',
    'villageWarMissionDate', 'villageWarRaidProgress', 'villageWarMissionsCompleted',
    'clanBattleContrib', 'clanEventContrib', 'clanMissionContrib', 'clanContribMonth',
    'dailyHonorSealsEarned', 'dailyHonorSealsByTarget', 'vanguardDailyResetDate',
    'lastExpeditionClaimDate', 'expeditionsClaimedToday',
    'dailyDonatedSeals', 'dailyDonationDate',
    'petEscortBonusReady', 'hunterRank',
    // Currencies — combat doesn't read them, only post-fight reward grants do.
    'ryo', 'honorSeals', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals', 'auraDust', 'hollowShards',
    // Ranked stats are used elsewhere; only strip the rarely-needed ones.
    'rankedWins', 'rankedLosses',
    'createdAt', 'professionChosenAt',
] as const;

// Top-level (non-character) fields stripped under ?combatOnly=1. Keeps the
// big chunks needed for rendering opponent jutsu/items/bloodlines.
const COMBAT_STRIP_TOPLEVEL_FIELDS = [
    'currentBiome', 'activeTraining', 'activeJutsuTraining',
    'acceptedMissionIds', 'missionProgress',
    'triggeredEvents', 'pendingAiProfileId', 'currentSector',
    'creatorAis', 'creatorEvents', 'creatorMissions', 'creatorRaids', 'creatorCards',
    'petEncounterVn', 'ancientChestVn', 'editablePets',
] as const;

function combatProjection(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    for (const f of COMBAT_STRIP_TOPLEVEL_FIELDS) delete out[f];
    const char = out.character as Record<string, unknown> | undefined;
    if (char && typeof char === 'object') {
        const trimmed = { ...char };
        for (const f of COMBAT_STRIP_CHAR_FIELDS) delete trimmed[f];
        out.character = trimmed;
    }
    return out;
}

const REGISTRY_KEY = 'player:registry';
// How long the cached player:registry `lastSeen` may drift before a save
// rewrites it even when no identity field changed. kv.hset re-serializes the
// entire registry row (one hot row holding every player) on each call — a
// full-row write + WAL image + row-lock contention point that every autosave
// (~1/3s per active player) otherwise hits. Refreshing at most once a minute
// keeps roster/UserHub "last seen" accurate within a minute (its display is
// "X ago" granularity, so the throttle is invisible) while cutting registry
// writes by ~20× for an actively-saving player.
const REGISTRY_REFRESH_MS = 60_000;

// ─── Save sanitization ────────────────────────────────────────────────────────
// Applied to every non-admin player save to prevent client-side economy cheating.
// Caps per-save *gains* rather than imposing hard ceilings, so legitimate large
// values (high-level players with lots of ryo) are preserved while exploit spikes
// (editing localStorage / fetch body) are clamped.

const MAX_RYO_GAIN = 1_000_000;           // max ryo a player can earn per save cycle
const CURRENCY_CAPS: Record<string, number> = {
    fateShards: 50,
    boneCharms: 50,
    auraStones: 50,
    // NOTE: auraDust may clip legitimate rewards from bosses / events that grant
    // > 100 dust in a single save cycle. Tune this cap if players report missing dust.
    auraDust: 100,
    mythicSeals: 50,
    honorSeals: 200,
    // Hollow Gate-only currency. Generous per-save gain cap — well above the
    // most a legit run can bank in one autosave cycle — since it's spent only
    // inside the shrine, so a tampered pile has a small blast radius.
    hollowShards: 200,
};
const MAX_STAT_GAIN = 500;   // per individual stat per save cycle
// Total stat-points (sum across all 12 stats) a single save can grant.
// Without this, the per-stat cap could be multiplied by 12 stats = 6000
// total points per save. 1000 is generous — legitimate training tops out
// well below that per save cycle.
const MAX_TOTAL_STAT_GAIN = 1000;
const MAX_LEVEL_GAIN = 5;    // levels that can be gained between saves
const LEVEL_CAP = 100;
const MAX_PROFESSION_XP_GAIN = 5000; // per save cycle (covers normal play + mission XP)
const MAX_PROFESSION_RANK = 10;
// Healer uses 1.5× the baseline. Cumulative threshold to enter each rank,
// idx 1..10. Used to clamp client-reported rank against client-reported XP.
const PROFESSION_XP_BASELINE_THRESHOLDS = [0, 100, 350, 850, 1850, 3850, 7350, 12850, 20850, 32850];
const PROFESSION_XP_HEALER_THRESHOLDS = PROFESSION_XP_BASELINE_THRESHOLDS.map(v => Math.floor(v * 1.5));
function rankFromXp(profession: unknown, xp: number): number {
    const t = profession === 'healer' ? PROFESSION_XP_HEALER_THRESHOLDS : PROFESSION_XP_BASELINE_THRESHOLDS;
    let rank = 1;
    for (let i = 1; i <= MAX_PROFESSION_RANK; i += 1) {
        if (xp >= t[i]) rank = Math.min(MAX_PROFESSION_RANK, i + 1);
    }
    return Math.min(MAX_PROFESSION_RANK, rank);
}
// Server-side hospital downtime — clients can't skip it by editing localStorage.
const HOSPITAL_DURATION_MS = 60_000;
// Grace window after a server-authoritative discharge (api/player/heal.ts stamps
// character.lastDischargeAt on every checkout/heal-discharge). Within this window
// a client save that STILL asserts hospitalized:true is treated as a stale,
// pre-discharge write racing the discharge — and is ignored rather than
// re-admitting the just-released player with a fresh 60s timer. Without this,
// paying the discharge fee appeared not to work: the discharge landed, then an
// in-flight `hospitalized:true` autosave re-hospitalized the player (and reset
// the timer), so only waiting out the free timer ever reliably released them.
// Kept short so a genuine fresh KO seconds after leaving the hospital (which can
// only happen after navigating into and losing another fight — far longer than
// this) is still hospitalized normally.
const DISCHARGE_GRACE_MS = 12_000;

// Rolling 60-second gain windows. Anything above these caps is rejected with
// a 429. These are server-side rate limits independent of the per-save caps;
// they catch a stream of small but legitimate-looking saves that, in
// aggregate, are obviously farming.
const GAIN_WINDOW_MS = 60_000;
const MAX_RYO_PER_MINUTE = 5_000_000;
const MAX_STAT_PER_MINUTE = 1500; // any single stat
const MAX_XP_PER_MINUTE = 1_000_000;
// Per-minute caps for premium + power-material currencies. The per-save
// CURRENCY_CAPS above bound a SINGLE save; without a rolling window a tampered
// client autosaving every ~3s could mint the per-save cap repeatedly and bank an
// unbounded pile over a minute. Set generously (~10× the per-save cap) so no
// legit faucet trips them — this is anti-TAMPER, not a rarity nerf; the goal is
// only to block sustained minting. auraDust is extra-generous (events can grant
// >100/save, see the CURRENCY_CAPS note).
const MAX_CURRENCY_PER_MINUTE: Record<string, number> = {
    fateShards: 500,
    boneCharms: 500,
    auraStones: 500,
    auraDust: 2000,
    mythicSeals: 500,
    honorSeals: 2000,
    hollowShards: 2000,
};

type GainsWindow = { startedAt: number; ryo: number; stat: Record<string, number>; xp: number; currency: Record<string, number> };

async function readGainsWindow(name: string): Promise<GainsWindow | null> {
    try {
        return await kv.get<GainsWindow>(`ratelimit:save:${name}:gains`);
    } catch (e) {
        // best-effort — but log: a silent read failure resets the anti-farm
        // window to "fresh", quietly weakening the per-minute gain caps.
        console.error(`[save gains-window] read failed for ${name}:`, e);
        return null;
    }
}

async function writeGainsWindow(name: string, w: GainsWindow): Promise<void> {
    try {
        await kv.set(`ratelimit:save:${name}:gains`, w, { ex: Math.ceil(GAIN_WINDOW_MS / 1000) * 2 });
    } catch (e) {
        // best-effort — but log: dropping the window write degrades the anti-farm
        // limiter invisibly.
        console.error(`[save gains-window] write failed for ${name}:`, e);
    }
}

function freshWindow(): GainsWindow {
    return { startedAt: Date.now(), ryo: 0, stat: {}, xp: 0, currency: {} };
}

// Baseline used to clamp a brand-new account's FIRST save. Without this, a
// fresh registration could submit a character at level 100 / millions of ryo /
// maxed stats because there's no `existing` baseline to diff against.
const FIRST_SAVE_BASELINE_CHARACTER: Record<string, unknown> = {
    level: 1,
    ryo: 0,
    xp: 0,
    stats: {
        strength: 0, speed: 0, intelligence: 0, willpower: 0,
        bukijutsuOffense: 0, bukijutsuDefense: 0,
        taijutsuOffense: 0, taijutsuDefense: 0,
        genjutsuOffense: 0, genjutsuDefense: 0,
        ninjutsuOffense: 0, ninjutsuDefense: 0,
    },
    honorSeals: 0, fateShards: 0, boneCharms: 0, auraStones: 0,
    auraDust: 0, mythicSeals: 0,
    hospitalized: false, hospitalizedUntil: 0,
    // Profession progression — a fresh account must start at rank 1 with 0
    // XP. Without these baseline zeros, the cappedProfXp delta-against-existing
    // logic would let a brand-new save submit 5000 prof XP at registration
    // time, putting the player at rank ~4 from the gate.
    professionXp: 0, professionRank: 1,
    // Banked ryo and lifetime / leaderboard counters — first save can't
    // start with these populated.
    bankRyo: 0,
    totalPvpKills: 0, totalAiKills: 0, totalVillageRaids: 0,
    warsWon: 0, warMvpCount: 0, lifetimeWarDamage: 0,
    monthlyPvpKills: 0, dailyAiKills: 0,
    // Inventory / equipment / pets / mastery / bloodlines must start empty —
    // otherwise the first save can ship with a maxed loadout and the
    // per-save inventory cap (500) won't catch it because there's no diff.
    inventory: [], itemStacks: [], jutsuMastery: [], pets: [], savedBloodlines: [], tileCards: [],
    equipment: {},
};

export function sanitizeCharacterSave(
    incoming: Record<string, unknown>,
    existing: Record<string, unknown> | null,
): Record<string, unknown> {
    const inChar = incoming.character as Record<string, unknown> | undefined;
    // First-save case (no existing): clamp against a fresh baseline so a brand-
    // new account can't submit absurd starting values.
    const exChar = (existing?.character as Record<string, unknown> | undefined) ?? FIRST_SAVE_BASELINE_CHARACTER;
    if (!inChar || typeof inChar !== 'object') return incoming;
    if (!exChar || typeof exChar !== 'object') return incoming;

    const char: Record<string, unknown> = { ...inChar };

    // ── Free-form user text moderation ──────────────────────────────
    // customTitle is the only character-level field a player can put
    // arbitrary text into. Mask profanity, redact PII, cap length so a
    // tampered save can't park a slur as their public title or stuff
    // a 10 KB string into the field.
    if (typeof char.customTitle === 'string' && char.customTitle.trim()) {
        char.customTitle = sanitizeUserText(char.customTitle, TEXT_LIMITS.customTitle);
    }

    // ── Nindo (player-authored profile creed) ──────────────────────
    // BBCode subset, rendered SAFELY client-side by lib/nindo-bbcode (never raw
    // HTML). Server job here is storage hygiene: strip control chars, cap length,
    // and blank the whole creed if its visible text (tags stripped) trips the
    // profanity gate. We always WRITE a string when `nindo` is present in the
    // incoming save — so clearing it (empty string) actually persists through the
    // image-preserving merge instead of being treated as "field omitted".
    if ('nindo' in char) {
        const NINDO_MAX_LEN = 2000;
        let v = typeof char.nindo === 'string' ? char.nindo : '';
        v = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, NINDO_MAX_LEN);
        const visibleText = v.replace(/\[\/?[a-z*]{1,8}(?:=[^\]\n]{0,256})?\]/gi, ' ');
        if (v.trim() && !isCleanText(visibleText)) v = '';
        char.nindo = v;
    }

    // Nindo banner preset — allowlist only (mirror lib/nindo-backgrounds
    // NINDO_BACKGROUND_IDS). Cosmetic; reject anything else to ''.
    if ('nindoBg' in char) {
        const NINDO_BG_IDS = new Set(['', 'ember', 'frost', 'verdant', 'shadow', 'royal', 'sakura']);
        char.nindoBg = (typeof char.nindoBg === 'string' && NINDO_BG_IDS.has(char.nindoBg)) ? char.nindoBg : '';
    }

    // Level: monotonic. Cap upward gain at +MAX_LEVEL_GAIN/save and hard-cap at
    // LEVEL_CAP — but ALSO floor at the existing level so a stale/frozen client
    // save (e.g. one replayed after a silent token-expiry) can never REGRESS a
    // player's level. Levels only ever increase through play; admin saves bypass
    // this sanitizer (the !isAdminSave gate), so admin tooling can still correct
    // a level directly. (xp is intentionally NOT floored: it's per-level progress
    // that resets on level-up, and the client clamps it to xpNeeded(level) on load.)
    const exLevel = Math.max(1, Number(exChar.level ?? 1));
    const inLevel = Math.max(1, Number(char.level ?? 1));
    char.level = Math.min(LEVEL_CAP, Math.max(exLevel, Math.min(inLevel, exLevel + MAX_LEVEL_GAIN)));

    // Ryo: cap the gain per cycle; can't go below zero.
    const exRyo = Math.max(0, Number(exChar.ryo ?? 0));
    const inRyo = Math.max(0, Number(char.ryo ?? 0));
    char.ryo = Math.min(inRyo, exRyo + MAX_RYO_GAIN);

    // Bank balance: bankRyo is a client-written field (deposit/withdraw happen
    // client-side; there is no server bank-move endpoint). A forged save could set
    // it to anything, inflating wealth + the leaderboard and earning interest on
    // unearned principal (audit #17). Bank interest is server-credited under lock
    // (api/bank/claim-interest, capped at a 10M principal) and so never flows
    // through this POST, so the only client-legit way bankRyo GROWS via a save is
    // a deposit of held ryo. Cap the upper bound to what the player could actually
    // have deposited — prior bankRyo + prior wallet ryo + one cycle's ryo gain —
    // which never touches a legit deposit. Withdrawals (bankRyo shrinking) are
    // unaffected; the ryo gain cap above already meters draining bank to wallet.
    if (char.bankRyo != null) {
        const exBank = Math.max(0, Number(exChar.bankRyo ?? 0));
        const bankCeil = exBank + exRyo + MAX_RYO_GAIN;
        char.bankRyo = Math.max(0, Math.min(Number(char.bankRyo) || 0, bankCeil));
    }

    // Soft currencies: same gain-cap pattern.
    for (const [key, maxGain] of Object.entries(CURRENCY_CAPS)) {
        const exVal = Math.max(0, Number(exChar[key] ?? 0));
        const inVal = Math.max(0, Number(char[key] ?? 0));
        char[key] = Math.min(inVal, exVal + maxGain);
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

    // Profession: lock the profession choice (server-side picker writes it
    // via /api/profession/choose), cap XP gains per save, and recompute rank
    // from XP so a malicious client can't claim higher rank than its XP earns.
    //
    // Two-state lockdown:
    //   • exChar HAS a profession  → preserve it (permanent choice).
    //   • exChar has NO profession → ALSO preserve `undefined`. The dedicated
    //     /api/profession/choose endpoint is the only path that may set the
    //     initial value. Without this branch a fresh-account save POST could
    //     self-grant `profession: 'vanguard'` and immediately unlock the
    //     Vanguard discount path on jutsu/speedup / train-with-seals, or
    //     profession: 'healer' to unlock cross-village healing, etc.
    char.profession = exChar.profession;
    const exProfXp = Math.max(0, Number(exChar.professionXp ?? 0));
    const inProfXp = Math.max(0, Number(char.professionXp ?? 0));
    const cappedProfXp = Math.min(inProfXp, exProfXp + MAX_PROFESSION_XP_GAIN);
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
    if (char.masterySpec !== undefined) {
        char.masterySpec = sanitizeMasterySpec(char.profession, char.masterySpec, masteryBudget(char.profession, char.professionXp));
    }

    // Individual stats: can't gain more than MAX_STAT_GAIN per stat per save.
    // Then a second pass clamps the TOTAL across-all-stats gain to
    // MAX_TOTAL_STAT_GAIN so the per-stat cap can't be multiplied by 12.
    const inStats = char.stats as Record<string, number> | undefined;
    const exStats = exChar.stats as Record<string, number> | undefined;
    if (inStats && typeof inStats === 'object' && exStats && typeof exStats === 'object') {
        const s: Record<string, number> = { ...inStats };
        for (const k of Object.keys(s)) {
            const exV = Math.max(0, Number(exStats[k] ?? 0));
            s[k] = Math.min(Math.max(0, Number(s[k] ?? 0)), exV + MAX_STAT_GAIN);
        }
        // Total-across-all-stats clamp. If the proposed delta is over
        // MAX_TOTAL_STAT_GAIN, scale every stat's delta proportionally
        // so the total fits. Existing values aren't touched.
        let totalDelta = 0;
        for (const k of Object.keys(s)) {
            const exV = Math.max(0, Number(exStats[k] ?? 0));
            totalDelta += Math.max(0, s[k] - exV);
        }
        if (totalDelta > MAX_TOTAL_STAT_GAIN) {
            const scale = MAX_TOTAL_STAT_GAIN / totalDelta;
            for (const k of Object.keys(s)) {
                const exV = Math.max(0, Number(exStats[k] ?? 0));
                const delta = Math.max(0, s[k] - exV);
                s[k] = exV + Math.floor(delta * scale);
            }
        }
        char.stats = s;
    }

    // HP / chakra / stamina must not exceed their own max fields.
    if (Number(char.hp ?? 0) > Number(char.maxHp ?? char.hp)) char.hp = char.maxHp;
    if (Number(char.chakra ?? 0) > Number(char.maxChakra ?? char.chakra)) char.chakra = char.maxChakra;
    if (Number(char.stamina ?? 0) > Number(char.maxStamina ?? char.stamina)) char.stamina = char.maxStamina;

    // Lifetime / leaderboard counters: per-save delta cap. Hall of Legends
    // and achievement gates read these directly, so a tampered client could
    // jump `totalPvpKills` from 0 → 999999 in one save. Cap each at a
    // generous-but-bounded delta per save cycle. The 60s rolling-window
    // limiter further bounds aggregate growth. Counters can never decrease
    // (clients legitimately don't reset these).
    const LIFETIME_COUNTERS: Record<string, number> = {
        totalPvpKills: 10,
        totalAiKills: 30,
        totalVillageRaids: 10,
        warsWon: 3,
        warMvpCount: 3,
        lifetimeWarDamage: 50_000,
        monthlyPvpKills: 10,
        dailyAiKills: 30,
        // Leaderboard / Hall-of-Legends counters — feed Hall pages directly,
        // so a tampered save can pad them to claim top spots. All are
        // upward-only by gameplay design. Server-side win endpoints
        // (api/pet/battle-result, etc.) are the legitimate increment path;
        // these caps stop a direct save POST from spoofing.
        totalPetWins: 30,
        totalEndlessTowerWins: 5,
        // Battle Towers leaderboard stats — BOTH fully server-authoritative. Only
        // api/towers/settle.ts writes them (bypassing this sanitizer), so maxDelta 0 pins
        // each to the stored value and a tampered client save can neither raise nor lower
        // them (bestFloor must be 0 too, else a client inflates the depth leaderboard +5/save).
        battleTowerBestFloor: 0,
        battleTowerRating: 0,
        totalTournamentsCompleted: 3,
        totalTilesExplored: 200,
        // Hollow Gate Warden (F5 boss) kills — client-incremented and read by the
        // weekly board (wk-gate-*). Was the one weekly-board counter with no
        // per-save clamp, so a tampered save could pad it to auto-complete the
        // weekly Hollow Gate mission (audit #10). The daily run cap (~2-4 dives)
        // bounds legit warden kills well under 3/save.
        hollowGateWardenKills: 3,
        rankedWins: 20,
        rankedLosses: 20,
        // Village-war mission counter (drives the "War Veteran" achievement
        // path). Without a clamp, a tampered save can jump 0 → 999K in one
        // POST. 5/save matches the raid cap pacing.
        villageWarMissionsCompleted: 5,
        // Stats trained + missions completed lifetime counters — used by
        // achievements but never decreased through legitimate play.
        totalStatsTrained: 100,
        totalMissionsCompleted: 5,
        // Shinobi Card Clash lifetime tallies — feed quest metrics (e.g. the
        // Card Hall progression). Client-incremented per duel, so without a
        // per-save clamp a tampered save could jump these 0 → 999K to
        // auto-complete a "win N card games" quest. A single save can only
        // resolve a handful of duels, so +5 each tracks legit pacing (audit #26).
        cardClashWins: 5,
        cardClashLosses: 5,
        cardClashDraws: 5,
    };
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
        clanBattleContrib: { absMax: 1500, maxDelta: 20 },
        // Treasury donations can grant variable amounts (ryo / 1000 or 1-per-
        // donation depending on currency) — a bit higher cap and delta.
        clanEventContrib:  { absMax: 5000, maxDelta: 200 },
        // +1 per completed clan mission; ~5/save tracks the totalMissionsCompleted pacing.
        clanMissionContrib: { absMax: 1000, maxDelta: 10 },
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

    // Pet cap: client enforces "max 5 pets" at befriend time, but a tampered
    // client could POST a save with 6+ pets. Server truncates so we don't
    // silently lose the extras on next reload (which is what the old load-
    // time .slice(0, 5) did). Preserve the active pet if it's in the cut.
    const PET_CAP = 5;
    const inPets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : null;
    if (inPets && inPets.length > PET_CAP) {
        const activeId = String(char.activePetId ?? '');
        const active = activeId ? inPets.find(p => String(p?.id) === activeId) : null;
        const others = inPets.filter(p => String(p?.id) !== activeId);
        const kept = active ? [active, ...others.slice(0, PET_CAP - 1)] : others.slice(0, PET_CAP);
        char.pets = kept;
    }

    // Pet stat ceiling: HP/ATK/DEF/SPD are uncapped client-side by design (training
    // builds them to the level-100 ceiling ≈ base*4.96), so the only guard against a
    // tampered save injecting absurd values into the deterministic ranked pet ladder
    // is a server clamp. Per-rarity at base*8 (~1.6x the legit all-in max) — well
    // above any legit build (native or evolved), far below the old flat 100k that
    // let a ~300x pet through. See _pet-stat-ceil.ts.
    if (Array.isArray(char.pets)) {
        for (const p of char.pets as Array<Record<string, unknown>>) {
            if (!p || typeof p !== 'object') continue;
            for (const k of ['hp', 'attack', 'defense', 'speed'] as const) {
                const v = Number(p[k]);
                if (Number.isFinite(v)) p[k] = Math.max(1, Math.min(petStatCeil(p.rarity, k), Math.round(v)));
            }
        }
    }

    // Inventory + tile-card collection size caps. A tampered client could
    // submit thousands of items, both bloating KV and inflating foreign-read
    // payloads. 500 is well above any realistic veteran's working inventory
    // and matches what the client UI can scroll through cleanly.
    const INVENTORY_CAP = 500;
    if (Array.isArray(char.inventory) && (char.inventory as unknown[]).length > INVENTORY_CAP) {
        char.inventory = (char.inventory as unknown[]).slice(0, INVENTORY_CAP);
    }
    // Counted stacks for bulk consumables (client lib/inventory.ts moves
    // stackable ids out of inventory[] into here, which is what keeps the cap
    // above from overflowing for hoarders). Validate structurally so a tampered
    // client can't bloat the save: dedupe by id, floor + clamp each count, drop
    // non-positive entries, and cap the number of distinct stack keys.
    const ITEM_STACK_MAX = 9999;
    const ITEM_STACK_KEY_CAP = 200;
    if (Array.isArray(char.itemStacks)) {
        const counts = new Map<string, number>();
        for (const s of char.itemStacks as unknown[]) {
            if (!s || typeof s !== 'object') continue;
            const itemId = String((s as Record<string, unknown>).itemId ?? '');
            if (!itemId) continue;
            const n = Math.max(0, Math.floor(Number((s as Record<string, unknown>).count ?? 0)));
            if (n <= 0) continue;
            counts.set(itemId, Math.min(ITEM_STACK_MAX, (counts.get(itemId) ?? 0) + n));
        }
        // Hollow Gate Keys are forged/crafted client-side (Key Forge 80 shards, or
        // the Crafter recipe). Cap the per-save GAIN so a forged save can't mint a
        // huge stack with no shard/material spend (a legit full run yields ~3). The
        // 'hollow-gate-key' literal mirrors HOLLOW_GATE_KEY_ID in
        // shinobij.client/src/constants/game.ts.
        const HG_KEY_ID = 'hollow-gate-key';
        const HG_KEY_PER_SAVE_GAIN = 10;
        if (counts.has(HG_KEY_ID)) {
            const exKeys = Array.isArray(exChar.itemStacks)
                ? Math.max(0, Number((exChar.itemStacks as Array<Record<string, unknown>>)
                    .find(s => s?.itemId === HG_KEY_ID)?.count ?? 0))
                : 0;
            counts.set(HG_KEY_ID, Math.min(counts.get(HG_KEY_ID)!, exKeys + HG_KEY_PER_SAVE_GAIN));
        }
        char.itemStacks = [...counts.entries()]
            .slice(0, ITEM_STACK_KEY_CAP)
            .map(([itemId, count]) => ({ itemId, count }));
    }
    // ─── examsPassed validation ───────────────────────────────────────────────
    // Rank exams: genin/chunin/jonin/specialJonin gate level progression
    // (EXAM_LEVEL_GATES in App.tsx). A forged save could POST
    // examsPassed:["genin","chunin","jonin","specialJonin"] to skip every
    // exam and the level cap. Rules:
    //   - Only the 4 known exam keys are accepted
    //   - Cap length at 4 (one of each)
    //   - Dedupe
    //   - Level-gate: genin needs level ≥20, chunin needs level ≥39
    //   - Don't shrink an existing entry (legitimate veterans keep their list)
    const KNOWN_EXAMS = new Set(['genin', 'chunin', 'jonin', 'specialJonin']);
    const EXAM_LEVEL_GATES_SERVER: Record<string, number> = {
        genin: 20,
        chunin: 39,
        // jonin / specialJonin don't have level gates per App.tsx EXAM_LEVEL_GATES
    };
    // Server-side requirement FLOOR (gameplay-loop audit L-1). The full exam
    // checklist (elements, stat-training, jutsu mastery, clan, boss defeats) is
    // evaluated client-side; here we additionally enforce the subset backed by
    // the rate-limited lifetime counters clamped above, so a tampered client
    // can't just append an exam key at the level threshold and skip the grind.
    // We ONLY check counters the sanitizer itself bounds (expensive to forge)
    // and FAIL OPEN on every requirement we can't verify here — a legit player
    // who passed client-side always carries these counters (same character
    // state the client gated on), so this can never softlock a real player.
    // max(totalMissionsCompleted, clanMissionContrib) mirrors the client's
    // `?? clanMissionContrib` fallback so the server is never stricter.
    const examCounter = (field: string): number => Math.max(0, Number((char as Record<string, unknown>)[field] ?? 0));
    const examMissionsDone = Math.max(examCounter('totalMissionsCompleted'), examCounter('clanMissionContrib'));
    const EXAM_COUNTER_REQUIREMENTS_MET: Record<string, boolean> = {
        genin: examCounter('totalAiKills') >= 20 && examMissionsDone >= 20 && examCounter('totalTilesExplored') >= 50,
        chunin: examMissionsDone >= 50 && examCounter('totalTilesExplored') >= 100,
        jonin: examCounter('totalPvpKills') >= 10 && examCounter('totalVillageRaids') >= 20,
        specialJonin: examCounter('totalPvpKills') >= 100,
    };
    const exExams = Array.isArray(exChar.examsPassed) ? (exChar.examsPassed as unknown[]).map(String) : [];
    const inExams = Array.isArray(char.examsPassed) ? (char.examsPassed as unknown[]).map(String) : [];
    const charLevel = Number(char.level ?? exChar.level ?? 1);
    const validatedExams: string[] = [];
    const seenExams = new Set<string>();
    // Preserve every exam already on the existing save (don't penalize legit veterans).
    for (const e of exExams) {
        if (KNOWN_EXAMS.has(e) && !seenExams.has(e)) {
            validatedExams.push(e);
            seenExams.add(e);
        }
    }
    // Accept NEW exam additions only if they pass the level gate AND the
    // server-trackable requirement floor. Exams absent from the map fail open.
    for (const e of inExams) {
        if (!KNOWN_EXAMS.has(e) || seenExams.has(e)) continue;
        const required = EXAM_LEVEL_GATES_SERVER[e];
        if (required != null && charLevel < required) continue;
        if (e in EXAM_COUNTER_REQUIREMENTS_MET && !EXAM_COUNTER_REQUIREMENTS_MET[e]) continue;
        validatedExams.push(e);
        seenExams.add(e);
    }
    char.examsPassed = validatedExams.slice(0, 4);

    // ─── pendingCombatMissionClaims validation ────────────────────────────────
    // Combat-mission claims are server-owned by the queue and claim endpoints.
    // A player save may preserve an already-stored flag, but it may not mint a
    // new one or clear a server-queued one.
    // Without this, a tampered save could add a valid catalog key and claim combat
    // rewards without winning the fight.
    if (char.pendingCombatMissionClaims !== undefined) {
        const PENDING_COMBAT_CLAIMS_CAP = 50;
        const rawPending = Array.isArray(exChar.pendingCombatMissionClaims)
            ? (exChar.pendingCombatMissionClaims as unknown[])
            : [];
        const validatedPending: string[] = [];
        const seenPending = new Set<string>();
        for (const raw of rawPending) {
            const key = String(raw ?? '');
            if (!key || seenPending.has(key)) continue;
            const def = combatMissionByKey(key);
            if (!def) continue;                  // not a real catalog mission key
            if (charLevel < def.min) continue;   // below the mission's level gate
            validatedPending.push(key);
            seenPending.add(key);
            if (validatedPending.length >= PENDING_COMBAT_CLAIMS_CAP) break;
        }
        char.pendingCombatMissionClaims = validatedPending;
    }

    // ─── savedBloodlines normalization ────────────────────────────────────────
    // Players author custom bloodlines client-side; without server validation
    // a forged save can POST bloodlines with jutsus { effectPower: 9999, ap: 0,
    // cooldown: 0 } that the equip path then makes usable in combat.
    // Rules:
    //   - Cap savedBloodlines.length at 5 (client UI keeps 1, but be generous
    //     for migration / multi-bloodline rosters)
    //   - For each bloodline: cap jutsus at 15, clamp per-jutsu numerics
    //   - Strip inline data:image/svg URIs from the bloodline image (SVG can
    //     carry <script>; only the /api/images endpoint is supposed to enforce
    //     this and inline saves bypass it)
    const BLOODLINE_CAP = 5;
    const JUTSU_PER_BLOODLINE_CAP = 15;
    const RAW_BLOODLINE_IMAGE_MAX_BYTES = 250_000;  // 250 KB inline cap
    const KNOWN_BLOODLINE_RANKS = new Set(['B Rank', 'A Rank', 'S Rank']);
    const BLOODLINE_RANK_ORDER: Record<string, number> = { 'B Rank': 0, 'A Rank': 1, 'S Rank': 2 };
    // sub-3: bloodline rank entitlement. A plain save POST may only LOWER a
    // bloodline's rank, never raise it — the entitlement is the rank already stored
    // for that bloodline id, and a new bloodline (no stored row) caps at B Rank. A
    // genuine rank-up must come from a dedicated server-authoritative endpoint, so a
    // forged save can't self-promote to A/S (there is no Mythic-Seal faucet, by
    // design). Gated by BLOODLINE_RANK_ENTITLEMENT; flag-off keeps the old
    // "accept any known rank" behavior (byte-identical). Needs a one-off save:*
    // audit of legit A/S holders before flipping (a wiped/migrated save lacking the
    // bloodline would otherwise re-baseline its rank to B).
    const RANK_ENTITLEMENT_ON = process.env.BLOODLINE_RANK_ENTITLEMENT === '1';
    // sub-1: enforce the bloodline POINT BUDGET server-side (the core PvP-balance
    // knob, client-only today). Gated; flag-off = no-op for honest bloodlines.
    const BLOODLINE_BUDGET_ON = process.env.BLOODLINE_BUDGET_SERVER === '1';
    const normalizeBloodlineArray = (arr: unknown, existingArr: unknown): unknown[] => {
        if (!Array.isArray(arr)) return arr as unknown[];
        const existingRankById = new Map<string, string>();
        if (RANK_ENTITLEMENT_ON && Array.isArray(existingArr)) {
            for (const eb of existingArr as Array<Record<string, unknown>>) {
                if (eb && typeof eb === 'object') {
                    const eid = String(eb.id ?? '');
                    const er = String(eb.rank ?? '');
                    if (eid && KNOWN_BLOODLINE_RANKS.has(er)) existingRankById.set(eid, er);
                }
            }
        }
        return (arr as Array<Record<string, unknown>>).slice(0, BLOODLINE_CAP).map((bl) => {
            if (!bl || typeof bl !== 'object') return {};
            const out: Record<string, unknown> = { ...bl };
            // Rank — fall back to B Rank if unknown, then (sub-3) clamp DOWN to the
            // player's entitlement (the rank already stored for this bloodline id).
            // Never raises rank; a legit downgrade is allowed.
            const rawRank = String(out.rank ?? '');
            let rank = KNOWN_BLOODLINE_RANKS.has(rawRank) ? rawRank : 'B Rank';
            if (RANK_ENTITLEMENT_ON) {
                const blId = String(out.id ?? '');
                const entitled = (blId && existingRankById.get(blId)) || 'B Rank';
                if ((BLOODLINE_RANK_ORDER[rank] ?? 0) > (BLOODLINE_RANK_ORDER[entitled] ?? 0)) rank = entitled;
            }
            out.rank = rank;
            // Strip inline SVG / oversized image data — let shared image
            // storage host real images via the /api/images allowlist.
            if (typeof out.image === 'string') {
                const img = out.image;
                if (/^data:image\/svg/i.test(img) || img.length > RAW_BLOODLINE_IMAGE_MAX_BYTES) {
                    out.image = undefined;
                }
            }
            // Numeric totalPoints — informational; the equip-side math
            // doesn't rely on it but clamp anyway so leaderboards/UI don't
            // see absurd values.
            out.totalPoints = Math.max(0, Math.min(20, Number(out.totalPoints ?? 0) || 0));
            // Bloodline name + lore are free-form, player-authored, and shown
            // publicly in the bloodline gallery (the name also appears in PvP
            // battle-log flavor). They bypassed the moderation customTitle gets,
            // so run them through the same sanitizer + length caps (audit #16).
            if (typeof out.name === 'string') out.name = sanitizeUserText(out.name, TEXT_LIMITS.storyName);
            if (typeof out.lore === 'string') out.lore = sanitizeUserText(out.lore, TEXT_LIMITS.description);
            // Jutsus list — cap count + clamp per-jutsu numerics.
            const rawJutsus = Array.isArray(out.jutsus) ? out.jutsus as Array<Record<string, unknown>> : [];
            out.jutsus = rawJutsus.slice(0, JUTSU_PER_BLOODLINE_CAP).map((j) => {
                if (!j || typeof j !== 'object') return j;
                const jOut: Record<string, unknown> = { ...j };
                if (jOut.effectPower != null) {
                    // Bloodline jutsu effectPower is ALWAYS one of {0 (40-AP
                    // utility), 40 (standard 60-AP), 50 (the single Nuke)} — see
                    // BloodlineMaker / lib/bloodline-templates.ts:87. The old
                    // [0,200] clamp let a forged save POST inject a ~4x-damage
                    // "nuke" (effectPower 200) that the PvP engine applies as raw
                    // base damage (audit #3). Clamp to the legit ceiling of 50:
                    // no honest bloodline jutsu exceeds it, so this is behavior-
                    // preserving for real players and neutralizes the injection.
                    jOut.effectPower = Math.max(0, Math.min(50, Number(jOut.effectPower) || 0));
                }
                if (jOut.ap != null) {
                    // Legit bloodline jutsu AP is 40 / 60 / 80 — never below 40.
                    // Floor at 40 (was 20) so a forged ap:1 can't make the nuke
                    // castable ~5x/turn (audit #14); the upper bound is unchanged.
                    jOut.ap = Math.max(40, Math.min(200, Number(jOut.ap) || 40));
                }
                if (jOut.cooldown != null) {
                    jOut.cooldown = Math.max(0, Math.min(50, Number(jOut.cooldown) || 0));
                }
                if (jOut.chakraCost != null) {
                    jOut.chakraCost = Math.max(0, Math.min(1000, Number(jOut.chakraCost) || 0));
                }
                if (jOut.staminaCost != null) {
                    jOut.staminaCost = Math.max(0, Math.min(1000, Number(jOut.staminaCost) || 0));
                }
                if (jOut.range != null) {
                    jOut.range = Math.max(0, Math.min(30, Number(jOut.range) || 1));
                }
                // Player-authored jutsu name + battleDescription are shown in the
                // gallery and the PvP battle log (api/pvp/move.ts) — moderate them
                // the same way as the bloodline name/lore above (audit #16).
                if (typeof jOut.name === 'string') jOut.name = sanitizeUserText(jOut.name, TEXT_LIMITS.storyName);
                if (typeof jOut.battleDescription === 'string') jOut.battleDescription = sanitizeUserText(jOut.battleDescription, TEXT_LIMITS.description);
                return jOut;
            });
            // sub-1: enforce the bloodline point budget across the now numeric-clamped
            // jutsu. Strips the lowest-point tags down to the rank budget; clamp,
            // never reject. Flag-off = no-op (an honest within-budget bloodline is
            // unchanged). Uses the entitlement-clamped out.rank set above.
            if (BLOODLINE_BUDGET_ON && Array.isArray(out.jutsus)) {
                const blRank = typeof out.rank === 'string' ? out.rank : null;
                out.jutsus = enforceBloodlineBudget(out.jutsus as RawJutsu[], blRank) as unknown[];
                out.totalPoints = Math.min(20, bloodlinePoints(out.jutsus as RawJutsu[], blRank));
            }
            return out;
        });
    };
    // The live client persists savedBloodlines at the TOP LEVEL of the save
    // record; older/admin shapes nest it under character. Normalize whichever is
    // present so the per-jutsu numeric clamp (effectPower/ap/cooldown/range) + name
    // moderation actually run on real saves — the block previously read only the
    // nested copy, which is empty for live payloads. (PvP re-clamps at session
    // create, so this closes a defense-in-depth / false-confidence gap, not a live
    // hole.) The top-level copy is normalized into the return object below.
    if (Array.isArray(char.savedBloodlines)) char.savedBloodlines = normalizeBloodlineArray(char.savedBloodlines, (exChar as Record<string, unknown>).savedBloodlines);

    // ─── endlessTowerRun shape validation ─────────────────────────────────────
    // Run state is client-tracked then collected via save. Forged saves can
    // POST {wave: 9999, bankedRyo: 999999999, bankedXp: 999999999}. The
    // existing per-save ryo cap catches absurd ryo on the COLLECT step but
    // XP only has a rolling-window guard. Clamp the in-flight banked values
    // so the collect step can't ever credit more than these ceilings.
    const ET_BANKED_RYO_CAP = 100_000;
    const ET_BANKED_XP_CAP = 50_000;
    const ET_WAVE_CAP = 200;
    if (char.endlessTowerRun && typeof char.endlessTowerRun === 'object') {
        const run = char.endlessTowerRun as Record<string, unknown>;
        if (run.bankedRyo != null) run.bankedRyo = Math.max(0, Math.min(ET_BANKED_RYO_CAP, Number(run.bankedRyo) || 0));
        if (run.bankedXp != null) run.bankedXp = Math.max(0, Math.min(ET_BANKED_XP_CAP, Number(run.bankedXp) || 0));
        if (run.wave != null) run.wave = Math.max(0, Math.min(ET_WAVE_CAP, Math.floor(Number(run.wave) || 0)));
    }

    // ─── hollowGateRun shape bounds ───────────────────────────────────────────
    // Defense-in-depth on the persisted run: bound an absurd floor/keys count so a
    // forged save can't park nonsense run state (default max floor is 5; keys are
    // small). We deliberately do NOT clamp entryCurrencies: it is the at-entry
    // snapshot the death claw-back subtracts from, the claw-back is applied
    // client-side by design (docs/hollow-gate-loop.md §9), and for SPENDABLE
    // currencies (Hollow Shards, via in-run consumables / Sanctify) a legit entry
    // can legitimately exceed the current balance — clamping it down to current
    // would over-penalise an honest mid-run spend on a later reload-path death.
    if (char.hollowGateRun && typeof char.hollowGateRun === 'object') {
        const run = char.hollowGateRun as Record<string, unknown>;
        if (run.floor != null) run.floor = Math.max(0, Math.min(50, Math.floor(Number(run.floor) || 0)));
        if (run.keys != null) run.keys = Math.max(0, Math.min(99, Math.floor(Number(run.keys) || 0)));
        // Server-authoritative run layer (lib/hollow-gate-server + api/hollow-gate/*).
        // These persist only so a refresh mid-run can resume the open token; bound
        // their shape so a forged save can't bloat KV via them. We deliberately do
        // NOT freeze the clawback CURRENCIES while a run token is open: settle is the
        // authoritative credit (it SETS each balance to min(current, sealed entry +
        // sealed-ceiling credit), so it relies on the live haul being present), and a
        // freeze would zero that payout. The unbounded-farming surface stays bounded
        // by the per-save CURRENCY_CAPS above (the no-token path) plus the settle
        // ceiling (the token path) — see docs/hollow-gate-augments.md.
        if (run.runToken != null) run.runToken = String(run.runToken).slice(0, 64);
        if (run.serverSeed != null) run.serverSeed = String(run.serverSeed).slice(0, 64);
        if (Array.isArray(run.augmentOffers) && (run.augmentOffers as unknown[]).length > 8) {
            run.augmentOffers = (run.augmentOffers as unknown[]).slice(0, 8);
        }
    }

    // ─── Battle Towers progress array length caps ─────────────────────────────
    // These are display/convenience ledgers — the real reward gating is
    // server-side in api/towers/settle.ts (NX receipts + recompute), so a forged
    // array can't actually claim rewards. Cap length so it can't bloat KV.
    const BATTLE_TOWER_ARRAY_CAP = 500;
    for (const f of ['battleTowerClearedFloors', 'battleTowerClaimedRewards', 'battleTowerAssistRewardsClaimed']) {
        const arr = (char as Record<string, unknown>)[f];
        if (Array.isArray(arr) && arr.length > BATTLE_TOWER_ARRAY_CAP) {
            (char as Record<string, unknown>)[f] = arr.slice(0, BATTLE_TOWER_ARRAY_CAP);
        }
    }

    // ─── defeatedAiIds length cap ─────────────────────────────────────────────
    // Drives "AI Hunter" achievement variants. Hard cap so a forged save
    // can't push the array to enormous lengths and bloat KV.
    const DEFEATED_AI_IDS_CAP = 5000;
    if (Array.isArray(char.defeatedAiIds) && (char.defeatedAiIds as unknown[]).length > DEFEATED_AI_IDS_CAP) {
        char.defeatedAiIds = (char.defeatedAiIds as unknown[]).slice(-DEFEATED_AI_IDS_CAP);
    }

    const TILE_CARD_CAP = 500;
    if (Array.isArray(char.tileCards) && (char.tileCards as unknown[]).length > TILE_CARD_CAP) {
        char.tileCards = (char.tileCards as unknown[]).slice(0, TILE_CARD_CAP);
    }

    // Admin-only "creator" content (jutsus / items / AIs / missions / events /
    // cards / raids) should NEVER live on a player save. The legitimate
    // source of truth is save:admin*. If a tampered client tries to inject
    // these fields into a non-admin save, strip them outright so they can't
    // round-trip into anyone's gameplay state.
    delete char.creatorJutsus;
    delete char.creatorItems;
    delete char.creatorAis;
    delete char.creatorMissions;
    delete char.creatorEvents;
    delete char.creatorCards;
    delete char.creatorRaids;

    // Daily-claim date stamps (claimedVillageAgendaDate / claimedMapControlDate)
    // gate once-per-UTC-day rewards on the client. If the client could write
    // any string here, a player rolling their system clock could "claim,
    // unclaim, claim again" by setting the stamp to a different date. Lock
    // these to the server's actual UTC today: incoming may either be empty
    // (no claim today) or exactly the server's date string. Any other value
    // (a future date, last week, "1970-01-01", etc.) is forced back to
    // whatever was previously stored, so the legitimate-today claim still
    // survives but backdating doesn't.
    const SERVER_UTC_DATE = new Date().toISOString().slice(0, 10);
    // warGroundBountyDate gates the once-per-UTC-day War Ground bounty (+500
    // ryo, +1 Fate Shard — see App.tsx). Same backdating risk as the other
    // daily-claim stamps: setting it to a different date re-opens the bounty.
    // Locked to the server's UTC today by the same rule below. (audit #12)
    const DAILY_CLAIM_DATE_FIELDS = ['claimedVillageAgendaDate', 'claimedMapControlDate', 'warGroundBountyDate'] as const;
    for (const field of DAILY_CLAIM_DATE_FIELDS) {
        const incomingDate = char[field];
        if (typeof incomingDate !== 'string' || incomingDate === '') continue;
        if (incomingDate !== SERVER_UTC_DATE) {
            // Either a forged future date or a backdated reset. Revert to
            // the existing server-side value (which itself can only have
            // been set by a legit prior pass through this same check).
            char[field] = exChar[field] ?? '';
        }
    }

    // War-Ground bounty server floor (audit #21). The bounty (+500 ryo, +1 Fate
    // Shard) is gated client-side by warGroundBountyDate. The date-stamp lock
    // above stops BACKDATING the stamp, but a tampered client could keep the
    // stamp at today AND re-add the +500 ryo / +1 fate shard to its wallet on a
    // later autosave — a within-day re-mint. Defense-in-depth: if the SERVER-
    // stored save already shows the bounty claimed today
    // (exChar.warGroundBountyDate === SERVER_UTC_DATE), ryo and fateShards may
    // not GROW from this save (mirrors the dailyHollowGateRuns / dailyMissions-
    // Completed monotonic-floor pattern, but in the can't-grow direction — the
    // bounty already paid out today). Decreases (spending) pass through freely.
    // On a real new day exChar's stamp != today so this is skipped and the
    // fresh bounty claim is untouched. NOTE: legit non-bounty ryo/fateShard
    // gains (mission/fight rewards) that land in the SAME save as a duplicate
    // bounty attempt are also held to the stored value here — but those
    // currencies flow through server-authoritative endpoints under the save lock
    // (claim-mission, pvp/claim-rewards), so by the time an autosave runs the
    // stored value already reflects them and this clamp is a no-op re-assert for
    // honest play.
    if (exChar.warGroundBountyDate === SERVER_UTC_DATE) {
        const exRyoFloor = Math.max(0, Number(exChar.ryo ?? 0));
        char.ryo = Math.min(Math.max(0, Number(char.ryo) || 0), exRyoFloor);
        const exFateFloor = Math.max(0, Number(exChar.fateShards ?? 0));
        char.fateShards = Math.min(Math.max(0, Number(char.fateShards) || 0), exFateFloor);
    }

    // Hollow Gate daily run cap (dailyHollowGateRuns) is gated client-side via
    // lastDailyReset. Defense-in-depth: if the SERVER-stored save was last written
    // today (exChar.lastDailyReset === SERVER_UTC_DATE), the run count can only go
    // UP within the day — so a forged save can't reset it to 0 to farm extra runs.
    // On a real new day exChar.lastDailyReset != today, the floor is 0, and the
    // legit daily reset is untouched. (A determined tamper that ALSO backdates
    // lastDailyReset resets all the player's other daily counters too, so it is
    // self-limiting; a fully server-authoritative cap would need a dedicated
    // server-stamped HG date field.)
    if (exChar.lastDailyReset === SERVER_UTC_DATE) {
        const floorRuns = Math.max(0, Math.floor(Number(exChar.dailyHollowGateRuns ?? 0)));
        const incomingRuns = Math.max(0, Math.floor(Number(char.dailyHollowGateRuns ?? 0)));
        char.dailyHollowGateRuns = Math.max(incomingRuns, floorRuns);
    }

    // Daily-reset stamps (lastDailyReset / lastHuntReset) gate the per-day
    // mission / hunt / AI-kill / fate-spin counters. They only ever ADVANCE — a
    // real day roll moves them forward. A tampered save that BACKDATES one resets
    // every daily counter it gates (re-opening the claim-mission daily cap [audit
    // #1] and, via lastDailyReset, the Hollow Gate run cap [audit #7]). Force them
    // monotonic-forward: an incoming date older than the stored one is reverted to
    // the stored value, so the backdate can't persist. A forward move to a newer
    // date (the legit midnight reset) is untouched, as is the first-ever set.
    for (const field of ['lastDailyReset', 'lastHuntReset'] as const) {
        const stored = typeof exChar[field] === 'string' ? (exChar[field] as string) : '';
        const incoming = typeof char[field] === 'string' ? (char[field] as string) : '';
        if (stored && incoming && incoming < stored) char[field] = stored;
    }

    // Daily mission / hunt completion counters are the ONLY thing bounding the
    // server-authoritative claim-mission payouts (api/missions/claim-mission.ts),
    // which write ryo + premium currency directly under the save lock — bypassing
    // this endpoint's per-save ryo/currency caps. So if the client could zero
    // these mid-day it could re-claim the highest-value missions unbounded (audit
    // #1). Floor them at the server-stored value within the same UTC day
    // (monotonic-up, exactly like dailyHollowGateRuns above); the legit midnight
    // reset is preserved because on a real new day exChar's stamp != today, so
    // the floor is skipped and the counter is free to drop to 0.
    if (exChar.lastDailyReset === SERVER_UTC_DATE) {
        const floorM = Math.max(0, Math.floor(Number(exChar.dailyMissionsCompleted ?? 0)));
        const inM = Math.max(0, Math.floor(Number(char.dailyMissionsCompleted ?? 0)));
        char.dailyMissionsCompleted = Math.max(inM, floorM);
    }
    if (exChar.lastHuntReset === SERVER_UTC_DATE) {
        const floorH = Math.max(0, Math.floor(Number(exChar.dailyHuntsCompleted ?? 0)));
        const inH = Math.max(0, Math.floor(Number(char.dailyHuntsCompleted ?? 0)));
        char.dailyHuntsCompleted = Math.max(inH, floorH);
    }

    // academy-trial is a one-time onboarding claim (claim-mission academy-trial
    // path, off the daily cap). Latch it: once the server-stored save has it
    // claimed, a forged save can't flip it back to false to re-claim. (audit #1)
    if (exChar.academyTrialClaimed === true) char.academyTrialClaimed = true;

    // Bank-interest claim window enforcement.
    //   The Bank screen (shinobij.client/src/screens/Bank.tsx) uses
    //   Date.now() to gate the "claim interest" button — a player who
    //   sets their system clock forward can claim multiple times per
    //   real day, banking interest that wasn't earned. Server clamps:
    //   if the client tries to advance lastBankInterestAt by less than
    //   24h (per the SERVER's clock vs the prior stamp), revert the
    //   stamp. The implied bankRyo gain isn't surgically reverted —
    //   any abuse is bounded by the per-save ryo gain cap (1M) and
    //   the 60s rolling-window limiter when the player tries to
    //   withdraw the inflated bankRyo back to wallet ryo.
    const BANK_INTEREST_WINDOW_MS = 24 * 60 * 60 * 1000;
    const exBankAt = Number(exChar.lastBankInterestAt ?? 0);
    const inBankAt = Number(char.lastBankInterestAt ?? 0);
    if (inBankAt > exBankAt) {
        const elapsed = Date.now() - exBankAt;
        if (exBankAt > 0 && elapsed < BANK_INTEREST_WINDOW_MS) {
            // Reject the stamp advance. Existing bankRyo stays as-is
            // (the abuse-bound caveats above apply).
            char.lastBankInterestAt = exBankAt;
        }
    }

    // Hospital timer enforcement.
    //   - If save flips hospitalized false → true, server stamps both
    //     hospitalizedUntil AND hospitalizedAt. The latter is read by
    //     api/player/heal.ts to award the +50% Healer raid-assist XP
    //     bonus when a Healer reaches a freshly-hospitalized friendly.
    //   - If save flips hospitalized true → false before the timer expires, revert
    //     (with HP at zero — exactly the state they were in when admitted).
    //   - Discharge (genuine or rejected) always goes through api/player/heal,
    //     not this validator — see Hospital.tsx::discharge(). This validator
    //     is the fallback that catches client-only attempts to flip the flag.
    const exHosp = !!exChar.hospitalized;
    const inHosp = !!char.hospitalized;
    const exHospUntil = Number(exChar.hospitalizedUntil ?? 0);
    const exHospAt = Number(exChar.hospitalizedAt ?? 0);
    if (!exHosp && inHosp) {
        const now = Date.now();
        // Discharge-race guard: if the server JUST discharged this player
        // (heal / paid skip / free checkout, all via api/player/heal.ts, which
        // stamps lastDischargeAt), an incoming save still flagged hospitalized
        // is a stale pre-discharge replay racing the discharge. Honor the
        // discharge instead of re-admitting them with a fresh timer.
        const lastDischargeAt = Number(exChar.lastDischargeAt ?? 0);
        if (lastDischargeAt > 0 && now - lastDischargeAt < DISCHARGE_GRACE_MS) {
            char.hospitalized = false;
            char.hospitalizedUntil = 0;
            char.hospitalizedAt = 0;
            // Preserve the marker so any further stale saves in the same window
            // are caught too (mergePreservingImages would keep it anyway, but be
            // explicit — char is what the rest of the validator reasons about).
            char.lastDischargeAt = lastDischargeAt;
        } else {
            char.hospitalizedUntil = now + HOSPITAL_DURATION_MS;
            char.hospitalizedAt = now;
        }
    } else if (exHosp && !inHosp) {
        if (exHospUntil && Date.now() < exHospUntil) {
            // Reject early discharge — force the player to wait out the timer
            // or go through /api/player/heal (which charges ryo server-side
            // when paySkip=true, or applies the Healer rank-shortened timer).
            char.hospitalized = true;
            char.hospitalizedUntil = exHospUntil;
            char.hospitalizedAt = exHospAt;
            // Snap HP back to 0 so they can't farm hp during the lockout.
            char.hp = 0;
        } else {
            // Timer expired or unset — allow discharge and clear both stamps.
            char.hospitalizedUntil = 0;
            char.hospitalizedAt = 0;
        }
    } else if (exHosp && inHosp) {
        // Preserve the original stamps — don't let the client refresh them.
        char.hospitalizedUntil = exHospUntil || char.hospitalizedUntil;
        char.hospitalizedAt = exHospAt || char.hospitalizedAt;
    }

    // ─── creatorItems normalization (top-level, persisted) ─────────────────────
    // Player-forged Named Weapons / armor live on the save at the TOP LEVEL
    // (incoming.creatorItems), NOT under .character — so the character sanitizer
    // above never touched them and they round-tripped UNVALIDATED. A forged save
    // could store a Named Weapon with weaponEp 999999 / arbitrary tags, and the
    // weapon name (echoed into the public PvP battle log) bypassed the moderation
    // the bloodline/jutsu names get. Clamp numerics, whitelist tags/element/
    // quality, moderate player text, strip inline SVG / oversized images —
    // mirroring the savedBloodlines normalizer above + sanitizePvpItems. (PvP
    // also re-clamps these at session-create, so this is storage-side defense in
    // depth + name moderation.) The `delete char.creatorItems` above only strips
    // an admin-content injection from the .character sub-object; players
    // legitimately own this top-level array, so it is kept (sanitized).
    const CREATOR_ITEM_CAP = 500;
    const VALID_WEAPON_ELEMENTS = new Set(['', 'Earth', 'Wind', 'Water', 'Lightning', 'Fire', 'Yin', 'Yang']);
    const VALID_WEAPON_EFFECT_TARGETS = new Set(['self', 'opponent', 'enemy', 'both']);
    const KNOWN_ARMOR_QUALITIES = new Set(['Standard', 'Reinforced', 'Rare', 'Elite', 'Legendary', 'Mythic']);
    let sanitizedCreatorItems: unknown;
    if (Array.isArray(incoming.creatorItems)) {
        sanitizedCreatorItems = (incoming.creatorItems as Array<Record<string, unknown>>)
            .slice(0, CREATOR_ITEM_CAP)
            .map((item) => {
                if (!item || typeof item !== 'object') return {};
                const out: Record<string, unknown> = { ...item };
                // Player-authored text — moderate + length-cap (the name appears
                // in the public PvP battle log; description/flavor in tooltips).
                if (typeof out.name === 'string') out.name = sanitizeUserText(out.name, TEXT_LIMITS.storyName);
                if (typeof out.description === 'string') out.description = sanitizeUserText(out.description, TEXT_LIMITS.description);
                if (typeof out.flavorText === 'string') out.flavorText = sanitizeUserText(out.flavorText, TEXT_LIMITS.description);
                // Strip inline SVG / oversized images — same rule as bloodlines
                // (shared image storage hosts real images via /api/images). A
                // normal small data-URL / reference is preserved.
                if (typeof out.image === 'string') {
                    const img = out.image;
                    if (/^data:image\/svg/i.test(img) || img.length > RAW_BLOODLINE_IMAGE_MAX_BYTES) out.image = undefined;
                }
                // Weapon numerics — match sanitizePvpItems bounds (api/pvp/session.ts).
                if (out.weaponEp != null) out.weaponEp = Math.max(0, Math.min(600, Number(out.weaponEp) || 0));
                if (out.weaponRange != null) out.weaponRange = Math.max(0, Math.min(30, Number(out.weaponRange) || 0));
                if (out.weaponCooldown != null) out.weaponCooldown = Math.max(0, Math.min(30, Number(out.weaponCooldown) || 0));
                if (out.apCost != null) out.apCost = Math.max(0, Math.min(200, Number(out.apCost) || 40));
                if (out.weaponEffectValue != null) out.weaponEffectValue = Math.max(0, Math.min(100, Number(out.weaponEffectValue) || 0));
                if (out.restoreChakra != null) out.restoreChakra = Math.max(0, Math.min(5000, Number(out.restoreChakra) || 0));
                if (out.restoreStamina != null) out.restoreStamina = Math.max(0, Math.min(5000, Number(out.restoreStamina) || 0));
                // weaponTags — whitelist + clamp + cap (same as sanitizePvpItems).
                if (out.weaponTags != null) {
                    const rawTags = Array.isArray(out.weaponTags) ? out.weaponTags : [];
                    out.weaponTags = (rawTags as unknown[])
                        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
                        .filter((t) => typeof t.name === 'string' && KNOWN_TAG_NAMES.has(String(t.name)))
                        .map((t) => {
                            const tag: Record<string, unknown> = { name: canonicalTagName(String(t.name)) };
                            if (t.percent != null) tag.percent = Math.max(0, Math.min(100, Number(t.percent) || 0));
                            return tag;
                        })
                        .slice(0, 10);
                }
                // Whitelisted enums — drop a single bad field, not the whole item.
                if (out.weaponEffect != null) {
                    if (KNOWN_TAG_NAMES.has(String(out.weaponEffect))) out.weaponEffect = canonicalTagName(String(out.weaponEffect));
                    else delete out.weaponEffect;
                }
                if (out.weaponElement != null && !VALID_WEAPON_ELEMENTS.has(String(out.weaponElement))) delete out.weaponElement;
                if (out.weaponEffectTarget != null && !VALID_WEAPON_EFFECT_TARGETS.has(String(out.weaponEffectTarget))) delete out.weaponEffectTarget;
                if (out.armorQuality != null && !KNOWN_ARMOR_QUALITIES.has(String(out.armorQuality))) delete out.armorQuality;
                // Bonus stat grants — clamp each numeric to a sane ceiling so a
                // forged item can't ship a 999999 stat (PvP also caps total stats
                // at MAX_STAT, this is storage hygiene).
                if (out.bonuses && typeof out.bonuses === 'object') {
                    // sub-5: clamp custom-item bonuses to the built-in legendary
                    // baseline (passive %s <=1, shield <=100, vitals <=150, specialty
                    // total scaled to the per-slot budget) so a forged item can't
                    // out-scale real gear. Flag-off keeps the legacy [0,1000] clamp.
                    if (process.env.ITEM_BONUS_BUDGET === '1') return budgetItemBonuses(out);
                    const bonuses = out.bonuses as Record<string, unknown>;
                    for (const k of Object.keys(bonuses)) {
                        bonuses[k] = Math.max(0, Math.min(1000, Number(bonuses[k]) || 0));
                    }
                }
                return out;
            });
    }

    const out: Record<string, unknown> = { ...incoming, character: char };
    if (Array.isArray(incoming.savedBloodlines)) out.savedBloodlines = normalizeBloodlineArray(incoming.savedBloodlines, existing?.savedBloodlines);
    if (sanitizedCreatorItems !== undefined) out.creatorItems = sanitizedCreatorItems;
    return out;
}

// ── Clan / village identity lockdown ──────────────────────────────────────
// Three character fields gate critical permissions and were previously
// trusted blindly from the client save POST:
//   - `clanFounder` is read by api/clan/seal-pool/distribute.ts to authorise
//     pool drains. A client POST with { clanFounder: true, clan: "TARGET" }
//     used to be enough to take over any clan's distribution.
//   - `clan` decides which clan you contribute to, vote in, and donate to.
//   - `village` decides which sealed pools, kage finales, and same-village
//     gates apply to you.
//
// We can't lock these outright — there are legitimate transitions (joining /
// founding / leaving a clan) — so this helper cross-checks any change
// against the canonical `save:clan-<slug>` record and the originating
// village. Async because it reads other KV keys; called AFTER the sync
// sanitizer so all other fields are already clamped.
function clanRecordSlug(name: string): string {
    return 'clan-' + name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// #14 telemetry — count player saves that arrive WITHOUT a `_baseSaveVersion`
// stamp (old/stale clients; the current client always echoes it on its
// own-save autosave paths). Best-effort daily counter so an operator can watch
// the per-day total trend toward zero before making the multi-tab guard
// mandatory. This key has the `telemetry:` prefix, so it lives on the BASE
// store (Supabase/pg `public.kv_store`), NOT the disk overlay — the /api/kv
// proxy reads only the disk overlay and would always return null for it, so do
// NOT read it there. Read the base store directly, e.g.
//   SELECT value FROM public.kv_store WHERE key = 'telemetry:save-noversion:<UTC-date>';
// RMW is non-atomic (kv has no incr) — fine for a trend signal — and only runs
// on the missing path, so steady-state overhead is zero once clients roll over.
const SAVE_NOVERSION_TELEMETRY_TTL_SEC = 45 * 24 * 60 * 60; // 45 days
async function recordMissingSaveVersion(playerName: string): Promise<void> {
    try {
        const key = saveVersionTelemetryKey(new Date().toISOString());
        const cur = (await kv.get<{ count?: number }>(key)) ?? {};
        await kv.set(
            key,
            { count: Number(cur.count ?? 0) + 1, lastPlayer: playerName, lastAt: Date.now() },
            { ex: SAVE_NOVERSION_TELEMETRY_TTL_SEC },
        );
    } catch {
        // Telemetry is best-effort and MUST NOT affect the save outcome.
    }
}

type MinimalClanRec = { name?: string; founderName?: string; members?: Array<{ name?: string }> };

async function validateClanAndVillageIdentity(
    safeIncoming: Record<string, unknown>,
    existing: Record<string, unknown> | null,
    playerName: string,
): Promise<Record<string, unknown>> {
    const inChar = safeIncoming.character as Record<string, unknown> | undefined;
    if (!inChar) return safeIncoming;
    const exChar = (existing?.character as Record<string, unknown> | undefined) ?? {};
    const out: Record<string, unknown> = { ...inChar };

    // Village: locked. Set at registration; no relocation flow exists today.
    // If the client tries to change village post-registration, revert to the
    // server-side value. (If a relocate endpoint is ever added, it should
    // mutate the save server-side and this check will still pass because
    // exChar.village will already reflect the new value.)
    if (exChar.village && out.village !== exChar.village) {
        out.village = exChar.village;
    }

    // Clan / clanFounder cross-validation.
    const exClan = String(exChar.clan ?? '').trim();
    const inClan = String(out.clan ?? '').trim();
    const exFounder = !!exChar.clanFounder;
    const inFounder = !!out.clanFounder;

    if (inClan === exClan) {
        // Clan unchanged — but founder flag may still be flipping. A client
        // can't unilaterally promote itself to founder of its existing clan.
        if (inFounder !== exFounder) {
            if (inFounder && inClan) {
                const rec = await kv.get<MinimalClanRec>(`save:${clanRecordSlug(inClan)}`);
                // playerName is the safeName slug; founderName is a stored
                // display name — canonicalize it through safeName to compare.
                const isFounder = safeName(rec?.founderName ?? '') === playerName;
                if (!isFounder) out.clanFounder = exFounder;
            } else {
                // Demoting self (inFounder=false): always allowed.
            }
        }
    } else if (!inClan) {
        // Leaving — always allowed; force founder false.
        out.clan = undefined;
        out.clanFounder = false;
    } else {
        // Joining or switching — require the target clan record to exist
        // AND list this player among its members. The clan flow writes
        // membership server-side BEFORE the character flip, so a legit
        // join will pass; a forged save POST will not.
        const rec = await kv.get<MinimalClanRec>(`save:${clanRecordSlug(inClan)}`);
        // playerName is already the safeName slug; member/founder names are
        // stored display names, so canonicalize them through safeName to compare.
        const slug = playerName;
        const isMember = !!rec?.members?.some(m => safeName(m?.name ?? '') === slug);
        if (!isMember) {
            // Reject the clan change entirely.
            out.clan = exClan || undefined;
            out.clanFounder = exFounder;
        } else {
            // Membership confirmed. Founder flag is authoritative from the
            // clan record, not the client.
            out.clanFounder = safeName(rec?.founderName ?? '') === slug;
        }
    }

    return { ...safeIncoming, character: out };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Player saves must NEVER be cached. The GET is authed via custom headers
    // (x-player-name / x-player-password) that Cloudflare doesn't treat as a
    // cache-bypass signal, so a broad edge cache rule could otherwise serve a
    // stale save (training set on one device missing on another) — or worse,
    // serve one player's save to another keyed only on the URL. no-store on
    // every response (GET reads, POST/DELETE writes) closes that off.
    res.setHeader('Cache-Control', 'no-store');

    const name = safeName(String(req.query.name ?? ''));
    if (!name) return res.status(400).json({ error: 'Invalid name.' });

    const key = `save:${name}`;
    // Clan saves use `save:clan-<slug>` keys — they're shared per-clan, so any
    // logged-in player may read/write them. Admin actions still flow through
    // ?signal=1 which requires admin auth.
    const isClanSave = name.startsWith('clan-');

    if (req.method === 'GET') {
        // Reads require *some* auth — stops anonymous bots from scraping every
        // player's save by guessing names. Logged-in players can still read
        // other players' saves (needed for PvP opponent loading, clan record
        // lookups, etc.) but at least we know who's doing it.
        // Sensitive economy fields (ryo, inventory, etc.) are stripped for non-owners.
        const identity = await authedPlayerOrAdmin(req, name);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        const stored = await kv.get<Record<string, unknown>>(key);
        if (stored === null) return res.status(404).end();
        const data = isClanSave
            ? stored
            : (await settleSaveRecordForRead(name, stored, { persist: true })).record;

        // Strip sensitive fields when someone reads another player's save.
        // - Owners + admins: full save.
        // - Clan saves: full save (any logged-in player can read shared clan record).
        // - Anyone else: public-only projection (name/level/village/HP/etc.).
        //   This drops PvP loadout (jutsu, pvpItems, equipment, armor*, bloodlineMult,
        //   itemDamagePct, stats, savedBloodlines, creatorJutsus, creatorItems)
        //   so opponents can't be scouted out-of-band. The server hydrates
        //   actual opponent combat data from save:<name> directly when PvP
        //   sessions are created.
        //
        // ?combatOnly=1 layers a second strip on top — drops mission /
        // achievement / lifetime-counter fields that combat never reads.
        // Used by client fetchPlayerCombatSave() to shave ~50–150KB per
        // PvP fetch (challenge accept + village raid prep do 2 fetches each).
        // identity.name and `name` are both safeName slugs, so a direct compare
        // correctly recognises the owner (the old `.toLowerCase().trim()` left a
        // spaced-name owner looking like a foreigner and served them a stripped
        // public projection of their own save).
        const isOwner = identity.admin || isClanSave || identity.name === name;
        const combatOnly = req.query.combatOnly === '1';
        let payload = isOwner ? data : publicProjection(stripPrivateFields(data));
        if (combatOnly) payload = combatProjection(payload);
        return res.status(200).json(payload);
    }

    if (req.method === 'POST') {
        try {
            // Body size guard. We strip image fields server-side post-parse,
            // but a multi-MB body still has to be parsed (synchronous work
            // on a tight Vercel cold-start budget). Cap incoming payloads at
            // 1 MB — any legit save is under ~100 KB after image stripping
            // and the client already strips embedded images before POSTing.
            const contentLengthHeader = req.headers['content-length'];
            const contentLength = Array.isArray(contentLengthHeader) ? Number(contentLengthHeader[0]) : Number(contentLengthHeader);
            if (Number.isFinite(contentLength) && contentLength > 1_000_000) {
                return res.status(413).json({ error: 'Save payload too large. Strip embedded images and retry.' });
            }
            const resetSignalKey = `reset-signal:${name.toLowerCase()}`;
            const adminLockKey = `admin-lock:${name.toLowerCase()}`;
            if (req.query.ack === '1') {
                // Ack just clears two short-lived keys for this player.
                const ackIdentity = await authedPlayerOrAdmin(req, name);
                if (!ackIdentity) return res.status(401).json({ error: 'Authentication required.' });
                if (!ackIdentity.admin && !isClanSave && ackIdentity.name !== name) {
                    return res.status(403).json({ error: 'Cannot ack another player.' });
                }
                await Promise.all([
                    kv.del(resetSignalKey),
                    kv.del(adminLockKey),
                ]);
                return res.status(200).json({ ok: true });
            }

            const isAdminSave = req.query.signal === '1';

            // Admin-flagged writes require admin auth (constant-time compare in isAdmin).
            let identityName: string | null = null;
            if (isAdminSave) {
                if (!isAdmin(req)) {
                    return res.status(401).json({ error: 'Admin authentication required.' });
                }
            } else {
                // Non-admin saves: player can save their own; clan saves are
                // gated by clan membership (the actor's character.clan must
                // match the clan-<slug> being written).
                const identity = await authedPlayerOrAdmin(req, name);
                if (!identity) return res.status(401).json({ error: 'Authentication required.' });
                if (!identity.admin && !isClanSave && identity.name !== name) {
                    return res.status(403).json({ error: 'Cannot save another player.' });
                }
                if (!identity.admin && isClanSave) {
                    // Verify the actor belongs to this clan before letting them
                    // mutate the shared clan record. The clan slug here is
                    // whatever follows "clan-" in the key path.
                    try {
                        const targetClanSlug = name.replace(/^clan-/, '').trim().toLowerCase();
                        const actorSave = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                        const actorChar = (actorSave?.character ?? null) as Record<string, unknown> | null;
                        const actorClan = String(actorChar?.clan ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (!actorClan || actorClan !== targetClanSlug) {
                            // Membership check failed — but allow the write
                            // through if the clan record doesn't yet exist
                            // AND the incoming body declares this player as
                            // its founder. This covers two legitimate cases
                            // the membership check would otherwise reject:
                            //
                            //   • First-time creation via "Create Clan" —
                            //     the clan record is written before the
                            //     character's clan field syncs server-side.
                            //   • Reclaim after a server reset wiped the
                            //     previous save:clan-<slug> record.
                            //
                            // First-claimer-wins semantics. Once a record
                            // exists, the membership check is the only path.
                            const existingClan = await kv.get<Record<string, unknown>>(key);
                            const incomingBody = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
                            const bodyFounder = safeName(String(incomingBody?.founderName ?? ''));
                            const allowCreate = !existingClan && bodyFounder && bodyFounder === identity.name;

                            // Non-member self-join-request carve-out. A player
                            // who isn't in this clan must still be able to send a
                            // join REQUEST — otherwise "Request Join" is
                            // impossible, since the only way the client records a
                            // request is by appending to the clan's shared
                            // joinRequests array (this very POST). The per-field
                            // validator (validateClanSaveWrite) already permits a
                            // non-member to add ONLY their own joinRequests entry
                            // and suppresses every other field, but it never ran
                            // because this membership gate rejected the write
                            // first. Allow the write through only when it's a
                            // bona-fide self-join-request: the clan already
                            // exists, the caller appears in the incoming
                            // joinRequests, and the caller is NOT in the incoming
                            // members — so this path can't be abused to self-add
                            // to the roster (which the validator's "self add"
                            // rule would otherwise let through, bypassing the
                            // leader/elder approval flow).
                            const matchesCaller = (entry: unknown) =>
                                safeName(String((entry as Record<string, unknown> | null)?.name ?? '')) === identity.name;
                            const callerInRequests = Array.isArray(incomingBody?.joinRequests)
                                && (incomingBody.joinRequests as unknown[]).some(matchesCaller);
                            const callerInMembers = Array.isArray(incomingBody?.members)
                                && (incomingBody.members as unknown[]).some(matchesCaller);
                            const allowJoinRequest = !!existingClan && callerInRequests && !callerInMembers;

                            if (!allowCreate && !allowJoinRequest) {
                                return res.status(403).json({ error: 'Only members of this clan can write its shared record.' });
                            }
                            if (allowCreate) {
                                // Per-player rate limit on first-time clan creation
                                // to stop name-squatting / spam after a server
                                // reset. 3 new clans per hour is plenty for
                                // legitimate "I created the wrong name" recovery.
                                if (!(await enforceRateLimitKv(req, res, 'clan-create', 3, 60 * 60_000, identity.name))) return;
                            } else {
                                // Per-player rate limit on join requests so a
                                // non-member can't spam every clan's shared
                                // record. 20/hour is far above any legitimate
                                // join-request cadence.
                                if (!(await enforceRateLimitKv(req, res, 'clan-join-request', 20, 60 * 60_000, identity.name))) return;
                            }
                        }
                    } catch {
                        return res.status(500).json({ error: 'Unable to verify clan membership.' });
                    }
                }
                identityName = identity.admin ? null : identity.name;

                // Per-account rate limit: max 1 save per 3 seconds. Stops a
                // hostile client from hammering the save endpoint to amplify
                // gain caps. KV-backed so it survives serverless cold starts.
                if (!isClanSave && !(await enforceRateLimitKv(req, res, 'save-burst', 1, 3_000, identityName))) {
                    return; // 429 already written
                }
            }

            // If a reset-signal is pending (admin edit in-flight) and this is NOT the admin save,
            // silently drop the client auto-save so it can't overwrite admin changes.
            // Speculatively fetch the existing save in parallel with the signal checks —
            // saves one round-trip on every auto-save (the common path).
            const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            if (!isAdminSave) {
                // ── Atomicity (finding 14) ─────────────────────────────────
                // Serialize the read-modify-write through withKvLock on the SAME
                // key the currency endpoints use: withKvLock('save:<name>') maps to
                // the lock key 'lock:save:<name>'. Sharing the helper means the save
                // path and every bank / seal-pool / treasury / daily-agenda /
                // weekly-boss / pvp-reward writer use IDENTICAL TTL (5s default),
                // retry+backoff, and release semantics on the one key — closing the
                // early-expiry window the old hand-rolled 2s TTL re-opened (a slow
                // save could outlive its 2s lock mid-op, a withKvLock currency
                // writer slips in, and the save's later release deletes the NEW
                // holder's lock). Clan saves serialize through it too.
                //
                // failClosed: under sustained contention withKvLock retries 5× with
                // backoff and then THROWS LockContendedError rather than running the
                // RMW unlocked; we catch it below and return the SAME 429 the
                // hand-rolled lock did (so the observable contention response is
                // unchanged — only now a brief overlap is absorbed by the retry
                // instead of failing the autosave immediately). Release is handled
                // by withKvLock's own finally — no manual kv.del here.
                //
                // The inner `return res...(...)` calls SEND the response as a side
                // effect and return out of the locked closure; the `return` after
                // the await then exits the handler. The RMW body below is unchanged.
                try {
                    await withKvLock(`save:${name.toLowerCase()}`, async () => {
                    const [pendingSignal, adminLock, existing] = await Promise.all([
                        kv.get(resetSignalKey),
                        kv.get(adminLockKey),
                        kv.get(key),
                    ]);
                    if (pendingSignal || adminLock) return res.status(200).end();
                    // Sanitize before merge: caps per-save gains to prevent exploit spikes.
                    // Clan saves go through a different validator (field-level
                    // role gating + per-call deltas) instead of the player-save
                    // sanitizer because the blob has different fields.
                    // For brand-new accounts (no existing), sanitize against a zeroed
                    // baseline so a fresh registration can't submit absurd values.
                    let safeIncoming: unknown;
                    if (isClanSave) {
                        const { next, suppressed } = validateClanSaveWrite(
                            (existing as Record<string, unknown> | null) ?? null,
                            incoming as Record<string, unknown>,
                            {
                                callerName: identityName ?? '',
                                isAdmin: identityName === null,
                            },
                        );
                        safeIncoming = next;
                        if (suppressed.length > 0) {
                            console.warn('[save POST clan] suppressed:', identityName ?? 'admin', name, suppressed.join('; '));
                        }
                    } else {
                        safeIncoming = sanitizeCharacterSave(
                            incoming as Record<string, unknown>,
                            (existing as Record<string, unknown> | null) ?? null,
                        );
                        // Cross-validate clan / clanFounder / village against
                        // canonical clan records. This is the gate that stops
                        // a forged save POST from promoting itself to
                        // clanFounder of any clan (and then draining its
                        // seal pool via clan/seal-pool/distribute).
                        if (identityName) {
                            safeIncoming = await validateClanAndVillageIdentity(
                                safeIncoming as Record<string, unknown>,
                                (existing as Record<string, unknown> | null) ?? null,
                                identityName,
                            );
                        }
                    }

                    // ── Rolling-window gain caps (finding 6) ──────────────────
                    // Track ryo / stat / xp gain over the last 60 seconds for
                    // this account. If a save would push cumulative gains over
                    // the threshold, reject with 429. Clan saves skipped.
                    if (existing && !isClanSave && identityName) {
                        const exChar = (existing as Record<string, unknown>).character as Record<string, unknown> | undefined;
                        const inChar = (safeIncoming as Record<string, unknown>).character as Record<string, unknown> | undefined;
                        if (exChar && inChar) {
                            const exRyo = Math.max(0, Number(exChar.ryo ?? 0));
                            const inRyo = Math.max(0, Number(inChar.ryo ?? 0));
                            const ryoDelta = Math.max(0, inRyo - exRyo);
                            const exXp = Math.max(0, Number(exChar.xp ?? exChar.experience ?? 0));
                            const inXp = Math.max(0, Number(inChar.xp ?? inChar.experience ?? 0));
                            const xpDelta = Math.max(0, inXp - exXp);
                            const exStats = (exChar.stats ?? {}) as Record<string, number>;
                            const inStats = (inChar.stats ?? {}) as Record<string, number>;
                            const statDelta: Record<string, number> = {};
                            for (const k of Object.keys(inStats)) {
                                const ex = Number(exStats[k] ?? 0);
                                const inv = Number(inStats[k] ?? 0);
                                const d = Math.max(0, inv - ex);
                                if (d > 0) statDelta[k] = d;
                            }
                            // Premium / power-material currency deltas (anti-tamper window).
                            const currencyDelta: Record<string, number> = {};
                            for (const k of Object.keys(MAX_CURRENCY_PER_MINUTE)) {
                                const d = Math.max(0, Number(inChar[k] ?? 0) - Number(exChar[k] ?? 0));
                                if (d > 0) currencyDelta[k] = d;
                            }

                            const win = (await readGainsWindow(identityName)) ?? freshWindow();
                            const ageMs = Date.now() - win.startedAt;
                            const cur = (ageMs > GAIN_WINDOW_MS) ? freshWindow() : win;

                            const nextRyo = cur.ryo + ryoDelta;
                            const nextXp = cur.xp + xpDelta;
                            const nextStat: Record<string, number> = { ...cur.stat };
                            for (const [k, d] of Object.entries(statDelta)) nextStat[k] = (nextStat[k] ?? 0) + d;
                            // Old windows (written before this field existed) lack `currency`.
                            const nextCurrency: Record<string, number> = { ...(cur.currency ?? {}) };
                            for (const [k, d] of Object.entries(currencyDelta)) nextCurrency[k] = (nextCurrency[k] ?? 0) + d;

                            if (nextRyo > MAX_RYO_PER_MINUTE) {
                                return res.status(429).json({
                                    error: `Ryo gain rate-limited (over ${MAX_RYO_PER_MINUTE} / 60s).`,
                                });
                            }
                            if (nextXp > MAX_XP_PER_MINUTE) {
                                return res.status(429).json({
                                    error: `XP gain rate-limited (over ${MAX_XP_PER_MINUTE} / 60s).`,
                                });
                            }
                            for (const [k, total] of Object.entries(nextStat)) {
                                if (total > MAX_STAT_PER_MINUTE) {
                                    return res.status(429).json({
                                        error: `Stat ${k} gain rate-limited (over ${MAX_STAT_PER_MINUTE} / 60s).`,
                                    });
                                }
                            }
                            // Premium/material currency per-minute caps. Anti-tamper only,
                            // generous vs legit faucets. DISABLE_CURRENCY_WINDOW=1 turns the
                            // 429 off instantly if a legit faucet ever trips it (the window is
                            // still tracked, just not enforced).
                            if (process.env.DISABLE_CURRENCY_WINDOW !== '1') {
                                for (const [k, total] of Object.entries(nextCurrency)) {
                                    const cap = MAX_CURRENCY_PER_MINUTE[k];
                                    if (cap != null && total > cap) {
                                        return res.status(429).json({
                                            error: `${k} gain rate-limited (over ${cap} / 60s).`,
                                        });
                                    }
                                }
                            }

                            // Allowed — persist the updated window.
                            await writeGainsWindow(identityName, { startedAt: cur.startedAt, ryo: nextRyo, stat: nextStat, xp: nextXp, currency: nextCurrency });
                        }
                    }

                    // ── Multi-tab autosave guard ─────────────────────────────
                    // Stale-write detection via monotonic version stamp.
                    //
                    // Each stored player save carries `_saveVersion: number`,
                    // bumped on every successful write. Clients MAY echo back
                    // the version they last loaded as `_baseSaveVersion` in
                    // the request body. If they do, and the server's stored
                    // version is newer, reject the write — another tab saved
                    // in the meantime and overwriting would clobber that
                    // progress.
                    //
                    // Clients that don't send `_baseSaveVersion` get the old
                    // (lossy) behaviour. This is opt-in so a stale browser
                    // tab still on the prior client build doesn't get locked
                    // out of saving entirely.
                    //
                    // Clan saves are excluded — they're intentionally shared
                    // across the whole clan and use a separate field-level
                    // delta validator that already handles concurrent writes.
                    const existingObj = (existing as Record<string, unknown> | null) ?? null;
                    const storedVersion = Number(existingObj?._saveVersion ?? 0);
                    const incomingBody = incoming as Record<string, unknown>;
                    const baseVersion = parseBaseSaveVersion(incomingBody?._baseSaveVersion);

                    // #14 step 2: REQUIRE a version stamp for non-clan player
                    // saves. A missing field means a client old enough to
                    // predate the autosave guard (pre-2026-05-26 / 3455f8d) — the
                    // current client always echoes a numeric version (0+) on
                    // every own-save path (autosave timers + immediate saves).
                    // Such a stale tab can silently clobber a newer tab's
                    // progress, so reject it and tell it to refresh. Admin saves
                    // (identityName === null, incl. cross-player grants) and clan
                    // saves are exempt. Telemetry still records the rejection so
                    // the (now ~0) trend stays visible in kv_store.
                    if (isVersionlessPlayerSave(isClanSave, identityName, baseVersion)) {
                        // isVersionlessPlayerSave is true only when identityName is set.
                        console.warn('[save-version] REJECT player save missing _baseSaveVersion (client too old):', identityName);
                        await recordMissingSaveVersion(identityName!);
                        return res.status(426).json({
                            error: 'Your game client is out of date. Please refresh the page to keep saving.',
                            code: 'CLIENT_REFRESH_REQUIRED',
                        });
                    }

                    if (!isClanSave && baseVersion !== null && baseVersion < storedVersion) {
                        return res.status(409).json({
                            error: 'Save conflict — another tab or device wrote first.',
                            currentVersion: storedVersion,
                        });
                    }
                    const nextVersion = storedVersion + 1;
                    const mergedPayload = existing ? mergePreservingImages(safeIncoming, existing) : safeIncoming;
                    // Strip `_baseSaveVersion` from the persisted payload so
                    // it doesn't accumulate in the stored save record.
                    const mergedRecord = mergedPayload as Record<string, unknown>;
                    delete mergedRecord._baseSaveVersion;
                    const payload = isClanSave ? mergedRecord : {
                        ...mergedRecord,
                        _saveVersion: nextVersion,
                        _saveAt: Date.now(),
                    };

                    // Build the registry entry from the SANITIZED payload, not
                    // the raw incoming body (audit #13). Reading raw `incoming`
                    // let a tampered client publish a forged level/village/
                    // specialty into the public roster index even though the
                    // persisted save was clamped. safeIncoming is what we just
                    // wrote, so the index matches the stored truth.
                    const char = (safeIncoming as Record<string, unknown>)?.character as Record<string, unknown> | undefined;
                    const displayName: string = (char?.name as string) || name;
                    const registryEntry = {
                        name: displayName,
                        level: (char?.level as number) ?? 1,
                        village: (char?.village as string) ?? '',
                        specialty: (char?.specialty as string) ?? '',
                        lastSeen: Date.now(),
                    };

                    // Throttle the registry rewrite (see REGISTRY_REFRESH_MS +
                    // shouldWriteRegistry). The previous registry write time is carried
                    // in the save blob as `_registryAt` (no extra read); we re-stamp it
                    // only when we actually rewrite. The save blob (kv.set below) is
                    // written every time regardless — no progress is ever skipped.
                    const prevRegistryAt = Number(existingObj?._registryAt ?? 0);
                    const writeRegistry = shouldWriteRegistry({
                        isClanSave,
                        existingChar: (existingObj?.character ?? null) as Record<string, unknown> | null,
                        next: registryEntry,
                        prevRegistryAt,
                        now: Date.now(),
                        refreshMs: REGISTRY_REFRESH_MS,
                    });
                    // Stamp when we actually (re)wrote the registry so the next save can
                    // measure drift. Non-clan only — clan payloads stay byte-identical.
                    if (!isClanSave) (payload as Record<string, unknown>)._registryAt = writeRegistry ? Date.now() : prevRegistryAt;

                    await Promise.all([
                        kv.set(key, payload),
                        ...(writeRegistry ? [kv.hset(REGISTRY_KEY, { [name]: registryEntry })] : []),
                    ]);
                    return res.status(200).json(isClanSave ? { ok: true } : { ok: true, _saveVersion: nextVersion });
                    }, { failClosed: true });
                    return; // the locked closure already sent the response
                } catch (lockErr) {
                    // Sustained contention (lock couldn't be acquired within the
                    // retry budget): same fast 429 the hand-rolled lock returned.
                    // withKvLock already released any lock it held; real errors from
                    // the RMW propagate to the outer handler catch → 500.
                    if (lockErr instanceof LockContendedError) {
                        return res.status(429).json({ error: 'Concurrent save in flight. Retry.' });
                    }
                    throw lockErr;
                }
            }

            // Admin save path — lock first, then read + write, then signal reload.
            await kv.set(adminLockKey, 1, { ex: 300 });
            const existing = await kv.get(key);
            const adminStoredVersion = Number((existing as Record<string, unknown> | null)?._saveVersion ?? 0);
            const adminMerged = existing ? mergePreservingImages(incoming, existing) : incoming;
            const payload = {
                ...(adminMerged as Record<string, unknown>),
                _saveVersion: adminStoredVersion + 1,
                _saveAt: Date.now(),
            };

            const char = (incoming as Record<string, unknown>)?.character as Record<string, unknown> | undefined;
            const displayName: string = (char?.name as string) || name;
            const registryEntry = {
                name: displayName,
                level: (char?.level as number) ?? 1,
                village: (char?.village as string) ?? '',
                specialty: (char?.specialty as string) ?? '',
                lastSeen: Date.now(),
            };

            await Promise.all([
                kv.set(key, payload),
                kv.hset(REGISTRY_KEY, { [name]: registryEntry }),
            ]);
            // Set reset-signal after the new save is committed so the client reloads that exact version.
            await kv.set(resetSignalKey, 1, { ex: 300 });
            return res.status(200).end();
        } catch (err) {
            console.error('[save POST]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const adminAuth = isAdmin(req);
            if (!adminAuth) {
                const identity = await authedPlayerOrAdmin(req, name);
                if (!identity) return res.status(401).json({ error: 'Authentication required.' });
                if (!identity.admin && isClanSave) {
                    // Clan record: only the clan FOUNDER (or an admin) may delete
                    // the shared save — mirrors the founder-only "Delete Clan" UI.
                    // (The POST path lets any clan member WRITE the record, but a
                    // destructive delete is restricted to the founder so a random
                    // logged-in player can't wipe a rival clan.) The founder gate
                    // at clan creation guarantees founderName.toLowerCase() equals
                    // the founder's canonical name. If the record is already gone
                    // there is nothing to protect, so we no-op rather than 403.
                    const clanRec = await kv.get<{ founderName?: string }>(key);
                    const founder = safeName(String(clanRec?.founderName ?? ''));
                    if (clanRec && founder !== identity.name) {
                        return res.status(403).json({ error: 'Only the clan founder can delete this clan.' });
                    }
                } else if (!identity.admin && identity.name !== name) {
                    // Deleting ANOTHER player's save requires that player's own
                    // password (legacy body-supplied path) verified against an
                    // EXISTING auth record. Default-deny: a legacy account with no
                    // auth record can only be deleted by an admin. (Previously the
                    // missing-auth-record case fell through and let any logged-in
                    // player delete a legacy save.)
                    const playerPw = req.headers['x-player-password'] as string | undefined;
                    const authRecord = await kv.get(`auth:${name.toLowerCase()}`);
                    if (!authRecord || !playerPw || !(await verifyPlayerPassword(name, playerPw))) {
                        return res.status(403).json({ error: 'Cannot delete another player\'s save.' });
                    }
                }
            }
            const lowered = name.toLowerCase();
            const adminLockKey = `admin-lock:${lowered}`;
            await kv.set(adminLockKey, 1, { ex: 300 });
            await Promise.all([
                kv.del(key),
                kv.hdel(REGISTRY_KEY, name),
                // Signal the player's client to reload on next heartbeat (5-min TTL)
                kv.set(`reset-signal:${lowered}`, 1, { ex: 300 }),
            ]);
            return res.status(200).json({ ok: true });
        } catch (err) {
            console.error('[save DELETE]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
