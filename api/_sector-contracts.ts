/*
 * Sector Contracts — the server-owned half.
 *
 * The contract itself (which sectors are posted, what they ask, what they pay)
 * is pure and deterministic in `shared/sector-contracts.ts`, so client and
 * server agree on it without a round trip and a client cannot choose its own.
 * What lives here is the part a client could otherwise lie about: how much work
 * it has actually done, and whether it has already been paid.
 *
 * Progress is credited from the explore receipt (api/world/explore.ts), the
 * same hook `creditSectorIntel` uses, and for the same reason: the server sees
 * the explore land, so it never has to take the client's word for one. The
 * credit is best-effort — a storage blip must never fail the explore that
 * earned it.
 *
 * Storage, per player per sector per day:
 *   world:contract:<player>:<sector>:<day>        numeric progress (legacy compatible)
 *   world:contract-receipts:<player>:<sector>:<day> credited explore ids
 *   world:contract-claim:<player>:<sector>:<day>  claim timestamp, set once
 * Claims carry a 2-day TTL; progress and receipt ids live 4 days to outlast
 * delivery retries. Numeric progress rows remain readable. These are KV
 * rows in the same namespace as `world:footfall:` and `world:sector-pool:`.
 *
 * Payment is recomputed from the SEALED (sector, day) at claim time — never
 * from the request body — and the whole check-then-pay runs inside the player's
 * own `save:<name>` lock with `failClosed`, so two racing claims cannot both
 * win one bounty. That is the same shape api/sector/wanderer-gift.ts uses.
 */

import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { isPlayableWildSector } from '../shared/sector-geo.js';
import { contractAcceptsWorkAt, sectorContractFor, utcDayOf, type SectorContract } from '../shared/sector-contracts.js';
import { sectorContractsEnabled } from './_release-flags.js';

export const CONTRACT_PROGRESS_KEY_PREFIX = 'world:contract:';
export const CONTRACT_CLAIM_KEY_PREFIX = 'world:contract-claim:';
/** Rows outlive the day they count, so a reader just past midnight still sees yesterday. */
export const CONTRACT_TTL_SECONDS = 2 * 24 * 60 * 60;
// Delivery outboxes live three days. Keep deduplication beyond that horizon.
const CONTRACT_PROGRESS_TTL_SECONDS = 4 * 24 * 60 * 60;

function contractProgress(raw: unknown): { progress: number; receipts: string[] } {
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    return {
        progress: Math.max(0, Math.floor(Number(row?.version === 1 ? row.progress : raw) || 0)),
        receipts: row?.version === 1 && Array.isArray(row.receipts)
            ? row.receipts.filter((id): id is string => typeof id === 'string') : [],
    };
}

export function contractProgressKey(playerName: string, sector: number, day: string): string {
    return `${CONTRACT_PROGRESS_KEY_PREFIX}${playerName}:${Math.floor(sector)}:${day}`;
}

export function contractClaimKey(playerName: string, sector: number, day: string): string {
    return `${CONTRACT_CLAIM_KEY_PREFIX}${playerName}:${Math.floor(sector)}:${day}`;
}

export function contractReceiptKey(playerName: string, sector: number, day: string): string {
    return `world:contract-receipts:${playerName}:${Math.floor(sector)}:${day}`;
}

export type SectorContractStatus = {
    contract: SectorContract | null;
    /** Explores this player has landed in this sector today. */
    progress: number;
    claimed: boolean;
    /** Progress meets the target and nothing has been paid yet. */
    claimable: boolean;
    /** Would work landing right now count? False on a night contract in daylight. */
    acceptingWork: boolean;
};

export const NO_CONTRACT: SectorContractStatus =
    Object.freeze({ contract: null, progress: 0, claimed: false, claimable: false, acceptingWork: false });

/** Fold raw storage into a status. Pure — the decision the route and the tests share. */
export function sectorContractStatus(
    contract: SectorContract | null,
    progress: unknown,
    claimedAt: unknown,
    now: number = Date.now(),
): SectorContractStatus {
    if (!contract) return NO_CONTRACT;
    const done = contractProgress(progress).progress;
    const claimed = Math.floor(Number(claimedAt) || 0) > 0;
    return {
        contract,
        progress: done,
        claimed,
        // Deliberately NOT gated on the phase: work already banked stays
        // claimable at any hour. The night window is a condition on EARNING
        // progress, not a window you must be awake inside to collect.
        claimable: !claimed && done >= contract.target,
        acceptingWork: contractAcceptsWorkAt(contract, now),
    };
}

/**
 * One explore's worth of contract progress.
 *
 * Called after the explore reward settles. The outbox opts into errors so
 * failed delivery remains retryable. Returns the status it can see, or null when there is
 * no contract on this sector today.
 */
export async function creditSectorContractProgress(
    playerName: string,
    sector: number,
    now: number = Date.now(),
    opts: { failLoudly?: boolean; requestId?: string } = {},
): Promise<SectorContractStatus | null> {
    if (!sectorContractsEnabled()) return null;
    const id = Math.floor(Number(sector));
    const name = String(playerName ?? '').trim();
    if (!name || !isPlayableWildSector(id)) return null;
    const day = utcDayOf(now);
    const contract = sectorContractFor(id, day);
    if (!contract) return null;
    // The gate the SERVER enforces, on the server's own clock. A night contract
    // simply does not tick in daylight: the work still happens and still pays
    // its ordinary explore reward, it just does not count toward this posting.
    if (!contractAcceptsWorkAt(contract, now)) {
        return readSectorContractStatus(name, id, now);
    }
    try {
        const key = contractProgressKey(name, id, day);
        // Count and proof share one fenced transaction. A lost acknowledgment,
        // failed outbox removal, or concurrent drain can only replay this id.
        // Keep the public counter numeric: old workers can still increment it
        // during a rolling deployment. CAS retries include their intervening work.
        const progress = await withKvLock(key, async () => {
            if (!kv.compareSetMany) throw new Error('Contract delivery requires atomic receipt storage.');
            const proofKey = contractReceiptKey(name, id, day);
            for (let attempt = 0; attempt < 5; attempt++) {
                const [raw, proof] = await kv.mget(key, proofKey);
                const prior = contractProgress(raw);
                const receipts = [...new Set([...prior.receipts,
                    ...(Array.isArray(proof) ? proof.filter((entry): entry is string => typeof entry === 'string') : [])])];
                if (opts.requestId && receipts.includes(opts.requestId)) return prior.progress;
                const next = prior.progress + 1;
                if (opts.requestId) receipts.push(opts.requestId);
                const committed = await kv.compareSetMany([
                    { op: 'cas', key, expected: raw ?? null, value: next, ex: CONTRACT_PROGRESS_TTL_SECONDS },
                    { op: 'cas', key: proofKey, expected: proof ?? null, value: receipts, ex: CONTRACT_PROGRESS_TTL_SECONDS },
                ]);
                if (committed) return next;
            }
            throw new Error('Contract progress changed during delivery; retry required.');
        }, { failClosed: true });
        const claimedAt = await kv.get<number>(contractClaimKey(name, id, day));
        return sectorContractStatus(contract, progress, claimedAt, now);
    } catch (error) {
        // The explore outbox (api/world/_effects-outbox.ts) needs to SEE a
        // failed tick so it can park and retry it; every other caller keeps the
        // quiet null.
        if (opts.failLoudly) throw error;
        return null;
    }
}

/** Read-only status for the sector panel. Never writes, never throws. */
export async function readSectorContractStatus(
    playerName: string,
    sector: number,
    now: number = Date.now(),
): Promise<SectorContractStatus> {
    if (!sectorContractsEnabled()) return NO_CONTRACT;
    const id = Math.floor(Number(sector));
    const name = String(playerName ?? '').trim();
    if (!name || !isPlayableWildSector(id)) return NO_CONTRACT;
    const day = utcDayOf(now);
    const contract = sectorContractFor(id, day);
    if (!contract) return NO_CONTRACT;
    try {
        const [progress, claimedAt] = await Promise.all([
            kv.get<unknown>(contractProgressKey(name, id, day)),
            kv.get<number>(contractClaimKey(name, id, day)),
        ]);
        return sectorContractStatus(contract, progress, claimedAt, now);
    } catch {
        return sectorContractStatus(contract, 0, 0, now);
    }
}
