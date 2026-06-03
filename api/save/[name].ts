import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { verifyPlayerPassword } from '../player-auth.js';
import { authedPlayerOrAdmin, isAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { validateClanSaveWrite } from '../_clan-save-validate.js';
import { sanitizeUserText, TEXT_LIMITS } from '../_text-moderation.js';
import { parseBaseSaveVersion, saveVersionTelemetryKey, isVersionlessPlayerSave } from './_save-version.js';

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

    // ── Free-form user text moderation ──────────────────────────────
    // customTitle is the only character-level field a player can put
    // arbitrary text into. Mask profanity, redact PII, cap length so a
    // tampered save can't park a slur as their public title or stuff
    // a 10 KB string into the field.
    if (typeof char.customTitle === 'string' && char.customTitle.trim()) {
        char.customTitle = sanitizeUserText(char.customTitle, TEXT_LIMITS.customTitle);
    }

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
        // Leaderboard / Hall-of-Legends counters — feed Hall pages directly,
        // so a tampered save can pad them to claim top spots. All are
        // upward-only by gameplay design. Server-side win endpoints
        // (api/pet/battle-result, etc.) are the legitimate increment path;
        // these caps stop a direct save POST from spoofing.
        totalPetWins: 30,
        totalEndlessTowerWins: 5,
        totalTournamentsCompleted: 3,
        totalTilesExplored: 200,
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
    };
    for (const [field, maxDelta] of Object.entries(LIFETIME_COUNTERS)) {
        const inV = Math.max(0, Number((char as Record<string, unknown>)[field] ?? 0));
        const exV = Math.max(0, Number((exChar as Record<string, unknown>)[field] ?? 0));
        // Disallow shrinking the counter, and clamp growth to maxDelta.
        const clamped = Math.max(exV, Math.min(inV, exV + maxDelta));
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

    // Inventory + tile-card collection size caps. A tampered client could
    // submit thousands of items, both bloating KV and inflating foreign-read
    // payloads. 500 is well above any realistic veteran's working inventory
    // and matches what the client UI can scroll through cleanly.
    const INVENTORY_CAP = 500;
    if (Array.isArray(char.inventory) && (char.inventory as unknown[]).length > INVENTORY_CAP) {
        char.inventory = (char.inventory as unknown[]).slice(0, INVENTORY_CAP);
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
    // Accept NEW exam additions only if they pass the level gate.
    for (const e of inExams) {
        if (!KNOWN_EXAMS.has(e) || seenExams.has(e)) continue;
        const required = EXAM_LEVEL_GATES_SERVER[e];
        if (required != null && charLevel < required) continue;
        validatedExams.push(e);
        seenExams.add(e);
    }
    char.examsPassed = validatedExams.slice(0, 4);

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
    if (Array.isArray(char.savedBloodlines)) {
        const inBloodlines = (char.savedBloodlines as Array<Record<string, unknown>>).slice(0, BLOODLINE_CAP);
        char.savedBloodlines = inBloodlines.map((bl) => {
            if (!bl || typeof bl !== 'object') return {};
            const out: Record<string, unknown> = { ...bl };
            // Rank — fall back to B Rank if unknown.
            const rawRank = String(out.rank ?? '');
            if (!KNOWN_BLOODLINE_RANKS.has(rawRank)) out.rank = 'B Rank';
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
            // Jutsus list — cap count + clamp per-jutsu numerics.
            const rawJutsus = Array.isArray(out.jutsus) ? out.jutsus as Array<Record<string, unknown>> : [];
            out.jutsus = rawJutsus.slice(0, JUTSU_PER_BLOODLINE_CAP).map((j) => {
                if (!j || typeof j !== 'object') return j;
                const jOut: Record<string, unknown> = { ...j };
                if (jOut.effectPower != null) {
                    jOut.effectPower = Math.max(0, Math.min(200, Number(jOut.effectPower) || 0));
                }
                if (jOut.ap != null) {
                    // AP values in bloodline jutsus are 40 / 60 / 80 normally.
                    jOut.ap = Math.max(20, Math.min(200, Number(jOut.ap) || 40));
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
                return jOut;
            });
            return out;
        });
    }

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

                    await Promise.all([
                        kv.set(key, payload),
                        kv.hset(REGISTRY_KEY, { [name]: registryEntry }),
                    ]);
                    return res.status(200).json(isClanSave ? { ok: true } : { ok: true, _saveVersion: nextVersion });
                } finally {
                    // Always release the lock — player AND clan saves now
                    // both serialize through it.
                    await kv.del(writeLockKey).catch(() => undefined);
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
                    const founder = String(clanRec?.founderName ?? '').toLowerCase();
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
