import { randomUUID } from 'node:crypto';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { detachModelAccount } from './_delete-account.js';
import { modelResetKey, type ModelReset } from './_owner.js';
import { eraseProfileDetail } from './_profile-detail.js';

export async function withModelReset<T>(expected: ModelReset | null, action: () => Promise<T>): Promise<T> {
    return withKvLock('avatar-model:server-reset', async () => {
        const active = { id: randomUUID(), active: true };
        if (!await kv.compareSetMany?.([{ op: 'cas', key: modelResetKey, expected, value: active }])) {
            throw new Error('Unable to fence avatar creation for reset');
        }
        // A failed reset retains its fence. Retrying the reset resumes cleanup.
        const result = await action();
        if (!await kv.compareSetMany?.([{ op: 'cas', key: modelResetKey, expected: active, value: { ...active, active: false } }])) {
            throw new Error('Unable to finish avatar reset');
        }
        return result;
    }, { failClosed: true, ttlSec: 900 });
}

export async function detachDoomedModelAccounts(keys: readonly string[]) {
    const owners = new Set<string>();
    for (const key of keys) {
        const match = /^(?:save|auth):([^:]+)$/.exec(key);
        if (match && safeName(match[1]) === match[1]) owners.add(match[1]);
    }
    for (const owner of owners) {
        await withKvLock('save:' + owner, () => detachModelAccount(owner, { freeMonthlySlot: true }), { failClosed: true, ttlSec: 180 });
        await eraseProfileDetail(owner);
    }
}
