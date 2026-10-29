import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import { settleIdleRecovery, writeVersionedPlayerSave, type PlayerSaveRecord } from '../save/_mutate-player-save.js';

/** New fights only: settle earned recovery before sealing the loadout, then
 * publish it while still holding the save lock. Resumes keep their combat row.
 * The write fences the recovery cursor at admission, even at full vitals. */
export async function withCombatAdmissionSave<T>(
    playerName: string,
    admit: (save: PlayerSaveRecord) => Promise<T>,
): Promise<T> {
    const slug = safeName(playerName);
    if (!slug) throw new Error('Invalid combat owner.');
    const key = `save:${slug}`;
    return withKvLock(key, async () => {
        const record = await kv.get<PlayerSaveRecord>(key);
        if (!record?.character) throw new Error('Player save not found at combat admission.');
        const settled = await settleIdleRecovery(kv, slug, record);
        const committed = await writeVersionedPlayerSave(key, record, settled.character);
        return admit(committed.record);
    }, { failClosed: true, ttlSec: 30 });
}
