import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { verifyPlayerPassword } from '../player-auth.js';
import { authedPlayerOrAdmin, isAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { validateClanSaveWrite } from '../_clan-save-validate.js';

// Fields stripped from character objects when a non-owner reads another player's save.
// Prevents ryo farming (reading other players' wallets) and inventory snooping.
const PRIVATE_CHAR_FIELDS = [
    'ryo', 'bankedRyo', 'inventory', 'missions', 'missionLog',
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
    return { ...data, character: sanitized };
}

// Character-level fields stripped under ?combatOnly=1 — none of these affect
// combat resolution (only meta progression / cosmetic / lifetime counters).
// Whitelisting was considered but a blacklist is safer here since combat
// touches many character fields and a missed whitelist entry would silently
// break opponent rendering.
const COMBAT_STRIP_CHAR_FIELDS = [
    'inventory', 'tileCards', 'savedTileDeck',
    'missions', 'missionLog', 'completedMissions', 'activeMissions', 'questLog', 'bankLog',
    'storyTraits', 'storyTitle',
    'weeklyBossKills', 'claimedWarCrateIds',
    'unlockedAchievements', 'achievementUnlockedAt',
    'hollowGateRun', 'hollowGateWardenKills', 'hollowGateIntroSeen',
    'endlessTowerRun', 'endlessTowerBestWave',
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
    'ryo', 'honorSeals', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals', 'auraDust',
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

// Rolling 60-second gain windows. Anything above these caps is rejected with
// a 429. These are server-side rate limits independent of the per-save caps;
// they catch a stream of small but legitimate-looking saves that, in
// aggregate, are obviously farming.
const GAIN_WINDOW_MS = 60_000;
const MAX_RYO_PER_MINUTE = 5_000_000;
const MAX_STAT_PER_MINUTE = 1500; // any single stat
const MAX_XP_PER_MINUTE = 1_000_000;

type GainsWindow = { startedAt: number; ryo: number; stat: Record<string, number>; xp: number };

async function readGainsWindow(name: string): Promise<GainsWindow | null> {
    try {
        return await kv.get<GainsWindow>(`ratelimit:save:${name}:gains`);
    } catch {
        return null;
    }
}

async function writeGainsWindow(name: string, w: GainsWindow): Promise<void> {
    try {
        await kv.set(`ratelimit:save:${name}:gains`, w, { ex: Math.ceil(GAIN_WINDOW_MS / 1000) * 2 });
    } catch {
        // best-effort
    }
}

function freshWindow(): GainsWindow {
    return { startedAt: Date.now(), ryo: 0, stat: {}, xp: 0 };
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
    inventory: [], jutsuMastery: [], pets: [], savedBloodlines: [], tileCards: [],
    equipment: {},
};

function sanitizeCharacterSave(
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

    // Level: can't jump more than MAX_LEVEL_GAIN levels per save; hard cap at LEVEL_CAP.
    const exLevel = Math.max(1, Number(exChar.level ?? 1));
    const inLevel = Math.max(1, Number(char.level ?? 1));
    char.level = Math.min(LEVEL_CAP, Math.min(inLevel, exLevel + MAX_LEVEL_GAIN));

    // Ryo: cap the gain per cycle; can't go below zero.
    const exRyo = Math.max(0, Number(exChar.ryo ?? 0));
    const inRyo = Math.max(0, Number(char.ryo ?? 0));
    char.ryo = Math.min(inRyo, exRyo + MAX_RYO_GAIN);

    // Soft currencies: same gain-cap pattern.
    for (const [key, maxGain] of Object.entries(CURRENCY_CAPS)) {
        const exVal = Math.max(0, Number(exChar[key] ?? 0));
        const inVal = Math.max(0, Number(char[key] ?? 0));
        char[key] = Math.min(inVal, exVal + maxGain);
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
        // totalPetWins is incremented server-side by api/pet/battle-result
        // (under a per-player lock + daily cap). Without this clamp a
        // tampered client save could POST `totalPetWins: 9999` directly
        // and spoof the Hall-of-Legends Pet Arena leaderboard.
        totalPetWins: 20,
        // totalEndlessTowerWins similarly drives a HoL leaderboard.
        totalEndlessTowerWins: 5,
    };
    for (const [field, maxDelta] of Object.entries(LIFETIME_COUNTERS)) {
        const inV = Math.max(0, Number((char as Record<string, unknown>)[field] ?? 0));
        const exV = Math.max(0, Number((exChar as Record<string, unknown>)[field] ?? 0));
        // Disallow shrinking the counter, and clamp growth to maxDelta.
        const clamped = Math.max(exV, Math.min(inV, exV + maxDelta));
        (char as Record<string, unknown>)[field] = clamped;
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

    // Inventory + tile-card collection size caps. A tampered client could
    // submit thousands of items, both bloating KV and inflating foreign-read
    // payloads. 500 is well above any realistic veteran's working inventory
    // and matches what the client UI can scroll through cleanly.
    const INVENTORY_CAP = 500;
    if (Array.isArray(char.inventory) && (char.inventory as unknown[]).length > INVENTORY_CAP) {
        char.inventory = (char.inventory as unknown[]).slice(0, INVENTORY_CAP);
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
    const DAILY_CLAIM_DATE_FIELDS = ['claimedVillageAgendaDate', 'claimedMapControlDate'] as const;
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
        char.hospitalizedUntil = now + HOSPITAL_DURATION_MS;
        char.hospitalizedAt = now;
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

    return { ...incoming, character: char };
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
                const isFounder = (rec?.founderName ?? '').toLowerCase() === playerName.toLowerCase();
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
        const lower = playerName.toLowerCase();
        const isMember = !!rec?.members?.some(m => (m?.name ?? '').toLowerCase() === lower);
        if (!isMember) {
            // Reject the clan change entirely.
            out.clan = exClan || undefined;
            out.clanFounder = exFounder;
        } else {
            // Membership confirmed. Founder flag is authoritative from the
            // clan record, not the client.
            out.clanFounder = (rec?.founderName ?? '').toLowerCase() === lower;
        }
    }

    return { ...safeIncoming, character: out };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

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
        const data = await kv.get<Record<string, unknown>>(key);
        if (data === null) return res.status(404).end();

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
        const isOwner = identity.admin || isClanSave || identity.name === name.toLowerCase().trim();
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
                            const bodyFounder = String(incomingBody?.founderName ?? '').toLowerCase();
                            const allowCreate = !existingClan && bodyFounder && bodyFounder === identity.name.toLowerCase();
                            if (!allowCreate) {
                                return res.status(403).json({ error: 'Only members of this clan can write its shared record.' });
                            }
                            // Per-player rate limit on first-time clan creation
                            // to stop name-squatting / spam after a server
                            // reset. 3 new clans per hour is plenty for
                            // legitimate "I created the wrong name" recovery.
                            if (!(await enforceRateLimitKv(req, res, 'clan-create', 3, 60 * 60_000, identity.name))) return;
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
                // Take a short-lived per-save lock around the read-modify-write
                // so concurrent saves can't trample each other. 2-second TTL
                // is plenty for the synchronous work below; lock is auto-released
                // at the end of the path or just expires.
                //
                // Clan saves were previously SKIPPING this lock, which let two
                // members donating simultaneously race-overwrite each other's
                // changes. Now they share the same lock as player saves.
                const writeLockKey = `lock:save:${name.toLowerCase()}`;
                const lockOk = await kv.set(writeLockKey, '1', { nx: true, ex: 2 });
                if (!lockOk) {
                    return res.status(429).json({ error: 'Concurrent save in flight. Retry.' });
                }

                try {
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

                            const win = (await readGainsWindow(identityName)) ?? freshWindow();
                            const ageMs = Date.now() - win.startedAt;
                            const cur = (ageMs > GAIN_WINDOW_MS) ? freshWindow() : win;

                            const nextRyo = cur.ryo + ryoDelta;
                            const nextXp = cur.xp + xpDelta;
                            const nextStat: Record<string, number> = { ...cur.stat };
                            for (const [k, d] of Object.entries(statDelta)) nextStat[k] = (nextStat[k] ?? 0) + d;

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

                            // Allowed — persist the updated window.
                            await writeGainsWindow(identityName, { startedAt: cur.startedAt, ryo: nextRyo, stat: nextStat, xp: nextXp });
                        }
                    }

                    const payload = existing ? mergePreservingImages(safeIncoming, existing) : safeIncoming;

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
                    return res.status(200).end();
                } finally {
                    // Always release the lock — player AND clan saves now
                    // both serialize through it.
                    await kv.del(writeLockKey).catch(() => undefined);
                }
            }

            // Admin save path — lock first, then read + write, then signal reload.
            await kv.set(adminLockKey, 1, { ex: 300 });
            const existing = await kv.get(key);
            const payload = existing ? mergePreservingImages(incoming, existing) : incoming;

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
                // Player must auth via headers; clan saves allow any logged-in
                // player (deletes are admin-gated UI in practice).
                const identity = await authedPlayerOrAdmin(req, name);
                if (!identity) return res.status(401).json({ error: 'Authentication required.' });
                if (!identity.admin && !isClanSave && identity.name !== name) {
                    // Backwards-compat: legacy body-supplied password also accepted.
                    const playerPw = req.headers['x-player-password'] as string | undefined;
                    const authRecord = await kv.get(`auth:${name.toLowerCase()}`);
                    if (authRecord) {
                        if (!playerPw || !(await verifyPlayerPassword(name, playerPw))) {
                            return res.status(403).json({ error: 'Cannot delete another player\'s save.' });
                        }
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
