import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import { readKvProjection, type KvProjection } from '../_storage-projection.js';
import { storedValueEquals } from '../_stored-value.js';
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
    before: HollowGateRunToken | null;
    after: HollowGateRunToken | null;
    response: Record<string, unknown>;
}): HollowGatePendingOperation {
    if (args.after && !args.before) throw new Error('hollow-gate-pending-before-missing');
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

/** Clear only a proven ended projection; never touch a different or living run. */
export function hollowGateEndedRunCharacter(character: Character, token: string): Character | null {
    const marker = character.lastHollowGateStart as { token?: string } | undefined;
    if (hollowGateSavedTokenMismatch(character, token) || (marker?.token && marker.token !== token)) return null;
    const hp = Number(character.hp);
    const fallen = Number.isFinite(hp) && hp <= 0;
    // Older saves may have only a live start marker. Null alone cannot close
    // that living run; a zero-HP body remains terminal even with a stale marker.
    const explicitlyEnded = character.hollowGateRun === null && !marker?.token;
    if (!explicitlyEnded && !fallen) return null;
    const now = Date.now();
    return { ...character, hollowGateRun: null, lastHollowGateStart: undefined,
        ...(fallen ? { hp: 0, hospitalized: true,
            hospitalizedAt: Number(character.hospitalizedAt) || now,
            hospitalizedUntil: Number(character.hospitalizedUntil) || now + 60_000,
        } : {}),
    };
}

/**
 * The only save fields the repair reads. Every run action, including every
 * step, checks for a proof, and reading the whole save (hundreds of KB) for
 * three fields was most of a step's cost. Postgres extracts them where the
 * data lives (`mgetProjected`); other stores project after an ordinary read.
 */
const PENDING_PROOF_PROJECTION: KvProjection = {
    hollowGatePendingOperation: ['character', 'hollowGatePendingOperation'],
    runToken: ['character', 'hollowGateRun', 'runToken'],
    redeemedHollowGateRuns: ['character', 'redeemedHollowGateRuns'],
};

/**
 * The save's character reduced to those three fields, or undefined when there
 * is no save. Each branch of the repair decides exactly as it does on the whole
 * character: a missing field stays missing, and an explicit null stays null.
 */
export async function readHollowGatePendingProof(
    store: Pick<KvLike, 'mget' | 'mgetProjected'>, playerName: string,
): Promise<Character | undefined> {
    const [row] = await readKvProjection(store, [`save:${playerName}`], PENDING_PROOF_PROJECTION);
    if (!row) return undefined;
    const view: Character = {};
    if (Object.hasOwn(row, 'hollowGatePendingOperation')) view.hollowGatePendingOperation = row.hollowGatePendingOperation;
    if (Object.hasOwn(row, 'runToken')) view.hollowGateRun = { runToken: row.runToken };
    if (Object.hasOwn(row, 'redeemedHollowGateRuns')) view.redeemedHollowGateRuns = row.redeemedHollowGateRuns;
    return view;
}

/**
 * The run row and the save's proof, read together, then repaired. The caller
 * holds the run lock, and every writer of a proof holds it too, so neither read
 * can see the other half of an operation in progress: the order of the two
 * reads cannot change the result, and reading them at once saves a round trip.
 */
export async function loadHollowGateRunForAction(
    store: KvLike, runKey: string, playerName: string, token: string,
): Promise<HollowGateRunToken | null> {
    const [run, saved] = await Promise.all([
        store.get<HollowGateRunToken>(runKey),
        readHollowGatePendingProof(store, playerName),
    ]);
    return repairHollowGateRun(store, runKey, run, token, saved);
}

/** Caller holds the run lock. The proof exists only after its player CAS
 * commits; repairing a run never repeats a wallet effect. Every run action
 * observes this repair before inspecting or changing run state. */
export async function recoverHollowGatePendingOperation(
    store: KvLike, runKey: string, run: HollowGateRunToken | null, playerName: string, token: string,
): Promise<HollowGateRunToken | null> {
    return repairHollowGateRun(store, runKey, run, token, await readHollowGatePendingProof(store, playerName));
}

async function repairHollowGateRun(
    store: KvLike, runKey: string, run: HollowGateRunToken | null, token: string, character: Character | undefined,
): Promise<HollowGateRunToken | null> {
    const proof = hollowGatePendingOperationOf(character, token);
    if (!proof || !character || hollowGateSavedTokenMismatch(character, token)) return run;
    if (proof.terminal) {
        // A later save CAS can retire a previously applied result with the
        // same operation ID. Its terminal proof supersedes that live receipt.
        await store.del(runKey);
        await retireHollowGatePresenceByRunKey(store, runKey);
        return null;
    }
    const receiptId = `${proof.kind}:${proof.id}`;
    const applied = (run as RunWithReceipts | null)?.appliedSaveOperationIds ?? [];
    if (applied.includes(receiptId)) return run;
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
        if (!storedValueEquals(readback, next)) throw error;
    }
    return next as unknown as HollowGateRunToken;
}
