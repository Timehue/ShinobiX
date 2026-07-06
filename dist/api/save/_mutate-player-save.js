"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.versionedPlayerRecord = versionedPlayerRecord;
exports.writeVersionedPlayerSave = writeVersionedPlayerSave;
exports.mutatePlayerSave = mutatePlayerSave;
const _save_version_js_1 = require("./_save-version.js");
function versionedPlayerRecord(currentRecord, nextCharacter) {
    const record = (0, _save_version_js_1.bumpSaveVersion)({ ...currentRecord, character: nextCharacter });
    return { record, _saveVersion: Number(record._saveVersion ?? 0) };
}
async function writeVersionedPlayerSave(saveKey, currentRecord, nextCharacter) {
    const [{ kv }, { mergePreservingImages }] = await Promise.all([
        import('../_storage.js'),
        import('../_utils.js'),
    ]);
    const out = versionedPlayerRecord(currentRecord, nextCharacter);
    await kv.set(saveKey, mergePreservingImages(out.record, currentRecord));
    return out;
}
async function mutatePlayerSave(playerNameRaw, mutate) {
    const [{ kv }, { withKvLock }, { safeName }] = await Promise.all([
        import('../_storage.js'),
        import('../_lock.js'),
        import('../_utils.js'),
    ]);
    const playerName = safeName(playerNameRaw);
    if (!playerName)
        return { ok: false, status: 400, error: 'Invalid player name.' };
    const saveKey = `save:${playerName}`;
    return await withKvLock(saveKey, async () => {
        const record = await kv.get(saveKey);
        const character = (record?.character ?? null);
        if (!record || !character)
            return { ok: false, status: 404, error: 'Player save not found.' };
        const decision = await mutate({ playerName, saveKey, record, character });
        if (!decision.ok)
            return decision;
        // Bump _saveVersion on server-side player mutations so stale client
        // autosaves refetch instead of overwriting the credited/debited save.
        const out = await writeVersionedPlayerSave(saveKey, record, decision.character);
        return {
            ok: true,
            value: decision.value,
            record: out.record,
            character: decision.character,
            _saveVersion: out._saveVersion,
        };
    }, { failClosed: true });
}
