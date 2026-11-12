/**
 * Wounded Cinderhold guards (owner ruling 2026-11-10).
 *
 * A player who loses a world duel carries the cost: the hospital, the damage,
 * time out of the fight. An NPC used to walk straight back to its post at full
 * HP, so one strong player could farm the same four guards for a whole war. Now
 * a Cinderhold shinobi beaten in a WAR fight (a duel at a war front, or its war
 * party's strike) is wounded: it leaves the world for NPC_WAR_WOUND_MS to
 * recover, and a reserve takes its place at the front if one is free. Beat all
 * fifteen and the front stands empty until they heal. No cap a player village
 * would not have; just the toll a real defeat takes.
 *
 * Outside a war a beaten NPC is treated as a beaten player (2026-11-10): it
 * leaves for the hospital stay, then stands back at its post under the same
 * Field Recovery shield, instead of waiting at full HP for an instant rematch.
 *
 * Its own tiny module (kv only) so the duel seal, the presence tick and the
 * war party can all read it without loading the war code.
 */
import { kv } from './_storage.js';
import { NPC_VILLAGE_ROSTER } from '../shared/npc-village-roster.js';

export const NPC_WAR_WOUND_MS = 3 * 60 * 60 * 1000;
export const npcWoundKey = (npc: string) => `npc-village:wounded:${npc}`;
/** `until`: off the map (hospital); `shieldUntil`: back, but not attackable yet (Field Recovery). */
export type NpcWound = { until: number; at: number; by?: string; shieldUntil?: number };

/**
 * Marks a beaten NPC wounded (idempotent: never shortens an existing wound or
 * shield). A war loss keeps it out for NPC_WAR_WOUND_MS; an ordinary world duel
 * loss is a player's loss: the hospital stay (PVP_HOSPITAL_DURATION_MS), then
 * the Field Recovery shield (PVP_RAID_SHIELD_MS from the loss) before it can be
 * attacked again.
 */
export async function woundNpc(npc: string, now = Date.now(), by?: string, opts: { ms?: number; shieldMs?: number } = {}): Promise<void> {
    const prior = await kv.get<NpcWound>(npcWoundKey(npc));
    const until = Math.max(Number(prior?.until) || 0, now + (opts.ms ?? NPC_WAR_WOUND_MS));
    const shieldUntil = Math.max(Number(prior?.shieldUntil) || 0, opts.shieldMs ? now + opts.shieldMs : 0, until);
    await kv.set(npcWoundKey(npc), { until, at: now, ...(by ? { by } : {}), ...(shieldUntil > until ? { shieldUntil } : {}) },
        { ex: Math.ceil((shieldUntil - now) / 1000) + 60 });
}

export function woundActive(row: unknown, now: number): boolean {
    return Number((row as NpcWound | null)?.until) > now;
}

/** When the NPC can next be attacked (0 = now): its wound, then its Field Recovery shield. */
export function woundShieldUntil(row: unknown, now: number): number {
    const r = row as NpcWound | null;
    const end = Math.max(Number(r?.until) || 0, Number(r?.shieldUntil) || 0);
    return end > now ? end : 0;
}

export async function isNpcWounded(npc: string, now = Date.now()): Promise<boolean> {
    return woundActive(await kv.get<NpcWound>(npcWoundKey(npc)), now);
}

export async function readNpcWound(npc: string): Promise<NpcWound | null> {
    return (await kv.get<NpcWound>(npcWoundKey(npc))) ?? null;
}

/** Every NPC recovering right now, in one read. */
export async function woundedNpcIds(now = Date.now()): Promise<Set<string>> {
    const rows = await kv.mget<Array<NpcWound | null>>(...NPC_VILLAGE_ROSTER.map((npc) => npcWoundKey(npc.id)));
    return new Set(NPC_VILLAGE_ROSTER.filter((_, i) => woundActive(rows[i], now)).map((npc) => npc.id));
}
