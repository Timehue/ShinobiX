/**
 * Who fights Cinderhold's sector wars (Push 4, owner ruling 2026-11-10).
 *
 * Cinderhold has no players, so nobody is ever appointed to its ANBU through
 * the player systems. Its war roles come from the roster instead: its
 * Commanders, Elites and Jonin are its ANBU. They hold its garrisons and fight
 * its war party (api/_npc-war-party.ts), and its Commanders fight at Elder
 * weight. The roster has no Kage: Cinderhold's Kage seat is held only by a
 * defected story Kage (api/_npc-village-leaders.ts), who has no save to seal,
 * so the garrison never falls back to a Kage. With fifteen ANBU it never needs
 * to.
 *
 * Its Genin and Chunin fight too (owner ruling 2026-11-11), as a player
 * village's villagers do: any of them whose LIVE level is NPC_WAR_MIN_LEVEL or
 * more takes the same war jobs (front posts and strikes, stronghold defense,
 * the shrine, strikes, raids, field orders) at villager weight. They are never
 * its ANBU: NPC_WAR_DEFENDERS stays the ANBU list (the AI-copy defender,
 * readVillageAnbu, garrisons, the Elder/ANBU role). npcWarParticipants() is
 * who takes war jobs right now.
 */
import { kv } from './_storage.js';
import { readKvProjection } from './_storage-projection.js';
import { NPC_VILLAGE_ROSTER, type NpcRank, type NpcShinobi } from '../shared/npc-village-roster.js';
import { isNpcVillage } from '../shared/npc-village.js';
import { npcVillageClosed } from './_npc-village-switch.js';
import { npcOwnedIds } from './_npc-ownership.js';

/**
 * A war with Cinderhold on either side while Cinderhold is closed: the kill
 * switch DISABLE_NPC_VILLAGE is on, or session tokens are off so no NPC can act
 * (api/_npc-village-switch.ts). Its shinobi are gone from the world and its war
 * party stands down, so the war FREEZES rather than running one-sided: no
 * garrison assault on it, and it is not settled (its tally stands) until
 * Cinderhold is back. Sector wars (`attackerVillage`/`defenderVillage`) and
 * five-day village wars (`villages`) alike.
 */
export function npcVillageWarFrozen(contest: { attackerVillage?: unknown; defenderVillage?: unknown; villages?: unknown }): boolean {
    if (!npcVillageClosed()) return false;
    const sides = Array.isArray(contest.villages) ? contest.villages : [contest.attackerVillage, contest.defenderVillage];
    return sides.some((village) => isNpcVillage(village));
}

export const NPC_WAR_DEFENDER_RANKS: readonly NpcRank[] = ['commander', 'elite', 'jonin'];

/** Commanders, then Elites, then Jonin, each in roster order. */
export const NPC_WAR_DEFENDERS: readonly NpcShinobi[] = NPC_WAR_DEFENDER_RANKS
    .flatMap((rank) => NPC_VILLAGE_ROSTER.filter((npc) => npc.rank === rank));

/** Whether this rank is one of Cinderhold's ANBU ranks (always war-eligible). */
export function isNpcWarDefenderRank(rank: NpcRank): boolean {
    return NPC_WAR_DEFENDER_RANKS.includes(rank);
}

/** The level a player needs for any village-war action; a Genin or Chunin takes war jobs from here. */
export const NPC_WAR_MIN_LEVEL = 15;

/** Cinderhold's other ranks, Chunin then Genin, each in roster order: war jobs only at NPC_WAR_MIN_LEVEL or more. */
export const NPC_WAR_RESERVE_RANKS: readonly NpcRank[] = ['chunin', 'genin'];
export const NPC_WAR_RESERVES: readonly NpcShinobi[] = NPC_WAR_RESERVE_RANKS
    .flatMap((rank) => NPC_VILLAGE_ROSTER.filter((npc) => npc.rank === rank));

export type NpcWarFacts = { level?: unknown; village?: unknown } | null | undefined;

/**
 * Pure: who takes war jobs, given each Genin's and Chunin's live save facts.
 * The ANBU always (in NPC_WAR_DEFENDERS order, so they come first wherever a
 * caller fills scarce slots in list order), then every Genin or Chunin still in
 * Cinderhold at NPC_WAR_MIN_LEVEL or more. A missing save keeps one out.
 */
export function npcWarParticipantsFrom(facts: (id: string) => NpcWarFacts): NpcShinobi[] {
    return [...NPC_WAR_DEFENDERS, ...NPC_WAR_RESERVES.filter((npc) => {
        const row = facts(npc.id);
        return !!row && isNpcVillage(String(row.village ?? '').trim()) && Number(row.level) >= NPC_WAR_MIN_LEVEL;
    })];
}

/** How long one read of the Genin and Chunin levels serves (the 1 s / 8 s / 20 s ticks never re-read saves). */
export const NPC_WAR_PARTICIPANTS_CACHE_MS = 60_000;
const WAR_FACTS = { level: ['character', 'level'], village: ['character', 'village'] } as const;
let participantsCache: { at: number; list: readonly NpcShinobi[] } | null = null;

/**
 * Cinderhold's war participants RIGHT NOW: its ANBU, then its Genin and Chunin
 * at level NPC_WAR_MIN_LEVEL or more. One projected read of those fifteen
 * saves (level and village only), cached NPC_WAR_PARTICIPANTS_CACHE_MS. A
 * failed read keeps the last answer, or the ANBU alone. Never throws.
 */
export async function npcWarParticipants(now = Date.now()): Promise<readonly NpcShinobi[]> {
    if (participantsCache && Math.abs(now - participantsCache.at) < NPC_WAR_PARTICIPANTS_CACHE_MS) return participantsCache.list;
    let list: readonly NpcShinobi[];
    try {
        const rows = await readKvProjection(kv, NPC_WAR_RESERVES.map((npc) => `save:${npc.id}`), WAR_FACTS);
        const byId = new Map(NPC_WAR_RESERVES.map((npc, i) => [npc.id, rows[i] ?? null]));
        list = npcWarParticipantsFrom((id) => byId.get(id));
    } catch {
        list = participantsCache?.list ?? NPC_WAR_DEFENDERS;
    }
    // Never a player who holds an NPC's account name (api/_npc-ownership.ts).
    const owned = await npcOwnedIds(now);
    list = list.filter((npc) => owned.has(npc.id));
    participantsCache = { at: now, list };
    return list;
}
export function resetNpcWarParticipantsCacheForTest(): void { participantsCache = null; }
/** Drops the cached answer (after a seed pass, so a newly owned NPC takes war jobs at once). */
export const forgetNpcWarParticipants = resetNpcWarParticipantsCacheForTest;

/** Cinderhold's ANBU as readVillageAnbu reports them: the first three "appointed", the rest "earned". */
export function npcVillageAnbu(): { appointed: [string, string, string]; earned: string[]; members: string[] } {
    const ids = NPC_WAR_DEFENDERS.map((npc) => npc.id);
    const appointed = [ids[0] ?? '', ids[1] ?? '', ids[2] ?? ''] as [string, string, string];
    const earned = ids.slice(3);
    return { appointed, earned, members: ids };
}
