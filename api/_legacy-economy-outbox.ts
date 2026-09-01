/*
 * Crash-recoverable bridge from committed economy transactions to Legacy.
 *
 * A treasury donation moves two authoritative rows before Legacy can take its
 * own lock. Retrying the HTTP request would donate twice, so a 503 is not a
 * safe recovery mechanism. Instead the donation queues this intent BEFORE its
 * debit is allowed to commit. Delivery only trusts the economy transaction
 * after it reaches `complete`, and daily login helps any retained intents
 * forward. The Legacy receipt makes the final write/delete window exact-once.
 */
import { economyTxKey, type EconomyTxRecord } from './_economy-tx.js';
import {
    bumpLegacyStats,
    legacyEnabled,
    type LegacyStatDeltas,
} from './_legacy-track.js';
import { withKvLock } from './_lock.js';
import { kv } from './_storage.js';

type LegacyEconomyIntent = {
    version: 1;
    txId: string;
    deltas: LegacyStatDeltas;
    queuedAt: number;
};

const OUTBOX_TTL_SECONDS = 90 * 24 * 60 * 60;
const OUTBOX_CAP = 80;
const outboxKey = (playerName: string) => `legacy:economy-outbox:${playerName}`;

function cleanIntents(value: unknown): LegacyEconomyIntent[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is LegacyEconomyIntent => Boolean(
        entry
        && typeof entry === 'object'
        && (entry as LegacyEconomyIntent).version === 1
        && typeof (entry as LegacyEconomyIntent).txId === 'string'
        && (entry as LegacyEconomyIntent).deltas
        && typeof (entry as LegacyEconomyIntent).deltas === 'object',
    ));
}

export async function queueEconomyLegacyIntent(
    playerName: string,
    txId: string,
    deltas: LegacyStatDeltas,
): Promise<void> {
    if (!legacyEnabled()) return;
    const key = outboxKey(playerName);
    await withKvLock(key, async () => {
        const current = cleanIntents(await kv.get(key));
        if (current.some((entry) => entry.txId === txId)) return;
        if (current.length >= OUTBOX_CAP) throw new Error('legacy-economy-outbox-full');
        await kv.set(key, [
            ...current,
            { version: 1, txId, deltas, queuedAt: Date.now() } satisfies LegacyEconomyIntent,
        ], { ex: OUTBOX_TTL_SECONDS });
    }, { failClosed: true });
}

async function removeIntent(playerName: string, txId: string): Promise<void> {
    const key = outboxKey(playerName);
    await withKvLock(key, async () => {
        const remaining = cleanIntents(await kv.get(key)).filter((entry) => entry.txId !== txId);
        if (remaining.length > 0) await kv.set(key, remaining, { ex: OUTBOX_TTL_SECONDS });
        else await kv.del(key);
    }, { failClosed: true });
}

export async function deliverEconomyLegacyIntent(playerName: string, txId: string): Promise<boolean> {
    if (!legacyEnabled()) return true;
    const intents = cleanIntents(await kv.get(outboxKey(playerName)));
    const intent = intents.find((entry) => entry.txId === txId);
    if (!intent) return true;
    const transaction = await kv.get<EconomyTxRecord>(economyTxKey(txId));
    if (transaction?.state !== 'complete') return false;
    const delivered = await bumpLegacyStats(playerName, intent.deltas, {
        receiptId: `economy:${txId}`,
    });
    if (!delivered) return false;
    await removeIntent(playerName, txId);
    return true;
}

export async function deliverPendingEconomyLegacyIntents(playerName: string): Promise<number> {
    if (!legacyEnabled()) return 0;
    const intents = cleanIntents(await kv.get(outboxKey(playerName)));
    let delivered = 0;
    for (const intent of intents) {
        try {
            if (await deliverEconomyLegacyIntent(playerName, intent.txId)) delivered += 1;
        } catch (error) {
            console.error('[legacy-economy-outbox] delivery failed:', error);
        }
    }
    return delivered;
}
