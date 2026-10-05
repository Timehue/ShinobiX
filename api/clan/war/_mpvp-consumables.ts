/*
 * Clan War 2v2 — consumable settlement.
 *
 * A consumable must cost the same here as in 1v1 PvP. The Tower engine spends
 * from each actor's sealed charge budget during the fight, but spending an
 * in-memory counter is not spending an item: without this, a clan-war duel
 * would hand out FREE potions and be strictly better than the 1v1 it is scored
 * beside.
 *
 * Mirrors api/pvp/_consumable-settlement.ts in intent and reuses its exact
 * `deductUsedItems` removal, keyed by a durable per-match save receipt so the
 * charge is taken exactly once no matter how many members settle or retry.
 */
import { kv } from '../../_storage.js';
import { safeName } from '../../_utils.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from '../../_settlement-receipts.js';
import { mutatePlayerSave } from '../../save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from '../../save/_projected-write.js';
import { deductUsedItems } from '../../pvp/_consumable-settlement.js';
import type { StoredTowerPvpMatch } from '../../towers/_pvp-session.js';

/**
 * Spent = sealed − whatever the fighter's actor still holds. Never negative, so
 * a corrupted or absent remainder can only under-charge, never invent a debt.
 */
export function clanWar2v2ItemsUsed(
    match: StoredTowerPvpMatch,
    slug: string,
): Record<string, number> {
    const sealed = match.sealedItemCharges?.[slug];
    if (!sealed) return {};
    const member = match.roster.find(entry => entry.slug === slug);
    const actor = member && match.combat.actors.find(entry => entry.id === member.actorId);
    const remaining = (actor?.itemCharges ?? {}) as Record<string, number>;
    const used: Record<string, number> = {};
    for (const [itemId, rawStart] of Object.entries(sealed)) {
        const start = Math.max(0, Math.floor(Number(rawStart) || 0));
        const left = Math.max(0, Math.floor(Number(remaining[itemId]) || 0));
        const spent = Math.max(0, start - left);
        if (spent > 0) used[itemId] = spent;
    }
    return used;
}

/**
 * Remove every fighter's spent consumables. Idempotent per match via a durable
 * save receipt; a partial failure leaves the remaining members' charges owed and
 * is safe to retry, because each save is stamped independently.
 *
 * Every member is attempted even when one fails (one member's busy save must not
 * leave the others' potions free), a lost commit race is retried once — the
 * closure re-reads the save — and the first failure is rethrown at the end so
 * the caller still sees it. Callers also re-run this on settlement replays, so a
 * member left owed here is charged on the next settle call.
 */
export async function settleClanWar2v2Consumables(match: StoredTowerPvpMatch): Promise<void> {
    if (!match.sealedItemCharges) return;
    let firstError: unknown = null;
    for (const member of match.roster) {
        try {
            await retryOnSaveVersionConflict(() => chargeMember(match, member.slug));
        } catch (error) {
            firstError ??= error;
        }
    }
    if (firstError) throw firstError;
}

/**
 * Durable "already charged" marker, one per member per match. The in-save
 * receipt alone is not enough on a replay: the receipt window keeps only the
 * newest entries, so a member who writes enough other receipts before a
 * teammate's late settle call would look `fresh` again and be charged twice.
 * The marker outlives the terminal match (24h), so a replay can never reach a
 * member whose charge already landed.
 */
const CHARGED_MARKER_TTL_SECONDS = 72 * 60 * 60;

export function clanWar2v2ChargedMarkerKey(matchId: string, slug: string): string {
    return `clan-war-2v2-items-charged:${matchId}:${slug}`;
}

async function chargeMember(match: StoredTowerPvpMatch, memberSlug: string): Promise<void> {
    const requestId = `cw2v2_items_${match.matchId}`;
    const fingerprint = `clan-war-2v2-consumables:${match.matchId}`;
    const slug = safeName(memberSlug);
    const used = clanWar2v2ItemsUsed(match, slug);
    if (!slug || Object.keys(used).length === 0) return;
    const markerKey = clanWar2v2ChargedMarkerKey(match.matchId, slug);
    if (await kv.get(markerKey)) return;
    // mutatePlayerSave also keeps the idle recovery the fighter earned since
    // their last save. The charge moves items, never a vital, and a member
    // whose teammate settles the match is often offline by then.
    await mutatePlayerSave(slug, async ({ character }) => {
        if (await kv.get(markerKey)) return { ok: true, value: undefined, character, write: false };
        const inspection = inspectSettlementReceipt(character, requestId, fingerprint);
        // A conflict means this request id was used for something else; do
        // not guess, and never double-charge on a replay.
        if (inspection.status === 'replay') await markCharged(markerKey);
        if (inspection.status !== 'fresh') return { ok: true, value: undefined, character, write: false };
        const stamped = appendSettlementReceipt(
            deductUsedItems(character, used),
            inspection.receipts,
            { requestId, fingerprint, value: { kind: 'clan-war-2v2-consumables', matchId: match.matchId, used }, settledAt: Date.now() },
        );
        return { ok: true, value: undefined, character: stamped, afterCommit: () => markCharged(markerKey) };
    });
}

/**
 * Best effort: the charge has already committed, and the in-save receipt
 * still guards the common case, so a failed marker write must not turn a
 * successful charge into an error (and a retry).
 */
async function markCharged(markerKey: string): Promise<void> {
    await kv.set(markerKey, 1, { ex: CHARGED_MARKER_TTL_SECONDS }).catch((error: unknown) => {
        console.warn('[clan-war 2v2] charged marker not written', error);
    });
}
