import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion, storedSaveVersion } from '../save/_save-version.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { pvpSessionMayGrantProgress, type PvpSession } from './session.js';
import { normalizeBoard, placeBounty, claimBounty, findBounty, type Bounty, type BountyBoard } from './_bounty.js';
import {
    applyBountyTargetTransition,
    bountyRequestFingerprint,
    bountySagaCompletionKey,
    bountySagaFingerprint,
    bountySagaJournalKey,
    bountySagaStampMatches,
    bountyTargetVersion,
    bountyTransactionId,
    parseBountySagaCompletion,
    parseBountySagaJournal,
    sameBountyTargetVersion,
    serializeBountySaga,
    type BountySagaCompletion,
    type BountySagaJournal,
    type BountySagaKind,
    type BountySaveMutation,
} from './_bounty-saga.js';

/*
 * /api/pvp/bounty — GET (board) + POST (place / claim)
 *
 * The wallet save and public board are separate KV rows. PLACE and CLAIM are
 * therefore durable sagas, not optimistic two-write sequences:
 *
 *   1. An immutable journal and non-expiring board-authority pointer are sealed.
 *   2. The ryo delta + character.bountySagaStamp land atomically in one save row.
 *   3. The exact target version (target/amount/time/contributor digest) is moved.
 *   4. An immutable completion is persisted before authority is released.
 *
 * Every board mutation first helps the active saga. A lost acknowledgement can
 * only replay/finish the stamped transition; a definite pre-save failure can
 * only abandon an unchanged journal. There are no blind refunds or board deletes.
 */

const BOUNTY_KEY = 'pvp:bounties';
const BOUNTY_SAGA_GATE_KEY = 'pvp:bounty-board-authority';
const SESSION_REPLAY_WINDOW_MS = 2 * 60 * 60 * 1000;
// Client PLACE retries are immediate and CLAIM evidence is accepted for 2h.
// Thirty days gives support/replay headroom without immortal per-request rows.
const IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 60 * 60;
// Completed journals expire one day before their completion receipt. This
// strict ordering prevents an orphan journal from surviving after the receipt
// that makes reattachment safe, even though the two TTL writes are separate.
const COMPLETED_JOURNAL_TTL_SECONDS = 29 * 24 * 60 * 60;
const AUDIT_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUDIT_PREFIX = 'audit:pvp-bounty:';
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,96}$/;

class BountySagaConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BountySagaConflictError';
    }
}

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function cloneBounty(value: Bounty | undefined): Bounty | null {
    return value ? { ...value, contributors: [...value.contributors] } : null;
}

function recordCharacter(record: Record<string, unknown> | null): Record<string, unknown> | null {
    const character = record?.character;
    return character && typeof character === 'object' && !Array.isArray(character)
        ? character as Record<string, unknown>
        : null;
}

function operationCompletion(
    journal: BountySagaJournal,
    outcome: BountySagaCompletion['outcome'] = 'completed',
    completedAt = Date.now(),
): BountySagaCompletion {
    return {
        version: 1,
        outcome,
        transactionId: journal.transactionId,
        requestFingerprint: journal.requestFingerprint,
        sagaFingerprint: journal.sagaFingerprint,
        kind: journal.kind,
        operationId: journal.operationId,
        actor: journal.actor,
        target: journal.target,
        amount: journal.amount,
        completedAt,
    };
}

function completionMatchesJournal(completion: BountySagaCompletion, journal: BountySagaJournal): boolean {
    return completion.transactionId === journal.transactionId
        && completion.requestFingerprint === journal.requestFingerprint
        && completion.sagaFingerprint === journal.sagaFingerprint
        && completion.kind === journal.kind
        && completion.operationId === journal.operationId
        && completion.actor === journal.actor
        && completion.target === journal.target
        && completion.amount === journal.amount;
}

async function putImmutableString(key: string, value: string, ttlSeconds?: number): Promise<void> {
    let placed: unknown;
    try {
        placed = await kv.set(key, value, {
            nx: true,
            ...(ttlSeconds ? { ex: ttlSeconds } : {}),
        });
    } catch (error) {
        const recovered = await kv.get<string>(key).catch(() => null);
        if (recovered === value) return;
        throw error;
    }
    if (placed === 'OK') return;
    const existing = await kv.get<string>(key);
    if (existing === value) return;
    throw new BountySagaConflictError(`Immutable bounty authority collision at ${key}.`);
}

async function reserveBoardAuthority(journalKey: string): Promise<void> {
    let placed: unknown;
    try {
        placed = await kv.set(BOUNTY_SAGA_GATE_KEY, journalKey, { nx: true });
    } catch (error) {
        const recovered = await kv.get<string>(BOUNTY_SAGA_GATE_KEY).catch(() => null);
        if (recovered === journalKey) return;
        throw error;
    }
    if (placed === 'OK') return;
    const existing = await kv.get<string>(BOUNTY_SAGA_GATE_KEY);
    if (existing === journalKey) return;
    throw new BountySagaConflictError('Another bounty settlement still owns the board.');
}

function targetAuthorityKey(targetName: string): string {
    return `pvp:bounty-active:${safeName(targetName)}`;
}

async function reserveTargetAuthority(journal: BountySagaJournal, journalKey: string): Promise<void> {
    const key = targetAuthorityKey(journal.target);
    let placed: unknown;
    try {
        placed = await kv.set(key, journalKey, { nx: true });
    } catch (error) {
        const recovered = await kv.get<string>(key).catch(() => null);
        if (recovered === journalKey) return;
        throw error;
    }
    if (placed === 'OK') return;
    const existing = await kv.get<string>(key);
    if (existing === journalKey) return;
    throw new BountySagaConflictError('That target already has an active bounty settlement.');
}

async function releaseBoardAuthority(journalKey: string): Promise<void> {
    const released = await kv.delIfEqual(BOUNTY_SAGA_GATE_KEY, journalKey);
    if (released) return;
    const existing = await kv.get<string>(BOUNTY_SAGA_GATE_KEY);
    if (existing == null) return;
    throw new BountySagaConflictError('Bounty board authority changed during settlement.');
}

async function releaseTargetAuthority(journal: BountySagaJournal, journalKey: string): Promise<void> {
    const key = targetAuthorityKey(journal.target);
    const released = await kv.delIfEqual(key, journalKey);
    if (released) return;
    const existing = await kv.get<string>(key);
    if (existing == null) return;
    throw new BountySagaConflictError('Target bounty authority changed during settlement.');
}

async function readCompletion(transactionId: string, requestFingerprint?: string): Promise<BountySagaCompletion | null> {
    const raw = await kv.get<string>(bountySagaCompletionKey(transactionId));
    if (raw == null) return null;
    const completion = parseBountySagaCompletion(raw);
    if (!completion || completion.transactionId !== transactionId) {
        throw new BountySagaConflictError('Stored bounty completion is malformed.');
    }
    if (requestFingerprint && completion.requestFingerprint !== requestFingerprint) {
        throw new BountySagaConflictError('That bounty operation id is already bound to different parameters.');
    }
    return completion;
}

async function writeCompletion(
    journal: BountySagaJournal,
    outcome: BountySagaCompletion['outcome'] = 'completed',
): Promise<BountySagaCompletion> {
    const completion = operationCompletion(journal, outcome);
    await putImmutableString(
        bountySagaCompletionKey(journal.transactionId),
        serializeBountySaga(completion),
        IDEMPOTENCY_TTL_SECONDS,
    );
    return completion;
}

async function writeBoardTransition(journal: BountySagaJournal): Promise<BountyBoard> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
        // Preserve the exact raw predecessor. Normalization is for domain
        // validation/transition only; compareSet fences the complete stored row
        // so no unrelated head or successor write can be overwritten.
        const rawCurrent = await kv.get<BountyBoard>(BOUNTY_KEY);
        const current = normalizeBoard(rawCurrent);
        const currentVersion = bountyTargetVersion(current, journal.target);
        if (sameBountyTargetVersion(currentVersion, journal.after)) return current;
        if (!sameBountyTargetVersion(currentVersion, journal.before)) {
            const completed = await readCompletion(journal.transactionId, journal.requestFingerprint);
            if (completed && completionMatchesJournal(completed, journal)) return current;
            throw new BountySagaConflictError('The bounty target no longer matches its sealed version.');
        }
        const next = applyBountyTargetTransition(current, journal.target, journal.before, journal.afterTarget);
        try {
            if (await kv.compareSet(BOUNTY_KEY, rawCurrent, next)) return next;
        } catch (error) {
            // A remote CAS can commit and lose its HTTP acknowledgement. Only
            // the exact sealed target version (or a matching durable completion
            // written by a helper) proves this transition landed.
            const recovered = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY).catch(() => null));
            if (sameBountyTargetVersion(bountyTargetVersion(recovered, journal.target), journal.after)) return recovered;
            const completed = await readCompletion(journal.transactionId, journal.requestFingerprint).catch(() => null);
            if (completed) return recovered;
            throw error;
        }
        // CAS mismatch: another complete-row writer won after our read. Loop,
        // re-read, and re-evaluate the sealed target version; never blind-set.
    }
    throw new BountySagaConflictError('Bounty board remained busy during its atomic transition.');
}

async function cleanupCompletedJournal(
    journalKey: string,
    journalRaw: string,
    journal: BountySagaJournal,
    completion: BountySagaCompletion,
): Promise<void> {
    // Keep immutable evidence for a bounded replay horizon. Immediate deletion
    // creates an ABA window; immortal retention creates unbounded growth. The
    // completed journal deliberately expires one day before its completion so
    // no orphan can later reattach without the receipt that makes it safe.
    const retainExact = async (key: string, raw: string, ttlSeconds: number): Promise<void> => {
        let lastError: unknown = null;
        // Repeating expected===replacement is safe after a lost acknowledgement:
        // it cannot move state, it only re-confirms/refreshes this exact value's
        // bounded TTL. Never accept readback alone because value equality cannot
        // prove that the expiry update committed.
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                if (await kv.compareSet(key, raw, raw, { ex: ttlSeconds })) return;
            } catch (error) {
                lastError = error;
            }
            const current = await kv.get<string>(key).catch(() => null);
            if (current !== raw) {
                throw new BountySagaConflictError(`Bounty retention evidence changed at ${key}.`);
            }
        }
        if (lastError) throw lastError;
        throw new Error(`Bounty retention TTL was not acknowledged at ${key}.`);
    };

    // Completion first and with the longer horizon: if its refresh fails, the
    // journal is still immortal and both gates stay attached. Once the shorter
    // journal TTL is confirmed, the completion is guaranteed to outlive it.
    await retainExact(
        bountySagaCompletionKey(journal.transactionId),
        serializeBountySaga(completion),
        IDEMPOTENCY_TTL_SECONDS,
    );
    await retainExact(journalKey, journalRaw, COMPLETED_JOURNAL_TTL_SECONDS);
    await releaseTargetAuthority(journal, journalKey);
    await releaseBoardAuthority(journalKey);
}

async function finishJournal(journalKey: string, journalRaw: string, journal: BountySagaJournal): Promise<BountySagaCompletion> {
    const existing = await readCompletion(journal.transactionId, journal.requestFingerprint);
    if (existing && !completionMatchesJournal(existing, journal)) {
        throw new BountySagaConflictError('Bounty completion conflicts with its journal.');
    }
    const completion = existing ?? await writeCompletion(journal);
    await cleanupCompletedJournal(journalKey, journalRaw, journal, completion);
    return completion;
}

async function cancelJournal(journalKey: string, journalRaw: string, journal: BountySagaJournal): Promise<BountySagaCompletion> {
    const completion = await writeCompletion(journal, 'cancelled');
    await cleanupCompletedJournal(journalKey, journalRaw, journal, completion);
    return completion;
}

/**
 * Help the operation currently holding durable board authority. Called before
 * every fresh PLACE/CLAIM, so a crashed request blocks no later hunter while no
 * later hunter can observe or mutate a half-settled target.
 */
async function recoverActiveSaga(): Promise<BountySagaCompletion | null> {
    const journalKey = await kv.get<string>(BOUNTY_SAGA_GATE_KEY);
    if (journalKey == null) return null;
    if (typeof journalKey !== 'string' || !journalKey.startsWith('pvp:bounty-saga:')) {
        throw new BountySagaConflictError('Bounty board authority is malformed.');
    }
    const journalRaw = await kv.get<string>(journalKey);
    const journal = parseBountySagaJournal(journalRaw);
    if (!journal || !journalRaw || bountySagaJournalKey(journal.transactionId) !== journalKey) {
        // The journal is intentionally non-expiring. A pointer without its
        // exact recovery record is corruption, not permission for a blind delete.
        throw new BountySagaConflictError('Bounty board recovery journal is unavailable.');
    }
    // Either pointer may have committed and lost its acknowledgement. The
    // immutable global journal lets recovery repair the target-scoped pointer
    // before inspecting either economic row.
    await reserveTargetAuthority(journal, journalKey);

    const completed = await readCompletion(journal.transactionId);
    if (completed) {
        if (!completionMatchesJournal(completed, journal)) {
            throw new BountySagaConflictError('Bounty completion conflicts with its recovery journal.');
        }
        await cleanupCompletedJournal(journalKey, journalRaw, journal, completed);
        return completed;
    }

    if (journal.saveMutation === 'none') {
        const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
        const current = bountyTargetVersion(board, journal.target);
        if (!sameBountyTargetVersion(current, journal.before)
            || !sameBountyTargetVersion(journal.before, journal.after)) {
            throw new BountySagaConflictError('A no-payout claim observed a changed bounty version.');
        }
        return finishJournal(journalKey, journalRaw, journal);
    }

    if (!journal.saveKey || !journal.stamp) {
        throw new BountySagaConflictError('Bounty wallet journal is incomplete.');
    }

    return withKvLock<BountySagaCompletion | null>(journal.saveKey, async () => {
        const record = await kv.get<Record<string, unknown>>(journal.saveKey!);
        const character = recordCharacter(record);
        if (character && bountySagaStampMatches(character.bountySagaStamp, journal)) {
            await writeBoardTransition(journal);
            return finishJournal(journalKey, journalRaw, journal);
        }

        const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
        const current = bountyTargetVersion(board, journal.target);
        if (!sameBountyTargetVersion(current, journal.before)) {
            throw new BountySagaConflictError('Board changed without the matching atomic wallet stamp.');
        }
        if (!record || !character) {
            throw new BountySagaConflictError('The wallet save is unavailable while its bounty settlement is pending.');
        }

        if (journal.saveMutation === 'debit' && num(character.ryo) < journal.amount) {
            // The save mutation provably never landed (no exact stamp and board
            // still equals before), but another server domain spent the wallet
            // while this request was down. Persist cancellation BEFORE releasing
            // either durable authority so this requestId can never debit later.
            return cancelJournal(journalKey, journalRaw, journal);
        }

        // Definite precommit failure: the journal still owns the exact board
        // predecessor, so finish the delta against the CURRENT wallet record.
        // This is safe across unrelated save-version bumps because the atomic
        // stamp — not a stale balance snapshot — is the exactly-once proof.
        const saved = await writeStampedSave(journal.saveKey!, journal);
        if (saved.replayedCompletion) return saved.replayedCompletion;
        await writeBoardTransition(journal);
        return finishJournal(journalKey, journalRaw, journal);
    }, { failClosed: true, ttlSec: 15 });
}

async function settleExistingOperation(
    transactionId: string,
    requestFingerprint: string,
): Promise<BountySagaCompletion | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await recoverActiveSaga();
        const completion = await readCompletion(transactionId, requestFingerprint);
        if (completion) return completion;

        // Crash window: immutable journal landed, but its board-authority NX
        // acknowledgement did not. Reattach that exact journal and recover it.
        const journalKey = bountySagaJournalKey(transactionId);
        const journalRaw = await kv.get<string>(journalKey);
        if (journalRaw == null) return null;
        const journal = parseBountySagaJournal(journalRaw);
        if (!journal || journal.transactionId !== transactionId) {
            throw new BountySagaConflictError('Stored bounty journal is malformed.');
        }
        if (journal.requestFingerprint !== requestFingerprint) {
            throw new BountySagaConflictError('That bounty operation id is already bound to different parameters.');
        }
        await reserveBoardAuthority(journalKey);
        await recoverActiveSaga();
    }
    return readCompletion(transactionId, requestFingerprint);
}

function prepareJournal(input: {
    kind: BountySagaKind;
    operationId: string;
    actor: string;
    target: string;
    amount: number;
    requestFingerprint: string;
    beforeTarget: Bounty | null;
    afterTarget: Bounty | null;
    before: ReturnType<typeof bountyTargetVersion>;
    after: ReturnType<typeof bountyTargetVersion>;
    saveMutation: BountySaveMutation;
    saveKey: string | null;
    saveVersionBefore: number;
    balanceBefore: number;
    balanceAfter: number;
    createdAt: number;
}): BountySagaJournal {
    const transactionId = bountyTransactionId(input.kind, input.actor, input.operationId);
    const fingerprintInput = {
        transactionId,
        requestFingerprint: input.requestFingerprint,
        kind: input.kind,
        operationId: input.operationId,
        actor: input.actor,
        target: input.target,
        amount: input.amount,
        createdAt: input.createdAt,
        beforeTarget: input.beforeTarget,
        afterTarget: input.afterTarget,
        before: input.before,
        after: input.after,
        saveMutation: input.saveMutation,
        saveKey: input.saveKey,
        saveVersionBefore: input.saveVersionBefore,
        balanceBefore: input.balanceBefore,
        balanceAfter: input.balanceAfter,
    };
    const sagaFingerprint = bountySagaFingerprint(fingerprintInput);
    const stamp = input.saveMutation === 'none' ? null : {
        version: 1 as const,
        transactionId,
        sagaFingerprint,
        kind: input.kind,
        target: input.target,
        amount: input.amount,
        before: input.before,
        after: input.after,
        stampedAt: input.createdAt,
    };
    return { version: 1, ...fingerprintInput, sagaFingerprint, stamp };
}

async function reserveJournal(journal: BountySagaJournal): Promise<{ key: string; raw: string }> {
    const key = bountySagaJournalKey(journal.transactionId);
    const raw = serializeBountySaga(journal);
    await putImmutableString(key, raw);
    await reserveBoardAuthority(key);
    await reserveTargetAuthority(journal, key);
    return { key, raw };
}

async function writeStampedSave(
    saveKey: string,
    journal: BountySagaJournal,
): Promise<{ record: Record<string, unknown>; replayedCompletion: BountySagaCompletion | null }> {
    if (!journal.stamp) throw new BountySagaConflictError('Wallet mutation has no atomic bounty stamp.');
    const journalKey = bountySagaJournalKey(journal.transactionId);

    for (let attempt = 0; attempt < 12; attempt += 1) {
        const completed = await readCompletion(journal.transactionId, journal.requestFingerprint);
        if (completed) {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            if (!record || !recordCharacter(record)) throw new BountySagaConflictError('Completed bounty wallet is unavailable.');
            return { record, replayedCompletion: completed };
        }

        const [boardAuthority, targetAuthority] = await Promise.all([
            kv.get<string>(BOUNTY_SAGA_GATE_KEY),
            kv.get<string>(targetAuthorityKey(journal.target)),
        ]);
        if (boardAuthority !== journalKey || targetAuthority !== journalKey) {
            const racedCompletion = await readCompletion(journal.transactionId, journal.requestFingerprint);
            if (racedCompletion) {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                if (!record || !recordCharacter(record)) throw new BountySagaConflictError('Completed bounty wallet is unavailable.');
                return { record, replayedCompletion: racedCompletion };
            }
            throw new BountySagaConflictError('Bounty wallet writer no longer owns its durable fence.');
        }

        // Never persist the caller's pre-reservation snapshot. CAS compares this
        // complete row and the replacement inside one backend operation, so an
        // expired short lock cannot let a paused writer overwrite a successor.
        const record = await kv.get<Record<string, unknown>>(saveKey);
        const character = recordCharacter(record);
        if (!record || !character) throw new BountySagaConflictError('Bounty wallet save is unavailable.');
        if (bountySagaStampMatches(character.bountySagaStamp, journal)) {
            return { record, replayedCompletion: null };
        }

        const currentBalance = num(character.ryo);
        if (journal.saveMutation === 'debit' && currentBalance < journal.amount) {
            throw new BountySagaConflictError('The pending bounty escrow no longer has enough ryo to finish safely.');
        }
        const balanceAfter = journal.saveMutation === 'debit'
            ? currentBalance - journal.amount
            : currentBalance + journal.amount;
        const updated = bumpSaveVersion<Record<string, unknown>>({
            ...record,
            character: {
                ...character,
                ryo: balanceAfter,
                bountySagaStamp: journal.stamp,
            },
        });
        const merged = mergePreservingImages(updated, record) as Record<string, unknown>;
        const mergedCharacter = recordCharacter(merged) ?? {};
        // mergePreservingImages intentionally unions ordinary object subtrees. A
        // server proof must instead full-replace the prior stamp so no stale keys
        // survive into what recovery treats as one immutable operation marker.
        const persisted: Record<string, unknown> = {
            ...merged,
            character: { ...mergedCharacter, ryo: balanceAfter, bountySagaStamp: journal.stamp },
        };
        try {
            if (await kv.compareSet(saveKey, record, persisted)) {
                return { record: persisted, replayedCompletion: null };
            }
        } catch (error) {
            const recovered = await kv.get<Record<string, unknown>>(saveKey).catch(() => null);
            const recoveredCharacter = recordCharacter(recovered);
            if (recoveredCharacter && bountySagaStampMatches(recoveredCharacter.bountySagaStamp, journal)) {
                return { record: recovered!, replayedCompletion: null };
            }
            const racedCompletion = await readCompletion(journal.transactionId, journal.requestFingerprint).catch(() => null);
            if (racedCompletion && recovered && recoveredCharacter) {
                return { record: recovered, replayedCompletion: racedCompletion };
            }
            throw error;
        }
        // A full-row predecessor mismatch means another save writer won. Loop
        // from fresh completion/fence/save reads and apply at most once to the
        // new authoritative wallet; never overwrite that writer's row.
    }
    throw new BountySagaConflictError('Bounty wallet remained busy during its atomic update.');
}

async function currentWallet(playerName: string): Promise<{ balance?: number; saveVersion?: number }> {
    const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    const character = recordCharacter(record);
    return character ? { balance: num(character.ryo), saveVersion: num(record?._saveVersion) } : {};
}

function freshTargetVersions(board: BountyBoard, target: string, next: BountyBoard) {
    const targetSlug = safeName(target);
    const beforeTarget = board.bounties.find((entry) => safeName(entry.target) === targetSlug);
    const afterTarget = next.bounties.find((entry) => safeName(entry.target) === targetSlug);
    return {
        beforeTarget: cloneBounty(beforeTarget),
        afterTarget: cloneBounty(afterTarget),
        before: bountyTargetVersion(board, target),
        after: bountyTargetVersion(next, target),
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
        res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=15');
        return res.status(200).json({ bounties: board.bounties });
    }
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `pvp-bounty-${action}`, 20, 60_000, identity.name))) return;
        const now = Date.now();

        if (action === 'place') {
            const target = typeof body.target === 'string' ? body.target.trim() : '';
            const targetSlug = safeName(target);
            const amount = Math.floor(num(body.amount));
            const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
            if (!target || !targetSlug) return res.status(400).json({ error: 'Missing target.' });
            if (!REQUEST_ID_RE.test(requestId)) {
                return res.status(409).json({
                    error: 'Refresh the game before placing a bounty; this client cannot safely retry escrow.',
                    code: 'CLIENT_REFRESH_REQUIRED',
                });
            }

            const targetRecord = await kv.get<Record<string, unknown>>(`save:${targetSlug}`);
            const targetCharacter = recordCharacter(targetRecord);
            const targetExists = !!targetCharacter;
            const targetDisplay = typeof targetCharacter?.name === 'string' ? targetCharacter.name : target;
            if (!identity.admin && targetExists) {
                try {
                    if (await hasRecentIpOrFpOverlap(playerName, targetSlug)) {
                        return res.status(403).json({ error: "You can't place a bounty on someone sharing your connection." });
                    }
                } catch { /* availability-only overlap lookup remains fail-open */ }
            }

            const requestFingerprint = bountyRequestFingerprint({
                kind: 'place', operationId: requestId, actor: playerName, target: targetSlug, amount,
            });
            const transactionId = bountyTransactionId('place', playerName, requestId);
            const out = await withKvLock<{ status: number; body: Record<string, unknown>; amount?: number }>(BOUNTY_KEY, async () => {
                const replay = await settleExistingOperation(transactionId, requestFingerprint);
                if (replay) {
                    if (replay.outcome === 'cancelled') {
                        return {
                            status: 409,
                            body: {
                                error: 'That bounty placement was cancelled before escrow because the wallet changed. Review your balance and place it again.',
                                code: 'BOUNTY_PLACE_CANCELLED',
                            },
                        };
                    }
                    const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
                    const wallet = await currentWallet(playerName);
                    return {
                        status: 200,
                        body: {
                            ok: true,
                            replayed: true,
                            bounties: board.bounties,
                            balances: { ryo: wallet.balance },
                            _saveVersion: wallet.saveVersion,
                        },
                        amount: replay.amount,
                    };
                }

                const saveKey = `save:${playerName}`;
                return withKvLock(saveKey, async () => {
                    const lateReplay = await readCompletion(transactionId, requestFingerprint);
                    if (lateReplay) {
                        if (lateReplay.outcome === 'cancelled') {
                            return {
                                status: 409,
                                body: {
                                    error: 'That bounty placement was cancelled before escrow because the wallet changed. Review your balance and place it again.',
                                    code: 'BOUNTY_PLACE_CANCELLED',
                                },
                            };
                        }
                        const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
                        const wallet = await currentWallet(playerName);
                        return {
                            status: 200,
                            body: {
                                ok: true, replayed: true, bounties: board.bounties,
                                balances: { ryo: wallet.balance }, _saveVersion: wallet.saveVersion,
                            },
                            amount: lateReplay.amount,
                        };
                    }
                    const record = await kv.get<Record<string, unknown>>(saveKey);
                    const character = recordCharacter(record);
                    if (!record || !character) return { status: 404, body: { error: 'Your save was not found.' } };
                    const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
                    const result = placeBounty({
                        placerName: identity.admin ? playerName : (typeof character.name === 'string' ? character.name : playerName),
                        targetName: targetDisplay,
                        amount,
                        placerRyo: num(character.ryo),
                        targetExists,
                        board,
                    }, Math.max(now, bountyTargetVersion(board, targetSlug).updatedAt + 1));
                    if (!result.ok) return { status: 400, body: { error: result.reason } };

                    const versions = freshTargetVersions(board, targetSlug, result.board);
                    const journal = prepareJournal({
                        kind: 'place', operationId: requestId, actor: playerName, target: targetDisplay,
                        amount: result.amount, requestFingerprint, ...versions,
                        saveMutation: 'debit', saveKey,
                        saveVersionBefore: storedSaveVersion(record._saveVersion),
                        balanceBefore: num(character.ryo), balanceAfter: num(character.ryo) - result.amount,
                        createdAt: now,
                    });
                    const reserved = await reserveJournal(journal);
                    const saved = await writeStampedSave(saveKey, journal);
                    if (saved.replayedCompletion) {
                        if (saved.replayedCompletion.outcome === 'cancelled') {
                            return {
                                status: 409,
                                body: {
                                    error: 'That bounty placement was cancelled before escrow because the wallet changed. Review your balance and place it again.',
                                    code: 'BOUNTY_PLACE_CANCELLED',
                                },
                            };
                        }
                        const currentBoard = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
                        const wallet = await currentWallet(playerName);
                        return {
                            status: 200,
                            body: {
                                ok: true, replayed: true, bounties: currentBoard.bounties,
                                balances: { ryo: wallet.balance }, _saveVersion: wallet.saveVersion,
                            },
                            amount: saved.replayedCompletion.amount,
                        };
                    }
                    const committedBoard = await writeBoardTransition(journal);
                    await finishJournal(reserved.key, reserved.raw, journal);
                    const savedCharacter = recordCharacter(saved.record);
                    return {
                        status: 200,
                        body: {
                            ok: true,
                            bounties: committedBoard.bounties,
                            balances: { ryo: num(savedCharacter?.ryo) },
                            _saveVersion: num(saved.record._saveVersion),
                        },
                        amount: journal.amount,
                    };
                }, { failClosed: true, ttlSec: 15 });
            }, { failClosed: true, ttlSec: 15 });

            if (out.status === 200 && out.amount) {
                await kv.set(`${AUDIT_PREFIX}${transactionId}`, {
                    ts: now, kind: 'place', placer: playerName, target: targetSlug, amount: out.amount, transactionId,
                }, { nx: true, ex: AUDIT_TTL_SECONDS }).catch(() => undefined);
            }
            return res.status(out.status).json(out.body);
        }

        if (action === 'ai-hunter-start') {
            const hunterId = typeof body.hunterId === 'string' ? body.hunterId.trim().slice(0, 140) : '';
            if (!/^[A-Za-z0-9:_-]{8,140}$/.test(hunterId)) return res.status(400).json({ error: 'Missing hunterId.' });
            const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
            const bounty = findBounty(board, playerName);
            if (!bounty) return res.status(200).json({ ok: false, reason: 'no-bounty' });
            return res.status(200).json({
                ok: true,
                bounty: { target: bounty.target, amount: bounty.amount, contributors: bounty.contributors, updatedAt: bounty.updatedAt },
            });
        }

        if (action === 'ai-hunter-claim') {
            return res.status(200).json({ ok: true, amount: 0, uncollectible: true });
        }

        if (action === 'claim') {
            const battleId = typeof body.battleId === 'string' ? body.battleId.trim() : '';
            if (!battleId) return res.status(400).json({ error: 'Missing battleId.' });

            const session = await kv.get<PvpSession>(`pvp:${battleId}`);
            if (!session) return res.status(404).json({ error: 'Battle session not found or expired.' });
            if (session.status !== 'done' || !session.winner || session.winner === 'draw') {
                return res.status(409).json({ error: 'That battle is not decided yet.' });
            }
            if (!pvpSessionMayGrantProgress(session)) {
                return res.status(403).json({ error: 'That battle was not a mutually joined, sanctioned PvP match.' });
            }
            if (now - num(session.createdAt) > SESSION_REPLAY_WINDOW_MS) {
                return res.status(409).json({ error: 'That battle is too old to claim a bounty.' });
            }
            const winnerName = (session.winner === 'p1' ? session.p1.name : session.p2.name) ?? '';
            const loserName = (session.winner === 'p1' ? session.p2.name : session.p1.name) ?? '';
            const loserSlug = safeName(loserName);
            if (!identity.admin && safeName(winnerName) !== playerName) {
                return res.status(403).json({ error: 'Only the winner of that battle can claim its bounty.' });
            }
            try {
                if (await hasRecentIpOrFpOverlap(winnerName, loserName)) {
                    return res.status(403).json({ error: 'Bounty not paid: you and that player share a connection.' });
                }
            } catch { /* availability-only overlap lookup remains fail-open */ }

            const requestFingerprint = bountyRequestFingerprint({
                kind: 'claim', operationId: battleId, actor: playerName, target: loserSlug,
                sessionCreatedAt: num(session.createdAt),
            });
            const transactionId = bountyTransactionId('claim', playerName, battleId);
            const out = await withKvLock<{ status: number; body: Record<string, unknown>; paid?: number }>(BOUNTY_KEY, async () => {
                const replay = await settleExistingOperation(transactionId, requestFingerprint);
                if (replay) {
                    const wallet = await currentWallet(playerName);
                    return {
                        status: 200,
                        body: {
                            ok: true,
                            replayed: true,
                            amount: replay.amount,
                            target: replay.target,
                            balances: { ryo: wallet.balance },
                            _saveVersion: wallet.saveVersion,
                        },
                    };
                }

                const saveKey = `save:${playerName}`;
                return withKvLock(saveKey, async () => {
                    const lateReplay = await readCompletion(transactionId, requestFingerprint);
                    if (lateReplay) {
                        const wallet = await currentWallet(playerName);
                        return {
                            status: 200,
                            body: {
                                ok: true, replayed: true, amount: lateReplay.amount, target: lateReplay.target,
                                balances: { ryo: wallet.balance }, _saveVersion: wallet.saveVersion,
                            },
                        };
                    }
                    // Re-read the target only after the inner lock is acquired.
                    // If the outer short lease expired while waiting, a successor
                    // may have moved the board; reserveJournal's durable global +
                    // target authorities then either bind this exact fresh version
                    // or fail closed before any wallet write.
                    const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
                    const result = claimBounty(board, loserName);
                    if (!result.ok) {
                        // Consume this valid battle even when no pool exists.
                        // Otherwise the same old battle could claim a bounty
                        // somebody posts later inside the replay window.
                        const version = bountyTargetVersion(board, loserSlug);
                        const journal = prepareJournal({
                            kind: 'claim', operationId: battleId, actor: playerName, target: loserName,
                            amount: 0, requestFingerprint,
                            beforeTarget: null, afterTarget: null, before: version, after: version,
                            saveMutation: 'none', saveKey: null, saveVersionBefore: 0,
                            balanceBefore: 0, balanceAfter: 0, createdAt: now,
                        });
                        const reserved = await reserveJournal(journal);
                        await finishJournal(reserved.key, reserved.raw, journal);
                        const wallet = await currentWallet(playerName);
                        return {
                            status: 200,
                            body: { ok: true, amount: 0, target: loserName, balances: { ryo: wallet.balance }, _saveVersion: wallet.saveVersion },
                        };
                    }

                    const record = await kv.get<Record<string, unknown>>(saveKey);
                    const character = recordCharacter(record);
                    if (!record || !character) return { status: 404, body: { error: 'Your save was not found.' } };
                    const versions = freshTargetVersions(board, loserSlug, result.board);
                    const journal = prepareJournal({
                        kind: 'claim', operationId: battleId, actor: playerName, target: loserName,
                        amount: result.amount, requestFingerprint, ...versions,
                        saveMutation: 'credit', saveKey,
                        saveVersionBefore: storedSaveVersion(record._saveVersion),
                        balanceBefore: num(character.ryo), balanceAfter: num(character.ryo) + result.amount,
                        createdAt: now,
                    });
                    const reserved = await reserveJournal(journal);
                    const saved = await writeStampedSave(saveKey, journal);
                    if (saved.replayedCompletion) {
                        const wallet = await currentWallet(playerName);
                        return {
                            status: 200,
                            body: {
                                ok: true, replayed: true,
                                amount: saved.replayedCompletion.amount,
                                target: saved.replayedCompletion.target,
                                balances: { ryo: wallet.balance }, _saveVersion: wallet.saveVersion,
                            },
                        };
                    }
                    await writeBoardTransition(journal);
                    await finishJournal(reserved.key, reserved.raw, journal);
                    const savedCharacter = recordCharacter(saved.record);
                    return {
                        status: 200,
                        body: {
                            ok: true,
                            amount: result.amount,
                            target: loserName,
                            balances: { ryo: num(savedCharacter?.ryo) },
                            _saveVersion: num(saved.record._saveVersion),
                        },
                        paid: result.amount,
                    };
                }, { failClosed: true, ttlSec: 15 });
            }, { failClosed: true, ttlSec: 15 });

            if (out.status === 200 && out.paid) {
                await kv.set(`${AUDIT_PREFIX}${transactionId}`, {
                    ts: now, kind: 'claim', winner: playerName, target: loserSlug,
                    amount: out.paid, battleId, transactionId,
                }, { nx: true, ex: AUDIT_TTL_SECONDS }).catch(() => undefined);
            }
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (error) {
        if (error instanceof BountySagaConflictError) {
            return res.status(409).json({ error: error.message });
        }
        console.error('[pvp/bounty]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
