/*
 * Legacy activity tracker — the server-owned counter store behind the Legacy
 * system (see docs/legacy-system-plan.md §4).
 *
 * Player saves are client-writable via autosave, so save-embedded counters can
 * be tampered with. Legacy eligibility gates prestige, titles, and server
 * announcements, so its inputs live in a SIDE-CAR key `legacy:stats:<player>`
 * that only server settle endpoints ever write. Hooks call bumpLegacyStats()
 * AFTER their existing save write, best-effort: a lost increment is a shrug, a
 * blocked payout would be a bug, so tracking must never throw into the caller.
 *
 * The whole subsystem is gated on ENABLE_LEGACY=1 — flag off means every
 * exported hook is a no-op and live behavior is byte-identical.
 */
import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import type { LegacyStatKey } from './_legacy-defs.js';

export function legacyEnabled(): boolean {
    return process.env.ENABLE_LEGACY === '1';
}

export const legacyStatsKey = (player: string) => `legacy:stats:${player}`;
export const legacyEventsKey = (player: string) => `legacy:events:${player}`;

export type LegacyStats = Partial<Record<LegacyStatKey, number>> & {
    updatedAt?: number;
    /** Set once, when the store was seeded from pre-Legacy save counters. */
    bootstrappedAt?: number;
    /** Farming/abuse signals; gates legendary+ offers (see _legacy-score.ts). */
    suspicionFlags?: number;
    /** Raw kill counts per PvP target, for repeat-kill decay. Capped size. */
    repeatKills?: Record<string, number>;
    /** Rolling PvP win streak; bestKillStreak records its high-water mark. */
    winStreak?: number;
};

export type LegacyEvent = {
    ts: number;
    type: string;          // 'first-clear' | 'offer-declined' | 'offer-accepted' | 'trial-complete' | ...
    key?: string;
    meta?: Record<string, unknown>;
};

const EVENTS_CAP = 200;
const REPEAT_KILLS_CAP = 30;

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Stats that record a best-ever value; bumping takes max() instead of sum. */
const MAX_STATS: ReadonlySet<LegacyStatKey> = new Set<LegacyStatKey>([
    'bestKillStreak', 'endlessTowerBest', 'biomesVisited',
]);

/**
 * Weight of the Nth kill against the same PvP target (anti-farm decay):
 * 1st and 2nd full, 3rd half, 4th quarter, then nothing.
 */
export function repeatKillWeight(priorKillsOnTarget: number): number {
    if (priorKillsOnTarget <= 1) return 1;
    if (priorKillsOnTarget === 2) return 0.5;
    if (priorKillsOnTarget === 3) return 0.25;
    return 0;
}

/** Kills >=15 levels down contribute nothing to Legacy PvP credit. */
export const LEVEL_GAP_ZERO = 15;

/**
 * Plausibility ceilings applied when seeding from pre-Legacy save counters
 * (which were client-writable). Bootstrapped history can qualify a veteran for
 * the lower tiers; mythic-scale numbers must be earned under server tracking.
 */
const BOOTSTRAP_CAPS: Partial<Record<LegacyStatKey, number>> = {
    missionCompletions: 1500, pveKills: 6000, pvpWins: 800, pvpKills: 800,
    rankedWins: 400, raidsCompleted: 400, tilesExplored: 8640,
    arenaTournaments: 150, endlessTowerBest: 100, petDuelWins: 600,
    cardClashWins: 500, warsWon: 40, warMvps: 20, warContribution: 500_000,
    hollowGateClears: 150, huntCompletions: 800,
};

/** Seed a fresh stats record from the save's existing lifetime counters. */
export function seedLegacyStatsFromSave(character: Record<string, unknown> | null | undefined, now: number): LegacyStats {
    const c = character ?? {};
    const seed: LegacyStats = { updatedAt: now, bootstrappedAt: now };
    const put = (stat: LegacyStatKey, raw: unknown) => {
        const cap = BOOTSTRAP_CAPS[stat] ?? Number.MAX_SAFE_INTEGER;
        const v = Math.min(Math.max(0, Math.floor(num(raw))), cap);
        if (v > 0) seed[stat] = v;
    };
    put('missionCompletions', c['totalMissionsCompleted']);
    put('pveKills', c['totalAiKills']);
    put('pvpWins', c['totalPvpKills']);
    put('pvpKills', c['totalPvpKills']);
    put('rankedWins', c['rankedWins']);
    put('raidsCompleted', c['totalVillageRaids']);
    put('tilesExplored', c['totalTilesExplored']);
    put('arenaTournaments', c['totalTournamentsCompleted']);
    put('endlessTowerBest', c['endlessTowerBestWave'] ?? c['totalEndlessTowerWins']);
    put('petDuelWins', c['totalPetWins']);
    put('cardClashWins', c['cardClashWins']);
    put('warsWon', c['warsWon']);
    put('warMvps', c['warMvpCount']);
    put('warContribution', c['lifetimeWarDamage']);
    put('hollowGateClears', c['hollowGateWardenKills']);
    // Village tenure was never tracked; grant established characters a modest
    // floor so long-time villagers can reach the basic village identities.
    if (num(c['level']) >= 50 && typeof c['village'] === 'string' && c['village']) {
        seed.villageTenureDays = 10;
    }
    return seed;
}

/** Read the stats record, lazily bootstrapping it from the save on first touch. */
export async function getLegacyStats(
    playerName: string,
    characterForBootstrap?: Record<string, unknown> | null,
): Promise<LegacyStats> {
    const key = legacyStatsKey(playerName);
    const existing = await kv.get<LegacyStats>(key);
    if (existing && typeof existing === 'object') return existing;
    const seeded = seedLegacyStatsFromSave(characterForBootstrap, Date.now());
    // NX so two concurrent first-touches can't double-seed.
    const claimed = await kv.set(key, seeded, { nx: true });
    if (claimed !== 'OK') {
        const raced = await kv.get<LegacyStats>(key);
        if (raced && typeof raced === 'object') return raced;
    }
    return seeded;
}

export type LegacyStatDeltas = Partial<Record<LegacyStatKey, number>>;

/**
 * Apply counter deltas (sum for totals, max for best-ever stats). Best-effort:
 * catches everything and never throws into the settle endpoint that called it.
 * The light lock (fail-open) only narrows the read-modify-write race window —
 * a rarely-lost increment is acceptable for progression counters.
 */
export async function bumpLegacyStats(
    playerName: string,
    deltas: LegacyStatDeltas,
    opts?: {
        characterForBootstrap?: Record<string, unknown> | null;
        /** PvP target name — applies repeat-kill decay to pvpKills/pvpWins. */
        pvpTarget?: string;
        /** Winner-minus-loser level; >=LEVEL_GAP_ZERO zeroes PvP credit. */
        pvpLevelGap?: number;
        suspicion?: boolean;
        /** 'win' extends the rolling streak (and bestKillStreak); 'reset' zeroes it. */
        streak?: 'win' | 'reset';
    },
): Promise<void> {
    if (!legacyEnabled()) return;
    if (!playerName) return;
    try {
        await withKvLock(legacyStatsKey(playerName), async () => {
            const stats = await getLegacyStats(playerName, opts?.characterForBootstrap ?? null);
            const next: LegacyStats = { ...stats, updatedAt: Date.now() };
            let pvpWeight = 1;
            if (opts?.pvpLevelGap !== undefined && opts.pvpLevelGap >= LEVEL_GAP_ZERO) pvpWeight = 0;
            if (opts?.pvpTarget) {
                const map = { ...(stats.repeatKills ?? {}) };
                const prior = num(map[opts.pvpTarget]) + 1;
                map[opts.pvpTarget] = prior;
                // Bound the map: keep the highest counts (they carry the decay info).
                const entries = Object.entries(map);
                if (entries.length > REPEAT_KILLS_CAP) {
                    entries.sort((a, b) => num(b[1]) - num(a[1]));
                    next.repeatKills = Object.fromEntries(entries.slice(0, REPEAT_KILLS_CAP));
                } else {
                    next.repeatKills = map;
                }
                pvpWeight = Math.min(pvpWeight, repeatKillWeight(prior));
            }
            for (const [rawStat, rawDelta] of Object.entries(deltas)) {
                const stat = rawStat as LegacyStatKey;
                let delta = num(rawDelta);
                if (delta <= 0) continue;
                if ((stat === 'pvpKills' || stat === 'pvpWins') && (opts?.pvpTarget || opts?.pvpLevelGap !== undefined)) {
                    delta *= pvpWeight;
                }
                if (delta <= 0) continue;
                const prev = num(next[stat]);
                next[stat] = MAX_STATS.has(stat) ? Math.max(prev, delta) : prev + delta;
            }
            if (opts?.suspicion) next.suspicionFlags = num(next.suspicionFlags) + 1;
            if (opts?.streak === 'win') {
                next.winStreak = num(stats.winStreak) + 1;
                next.bestKillStreak = Math.max(num(next.bestKillStreak), next.winStreak);
            } else if (opts?.streak === 'reset') {
                next.winStreak = 0;
            }
            await kv.set(legacyStatsKey(playerName), next);
        }, { ttlSec: 5 });
    } catch (err) {
        console.error(`[legacy-track] bump failed for ${playerName}:`, err instanceof Error ? err.message : err);
    }
}

/** Append an important-moment event (capped ring, newest first). Best-effort. */
export async function appendLegacyEvent(
    playerName: string,
    ev: Omit<LegacyEvent, 'ts'>,
): Promise<void> {
    if (!legacyEnabled()) return;
    try {
        const key = legacyEventsKey(playerName);
        const list = (await kv.get<LegacyEvent[]>(key)) ?? [];
        const next = [{ ts: Date.now(), ...ev }, ...(Array.isArray(list) ? list : [])].slice(0, EVENTS_CAP);
        await kv.set(key, next);
    } catch (err) {
        console.error(`[legacy-track] event append failed for ${playerName}:`, err instanceof Error ? err.message : err);
    }
}
