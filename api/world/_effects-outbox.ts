import { safeLogValue } from '../_safe-log.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import { creditSectorIntel, INTEL_PER_EXPLORE } from '../_village-intel.js';
import { creditSectorContractProgress } from '../_sector-contracts.js';
import type { SectorPoolOwner } from './_sector-pool.js';
import { cleanWorldExploreAuthorityReceipt, worldExploreAuthorityKey } from './_explore-authority.js';

/*
 * F17 — durable delivery of the gameplay side effects an exploration owes.
 *
 * An exploration pays its reward inside the save mutation and then credits two
 * things OUTSIDE it: the village's sector intel and the player's sector
 * contract progress. Both ran best-effort with `.catch(() => undefined)`, so a
 * storage blip on either silently lost progress the player had earned, with
 * nothing to retry it — the exploration itself was committed and replaying it
 * never re-credits (a replay must not tick twice).
 *
 * The effect is now an OBLIGATION: it is attempted immediately, and on failure
 * it is parked in the player's outbox, keyed by (kind, requestId) so the same
 * effect can never be listed twice. The outbox drains at the start of the
 * player's next exploration. Contract delivery deduplicates the discovery id
 * atomically with progress and uses the original event time. Intel delivery
 * remains at-least-once; a lost removal can still repeat that separate effect.
 */

export type WorldEffect =
    | { kind: 'intel'; requestId: string; village?: string; sector: number }
    | { kind: 'contract'; requestId: string; sector: number; at?: number };

export const WORLD_EFFECTS_OUTBOX_CAP = 20;
export const WORLD_EFFECTS_OUTBOX_TTL_SEC = 3 * 24 * 60 * 60;
const DRAIN_BATCH = 8;
class MissingContractDiscoveryTimeError extends Error {}

export function worldEffectsOutboxKey(playerName: string): string {
    return `world-effects:${safeName(playerName)}`;
}

function sameEffect(a: WorldEffect, b: WorldEffect): boolean {
    return a.kind === b.kind && a.requestId === b.requestId;
}

function cleanEffect(raw: unknown): WorldEffect | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Record<string, unknown>;
    const requestId = typeof value.requestId === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(value.requestId) ? value.requestId : '';
    const sector = Math.floor(Number(value.sector));
    if (!requestId || !Number.isSafeInteger(sector) || sector < 1) return null;
    if (value.kind === 'intel') {
        const village = typeof value.village === 'string' && value.village.trim() ? value.village.trim() : undefined;
        return { kind: 'intel', requestId, sector, ...(village ? { village } : {}) };
    }
    if (value.kind === 'contract') {
        const at = Math.floor(Number(value.at));
        return { kind: 'contract', requestId, sector, ...(Number.isSafeInteger(at) && at > 0 ? { at } : {}) };
    }
    return null;
}

export function parseWorldEffects(raw: unknown): WorldEffect[] {
    return Array.isArray(raw) ? raw.map(cleanEffect).filter((effect): effect is WorldEffect => effect !== null) : [];
}

export type WorldEffectDeps = {
    now?: number;
    /** The already-read owner village for this request; the drain passes none and lets the credit read it. */
    owner?: SectorPoolOwner;
};

/** Apply one effect. Throws on infrastructure failure so the caller can park it. */
export async function applyWorldEffect(playerName: string, effect: WorldEffect, deps: WorldEffectDeps = {}): Promise<void> {
    const now = deps.now ?? Date.now();
    if (effect.kind === 'intel') {
        await creditSectorIntel(effect.village, effect.sector, INTEL_PER_EXPLORE, now, deps.owner);
        return;
    }
    let at = effect.at;
    // Older outboxes did not seal event time. Recover it from the exact
    // discovery rather than crediting a different day's or daylight's posting.
    if (!at) {
        const authority = cleanWorldExploreAuthorityReceipt(await kv.get(worldExploreAuthorityKey(playerName, effect.requestId)));
        if (authority?.sector === effect.sector) at = authority.at;
        else {
            const save = await kv.get<{ character?: { redeemedSectorExplorations?: Array<Record<string, unknown>> } }>(`save:${safeName(playerName)}`);
            const receipt = save?.character?.redeemedSectorExplorations?.find(row => row.id === effect.requestId && row.sector === effect.sector);
            at = Number(receipt?.at);
        }
    }
    if (!Number.isSafeInteger(at) || !at || at <= 0) throw new MissingContractDiscoveryTimeError('Contract effect is missing its discovery time.');
    // Explore receipts outlive the delivery outbox. Do not recreate expired
    // progress after its deduplication proof has legitimately aged out.
    if (now - at >= WORLD_EFFECTS_OUTBOX_TTL_SEC * 1000) return;
    await creditSectorContractProgress(playerName, effect.sector, at, { failLoudly: true, requestId: effect.requestId });
}

export async function parkWorldEffect(playerName: string, effect: WorldEffect): Promise<void> {
    const key = worldEffectsOutboxKey(playerName);
    await withKvLock(key, async () => {
        const current = parseWorldEffects(await kv.get(key));
        if (current.some((entry) => sameEffect(entry, effect))) return;
        await kv.set(key, [...current, effect].slice(-WORLD_EFFECTS_OUTBOX_CAP), { ex: WORLD_EFFECTS_OUTBOX_TTL_SEC });
    }, { failClosed: true });
}

async function removeWorldEffect(playerName: string, effect: WorldEffect): Promise<void> {
    const key = worldEffectsOutboxKey(playerName);
    await withKvLock(key, async () => {
        const current = parseWorldEffects(await kv.get(key));
        const remaining = current.filter((entry) => !sameEffect(entry, effect));
        if (remaining.length === current.length) return;
        if (remaining.length === 0) await kv.del(key);
        else await kv.set(key, remaining, { ex: WORLD_EFFECTS_OUTBOX_TTL_SEC });
    }, { failClosed: true });
}

/**
 * Attempt the effect now; park it if the attempt fails. Never throws — the
 * exploration that owes it has already committed and must still answer.
 */
export async function deliverWorldEffect(playerName: string, effect: WorldEffect, deps: WorldEffectDeps = {}): Promise<'applied' | 'parked' | 'lost'> {
    try {
        await applyWorldEffect(playerName, effect, deps);
        return 'applied';
    } catch (error) {
        console.error('[world/effects] delivery failed; parking', safeLogValue({ kind: effect.kind, requestId: effect.requestId, error }));
        try {
            await parkWorldEffect(playerName, effect);
            return 'parked';
        } catch (parkError) {
            console.error('[world/effects] could not park', safeLogValue(parkError));
            return 'lost';
        }
    }
}

/**
 * Deliver what the outbox still owes, oldest first, stopping at the first
 * infrastructure failure. Unresolvable legacy timestamps remain stored but
 * do not block later valid effects. Returns deliveries completed. Never throws.
 */
export async function drainWorldEffects(playerName: string, deps: WorldEffectDeps = {}): Promise<number> {
    let delivered = 0;
    try {
        const pending = parseWorldEffects(await kv.get(worldEffectsOutboxKey(playerName)));
        for (const effect of pending) {
            if (delivered >= DRAIN_BATCH) break;
            try {
                await applyWorldEffect(playerName, effect, deps);
            } catch (error) {
                // Keep the unresolved legacy evidence, but do not strand later
                // valid work behind it. Storage failures still pause the drain.
                if (error instanceof MissingContractDiscoveryTimeError) continue;
                break;
            }
            await removeWorldEffect(playerName, effect);
            delivered += 1;
        }
    } catch (error) {
        console.error('[world/effects] drain failed', safeLogValue(error));
    }
    return delivered;
}
