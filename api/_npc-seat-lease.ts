/**
 * A cross-process lease for one NPC seat (2026-11-11).
 *
 * Each NPC seat keeps a per-process "already driving this duel" guard, but
 * during a Railway deploy overlap two processes run the same sweeps, and both
 * could act for the same NPC in the same duel (two moves from one board, two
 * joins). The war card seat and the village-war campaign card seat already
 * hold a short KV lease per duel; this is the same lease, shared by the
 * shinobi duel seat (api/_npc-duel-driver.ts) and the clan-war card seat
 * (api/_npc-clan-war-campaign.ts).
 *
 * Callers decide from ONE read of the duel whether there is anything to do
 * before taking it, so an idle sweep writes nothing. A drive renews the lease
 * (`keep()`) every NPC_SEAT_LEASE_RENEW_MS it holds it, and a crashed holder's
 * lease lapses in NPC_SEAT_LEASE_TTL_SEC, well inside any turn clock.
 */
import { kv } from './_storage.js';

export const NPC_SEAT_LEASE_TTL_SEC = 30;
export const NPC_SEAT_LEASE_RENEW_MS = 10_000;

export type NpcSeatLease = {
    /** Renews the lease when it is due; false once another process holds it (stop acting). */
    keep(): Promise<boolean>;
};

const processOwner = `npc-seat:${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
let ownerForTest: string | null = null;
/** Tests stand in a second "process" (null restores this one). */
export function setNpcSeatLeaseOwnerForTest(owner: string | null): void { ownerForTest = owner; }
function owner(): string { return ownerForTest ?? processOwner; }

/**
 * Runs `run` holding the lease at `key`, or returns `idle` without running it
 * when another process holds it. The lease is released after the run (only if
 * still ours).
 */
export async function withNpcSeatLease<T>(key: string, idle: T, run: (lease: NpcSeatLease) => Promise<T>): Promise<T> {
    const me = owner();
    const taken = await kv.set(key, me, { nx: true, ex: NPC_SEAT_LEASE_TTL_SEC }).catch(() => null);
    if (taken !== 'OK' && await kv.get(key).catch(() => null) !== me) return idle;
    let heldSince = Date.now();
    const lease: NpcSeatLease = {
        async keep() {
            if (Date.now() - heldSince < NPC_SEAT_LEASE_RENEW_MS) return true;
            const kept = await kv.compareSet(key, me, me, { ex: NPC_SEAT_LEASE_TTL_SEC }).catch(() => false);
            if (kept) heldSince = Date.now();
            return kept;
        },
    };
    try { return await run(lease); }
    finally { await kv.delIfEqual(key, me).catch(() => undefined); }
}
