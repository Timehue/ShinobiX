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
 * Storage, two keys per player per sector per day:
 *   world:contract:<player>:<sector>:<day>        integer, kv.incr on the hot path
 *   world:contract-claim:<player>:<sector>:<day>  claim timestamp, set once
 * Both carry a 2-day TTL so a just-past-midnight reader still sees yesterday
 * and nothing accumulates. Neither is a schema change: they are ordinary KV
 * rows in the same namespace as `world:footfall:` and `world:sector-pool:`.
 *
 * Payment is recomputed from the SEALED (sector, day) at claim time — never
 * from the request body — and the whole check-then-pay runs inside the player's
 * own `save:<name>` lock with `failClosed`, so two racing claims cannot both
 * win one bounty. That is the same shape api/sector/wanderer-gift.ts uses.
 */

import { kv } from './_storage.js';
import { isWildSector } from '../shared/sector-geo.js';
import { contractAcceptsWorkAt, sectorContractFor, utcDayOf, type SectorContract } from '../shared/sector-contracts.js';
import { sectorContractsEnabled } from './_release-flags.js';

export const CONTRACT_PROGRESS_KEY_PREFIX = 'world:contract:';
export const CONTRACT_CLAIM_KEY_PREFIX = 'world:contract-claim:';
/** Rows outlive the day they count, so a reader just past midnight still sees yesterday. */
export const CONTRACT_TTL_SECONDS = 2 * 24 * 60 * 60;

export function contractProgressKey(playerName: string, sector: number, day: string): string {
    return `${CONTRACT_PROGRESS_KEY_PREFIX}${playerName}:${Math.floor(sector)}:${day}`;
}

export function contractClaimKey(playerName: string, sector: number, day: string): string {
    return `${CONTRACT_CLAIM_KEY_PREFIX}${playerName}:${Math.floor(sector)}:${day}`;
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
    const done = Math.max(0, Math.floor(Number(progress) || 0));
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
 * Best-effort and silent: it is called from the explore receipt after the
 * reward has already been settled, so a failure here must cost the player
 * nothing but the tick. Returns the status it can see, or null when there is
 * no contract on this sector today.
 */
export async function creditSectorContractProgress(
    playerName: string,
    sector: number,
    now: number = Date.now(),
    opts: { failLoudly?: boolean } = {},
): Promise<SectorContractStatus | null> {
    if (!sectorContractsEnabled()) return null;
    const id = Math.floor(Number(sector));
    const name = String(playerName ?? '').trim();
    if (!name || !isWildSector(id)) return null;
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
        const progress = await kv.incr(contractProgressKey(name, id, day), { ex: CONTRACT_TTL_SECONDS });
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
    if (!name || !isWildSector(id)) return NO_CONTRACT;
    const day = utcDayOf(now);
    const contract = sectorContractFor(id, day);
    if (!contract) return NO_CONTRACT;
    try {
        const [progress, claimedAt] = await Promise.all([
            kv.get<number>(contractProgressKey(name, id, day)),
            kv.get<number>(contractClaimKey(name, id, day)),
        ]);
        return sectorContractStatus(contract, progress, claimedAt, now);
    } catch {
        return sectorContractStatus(contract, 0, 0, now);
    }
}
