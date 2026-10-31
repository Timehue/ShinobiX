import { onlineStore } from '../_realtime/online-store.js';
import { sessionOpponentBlock, worldInteractionBlock } from '../_realtime/presence-gating.js';
import { safeName } from '../_utils.js';

/*
 * A `guard:<name>` row says a player is on the village's roster, for up to five
 * minutes after their last refresh. It does not say they can fight: a raid duel
 * is a world attack, so /api/pvp/session requires both fighters online and in
 * the same wild sector. Guards are usually at home or offline, which left the
 * raid with a duel that was refused every time and, because the garrison
 * fallback also stood down for any rostered guard, no fight at all.
 *
 * Both halves of a raid now ask this one question. It mirrors the session
 * gate, so a guard reported reachable is one the duel will actually admit.
 */
export function guardReachableFrom(attacker: string, guardName: string, now: number = Date.now()): boolean {
    const target = onlineStore.get(guardName, now);
    return !worldInteractionBlock(onlineStore.get(attacker, now), target, now)
        && !sessionOpponentBlock(target, safeName(attacker), now);
}
