import { storedValueEquals } from '../../_stored-value.js';
import { kv, type KvLike, type KvCasOp } from '../../_storage.js';
import { clanBareSlug } from '../../_utils.js';
import { SaveDebitNeedsReconcile } from '../../_save-debit-saga.js';
import type { ClanWar } from './_storage.js';
import { CLAN_WAR_RULES } from '../../../shared/clan-war-campaign.js';

export const CLAN_DECLARATION_LOCK = 'clan-war:declarations';
export interface ClanWarReservation {
    version: 2; clan: string; warId: string; instanceId: string; transactionId: string;
    claimedAt: number; state: 'pending' | 'active' | 'released'; recoveryUntil?: number;
}
type Store = Pick<KvLike, 'get' | 'compareSetMany'>;
export function clanWarReservationKey(clan: string): string {
    const slug = clanBareSlug(clan);
    if (!slug) throw new Error('Clan reservation requires a canonical clan.');
    return `clan-war:participant:${slug}`;
}
function reservation(value: unknown): ClanWarReservation | null {
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Stored clan reservation is invalid.');
    const row = value as ClanWarReservation;
    if (row.version !== 2 || !row.clan || !row.warId || !row.instanceId || !row.transactionId
        || !Number.isSafeInteger(row.claimedAt) || row.claimedAt <= 0
        || !['pending', 'active', 'released'].includes(row.state)
        || (row.recoveryUntil !== undefined && (!Number.isSafeInteger(row.recoveryUntil) || row.recoveryUntil < 0))) {
        throw new Error('Stored clan reservation is invalid.');
    }
    return row;
}
async function atomic(store: Store, ops: KvCasOp[]): Promise<boolean> {
    if (!store.compareSetMany) throw new Error('Clan wars require atomic shared-record transactions.');
    return store.compareSetMany(ops);
}

/** Called under the global declaration lock; the two durable claims land together. */
export async function claimClanWarReservations(input: {
    clans: [string, string]; warId: string; instanceId: string; transactionId: string; now: number;
}, store: Store = kv): Promise<void> {
    if (clanBareSlug(input.clans[0]) === clanBareSlug(input.clans[1])) throw new Error('Distinct clans are required.');
    const ops: KvCasOp[] = [];
    for (const clan of input.clans) {
        const key = clanWarReservationKey(clan);
        const prior = reservation(await store.get(key));
        const same = prior?.transactionId === input.transactionId && prior.instanceId === input.instanceId && prior.warId === input.warId;
        if (same) continue;
        if (prior) {
            let available = prior.state === 'released' && (prior.recoveryUntil ?? 0) <= input.now;
            if (prior.state === 'active') {
                const war = await store.get<ClanWar>(`clan-war:${prior.warId}`);
                available = !!war?.endedAt && war.campaign?.instanceId === prior.instanceId
                    && (war.campaign.closeReason==='service' ? !!war.campaign.serviceCancellation?.feeRefundedAt
                        : war.endedAt + CLAN_WAR_RULES.recoveryMs <= input.now);
            }
            if (!available) throw new Error(`${clan} already has a war, a pending declaration, or a recovery period.`);
        }
        ops.push({ op: 'cas', key, expected: prior, value: {
            version: 2, clan, warId: input.warId, instanceId: input.instanceId,
            transactionId: input.transactionId, claimedAt: input.now, state: 'pending',
        } satisfies ClanWarReservation });
    }
    if (ops.length && !(await atomic(store, ops))) throw new Error('Clan declaration changed while reserving participants. Retry the same declaration.');
}

/** The debit saga uses this publisher; credit and both activated claims are one transaction. */
export async function publishClanWarDeclaration(key: string, next: Record<string, unknown>, store: Store = kv): Promise<void> {
    const war = next as unknown as ClanWar;
    if (!war.campaign || war.clans.length !== 2) throw new SaveDebitNeedsReconcile('Campaign declaration is invalid.');
    const current = await store.get<Record<string, unknown>>(key);
    const ops: KvCasOp[] = [{ op: 'cas', key, expected: current, value: next }];
    for (const clan of war.clans) {
        const reservationKey = clanWarReservationKey(clan);
        const held = reservation(await store.get(reservationKey));
        if (!held || held.instanceId !== war.campaign.instanceId || held.warId !== war.id || held.state === 'released') {
            throw new SaveDebitNeedsReconcile('The clan declaration needs its original participant reservations to finish.');
        }
        ops.push({ op: 'cas', key: reservationKey, expected: held, value: { ...held, state: 'active' } });
    }
    try {
        if (await atomic(store, ops)) return;
    } catch (error) {
        // A lost transaction answer cannot trigger a refund if the complete
        // credit/claims publication is already durable.
        const recovered = await store.get(key).catch(() => null);
        if (storedValueEquals(recovered, next)) return;
        throw error;
    }
    throw new Error('Clan declaration publication was contended.');
}

/** Release only a proven uncharged/refunded pending claim, never an active war. */
export async function releasePendingClanWarReservations(clans: [string, string], transactionId: string, store: Store = kv): Promise<void> {
    const ops: KvCasOp[] = [];
    for (const clan of clans) {
        const key = clanWarReservationKey(clan); const held = reservation(await store.get(key));
        if (held?.state === 'pending' && held.transactionId === transactionId) ops.push({ op: 'delete', key, expected: held });
    }
    if (ops.length && !(await atomic(store, ops))) throw new Error('Pending clan reservations changed during release.');
}

export async function releaseEndedClanWarReservations(war: ClanWar, store: Store = kv): Promise<void> {
    if (!war.campaign || !war.endedAt) return;
    const service=war.campaign.closeReason==='service';
    if(service&&!war.campaign.serviceCancellation?.feeRefundedAt)return;
    const ops: KvCasOp[] = [];
    for (const clan of war.clans) {
        const key = clanWarReservationKey(clan); const held = reservation(await store.get(key));
        if (held?.instanceId === war.campaign.instanceId && held.state !== 'released') ops.push({ op: 'cas', key, expected: held,
            value: { ...held, state: 'released', recoveryUntil: service?0:war.endedAt + CLAN_WAR_RULES.recoveryMs } });
    }
    if (ops.length && !(await atomic(store, ops))) throw new Error('Clan recovery publication changed.');
}
