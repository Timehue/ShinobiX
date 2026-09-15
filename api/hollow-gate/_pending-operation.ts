import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import type { HollowGateRunToken } from './_run-token.js';
import { retireHollowGatePresenceByRunKey } from './_presence.js';

type Character = Record<string, unknown>;
type RunWithReceipts = HollowGateRunToken & { appliedSaveOperationIds?: string[] };
type Change = { key: string; beforePresent: boolean; before?: unknown; afterPresent: boolean; after?: unknown };
export type HollowGatePendingOperation = {
    version: 1;
    token: string;
    kind: 'event' | 'consumable' | 'combat';
    id: string;
    changes: Change[];
    terminal: boolean;
    response: Record<string, unknown>;
};

export function makeHollowGatePendingOperation(args: {
    token: string;
    kind: HollowGatePendingOperation['kind'];
    id: string;
    before: HollowGateRunToken;
    after: HollowGateRunToken | null;
    response: Record<string, unknown>;
}): HollowGatePendingOperation {
    const before = args.before as unknown as Record<string, unknown>;
    const after = args.after as unknown as Record<string, unknown> | null;
    const changes: Change[] = [];
    if (after) for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (key === 'appliedSaveOperationIds' || isDeepStrictEqual(before[key], after[key])) continue;
        changes.push({ key, beforePresent: before[key] !== undefined, before: before[key],
            afterPresent: after[key] !== undefined, after: after[key] });
    }
    return { version: 1, token: args.token, kind: args.kind, id: args.id, changes,
        terminal: args.after === null, response: args.response };
}

export function hollowGatePendingOperationOf(character: Character | undefined, token: string): HollowGatePendingOperation | null {
    const raw = character?.hollowGatePendingOperation;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const proof = raw as HollowGatePendingOperation;
    if (proof.version !== 1 || proof.token !== token || !['event', 'consumable', 'combat'].includes(proof.kind)
        || typeof proof.id !== 'string' || !Array.isArray(proof.changes) || !proof.response || typeof proof.response !== 'object') return null;
    return proof;
}

export function hollowGateSavedTokenMismatch(character: Character, token: string): boolean {
    const saved = character.hollowGateRun as Record<string, unknown> | null | undefined;
    return Boolean(saved?.runToken && saved.runToken !== token);
}

/** Caller holds the run lock. The proof exists only after its player CAS
 * commits; repairing a run never repeats a wallet effect. Every run action
 * observes this repair before inspecting or changing run state. */
export async function recoverHollowGatePendingOperation(
    store: KvLike, runKey: string, run: HollowGateRunToken | null, playerName: string, token: string,
): Promise<HollowGateRunToken | null> {
    const record = await store.get<{ character?: Character }>(`save:${playerName}`);
    const character = record?.character;
    const proof = hollowGatePendingOperationOf(character, token);
    if (!proof || !character || hollowGateSavedTokenMismatch(character, token)) return run;
    const receiptId = `${proof.kind}:${proof.id}`;
    const applied = (run as RunWithReceipts | null)?.appliedSaveOperationIds ?? [];
    if (applied.includes(receiptId)) return run;
    if (proof.terminal) {
        await store.del(runKey);
        await retireHollowGatePresenceByRunKey(store, runKey);
        return null;
    }
    if (!run) {
        // A later extraction can consume the run while retaining the previous
        // operation proof. Its save-side terminal receipt wins on replay.
        if (Array.isArray(character.redeemedHollowGateRuns) && character.redeemedHollowGateRuns.includes(token)) return null;
        throw new Error('hollow-gate-pending-run-missing');
    }
    const next = { ...run } as unknown as Record<string, unknown>;
    for (const change of proof.changes) {
        if (['__proto__', 'prototype', 'constructor', 'appliedSaveOperationIds'].includes(change.key)) {
            throw new Error('hollow-gate-pending-change-invalid');
        }
        const currentPresent = next[change.key] !== undefined;
        const matchesBefore = currentPresent === change.beforePresent && isDeepStrictEqual(next[change.key], change.before);
        const matchesAfter = currentPresent === change.afterPresent && isDeepStrictEqual(next[change.key], change.after);
        if (!matchesBefore && !matchesAfter) throw new Error('hollow-gate-pending-run-conflict');
        if (change.afterPresent) next[change.key] = change.after;
        else delete next[change.key];
    }
    next.appliedSaveOperationIds = [...applied.filter(id => id !== receiptId).slice(-511), receiptId];
    try {
        if (await store.compareSet(runKey, run, next) !== true) throw new Error('hollow-gate-pending-run-conflict');
    } catch (error) {
        const readback = await store.get(runKey).catch(() => null);
        if (!isDeepStrictEqual(readback, next)) throw error;
    }
    return next as unknown as HollowGateRunToken;
}
