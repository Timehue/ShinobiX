/*
 * One gear step drop for one player, tied to one source event (a tower run, a
 * clan boss assault). Used where the source settles outside a single save write,
 * so the drop needs its own once only receipt.
 *
 * The hit is decided from the event id alone, so every retry gives the same
 * answer. The receipt commits in the same save write as the item, so a retry
 * after a lost write grants it once.
 */
import { createHash } from 'node:crypto';
import { safeName } from './_utils.js';
import { mutatePlayerSave } from './save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict, retryOnSaveVersionConflict } from './save/_projected-write.js';
import { LockContendedError } from './_lock.js';
import { appendSettlementReceipt, inspectSettlementReceipt, SERVER_SETTLEMENT_RECEIPT_LIMIT } from './_settlement-receipts.js';
import { receiptAbsenceProvable } from './_save-debit-saga.js';
import { gearRoll, pickGearDrop } from './_gear-drops.js';

/** True when the event id lands inside `chanceBp` basis points. Deterministic. */
export function gearDropHit(eventId: string, chanceBp: number): boolean {
    return gearRoll(eventId) < chanceBp / 10_000;
}

/** A busy save can lose the lock or the write race; try a few times before giving up. */
const MAX_ATTEMPTS = 5;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function settleGearDropForPlayer(input: {
    playerName: string;
    eventId: string;
    chanceBp: number;
    /** When the event began. A receipt can only have been written after this, which is what lets a missing receipt prove "never paid". */
    notBefore: number;
}, backoffMs = 60): Promise<{ itemId?: string }> {
    const slug = safeName(input.playerName);
    if (!slug || !gearDropHit(input.eventId, input.chanceBp)) return {};
    // Safe to repeat: the hit is fixed by the event id and the receipt commits with the item.
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await settleOnce(slug, input.eventId, input.notBefore);
        } catch (error) {
            const busy = error instanceof LockContendedError || isPlayerSaveVersionConflict(error);
            if (!busy || attempt >= MAX_ATTEMPTS) throw error;
            await pause(backoffMs * attempt + Math.floor(Math.random() * backoffMs));
        }
    }
}

async function settleOnce(slug: string, eventId: string, notBefore: number): Promise<{ itemId?: string }> {
    const requestId = `geardrop_${createHash('sha256').update(eventId).digest('hex').slice(0, 32)}`;
    const fingerprint = `gear-drop:${eventId}`;
    const out = await retryOnSaveVersionConflict(() => mutatePlayerSave<{ itemId?: string }>(slug, ({ character }) => {
        const unwritten = { ok: true as const, write: false, character, value: {} as { itemId?: string } };
        const inspected = inspectSettlementReceipt(character, requestId, fingerprint);
        if (inspected.status !== 'fresh') return unwritten;
        // The receipt list keeps only the newest 50. Once this event's receipt could have
        // rolled off, "no receipt" no longer proves "not paid", so a replay must not pay again.
        if (!receiptAbsenceProvable(inspected.receipts, SERVER_SETTLEMENT_RECEIPT_LIMIT, 'settledAt', notBefore)) return unwritten;
        const itemId = pickGearDrop(character);
        if (!itemId) return unwritten;
        const inventory = Array.isArray(character.inventory) ? [...(character.inventory as string[]), itemId] : [itemId];
        return {
            ok: true as const,
            character: appendSettlementReceipt({ ...character, inventory }, inspected.receipts, {
                requestId, fingerprint, value: { itemId }, settledAt: Date.now(),
            }),
            value: { itemId },
        };
    }));
    return out.ok ? out.value : {};
}
