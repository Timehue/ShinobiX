import type { TowerPvpBinding, TowerPvpSettleResponse } from '../../shared/tower-pvp.js';
import { towerPvpBindingOf } from '../../shared/tower-pvp.js';
import {
    advanceExpiredTowerPvpTurn,
    bumpTowerPvpVersion,
    towerPvpMember,
    type StoredTowerPvpMatch,
} from './_pvp-session.js';
import {
    expireTowerPvpReadyCheck,
    refreshTowerPvpLeases,
    releaseTerminalTowerPvpLeases,
    withTowerPvpMatchMutation,
    writeTowerPvpMatch,
    type TowerPvpStoreDeps,
} from './_pvp-store.js';
import { publishTowerPvpKick } from './_pvp-realtime.js';

function isTerminalMatch(match: StoredTowerPvpMatch): boolean {
    return match.status === 'done' || match.status === 'cancelled';
}

export type TowerPvpStateResult =
    | { ok: true; match: StoredTowerPvpMatch }
    | { ok: false; status: number; code: string; error: string; match?: StoredTowerPvpMatch };

/** Reconnect/poll projection with fail-closed AFK and ready-expiry mutations. */
export async function towerPvpState(
    matchId: string,
    slug: string,
    deps: TowerPvpStoreDeps = {},
): Promise<TowerPvpStateResult> {
    const expired = await expireTowerPvpReadyCheck(matchId, deps);
    if (!expired) return { ok: false, status: 404, code: 'match-not-found', error: 'Tower MPvP match not found.' };
    if (!towerPvpMember(expired, slug)) return { ok: false, status: 403, code: 'not-a-member', error: 'Not a member of this match.' };

    let terminal: StoredTowerPvpMatch | null = null;
    const fresh = await withTowerPvpMatchMutation(matchId, async match => {
        if (!match) return null;
        if (match.status === 'active' && advanceExpiredTowerPvpTurn(match, deps.now?.() ?? Date.now())) {
            await writeTowerPvpMatch(match, deps);
            publishTowerPvpKick(match, isTerminalMatch(match) ? 'closed' : 'action');
        }
        if (match.status === 'done' || match.status === 'cancelled') terminal = match;
        return match;
    }, deps);
    if (!fresh) return { ok: false, status: 404, code: 'match-not-found', error: 'Tower MPvP match not found.' };
    if (terminal) {
        await releaseTerminalTowerPvpLeases(terminal, deps).catch(() => undefined);
    } else {
        const lease = await refreshTowerPvpLeases(fresh, deps);
        if (!lease.ok) {
            return {
                ok: false,
                status: 409,
                code: 'member-busy',
                error: 'One or more match members belongs to another active battle.',
                match: fresh,
            };
        }
    }
    return { ok: true, match: fresh };
}

/**
 * Acknowledge a terminal result. This deliberately writes no save, currency,
 * rating, Tower floor, Spire tier, item or progression fields.
 */
export async function settleTowerPvpMatch(
    matchId: string,
    slug: string,
    deps: TowerPvpStoreDeps = {},
    /**
     * Surface that owns this settlement. The open queue's acknowledgement is
     * terminal, but a clan-war 2v2 must ALSO apply its ChallengeResult — so the
     * public route must never be able to zero-settle a war match and strand the
     * challenge. Omitted only by internal callers.
     */
    requireBinding?: TowerPvpBinding['kind'],
): Promise<
    | { ok: true; response: TowerPvpSettleResponse<StoredTowerPvpMatch['combat']> }
    | { ok: false; status: number; code: string; error: string; match?: StoredTowerPvpMatch }
> {
    let terminal: StoredTowerPvpMatch | null = null;
    const result = await withTowerPvpMatchMutation(matchId, async match => {
        if (!match) return { ok: false, status: 404, code: 'match-not-found', error: 'Tower MPvP match not found.' } as const;
        if (!towerPvpMember(match, slug)) return { ok: false, status: 403, code: 'not-a-member', error: 'Not a member of this match.' } as const;
        if (requireBinding && towerPvpBindingOf(match).kind !== requireBinding) {
            return { ok: false, status: 403, code: 'wrong-surface', error: 'That match settles through a different Tower surface.', match } as const;
        }
        if (match.status !== 'done' && match.status !== 'cancelled') {
            return { ok: false, status: 409, code: 'match-active', error: 'The match has not ended.', match } as const;
        }
        terminal = match;
        const replayed = match.settlement.acknowledgements.includes(slug);
        if (!replayed) {
            match.settlement.acknowledgements = [...match.settlement.acknowledgements, slug].sort();
            bumpTowerPvpVersion(match, deps.now?.() ?? Date.now());
            await writeTowerPvpMatch(match, deps);
        }
        return {
            ok: true,
            response: {
                settled: true,
                replayed,
                progressionApplied: false,
                rewards: { ryo: 0, xp: 0, fateShards: 0, rating: 0 },
                match,
            },
        } as const;
    }, deps);
    if (terminal) await releaseTerminalTowerPvpLeases(terminal, deps).catch(() => undefined);
    if (result.ok) publishTowerPvpKick(result.response.match, 'settled');
    return result;
}
