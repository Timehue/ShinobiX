/**
 * Whether Cinderhold's shinobi can act on this server right now (2026-11-11).
 *
 * Two things stop them: the kill switch (DISABLE_NPC_VILLAGE=1) and player
 * sessions being off (SESSION_SECRET unset). Every NPC action is a request made
 * in-process with a server-minted session token, so without session tokens no
 * NPC can join a duel, answer a queue or hold a shrine: the village is as
 * absent as with the switch off. Wars with Cinderhold therefore FREEZE in both
 * cases (api/_npc-war-roster.ts npcVillageWarFrozen), and no new war may be
 * declared on it or by it.
 */
import { playerSessionsEnabled } from './_auth.js';

export function npcVillageClosed(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_NPC_VILLAGE === '1' || !playerSessionsEnabled(env);
}
