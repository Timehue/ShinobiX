import { creditElderWinDeltas } from '../../shared/elder-elections.js';
import { bumpSaveVersion } from './_save-version.js';
import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import { WORLD_CRISIS_TRIGGER_LEVEL } from '../../shared/world-crisis.js';
import { WORLD_CRISIS_80_TRIGGER_LEVEL } from '../../shared/world-crisis-80.js';
import { reconcileElderFocus } from '../village/_elders.js';
import type { HollowGateCurrencySource } from '../hollow-gate/_external-credits.js';

export type PlayerSaveRecord = Record<string, unknown>;
export type PlayerCharacter = Record<string, unknown>;

export type PlayerSaveMutationContext = {
    playerName: string;
    saveKey: string;
    record: PlayerSaveRecord;
    character: PlayerCharacter;
};

export type PlayerSaveMutation<T> =
    | {
        ok: true;
        character: PlayerCharacter;
        value: T;
        recordPatch?: PlayerSaveRecord;
        write?: boolean;
        /**
         * Overrides the call's `options.hollowGateCurrencySource` for this one
         * write. A compensation can only classify its refund once it has read
         * the CURRENT character under the lock (hollowGateRefundCurrencySource
         * compares the charge's checkpoint with the current one), so the choice
         * has to travel with the decision rather than with the call.
         */
        hollowGateCurrencySource?: HollowGateCurrencySource;
        /**
         * The decision already recorded Hollow Gate provenance for every
         * currency it credited, each under its own source: a drain that pays
         * several refunds charged in different checkpoints. The version bump
         * then stamps with no wallet delta and keeps that ledger as built,
         * instead of classifying the whole delta under one source.
         */
        hollowGateProvenanceRecorded?: true;
        /**
         * Undo what this decision already wrote OUTSIDE the save (a claim
         * record, a cooldown marker) when the save write loses its
         * compare-and-set. A lost compare-and-set commits nothing, so without
         * this a claim recorded ahead of its payout would strand the player:
         * the retry finds the claim and pays nothing. Runs under the same save
         * lock, only for that definite conflict — never for a transport error,
         * whose write may have landed. A failure here is logged; the conflict
         * itself is still what the caller sees.
         */
        onConflict?: () => Promise<void> | void;
        /**
         * The transport-error counterpart of onConflict. Runs under the same save
         * lock when the write threw anything else and its read-back could not
         * confirm the commit, so the write may or may not have landed. It must
         * look at the stored save before undoing anything, and keep its outside
         * write when that read is inconclusive. A failure here is logged; the
         * write's own error is still what the caller sees.
         */
        onUnconfirmedWrite?: () => Promise<void> | void;
        /**
         * Writes that must follow this decision's COMMITTED save while the save
         * lock is still held: a mirror that must never get ahead of the save,
         * or a marker another save-locked writer reads. Runs only after the
         * commit succeeded. A throw reaches the caller with the save already
         * committed, exactly as a raw writer's second write behaved.
         */
        afterCommit?: (committed: { record: PlayerSaveRecord; character: PlayerCharacter; _saveVersion: number }) => Promise<void> | void;
    }
    | { ok: false; status: number; error: string };

/**
 * Why a save could not be mutated before the callback ran: the row is absent,
 * or it has no character. Callers that answered the two cases differently
 * before moving onto this helper read it to keep their exact replies.
 */
export type PlayerSaveMissingCode = 'save-not-found' | 'character-not-found';

export type PlayerSaveMutationResult<T> =
    | { ok: true; value: T; record: PlayerSaveRecord; character: PlayerCharacter; _saveVersion: number }
    | { ok: false; status: number; error: string; code?: PlayerSaveMissingCode };

/** Write options shared by the versioned writers. */
export type VersionedWriteOptions = {
    /** The regeneration cursor to carry (see bumpSaveVersion); omitted = fence to now. */
    regenAt?: number;
    /** Run rewards are already recorded in the run ledger; sanctify absorbs the external baseline. */
    hollowGateCurrencySource?: HollowGateCurrencySource;
    /** Each credit already recorded its own provenance (see PlayerSaveMutation). */
    hollowGateProvenanceRecorded?: boolean;
};

export function versionedPlayerRecord(
    currentRecord: PlayerSaveRecord,
    nextCharacter: PlayerCharacter,
    recordPatch: PlayerSaveRecord = {},
    opts: VersionedWriteOptions = {},
): { record: PlayerSaveRecord; _saveVersion: number } {
    const { hollowGateProvenanceRecorded, ...bumpOpts } = opts;
    const previous = (currentRecord.character ?? {}) as PlayerCharacter;
    const character = creditElderWinDeltas(previous, nextCharacter);
    const record: PlayerSaveRecord = bumpSaveVersion<PlayerSaveRecord>({ ...currentRecord, ...recordPatch, character }, {
        ...bumpOpts,
        // Recorded provenance is stamped against the character itself: no
        // wallet delta, so the ledger the credits built is kept as is.
        previousCharacter: hollowGateProvenanceRecorded ? character : previous,
    });
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
    const beforeCharacter = currentRecord.character as PlayerCharacter | undefined;
    if (['village', 'level', 'monthlyPvpKills', 'pvpKillMonth', 'totalPvpKills', 'accountName'].some(field => beforeCharacter?.[field] !== nextCharacter[field])) {
        // ANBU ranking must see committed PvP results and village changes even
        // before the owner's next generic autosave refreshes the public index.
        try {
            const { buildPublicPlayerIndexEntry, isPublicPlayerIndexKey, REGISTRY_KEY } = await import('../player/_public-index.js');
            const name = saveKey.slice('save:'.length);
            if (isPublicPlayerIndexKey(name)) await kv.hset(REGISTRY_KEY, { [name]: buildPublicPlayerIndexEntry(nextCharacter, name) });
        } catch (error) { console.warn('[village-roles] public ranking refresh deferred:', error); }
    }
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

/** Options a domain mutation may pass to the versioned write. */
export type PlayerSaveMutationOptions = Pick<VersionedWriteOptions, 'hollowGateCurrencySource'> & {
    /** The save lock's TTL in seconds, for a caller that held it longer as a raw writer (default 5). */
    lockTtlSec?: number;
};

/** One save, read and settled under its lock, ready for a decision. */
type LoadedSave = {
    playerName: string;
    saveKey: string;
    /** The exact stored row: the value the compare-and-set expects. */
    record: PlayerSaveRecord;
    /** The settled character, the "before" a decision's vitals are compared with. */
    character: PlayerCharacter;
    regen: { excluded: boolean; cursor: number };
    /** The decision's own copies (see the note in loadSettledSave). */
    ctx: PlayerSaveMutationContext;
};

type MissingSave = { ok: false; status: 404; error: string; code: PlayerSaveMissingCode };

/** The write a decision asks for, shared by the one- and two-save writers. */
type SaveWrite = Pick<Extract<PlayerSaveMutation<unknown>, { ok: true }>,
    'character' | 'recordPatch' | 'hollowGateCurrencySource' | 'hollowGateProvenanceRecorded'>;

type CommittedSave = { record: PlayerSaveRecord; character: PlayerCharacter; _saveVersion: number };

/** Read and settle one save. The caller already holds its lock. */
async function loadSettledSave(playerName: string, saveKey: string): Promise<LoadedSave | MissingSave> {
    const { kv } = await import('../_storage.js');
    const record = await kv.get<PlayerSaveRecord>(saveKey);
    const storedCharacter = (record?.character ?? null) as PlayerCharacter | null;
    if (!record || !storedCharacter) {
        const code: PlayerSaveMissingCode = record ? 'character-not-found' : 'save-not-found';
        return { ok: false as const, status: 404, error: 'Player save not found.', code };
    }

    // Settle the idle recovery that elapsed since the regen cursor BEFORE
    // the mutation reads a vital (F13). A consumer that validates or spends
    // HP/chakra/stamina — training, a fight start, an item — used to see
    // whatever the last owner GET had persisted, so it could refuse an
    // action the player's own screen showed as ready, or the mutation's
    // version bump discarded the recovery earned since that GET. Real
    // activity excludes it: a battle lock, an open Hollow Gate run, an
    // admission. One get, under the lock the write already holds.
    const now = Date.now();
    const [{ battleLockedFor, settleVitalsRegen }, { migrateCharacterOwnedPets }, { settlePetBreedingSession }] = await Promise.all([
        import('../_elapsed-state.js'),
        import('../pet/_owned-pet.js'),
        import('../pet/_breeding-requirements.js'),
    ]);
    const regen = settleVitalsRegen(record, { now, battleLocked: await battleLockedFor(playerName) });
    const settledCharacter = (regen.record.character ?? storedCharacter) as PlayerCharacter;

    // Every authoritative mutation sees the same idempotent owned-pet
    // migration and time-based barn settlement before it validates an
    // action. That makes parents available at readyAt even when Home was
    // never opened, and prevents one endpoint from operating on a legacy
    // pet shape while another sees the migrated schema.
    const migrated = migrateCharacterOwnedPets(playerName, settledCharacter);
    const settled = settlePetBreedingSession(migrated.character);
    const character = await reconcileElderFocus(settled.character);

    // The callback gets its own top-level copies. `record` is the exact row the
    // compare-and-set below expects, and `character` can be that row's own
    // character object, so a callback that assigned a field in place
    // (`character.flag = …`) used to edit the expected value itself: the
    // write then failed as a version conflict nobody caused, and the elder
    // and Hollow Gate credits compared against an already-edited "before".
    // Nested state is still shared; callbacks build new arrays and objects
    // rather than pushing into the ones they read.
    //
    // The copies keep one relation callers rely on: `ctx.character` is
    // `ctx.record.character` exactly when the pet/breeding/elder settles
    // changed nothing (the Exchange browse skips its inventory diff on that).
    const ownCharacter = { ...character };
    const settledRecordCharacter = regen.record.character as PlayerCharacter;
    return {
        playerName,
        saveKey,
        record,
        character,
        regen: { excluded: regen.excluded, cursor: regen.cursor },
        ctx: {
            playerName,
            saveKey,
            record: {
                ...regen.record,
                character: settledRecordCharacter === character ? ownCharacter : { ...settledRecordCharacter },
            },
            character: ownCharacter,
        },
    };
}

/** Commit one decision's write with an exact compare-and-set. The caller holds the lock. */
async function commitSaveWrite(loaded: LoadedSave, write: SaveWrite, options: PlayerSaveMutationOptions): Promise<CommittedSave> {
    // Bump _saveVersion on server-side player mutations so stale client
    // autosaves refetch instead of overwriting the credited/debited save.
    //
    // The regen cursor: a mutation that itself changed a vital (a fight
    // settlement, a heal, a stamina spend) fences it to now — its time is
    // not idle recovery. Anything else carries the settled cursor forward,
    // so the sub-second remainder survives the write. Excluded state (a
    // battle lock, an admission) and a record with no clock also fence.
    const vitalsTouched = (['hp', 'chakra', 'stamina'] as const)
        .some((key) => Number(write.character[key] ?? NaN) !== Number(loaded.character[key] ?? NaN));
    // `undefined` lets bumpSaveVersion fence the cursor to the exact write
    // instant (`_saveAt`), so the two stamps agree on a fence.
    const regenAt = vitalsTouched || loaded.regen.excluded || !loaded.regen.cursor ? undefined : loaded.regen.cursor;
    const hollowGateCurrencySource = write.hollowGateCurrencySource ?? options.hollowGateCurrencySource;
    const out = await writeVersionedPlayerSave(loaded.saveKey, loaded.record, write.character, write.recordPatch, {
        regenAt,
        ...(hollowGateCurrencySource ? { hollowGateCurrencySource } : {}),
        ...(write.hollowGateProvenanceRecorded ? { hollowGateProvenanceRecorded: true } : {}),
    });
    return {
        record: out.record,
        character: out.record.character as PlayerCharacter,
        _saveVersion: out._saveVersion,
    };
}

function isSaveVersionConflict(error: unknown): boolean {
    return error instanceof Error && error.message === 'player-save-version-conflict';
}

async function runUndo(saveKey: string, what: string, undo: () => Promise<void> | void): Promise<void> {
    try {
        await undo();
    } catch (undoError) {
        console.error(`[mutatePlayerSave] ${saveKey}: undoing a decision after ${what} failed:`, undoError);
    }
}

export async function mutatePlayerSave<T>(
    playerNameRaw: string,
    mutate: (ctx: PlayerSaveMutationContext) => Promise<PlayerSaveMutation<T>> | PlayerSaveMutation<T>,
    // A Hollow Gate run reward that the caller also credits to the run ledger
    // passes hollowGateCurrencySource 'run', exactly like the writers that call
    // writeVersionedPlayerSaveWithStore directly. The default records a gain
    // made during an open run as an 'external' credit, which death never claws
    // back.
    options: PlayerSaveMutationOptions = {},
): Promise<PlayerSaveMutationResult<T>> {
    const [{ withKvLock }, { safeName }] = await Promise.all([
        import('../_lock.js'),
        import('../_utils.js'),
    ]);
    const playerName = safeName(playerNameRaw);
    if (!playerName) return { ok: false, status: 400, error: 'Invalid player name.' };
    const saveKey = `save:${playerName}`;
    return await withKvLock(saveKey, async () => {
        const loaded = await loadSettledSave(playerName, saveKey);
        if (!('ctx' in loaded)) return loaded;
        const decision = await mutate(loaded.ctx);
        if (!decision.ok) return decision;

        // Read/replay paths can return the authoritative snapshot without
        // manufacturing a save-version bump or rewriting an identical blob.
        if (decision.write === false) {
            return {
                ok: true as const,
                value: decision.value,
                record: loaded.record,
                character: decision.character,
                _saveVersion: Number(loaded.record._saveVersion ?? 0),
            };
        }

        let committed: CommittedSave;
        try {
            committed = await commitSaveWrite(loaded, decision, options);
        } catch (error) {
            const conflict = isSaveVersionConflict(error);
            const undo = conflict ? decision.onConflict : decision.onUnconfirmedWrite;
            if (undo) await runUndo(saveKey, conflict ? 'a lost compare-and-set' : 'a failed write', undo);
            throw error;
        }
        if (decision.afterCommit) await decision.afterCommit(committed);
        return { ok: true as const, value: decision.value, ...committed };
    }, { failClosed: true, ...(options.lockTtlSec ? { ttlSec: options.lockTtlSec } : {}) });
}

/** One save's part of a two-save decision. */
export type PlayerSavesSide = SaveWrite & {
    /** false leaves this save exactly as it is (a side that already settled). */
    write?: boolean;
};

export type PlayerSavesDecision<T> =
    | {
        ok: true;
        value: T;
        /** One entry per save, keyed by the slug its context carries. */
        sides: Record<string, PlayerSavesSide>;
    }
    | { ok: false; status: number; error: string };

export type PlayerSavesResult<T> =
    | {
        ok: true;
        value: T;
        /** Each save as it now stands, keyed by slug; `written` says whether this call changed it. */
        saves: Record<string, CommittedSave & { written: boolean }>;
    }
    | { ok: false; status: number; error: string; code?: PlayerSaveMissingCode; playerName?: string };

/**
 * A later save write failed after an earlier one committed. It is deliberately
 * NOT the version-conflict error, so retryOnSaveVersionConflict never re-runs a
 * half-applied settlement on its own: only a caller whose every side carries
 * its own receipt may retry it (the committed side then replays as unchanged).
 */
export class PlayerSavesPartialCommitError extends Error {
    constructor(
        public readonly committed: readonly string[],
        public readonly failed: string,
        public readonly cause: unknown,
    ) {
        super(`Saved ${committed.join(', ')} but not ${failed}.`);
        this.name = 'PlayerSavesPartialCommitError';
    }
}

/**
 * mutatePlayerSave for a settlement that changes two (or more) players' saves
 * together: a ranked result, a heal, a transfer.
 *
 * Every save is locked, in ONE sorted order and fail-closed, before any is
 * read, so two settlements over the same players can never wait on each other
 * and lock contention can only abort before anything moved. Each save is read
 * and settled exactly as mutatePlayerSave does it (its own regen, battle lock,
 * pet migration and elder reconcile), and `decide` sees them all at once. A
 * missing save answers 404 naming it, and nothing is written.
 *
 * The writes commit one at a time in the order the names were given (the
 * meaningful order: debit before credit), each an exact compare-and-set with
 * its own regen cursor. A failure of the FIRST write leaves nothing committed
 * and rethrows its own error, so a lost compare-and-set can still be retried.
 * A failure after a write has committed throws PlayerSavesPartialCommitError.
 */
export async function mutatePlayerSaves<T>(
    playerNamesRaw: readonly string[],
    decide: (sides: Readonly<Record<string, PlayerSaveMutationContext>>) => Promise<PlayerSavesDecision<T>> | PlayerSavesDecision<T>,
    options: PlayerSaveMutationOptions = {},
): Promise<PlayerSavesResult<T>> {
    const [{ withKvLock }, { safeName }] = await Promise.all([
        import('../_lock.js'),
        import('../_utils.js'),
    ]);
    const names = playerNamesRaw.map((name) => safeName(name));
    if (names.length === 0 || names.some((name) => !name)) return { ok: false, status: 400, error: 'Invalid player name.' };
    if (new Set(names).size !== names.length) {
        throw new Error(`mutatePlayerSaves needs distinct saves, got ${names.join(', ')}.`);
    }
    const lockOptions = { failClosed: true, ...(options.lockTtlSec ? { ttlSec: options.lockTtlSec } : {}) };
    const lockOrder = [...names].sort();

    const settle = async (): Promise<PlayerSavesResult<T>> => {
        const loaded: Record<string, LoadedSave> = {};
        for (const name of names) {
            const save = await loadSettledSave(name, `save:${name}`);
            if (!('ctx' in save)) return { ...save, playerName: name };
            loaded[name] = save;
        }
        const decision = await decide(Object.fromEntries(names.map((name) => [name, loaded[name]!.ctx])));
        if (!decision.ok) return decision;
        for (const name of names) {
            if (!decision.sides[name]) throw new Error(`mutatePlayerSaves: the decision has no side for ${name}.`);
        }

        const saves: Record<string, CommittedSave & { written: boolean }> = {};
        const committed: string[] = [];
        for (const name of names) {
            const side = decision.sides[name]!;
            const save = loaded[name]!;
            if (side.write === false) {
                saves[name] = {
                    record: save.record,
                    character: side.character,
                    _saveVersion: Number(save.record._saveVersion ?? 0),
                    written: false,
                };
                continue;
            }
            try {
                saves[name] = { ...await commitSaveWrite(save, side, options), written: true };
            } catch (error) {
                if (committed.length === 0) throw error;
                throw new PlayerSavesPartialCommitError(committed, name, error);
            }
            committed.push(name);
        }
        return { ok: true, value: decision.value, saves };
    };

    const lockFrom = (index: number): Promise<PlayerSavesResult<T>> => index === lockOrder.length
        ? settle()
        : withKvLock(`save:${lockOrder[index]}`, () => lockFrom(index + 1), lockOptions);
    return await lockFrom(0);
}
