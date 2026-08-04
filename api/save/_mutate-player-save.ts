import { bumpSaveVersion } from './_save-version.js';

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

export function versionedPlayerRecord(currentRecord: PlayerSaveRecord, nextCharacter: PlayerCharacter, recordPatch: PlayerSaveRecord = {}): { record: PlayerSaveRecord; _saveVersion: number } {
    const record: PlayerSaveRecord = bumpSaveVersion<PlayerSaveRecord>({ ...currentRecord, ...recordPatch, character: nextCharacter });
    return { record, _saveVersion: Number(record._saveVersion ?? 0) };
}

export async function writeVersionedPlayerSave(
    saveKey: string,
    currentRecord: PlayerSaveRecord,
    nextCharacter: PlayerCharacter,
    recordPatch: PlayerSaveRecord = {},
): Promise<{ record: PlayerSaveRecord; _saveVersion: number }> {
    const [{ kv }, { mergePreservingImages }] = await Promise.all([
        import('../_storage.js'),
        import('../_utils.js'),
    ]);
    const out = versionedPlayerRecord(currentRecord, nextCharacter, recordPatch);
    await kv.set(saveKey, mergePreservingImages(out.record, currentRecord));
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

        // Every authoritative mutation sees the same idempotent owned-pet
        // migration and time-based barn settlement before it validates an
        // action. That makes parents available at readyAt even when Home was
        // never opened, and prevents one endpoint from operating on a legacy
        // pet shape while another sees the migrated schema.
        const [{ migrateCharacterOwnedPets }, { settlePetBreedingSession }] = await Promise.all([
            import('../pet/_owned-pet.js'),
            import('../pet/_breeding-requirements.js'),
        ]);
        const migrated = migrateCharacterOwnedPets(playerName, storedCharacter);
        const settled = settlePetBreedingSession(migrated.character);
        const character = settled.character;

        const decision = await mutate({ playerName, saveKey, record, character });
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
        const out = await writeVersionedPlayerSave(saveKey, record, decision.character, decision.recordPatch);
        return {
            ok: true as const,
            value: decision.value,
            record: out.record,
            character: decision.character,
            _saveVersion: out._saveVersion,
        };
    }, { failClosed: true });
}
