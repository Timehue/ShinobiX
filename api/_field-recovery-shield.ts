import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { carriedRegenCursor, settleIdleRecovery, writeVersionedPlayerSave } from './save/_mutate-player-save.js';

/**
 * Field Recovery is a shield, not a licence. Starting a fight on another player
 * (a Combat raid in api/player/attack.ts, or an open-world Pet or Card battle in
 * api/_sector-contest-engage.ts) is the aggressive act that ends it: the
 * standard rule in every MMO that has a PvP protection flag. Without it a player
 * could lose on purpose and then spend up to 120 s attacking while
 * un-attackable themselves.
 *
 * Best-effort and non-blocking: the fight is already authorised, and failing to
 * clear a shield must never refuse a legitimate attack. Moved verbatim from
 * api/player/attack.ts.
 */
export function endOwnFieldRecoveryShield(name: string): void {
    void withKvLock(`save:${name}`, async () => {
        const rec = await kv.get<Record<string, unknown>>(`save:${name}`);
        const char = (rec?.character ?? null) as Record<string, unknown> | null;
        if (!rec || !char) return;
        if (Math.floor(Number(char.pvpShieldUntil ?? 0)) <= Date.now()) return;
        // The attacker keeps the idle recovery earned since their last
        // save: it settles into this write instead of being fenced away.
        const recovery = await settleIdleRecovery(kv, name, rec);
        const next = { ...recovery.character, pvpShieldUntil: 0 };
        await writeVersionedPlayerSave(`save:${name}`, rec, next, {}, {
            regenAt: carriedRegenCursor(recovery.character, next, recovery.regen),
        });
    }).catch(() => undefined);
}
