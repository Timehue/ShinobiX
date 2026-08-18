import { trainingStatGain, rookieStatMultiplier, type TrainingTier } from '../_training-config.js';
import { combinedStatBoost } from '../_stat-growth.js';
import { earnedStatPoints, levelForEarned } from '../_xp-engine.js';

export const TRAINING_TOKEN_TTL_SECONDS = 25 * 60 * 60;
export const MAX_TRAINING_RECEIPTS = 256;
/** Sanity ceiling for a sealed training grant — see storedTrainingGrant. */
export const MAX_SEALED_STAT_GAIN = 2500;

export interface ActiveTrainingSession {
    token: string;
    startedAt: number;
    endsAt: number;
    expiresAt: number;
}

export interface StoredTrainingGrant {
    stat: string;
    startedAt: number;
    endsAt: number;
    sealedGain: number;
    sealedXp: number;
}

const TRAINING_STATS = new Set([
    'strength', 'speed', 'intelligence', 'willpower',
    'ninjutsuOffense', 'ninjutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'bukijutsuOffense', 'bukijutsuDefense',
]);

export function normalizeActiveTrainingSession(raw: unknown): ActiveTrainingSession | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const token = typeof record.token === 'string' && /^[A-Za-z0-9]+$/.test(record.token)
        ? record.token
        : '';
    const startedAt = Number(record.startedAt);
    const endsAt = Number(record.endsAt);
    const expiresAt = Number(record.expiresAt);
    if (!token || !Number.isSafeInteger(startedAt) || !Number.isSafeInteger(endsAt) || !Number.isSafeInteger(expiresAt)) {
        return null;
    }
    if (startedAt <= 0 || endsAt <= startedAt || expiresAt <= endsAt) return null;
    return { token, startedAt, endsAt, expiresAt };
}

/** A server-owned saved lease remains redeemable even after its cache token ages out. */
export function activeTrainingBlocksStart(raw: unknown): boolean {
    return normalizeActiveTrainingSession(raw) !== null;
}

export function activeTrainingMatches(raw: unknown, token: string): boolean {
    return normalizeActiveTrainingSession(raw)?.token === token;
}

/**
 * Recover the sealed reward from the server-owned save lease when the short-lived
 * KV acceleration token has expired. Generic saves cannot replace activeTraining,
 * so this is the same authority boundary as the original token record.
 */
export function storedTrainingGrant(raw: unknown, token: string): StoredTrainingGrant | null {
    const active = normalizeActiveTrainingSession(raw);
    if (!active || active.token !== token || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const stat = typeof record.stat === 'string' ? record.stat : '';
    const sealedGain = Math.floor(Number(record.statGain));
    const sealedXp = Math.floor(Number(record.xp));
    if (!TRAINING_STATS.has(stat)) return null;
    // Hard upper bound on anything trustedTrainingRewards can seal: 8h tier base
    // 160 × the aggregate boost ceiling (2.5) × the rookie peak (5) = 2,000.
    // MAX_SEALED_STAT_GAIN carries a little headroom above that so a tier or
    // dial nudge does not silently start rejecting valid leases — it is a
    // sanity bound, not a balance lever. Old leases (sealed before the rookie
    // curve, ≤1000) still validate unchanged. sealedXp is a retired legacy field
    // (character XP is gone) — still parsed off old leases, never paid.
    if (!Number.isFinite(sealedGain) || sealedGain < 0 || sealedGain > MAX_SEALED_STAT_GAIN) return null;
    if (!Number.isFinite(sealedXp) || sealedXp < 0 || sealedXp > 750) return null;
    return { stat, startedAt: active.startedAt, endsAt: active.endsAt, sealedGain, sealedXp };
}

// ── Training growth bonus (docs/leveling-without-xp-map.md §4.1) ────────────
// Server mirror of the client's getTrainingXpBonus (lib/village-upgrades.ts:101),
// now a STAT-rate bonus: village Training Grounds (0.25%/level, max level 50) +
// Elder 'training' focus (+10%) + clan Training Grounds (0.2%/level, max 10%) +
// Scholars doctrine (+5%). Every term is read off the character SAVE (village
// upgrades, elderFocus, clan snapshot fields), so the seal is fully
// server-derived — this also FIXES the old display/grant mismatch where the
// client showed a boosted figure but the seal hard-coded bonus 0.
export function trainingBonusPct(character: Record<string, unknown> | undefined): number {
    if (!character) return 0;
    const upgrades = (character.villageUpgrades as Record<string, unknown> | undefined) ?? {};
    const trainingLevel = Math.min(50, Math.max(0, Math.floor(Number(upgrades.training) || 0)));
    const village = trainingLevel * 0.25;
    const elder = character.elderFocus === 'training' ? 10 : 0;
    const inClan = typeof character.clan === 'string' && character.clan.trim() !== '';
    const clanLevels = (character.clanUpgradeLevels as Record<string, unknown> | undefined) ?? {};
    const clanTraining = inClan
        ? Math.min(10, Math.max(0, Math.floor(Number(clanLevels.trainingGrounds) || 0)) * 0.2)
        : 0;
    const doctrine = inClan && character.clanDoctrine === 'scholars' ? 5 : 0;
    return village + elder + clanTraining + doctrine;
}

/**
 * Seal the authoritative training reward. The stat gain is the tier's base rate
 * boosted by the SERVER-DERIVED training bonus and the era dial (aggregate-
 * capped in combinedStatBoost) — never by anything client-supplied. Character
 * XP is retired: sealedXp stays in the token shape for old-lease compatibility
 * but is always 0 and never paid.
 *
 * The rookie multiplier is a DELIBERATELY SEPARATE factor, applied outside
 * combinedStatBoost's aggregate cap — the same reasoning as `moraleTimeMult` in
 * _jutsu-ryo.ts. Folded into `bonusPct` it would be swallowed by the 2.5x
 * ceiling for anyone who already has a village training bonus, so the early-game
 * curve would bite hardest for the players least likely to have one and not at
 * all for the rest.
 *
 * ⛔ It is fed the LEDGER-DERIVED level — levelForEarned(earnedStatPoints) —
 * and NOT `character.level`. The two differ whenever an exam hold is active:
 * examLevelCap freezes the stored level at 20 (Genin) or 39 (Chunin) until the
 * exam is passed, so reading `character.level` would let a player refuse the
 * Genin exam and farm the level-20 multiplier (2.76x) forever. Measured over
 * 600 simulated days that was +146% total stat points versus playing normally —
 * the exam becomes something you are punished for taking. The earned-points
 * ledger cannot be frozen (it is exactly what training grants), so deriving the
 * level from it keeps the curve monotone in real progress and removes the
 * incentive entirely, while leaving the tuned shape identical for anyone who is
 * not exam-blocked.
 */
export function trustedTrainingRewards(
    tier: TrainingTier,
    character?: Record<string, unknown>,
): { sealedGain: number; sealedXp: number; bonusPct: number; rookieMult: number } {
    const bonusPct = trainingBonusPct(character);
    const ledgerLevel = character ? levelForEarned(earnedStatPoints(character)) : 1;
    const rookieMult = rookieStatMultiplier(ledgerLevel);
    const base = Math.max(0, trainingStatGain(tier, tier.ms, 0));
    return {
        sealedGain: Math.max(0, Math.round(base * combinedStatBoost(bonusPct) * rookieMult)),
        sealedXp: 0,
        bonusPct,
        rookieMult,
    };
}
