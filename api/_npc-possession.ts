/** The admin-control lease on a Cinderhold NPC (see api/admin/npc-possess.ts). */
import { kv } from './_storage.js';
import { safeName } from './_utils.js';

export const NPC_POSSESS_TTL_MS = 2 * 60 * 60 * 1000;
export const npcPossessKey = (slug: string) => `npc-village:possessed:${safeName(slug)}`;
export type NpcPossession = { by: string; at: number; expiresAt: number };

export async function readNpcPossession(slug: string, now = Date.now()): Promise<NpcPossession | null> {
    const row = await kv.get<NpcPossession>(npcPossessKey(slug));
    return row && row.expiresAt > now ? row : null;
}

export async function isNpcPossessed(slug: string, now = Date.now()): Promise<boolean> {
    return (await readNpcPossession(slug, now)) !== null;
}
