/**
 * Where Cinderhold's shinobi are sent during a village war (Push 4b).
 *
 * The campaign tick (api/_npc-village-campaign.ts) decides; the presence tick
 * (api/_npc-presence.ts) walks them there and keeps them still. One small row,
 * kv only, so both can read it without loading each other.
 *
 *   stronghold  queued to defend a Cinderhold campaign stronghold (posted there)
 *   shrine      holding the golden shrine during its window
 *   strike      sent to an enemy player's sector to attack on a later tick
 *   operation   carrying out a field order in its target sector
 *   raid        attacking an enemy player village's campaign stronghold: it
 *               walks there, enters the stronghold, then starts the assault
 *               on a later tick and stays posted until that battle is over
 */
import { kv } from './_storage.js';
import { nearestWalkableTile } from '../shared/sector-walk-mask.js';

/** The tile an NPC stands on for an order: fixed per order, so it never steps (a step ends a lease). */
export function npcOrderTile(npcId: string, sector: number, since: number): number {
    let h = 2166136261;
    for (const ch of `${npcId}:order:${since}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return nearestWalkableTile(sector, (h >>> 0) % 144);
}

export const NPC_CAMPAIGN_ASSIGNMENTS_KEY = 'npc-village:campaign-assignments';

export type NpcCampaignAssignment = {
    kind: 'stronghold' | 'shrine' | 'strike' | 'operation' | 'raid';
    warId: string;
    generation: number;
    sector: number;
    since: number;
    /** No longer binding after this (a stale row never pins an NPC). */
    until: number;
    objectiveId?: string;
    target?: string;
    missionId?: string;
    /** operation: when the order is done; strike: the earliest moment it may attack. */
    readyAt?: number;
    /** raid: when it entered the stronghold (it starts the assault on a later tick). */
    enteredAt?: number;
    /** raid: the campaign battle it started (village-campaign-run:<runId>), held until it is over. */
    runId?: string;
};
export type NpcCampaignState = {
    assignments: Record<string, NpcCampaignAssignment>;
    /** Per war: when its last strike and its last field order were planned, and the window of its last raid order. */
    wars: Record<string, { lastStrikeAt?: number; lastOperationAt?: number; strikeLookWindow?: number; raidWindow?: number }>;
};

export async function readNpcCampaignState(): Promise<NpcCampaignState> {
    const row = await kv.get<NpcCampaignState>(NPC_CAMPAIGN_ASSIGNMENTS_KEY);
    return {
        assignments: row?.assignments && typeof row.assignments === 'object' ? { ...row.assignments } : {},
        wars: row?.wars && typeof row.wars === 'object' ? { ...row.wars } : {},
    };
}

export async function writeNpcCampaignState(state: NpcCampaignState): Promise<void> {
    await kv.set(NPC_CAMPAIGN_ASSIGNMENTS_KEY, state, { ex: 6 * 24 * 60 * 60 });
}

/**
 * Each NPC's live assignment (expired rows dropped), for the presence tick: its
 * village-war order first, else its clan-war shrine post (a separate row the
 * clan-war tick owns, so neither tick ever drops the other's orders).
 */
export async function liveNpcCampaignPosts(now = Date.now()): Promise<Map<string, NpcCampaignAssignment>> {
    if (process.env.DISABLE_NPC_VILLAGE === '1') return new Map();
    const { assignments } = await readNpcCampaignState();
    const posts = new Map(Object.entries(assignments).filter(([, a]) => a && Number(a.until) > now && Number.isInteger(a.sector)));
    const clan = await readNpcClanWarState().catch(() => null);
    for (const [id, post] of Object.entries(clan?.posts ?? {})) {
        if (posts.has(id) || !post || !(Number(post.until) > now) || !Number.isInteger(post.sector)) continue;
        posts.set(id, { kind: 'shrine', warId: post.warId, generation: 0, sector: post.sector, since: post.since, until: post.until });
    }
    return posts;
}

/**
 * Cinderhold's CLAN wars (api/_npc-clan-war-campaign.ts): where its clans'
 * shinobi are posted (a golden-shrine window) and who is busy in a clan-war
 * queue or match, so the village-war tick leaves them be.
 */
export const NPC_CLAN_WAR_STATE_KEY = 'npc-village:clan-war-assignments';
export type NpcClanWarPost = { warId: string; windowIndex: number; sector: number; since: number; until: number };
export type NpcClanWarState = {
    posts: Record<string, NpcClanWarPost>;
    /** NPC id -> until: queued, in a ready check or in a clan-war match. */
    busy: Record<string, number>;
    /** Clan-war match id -> when its beaten NPC was wounded (once per match). */
    wounded: Record<string, number>;
};
export async function readNpcClanWarState(): Promise<NpcClanWarState> {
    const row = await kv.get<NpcClanWarState>(NPC_CLAN_WAR_STATE_KEY);
    const obj = (value: unknown) => (value && typeof value === 'object' ? { ...(value as Record<string, never>) } : {});
    return { posts: obj(row?.posts), busy: obj(row?.busy), wounded: obj(row?.wounded) };
}
export async function writeNpcClanWarState(state: NpcClanWarState): Promise<void> {
    await kv.set(NPC_CLAN_WAR_STATE_KEY, state, { ex: 6 * 24 * 60 * 60 });
}
/** The NPCs a clan war holds right now (posted or busy). */
export async function npcsHeldByClanWars(now = Date.now()): Promise<Set<string>> {
    const state = await readNpcClanWarState();
    const held = new Set<string>();
    for (const [id, post] of Object.entries(state.posts)) if (Number(post?.until) > now) held.add(id);
    for (const [id, until] of Object.entries(state.busy)) if (Number(until) > now) held.add(id);
    return held;
}
