import { onlineStore } from '../_realtime/online-store.js';
import { isBelowAttackableFloor, sessionOpponentBlock, worldInteractionBlock } from '../_realtime/presence-gating.js';
import { safeName } from '../_utils.js';
import { kv } from '../_storage.js';
import { battleLockFlagsForPlayers, settleSaveRecord } from '../_elapsed-state.js';
import { worldBossPvpProtectionBlock } from '../world-boss-event/_pvp-protection.js';

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
export async function guardReachableFrom(attacker: string, guardName: string, now: number = Date.now()): Promise<boolean> {
    const target = onlineStore.get(guardName, now);
    if (worldInteractionBlock(onlineStore.get(attacker, now), target, now)
        || sessionOpponentBlock(target, safeName(attacker), now)) return false;
    const slug = safeName(guardName);
    const [save, locks, worldBossBlock] = await Promise.all([
        kv.get<Record<string, unknown>>(`save:${slug}`),
        battleLockFlagsForPlayers([slug]),
        worldBossPvpProtectionBlock(slug, now),
    ]);
    if (!save?.character || locks.get(slug) === true || worldBossBlock) return false;
    // Match session admission's elapsed-state projection without writing the
    // save. A recovered guard may now be alive, while Field Recovery can still
    // protect them. Presence alone cannot answer either question.
    const character = settleSaveRecord(save, { now, battleLocked: false }).record.character as Record<string, unknown>;
    return Number(character.hp ?? 0) > 0
        && !isBelowAttackableFloor(Number(character.level ?? 0))
        && !(Number(character.pvpShieldUntil ?? 0) > now);
}
