import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import { mutatePlayerSaveLocked, type PlayerSaveRecord } from '../save/_mutate-player-save.js';
import { kv } from '../_storage.js';
import { battleAuthorityKeys, battleEvidenceFrom, resolveBattleAuthority } from '../_realtime/battle-authority.js';

export class CombatAdmissionConflictError extends Error {
    constructor() { super('Another fight started while this encounter was being prepared. Resume that fight first.'); }
}

/** New fights only: settle earned recovery before sealing the loadout, then
 * publish it while still holding the save lock. Resumes keep their combat row.
 * Commit the settled recovery cursor even at full vitals. */
export async function withCombatAdmissionSave<T>(
    playerName: string,
    admit: (save: PlayerSaveRecord) => Promise<T>,
): Promise<T> {
    const slug = safeName(playerName);
    if (!slug) throw new Error('Invalid combat owner.');
    const key = `save:${slug}`;
    return withKvLock(key, async () => {
        // Different mission/AI/stronghold start leases can all observe an empty
        // held-fight index. Recheck after acquiring their common save lock;
        // the first admitted fight publishes its projection before releasing it.
        const authority = await resolveBattleAuthority(slug, battleEvidenceFrom(await kv.mget(...battleAuthorityKeys(slug))));
        if (authority.inBattle) throw new CombatAdmissionConflictError();
        const committed = await mutatePlayerSaveLocked(slug, ({ character }) => ({
            ok: true as const, character, value: null,
        }));
        if (!committed.ok) throw new Error(committed.error);
        return admit(committed.record);
    }, { failClosed: true, ttlSec: 30 });
}
