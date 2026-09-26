/*
 * Pay a head bounty for a kill that has no PvP session behind it.
 *
 * The bounty board's own claim route (api/pvp/bounty.ts, action 'claim') is
 * built entirely around a decided `PvpSession`: it needs a battleId to verify
 * the winner, to gate on `pvpSessionMayGrantProgress`, and to key its
 * exactly-once receipt. A sleeping-camp KO (api/player/sleeper-kill.ts) has none
 * of those — there is no session, no turn loop and no second participant — so it
 * could never reach that door, and a hunter who caught their mark asleep in the
 * wild collected nothing. The kill is real: it hospitalises the target, pays the
 * base ryo, and books a PvP kill credit. The bounty should follow it.
 *
 * ── Why this is not farmable ────────────────────────────────────────────────
 * A pool pays out ONCE, through the same two-phase payout as the duel claim
 * (api/pvp/_bounty-claim.ts, issue #180): one board write moves the head out of
 * `bounties` into `pendingClaims` BEFORE the ryo is credited, and the credit
 * carries an in-save receipt. The old order credited first and wrote the board
 * second, so a failed board write left the pool posted for a second claim.
 * The KO itself is already one-shot (it clears the camp and relocates the
 * victim to sector 0), and the caller only settles a bounty after a KO that
 * committed, so each call gets a fresh claim id. A payout this call cannot
 * finish stays pending and the next bounty claim's sweep finishes it.
 *
 * ── Lock order matters ──────────────────────────────────────────────────────
 * bounty.ts takes BOUNTY_KEY and THEN `save:<winner>`. This must too, or the two
 * paths deadlock against each other. That is why the caller runs this AFTER
 * releasing the KO's own save locks rather than inside them — taking the board
 * lock while holding `save:<attacker>` would invert the order.
 */
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import {
    BOUNTY_KEY,
    BOUNTY_AUDIT_PREFIX,
    finishBountyClaim,
    normalizeBoard,
    reserveBountyClaim,
    restoreBountyClaim,
    type BountyBoard,
} from './_bounty.js';
import { payPendingBountyClaim, sweepPendingBountyClaims } from './_bounty-claim.js';

export type BountySettlement = {
    /** Ryo paid; 0 when the target had no bounty, or nothing could be credited. */
    amount: number;
    /** The attacker's new save version when this wrote their save, else null. */
    saveVersion: number | null;
};

const NOTHING: BountySettlement = { amount: 0, saveVersion: null };

/**
 * Credit the bounty standing on `victimSlug` to `attackerSlug`, if any.
 *
 * Returns `{ amount: 0 }` when the victim has no bounty or the KO was ruled
 * ineligible (the pool stays for a legitimate hunter), when the attacker's save
 * is gone (the pool is put back), and when the payout could not finish in this
 * call (the pool stays reserved for the attacker and a later sweep pays it).
 * Never throws: a bounty that fails to settle must not undo an
 * already-committed KO, so the caller treats this as best-effort and reports
 * what it returns.
 */
export async function settleBountyForSessionlessKill(args: {
    attackerSlug: string;
    victimSlug: string;
    /** Display name, for the board lookup (bounties are keyed by display name). */
    victimName: string;
    /** False when the KO was ruled reward-ineligible (shared IP / device). */
    rewardEligible: boolean;
}): Promise<BountySettlement> {
    // Same ladder-integrity rule the live claim applies: an alt does not pay a
    // bounty to its owner. The pool stays on the board for a real hunter.
    if (!args.rewardEligible || !args.attackerSlug || !args.victimSlug) return NOTHING;

    try {
        return await withKvLock<BountySettlement>(BOUNTY_KEY, async () => {
            const now = Date.now();
            const claimId = `sleeper-ko:${args.victimSlug}:${randomUUID()}`;
            const loaded = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
            // Finish any payout an earlier crash left half done.
            const board = await sweepPendingBountyClaims(loaded, now, claimId);
            const reserved = reserveBountyClaim(board, args.victimName, { id: claimId, winner: args.attackerSlug, at: now });
            if (!reserved.ok) {
                // No bounty on this head — an ordinary no-op.
                if (board !== loaded) await kv.set(BOUNTY_KEY, board);
                return NOTHING;
            }
            // Phase 1: the head leaves the board before the attacker is paid.
            await kv.set(BOUNTY_KEY, reserved.board);
            // Phase 2: the credit, exactly once (in-save receipt).
            const paid = await payPendingBountyClaim(reserved.pending);
            if (paid.status === 'missing-save') {
                await kv.set(BOUNTY_KEY, restoreBountyClaim(reserved.board, claimId));
                return NOTHING;
            }
            if (paid.status !== 'paid') {
                console.error('[pvp/bounty-settle] payout needs reconciliation', claimId, paid.reason);
                return NOTHING;
            }
            // Phase 3: clean up. A failure here leaves a pending entry the next
            // sweep closes without paying again.
            await kv.set(BOUNTY_KEY, finishBountyClaim(reserved.board, claimId)).catch(() => undefined);
            const amount = reserved.pending.head.amount;
            await kv.set(
                `${BOUNTY_AUDIT_PREFIX}claim:${Date.now()}`,
                { winner: args.attackerSlug, target: args.victimSlug, amount, via: 'sleeper-ko' },
                { ex: 30 * 24 * 60 * 60 } as never,
            ).catch(() => undefined);
            return { amount, saveVersion: paid.saveVersion };
        }, { failClosed: true });
    } catch {
        // Lock contention or a KV blip. The KO already committed. Either the
        // board is untouched and the bounty remains claimable, or the head was
        // reserved for this attacker and the next claim's sweep pays it.
        return NOTHING;
    }
}
