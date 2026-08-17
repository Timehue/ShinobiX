import { isDeepStrictEqual } from 'node:util';
import {
    RECEIPT_TTL_SEC,
    buildActionReceipt,
    type ActionReceipt,
    type ActionReceiptInput,
} from '../_receipts.js';
import type { KvLike } from '../_storage.js';
import { nextPvpStateRevision, type PvpSession } from './session.js';

type ActionReceiptStore = Pick<KvLike, 'get' | 'compareSet'>;
export type PvpActionReceiptMetadata = Omit<ActionReceiptInput, 'pre' | 'post'>;

// Legacy action receipts allocate small monotonically increasing values. A
// revision-derived high lane avoids key/sequence collisions during rollout and
// makes one committed PvP projection map to one immutable receipt without a
// marker-before-body state machine.
const PVP_ACTION_RECEIPT_SEQ_BASE = 1_000_000;

function receiptsDisabled(): boolean {
    return process.env.DISABLE_COMBAT_RECEIPTS === '1';
}

function jsonCanonical<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function pvpActionReceiptKey(battleId: string, stateRevision: number): string {
    return `receipt:action:${battleId}:pvp-v1-${String(stateRevision).padStart(16, '0')}`;
}

/**
 * Seal everything needed to reconstruct the latest action receipt into the
 * same candidate that will win (or lose) the combat CAS.
 */
export function withPvpActionReceiptReplay(
    pre: PvpSession,
    post: PvpSession,
    metadata: PvpActionReceiptMetadata,
    committedAt = Date.now(),
): PvpSession {
    if (receiptsDisabled()) return post;
    const stateRevision = nextPvpStateRevision(pre);
    const receipt = jsonCanonical(buildActionReceipt(
        { pre, post, ...metadata },
        PVP_ACTION_RECEIPT_SEQ_BASE + stateRevision,
        committedAt,
    ));
    return {
        ...post,
        lastActionReceipt: {
            version: 1,
            stateRevision,
            receipt,
        },
    };
}

function committedReplay(session: PvpSession): { stateRevision: number; receipt: ActionReceipt } | null {
    const replay = session.lastActionReceipt;
    if (!replay) return null;
    const revision = Number(session.stateRevision);
    const receipt = replay.receipt;
    const valid = replay.version === 1
        && Number.isSafeInteger(revision)
        && revision > 0
        && Number.isSafeInteger(replay.stateRevision)
        && replay.stateRevision > 0
        && replay.stateRevision <= revision
        && receipt
        && typeof receipt === 'object'
        && receipt.battleId === session.battleId
        && receipt.seq === PVP_ACTION_RECEIPT_SEQ_BASE + replay.stateRevision
        && (receipt.actorRole === 'p1' || receipt.actorRole === 'p2');
    if (!valid) throw new Error('pvp-action-receipt-replay-invalid');
    return { stateRevision: replay.stateRevision, receipt: jsonCanonical(receipt) };
}

/**
 * Materialize the committed replay capsule directly at its deterministic body
 * key. There is no separate NX marker, so a crash can never suppress a missing
 * body. Lost true/false/throw acknowledgements are recovered by exact readback.
 */
export async function replayCommittedPvpActionReceipt(
    store: ActionReceiptStore,
    session: PvpSession,
): Promise<boolean> {
    if (receiptsDisabled()) return true;
    const replay = committedReplay(session);
    if (!replay) return true;
    const key = pvpActionReceiptKey(session.battleId, replay.stateRevision);
    const current = await store.get<ActionReceipt>(key);
    if (current !== null) {
        if (isDeepStrictEqual(jsonCanonical(current), replay.receipt)) return true;
        throw new Error('pvp-action-receipt-conflict');
    }
    try {
        if (await store.compareSet(key, null, replay.receipt, { ex: RECEIPT_TTL_SEC })) return true;
    } catch (error) {
        const recovered = await store.get<ActionReceipt>(key).catch(() => null);
        if (isDeepStrictEqual(recovered && jsonCanonical(recovered), replay.receipt)) return true;
        throw error;
    }
    const recovered = await store.get<ActionReceipt>(key);
    if (isDeepStrictEqual(recovered && jsonCanonical(recovered), replay.receipt)) return true;
    throw new Error('pvp-action-receipt-unconfirmed');
}
