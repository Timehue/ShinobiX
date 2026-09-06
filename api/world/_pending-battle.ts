import { kv } from '../_storage.js';
import {
    EXPLORE_BATTLE_AUTHORITY_TTL_MS,
    exploreBattleMarkerKey,
} from '../missions/_generic-ai-fight-authority.js';

/*
 * F07 — an ambush is an obligation, not an offer.
 *
 * Exploring can roll a BATTLE. The discovery is committed (an in-save receipt
 * with `outcome.kind === 'battle'`, plus a durable KV copy) and the client then
 * starts the fight through /api/missions/ai-fight-start, which claims the
 * one-use marker `world-ai-explore-fight:<player>:<receiptId>`. Nothing used to
 * connect the two: a player who closed the tab (or moved to another device,
 * where the browser outbox that would have replayed the start is empty) could
 * simply explore again and roll a fresh, kinder result.
 *
 * The newest battle receipt inside the fight-start authority window whose
 * marker has never been claimed is a pending encounter. A new ordinary
 * exploration is refused with `pending-battle-discovery` naming it, and the
 * client resumes that exact encounter. Only the NEWEST receipt is considered:
 * an older unstarted one can only exist from before this rule, and blocking on
 * it would bind a player to something the game once let them walk past.
 */

export type PendingExploreBattle = { requestId: string; sector: number; at: number };

export type PendingBattleDeps = {
    get?: (key: string) => Promise<unknown>;
};

function newestBattleReceipt(receipts: readonly unknown[], now: number): PendingExploreBattle | null {
    for (let index = receipts.length - 1; index >= 0; index -= 1) {
        const entry = receipts[index];
        if (!entry || typeof entry !== 'object') continue;
        const receipt = entry as Record<string, unknown>;
        const outcome = receipt.outcome;
        if (!outcome || typeof outcome !== 'object' || (outcome as Record<string, unknown>).kind !== 'battle') continue;
        const requestId = typeof receipt.id === 'string' ? receipt.id : '';
        const sector = Math.floor(Number(receipt.sector));
        const at = Math.floor(Number(receipt.at));
        if (!requestId || !Number.isSafeInteger(sector) || sector < 1 || !Number.isSafeInteger(at) || at <= 0) continue;
        if (now - at > EXPLORE_BATTLE_AUTHORITY_TTL_MS) return null;
        return { requestId, sector, at };
    }
    return null;
}

/**
 * The player's unresolved ambush, or null. One KV read at most, and only when
 * a recent battle receipt exists.
 */
export async function unresolvedExploreBattle(
    playerName: string,
    receipts: readonly unknown[],
    now: number = Date.now(),
    deps: PendingBattleDeps = {},
): Promise<PendingExploreBattle | null> {
    const newest = newestBattleReceipt(receipts, now);
    if (!newest) return null;
    const get = deps.get ?? ((key: string) => kv.get(key));
    const marker = await get(exploreBattleMarkerKey(playerName, newest.requestId));
    return marker ? null : newest;
}
