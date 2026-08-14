import { createHash } from 'node:crypto';
import { safeName } from '../_utils.js';
import { BOUNTY_CONTRIBUTOR_MAX, normalizeBoard, type Bounty, type BountyBoard } from './_bounty.js';

/**
 * Immutable data carried by a bounty PLACE/CLAIM saga.  The board and a player
 * save live in different KV rows, so the save-side stamp is the atomic proof
 * that the wallet mutation landed while this record is the exact recovery
 * instruction for the board row.
 */
export type BountyTargetVersion = {
    target: string;
    amount: number;
    updatedAt: number;
    contributorsDigest: string;
};

export type BountySagaKind = 'place' | 'claim';
export type BountySaveMutation = 'debit' | 'credit' | 'none';

export type BountySagaStamp = {
    version: 1;
    transactionId: string;
    sagaFingerprint: string;
    kind: BountySagaKind;
    target: string;
    amount: number;
    before: BountyTargetVersion;
    after: BountyTargetVersion;
    stampedAt: number;
};

export type BountySagaJournal = {
    version: 1;
    transactionId: string;
    requestFingerprint: string;
    sagaFingerprint: string;
    kind: BountySagaKind;
    operationId: string;
    actor: string;
    target: string;
    amount: number;
    createdAt: number;
    beforeTarget: Bounty | null;
    afterTarget: Bounty | null;
    before: BountyTargetVersion;
    after: BountyTargetVersion;
    saveMutation: BountySaveMutation;
    saveKey: string | null;
    saveVersionBefore: number;
    balanceBefore: number;
    balanceAfter: number;
    stamp: BountySagaStamp | null;
};

export type BountySagaCompletion = {
    version: 1;
    outcome: 'completed' | 'cancelled';
    transactionId: string;
    requestFingerprint: string;
    sagaFingerprint: string;
    kind: BountySagaKind;
    operationId: string;
    actor: string;
    target: string;
    amount: number;
    completedAt: number;
};

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

const SHA256_RE = /^[a-f0-9]{64}$/;
const TRANSACTION_RE = /^(place|claim)-[a-f0-9]{40}$/;
const OPERATION_RE = /^[A-Za-z0-9:_-]{1,160}$/;
const MAX_BOUNTY_AMOUNT = 10_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isSafeIntegerBetween(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isDisplayTarget(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 100 && !!safeName(value);
}

function validTargetVersion(value: unknown, expectedTarget?: string): value is BountyTargetVersion {
    if (!isRecord(value) || !hasExactKeys(value, ['target', 'amount', 'updatedAt', 'contributorsDigest'])) return false;
    if (typeof value.target !== 'string' || !value.target || value.target !== safeName(value.target)) return false;
    if (expectedTarget && value.target !== safeName(expectedTarget)) return false;
    return isSafeIntegerBetween(value.amount, 0, MAX_BOUNTY_AMOUNT)
        && isSafeIntegerBetween(value.updatedAt, 0, Number.MAX_SAFE_INTEGER)
        && typeof value.contributorsDigest === 'string'
        && SHA256_RE.test(value.contributorsDigest);
}

function validBounty(value: unknown, expectedTarget: string): value is Bounty {
    if (!isRecord(value) || !hasExactKeys(value, ['target', 'amount', 'contributors', 'updatedAt'])) return false;
    if (!isDisplayTarget(value.target) || safeName(value.target) !== safeName(expectedTarget)) return false;
    if (!isSafeIntegerBetween(value.amount, 1, MAX_BOUNTY_AMOUNT)) return false;
    if (!isSafeIntegerBetween(value.updatedAt, 0, Number.MAX_SAFE_INTEGER)) return false;
    if (!Array.isArray(value.contributors) || value.contributors.length > BOUNTY_CONTRIBUTOR_MAX) return false;
    return value.contributors.every((entry) => typeof entry === 'string'
        && entry.length > 0
        && entry.length <= 100
        && !!safeName(entry));
}

function bountyMatchesVersion(bounty: Bounty | null, version: BountyTargetVersion, target: string): boolean {
    if (!bounty) return version.amount === 0 && version.updatedAt === 0;
    return sameBountyTargetVersion(
        bountyTargetVersion({ bounties: [bounty] }, target),
        version,
    );
}

function validStamp(value: unknown, journal: Pick<BountySagaJournal,
    'transactionId' | 'sagaFingerprint' | 'kind' | 'target' | 'amount' | 'before' | 'after' | 'createdAt'>): value is BountySagaStamp {
    if (!isRecord(value) || !hasExactKeys(value, [
        'version', 'transactionId', 'sagaFingerprint', 'kind', 'target', 'amount', 'before', 'after', 'stampedAt',
    ])) return false;
    return value.version === 1
        && value.transactionId === journal.transactionId
        && value.sagaFingerprint === journal.sagaFingerprint
        && value.kind === journal.kind
        && value.target === journal.target
        && value.amount === journal.amount
        && value.stampedAt === journal.createdAt
        && validTargetVersion(value.before, journal.target)
        && validTargetVersion(value.after, journal.target)
        && sameBountyTargetVersion(value.before, journal.before)
        && sameBountyTargetVersion(value.after, journal.after);
}

function canonicalContributors(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map((value) => safeName(String(value ?? ''))).filter(Boolean))].sort();
}

export function bountyTargetVersion(board: BountyBoard, targetName: string): BountyTargetVersion {
    const target = safeName(targetName);
    // Board entries retain display names (spaces/case/punctuation), whereas
    // authority keys use canonical save slugs. Compare through safeName so
    // "Ken Ji" and save:kenji are one head, not two version domains.
    const bounty = normalizeBoard(board).bounties.find((entry) => safeName(entry.target) === target);
    const contributors = canonicalContributors(bounty?.contributors);
    return {
        target,
        amount: bounty ? Math.max(0, Math.floor(Number(bounty.amount) || 0)) : 0,
        updatedAt: bounty ? Math.max(0, Math.floor(Number(bounty.updatedAt) || 0)) : 0,
        contributorsDigest: sha256(JSON.stringify(contributors)),
    };
}

export function sameBountyTargetVersion(a: BountyTargetVersion, b: BountyTargetVersion): boolean {
    return a.target === b.target
        && a.amount === b.amount
        && a.updatedAt === b.updatedAt
        && a.contributorsDigest === b.contributorsDigest;
}

/** Apply only one head's prepared transition; unrelated heads are preserved. */
export function applyBountyTargetTransition(
    board: BountyBoard,
    targetName: string,
    expectedBefore: BountyTargetVersion,
    afterTarget: Bounty | null,
): BountyBoard {
    const current = normalizeBoard(board);
    const actual = bountyTargetVersion(current, targetName);
    if (!sameBountyTargetVersion(actual, expectedBefore)) {
        throw new Error('Bounty target changed outside its active settlement authority.');
    }
    const target = safeName(targetName);
    let replaced = false;
    const bounties: Bounty[] = [];
    for (const bounty of current.bounties) {
        if (safeName(bounty.target) !== target) {
            bounties.push(bounty);
            continue;
        }
        replaced = true;
        if (afterTarget) bounties.push({ ...afterTarget, contributors: [...afterTarget.contributors] });
    }
    if (!replaced && afterTarget) bounties.push({ ...afterTarget, contributors: [...afterTarget.contributors] });
    return normalizeBoard({ bounties });
}

export function bountyRequestFingerprint(parts: {
    kind: BountySagaKind;
    operationId: string;
    actor: string;
    target: string;
    amount?: number;
    sessionCreatedAt?: number;
}): string {
    return sha256(JSON.stringify({
        kind: parts.kind,
        operationId: parts.operationId,
        actor: safeName(parts.actor),
        target: safeName(parts.target),
        amount: Math.max(0, Math.floor(Number(parts.amount) || 0)),
        sessionCreatedAt: Math.max(0, Math.floor(Number(parts.sessionCreatedAt) || 0)),
    }));
}

export function bountyTransactionId(kind: BountySagaKind, actor: string, operationId: string): string {
    const digest = sha256(`${kind}:${safeName(actor)}:${operationId}`).slice(0, 40);
    return `${kind}-${digest}`;
}

export function bountySagaFingerprint(input: Omit<BountySagaJournal, 'version' | 'sagaFingerprint' | 'stamp'>): string {
    return sha256(JSON.stringify(input));
}

export function bountySagaJournalKey(transactionId: string): string {
    return `pvp:bounty-saga:${transactionId}`;
}

export function bountySagaCompletionKey(transactionId: string): string {
    return `pvp:bounty-completed:${transactionId}`;
}

export function bountySagaStampMatches(raw: unknown, journal: BountySagaJournal): boolean {
    return !!journal.stamp && validStamp(raw, journal);
}

export function serializeBountySaga(value: BountySagaJournal | BountySagaCompletion): string {
    return JSON.stringify(value);
}

export function parseBountySagaJournal(raw: unknown): BountySagaJournal | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 131_072) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed) || !hasExactKeys(parsed, [
            'version', 'transactionId', 'requestFingerprint', 'sagaFingerprint', 'kind', 'operationId',
            'actor', 'target', 'amount', 'createdAt', 'beforeTarget', 'afterTarget', 'before', 'after',
            'saveMutation', 'saveKey', 'saveVersionBefore', 'balanceBefore', 'balanceAfter', 'stamp',
        ])) return null;
        const value = parsed as unknown as BountySagaJournal;
        if (value.version !== 1 || (value.kind !== 'place' && value.kind !== 'claim')) return null;
        if (!TRANSACTION_RE.test(value.transactionId)
            || value.transactionId !== bountyTransactionId(value.kind, value.actor, value.operationId)) return null;
        if (!SHA256_RE.test(value.requestFingerprint) || !SHA256_RE.test(value.sagaFingerprint)) return null;
        if (!OPERATION_RE.test(value.operationId)) return null;
        if (value.kind === 'place' && value.operationId.length < 8) return null;
        if (typeof value.actor !== 'string' || !value.actor || value.actor !== safeName(value.actor)) return null;
        if (!isDisplayTarget(value.target)) return null;
        if (!isSafeIntegerBetween(value.amount, 0, MAX_BOUNTY_AMOUNT)) return null;
        if (!isSafeIntegerBetween(value.createdAt, 1, Number.MAX_SAFE_INTEGER)) return null;
        if (!validTargetVersion(value.before, value.target) || !validTargetVersion(value.after, value.target)) return null;
        if (!isSafeIntegerBetween(value.saveVersionBefore, 0, Number.MAX_SAFE_INTEGER)) return null;
        if (!isSafeIntegerBetween(value.balanceBefore, 0, Number.MAX_SAFE_INTEGER)
            || !isSafeIntegerBetween(value.balanceAfter, 0, Number.MAX_SAFE_INTEGER)) return null;
        if (value.beforeTarget !== null && !validBounty(value.beforeTarget, value.target)) return null;
        if (value.afterTarget !== null && !validBounty(value.afterTarget, value.target)) return null;
        if (!bountyMatchesVersion(value.beforeTarget, value.before, value.target)
            || !bountyMatchesVersion(value.afterTarget, value.after, value.target)) return null;

        if (value.kind === 'place') {
            if (value.saveMutation !== 'debit' || value.amount <= 0 || !value.afterTarget) return null;
            if (value.after.amount !== value.before.amount + value.amount
                || value.after.updatedAt <= value.before.updatedAt
                || value.balanceAfter !== value.balanceBefore - value.amount) return null;
        } else if (value.saveMutation === 'credit') {
            if (value.amount <= 0 || !value.beforeTarget || value.afterTarget !== null) return null;
            if (value.before.amount !== value.amount || value.after.amount !== 0 || value.after.updatedAt !== 0
                || value.balanceAfter !== value.balanceBefore + value.amount) return null;
        } else if (value.saveMutation === 'none') {
            if (value.amount !== 0 || value.beforeTarget !== null || value.afterTarget !== null) return null;
            if (!sameBountyTargetVersion(value.before, value.after)
                || value.before.amount !== 0 || value.balanceBefore !== 0 || value.balanceAfter !== 0) return null;
        } else {
            return null;
        }

        if (value.saveMutation === 'none') {
            if (value.saveKey !== null || value.stamp !== null) return null;
        } else {
            if (value.saveKey !== `save:${value.actor}` || !validStamp(value.stamp, value)) return null;
        }

        const fingerprintInput = {
            transactionId: value.transactionId,
            requestFingerprint: value.requestFingerprint,
            kind: value.kind,
            operationId: value.operationId,
            actor: value.actor,
            target: value.target,
            amount: value.amount,
            createdAt: value.createdAt,
            beforeTarget: value.beforeTarget,
            afterTarget: value.afterTarget,
            before: value.before,
            after: value.after,
            saveMutation: value.saveMutation,
            saveKey: value.saveKey,
            saveVersionBefore: value.saveVersionBefore,
            balanceBefore: value.balanceBefore,
            balanceAfter: value.balanceAfter,
        };
        if (bountySagaFingerprint(fingerprintInput) !== value.sagaFingerprint) return null;
        return value;
    } catch {
        return null;
    }
}

export function parseBountySagaCompletion(raw: unknown): BountySagaCompletion | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8_192) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed) || !hasExactKeys(parsed, [
            'version', 'outcome', 'transactionId', 'requestFingerprint', 'sagaFingerprint', 'kind', 'operationId',
            'actor', 'target', 'amount', 'completedAt',
        ])) return null;
        const value = parsed as unknown as BountySagaCompletion;
        if (value.version !== 1 || (value.kind !== 'place' && value.kind !== 'claim')) return null;
        if (value.outcome !== 'completed' && value.outcome !== 'cancelled') return null;
        if (value.outcome === 'cancelled' && (value.kind !== 'place' || value.amount <= 0)) return null;
        if (!TRANSACTION_RE.test(value.transactionId)
            || value.transactionId !== bountyTransactionId(value.kind, value.actor, value.operationId)) return null;
        if (!SHA256_RE.test(value.requestFingerprint) || !SHA256_RE.test(value.sagaFingerprint)) return null;
        if (!OPERATION_RE.test(value.operationId)) return null;
        if (typeof value.actor !== 'string' || !value.actor || value.actor !== safeName(value.actor)) return null;
        if (!isDisplayTarget(value.target)) return null;
        if (!isSafeIntegerBetween(value.amount, 0, MAX_BOUNTY_AMOUNT)) return null;
        if (!isSafeIntegerBetween(value.completedAt, 1, Number.MAX_SAFE_INTEGER)) return null;
        return value;
    } catch {
        return null;
    }
}
