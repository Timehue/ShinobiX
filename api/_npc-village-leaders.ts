/**
 * Cinderhold's Kage and elder seats (owner ruling, 2026-11-08).
 *
 * The seats start EMPTY. The first time any player defeats their village's
 * story Kage (the four authored finales in shared/story-kage.ts), that defeated
 * Kage abandons their village and comes to Cinderhold. The first to arrive takes
 * the Kage seat; the next three become its elders. Four villages, four seats.
 *
 * Lock-free on purpose: this runs from story settlement while the player's save
 * lock is held, and taking a shared lock inside a save lock is the forbidden
 * reverse order. Each village's arrival is one set-if-absent row, claimed in the
 * same compare-and-set batch as the Kage seat while that seat is empty, so
 * concurrent finales resolve to exactly one Kage and a retried settlement can
 * never move anyone.
 */
import { kv } from './_storage.js';
import { STORY_KAGE_ENCOUNTERS, type StoryKageVillage } from '../shared/story-kage.js';
import { PLAYER_VILLAGES } from '../shared/npc-village.js';

export const NPC_KAGE_SEAT_KEY = 'npc-village:kage';
export const npcLeaderKey = (village: string) => `npc-village:leader:${village.toLowerCase().replace(/[^a-z]+/g, '-')}`;

export type NpcLeaderArrival = { village: StoryKageVillage; name: string; defeatedBy: string; joinedAt: number };
export type NpcLeaderSeat = NpcLeaderArrival & { seat: 'kage' | 'elder' };

const isStoryKageVillage = (village: string): village is StoryKageVillage => Object.hasOwn(STORY_KAGE_ENCOUNTERS, village);

/**
 * Records a defeated story Kage's arrival. Returns the seat taken, or null if it
 * was already seated. The arrival row and (while it is empty) the Kage seat are
 * written in ONE atomic batch, so a failure can never leave an arrival with the
 * Kage seat unclaimed for a later village to take.
 */
export async function recordStoryKageDefection(village: string, defeatedBy: string, now = Date.now()): Promise<NpcLeaderSeat | null> {
    if (!isStoryKageVillage(village)) return null;
    const arrival: NpcLeaderArrival = { village, name: STORY_KAGE_ENCOUNTERS[village].name, defeatedBy, joinedAt: now };
    if (!kv.compareSetMany) throw new Error('Cinderhold leader seats require atomic storage.');
    // A lost race against another village's arrival retries; four villages bound it.
    for (let attempt = 0; attempt < 5; attempt++) {
        const kage = await kv.get<string>(NPC_KAGE_SEAT_KEY);
        const ok = await kv.compareSetMany([
            { op: 'cas', key: npcLeaderKey(village), expected: null, value: arrival },
            kage ? { op: 'assert', key: NPC_KAGE_SEAT_KEY, expected: kage } : { op: 'cas', key: NPC_KAGE_SEAT_KEY, expected: null, value: village },
        ]);
        if (ok) return { ...arrival, seat: kage ? 'elder' : 'kage' };
        if (await kv.get(npcLeaderKey(village))) return null; // already seated: a later finale moves nobody
    }
    return null;
}

/** The seats as they stand: the Kage first, then elders in arrival order. Empty until a finale is won. */
export async function readNpcLeaders(): Promise<NpcLeaderSeat[]> {
    const [kage, ...rows] = await Promise.all([
        kv.get<string>(NPC_KAGE_SEAT_KEY),
        ...PLAYER_VILLAGES.map((village) => kv.get<NpcLeaderArrival>(npcLeaderKey(village))),
    ]);
    return rows.filter((row): row is NpcLeaderArrival => Boolean(row?.village))
        .map((row) => ({ ...row, seat: row.village === kage ? 'kage' as const : 'elder' as const }))
        .sort((a, b) => (a.seat === 'kage' ? -1 : b.seat === 'kage' ? 1 : a.joinedAt - b.joinedAt));
}
