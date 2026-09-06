import { bumpSaveVersion } from './_save-version.js';
import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import { WORLD_CRISIS_TRIGGER_LEVEL } from '../../shared/world-crisis.js';
import { WORLD_CRISIS_80_TRIGGER_LEVEL } from '../../shared/world-crisis-80.js';

export type PlayerSaveRecord = Record<string, unknown>;
export type PlayerCharacter = Record<string, unknown>;

export type PlayerSaveMutationContext = {
    playerName: string;
    saveKey: string;
    record: PlayerSaveRecord;
    character: PlayerCharacter;
};

export type PlayerSaveMutation<T> =
    | { ok: true; character: PlayerCharacter; value: T; recordPatch?: PlayerSaveRecord; write?: boolean }
    | { ok: false; status: number; error: string };

export type PlayerSaveMutationResult<T> =
    | { ok: true; value: T; record: PlayerSaveRecord; character: PlayerCharacter; _saveVersion: number }
    | { ok: false; status: number; error: string };

/** Write options shared by the versioned writers. */
export type VersionedWriteOptions = {
    /** The regeneration cursor to carry (see bumpSaveVersion); omitted = fence to now. */
    regenAt?: number;
};

export function versionedPlayerRecord(
    currentRecord: PlayerSaveRecord,
    nextCharacter: PlayerCharacter,
    recordPatch: PlayerSaveRecord = {},
    opts: VersionedWriteOptions = {},
): { record: PlayerSaveRecord; _saveVersion: number } {
    const record: PlayerSaveRecord = bumpSaveVersion<PlayerSaveRecord>({ ...currentRecord, ...recordPatch, character: nextCharacter }, opts);
    return { record, _saveVersion: Number(record._saveVersion ?? 0) };
}

/** Exact-CAS save write used by crash-recoverable settlement sagas. */
export async function writeVersionedPlayerSaveWithStore(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    saveKey: string,
    currentRecord: PlayerSaveRecord,
    nextCharacter: PlayerCharacter,
    recordPatch: PlayerSaveRecord = {},
    opts: VersionedWriteOptions = {},
): Promise<{ record: PlayerSaveRecord; _saveVersion: number }> {
    const { mergePreservingImages } = await import('../_utils.js');
    const out = versionedPlayerRecord(currentRecord, nextCharacter, recordPatch, opts);
    const intended = mergePreservingImages(out.record, currentRecord) as PlayerSaveRecord;
    try {
        const committed = await store.compareSet(saveKey, currentRecord, intended);
        if (committed !== true) throw new Error('player-save-version-conflict');
    } catch (error) {
        if (error instanceof Error && error.message === 'player-save-version-conflict') throw error;
        const readback = await store.get<PlayerSaveRecord>(saveKey).catch(() => null);
        if (!isDeepStrictEqual(readback, intended)) throw error;
    }
    return { record: intended, _saveVersion: out._saveVersion };
}

export async function writeVersionedPlayerSave(
    saveKey: string,
    currentRecord: PlayerSaveRecord,
    nextCharacter: PlayerCharacter,
    recordPatch: PlayerSaveRecord = {},
    opts: VersionedWriteOptions = {},
): Promise<{ record: PlayerSaveRecord; _saveVersion: number }> {
    const { kv } = await import('../_storage.js');
    const out = await writeVersionedPlayerSaveWithStore(kv, saveKey, currentRecord, nextCharacter, recordPatch, opts);
    // Project the currency slice into its side-car ledger (P0-5). The blob
    // above is and stays authoritative; this only builds the evidence a future
    // read cutover needs. It costs nothing when the write did not move
    // currency, and can never fail the save — see api/_currency-ledger.ts.
    const { syncCurrencyLedger } = await import('../_currency-ledger.js');
    await syncCurrencyLedger(
        saveKey.slice('save:'.length),
        out.record,
        { previousCharacter: (currentRecord.character ?? null) as PlayerCharacter | null },
    );
    const beforeLevel = Math.max(0, Math.floor(Number((currentRecord.character as PlayerCharacter | undefined)?.level) || 0));
    const afterCharacter = (out.record.character ?? nextCharacter) as PlayerCharacter;
    const afterLevel = Math.max(0, Math.floor(Number(afterCharacter.level) || 0));
    // Observe only a committed threshold crossing. This keeps existing
    // over-threshold accounts from awakening the event merely by logging in,
    // and keeps the already-committed save successful if the herald outbox is
    // temporarily unavailable (the operator retains a manual fallback).
    if (beforeLevel < WORLD_CRISIS_TRIGGER_LEVEL && afterLevel >= WORLD_CRISIS_TRIGGER_LEVEL) {
        try {
            const { observeWorldCrisisLevelCrossing } = await import('../world-crisis/_state.js');
            await observeWorldCrisisLevelCrossing({
                playerName: saveKey.slice('save:'.length),
                beforeLevel,
                afterLevel,
                character: afterCharacter,
            });
        } catch (error) {
            console.error('[world-crisis] committed level crossing observer failed:', error);
        }
    }
    if (beforeLevel < WORLD_CRISIS_80_TRIGGER_LEVEL && afterLevel >= WORLD_CRISIS_80_TRIGGER_LEVEL) {
        try {
            const { observeWorldCrisis80LevelCrossing } = await import('../world-crisis-80/_state.js');
            await observeWorldCrisis80LevelCrossing({
                playerName: saveKey.slice('save:'.length),
                beforeLevel,
                afterLevel,
                character: afterCharacter,
            });
        } catch (error) {
            console.error('[world-crisis-80] committed level crossing observer failed:', error);
        }
    }
    return out;
}

export async function mutatePlayerSave<T>(
    playerNameRaw: string,
    mutate: (ctx: PlayerSaveMutationContext) => Promise<PlayerSaveMutation<T>> | PlayerSaveMutation<T>,
): Promise<PlayerSaveMutationResult<T>> {
    const [{ kv }, { withKvLock }, { safeName }] = await Promise.all([
        import('../_storage.js'),
        import('../_lock.js'),
        import('../_utils.js'),
    ]);
    const playerName = safeName(playerNameRaw);
    if (!playerName) return { ok: false, status: 400, error: 'Invalid player name.' };
    const saveKey = `save:${playerName}`;
    return await withKvLock(saveKey, async () => {
        const record = await kv.get<PlayerSaveRecord>(saveKey);
        const storedCharacter = (record?.character ?? null) as PlayerCharacter | null;
        if (!record || !storedCharacter) return { ok: false as const, status: 404, error: 'Player save not found.' };

        // Settle the idle recovery that elapsed since the regen cursor BEFORE
        // the mutation reads a vital (F13). A consumer that validates or spends
        // HP/chakra/stamina — training, a fight start, an item — used to see
        // whatever the last owner GET had persisted, so it could refuse an
        // action the player's own screen showed as ready, or the mutation's
        // version bump discarded the recovery earned since that GET. Real
        // activity excludes it: a battle lock, an open Hollow Gate run, an
        // admission. One mget, under the lock the write already holds.
        const now = Date.now();
        const [{ battleLockFlagsForPlayers, settleVitalsRegen }, { migrateCharacterOwnedPets }, { settlePetBreedingSession }] = await Promise.all([
            import('../_elapsed-state.js'),
            import('../pet/_owned-pet.js'),
            import('../pet/_breeding-requirements.js'),
        ]);
        const lockFlags = await battleLockFlagsForPlayers([playerName]);
        const regen = settleVitalsRegen(record, { now, battleLocked: lockFlags.get(playerName) === true });
        const settledCharacter = (regen.record.character ?? storedCharacter) as PlayerCharacter;

        // Every authoritative mutation sees the same idempotent owned-pet
        // migration and time-based barn settlement before it validates an
        // action. That makes parents available at readyAt even when Home was
        // never opened, and prevents one endpoint from operating on a legacy
        // pet shape while another sees the migrated schema.
        const migrated = migrateCharacterOwnedPets(playerName, settledCharacter);
        const settled = settlePetBreedingSession(migrated.character);
        const character = settled.character;

        const decision = await mutate({ playerName, saveKey, record: regen.record, character });
        if (!decision.ok) return decision;

        // Read/replay paths can return the authoritative snapshot without
        // manufacturing a save-version bump or rewriting an identical blob.
        if (decision.write === false) {
            return {
                ok: true as const,
                value: decision.value,
                record,
                character: decision.character,
                _saveVersion: Number(record._saveVersion ?? 0),
            };
        }

        // Bump _saveVersion on server-side player mutations so stale client
        // autosaves refetch instead of overwriting the credited/debited save.
        //
        // The regen cursor: a mutation that itself changed a vital (a fight
        // settlement, a heal, a stamina spend) fences it to now — its time is
        // not idle recovery. Anything else carries the settled cursor forward,
        // so the sub-second remainder survives the write. Excluded state (a
        // battle lock, an admission) and a record with no clock also fence.
        const vitalsTouched = (['hp', 'chakra', 'stamina'] as const)
            .some((key) => Number(decision.character[key] ?? NaN) !== Number(character[key] ?? NaN));
        // `undefined` lets bumpSaveVersion fence the cursor to the exact write
        // instant (`_saveAt`), so the two stamps agree on a fence.
        const regenAt = vitalsTouched || regen.excluded || !regen.cursor ? undefined : regen.cursor;
        const out = await writeVersionedPlayerSave(saveKey, record, decision.character, decision.recordPatch, { regenAt });
        return {
            ok: true as const,
            value: decision.value,
            record: out.record,
            character: decision.character,
            _saveVersion: out._saveVersion,
        };
    }, { failClosed: true });
}
