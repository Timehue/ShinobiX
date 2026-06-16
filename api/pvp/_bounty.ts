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
export type BountyBoard = { bounties: Bounty[] };

function lower(s: string): string {
    return String(s ?? '').trim().toLowerCase();
}

export function emptyBoard(): BountyBoard {
    return { bounties: [] };
}

/** Normalize/repair a stored board (defensive — KV could hold a malformed blob). */
export function normalizeBoard(raw: unknown): BountyBoard {
    const list = (raw && typeof raw === 'object' && Array.isArray((raw as BountyBoard).bounties))
        ? (raw as BountyBoard).bounties
        : [];
    const bounties = list
        .filter((b): b is Bounty => !!b && typeof b === 'object' && typeof b.target === 'string')
        .map((b) => ({
            target: b.target,
            amount: Math.max(0, Math.floor(Number(b.amount) || 0)),
            contributors: Array.isArray(b.contributors) ? Array.from(new Set(b.contributors.map(lower).filter(Boolean))) : [],
            updatedAt: Math.floor(Number(b.updatedAt) || 0),
        }))
        .filter((b) => b.amount > 0)
        .slice(0, BOUNTY_BOARD_MAX);
    return { bounties };
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

    const placerSlug = lower(placerName);
    let bounties: Bounty[];
    if (existing) {
        bounties = board.bounties.map((b) => b === existing
            ? { ...b, amount: b.amount + amount, contributors: Array.from(new Set([...b.contributors, placerSlug])), updatedAt: now }
            : b);
    } else {
        bounties = [...board.bounties, { target: targetName, amount, contributors: [placerSlug], updatedAt: now }];
    }
    return { ok: true, board: { bounties }, amount };
}

export type ClaimResult = { ok: false; reason: string } | { ok: true; board: BountyBoard; amount: number };

/**
 * Remove the target's bounty from the board and return the pool to pay the
 * claimer. The endpoint verifies (against the PvpSession) that `claimerName`
 * really beat `targetName`, and that they don't share an IP/device, BEFORE
 * calling this — this just does the board math + payout amount.
 */
export function claimBounty(board: BountyBoard, targetName: string): ClaimResult {
    const existing = findBounty(board, targetName);
    if (!existing || existing.amount <= 0) return { ok: false, reason: 'There is no bounty on that player.' };
    const bounties = board.bounties.filter((b) => b !== existing);
    return { ok: true, board: { bounties }, amount: existing.amount };
}
