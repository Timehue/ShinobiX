import { acknowledged, apiErrorContract, contract, ContractError, record, text, whole, type ContractType } from './api-contract.js';

/** Version parsing is shared without changing the server's 426/409 policy. */
export function parseBaseSaveVersion(raw: unknown): number | null {
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

export const saveDocumentContract = contract((value: unknown) => record(value, 'Invalid save payload.'));
export const saveCharacterContract = contract((value: unknown) => record(value, 'Invalid save payload.'));
export const playerSaveRequestContract = contract((value: unknown) => {
    const body = saveDocumentContract.parse(value);
    const character = saveCharacterContract.parse(body.character);
    const version = parseBaseSaveVersion(body._baseSaveVersion);
    if (version === null) throw new ContractError('Invalid base save version.');
    // Game fields remain opaque here. The authoritative sanitizer and ledger
    // boundary decide which fields this account may write under the save lock.
    return { ...body, character, _baseSaveVersion: version };
});

export const playerSaveSnapshotContract = contract((value: unknown) => {
    const body = saveDocumentContract.parse(value);
    const character = saveCharacterContract.parse(body.character);
    return {
        ...body,
        character: { ...character, name: text(character.name, 'Missing saved character name.') },
        // Legacy saves can have no stamp until their next committed write.
        ...(body._saveVersion == null ? {} : { _saveVersion: whole(body._saveVersion, 'Invalid saved version.') }),
    };
});

function balance(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ContractError(`Invalid ${field} balance.`);
    return value;
}

export const playerSaveAcknowledgementContract = contract((value: unknown) => {
    const body = acknowledged(value);
    if (body.persisted !== undefined && body.persisted !== true) throw new ContractError('Save was not persisted.');
    const ids = body.savedBloodlineIds;
    if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string'))) throw new ContractError('Invalid saved bloodline ids.');
    const ranks = body.savedBloodlineRanks === undefined ? undefined : record(body.savedBloodlineRanks);
    if (ranks && Object.values(ranks).some(rank => typeof rank !== 'string')) throw new ContractError('Invalid saved bloodline ranks.');
    const equipped = body.equippedBloodlineId;
    if (equipped !== undefined && equipped !== null && typeof equipped !== 'string') throw new ContractError('Invalid equipped bloodline id.');
    return {
        ...body, ok: true as const,
        _saveVersion: whole(body._saveVersion, 'Save acknowledgement did not include a valid authoritative version.', 1),
        ...(body.ryo === undefined ? {} : { ryo: balance(body.ryo, 'Ryo') }),
        ...(body.fateShards === undefined ? {} : { fateShards: whole(body.fateShards, 'Invalid Fate Shards balance.') }),
        ...(body.nextSaveInMs === undefined ? {} : { nextSaveInMs: whole(body.nextSaveInMs, 'Invalid save pacing hint.') }),
        ...(ids === undefined ? {} : { savedBloodlineIds: ids as string[] }),
        ...(ranks === undefined ? {} : { savedBloodlineRanks: ranks as Record<string, string> }),
        ...(equipped === undefined ? {} : { equippedBloodlineId: equipped as string | null }),
    };
});

export const deferredSaveContract = contract((value: unknown) => {
    const body = record(value);
    if (body.ok !== false || body.persisted !== false || body.reason !== 'reset-pending') throw new ContractError('Invalid deferred save acknowledgement.');
    return { ...body, ok: false as const, persisted: false as const, reason: 'reset-pending' as const };
});

/** Clan writes/reset acknowledgements remain versionless; admin writes have no body. */
export const saveWriteResponseContract = contract((value: unknown) => {
    const body = record(value);
    if (body.ok === false) return deferredSaveContract.parse(body);
    if (body._saveVersion !== undefined) return playerSaveAcknowledgementContract.parse(body);
    return acknowledged(body);
});

export const saveErrorContract = contract((value: unknown) => {
    const error = apiErrorContract.parse(value);
    const body = record(value);
    return {
        ...error,
        ...(body.currentVersion === undefined ? {} : { currentVersion: whole(body.currentVersion, 'Invalid current version.') }),
        ...(body._saveVersion === undefined ? {} : { _saveVersion: whole(body._saveVersion, 'Invalid save version.') }),
        ...(body.retryAfterMs === undefined ? {} : { retryAfterMs: whole(body.retryAfterMs, 'Invalid retry delay.') }),
        ...(body.code === undefined ? {} : { code: text(body.code, 'Invalid save error code.') }),
        ...(body.authoritativeRyo === undefined ? {} : { authoritativeRyo: balance(body.authoritativeRyo, 'authoritative Ryo') }),
    };
});

export type PlayerSaveRequest = ContractType<typeof playerSaveRequestContract>;
export type PlayerSaveSnapshot = ContractType<typeof playerSaveSnapshotContract>;
export type PlayerSaveAcknowledgement = ContractType<typeof playerSaveAcknowledgementContract>;
export type SaveError = ContractType<typeof saveErrorContract>;
