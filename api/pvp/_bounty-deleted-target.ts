/*
 * Account deletion vs the PvP bounty board.
 *
 * A head names its target by display name, and names are reusable. Left on the
 * board after the target's account is deleted, a head keeps one of the
 * BOUNTY_BOARD_MAX slots, keeps its backers' ryo in escrow for good, and, once
 * the name is registered again, puts an unrelated new player on the board.
 * Account deletion (api/_delete-player-account.ts) therefore takes the head
 * down and gives each backer their stake back.
 *
 * The refund reuses the two-phase claim payout (api/pvp/_bounty-claim.ts):
 *   1. ONE board write takes the head off `bounties` and reserves one pending
 *      claim per backer, with that backer as the "winner" of their own stake.
 *   2. Each backer is credited through mutatePlayerSave with an in-save
 *      receipt keyed by the claim id, so a retry can never pay twice.
 *   3. The pending entries leave the board.
 * A refund interrupted after step 1 is resumed by the next deletion attempt,
 * or by the ordinary pending-claim sweep (every duel claim and the admin
 * reconcile run it), which pays the same receipts.
 *
 * The posting fee is NOT refunded. It was burned when the stake was placed
 * (shared/pvp-bounty-fee.ts) and is the same sink a claimed bounty keeps.
 *
 * Lock order: BOUNTY_KEY, then `save:<backer>` (inside mutatePlayerSave), the
 * order every claim already uses.
 */
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { ECONOMY_TX_PREFIX, type EconomyTxRecord } from '../_economy-tx.js';
import { BOUNTY_PLACE_SAGA } from '../_save-debit-kinds.js';
import { payPendingBountyClaim } from './_bounty-claim.js';
import { BOUNTY_KEY, finishBountyClaim, normalizeBoard, type Bounty, type BountyBoard, type PendingBountyClaim } from './_bounty.js';

/** Claim ids for one target's refunds share this prefix, so a retry finds them. */
export function deletedTargetRefundPrefix(targetSlug: string): string {
    return `deleted-target:${targetSlug}:`;
}

export type BountyStake = { placer: string; amount: number; at: number };

/**
 * How much of `head.amount` each backer put in, keyed by backer slug.
 *
 * The head stores only the pooled total and the backers' names, so the shares
 * come from the placement journals (`economy-tx:pvp-bounty-place-*`, kept 90
 * days). Placements are walked newest first, because a head that was claimed
 * earlier left its own placements behind and those are older than everything
 * on the current head. When a run of the newest placements, all by listed
 * backers, adds up to the pool EXACTLY, those are the shares.
 *
 * Otherwise (a journal aged out, or a claim was restored onto the head) the
 * shares cannot be proven, and the pool is split evenly between the backers,
 * the remainder one ryo at a time in board order. Every ryo goes back to a
 * backer either way; nothing is paid to anyone outside the list.
 */
export function bountyRefundShares(head: Bounty, stakes: BountyStake[]): { shares: Map<string, number>; exact: boolean } {
    const backers = [...new Set(head.contributors.map((c) => safeName(c)).filter(Boolean))];
    const listed = new Set(backers);
    const shares = new Map<string, number>();
    let total = 0;
    for (const stake of [...stakes].sort((a, b) => b.at - a.at)) {
        const placer = safeName(stake.placer);
        const amount = Math.floor(Number(stake.amount) || 0);
        if (!listed.has(placer) || amount <= 0) break;
        if (total + amount > head.amount) break;
        total += amount;
        shares.set(placer, (shares.get(placer) ?? 0) + amount);
        if (total === head.amount) return { shares, exact: true };
    }
    const even = new Map<string, number>();
    if (!backers.length) return { shares: even, exact: false };
    const base = Math.floor(head.amount / backers.length);
    let remainder = head.amount - base * backers.length;
    for (const backer of backers) {
        const amount = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        if (amount > 0) even.set(backer, amount);
    }
    return { shares: even, exact: false };
}

const JOURNAL_READ_CHUNK = 200;

/** Completed placements on `targetSlug`, read from the saga journals. */
async function placementsOn(targetSlug: string): Promise<BountyStake[]> {
    // The journal id is saveDebitTransactionId → settlementTransactionId(kind, ...),
    // which is `<kind>-<digest>`; the kind has no characters it would strip.
    const prefix = `${ECONOMY_TX_PREFIX}${BOUNTY_PLACE_SAGA.kind}-`;
    const keys = (await kv.keys(`${prefix}*`)).filter((key) => key.startsWith(prefix));
    const stakes: BountyStake[] = [];
    for (let i = 0; i < keys.length; i += JOURNAL_READ_CHUNK) {
        const rows = await kv.mget<(EconomyTxRecord | null)[]>(...keys.slice(i, i + JOURNAL_READ_CHUNK));
        for (const tx of rows) {
            if (!tx || tx.kind !== BOUNTY_PLACE_SAGA.kind || (tx.state !== 'complete' && tx.state !== 'credit-applied')) continue;
            const meta = tx.meta ?? {};
            const plan = (meta.plan ?? {}) as { target?: unknown; amount?: unknown; placer?: unknown };
            if (safeName(String(meta.target ?? plan.target ?? '')) !== targetSlug) continue;
            stakes.push({ placer: String(meta.playerName ?? plan.placer ?? ''), amount: Number(plan.amount ?? tx.amount) || 0, at: Number(tx.createdAt) || 0 });
        }
    }
    return stakes;
}

export type DeletedTargetRefundResult = {
    /** Backers credited by this call (slug → ryo). */
    refunded: Record<string, number>;
    /** Whether the shares came from the journals rather than an even split. */
    exact: boolean | null;
    removedHead: boolean;
    failures: string[];
};

/**
 * Take a deleted player's head off the board and return every backer's stake.
 * Idempotent: a second call finds no head and no pending refunds.
 */
export async function refundBountyOnDeletedTarget(rawName: string, now: number = Date.now()): Promise<DeletedTargetRefundResult> {
    const slug = safeName(rawName);
    const result: DeletedTargetRefundResult = { refunded: {}, exact: null, removedHead: false, failures: [] };
    if (!slug) return result;
    const prefix = deletedTargetRefundPrefix(slug);
    await withKvLock(BOUNTY_KEY, async () => {
        let board: BountyBoard = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
        const head = board.bounties.find((b) => safeName(b.target) === slug);
        if (head) {
            const { shares, exact } = bountyRefundShares(head, await placementsOn(slug));
            result.exact = exact;
            const reserved: PendingBountyClaim[] = [...shares].map(([backer, amount]) => ({
                id: `${prefix}${head.updatedAt}:${backer}`,
                winner: backer,
                head: { target: head.target, amount, contributors: [backer], updatedAt: head.updatedAt },
                at: now,
            }));
            const ids = new Set(reserved.map((p) => p.id));
            board = {
                ...board,
                bounties: board.bounties.filter((b) => b !== head),
                pendingClaims: [...(board.pendingClaims ?? []).filter((p) => !ids.has(p.id)), ...reserved],
            };
            // Phase 1: from this write on, the pool can only go back to its backers.
            await kv.set(BOUNTY_KEY, board);
            result.removedHead = true;
        }
        const refunds = (board.pendingClaims ?? []).filter((p) => p.id.startsWith(prefix));
        if (!refunds.length) return;
        for (const pending of refunds) {
            try {
                const paid = await payPendingBountyClaim(pending);
                if (paid.status === 'paid') {
                    if (paid.creditedNow) result.refunded[pending.winner] = pending.head.amount;
                    board = finishBountyClaim(board, pending.id);
                } else if (paid.status === 'missing-save') {
                    // The backer's account is gone too, and their stake with it.
                    // Restoring it would put the deleted target back on the board.
                    board = finishBountyClaim(board, pending.id);
                } else {
                    result.failures.push(`bounty refund ${pending.id}: ${paid.reason}`);
                }
            } catch (error) {
                result.failures.push(`bounty refund ${pending.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        await kv.set(BOUNTY_KEY, board);
    }, { failClosed: true });
    return result;
}
