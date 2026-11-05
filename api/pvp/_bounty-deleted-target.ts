/** Exceptional refunds live outside the legacy board so old writers cannot erase them. */
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { payPendingBountyClaim } from './_bounty-claim.js';
import { BOUNTY_KEY, normalizeBoard, provenBountyContributions, type Bounty, type BountyBoard, type PendingBountyClaim } from './_bounty.js';

export const BOUNTY_OWNER_REFUND_PREFIX = 'pvp:bounty-owner-refund:v1:';
export type OwnerRefundEntry = { claim: PendingBountyClaim; paidAt?: number; hold?: string };
export type BountyOwnerRefund = {
    version: 1;
    id: string;
    target: string;
    head: Bounty;
    /** Original stored head evidence, including legacy fields; never payment authority. */
    originalHead?: unknown;
    at: number;
    unresolvedAmount: number;
    entries: OwnerRefundEntry[];
    /** Preserve original legacy state for manual reconciliation, never auto-pay it. */
    legacyClaim?: PendingBountyClaim;
};
export function deletedTargetRefundPrefix(targetSlug: string): string { return `deleted-target:${targetSlug}:`; }
export function bountyRefundShares(head: Bounty): { shares: Map<string, number>; exact: boolean } {
    const shares = new Map<string, number>();
    for (const stake of provenBountyContributions(head)) shares.set(stake.owner, (shares.get(stake.owner) ?? 0) + stake.amount);
    return { shares, exact: [...shares.values()].reduce((sum, amount) => sum + amount, 0) === head.amount };
}
function refundKey(row: Pick<BountyOwnerRefund, 'target' | 'id'>): string { return `${BOUNTY_OWNER_REFUND_PREFIX}${row.target}:${row.id}`; }
function remaining(row: BountyOwnerRefund): boolean { return row.unresolvedAmount > 0 || row.entries.some(entry => entry.paidAt === undefined); }
function checkedRow(value: unknown, key: string): BountyOwnerRefund {
    const row = value as BountyOwnerRefund;
    if (!row || row.version !== 1 || typeof row.id !== 'string' || typeof row.target !== 'string'
        || row.target !== safeName(row.target) || refundKey(row) !== key || !row.head || safeName(row.head.target) !== row.target
        || !Number.isSafeInteger(row.head.amount) || row.head.amount <= 0
        || !Number.isSafeInteger(row.unresolvedAmount) || row.unresolvedAmount < 0 || !Array.isArray(row.entries)) throw new Error(`Malformed refund escrow: ${key}`);
    const ids = new Set<string>();
    let total = row.unresolvedAmount;
    for (const entry of row.entries) {
        const claim = entry?.claim;
        if (!claim || typeof claim.id !== 'string' || !claim.id.startsWith(deletedTargetRefundPrefix(row.target)) || ids.has(claim.id)
            || typeof claim.winner !== 'string' || !claim.winner || claim.winner !== safeName(claim.winner)
            || !claim.head || !Number.isSafeInteger(claim.head.amount) || claim.head.amount <= 0
            || safeName(claim.head.target) !== row.target
            || (entry.paidAt !== undefined && (!Number.isSafeInteger(entry.paidAt) || entry.paidAt < 0))
            || (entry.hold !== undefined && (typeof entry.hold !== 'string' || !entry.hold))) throw new Error(`Malformed refund entry: ${key}`);
        ids.add(claim.id);
        total += claim.head.amount;
    }
    if (total !== row.head.amount) throw new Error(`Refund escrow total mismatch: ${key}`);
    return row;
}
async function refundKeys(target?: string): Promise<string[]> {
    const prefix = target ? `${BOUNTY_OWNER_REFUND_PREFIX}${target}:` : BOUNTY_OWNER_REFUND_PREFIX;
    return (await kv.keys(`${prefix}*`)).filter(key => key.startsWith(prefix));
}
export async function pendingBountyOwnerRefunds(): Promise<string[]> {
    const pending: string[] = [];
    for (const key of await refundKeys()) {
        const row = checkedRow(await kv.get(key), key);
        if (remaining(row)) pending.push(key);
    }
    return pending;
}

/** Caller owns the board lock. Removal and durable escrow publication are one transaction. */
async function reserveRefund(raw: unknown, board: BountyBoard, head: Bounty, now: number, legacyClaim?: PendingBountyClaim): Promise<void> {
    const id = randomUUID();
    const target = safeName(head.target);
    const stakes = legacyClaim ? [] : provenBountyContributions(head);
    const rawHeads = (raw as Partial<BountyBoard> | null)?.bounties;
    const originalHead = legacyClaim?.head ?? (Array.isArray(rawHeads) ? rawHeads.find(b => b && typeof b.target === 'string' && safeName(b.target) === target) : undefined);
    const row: BountyOwnerRefund = { version: 1, id, target, head, at: now,
        ...(originalHead ? { originalHead } : {}),
        unresolvedAmount: head.amount - stakes.reduce((sum, stake) => sum + stake.amount, 0),
        entries: stakes.map(stake => ({ claim: {
            id: `${deletedTargetRefundPrefix(target)}${id}:${stake.ownerId}`, winner: stake.owner, ownerId: stake.ownerId,
            head: { target: head.target, amount: stake.amount, contributors: [stake.owner], updatedAt: head.updatedAt }, at: now,
        } })), ...(legacyClaim ? { legacyClaim } : {}) };
    let next: BountyBoard;
    if (legacyClaim) {
        // Preserve every other raw entry/field, including unrelated malformed data.
        // The shared inspection has already rejected duplicate legacy IDs.
        const { pendingClaims, ...rest } = raw as BountyBoard;
        const pending = pendingClaims!.filter(claim => claim !== legacyClaim);
        next = pending.length ? { ...rest, pendingClaims: pending } : rest;
    } else next = { ...board, bounties: board.bounties.filter(b => b !== head) };
    checkedRow(row, refundKey(row));
    if (!kv.compareSetMany) throw new Error('Atomic bounty refund reservation is unavailable');
    if (!await kv.compareSetMany([
        { op: 'cas', key: BOUNTY_KEY, expected: raw ?? null, value: next },
        { op: 'cas', key: refundKey(row), expected: null, value: row },
    ])) throw new Error('Bounty board changed before refund reservation; retry');
}

/** Default is hold-only. Activation is an explicit deployment/cutover action. */
export async function settleBountyOwnerRefunds(now: number = Date.now(), target?: string): Promise<{ refunded: Record<string, number>; remaining: string[]; failures: string[] }> {
    const result = { refunded: {} as Record<string, number>, remaining: [] as string[], failures: [] as string[] };
    for (const key of await refundKeys(target)) {
        try {
            await withKvLock(key, async () => {
                const raw = await kv.get(key);
                const row = checkedRow(raw, key);
                if (!remaining(row)) return;
                if (process.env.BOUNTY_OWNER_REFUNDS_ENABLED !== '1') { result.remaining.push(key); return; }
                const next: BountyOwnerRefund = { ...row, entries: row.entries.map(entry => ({ ...entry })) };
                let changed = false;
                for (const entry of next.entries) {
                    if (entry.paidAt !== undefined || entry.hold) continue;
                    try {
                        const paid = await payPendingBountyClaim(entry.claim);
                        if (paid.status === 'paid') {
                            entry.paidAt = now;
                            if (paid.creditedNow) result.refunded[entry.claim.winner] = (result.refunded[entry.claim.winner] ?? 0) + entry.claim.head.amount;
                        } else entry.hold = paid.status === 'missing-save' ? 'missing-owner' : paid.reason;
                        changed = true;
                    } catch (error) { result.failures.push(`${key}: ${error instanceof Error ? error.message : String(error)}`); }
                }
                if (changed && !await kv.compareSet(key, raw, next)) throw new Error('Refund escrow changed before completion; retry');
                if (remaining(next)) result.remaining.push(key);
            }, { failClosed: true });
        } catch (error) { result.failures.push(`${key}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    return result;
}

export type DeletedTargetRefundResult = { refunded: Record<string, number>; exact: boolean | null; removedHead: boolean; failures: string[]; pendingReconciliation: string[] };
export async function refundBountyOnDeletedTarget(rawName: string, now: number = Date.now()): Promise<DeletedTargetRefundResult> {
    const slug = safeName(rawName);
    const result: DeletedTargetRefundResult = { refunded: {}, exact: null, removedHead: false, failures: [], pendingReconciliation: [] };
    if (!slug) return result;
    await withKvLock(BOUNTY_KEY, async () => {
        const raw = await kv.get(BOUNTY_KEY);
        const board = normalizeBoard(raw);
        const head = board.bounties.find(b => safeName(b.target) === slug);
        if (head) {
            result.exact = bountyRefundShares(head).exact;
            await reserveRefund(raw, board, head, now);
            result.removedHead = true;
        }
    }, { failClosed: true });
    const settled = await settleBountyOwnerRefunds(now, slug);
    result.refunded = settled.refunded;
    result.failures = settled.failures;
    result.pendingReconciliation = settled.remaining;
    return result;
}

export type LegacyRefundInspection = {
    claims: PendingBountyClaim[];
    legacyRefunds: Array<{ id: string; amount: unknown }>;
    blockers: string[];
};

/** Inspect raw obligations before normalization. Shared by inspect-only and apply. */
export function inspectLegacyBountyRefunds(raw: unknown): LegacyRefundInspection {
    const result: LegacyRefundInspection = { claims: [], legacyRefunds: [], blockers: [] };
    if (raw === null || raw === undefined) return result;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        result.blockers.push('Malformed bounty board requires manual inspection');
        return result;
    }
    const pending = (raw as Partial<BountyBoard>).pendingClaims;
    if (pending === undefined) return result;
    if (!Array.isArray(pending)) {
        result.blockers.push('Malformed pendingClaims requires manual inspection');
        return result;
    }
    const counts = new Map<string, number>();
    for (const [index, claim] of pending.entries()) {
        if (!claim || typeof claim.id !== 'string' || !claim.id) {
            result.blockers.push(`Malformed pending claim at index ${index} requires manual inspection`);
            continue;
        }
        if (!claim.id.startsWith('deleted-target:')) continue;
        result.legacyRefunds.push({ id: claim.id, amount: claim.head?.amount ?? null });
        counts.set(claim.id, (counts.get(claim.id) ?? 0) + 1);
        const normalized = normalizeBoard({ bounties: [], pendingClaims: [claim] }).pendingClaims;
        if (!normalized?.length || !Number.isSafeInteger(claim.head.amount) || claim.head.amount <= 0
            || !safeName(claim.head.target) || !claim.id.startsWith(deletedTargetRefundPrefix(safeName(claim.head.target)))) {
            result.blockers.push(`Malformed legacy refund ${claim.id} requires manual inspection`);
        } else result.claims.push(claim);
    }
    for (const [id, count] of counts) {
        if (count > 1) result.blockers.push(`Duplicate legacy refund ID ${id} (${count} entries) requires manual inspection`);
    }
    return result;
}

/** Operator-only cutover helper. Stop old writers before migrating pre-policy pending rows. */
export async function migrateLegacyBountyRefunds(now: number = Date.now()): Promise<number> {
    return withKvLock(BOUNTY_KEY, async () => {
        let moved = 0;
        while (true) {
            const raw = await kv.get(BOUNTY_KEY);
            const inspected = inspectLegacyBountyRefunds(raw);
            if (inspected.blockers.length) throw new Error(inspected.blockers.join('; '));
            const legacy = inspected.claims[0];
            if (!legacy) return moved;
            await reserveRefund(raw, raw as BountyBoard, legacy.head, now, legacy);
            moved++;
        }
    }, { failClosed: true });
}
