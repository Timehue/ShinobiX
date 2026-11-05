import { kv, type KvCasOp, type KvLike } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { retryOnSaveVersionConflict } from '../save/_projected-write.js';
import { carriedRegenCursor, settleIdleRecovery, writeVersionedPlayerSaveWithStore } from '../save/_mutate-player-save.js';
import { showdownConsumableSpends, type ShowdownSession } from '../_pet-showdown/engine.js';
import { projectCurrentPetSpecies } from './_owned-pet.js';

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
        const pets = recovery.character.pets;
        const current = Array.isArray(pets)
            ? { ...recovery.character, pets: pets.map(pet => pet && typeof pet === 'object'
                ? projectCurrentPetSpecies(pet) : pet) } : recovery.character;
        const decision = await decide(current);
        if (!decision.ok) return decision;
        if (decision.write === false) return { ...decision, _saveVersion: Number(record._saveVersion ?? 0) };
        const session: AdmittedShowdown = decision.session;
        let character: Record<string, unknown>;
        try { character = spendShowdownConsumables(decision.character, session); }
        catch { return { ok: false as const, status: 409, error: 'A companion’s equipped item changed. Review its loadout and retry.' }; }
        session.consumablesCommitted = true;
        // Remember what was spent on the admission itself, so a fight that
        // lapses unplayed can give it back after its row has expired.
        const spent = showdownConsumableSpends(session);
        if (spent.length && arenaAdmissionId(character) === session.sessionId) {
            character = { ...character, petShowdownAdmission: { ...(character.petShowdownAdmission as Record<string, unknown>), spent } };
        }
        const artifact: KvCasOp = { op: 'cas', key: showdownAdmissionKey(name, session.sessionId), expected: null, value: session, ex: TTL };
        const store = showdownAdmissionStore(kv, artifact);
        const written = await writeVersionedPlayerSaveWithStore(store, saveKey, record, character, {}, {
            regenAt: carriedRegenCursor(recovery.character, character, recovery.regen),
        });
        return { ...decision, character, _saveVersion: written._saveVersion };
    }, { failClosed: true }));
}

/**
 * Written before an admitted fight resolves its first round (or is conceded),
 * so a lapse can tell a fight that was never played from one that was. The
 * admission row lives 45 minutes; this outlives it.
 */
export const showdownPlayedKey = (name: string, id: string) => `pet:showdown-played:${name}:${id}`;
export const SHOWDOWN_PLAYED_TTL_SECONDS = 3 * 24 * 60 * 60;

type SpentConsumable = { petId: string; consumableId: string };
function admissionSpends(character: Record<string, unknown>): SpentConsumable[] {
    const spent = (character.petShowdownAdmission as { spent?: unknown } | undefined)?.spent;
    return Array.isArray(spent)
        ? spent.filter((entry): entry is SpentConsumable => !!entry && typeof entry === 'object'
            && typeof (entry as SpentConsumable).petId === 'string' && typeof (entry as SpentConsumable).consumableId === 'string')
        : [];
}

/**
 * Give back the consumables a paid admission spent when its fight lapsed
 * without a single round (the 45-minute row expired with nobody fighting).
 * Each item returns to its pet's empty consumable slot, or to the bag when
 * the slot was refilled or the pet is gone, as unequipping does. A played or
 * conceded fight keeps the spend. Clears the admission either way.
 */
export function refundLapsedAdmission(character: Record<string, unknown>, played: boolean): Record<string, unknown> {
    const spends = played ? [] : admissionSpends(character);
    const pets = Array.isArray(character.pets) ? [...character.pets as Record<string, unknown>[]] : [];
    const inventory = Array.isArray(character.inventory) ? [...character.inventory as unknown[]] : [];
    for (const { petId, consumableId } of spends) {
        const index = pets.findIndex(pet => pet?.id === petId);
        const loadout = index >= 0 ? (pets[index].loadout ?? {}) as Record<string, unknown> : null;
        if (loadout && !loadout.consumable) pets[index] = { ...pets[index], loadout: { ...loadout, consumable: consumableId } };
        else inventory.push(consumableId);
    }
    return { ...character, ...(spends.length ? { pets, inventory } : {}), petShowdownAdmission: undefined };
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
