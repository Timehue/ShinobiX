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
 * A pool pays out ONCE: `claimBounty` removes the head from the board, under the
 * board lock, before the ryo is credited. So the board mutation IS the
 * idempotency — the live path's per-battle receipt exists only because one
 * battleId can be re-POSTed by a retrying client, which has no analogue here.
 * The KO itself is already one-shot (it clears the camp and relocates the victim
 * to sector 0), and the caller only settles a bounty after a KO that committed.
 *
 * ── Lock order matters ──────────────────────────────────────────────────────
 * bounty.ts takes BOUNTY_KEY and THEN `save:<winner>`. This must too, or the two
 * paths deadlock against each other. That is why the caller runs this AFTER
 * releasing the KO's own save locks rather than inside them — taking the board
 * lock while holding `save:<attacker>` would invert the order.
 */
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { mergePreservingImages } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { BOUNTY_KEY, BOUNTY_AUDIT_PREFIX, claimBounty, normalizeBoard, type BountyBoard } from './_bounty.js';

export type BountySettlement = {
    /** Ryo paid; 0 when the target had no bounty, or nothing could be credited. */
    amount: number;
    /** The attacker's new save version when this wrote their save, else null. */
    saveVersion: number | null;
};

const NOTHING: BountySettlement = { amount: 0, saveVersion: null };

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Credit the bounty standing on `victimSlug` to `attackerSlug`, if any.
 *
 * Returns `{ amount: 0 }` — leaving the pool untouched for a legitimate hunter —
 * when the victim has no bounty, or the attacker's save cannot be written. Never
 * throws: a bounty that fails to settle must not undo an already-committed KO,
 * so the caller treats this as best-effort and reports what it returns.
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
            const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
            const result = claimBounty(board, args.victimName);
            if (!result.ok) return NOTHING; // no bounty on this head — ordinary no-op

            const saveVersion = await withKvLock<number | null>(`save:${args.attackerSlug}`, async () => {
                const record = await kv.get<Record<string, unknown>>(`save:${args.attackerSlug}`);
                const character = (record?.character ?? null) as Record<string, unknown> | null;
                if (!record || !character) return null;
                const updated = bumpSaveVersion({
                    ...record,
                    character: { ...character, ryo: num(character.ryo) + result.amount },
                });
                await kv.set(`save:${args.attackerSlug}`, mergePreservingImages(updated, record));
                const next = Number(updated._saveVersion);
                return Number.isFinite(next) ? next : null;
            }, { failClosed: true });

            // Credit first, board second. If the save could not be written we
            // must NOT persist the claimed board, or the pool would vanish
            // without anyone being paid.
            if (saveVersion === null) return NOTHING;
            await kv.set(BOUNTY_KEY, result.board);
            await kv.set(
                `${BOUNTY_AUDIT_PREFIX}claim:${Date.now()}`,
                { winner: args.attackerSlug, target: args.victimSlug, amount: result.amount, via: 'sleeper-ko' },
                { ex: 30 * 24 * 60 * 60 } as never,
            ).catch(() => undefined);
            return { amount: result.amount, saveVersion };
        }, { failClosed: true });
    } catch {
        // Lock contention or a KV blip. The KO already committed and the board is
        // untouched, so the bounty simply remains claimable.
        return NOTHING;
    }
}
