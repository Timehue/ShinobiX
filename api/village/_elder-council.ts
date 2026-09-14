import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import { invalidateProcCache } from '../_proc-cache.js';
import { REGISTRY_KEY, isPublicPlayerIndexKey } from '../player/_public-index.js';
import { WAR_VILLAGES } from '../_war-map-sectors.js';
import { leadershipVillageKey } from '../../shared/village-anbu.js';
import { normalizeElderAppointees } from '../../shared/village-elders.js';
import { ELDER_TERM_MS, elderTermScore, selectEarnedElders, type ElderCouncil } from '../../shared/elder-elections.js';

export const elderCouncilKey = (village: unknown) => `village:elder-council:${leadershipVillageKey(village)}`;
export async function validElderSeats(village: unknown, value: unknown): Promise<[string, string, string]> {
    return await Promise.all(normalizeElderAppointees(value).map(async name => {
        if (!name) return '';
        const save = await kv.get<{ character?: { village?: string } }>(`save:${safeName(name)}`);
        return leadershipVillageKey(save?.character?.village) === leadershipVillageKey(village) ? name : '';
    })) as [string, string, string];
}

/** Runs while the separate council lock is held; never takes save/village/Kage locks. */
export async function resolveElderCouncil(village: string, now = Date.now(), legacy?: Record<string, unknown>): Promise<ElderCouncil> {
    const key = elderCouncilKey(village);
    const stored = await kv.get<ElderCouncil>(key);
    if (stored?.version === 1 && stored.nextSelectionAt > now) return stored;
    let next: ElderCouncil;
    if (!stored || stored.version !== 1) {
        const startedAt = Math.floor(now / 86400000) * 86400000;
        const old = legacy ?? await kv.get<Record<string, unknown>>(`game:village-state:${leadershipVillageKey(village)}`);
        const first = (await validElderSeats(village, old?.elderAppointees))[0];
        // Historical counters do not prove wins during a 30-day term. Start a
        // fresh competition and preserve only the existing Kage-selected seat.
        next = { version: 1, startedAt, nextSelectionAt: startedAt + ELDER_TERM_MS, seats: [first, '', ''], winningScores: [0, 0] };
    } else {
        const elapsedTerms = Math.max(1, Math.floor((now - stored.startedAt) / ELDER_TERM_MS));
        const startedAt = stored.startedAt + elapsedTerms * ELDER_TERM_MS;
        const registry = await kv.hgetall<Record<string, unknown>>(REGISTRY_KEY) ?? {};
        const keys = Object.keys(registry).filter(isPublicPlayerIndexKey);
        // Once per election, read saves rather than trusting a lagging ranking index.
        const saves = keys.length ? await kv.mget<Array<{ character?: Record<string, unknown> }>>(...keys.map(name => `save:${name}`)) : [];
        const candidates = saves.flatMap((save, index) => {
            const character = save?.character;
            if (!character || leadershipVillageKey(character.village) !== leadershipVillageKey(village)) return [];
            return [{ name: String(character.name ?? keys[index]), ...elderTermScore(character.elderWinDays, village, startedAt - ELDER_TERM_MS, startedAt) }];
        });
        const earned = selectEarnedElders(candidates);
        next = { version: 1, startedAt, nextSelectionAt: startedAt + ELDER_TERM_MS, seats: ['', ...earned.seats], winningScores: earned.scores };
    }
    if (!await kv.compareSet(key, stored, next)) throw new Error('elder-council-election-conflict');
    invalidateProcCache('game-state:frame');
    return next;
}

export async function readElderCouncil(village: string, legacy?: Record<string, unknown>, now = Date.now()): Promise<ElderCouncil> {
    const stored = await kv.get<ElderCouncil>(elderCouncilKey(village));
    const council = stored?.version === 1 && stored.nextSelectionAt > now ? stored
        : await withKvLock(elderCouncilKey(village), () => resolveElderCouncil(village, now, legacy), { failClosed: true, ttlSec: 30 });
    return { ...council, seats: await validElderSeats(village, council.seats) };
}

export async function runElderElections(now = Date.now()): Promise<void> {
    for (const village of WAR_VILLAGES) await readElderCouncil(village, undefined, now);
}
