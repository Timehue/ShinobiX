import { kv, type KvCasOp, type KvLike } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { retryOnSaveVersionConflict } from '../save/_projected-write.js';
import { carriedRegenCursor, settleIdleRecovery, writeVersionedPlayerSaveWithStore } from '../save/_mutate-player-save.js';
import { showdownConsumableSpends, type ShowdownSession } from '../_pet-showdown/engine.js';

export const showdownAdmissionKey = (name: string, id: string) => `pet:showdown:${name}:${id}`;
const TTL = 45 * 60;
export type AdmittedShowdown = ShowdownSession & { consumablesCommitted?: true };
export type AdmissionDecision<T extends ShowdownSession> =
    | { ok: true; session: T; character: Record<string, unknown>; write?: boolean }
    | { ok: false; status: number; error: string };

/** Append the sealed combat to the canonical save commit, retaining its commit
 * guard and the store's lock fencing. No sequential fallback is permitted. */
export function showdownAdmissionStore(store: Pick<KvLike, 'get' | 'compareSetMany'>, artifact: KvCasOp) {
    const compareSetMany = store.compareSetMany?.bind(store);
    if (!compareSetMany) throw new Error('Atomic Showdown admission is unavailable.');
    return {
        get: store.get.bind(store),
        compareSet: (key: string, expected: unknown, value: unknown) => compareSetMany([{ op: 'cas', key, expected, value }, artifact]),
        compareSetMany: (ops: readonly KvCasOp[]) => compareSetMany([...ops, artifact]),
    };
}

/** Spend the exact items sealed by this admission. A changed build is refused
 * rather than consuming a replacement item or inventing an inventory debit. */
export function spendShowdownConsumables(character: Record<string, unknown>, session: ShowdownSession): Record<string, unknown> {
    const spends = showdownConsumableSpends(session);
    const pets = Array.isArray(character.pets) ? character.pets as Record<string, unknown>[] : [];
    for (const spend of spends) {
        const pet = pets.find(pet => pet.id === spend.petId);
        if ((pet?.loadout as Record<string, unknown> | undefined)?.consumable !== spend.consumableId) {
            throw new Error('showdown-consumable-build-changed');
        }
    }
    return spends.length ? { ...character, pets: pets.map(pet => {
        const spend = spends.find(spend => spend.petId === pet.id);
        return spend ? { ...pet, loadout: { ...(pet.loadout as Record<string, unknown>), consumable: undefined } } : pet;
    }) } : character;
}

/** Existing save-commit authority, with the combat artifact in its SAME CAS
 * transaction. Lost acknowledgements are confirmed by the existing exact save
 * readback; atomicity means that proves the session and item debit too. */
export async function admitShowdown<T extends ShowdownSession>(
    name: string,
    decide: (character: Record<string, unknown>) => Promise<AdmissionDecision<T>> | AdmissionDecision<T>,
): Promise<(AdmissionDecision<T> & { _saveVersion?: number })> {
    const saveKey = `save:${name}`;
    return retryOnSaveVersionConflict(() => withKvLock(saveKey, async () => {
        const record = await kv.get<Record<string, unknown>>(saveKey);
        if (!record?.character) return { ok: false as const, status: 404, error: 'No save found.' };
        const recovery = await settleIdleRecovery(kv, name, record);
        const decision = await decide(recovery.character);
        if (!decision.ok) return decision;
        if (decision.write === false) return { ...decision, _saveVersion: Number(record._saveVersion ?? 0) };
        const session: AdmittedShowdown = decision.session;
        let character: Record<string, unknown>;
        try { character = spendShowdownConsumables(decision.character, session); }
        catch { return { ok: false as const, status: 409, error: 'A companion’s equipped item changed. Review its loadout and retry.' }; }
        session.consumablesCommitted = true;
        const artifact: KvCasOp = { op: 'cas', key: showdownAdmissionKey(name, session.sessionId), expected: null, value: session, ex: TTL };
        const store = showdownAdmissionStore(kv, artifact);
        const written = await writeVersionedPlayerSaveWithStore(store, saveKey, record, character, {}, {
            regenAt: carriedRegenCursor(recovery.character, character, recovery.regen),
        });
        return { ...decision, character, _saveVersion: written._saveVersion };
    }, { failClosed: true }));
}

export function arenaAdmissionId(character: Record<string, unknown>): string | null {
    const value = character.petShowdownAdmission as { sessionId?: unknown } | undefined;
    return typeof value?.sessionId === 'string' && /^[A-Za-z0-9]{8,64}$/.test(value.sessionId) ? value.sessionId : null;
}

export async function clearArenaAdmission(name: string, sessionId: string): Promise<void> {
    const { mutatePlayerSave } = await import('../save/_mutate-player-save.js');
    await retryOnSaveVersionConflict(() => mutatePlayerSave(name, ({ character }) => ({
        ok: true as const, value: null,
        character: arenaAdmissionId(character) === sessionId ? { ...character, petShowdownAdmission: undefined } : character,
        write: arenaAdmissionId(character) === sessionId,
    })));
}
