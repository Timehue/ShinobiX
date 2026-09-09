import { kv, type KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';
import { readPublicPlayerIndex } from '../player/_public-index-store.js';
import { earnedAnbuCandidates, normalizeAnbuSeats, leadershipVillageKey, type AnbuCandidate } from '../../shared/village-anbu.js';
import { elderVillageKey } from './_elders.js';

type Store = Pick<KvLike, 'get'>;
export async function readVillageAnbu(village: string, snapshot?: Record<string, unknown>, store: Store = kv, indexedCandidates?: AnbuCandidate[]): Promise<{ appointed: [string, string, string]; earned: string[]; members: string[] }> {
    const state = snapshot ?? await store.get<Record<string, unknown>>(elderVillageKey(village));
    const validMember = async (name: string) => {
        if (!name) return '';
        const save = await store.get<{ character?: { village?: string } }>(`save:${safeName(name)}`);
        return save?.character && leadershipVillageKey(save.character.village) === leadershipVillageKey(village) ? name : '';
    };
    const appointed = await Promise.all(normalizeAnbuSeats(state?.anbuAppointees).map(validMember)) as [string, string, string];
    // The public index is server-written and cheaply read as a hash. Old index
    // entries get a one-time backfill from saves for the new monthly fields.
    const candidates = indexedCandidates ?? (store === kv ? [...(await readPublicPlayerIndex({ backfill: true, logContext: 'anbu-roster' })).entries.values()] : []);
    const eligible = earnedAnbuCandidates(candidates, village, appointed, new Date(Date.now()).toISOString().slice(0, 7), candidates.length);
    const earned: string[] = [];
    // A moved/deleted player must not occupy a seat or block the next eligible member.
    for (let offset = 0; offset < eligible.length && earned.length < 7; offset += 7) {
        earned.push(...(await Promise.all(eligible.slice(offset, offset + 7).map(player => validMember(player.name)))).filter(Boolean).slice(0, 7 - earned.length));
    }
    return { appointed, earned, members: [...appointed.filter(Boolean), ...earned] };
}
