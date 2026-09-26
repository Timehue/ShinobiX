/*
 * Pure decision logic for the PvP bounty board (api/pvp/bounty.ts) — split out
 * so the placement gates and the board math can be unit-tested without KV / auth
 * / locks / presence (same pattern as _kick-core.ts / _kage-challenge.ts).
 *
 * Model: anyone can stake ryo on another player's head. The stake is escrowed
 * into that target's bounty pool (multiple players can pile on). Whoever then
 * beats the target in a real PvP duel claims the whole pool (cross-checked
 * server-side against the PvpSession, and voided if the two share an IP/device
 * so you can't pay your own alt). Turns anonymous fights into ongoing grudges —
 * the core small-population retention hook.
 */

// Storage keys live HERE, not in the route, because more than one settlement
// path now pays a head: the live duel (api/pvp/bounty.ts) and the sleeping-camp
// KO (api/player/sleeper-kill.ts). Two copies of this string would silently
// split the board in half — one pool nobody could claim from the other door.
export const BOUNTY_KEY = 'pvp:bounties';
export const BOUNTY_AUDIT_PREFIX = 'audit:pvp-bounty:';

export const BOUNTY_MIN_PLACE = 1_000;        // min ryo per placement
export const BOUNTY_MAX_PLACE = 1_000_000;    // max ryo per single placement
export const BOUNTY_MAX_PER_TARGET = 10_000_000; // cap on a single head's pool
export const BOUNTY_BOARD_MAX = 50;           // most heads tracked at once

export type Bounty = {
    target: string;          // display name of the hunted player
    amount: number;          // escrowed ryo pool on this head
    contributors: string[];  // lower-name slugs who chipped in (deduped)
    updatedAt: number;
};

/**
 * A payout in flight (api/pvp/_bounty-claim.ts). The head leaves `bounties`
 * and lands here in ONE board write, before the winner is credited, so no
 * second claim can collect the same pool while the credit is outstanding.
 */
export type PendingBountyClaim = {
    /** `duel:<battleId>` or `sleeper-ko:<victim>:<nonce>`. */
    id: string;
    /** safeName of the player being paid. */
    winner: string;
    /** The removed head, exactly, so a claim that cannot pay can put it back. */
    head: Bounty;
    /** When the head was reserved: the earliest the credit can have landed. */
    at: number;
    /** A duel claim also owns the per-battle receipt `pvp:bounty-claimed:<battleId>`. */
    battleId?: string;
};

export type BountyBoard = {
    bounties: Bounty[];
    pendingClaims?: PendingBountyClaim[];
    /** Placement receipts (api/_save-debit-saga.ts). Server-only. */
    settlementReceipts?: unknown[];
};

function lower(s: string): string {
    return String(s ?? '').trim().toLowerCase();
}

export function emptyBoard(): BountyBoard {
    return { bounties: [] };
}

function normalizeBounty(b: Bounty): Bounty {
    return {
        target: b.target,
        amount: Math.max(0, Math.floor(Number(b.amount) || 0)),
        contributors: Array.isArray(b.contributors) ? Array.from(new Set(b.contributors.map(lower).filter(Boolean))) : [],
        updatedAt: Math.floor(Number(b.updatedAt) || 0),
    };
}

function isBounty(b: unknown): b is Bounty {
    return !!b && typeof b === 'object' && typeof (b as Bounty).target === 'string';
}

/** Normalize/repair a stored board (defensive — KV could hold a malformed blob). */
export function normalizeBoard(raw: unknown): BountyBoard {
    const stored = (raw && typeof raw === 'object' ? raw : {}) as Partial<BountyBoard>;
    const list = Array.isArray(stored.bounties) ? stored.bounties : [];
    const bounties = list
        .filter(isBounty)
        .map(normalizeBounty)
        .filter((b) => b.amount > 0)
        .slice(0, BOUNTY_BOARD_MAX);
    // Every board writer goes through here, so the in-flight claims and the
    // placement receipts must survive it; dropping either would lose escrowed
    // ryo or re-open a credit to a second application.
    const pendingClaims = (Array.isArray(stored.pendingClaims) ? stored.pendingClaims : [])
        .filter((p): p is PendingBountyClaim => !!p && typeof p === 'object'
            && typeof p.id === 'string' && !!p.id
            && typeof p.winner === 'string' && !!p.winner
            && isBounty(p.head))
        .map((p) => ({
            id: p.id,
            winner: p.winner,
            head: normalizeBounty(p.head),
            at: Math.floor(Number(p.at) || 0),
            ...(typeof p.battleId === 'string' && p.battleId ? { battleId: p.battleId } : {}),
        }))
        .filter((p) => p.head.amount > 0);
    return {
        bounties,
        ...(pendingClaims.length > 0 ? { pendingClaims } : {}),
        ...(Array.isArray(stored.settlementReceipts) ? { settlementReceipts: stored.settlementReceipts } : {}),
    };
}

export function findBounty(board: BountyBoard, targetName: string): Bounty | undefined {
    return board.bounties.find((b) => lower(b.target) === lower(targetName));
}

export type PlaceInput = {
    placerName: string;   // display name
    targetName: string;   // display name
    amount: number;
    placerRyo: number;
    targetExists: boolean;
    board: BountyBoard;
};
export type PlaceResult = { ok: false; reason: string } | { ok: true; board: BountyBoard; amount: number };

/**
 * Validate + apply a bounty placement. Pure: the endpoint debits the placer's
 * ryo (committed under lock) once this returns ok, and persists the new board.
 */
export function placeBounty(input: PlaceInput, now: number): PlaceResult {
    const { placerName, targetName, placerRyo, targetExists, board } = input;
    const amount = Math.floor(Number(input.amount) || 0);
    if (!targetName) return { ok: false, reason: 'Missing target.' };
    if (lower(targetName) === lower(placerName)) return { ok: false, reason: "You can't put a bounty on yourself." };
    if (!targetExists) return { ok: false, reason: 'That player does not exist.' };
    if (amount < BOUNTY_MIN_PLACE) return { ok: false, reason: `Minimum bounty is ${BOUNTY_MIN_PLACE.toLocaleString()} ryo.` };
    if (amount > BOUNTY_MAX_PLACE) return { ok: false, reason: `Maximum single bounty is ${BOUNTY_MAX_PLACE.toLocaleString()} ryo.` };
    if (placerRyo < amount) return { ok: false, reason: 'You do not have enough ryo.' };

    const existing = findBounty(board, targetName);
    const currentTotal = existing?.amount ?? 0;
    if (currentTotal + amount > BOUNTY_MAX_PER_TARGET) {
        return { ok: false, reason: `This head is already near the ${BOUNTY_MAX_PER_TARGET.toLocaleString()}-ryo cap.` };
    }
    if (!existing && board.bounties.length >= BOUNTY_BOARD_MAX) {
        return { ok: false, reason: 'The bounty board is full right now.' };
    }

    const credited = creditBountyPlacement(board, { target: targetName, amount, placer: placerName }, now);
    if (!credited) return { ok: false, reason: 'The bounty board is full right now.' };
    return { ok: true, board: credited, amount };
}

export type BountyPlacementPlan = { target: string; amount: number; placer: string };

/**
 * Escrow an already-paid stake onto a head. Pure, and deliberately free of the
 * placement RULES: placeBounty checks those before the placer is charged, and
 * this also runs when a retry finishes a placement whose charge already landed
 * (api/_save-debit-saga.ts), where refusing would strand paid ryo. The one
 * thing it cannot do is add a head past BOUNTY_BOARD_MAX, because
 * normalizeBoard would drop it on the next read; it returns null instead.
 */
export function creditBountyPlacement(board: BountyBoard, plan: BountyPlacementPlan, now: number): BountyBoard | null {
    const amount = Math.max(0, Math.floor(Number(plan.amount) || 0));
    const placerSlug = lower(plan.placer);
    const existing = findBounty(board, plan.target);
    if (existing) {
        return {
            ...board,
            bounties: board.bounties.map((b) => b === existing
                ? { ...b, amount: b.amount + amount, contributors: Array.from(new Set([...b.contributors, placerSlug])), updatedAt: now }
                : b),
        };
    }
    if (board.bounties.length >= BOUNTY_BOARD_MAX) return null;
    return { ...board, bounties: [...board.bounties, { target: plan.target, amount, contributors: [placerSlug], updatedAt: now }] };
}

export type ClaimResult = { ok: false; reason: string } | { ok: true; board: BountyBoard; amount: number };

/**
 * Remove the target's bounty from the board and return the pool to pay the
 * claimer. The endpoint verifies the authoritative PvpSession before calling
 * this, then uses the returned candidate payout only after the shared-device
 * gate passes. This helper itself only does the board math + payout amount.
 */
export function claimBounty(board: BountyBoard, targetName: string): ClaimResult {
    const existing = findBounty(board, targetName);
    if (!existing || existing.amount <= 0) return { ok: false, reason: 'There is no bounty on that player.' };
    const bounties = board.bounties.filter((b) => b !== existing);
    return { ok: true, board: { ...board, bounties }, amount: existing.amount };
}

/**
 * Phase 1 of a payout (issue #180): take the head off the board and record
 * the claim as pending, in ONE board write. From that write on, no other claim
 * can collect this pool, whether or not the credit that follows succeeds.
 */
export function reserveBountyClaim(
    board: BountyBoard,
    targetName: string,
    claim: { id: string; winner: string; at: number; battleId?: string },
): { ok: true; board: BountyBoard; pending: PendingBountyClaim } | { ok: false } {
    const head = findBounty(board, targetName);
    if (!head || head.amount <= 0) return { ok: false };
    const pending: PendingBountyClaim = {
        id: claim.id,
        winner: claim.winner,
        head: { ...head, contributors: [...head.contributors] },
        at: claim.at,
        ...(claim.battleId ? { battleId: claim.battleId } : {}),
    };
    return {
        ok: true,
        pending,
        board: {
            ...board,
            bounties: board.bounties.filter((b) => b !== head),
            pendingClaims: [...(board.pendingClaims ?? []).filter((p) => p.id !== claim.id), pending],
        },
    };
}

export function findPendingBountyClaim(board: BountyBoard, id: string): PendingBountyClaim | undefined {
    return (board.pendingClaims ?? []).find((p) => p.id === id);
}

/** Phase 3: the winner is paid, so the claim leaves the board. */
export function finishBountyClaim(board: BountyBoard, id: string): BountyBoard {
    const pendingClaims = (board.pendingClaims ?? []).filter((p) => p.id !== id);
    const { pendingClaims: _dropped, ...rest } = board;
    return pendingClaims.length > 0 ? { ...rest, pendingClaims } : rest;
}

/**
 * A reserved claim that can never pay (its winner's save is gone) puts the
 * pool back. A head posted on the same target since then is merged, keeping
 * the NEWER stamp so a delayed claim cannot use the restore to reach money
 * staked after its battle.
 */
export function restoreBountyClaim(board: BountyBoard, id: string): BountyBoard {
    const pending = findPendingBountyClaim(board, id);
    if (!pending) return board;
    const withoutClaim = finishBountyClaim(board, id);
    const current = findBounty(withoutClaim, pending.head.target);
    if (current) {
        return {
            ...withoutClaim,
            bounties: withoutClaim.bounties.map((b) => b === current
                ? {
                    ...b,
                    amount: b.amount + pending.head.amount,
                    contributors: Array.from(new Set([...b.contributors, ...pending.head.contributors])),
                    updatedAt: Math.max(b.updatedAt, pending.head.updatedAt),
                }
                : b),
        };
    }
    return { ...withoutClaim, bounties: [...withoutClaim.bounties, { ...pending.head }] };
}

// NOTE: there is deliberately no AI-hunter claim helper. A server-spawned bounty
// hunter beating the target does NOT remove the bounty — only a real player
// winning a verified duel (claimBounty above, gated on a real PvpSession) can.
// Removing that path closed the self-clear exploit; do not re-add it.
