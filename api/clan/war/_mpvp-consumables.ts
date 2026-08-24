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
import { withKvLock } from '../../_lock.js';
import { safeName } from '../../_utils.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from '../../_settlement-receipts.js';
import { bumpSaveVersion } from '../../save/_save-version.js';
import { writeSaveProjected } from '../../save/_projected-write.js';
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
 */
export async function settleClanWar2v2Consumables(match: StoredTowerPvpMatch): Promise<void> {
    if (!match.sealedItemCharges) return;
    const requestId = `cw2v2_items_${match.matchId}`;
    const fingerprint = `clan-war-2v2-consumables:${match.matchId}`;

    for (const member of match.roster) {
        const slug = safeName(member.slug);
        const used = clanWar2v2ItemsUsed(match, slug);
        if (!slug || Object.keys(used).length === 0) continue;
        const saveKey = `save:${slug}`;
        await withKvLock(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const character = record?.character as Record<string, unknown> | undefined;
            if (!record || !character) return;
            const inspection = inspectSettlementReceipt(character, requestId, fingerprint);
            // A conflict means this request id was used for something else; do
            // not guess, and never double-charge on a replay.
            if (inspection.status !== 'fresh') return;
            const stamped = appendSettlementReceipt(
                deductUsedItems(character, used),
                inspection.receipts,
                { requestId, fingerprint, value: { kind: 'clan-war-2v2-consumables', matchId: match.matchId, used }, settledAt: Date.now() },
            );
            const next = bumpSaveVersion<Record<string, unknown>>({ ...record, character: stamped });
            await writeSaveProjected(saveKey, next, record);
        }, { failClosed: true });
    }
}
